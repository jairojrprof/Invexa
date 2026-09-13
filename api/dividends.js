export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { ticker } = req.query
  if (!ticker) return res.status(400).json({ error: 'ticker obrigatório' })
  try {
    const r = await fetch(`https://brapi.dev/api/quote/${ticker}?token=${process.env.BRAPI_TOKEN}&dividends=true`)
    const data = await r.json()
    // Normaliza para o formato esperado pelo frontend
    const divs = data.results?.[0]?.dividendsData?.cashDividends || []
    res.status(200).json({ ticker, dividends: divs })
  } catch(e) { res.status(500).json({ error: 'erro ao buscar dividendos' }) }
}
