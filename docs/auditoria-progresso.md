# Retomada da auditoria do Invexa v3

Base: auditoria de 15/09/2026 e código do GitHub no commit `54970b26e046be7c3034c7b8135645d666df2085`.

## Primeira rodada — 16/09/2026

- Mensagens do chat passam a ser criadas com `textContent`. HTML recebido do usuário, do histórico ou da IA aparece como texto, preservando quebras de linha.
- Removidos os históricos artificiais de patrimônio e dividendos. A interface informa que esses históricos ainda não estão disponíveis.
- Mantida a composição atual da carteira. A legenda é limpa ao esvaziar a carteira.
- Adicionados testes de regressão para essas alterações, executáveis com `npm test` em Node 22.

## Pendências da auditoria

1. Obter o esquema, as políticas RLS, funções e triggers do Supabase para verificar isolamento entre usuários e cadastro por convite. Esses elementos não estão nos arquivos de código do repositório. Não presumir que as políticas estejam ausentes ou incorretas no banco real.
2. Proteger as APIs de cotação e dividendos com autenticação, limites de uso e cache.
3. Revisar os demais usos de `innerHTML`, especialmente tickers, atributos de eventos, prévia de importação e mensagens de erro. A correção desta rodada é específica ao chat.
4. Tornar aportes, carteira e importações transacionais; verificar erros antes de confirmar sucesso.
5. Corrigir elegibilidade de dividendos, período de 12 meses, vendas e eventos de movimentação.
6. Corrigir a ponderação do DY e a nomenclatura de retorno total/real.
7. Implementar históricos verdadeiros, normalização e prevenção de duplicidade na importação B3.
8. Evoluir a organização dos módulos após corrigir segurança e integridade dos dados.

## Limites da validação

Os sete testes passaram no runtime local Node 24.19.0 com `node --test --experimental-test-isolation=none tests/ui.test.mjs`. A execução padrão tentou criar subprocessos e foi bloqueada pelo ambiente local; por isso foi usada a execução sem isolamento em subprocessos. A configuração de produção continua em Node 22 e ainda precisa ser validada nesse ambiente.

Os testes desta rodada usam um DOM mínimo e um substituto do Chart.js. Não verificam login real, Supabase, BRAPI, Gemini ou o visual no navegador. A auditoria de segurança completa e a validação dos cálculos financeiros continuam pendentes.
