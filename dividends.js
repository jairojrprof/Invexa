// Vercel Serverless Function — busca histórico de dividendos na Brapi
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'ticker obrigatório' })

  try {
    const url = `https://brapi.dev/api/quote/${ticker}/dividends?token=${process.env.BRAPI_TOKEN}`
    const response = await fetch(url)
    const data = await response.json()
    res.status(200).json(data)
  } catch(e) {
    res.status(500).json({ error: 'erro ao buscar dividendos' })
  }
}
