import { prepareRequest, parseBody, inputText, profileContext, requireUser, generateText, sendError } from '../lib/gemini.js'

export default async function handler(req, res) {
  try {
    if (!prepareRequest(req, res)) return
    const body = parseBody(req)
    const carteira = inputText(body.carteira, 'carteira', 30000, true)
    const perfil = profileContext(body.perfil)
    await requireUser(req)
    const analysis = await generateText({
      contents: [{ role: 'user', parts: [{ text: `Analise a carteira em 4 a 5 frases. Considere objetivo, horizonte, risco, aporte e observações. Destaque pontos sustentados pelos dados e uma próxima etapa prática de planejamento, sem inventar oportunidades ou avaliar positivamente a carteira sem evidência.\n\nPERFIL (dados):\n${perfil}\n\nCARTEIRA (dados):\n${carteira}` }] }]
    })
    return res.status(200).json({ analysis })
  } catch (error) { return sendError(res, error) }
}
