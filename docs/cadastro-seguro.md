# Cadastro por convite e proteção do perfil

## Comportamento

O navegador envia nome e código do convite em `signUp.options.data`. Esses valores são entradas não confiáveis: o banco procura um convite ativo e ainda não utilizado antes de permitir a criação do perfil. O plano inicial é definido pelo servidor como `gratuito`, independentemente dos metadados enviados.

O trigger de `auth.users` bloqueia o registro de convite durante a transação. Criação do usuário, criação do perfil e consumo do convite são confirmados ou desfeitos juntos. Duas transações concorrentes não conseguem consumir o mesmo convite. O convite é consumido na criação da conta, antes da confirmação por email; eventual recuperação de convite abandonado é uma ação administrativa.

`anon` e `authenticated` não podem consultar nem alterar a tabela de convites. O usuário autenticado pode ler o próprio perfil e atualizar somente `nome`. Plano, email, convite usado, id e data de criação não são editáveis pelo cliente. As permissões administrativas de `service_role` são preservadas.

O trigger fica em `invexa_private`, sem acesso dos papéis do navegador, com `search_path` fixo. Ele roda com privilégios do proprietário porque precisa criar o perfil e consumir o convite durante a transação interna de Auth. Não exige `auth.uid()` nessa fase: ainda não há sessão; a identidade vem de `NEW.id` no trigger de `auth.users`. Não há RPC privilegiada de cadastro acessível ao cliente.

## Compatibilidade e implantação

Migração: `supabase/migrations/20260916225659_secure_invite_signup.sql`. Criada originalmente pelo comando oficial `supabase migration new`; após a aplicação pelo conector, o nome foi alinhado à versão registrada pelo Supabase para evitar reaplicação em futuros deploys.

1. Conferir que a função/trigger e as quatro políticas antigas ainda correspondem à versão auditada. O SQL remove esses objetos pelos nomes conhecidos; falhas devem abortar a migração inteira.
2. Publicar primeiro o frontend desta versão. Ele exige a RPC de compatibilidade `invexa_signup_ready()`; enquanto a migração não existir, o cadastro mostra indisponibilidade e não chama `signUp`. O login existente continua disponível.
3. Aplicar a migração inteira em uma transação, pelo mecanismo de migrations do Supabase. Não executar partes isoladas.
4. Verificar a RPC, as permissões e o trigger com `supabase/verification/secure_invite_signup.sql` e executar o verificador de segurança do Supabase.
5. Conferir cadastro, recebimento e confirmação de email e login com uma conta destinada ao teste. Conferir rejeição de convite inválido/reutilizado. Clientes que mantiverem uma versão antiga do frontend precisarão recarregar a página para cadastrar.

Não publique somente o frontend antigo depois da migração: ele tenta consultar a tabela de convites e terá o cadastro bloqueado. Em uma falha de publicação, mantenha as restrições do banco e suspenda novos cadastros até publicar a correção; não reabra a tabela de convites como solução temporária.

Criações administrativas de usuários também precisam de um convite válido nos metadados. Login de contas existentes não dispara o trigger de criação e não consome convite. Provedores OAuth/telefone estavam desativados na consulta de configuração; se forem habilitados futuramente, o fluxo deve ser revisto. Hooks HTTP de Auth não foram inspecionados.

## Testes

Testes de interface e cliente (sem serviços externos):

```sh
npm ci --ignore-scripts
npm test
```

Testes de banco: apontar `LOCAL_TEST_DATABASE_URL` para um PostgreSQL local descartável e executar `npm run test:db`. O teste aceita somente localhost/127.0.0.1/::1, cria um banco separado com nome `invexa_security_test_*` e usa dados fictícios. Não deve receber a URL do Supabase ativo.

O arquivo `tests/database/baseline.sql` reproduz as sete tabelas e políticas auditadas. `auth.users` e `auth.uid()` são representações mínimas para testar o trigger e a RLS; o serviço GoTrue e o envio de email não fazem parte desse ambiente.

Validação realizada em Node **22.23.2** e PostgreSQL **17.10**: **31 testes passaram**, incluindo uma disputa real entre duas conexões pelo mesmo convite, rollback, preservação de contas anteriores, bloqueio de dados administrativos e comportamento dos formulários. No ambiente Windows restrito foi necessário `--experimental-test-isolation=none` e `KEEP_TEST_DATABASE=1`, pois a remoção de um banco solicita um checkpoint que o ambiente não permitiu sinalizar. O banco preservado contém somente dados fictícios.

## Implantação realizada em 16/09/2026

O PR #1 foi incorporado em `main` no commit `56db93a0de53a6e5cf29cbc83ce7a6dc3e899ac5`. A Vercel confirmou a publicação em produção; em seguida, o Supabase aplicou a migração com a versão `20260916225659`.

Verificação após implantação: site e módulos responderam HTTP 200; a RPC pública de compatibilidade retornou `true`; a consulta anônima a convites foi negada. As permissões efetivas confirmaram edição somente de nome pelo usuário, plano protegido e acesso administrativo preservado. O trigger privado e as políticas também foram conferidos. As telas de login e cadastro abriram normalmente no navegador.

O verificador de segurança não apontou mais os problemas da função pública antiga. O aviso informativo de RLS sem política em `convites` é esperado: a tabela não deve ser acessível pelos clientes. Permanece o alerta de proteção contra senhas vazadas desativada, cuja configuração não foi alterada nesta implantação.

Cadastro com convite válido, recebimento/confirmação de email e login autenticado ainda precisam de teste com uma conta destinada a isso. Não foram criadas contas nem consumidos convites reais durante estas verificações.

## Referências

- [Triggers de criação de perfil no Supabase](https://supabase.com/docs/guides/auth/managing-user-data)
- [Bloqueios de linha no PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html)
- [Políticas e WITH CHECK](https://www.postgresql.org/docs/17/sql-createpolicy.html)
