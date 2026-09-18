-- Guarda a origem sem converter desdobramentos em aportes fictícios.
create table invexa_private.b3_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_key jsonb not null,
  kind text not null check(kind in ('purchase','split')),
  ticker text not null,
  data date not null,
  cotas numeric not null check(cotas>0),
  preco numeric not null check(preco>=0),
  aporte_id uuid unique references public.aportes(id) on delete cascade,
  primary key(user_id,source_key),
  check((kind='purchase' and aporte_id is not null and preco>0) or (kind='split' and aporte_id is null and preco=0))
);
create index b3_records_user_ticker on invexa_private.b3_records(user_id,ticker);
alter table invexa_private.b3_records enable row level security;
revoke all on invexa_private.b3_records from public,anon,authenticated;

-- Só registros anteriores à migração podem ser associados à primeira reimportação.
create table invexa_private.b3_legacy_aportes (
  aporte_id uuid primary key references public.aportes(id) on delete cascade
);
insert into invexa_private.b3_legacy_aportes select id from public.aportes;
alter table invexa_private.b3_legacy_aportes enable row level security;
revoke all on invexa_private.b3_legacy_aportes from public,anon,authenticated;

create function invexa_private.rebuild_portfolio(p_ticker text) returns void
language plpgsql security invoker set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.carteira(user_id,ticker,cotas,preco_medio,tipo,ativo)
    select v_user,p_ticker,s.qty,coalesce(round(s.cost/nullif(s.qty,0),4),0),
      case when right(p_ticker,2)='11' then 'FII' else 'Ação' end,s.qty>0
    from (select coalesce(sum(a.cotas),0)+(select coalesce(sum(b.cotas),0) from invexa_private.b3_records b
        where b.user_id=v_user and b.ticker=p_ticker and b.kind='split') qty,
      coalesce(sum(a.cotas*a.preco),0) cost from public.aportes a where a.user_id=v_user and a.ticker=p_ticker) s
    on conflict(user_id,ticker) do update set cotas=excluded.cotas,preco_medio=excluded.preco_medio,
      ativo=excluded.ativo,atualizado_em=now();
end $$;
revoke all on function invexa_private.rebuild_portfolio(text) from public,anon,authenticated;

create or replace function invexa_private.mutate_portfolio(p_action text,p_request_id uuid,p_entries jsonb,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_payload bytea:=sha256(convert_to(jsonb_build_object('action',p_action,'entries',p_entries,'id',p_id)::text,'UTF8'));
  v_previous invexa_private.portfolio_requests%rowtype;
  v_record invexa_private.b3_records%rowtype;
  v_result jsonb; v_ticker text; v_aporte uuid; v_key jsonb; e record;
  v_count integer:=0; v_splits integer:=0; v_existing integer:=0; v_linked integer:=0;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_request_id is null or p_action is null or p_action not in ('add','import_b3','reset','remove_aporte','remove_ativo') then
    raise exception 'Invalid operation' using errcode='22023';
  end if;
  select * into v_previous from invexa_private.portfolio_requests where user_id=v_user and request_id=p_request_id;
  if found then
    if v_previous.payload_hash is distinct from v_payload then raise exception 'Request already used' using errcode='22023'; end if;
    return v_previous.result;
  end if;
  if p_action in ('add','import_b3') then
    if p_entries is null or jsonb_typeof(p_entries)<>'array' then raise exception 'Invalid entries' using errcode='22023'; end if;
    if jsonb_array_length(p_entries) not between 1 and 5000 or pg_column_size(p_entries)>2000000 then
      raise exception 'Invalid batch size' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_entries) j where jsonb_typeof(j)<>'object'
      or jsonb_typeof(j->'ticker') is distinct from 'string' or jsonb_typeof(j->'cotas') is distinct from 'number'
      or jsonb_typeof(j->'preco') is distinct from 'number' or jsonb_typeof(j->'data') is distinct from 'string'
      or (j->>'ticker') !~ '^[A-Z][A-Z0-9]{3,11}$' or (j->>'data') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Invalid entry' using errcode='22023';
    end if;
    if p_action='import_b3' and exists(select 1 from jsonb_array_elements(p_entries) j
      where jsonb_typeof(j->'kind') is distinct from 'string' or j->>'kind' not in ('purchase','split')
      or jsonb_typeof(j->'instituicao') is distinct from 'string' or (j->>'instituicao') !~ '^[A-Z0-9]{1,200}$'
      or (j->>'ticker') !~ '^[A-Z]{4}\d{1,2}$') then raise exception 'Invalid B3 entry' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(p_entries) as j(cotas numeric,preco numeric,data date,kind text)
      where cotas<=0 or cotas>1000000000 or preco>1000000000 or data>current_date or data<date '1900-01-01'
        or case when p_action='import_b3' and kind='split' then preco<>0 else preco<=0 end) then
      raise exception 'Invalid quantity, price or date' using errcode='22023';
    end if;
    if p_action='add' then
      insert into public.aportes(user_id,ticker,cotas,preco,data)
        select v_user,j.ticker,j.cotas,j.preco,j.data from jsonb_to_recordset(p_entries) as j(ticker text,cotas numeric,preco numeric,data date);
      get diagnostics v_count=row_count;
    else
      -- Compras iguais são um multiconjunto: duas linhas legítimas continuam sendo duas compras.
      -- Desdobros da mesma data/instituição são uma única quantidade adicional agregada.
      for e in
        with raw as (select * from jsonb_to_recordset(p_entries) as j(kind text,ticker text,data date,cotas numeric,preco numeric,instituicao text)),
        canonical as (
          select kind,ticker,data,trim_scale(cotas) cotas,trim_scale(preco) preco,instituicao,
            row_number() over(partition by kind,ticker,data,cotas,preco,instituicao) occurrence from raw where kind='purchase'
          union all select kind,ticker,data,trim_scale(sum(cotas)),0,instituicao,1 from raw where kind='split' group by kind,ticker,data,instituicao
        ) select * from canonical order by kind,data,ticker,instituicao,cotas,preco,occurrence
      loop
        v_key:=case when e.kind='split' then jsonb_build_array(e.kind,e.ticker,e.data,e.instituicao)
          else jsonb_build_array(e.kind,e.ticker,e.data,e.instituicao,e.cotas,e.preco,e.occurrence) end;
        select * into v_record from invexa_private.b3_records where user_id=v_user and source_key=v_key;
        if found then
          if v_record.cotas<>e.cotas then raise exception 'B3_SPLIT_CONFLICT' using errcode='22023'; end if;
          v_existing:=v_existing+1; continue;
        end if;
        v_aporte:=null;
        if e.kind='purchase' then
          select a.id into v_aporte from public.aportes a join invexa_private.b3_legacy_aportes l on l.aporte_id=a.id
            where a.user_id=v_user and a.ticker=e.ticker and a.data=e.data and a.cotas=e.cotas and a.preco=e.preco
            order by a.criado_em,a.id limit 1;
          if found then
            delete from invexa_private.b3_legacy_aportes where aporte_id=v_aporte;
            v_linked:=v_linked+1;
          else
            insert into public.aportes(user_id,ticker,cotas,preco,data) values(v_user,e.ticker,e.cotas,e.preco,e.data) returning id into v_aporte;
            v_count:=v_count+1;
          end if;
        else
          if not exists(select 1 from public.aportes where user_id=v_user and ticker=e.ticker and data<=e.data) then
            raise exception 'B3_SPLIT_WITHOUT_HISTORY' using errcode='22023';
          end if;
          v_splits:=v_splits+1;
        end if;
        insert into invexa_private.b3_records(user_id,source_key,kind,ticker,data,cotas,preco,aporte_id)
          values(v_user,v_key,e.kind,e.ticker,e.data,e.cotas,e.preco,v_aporte);
      end loop;
    end if;
    for v_ticker in select distinct j->>'ticker' from jsonb_array_elements(p_entries) j loop
      perform invexa_private.rebuild_portfolio(v_ticker);
    end loop;
  elsif p_action='reset' then
    delete from invexa_private.b3_records where user_id=v_user;
    delete from public.aportes where user_id=v_user;
    update public.carteira set ativo=false,cotas=0,preco_medio=0,atualizado_em=now() where user_id=v_user;
  else
    if p_action='remove_aporte' then
      if exists(select 1 from public.aportes a join invexa_private.b3_records b on b.user_id=a.user_id and b.ticker=a.ticker
        where a.id=p_id and a.user_id=v_user and b.kind='split' and a.data<=b.data) then
        raise exception 'B3_PURCHASE_HAS_SPLIT' using errcode='22023';
      end if;
      delete from public.aportes where id=p_id and user_id=v_user returning ticker into v_ticker;
    else
      select ticker into v_ticker from public.carteira where id=p_id and user_id=v_user;
      if found then
        delete from invexa_private.b3_records where user_id=v_user and ticker=v_ticker;
        delete from public.aportes where user_id=v_user and ticker=v_ticker;
      end if;
    end if;
    if v_ticker is null then raise exception 'Entry not found' using errcode='22023'; end if;
    perform invexa_private.rebuild_portfolio(v_ticker);
  end if;
  v_result:=jsonb_build_object('ok',true,'count',v_count,'splits',v_splits,'existing',v_existing,'linked',v_linked);
  insert into invexa_private.portfolio_requests(user_id,request_id,payload_hash,result) values(v_user,p_request_id,v_payload,v_result);
  return v_result;
end $$;

-- Todas as gravações passam pela operação atômica; leitura continua via RLS.
revoke insert,update,delete on public.aportes,public.carteira from anon,authenticated;
