export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' })
  const { carteira, perfil } = req.body
  if (!carteira) return res.status(400).json({ error: 'carteira obrigatória' })
  try {
    const perfilCtx = perfil ? `Perfil: objetivo=${perfil.objetivo}, horizonte=${perfil.horizonte}, risco=${perfil.risco}, aporte mensal=R$${perfil.aporte_mensal||0}` : 'Perfil não configurado'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Você é analista de FIIs brasileiro. Analise esta carteira considerando o perfil do investidor. Responda em 4-5 frases diretas e personalizadas: mencione ativos específicos, pontos positivos, pontos de atenção e uma sugestão prática alinhada ao perfil. Seja próximo e claro, não genérico.\n\n${perfilCtx}\n\nCarteira: ${carteira}` }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
      })
    })
    const d = await r.json()
    const text = d.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return res.status(500).json({ error: 'sem resposta' })
    res.status(200).json({ analysis: text.trim() })
  } catch(e) { res.status(500).json({ error: 'erro na análise IA' }) }
}
