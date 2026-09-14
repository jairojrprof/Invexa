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
${carteira || 'nenhum ativo cadastrado ainda — oriente o usuário a importar o extrato B3 ou registrar aportes'}`

    // Monta histórico incluindo contexto como primeira mensagem
    const messages = [{ role: 'user', parts: [{ text: contexto + '\n\nEntendido. Estou pronto para ajudar com sua carteira.' }] }, { role: 'model', parts: [{ text: 'Entendido! Estou pronto para ajudar com sua carteira e investimentos.' }] }]

    if (historico && historico.length) {
      historico.slice(-8).forEach(h => {
        messages.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.conteudo }] })
      })
    }
    messages.push({ role: 'user', parts: [{ text: mensagem }] })

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
      })
    })

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error('Gemini response:', JSON.stringify(data))
      return res.status(500).json({ error: 'sem resposta da IA', details: data.error?.message })
    }
    res.status(200).json({ resposta: text.trim() })
  } catch(e) {
    res.status(500).json({ error: 'erro no assistente: ' + e.message })
  }
}
