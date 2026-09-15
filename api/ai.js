export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' })

  // Valida token do usuário no Supabase antes de chamar o Google
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'não autenticado' })
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    const { error } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
    if (error) return res.status(401).json({ error: 'sessão inválida' })
  } catch(e) {}

  const { carteira, perfil } = req.body
  if (!carteira) return res.status(400).json({ error: 'carteira obrigatória' })

  const GEMINI_KEY = process.env.GEMINI_KEY
  if (!GEMINI_KEY) return res.status(500).json({ error: 'chave Gemini não configurada' })

  try {
    const perfilCtx = perfil
      ? `Objetivo: ${perfil.objetivo || 'não informado'}, Horizonte: ${perfil.horizonte || 'não informado'}, Risco: ${perfil.risco || 'não informado'}, Aporte mensal: ${perfil.aporte_mensal ? 'R$ ' + perfil.aporte_mensal : 'não informado'}, Observações: ${perfil.observacoes || 'nenhuma'}`
      : 'Perfil não configurado — responda de forma genérica'

    const prompt = `Você é analista de investimentos brasileiro experiente. Analise esta carteira considerando o perfil. Responda em 4-5 frases diretas e personalizadas: mencione ativos específicos, pontos positivos, pontos de atenção e uma sugestão prática alinhada ao perfil. Seja próximo e claro — nunca genérico. Os preços podem estar desatualizados, use como referência.\n\n${perfilCtx}\n\nCarteira: ${carteira}`

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.7 }
      })
    })

    const data = await response.json()

    if (!response.ok) {
      const msg = data.error?.message || 'erro do provedor'
      if (response.status === 401 || response.status === 403) return res.status(502).json({ error: 'credencial Gemini inválida', upstreamStatus: response.status })
      if (response.status === 404) return res.status(502).json({ error: 'modelo Gemini não disponível', upstreamStatus: response.status })
      if (response.status === 429) return res.status(502).json({ error: 'limite de requisições atingido', upstreamStatus: response.status })
      return res.status(502).json({ error: msg, upstreamStatus: response.status })
    }

    const reason = data.candidates?.[0]?.finishReason
    if (reason === 'SAFETY') return res.status(200).json({ analysis: 'Não foi possível gerar análise para esta carteira.' })
    if (reason === 'RECITATION' || reason === 'OTHER') return res.status(502).json({ error: 'resposta bloqueada pelo provedor' })

    const parts = data.candidates?.[0]?.content?.parts || []
    const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('')
    if (!text) return res.status(502).json({ error: 'resposta vazia do provedor' })

    res.status(200).json({ analysis: text.trim() })
  } catch(e) {
    res.status(500).json({ error: 'erro interno: ' + e.message })
  }
}
