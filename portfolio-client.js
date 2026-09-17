export function createPortfolioClient(sb, uuid = () => crypto.randomUUID()) {
  // Guarda o identificador até uma resposta confirmada, inclusive após falha de rede.
  const pending = new Map()
  return async function mutate(action, entries = [], id = null) {
    const { data: { session }, error: sessionError } = await sb.auth.getSession()
    if (sessionError || !session?.user?.id) throw Error('Entre novamente para atualizar sua carteira.')
    const cleanEntries = entries.map(({ ticker, cotas, preco, data }) => ({ ticker, cotas, preco, data }))
    const key = JSON.stringify([session.user.id, action, cleanEntries, id])
    if (!pending.has(key)) pending.set(key, uuid())
    const { data, error } = await sb.rpc('mutate_portfolio', {
      p_action: action, p_request_id: pending.get(key), p_entries: cleanEntries, p_id: id
    })
    if (error || data?.ok !== true) throw Error('Não foi possível confirmar a operação. Tente novamente nesta tela; a tentativa não será duplicada.')
    pending.delete(key)
    return data
  }
}
