# Importação de movimentações B3

Compras de renda variável e créditos de **Desdobro** são processados. A quantidade do desdobro no arquivo representa unidades adicionais: aumenta a posição sem gerar aporte, alterar compras passadas ou aumentar o custo. O preço médio é recalculado pelo custo das compras dividido pela quantidade ajustada.

Renda fixa, saídas, empréstimos, transferências sem preço, direitos de subscrição e atualizações de posição não são somados à carteira. A prévia e o resultado informam as linhas não processadas. O painel identifica o patrimônio estimado de renda variável; não representa todos os produtos do extrato. Arquivos com vendas ou outros eventos ainda não suportados podem exigir conciliação adicional. Nenhum provento é inferido de uma linha que não representa pagamento.

## Reimportação

A operação `import_b3` grava compras, recibos de origem, desdobramentos e saldos na mesma transação, sob bloqueio da conta. A repetição do mesmo arquivo, inclusive com outro identificador de pedido ou outra ordem de linhas, não duplica dados.

Uma compra é identificada por instituição normalizada, ativo, data, quantidade, preço e ocorrência dentro do grupo de linhas iguais. Duas compras idênticas no mesmo arquivo são preservadas. Use extratos completos de cada dia: o arquivo não fornece um identificador único por negócio, portanto um fragmento de um dia não permite distinguir uma compra nova de outra idêntica já importada. Alterações de nome da instituição além da pontuação também exigem conferência.

Compras existentes na data da migração podem ser associadas uma a uma à primeira reimportação quando ativo, data, quantidade e preço coincidem exatamente. Seus IDs e valores são preservados. Novos aportes manuais não são automaticamente associados; evite registrar manualmente uma compra que será importada. Duplicações anteriores à migração não são apagadas automaticamente.

Desdobros são agrupados por instituição, ativo e data. Uma reimportação com outra quantidade para esse mesmo evento é recusada. O histórico precisa conter compras anteriores ao evento. Isso não comprova por si só que todo o histórico de custódia foi fornecido.

## Exclusões

Excluir uma compra anterior a um desdobramento é bloqueado para não deixar unidades sem base histórica. A mensagem orienta remover o ativo e reimportar seu histórico completo corrigido. A exclusão de compras posteriores mantém o evento. Remover o ativo ou resetar a conta limpa também seus recibos e desdobramentos, permitindo reimportação. As outras contas não são alteradas.

## Implantação e validação

Aplicar `20260918023132_b3_splits_and_reconciliation.sql` antes do frontend. A assinatura pública da operação anterior é preservada; aportes manuais continuam usando `add`. As tabelas auxiliares ficam no schema privado, com RLS e sem acesso direto. As gravações em aportes e carteira passam exclusivamente pela operação atômica.

Os testes com PostgreSQL local cobrem conciliação do legado, preservação de custo, multiplicidade, reimportação, concorrência, rollback, exclusões, reset, autenticação e isolamento entre contas. Dados pessoais e extratos reais não fazem parte dos testes versionados.
