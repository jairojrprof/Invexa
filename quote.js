// Vercel Serverless Function — busca cotações na Brapi
// O token fica seguro no servidor, nunca no navegador
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')
  
  const { tickers } = req.query
  if (!tickers) return res.status(400).json({ error: 'tickers obrigatório' })

  try {
    const url = `https://brapi.dev/api/quote/${tickers}?token=${process.env.BRAPI_TOKEN}`
    const response = await fetch(url)
    const data = await response.json()
    res.status(200).json(data)
  } catch(e) {
    res.status(500).json({ error: 'erro ao buscar cotações' })
  }
}
