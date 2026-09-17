# Avisos de mercado e IA — 17/09/2026

A recuperação da carteira da PR #3 foi aplicada e confirmada pelo usuário: 32 aportes preservados, dez posições ativas e nenhuma divergência contra os agregados do histórico. O novo aviso é independente da importação.

## Evidências

- Contador Supabase: 20 ativos consultados para cotações e 20 para dividendos no dia, dez de cada no último minuto registrado. Abaixo dos limites do Invexa.
- Logs da produção às 15:56 e 15:59 UTC: BRAPI retornou HTTP 429, convertido pela API em 503 `PROVIDER_LIMITED`; outros dividendos retornaram `PROVIDER_ERROR`, cujo status de origem não era distinguido.
- O cliente trocava o motivo do bloqueio por “Limite de consultas atingido” nas tentativas seguintes. O aviso não permitia distinguir BRAPI de limite do usuário.
- IA: `GEMINI_MODEL_NOT_FOUND`, resposta 404 do Gemini. Não há evidência suficiente para dizer qual valor de `GEMINI_MODEL` foi usado em produção ou se o problema é um nome inválido ou indisponibilidade para a conta. O frontend ocultava o diagnóstico com uma mensagem genérica de conexão.
- Inicialização chamava showApp após getSession e outra vez em INITIAL_SESSION. Eventos SIGNED_IN e TOKEN_REFRESHED também disparavam novas consultas e análise de IA.

## Ajustes preparados

O cliente preserva a mensagem e o código de erro durante a espera. O servidor respeita Retry-After da BRAPI e distingue autenticação (401), autorização/plano (403) e limite (429), sem expor resposta bruta ou credenciais. Consultas por ativo são sequenciais, com interrupção no primeiro bloqueio e orçamento de tempo para o lote. Dividendos param ao detectar bloqueio do serviço. Cotações são solicitadas antes dos dividendos.

O controle de sessão carrega a conta uma única vez por entrada, ignora notificações repetidas da mesma identidade e agenda consultas fora do callback de Auth. A mensagem específica da IA é exibida como texto.

41 testes de aplicação aprovados em Node 22. Incluem sessão inicial duplicada, renovação, troca de conta ainda na fila, cooldown com origem preservada, parada do lote após 429, Retry-After, 401/403 e mensagem da IA. Não há alteração de banco nesta rodada.

Esses ajustes não aumentam cotas nem garantem liberação do fornecedor. Pendências externas: conferir plano/consumo/renovação da conta BRAPI e o nome do modelo configurado na Vercel. Não substituir modelos automaticamente nem contornar bloqueios com novas chaves. O acesso de navegador às configurações falhou por timeout e o conector de projeto não expõe as variáveis nesta sessão.

Referências: [BRAPI — limites e autenticação](https://brapi.dev/docs/authentication), [BRAPI — limites por plano](https://brapi.dev/faq/quais-as-limitacoes), [Gemini — modelos](https://ai.google.dev/gemini-api/docs/models).
