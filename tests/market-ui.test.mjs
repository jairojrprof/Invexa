import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')
test('falha de mercado preserva valores anteriores e exibe aviso como texto',async()=>{
  const nodes={marketStatus:{hidden:true,textContent:''}}
  const context=vm.createContext({API:{quote:async()=>{throw Error('<img onerror=alert(1)>')},dividends:async()=>{throw Error('Provedor indisponível')}},el:id=>nodes[id]})
  vm.runInContext("let carteira=[{ticker:'PETR4'}],aportes=[{ticker:'PETR4'}],precos={PETR4:{preco:12}},dividendosHist={PETR4:{total:42}};let marketErrors={quote:'',dividends:''};",context)
  const status=html.slice(html.indexOf('function showMarketStatus(){'),html.indexOf('// ── INIT'))
  const loads=html.slice(html.indexOf('async function loadQuotes(){'),html.indexOf('window.refreshQuotes='))
  vm.runInContext(status+'\n'+loads,context)
  await vm.runInContext('Promise.all([loadQuotes(),calcularDividendosAcumulados()])',context)
  assert.equal(vm.runInContext('precos.PETR4.preco',context),12)
  assert.equal(vm.runInContext('dividendosHist.PETR4.total',context),42)
  assert.equal(nodes.marketStatus.hidden,false)
  assert.match(nodes.marketStatus.textContent,/totais podem estar incompletos/)
  assert.match(nodes.marketStatus.textContent,/<img/)
  assert.equal(nodes.marketStatus.innerHTML,undefined)
})
