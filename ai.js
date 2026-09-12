// Vercel Serverless Function — análise IA via Google Gemini (gratuito)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' })

  const { carteira } = req.body
  if (!carteira) return res.status(400).json({ error: 'carteira obrigatória' })

  try {
    const prompt = `Você é um analista de FIIs brasileiro experiente. 
Analise esta carteira de investimentos em exatamente 3 frases curtas e diretas:
1. Um ponto positivo da carteira
2. Um ponto de atenção
3. Uma sugestão prática para o próximo aporte

Carteira: ${carteira}

Responda sem markdown, sem listas, sem títulos. Apenas 3 frases seguidas.`

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
      })
    })

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) return res.status(500).json({ error: 'sem resposta da IA' })
    res.status(200).json({ analysis: text.trim() })
  } catch(e) {
    res.status(500).json({ error: 'erro na análise IA' })
  }
}
