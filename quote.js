export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { tickers } = req.query
  if (!tickers) return res.status(400).json({ error: 'tickers obrigatório' })
  try {
    const r = await fetch(`https://brapi.dev/api/quote/${tickers}?token=${process.env.BRAPI_TOKEN}`)
    res.status(200).json(await r.json())
  } catch(e) { res.status(500).json({ error: 'erro ao buscar cotações' }) }
}
