-- Cadastro e consumo de convite devem fazer parte da mesma transação de Auth.
-- Aplicar junto com o novo signup-client.js; clientes antigos não são compatíveis.

create schema if not exists invexa_private;
revoke all on schema invexa_private from public, anon, authenticated;

create or replace function invexa_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
  invitation_code text;
  display_name text;
begin
  -- O trigger de criação roda antes de existir uma sessão: auth.uid() pode ser NULL.
  -- NEW e o contexto do trigger são a identidade; metadata é apenas entrada não confiável.
  if tg_op <> 'INSERT' or tg_table_schema <> 'auth' or tg_table_name <> 'users' then
    raise exception 'Invalid signup trigger context' using errcode = '42501';
  end if;

  invitation_code := upper(btrim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  display_name := btrim(coalesce(new.raw_user_meta_data ->> 'nome', ''));
  if invitation_code = '' or char_length(invitation_code) > 128 or char_length(display_name) > 120 then
    raise exception 'Invalid signup invitation or name' using errcode = '23514';
  end if;

  -- O lock persiste até o commit de Auth. Outra criação com o mesmo convite
  -- aguarda e reavalia a condição após a primeira consumir o registro.
  select id into invitation_id
    from public.convites
    where codigo = invitation_code
      and ativo is true and usado_por is null and usado_em is null
    for update;
  if not found then
    raise exception 'Invalid or unavailable signup invitation' using errcode = '23514';
  end if;

  insert into public.profiles (id, email, nome, plano, convite_usado)
    values (new.id, new.email, nullif(display_name, ''), 'gratuito', invitation_code);

  update public.convites
    set usado_por = new.id, usado_em = statement_timestamp(), ativo = false
    where id = invitation_id;
  return new;
end;
$$;

revoke all on function invexa_private.handle_new_user() from public, anon, authenticated;

drop trigger on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function invexa_private.handle_new_user();
drop function public.handle_new_user();

drop policy "usuario verifica convite" on public.convites;
drop policy "usuario usa convite" on public.convites;
revoke all on table public.convites from public, anon, authenticated;

drop policy "usuario edita proprio perfil" on public.profiles;
drop policy "usuario ve proprio perfil" on public.profiles;
revoke all on table public.profiles from public, anon, authenticated;

-- REVOKE na tabela não remove grants concedidos diretamente a colunas.
do $$
declare table_name text; columns_sql text;
begin
  foreach table_name in array array['profiles', 'convites'] loop
    select string_agg(format('%I', attname), ', ') into columns_sql
      from pg_catalog.pg_attribute
      where attrelid = format('public.%I', table_name)::regclass
        and attnum > 0 and not attisdropped;
    execute format('revoke all privileges (%s) on table public.%I from public, anon, authenticated', columns_sql, table_name);
  end loop;
end;
$$;

grant select on public.profiles to authenticated;
grant update (nome) on public.profiles to authenticated;

create policy "usuario ve proprio perfil" on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "usuario edita proprio nome" on public.profiles
for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

alter table public.profiles enable row level security;
alter table public.convites enable row level security;

-- Sinal de compatibilidade sem acesso a dados ou privilégios elevados.
create function public.invexa_signup_ready()
returns boolean language sql stable security invoker set search_path = ''
as $$ select true $$;
revoke all on function public.invexa_signup_ready() from public;
grant execute on function public.invexa_signup_ready() to anon, authenticated;
