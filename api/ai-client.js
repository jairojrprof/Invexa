export function createAIClient(supabase, fetcher = globalThis.fetch) {
  async function post(path, body, field) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (sessionError || !token) throw new Error('Sua sessão expirou. Entre novamente na conta.')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45000)
    try {
      const response = await fetcher(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      let data
      try { data = await response.json() }
      catch { throw new Error(`O servidor não retornou uma resposta válida (HTTP ${response.status}).`) }
      if (!response.ok || data?.error) {
        const error = new Error(typeof data?.error === 'string' ? data.error : `Falha na solicitação (HTTP ${response.status}).`)
        error.code = data?.code
        throw error
      }
      if (typeof data?.[field] !== 'string' || !data[field].trim()) throw new Error('A IA retornou uma resposta vazia. Tente novamente.')
      return data
    } catch (error) {
      if (controller.signal.aborted) throw new Error('O tempo de espera acabou. Tente novamente em instantes.')
      if (error instanceof TypeError) throw new Error('Não foi possível contatar o servidor. Verifique sua conexão.')
      throw error
    } finally { clearTimeout(timeout) }
  }
  return {
    ai: (carteira, perfil) => post('/api/ai', { carteira, perfil }, 'analysis'),
    assistant: (mensagem, historico, carteira, perfil) => post('/api/assistant', { mensagem, historico, carteira, perfil }, 'resposta')
  }
}
