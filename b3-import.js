const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

export function b3Number(value) {
  if (typeof value === 'number') return value
  const text = String(value ?? '').trim()
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(text)) return NaN
  return Number(text.replaceAll('.', '').replace(',', '.'))
}

function dateISO(value) {
  if (typeof value === 'number') value = new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10)
  let text = String(value ?? '').trim()
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (match) text = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) return null
  return text
}

// Desdobro no extrato é a quantidade ADICIONAL recebida, sem novo custo.
export function parseB3Rows(rows) {
  const names = ['entrada/saida', 'data', 'movimentacao', 'produto', 'instituicao', 'quantidade', 'preco unitario']
  const headerIndex = rows.findIndex(row => names.every(name => row.map(normalize).includes(name)))
  if (headerIndex < 0) throw Error('Use o extrato de Movimentações da B3, com as colunas originais.')
  const header = rows[headerIndex].map(normalize), indexes = names.map(name => header.indexOf(name))
  const entries = [], ignored = new Map()
  const skip = (reason, line) => { if (!ignored.has(reason)) ignored.set(reason, []); ignored.get(reason).push(line) }
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row.some(value => String(value ?? '').trim())) continue
    const [direction, rawDate, movement, product, broker, quantity, price] = indexes.map(index => row[index])
    const mov = normalize(movement), ticker = String(product ?? '').split(' - ')[0].trim().toUpperCase()
    const kind = mov === 'desdobro' ? 'split' : ['transferencia - liquidacao', 'compra'].includes(mov) ? 'purchase' : null
    if (!/^[A-Z]{4}\d{1,2}$/.test(ticker)) { skip('Produtos fora do escopo (inclui renda fixa)', i + 1); continue }
    if (normalize(direction) !== 'credito' || !kind) { skip('Movimentos não processados (transferências, empréstimos, direitos, atualizações ou saídas)', i + 1); continue }
    const data = dateISO(rawDate), cotas = b3Number(quantity), preco = kind === 'split' ? 0 : b3Number(price)
    const instituicao = normalize(broker).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!data || !instituicao || instituicao.length > 200 || !(cotas > 0 && cotas <= 1e9) || !(kind === 'split' || preco > 0 && preco <= 1e9)) {
      skip('Linhas sem data, instituição, quantidade ou preço válidos', i + 1); continue
    }
    entries.push({kind, ticker, data, cotas, preco, instituicao, total: kind === 'split' ? 0 : +(cotas * preco).toFixed(2)})
  }
  return {entries, ignored: [...ignored].map(([reason, lines]) => ({reason, lines}))}
}

export function importWarnings(ignored) {
  return ignored.map(({reason, lines}) => `${reason}: ${lines.length} linha(s) (${lines.join(', ')}).`).join(' ')
}
