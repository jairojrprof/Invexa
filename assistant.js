export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' })

  const { mensagem, historico, carteira, perfil } = req.body
  if (!mensagem) return res.status(400).json({ error: 'mensagem obrigatória' })

  try {
    // Monta contexto completo para a IA
    const contexto = `Você é o assistente financeiro pessoal do Invexa, um app brasileiro de gestão de investimentos.
Você conhece a carteira e o perfil do investidor em detalhes. Responda sempre em português brasileiro, de forma próxima, clara e prestativa — como um consultor financeiro de confiança, não como um robô.
Seja direto, específico e use os dados reais da carteira nas respostas.
Nunca dê respostas genéricas — sempre contextualize com os ativos do usuário.

PERFIL DO INVESTIDOR:
- Objetivo: ${perfil?.objetivo || 'não informado'}
- Horizonte: ${perfil?.horizonte || 'não informado'}
- Tolerância a risco: ${perfil?.risco || 'não informado'}
- Aporte mensal disponível: ${perfil?.aporte_mensal ? 'R$ ' + perfil.aporte_mensal : 'não informado'}
- Observações: ${perfil?.observacoes || 'nenhuma'}

CARTEIRA ATUAL:
${carteira || 'nenhum ativo cadastrado ainda'}

Responda de forma completa mas objetiva. Se o usuário perguntar sobre um ativo específico, analise no contexto da carteira dele. Se perguntar sobre estratégia, considere o perfil e os ativos que ele já tem.`

    // Monta histórico de conversa
    const messages = []
    if (historico && historico.length) {
      historico.slice(-10).forEach(h => {
        messages.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.conteudo }] })
      })
    }
    messages.push({ role: 'user', parts: [{ text: mensagem }] })

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_KEY}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: contexto }] },
        contents: messages,
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 }
      })
    })

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return res.status(500).json({ error: 'sem resposta da IA' })
    res.status(200).json({ resposta: text.trim() })
  } catch(e) {
    res.status(500).json({ error: 'erro no assistente: ' + e.message })
  }
}
