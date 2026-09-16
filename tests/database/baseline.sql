-- Schema de teste reconstruído dos metadados auditados; sem dados reais.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, supabase_auth_admin;
grant all on auth.users to supabase_auth_admin;
grant execute on function auth.uid() to anon, authenticated;
create table public.profiles (
  "id" uuid not null,
  "nome" text,
  "email" text,
  "plano" text default 'gratuito'::text,
  "convite_usado" text,
  "criado_em" timestamp with time zone default now()
);
create table public.convites (
  "id" uuid default gen_random_uuid() not null,
  "codigo" text not null,
  "criado_por" uuid,
  "usado_por" uuid,
  "usado_em" timestamp with time zone,
  "ativo" boolean default true,
  "criado_em" timestamp with time zone default now()
);
create table public.carteira (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "ticker" text not null,
  "cotas" numeric default 0 not null,
  "preco_medio" numeric default 0 not null,
  "tipo" text default 'FII'::text,
  "ativo" boolean default true,
  "criado_em" timestamp with time zone default now(),
  "atualizado_em" timestamp with time zone default now(),
  "div_mes" numeric default 0,
  "dy12m" numeric default 0
);
create table public.aportes (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "ticker" text not null,
  "cotas" numeric not null,
  "preco" numeric not null,
  "total" numeric generated always as ((cotas * preco)) stored,
  "data" date not null,
  "criado_em" timestamp with time zone default now()
);
create table public.proventos_recebidos (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "ticker" text not null,
  "valor_por_cota" numeric not null,
  "cotas_na_data" numeric not null,
  "total" numeric generated always as ((valor_por_cota * cotas_na_data)) stored,
  "data_com" date not null,
  "data_pgto" date,
  "criado_em" timestamp with time zone default now()
);
create table public.perfil_investidor (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid,
  "objetivo" text,
  "horizonte" text,
  "risco" text,
  "aporte_mensal" numeric,
  "observacoes" text,
  "criado_em" timestamp with time zone default now(),
  "atualizado_em" timestamp with time zone default now()
);
create table public.chat_historico (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid,
  "role" text,
  "conteudo" text,
  "criado_em" timestamp with time zone default now()
);
alter table public."convites" add constraint "convites_pkey" PRIMARY KEY (id);
alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
alter table public."carteira" add constraint "carteira_pkey" PRIMARY KEY (id);
alter table public."aportes" add constraint "aportes_pkey" PRIMARY KEY (id);
alter table public."proventos_recebidos" add constraint "proventos_recebidos_pkey" PRIMARY KEY (id);
alter table public."perfil_investidor" add constraint "perfil_investidor_pkey" PRIMARY KEY (id);
alter table public."chat_historico" add constraint "chat_historico_pkey" PRIMARY KEY (id);
alter table public."convites" add constraint "convites_codigo_key" UNIQUE (codigo);
alter table public."profiles" add constraint "profiles_email_key" UNIQUE (email);
alter table public."carteira" add constraint "carteira_user_id_ticker_key" UNIQUE (user_id, ticker);
alter table public."perfil_investidor" add constraint "perfil_investidor_user_id_key" UNIQUE (user_id);
alter table public."profiles" add constraint "profiles_plano_check" CHECK ((plano = ANY (ARRAY['gratuito'::text, 'pro'::text])));
alter table public."carteira" add constraint "carteira_tipo_check" CHECK ((tipo = ANY (ARRAY['FII'::text, 'FIAgro'::text, 'Ação'::text, 'Tesouro'::text])));
alter table public."chat_historico" add constraint "chat_historico_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
alter table public."convites" add constraint "convites_criado_por_fkey" FOREIGN KEY (criado_por) REFERENCES profiles(id);
alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."convites" add constraint "convites_usado_por_fkey" FOREIGN KEY (usado_por) REFERENCES profiles(id);
alter table public."carteira" add constraint "carteira_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."aportes" add constraint "aportes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."proventos_recebidos" add constraint "proventos_recebidos_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."perfil_investidor" add constraint "perfil_investidor_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."chat_historico" add constraint "chat_historico_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.profiles enable row level security;
alter table public.convites enable row level security;
alter table public.carteira enable row level security;
alter table public.aportes enable row level security;
alter table public.proventos_recebidos enable row level security;
alter table public.perfil_investidor enable row level security;
alter table public.chat_historico enable row level security;
create policy "usuario gerencia proprios aportes" on public."aportes" as PERMISSIVE for ALL to PUBLIC using ((auth.uid() = user_id));
create policy "usuario ve proprios aportes" on public."aportes" as PERMISSIVE for SELECT to PUBLIC using ((auth.uid() = user_id));
create policy "usuario gerencia propria carteira" on public."carteira" as PERMISSIVE for ALL to PUBLIC using ((auth.uid() = user_id));
create policy "usuario ve propria carteira" on public."carteira" as PERMISSIVE for SELECT to PUBLIC using ((auth.uid() = user_id));
create policy "usuario ve proprio chat" on public."chat_historico" as PERMISSIVE for ALL to PUBLIC using ((auth.uid() = user_id));
create policy "usuario usa convite" on public."convites" as PERMISSIVE for UPDATE to PUBLIC using (true);
create policy "usuario verifica convite" on public."convites" as PERMISSIVE for SELECT to PUBLIC using (true);
create policy "usuario ve proprio perfil investidor" on public."perfil_investidor" as PERMISSIVE for ALL to PUBLIC using ((auth.uid() = user_id));
create policy "usuario edita proprio perfil" on public."profiles" as PERMISSIVE for UPDATE to PUBLIC using ((auth.uid() = id));
create policy "usuario ve proprio perfil" on public."profiles" as PERMISSIVE for SELECT to PUBLIC using ((auth.uid() = id));
create policy "usuario gerencia proprios proventos" on public."proventos_recebidos" as PERMISSIVE for ALL to PUBLIC using ((auth.uid() = user_id));
create policy "usuario ve proprios proventos" on public."proventos_recebidos" as PERMISSIVE for SELECT to PUBLIC using ((auth.uid() = user_id));
grant all on all tables in schema public to anon, authenticated;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$function$
;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
grant update (plano) on public.profiles to authenticated;
grant select (codigo) on public.convites to anon;
