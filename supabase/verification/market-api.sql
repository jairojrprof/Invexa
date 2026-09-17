-- Somente leitura. A RPC consume_market_quota altera o contador; não a use como health check.
select to_regprocedure('public.consume_market_quota(text,integer)') as quota_rpc;
select role_name,
  has_function_privilege(role_name,'public.consume_market_quota(text,integer)','EXECUTE') as consume_quota,
  has_table_privilege(role_name,'invexa_private.market_usage','SELECT') as read_usage,
  has_table_privilege(role_name,'invexa_private.market_usage','UPDATE') as reset_usage,
  has_function_privilege(role_name,'invexa_private.handle_new_user()','EXECUTE') as signup_trigger
from (values ('anon'),('authenticated')) roles(role_name);
-- anon: tudo false; authenticated: somente consume_quota true.
select n.nspname,p.proname,p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.proname='consume_market_quota';
-- public: invoker; invexa_private: definer; ambos search_path fixo.
select relrowsecurity from pg_class where oid='invexa_private.market_usage'::regclass;
