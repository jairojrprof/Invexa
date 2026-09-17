import { SUPABASE_URL, SUPABASE_KEY } from '../public-config.js'

export class MarketError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message)
    Object.assign(this, { status, code, retryAfter })
  }
}
const fail = (status, code, message, retry) => new MarketError(status, code, message, retry)
export const TTL = { quote: 60, dividends: 21600 }

export function parseTickers(value, kind) {
  if (typeof value !== 'string' || value.length > 129) throw fail(400, 'INVALID_TICKER', 'Informe um código de ativo válido.')
  const list = value.split(',').map(t => t.trim().toUpperCase())
  if (list.length > (kind === 'quote' ? 10 : 1) || list.some(t => !/^[A-Z][A-Z0-9]{3,11}$/.test(t))) {
    throw fail(400, 'INVALID_TICKER', 'Envie até 10 ativos por consulta de cotação ou um ativo por consulta de dividendos.')
  }
  return [...new Set(list)].sort()
}

async function authenticate(req, fetcher) {
  const auth = req.headers?.authorization
  if (typeof auth !== 'string' || auth.length > 8192 || !/^Bearer \S+$/i.test(auth)) {
    throw fail(401, 'AUTH_REQUIRED', 'Entre na sua conta para consultar os ativos.')
  }
  try {
    const r = await fetcher(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: auth }, signal: AbortSignal.timeout(8000)
    })
    if ([401, 403].includes(r.status)) throw fail(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.')
    if (!r.ok) throw Error('auth unavailable')
    const user = await r.json()
    if (!user?.id || user.is_anonymous || !user.email_confirmed_at) throw fail(401, 'AUTH_REQUIRED', 'Entre com uma conta com email confirmado.')
    return auth
  } catch (e) {
    if (e instanceof MarketError) throw e
    throw fail(503, 'AUTH_UNAVAILABLE', 'Não foi possível verificar sua sessão. Tente novamente em instantes.')
  }
}

async function consumeQuota(auth, kind, cost, fetcher) {
  try {
    const r = await fetcher(`${SUPABASE_URL}/rest/v1/rpc/consume_market_quota`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kind: kind, p_cost: cost }), signal: AbortSignal.timeout(8000)
    })
    if ([401, 403].includes(r.status)) throw fail(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.')
    if (!r.ok) throw Error('quota unavailable')
    const data = await r.json()
    if (data?.allowed === false && Number.isInteger(data.retry_after) && data.retry_after > 0) {
      throw fail(429, 'RATE_LIMITED', 'Limite de consultas atingido. Aguarde antes de atualizar novamente.', Math.min(data.retry_after, 86400))
    }
    if (data?.allowed !== true) throw Error('invalid quota response')
  } catch (e) {
    if (e instanceof MarketError) throw e
    // Sem contador compartilhado não se deve chamar o provedor pago.
    throw fail(503, 'LIMITER_UNAVAILABLE', 'As consultas estão temporariamente indisponíveis. Tente novamente em instantes.')
  }
}

function normalizeProvider(data, ticker, kind) {
  if (data?.error || !Array.isArray(data?.results) || data.results.length !== 1) {
    throw fail(502, 'PROVIDER_INVALID_RESPONSE', 'O provedor não retornou dados válidos para o ativo.')
  }
  const item = data.results[0]
  if (item?.symbol !== ticker) throw fail(502, 'PROVIDER_INVALID_RESPONSE', 'O provedor retornou um ativo diferente do solicitado.')
  if (kind === 'quote') {
    if (typeof item.regularMarketPrice !== 'number' || !Number.isFinite(item.regularMarketPrice) || item.regularMarketPrice <= 0 ||
        typeof item.regularMarketChangePercent !== 'number' || !Number.isFinite(item.regularMarketChangePercent)) {
      throw fail(502, 'PROVIDER_INVALID_RESPONSE', 'A cotação do ativo não está disponível.')
    }
    return { symbol: ticker, regularMarketPrice: item.regularMarketPrice, regularMarketChangePercent: item.regularMarketChangePercent }
  }
  const dividends = item.dividendsData?.cashDividends
  if (!Array.isArray(dividends) || dividends.some(d => !d || typeof d.rate !== 'number' || !Number.isFinite(d.rate) || d.rate < 0)) {
    // Campo ausente pode significar plano sem acesso; nunca confundir com lista vazia.
    throw fail(502, 'PROVIDER_INVALID_RESPONSE', 'O histórico de dividendos não está disponível para esse ativo.')
  }
  return { ticker, dividends: dividends.map(d => ({
    rate: d.rate,
    paymentDate: typeof d.paymentDate === 'string' ? d.paymentDate : null,
    lastDatePrior: typeof d.lastDatePrior === 'string' ? d.lastDatePrior : null,
    exDividendDate: typeof d.exDividendDate === 'string' ? d.exDividendDate : null
  })) }
}

async function queryProvider(ticker, kind, fetcher, token, deadline) {
  if (!token) throw fail(503, 'PROVIDER_NOT_CONFIGURED', 'O serviço de cotações ainda não foi configurado.')
  const url = new URL(`https://brapi.dev/api/quote/${ticker}`)
  if (kind === 'dividends') url.searchParams.set('dividends', 'true')
  try {
    const r = await fetcher(url.href, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([AbortSignal.timeout(10000), deadline]) })
    if (r.status === 429) {
      const raw = r.headers?.get('Retry-After')
      const seconds = raw && Number.isFinite(Number(raw)) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000)
      throw fail(503, 'PROVIDER_LIMITED', 'A BRAPI limitou as consultas do serviço. Aguarde a liberação da cota do provedor.', Math.max(1, Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 60, 86400)))
    }
    if (r.status === 401) throw fail(502, 'PROVIDER_AUTH_ERROR', 'A autenticação com a BRAPI precisa ser verificada pelo responsável pelo app.')
    if (r.status === 403) throw fail(502, 'PROVIDER_PLAN_RESTRICTED', 'A BRAPI não autorizou este recurso no plano ou na chave configurada.')
    if (!r.ok) throw fail(502, 'PROVIDER_ERROR', 'O provedor não conseguiu atender à consulta.')
    return normalizeProvider(await r.json(), ticker, kind)
  } catch (e) {
    if (e instanceof MarketError) throw e
    if (['TimeoutError', 'AbortError'].includes(e.name)) throw fail(504, 'PROVIDER_TIMEOUT', 'O provedor demorou para responder. Tente novamente.')
    throw fail(502, 'PROVIDER_ERROR', 'Não foi possível obter os dados do provedor.')
  }
}

export function createMarketHandler(kind, { fetcher = globalThis.fetch, cache, now = Date.now, token = () => process.env.BRAPI_TOKEN?.trim() } = {}) {
  // Coalesce consultas simultâneas na instância; não substitui o limitador.
  const inFlight = new Map()
  async function getAsset(ticker, deadline) {
    const key = `invexa:xxidrfxkykpwacvpdllv:market:v1:${kind}:${ticker}`
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = (async () => {
      let entry
      try { entry = await cache?.get(key) } catch { /* cache é uma otimização */ }
      const age = now() - entry?.fetchedAt
      if (entry?.payload && age >= 0 && age < TTL[kind] * 1000) return entry
      if (deadline.aborted) throw fail(504, 'PROVIDER_TIMEOUT', 'O provedor demorou para responder. Tente novamente.')
      const payload = await queryProvider(ticker, kind, fetcher, token(), deadline)
      entry = { payload, fetchedAt: now() }
      try { await cache?.set(key, entry, { ttl: TTL[kind] }) } catch { /* quota continua obrigatória */ }
      return entry
    })()
    inFlight.set(key, promise)
    try { return await promise } finally { inFlight.delete(key) }
  }
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
    res.setHeader('Allow', 'GET')
    const deadline = AbortSignal.timeout(30000)
    try {
      if (req.method !== 'GET') throw fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido. Use GET.')
      const auth = await authenticate(req, fetcher)
      const tickers = parseTickers(req.query?.[kind === 'quote' ? 'tickers' : 'ticker'], kind)
      await consumeQuota(auth, kind, tickers.length, fetcher)
      const entries = []
      for (const ticker of tickers) entries.push(await getAsset(ticker, deadline))
      const meta = { fetchedAt: new Date(Math.min(...entries.map(e => e.fetchedAt))).toISOString(), cacheTtlSeconds: TTL[kind] }
      return res.status(200).json(kind === 'quote' ? { results: entries.map(e => e.payload), meta } : { ...entries[0].payload, meta })
    } catch (e) {
      const known = e instanceof MarketError
      if (known && e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter))
      // Não registrar Authorization, tokens ou mensagens brutas do provedor.
      if (!known || e.status >= 500) console.error('[Invexa mercado]', { kind, code: known ? e.code : 'INTERNAL_ERROR' })
      return res.status(known ? e.status : 500).json({ error: known ? e.message : 'Falha ao consultar os ativos.', code: known ? e.code : 'INTERNAL_ERROR' })
    }
  }
}
