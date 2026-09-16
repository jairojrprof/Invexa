-- Verificação de leitura após a implantação. Não cria contas nem altera dados.
select public.invexa_signup_ready() as signup_ready;

select role_name,
  has_table_privilege(role_name, 'public.convites', 'SELECT') as invites_select,
  has_table_privilege(role_name, 'public.convites', 'UPDATE') as invites_update,
  has_column_privilege(role_name, 'public.profiles', 'nome', 'UPDATE') as profile_name_update,
  has_column_privilege(role_name, 'public.profiles', 'plano', 'UPDATE') as profile_plan_update,
  has_function_privilege(role_name, 'invexa_private.handle_new_user()', 'EXECUTE') as signup_trigger_execute
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);
-- Esperado: convites negados a anon/authenticated; nome editável só por
-- authenticated/service_role; plano somente service_role; trigger negado ao cliente.

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename in ('profiles', 'convites')
order by tablename, policyname;

select n.nspname, p.proname, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'invexa_private' and p.proname = 'handle_new_user')
   or (n.nspname = 'public' and p.proname in ('handle_new_user', 'invexa_signup_ready'));
-- Esperado: handle_new_user apenas em invexa_private, search_path fixo;
-- invexa_signup_ready é SECURITY INVOKER.

select pg_get_triggerdef(oid)
from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created';
