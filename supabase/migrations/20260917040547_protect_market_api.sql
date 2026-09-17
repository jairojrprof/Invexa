-- Cota compartilhada entre instâncias. Nenhuma chave administrativa no cliente.
create table invexa_private.market_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('quote', 'dividends')),
  minute_start timestamptz not null,
  day_start timestamptz not null,
  minute_used integer not null default 0 check (minute_used >= 0),
  day_used integer not null default 0 check (day_used >= 0),
  primary key (user_id, kind)
);
alter table invexa_private.market_usage enable row level security;
revoke all on invexa_private.market_usage from public, anon, authenticated;

create function invexa_private.consume_market_quota(p_kind text, p_cost integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_minute timestamptz;
  v_day timestamptz;
  v_row invexa_private.market_usage%rowtype;
  v_minute_limit integer;
  v_day_limit integer;
  v_retry integer := 0;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('quote','dividends') or p_cost is null or p_cost < 1
     or p_cost > (case when p_kind = 'quote' then 10 else 1 end) then
    raise exception 'Invalid quota request' using errcode = '22023';
  end if;
  v_minute_limit := case when p_kind = 'quote' then 120 else 30 end;
  v_day_limit := case when p_kind = 'quote' then 1200 else 300 end;
  insert into invexa_private.market_usage(user_id,kind,minute_start,day_start)
    values (v_user,p_kind,v_now,v_now) on conflict do nothing;
  select * into v_row from invexa_private.market_usage
    where user_id = v_user and kind = p_kind for update;
  v_now := clock_timestamp();
  v_minute := date_trunc('minute',v_now);
  v_day := date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  if v_row.minute_start < v_minute then v_row.minute_used := 0; end if;
  if v_row.day_start < v_day then v_row.day_used := 0; end if;
  if v_row.minute_used + p_cost > v_minute_limit then
    v_retry := greatest(1,ceil(extract(epoch from (v_minute + interval '1 minute' - v_now)))::integer);
  end if;
  if v_row.day_used + p_cost > v_day_limit then
    v_retry := greatest(v_retry,ceil(extract(epoch from (v_day + interval '1 day' - v_now)))::integer);
  end if;
  if v_retry > 0 then return jsonb_build_object('allowed',false,'retry_after',v_retry); end if;
  update invexa_private.market_usage set
    minute_start=v_minute,day_start=v_day,
    minute_used=v_row.minute_used+p_cost,day_used=v_row.day_used+p_cost
    where user_id=v_user and kind=p_kind;
  return jsonb_build_object('allowed',true,'retry_after',0);
end;
$$;
revoke all on function invexa_private.consume_market_quota(text,integer) from public,anon,authenticated;
-- O wrapper só expõe o contador do próprio usuário, sem retornar uma autorização reutilizável.
grant usage on schema invexa_private to authenticated;
grant execute on function invexa_private.consume_market_quota(text,integer) to authenticated;
create function public.consume_market_quota(p_kind text,p_cost integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select invexa_private.consume_market_quota(p_kind,p_cost) $$;
revoke all on function public.consume_market_quota(text,integer) from public,anon,authenticated;
grant execute on function public.consume_market_quota(text,integer) to authenticated;
