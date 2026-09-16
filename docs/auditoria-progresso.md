# Retomada da auditoria do Invexa v3

Base: auditoria de 15/09/2026 e código do GitHub no commit `54970b26e046be7c3034c7b8135645d666df2085`.

## Primeira rodada — 16/09/2026

- Mensagens do chat passam a ser criadas com `textContent`. HTML recebido do usuário, do histórico ou da IA aparece como texto, preservando quebras de linha.
- Removidos os históricos artificiais de patrimônio e dividendos. A interface informa que esses históricos ainda não estão disponíveis.
- Mantida a composição atual da carteira. A legenda é limpa ao esvaziar a carteira.
- Adicionados testes de regressão para essas alterações, executáveis com `npm test` em Node 22.

## Pendências da auditoria

1. Auditoria do esquema e das políticas realizada pelo conector em 16/09/2026: RLS ativa nas sete tabelas; leituras privadas isoladas nos testes. Acesso público aos convites e edição do plano pelo usuário foram corrigidos, testados em banco isolado e bloqueados em produção. Migração aplicada e permissões conferidas em 16/09/2026. Falta validar cadastro e confirmação de email com conta de teste. Detalhes em [cadastro-seguro.md](cadastro-seguro.md).
2. Proteger as APIs de cotação e dividendos com autenticação, limites de uso e cache.
3. Revisar os demais usos de `innerHTML`, especialmente tickers, atributos de eventos, prévia de importação e mensagens de erro. A correção desta rodada é específica ao chat.
4. Tornar aportes, carteira e importações transacionais; verificar erros antes de confirmar sucesso.
5. Corrigir elegibilidade de dividendos, período de 12 meses, vendas e eventos de movimentação.
6. Corrigir a ponderação do DY e a nomenclatura de retorno total/real.
7. Implementar históricos verdadeiros, normalização e prevenção de duplicidade na importação B3.
8. Evoluir a organização dos módulos após corrigir segurança e integridade dos dados.

## Limites da validação

Na primeira rodada, os sete testes de interface passaram em Node 24.19.0. Na rodada de cadastro/segurança, a suíte ampliada passou com 31 testes em Node 22.23.2 e PostgreSQL 17.10, incluindo concorrência real no banco isolado. Foi usada execução sem isolamento em subprocessos por restrições do ambiente local.

Os testes de interface usam um DOM mínimo e um substituto do Chart.js. Os testes SQL usam PostgreSQL real, dados fictícios e uma representação mínima de Auth. Após a implantação, as telas públicas de login/cadastro foram verificadas no navegador e os endpoints/permissões foram conferidos. Login/confirmação de email no Auth hospedado, telas autenticadas, BRAPI e Gemini ainda precisam de validação. Os cálculos financeiros e os demais pontos de segurança continuam pendentes.
