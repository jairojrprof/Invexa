import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { appendChatMessage } from '../chat-ui.js'

// DOM mínimo: o teste falha se mensagens forem enviadas a um parser de HTML.
function container() {
  const document = {
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, children: [], style: {},
        textContent: '',
        set innerHTML(_) { throw new Error('Mensagem não pode ser interpretada como HTML') },
        appendChild(child) { this.children.push(child) }
      }
    }
  }
  return document.createElement('div')
}

for (const role of ['user', 'assistant', 'model']) {
  test(`chat preserva texto e quebras de linha sem interpretar HTML (${role})`, () => {
    const host = container()
    const text = '<img src=x onerror="alert(1)">\n<script>alert(2)</script>\n<b>R$ 10 & 20</b>'
    appendChatMessage(host, { role, conteudo: text })
    assert.equal(host.children.length, 1)
    const row = host.children[0]
    assert.equal(row.className, `chat-msg ${role === 'user' ? 'chat-user' : 'chat-ai'}`)
    const bubble = row.children[0]
    assert.equal(bubble.textContent, text)
    assert.equal(bubble.style.whiteSpace, 'pre-wrap')
    assert.equal(bubble.children.length, 0)
  })
}

test('mensagens vazias não interrompem a renderização', () => {
  const host = container()
  appendChatMessage(host, { role: 'assistant', conteudo: null })
  appendChatMessage(host, { role: 'user', conteudo: 'próxima mensagem' })
  assert.equal(host.children[0].children[0].textContent, '')
  assert.equal(host.children[1].children[0].textContent, 'próxima mensagem')
})

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const moduleSource = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
const chartSource = moduleSource.slice(moduleSource.indexOf('function renderCharts(){'), moduleSource.indexOf('// ── PERFIL DO INVESTIDOR'))

test('gráficos mostram apenas a composição atual e limpam a carteira removida', () => {
  const created = []
  let destroyed = 0
  const nodes = Object.fromEntries(['chartPizza', 'chartEvolucao', 'chartDividendos', 'pizzaLegend'].map(id => [id, { id, innerHTML: '', textContent: '' }]))
  const context = vm.createContext({
    carteira: [{ ticker: 'ABCD3', cotas: 2, preco_medio: 10 }, { ticker: 'EFGH4', cotas: 3, preco_medio: 20 }],
    precos: { ABCD3: { preco: 12 } }, charts: {},
    el: id => nodes[id],
    Chart: function(node, config) {
      created.push({ node, config })
      this.destroy = () => { destroyed++ }
    }
  })
  vm.runInContext(chartSource + '\nrenderCharts()', context)
  assert.equal(created.length, 1)
  assert.equal(created[0].node.id, 'chartPizza')
  assert.equal(created[0].config.type, 'doughnut')
  assert.deepEqual(Array.from(created[0].config.data.datasets[0].data), [24, 60])
  nodes.pizzaLegend.textContent = 'legenda anterior'
  context.carteira = []
  vm.runInContext('renderCharts()', context)
  assert.equal(created.length, 1)
  assert.equal(destroyed, 1)
  assert.equal(context.charts.chartPizza, null)
  assert.equal(nodes.pizzaLegend.textContent, '')
})

test('aba de evolução informa a indisponibilidade dos históricos', () => {
  assert.doesNotMatch(html, /<canvas id="chart(?:Evolucao|Dividendos)"/)
  assert.match(html, /O histórico de patrimônio ainda não está disponível\./)
  assert.match(html, /O histórico mensal de dividendos ainda não está disponível\./)
})

test('renderização do histórico utiliza a saída segura para todas as mensagens', () => {
  const start = moduleSource.indexOf('function renderChat(){')
  const end = moduleSource.indexOf('window.enviarMensagem=', start)
  const host = container()
  Object.defineProperty(host, 'innerHTML', { set(value) { assert.equal(value, ''); host.children = [] } })
  const context = vm.createContext({
    el: () => host, appendChatMessage,
    chatHistorico: [{role:'user', conteudo:'<img onerror=alert(1)>'}, {role:'assistant', conteudo:'Resposta\nem texto'}]
  })
  vm.runInContext(moduleSource.slice(start, end) + '\nrenderChat()', context)
  assert.equal(host.children.length, 2)
  assert.equal(host.children[0].children[0].textContent, '<img onerror=alert(1)>')
  assert.equal(host.children[1].children[0].textContent, 'Resposta\nem texto')
})
