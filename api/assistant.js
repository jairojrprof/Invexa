export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' })

  // Valida token do usuário
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'não autenticado' })
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    const { error } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
    if (error) return res.status(401).json({ error: 'sessão inválida' })
  } catch(e) {}

  const { mensagem, historico, carteira, perfil } = req.body
  if (!mensagem || typeof mensagem !== 'string' || mensagem.trim().length === 0)
    return res.status(400).json({ error: 'mensagem obrigatória' })
  if (mensagem.length > 2000)
    return res.status(400).json({ error: 'mensagem muito longa' })

  const GEMINI_KEY = process.env.GEMINI_KEY
  if (!GEMINI_KEY) return res.status(500).json({ error: 'chave Gemini não configurada' })

  try {
    const contexto = `Você é o assistente financeiro pessoal do Invexa, app brasileiro de gestão de investimentos. Responda sempre em português brasileiro, de forma próxima e prestativa — como um consultor de confiança. Use os dados reais da carteira nas respostas. Nunca seja genérico. Os preços podem estar desatualizados — use como referência e deixe isso claro quando relevante.

PERFIL DO INVESTIDOR:
- Objetivo: ${perfil?.objetivo || 'não informado'}
- Horizonte: ${perfil?.horizonte || 'não informado'}
- Tolerância a risco: ${perfil?.risco || 'não informado'}
- Aporte mensal disponível: ${perfil?.aporte_mensal ? 'R$ ' + perfil.aporte_mensal : 'não informado'}
- Observações: ${perfil?.observacoes || 'nenhuma'}

CARTEIRA ATUAL:
${carteira || 'nenhum ativo cadastrado ainda — oriente o usuário a importar o extrato B3 ou registrar aportes manualmente'}`

    // Monta histórico sem incluir a mensagem atual
    const messages = []
    if (Array.isArray(historico) && historico.length) {
      historico.slice(-8).forEach(h => {
        if (h?.role && h?.conteudo) {
          messages.push({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: String(h.conteudo).slice(0, 2000) }]
          })
        }
      })
    }
    messages.push({ role: 'user', parts: [{ text: mensagem.trim() }] })

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: contexto }] },
        contents: messages,
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
      })
    })

    const data = await response.json()

    if (!response.ok) {
      const msg = data.error?.message || 'erro do provedor'
      if (response.status === 401 || response.status === 403) return res.status(502).json({ error: 'credencial Gemini inválida', upstreamStatus: response.status })
      if (response.status === 404) return res.status(502).json({ error: 'modelo Gemini não disponível', upstreamStatus: response.status })
      if (response.status === 429) return res.status(502).json({ error: 'limite de requisições atingido, tente em alguns instantes', upstreamStatus: response.status })
      return res.status(502).json({ error: msg, upstreamStatus: response.status })
    }

    const reason = data.candidates?.[0]?.finishReason
    if (reason === 'SAFETY') return res.status(200).json({ resposta: 'Não consigo responder a essa pergunta. Tente reformular.' })
    if (reason === 'RECITATION' || reason === 'OTHER') return res.status(502).json({ error: 'resposta bloqueada pelo provedor' })

    const parts = data.candidates?.[0]?.content?.parts || []
    const text = parts.filter(p => p.text && !p.thought).map(p => p.text).join('')
    if (!text) return res.status(502).json({ error: 'resposta vazia do provedor' })

    res.status(200).json({ resposta: text.trim() })
  } catch(e) {
    res.status(500).json({ error: 'erro interno: ' + e.message })
  }
}
