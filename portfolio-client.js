export function createPortfolioClient(sb, uuid = () => crypto.randomUUID()) {
  // Guarda o identificador até uma resposta confirmada, inclusive após falha de rede.
  const pending = new Map()
  return async function mutate(action, entries = [], id = null) {
    const { data: { session }, error: sessionError } = await sb.auth.getSession()
    if (sessionError || !session?.user?.id) throw Error('Entre novamente para atualizar sua carteira.')
    const cleanEntries = entries.map(({ ticker, cotas, preco, data, kind, instituicao }) => ({
      ticker, cotas, preco, data, ...(action === 'import_b3' ? { kind, instituicao } : {})
    }))
    const key = JSON.stringify([session.user.id, action, cleanEntries, id])
    if (!pending.has(key)) pending.set(key, uuid())
    const { data, error } = await sb.rpc('mutate_portfolio', {
      p_action: action, p_request_id: pending.get(key), p_entries: cleanEntries, p_id: id
    })
    if (error || data?.ok !== true) {
      const messages = {
        B3_SPLIT_CONFLICT: 'Este desdobramento já foi importado com outra quantidade. Confira o extrato completo dessa data antes de continuar.',
        B3_SPLIT_WITHOUT_HISTORY: 'Faltam compras anteriores a um desdobramento. Importe também o histórico anterior do ativo.',
        B3_PURCHASE_HAS_SPLIT: 'Esta compra faz parte de um desdobramento. Para corrigir o histórico, remova o ativo e reimporte seu extrato completo.'
      }
      throw Error(messages[error?.message] || 'Não foi possível confirmar a operação. Tente novamente nesta tela; a tentativa não será duplicada.')
    }
    pending.delete(key)
    return data
  }
}
