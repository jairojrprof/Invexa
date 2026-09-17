# Importação e carteira após reset

## Causa confirmada

O reset marcava a carteira como inativa, mas preservava a chave única `(user_id,ticker)`. A importação procurava apenas ativos carregados na tela, tentava inserir novamente o mesmo ticker e ignorava o objeto `error` devolvido pelo Supabase. Assim o histórico era gravado e o erro da posição era tratado como sucesso. Em produção foram observados 32 aportes, dez posições inativas e nenhuma ativa.

## Correção

`mutate_portfolio` grava compras e reconstrói as posições afetadas numa única transação. O conflito da chave única atualiza e reativa a posição existente, sem somar o saldo antigo do reset. O mesmo caminho atende aportes manuais, exclusão de aporte/ativo e reset; excluir o último aporte também desativa o ativo. Falha em qualquer gravação desfaz a operação inteira.

A função privada usa a identidade da sessão, exige perfil existente, trava a linha do perfil para serializar operações da mesma conta e fixa `search_path`. O wrapper público é invoker; apenas authenticated pode executá-lo. Nenhum parâmetro permite escolher outro usuário. As políticas e permissões preexistentes das tabelas de aportes/carteira são mantidas; clientes antigos ainda devem recarregar a página para usar a operação transacional.

Cada tentativa tem UUID próprio. Repetir o mesmo pedido após falha de rede devolve o resultado já confirmado sem gravar novamente. O registro privado guarda somente hash SHA-256 do conteúdo, resultado e identificadores, sem uma segunda cópia do extrato. O cliente retém o UUID até confirmar o resultado e bloqueia cliques concorrentes. Essa proteção dura na página atual: não é deduplicação geral de arquivos importados novamente em outra sessão.

A migração recupera somente posições ausentes ou inativas que tenham compras válidas no histórico. Calcula quantidade e preço médio pelos aportes existentes; não recria aportes nem altera posições já ativas. Mantém o modelo atual de compras: tratamento completo de vendas/eventos B3 e normalização de números/datas do arquivo ficam fora desta correção.

## Validação

Suíte ampliada com PostgreSQL 17 real: conflito após reset, recuperação sem duplicar histórico, reimportação, preço médio ponderado, rollback de lote por falha na carteira, idempotência, concorrência, isolamento entre contas, validação de entradas, exclusão do último aporte e reset. Testes de interface verificam erros retornados, preservação da prévia, texto seguro e bloqueio de duplo envio.

Aplicar a migração antes de publicar o cliente; verificar RLS, privilégios e comparação das posições recuperadas com a soma dos aportes. Após publicar, recarregar o aplicativo. Não é necessário importar novamente o extrato já recebido.
