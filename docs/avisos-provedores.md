# Consultas de mercado no plano gratuito — 17/09/2026

## Problema e evidências

Após a correção da importação (PR #3), as posições reapareceram. A atualização de 18:34 UTC ainda recebeu HTTP 429 da BRAPI, identificado como PROVIDER_LIMITED. O contador interno marcava 30 unidades de cotação e 30 de dividendos no dia, abaixo dos limites locais. O usuário confirmou a chave BRAPI e reimplantou; o painel da BRAPI mostrava plano gratuito e 16/15.000 consultas no momento do print. O motivo específico do 429 do fornecedor não foi comprovado.

A página disparava consultas de cotações e dividendos em paralelo, e eventos repetidos de sessão podiam recarregar a carteira. A BRAPI não inclui dividendos no plano gratuito.

## Comportamento final

- A página não solicita mais dividendos à BRAPI. O endpoint legado exige sessão e retorna 403 DIVIDENDS_UNAVAILABLE sem consumir cota nem consultar o fornecedor.
- Campos de proventos recebidos e estimativas exibem indisponibilidade, não zero. Nenhum dado persistido foi removido ou alterado. A importação de proventos não faz parte desta entrega.
- Cache de preços por ativo aumentado de 60 segundos para uma hora, com cópia limitada a 512 ativos em memória para tolerar falha do cache regional.
- Consultas externas sequenciais, separadas por no mínimo 1,2 segundo por instância. Chamadas simultâneas para o mesmo ativo compartilham a busca.
- HTTP 429 interrompe o lote e gera pausa conforme Retry-After; se ausente/inválido, cinco minutos. A pausa é compartilhada pelo cache regional quando disponível e mantida localmente. Não há retentativa automática.
- O cliente preserva o motivo da BRAPI durante a pausa. Autenticação (401), autorização/plano (403) e limite (429) têm mensagens distintas.
- Sessão inicial e notificações repetidas da mesma conta não repetem o carregamento. Atualizações concorrentes na página compartilham a busca.
- A interface informa quando os preços foram consultados (não o horário da negociação) e a reutilização por até uma hora.
- Auth e cotas internas continuam obrigatórias mesmo quando a cotação está em cache. Nenhuma chave é exposta ao cliente.

## Validação e limites

46 testes de aplicação passaram em Node 22.23.2 e Node 24.19.0. Cobrem autenticação, cotas, cache, intervalo entre ativos concorrentes, bloqueio compartilhado, desativação de dividendos, metadados na interface e ausência de zeros fictícios. Sem alteração de banco.

O cache é regional e descartável. O espaçamento é por instância, não uma fila global distribuída; muitas instâncias ainda podem coincidir. Esta mudança reduz consumo e rajadas, mas não garante liberação de um bloqueio já aplicado pela BRAPI ou franquia mensal ilimitada. O teste autenticado de produção requer uma atualização na conta após a publicação.

A falha independente da IA permanece: GEMINI_MODEL_NOT_FOUND / HTTP 404. O usuário informou GEMINI_MODEL=gemini-2.5-flash; esta entrega não troca o modelo nem altera credenciais. A mensagem específica agora fica visível como texto.

Referências: [BRAPI — plano gratuito](https://brapi.dev/faq/o-plano-gratuito-tem-limitacoes-importantes), [BRAPI — autenticação](https://brapi.dev/docs/authentication).
