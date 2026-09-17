export function createMarketClient(supabase, fetcher = globalThis.fetch) {
  let cooldownUntil = 0, cooldownError = null
  async function get(path, params) {
    if (Date.now() < cooldownUntil) throw cooldownError
    const { data, error } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (error || !token) throw new Error('Sua sessão expirou. Entre novamente na conta.')
    const r = await fetcher(`${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(35000), cache: 'no-store'
    })
    let body
    try { body = await r.json() } catch { throw new Error('O servidor retornou uma resposta inválida.') }
    const responseError = new Error(typeof body?.error === 'string' ? body.error : 'Não foi possível consultar os ativos.')
    responseError.code = body?.code
    if (r.status === 429 || (r.status === 503 && r.headers?.get('Retry-After'))) {
      const delay = Number(r.headers?.get('Retry-After'))
      cooldownUntil = Date.now() + Math.max(1, Math.min(Number.isFinite(delay) && delay > 0 ? delay : 60, 86400)) * 1000
      cooldownError = responseError
    }
    if (!r.ok || body?.error) throw responseError
    return body
  }
  return {
    async quote(tickers) {
      const list = [...new Set(String(tickers).split(',').map(t => t.trim().toUpperCase()).filter(Boolean))]
      const results = []
      for (let i = 0; i < list.length; i += 10) {
        const data = await get('/api/quote', { tickers: list.slice(i, i + 10).join(',') })
        if (!Array.isArray(data?.results)) throw new Error('Cotações indisponíveis.')
        results.push(...data.results)
      }
      return { results }
    },
    async dividends(ticker) {
      const data = await get('/api/dividends', { ticker })
      if (!Array.isArray(data?.dividends)) throw new Error('Dividendos indisponíveis.')
      return data
    }
  }
}
