# Proteção das consultas de mercado

As rotas GET `/api/quote?tickers=PETR4,VALE3` e `/api/dividends?ticker=PETR4` exigem `Authorization: Bearer <sessão Supabase>`. O servidor valida a sessão com Auth antes de consumir cota e antes de ler o cache. Contas anônimas ou sem email confirmado são recusadas. CORS aberto foi removido; CORS não substitui autenticação.

O frontend envia a sessão atual, divide cotações em lotes de até dez ativos e respeita `Retry-After`. O botão de atualização impede cliques simultâneos. Falhas passam a aparecer num aviso textual, com indicação de que totais podem estar incompletos ou usar valores anteriores/preços de compra. Dividendos já carregados não são substituídos por zeros quando o provedor falha. A mudança não corrige os cálculos financeiros pendentes.

## Limites

| Consulta | Por minuto | Por dia UTC | Custo por chamada |
| --- | --- | --- | --- |
| Cotações | 120 ativos | 1.200 ativos | Quantidade de tickers únicos, máximo 10 |
| Dividendos | 30 ativos | 300 ativos | 1 ticker |

Os limites são por usuário e tipo de consulta, inclusive em cache, em janelas fixas. A tabela privada armazena no máximo duas linhas por perfil, removidas junto com o perfil. Uma transação curta bloqueia a linha durante a verificação e o incremento, sem chamadas externas dentro da transação. Não há contador em memória usado para autorização.

A função pública é SECURITY INVOKER e chama uma função privada SECURITY DEFINER com `search_path` fixo e `auth.uid()` obrigatório. O cliente pode somente consumir a própria cota; não escolhe outro usuário, não lê o contador nem o reinicia. Chamar a RPC diretamente apenas gasta a própria cota e não emite autorização reutilizável para a BRAPI. A função privada de cadastro continua sem EXECUTE para clientes.

Se a RPC estiver ausente ou indisponível, a API responde 503 e não chama a BRAPI. Limite atingido retorna 429 e `Retry-After`. São limites do aplicativo, não uma garantia de teto global de faturamento do provedor; a cota contratada da BRAPI continua independente. Preview e produção usando o mesmo projeto Supabase compartilham a cota por usuário.

## Cache e provedor

Cache por ticker e tipo: 60 segundos para cotações, 21.600 segundos para dividendos. Usa `@vercel/functions` 3.9.8, com chave versionada e SHA-256; a chave também identifica este projeto porque caches Hobby podem ser compartilhados pela equipe. TTL é verificado na aplicação, inclusive se o armazenamento mantiver um item antigo. Não se armazenam respostas de erro ou informações do usuário.

O Runtime Cache é regional e pode descartar itens; fora de um runtime com cache disponível, o pacote pode usar memória local. Falha ou demora do cache não remove a exigência de sessão/cota. Requisições simultâneas iguais na mesma instância compartilham a chamada ao provedor; não existe trava global contra todas as consultas simultâneas de instâncias distintas.

Cada ativo é consultado individualmente na BRAPI, evitando depender de suporte do plano a lotes. O token existente `BRAPI_TOKEN` fica somente no servidor, em cabeçalho, sem URL ou resposta ao navegador. Há limites de tamanho/formato de tickers, timeout de Auth/contador/provedor, validação de payload e mensagens sem detalhes internos. Campo de dividendos ausente é erro; somente uma lista vazia explícita significa ausência de registros.

Respostas HTTP usam `private, no-store` e `Vercel-CDN-Cache-Control: no-store`. Assim o CDN não entrega resultados pulando a verificação de sessão. A resposta inclui horário de consulta e TTL; esse horário não é o horário do último negócio na bolsa.

## Implantação

1. Aplicar a migração `20260917040547_protect_market_api.sql` inteira em uma transação. Ela depende da migração de cadastro já aplicada e não modifica carteiras ou convites.
2. Conferir permissões com `supabase/verification/market-api.sql` e executar o verificador de segurança.
3. Publicar as duas rotas e o novo cliente juntos. Se o conector atribuir outra versão à migração, alinhar o nome do arquivo ao registro remoto antes do próximo deploy de banco.
4. Verificar 401 sem sessão e consultar ativos com uma conta de teste autenticada. Confirmar erros visíveis e reutilização do cache.

Não reverta para as rotas públicas antigas em caso de problema. Mantenha o bloqueio e corrija a configuração. Contadores não precisam ser apagados durante rollback.

## Validação

`npm test` verifica handlers, cliente, avisos de interface e regressões anteriores. `npm run test:db`, com `LOCAL_TEST_DATABASE_URL` local, verifica a migração, permissões, janelas e concorrência real entre conexões PostgreSQL. Os testes usam dados fictícios, com banco separado e sem chamadas reais à BRAPI.

O cadastro com confirmação de email e login da rodada anterior já foi validado pelo usuário em produção, e confirmado no banco em 17/09/2026. Essa validação não substitui o teste autenticado das novas APIs após publicação.

Referências: [Supabase JWT](https://supabase.com/docs/guides/auth/jwts), [Runtime Cache](https://vercel.com/docs/caching/runtime-cache), [BRAPI](https://brapi.dev/docs/acoes).

Validação local final: **52 testes passaram**, em Node 22.23.2 e PostgreSQL 17.10, com `--experimental-test-isolation=none` e `KEEP_TEST_DATABASE=1` por restrições do ambiente Windows. Importação dos handlers reais também passou.
