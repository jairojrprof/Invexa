export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' })

  const { mensagem, historico, carteira, perfil } = req.body
  if (!mensagem) return res.status(400).json({ error: 'mensagem obrigatória' })

  try {
    const contexto = `Você é o assistente financeiro pessoal do Invexa, app brasileiro de gestão de investimentos. Responda sempre em português brasileiro, de forma próxima e prestativa — como um consultor de confiança. Use os dados reais da carteira nas respostas. Nunca seja genérico.

PERFIL DO INVESTIDOR:
- Objetivo: ${perfil?.objetivo || 'não informado'}
- Horizonte: ${perfil?.horizonte || 'não informado'}
- Tolerância a risco: ${perfil?.risco || 'não informado'}
- Aporte mensal: ${perfil?.aporte_mensal ? 'R$ ' + perfil.aporte_mensal : 'não informado'}
- Observações: ${perfil?.observacoes || 'nenhuma'}

CARTEIRA ATUAL:
${carteira || 'nenhum ativo cadastrado ainda'}`

    const messages = []
    if (historico && historico.length) {
      historico.slice(-8).forEach(h => {
        messages.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.conteudo }] })
      })
    }
    messages.push({ role: 'user', parts: [{ text: mensagem }] })

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_KEY
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: contexto }] },
        contents: messages,
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
      })
    })

    const data = await response.json()
    if (data.error) return res.status(500).json({ error: data.error.message })
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return res.status(500).json({ error: 'sem resposta da IA' })
    res.status(200).json({ resposta: text.trim() })
  } catch(e) {
    res.status(500).json({ error: 'erro no assistente: ' + e.message })
  }
}
