export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' })

  const { carteira, perfil } = req.body
  if (!carteira) return res.status(400).json({ error: 'carteira obrigatória' })

  try {
    const perfilCtx = perfil
      ? `Objetivo: ${perfil.objetivo || 'não informado'}, Horizonte: ${perfil.horizonte || 'não informado'}, Risco: ${perfil.risco || 'não informado'}, Aporte mensal: R$${perfil.aporte_mensal || 0}`
      : 'Perfil não configurado'

    const prompt = `Você é analista de investimentos brasileiro. Analise esta carteira considerando o perfil do investidor. Responda em 4-5 frases diretas e personalizadas: mencione ativos específicos, pontos positivos, pontos de atenção e de sugestões práticas para atingir o objetivo do usuário. Seja próximo e claro.\n\n${perfilCtx}\n\nCarteira: ${carteira}`

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_KEY
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
      })
    })

    const data = await response.json()
    if (data.error) return res.status(500).json({ error: data.error.message })
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return res.status(500).json({ error: 'sem resposta da IA' })
    res.status(200).json({ analysis: text.trim() })
  } catch(e) {
    res.status(500).json({ error: 'erro na análise: ' + e.message })
  }
}
