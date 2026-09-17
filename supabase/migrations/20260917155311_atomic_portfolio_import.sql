-- Uma operação grava histórico e posição na mesma transação.
create table invexa_private.portfolio_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  payload_hash bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table invexa_private.portfolio_requests enable row level security;
revoke all on invexa_private.portfolio_requests from public,anon,authenticated;

create function invexa_private.mutate_portfolio(p_action text,p_request_id uuid,p_entries jsonb,p_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_payload bytea := sha256(convert_to(jsonb_build_object('action',p_action,'entries',p_entries,'id',p_id)::text,'UTF8'));
  v_previous invexa_private.portfolio_requests%rowtype;
  v_result jsonb;
  v_ticker text;
  v_count integer := 0;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Serializa alterações da mesma conta, inclusive importações em abas diferentes.
  perform 1 from public.profiles where id=v_user for update;
  if not found then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_request_id is null or p_action is null or p_action not in ('add','reset','remove_aporte','remove_ativo') then
    raise exception 'Invalid operation' using errcode='22023';
  end if;
  select * into v_previous from invexa_private.portfolio_requests where user_id=v_user and request_id=p_request_id;
  if found then
    if v_previous.payload_hash is distinct from v_payload then raise exception 'Request already used' using errcode='22023'; end if;
    return v_previous.result;
  end if;
  if p_action='add' then
    if p_entries is null or jsonb_typeof(p_entries)<>'array' then raise exception 'Invalid entries' using errcode='22023'; end if;
    if jsonb_array_length(p_entries) not between 1 and 5000 or pg_column_size(p_entries)>2000000 then
      raise exception 'Invalid batch size' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e)<>'object'
      or jsonb_typeof(e->'ticker') is distinct from 'string'
      or jsonb_typeof(e->'cotas') is distinct from 'number'
      or jsonb_typeof(e->'preco') is distinct from 'number'
      or jsonb_typeof(e->'data') is distinct from 'string'
      or (e->>'ticker') !~ '^[A-Z][A-Z0-9]{3,11}$'
      or (e->>'data') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Invalid entry' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_to_recordset(p_entries) as e(cotas numeric,preco numeric,data date)
      where cotas<=0 or cotas>1000000000 or preco<=0 or preco>1000000000
      or data>current_date or data<date '1900-01-01') then
      raise exception 'Invalid quantity, price or date' using errcode='22023';
    end if;
    insert into public.aportes(user_id,ticker,cotas,preco,data)
      select v_user,e.ticker,e.cotas,e.preco,e.data from jsonb_to_recordset(p_entries) as e(ticker text,cotas numeric,preco numeric,data date);
    get diagnostics v_count = row_count;
    -- Recalcula do histórico, sem somar posições antigas deixadas pelo reset.
    insert into public.carteira(user_id,ticker,cotas,preco_medio,tipo,ativo)
      select v_user,a.ticker,sum(a.cotas),round(sum(a.cotas*a.preco)/sum(a.cotas),4),
        case when right(a.ticker,2)='11' or length(a.ticker)>5 then 'FII' else 'Ação' end,true
      from public.aportes a where a.user_id=v_user
        and a.ticker in (select e->>'ticker' from jsonb_array_elements(p_entries) e)
      group by a.ticker
      on conflict(user_id,ticker) do update set cotas=excluded.cotas,preco_medio=excluded.preco_medio,
        ativo=true,atualizado_em=now();
  elsif p_action='reset' then
    delete from public.aportes where user_id=v_user;
    update public.carteira set ativo=false,cotas=0,preco_medio=0,atualizado_em=now() where user_id=v_user;
  else
    if p_action='remove_aporte' then
      delete from public.aportes where id=p_id and user_id=v_user returning ticker into v_ticker;
    else
      select ticker into v_ticker from public.carteira where id=p_id and user_id=v_user;
      if found then delete from public.aportes where user_id=v_user and ticker=v_ticker; end if;
    end if;
    if v_ticker is null then raise exception 'Entry not found' using errcode='22023'; end if;
    update public.carteira c set cotas=s.cotas,preco_medio=s.pm,ativo=s.cotas>0,atualizado_em=now()
      from (select coalesce(sum(cotas),0) as cotas,coalesce(round(sum(cotas*preco)/nullif(sum(cotas),0),4),0) as pm
        from public.aportes where user_id=v_user and ticker=v_ticker) s
      where c.user_id=v_user and c.ticker=v_ticker;
  end if;
  v_result := jsonb_build_object('ok',true,'count',v_count);
  insert into invexa_private.portfolio_requests(user_id,request_id,payload_hash,result) values(v_user,p_request_id,v_payload,v_result);
  return v_result;
end;
$$;
revoke all on function invexa_private.mutate_portfolio(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant usage on schema invexa_private to authenticated;
grant execute on function invexa_private.mutate_portfolio(text,uuid,jsonb,uuid) to authenticated;
create function public.mutate_portfolio(p_action text,p_request_id uuid,p_entries jsonb default '[]',p_id uuid default null)
returns jsonb language sql security invoker set search_path=''
as $$ select invexa_private.mutate_portfolio(p_action,p_request_id,p_entries,p_id) $$;
revoke all on function public.mutate_portfolio(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.mutate_portfolio(text,uuid,jsonb,uuid) to authenticated;

-- Recupera somente posições ausentes/inativas com histórico de compras válido.
-- Não insere, remove ou duplica aportes, nem altera posições já ativas.
insert into public.carteira(user_id,ticker,cotas,preco_medio,tipo,ativo)
  select a.user_id,a.ticker,sum(a.cotas),round(sum(a.cotas*a.preco)/sum(a.cotas),4),
    case when right(a.ticker,2)='11' or length(a.ticker)>5 then 'FII' else 'Ação' end,true
  from public.aportes a left join public.carteira c on c.user_id=a.user_id and c.ticker=a.ticker
  where c.id is null or c.ativo is not true
  group by a.user_id,a.ticker
  having bool_and(a.cotas>0 and a.preco>0 and a.ticker ~ '^[A-Z][A-Z0-9]{3,11}$')
  on conflict(user_id,ticker) do update set cotas=excluded.cotas,preco_medio=excluded.preco_medio,ativo=true,atualizado_em=now();
