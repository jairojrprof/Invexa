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

test('dividendos param no bloqueio do provedor e preservam histórico anterior',async()=>{
  let calls=0;const nodes={marketStatus:{}}
  const ctx=vm.createContext({API:{dividends:async()=>{calls++;throw Object.assign(Error('BRAPI bloqueada'),{code:'PROVIDER_LIMITED'})}},el:id=>nodes[id]})
  vm.runInContext("let carteira=[{ticker:'PETR4'},{ticker:'VALE3'}],aportes=[{ticker:'PETR4'},{ticker:'VALE3'}],precos={},dividendosHist={PETR4:{total:42}},marketErrors={quote:'',dividends:''};",ctx)
  vm.runInContext(html.slice(html.indexOf('function showMarketStatus(){'),html.indexOf('// ── INIT'))+html.slice(html.indexOf('async function calcularDividendosAcumulados(){'),html.indexOf('window.refreshQuotes=')),ctx)
  await vm.runInContext('calcularDividendosAcumulados()',ctx)
  assert.equal(calls,1);assert.equal(vm.runInContext('dividendosHist.PETR4.total',ctx),42);assert.match(nodes.marketStatus.textContent,/BRAPI/)
})
test('erro específico da IA aparece como texto',async()=>{
  const node={};const ctx=vm.createContext({window:{},el:()=>node,carteira:[{}],carteiraSummary:()=>'',perfil:null,API:{ai:async()=>{throw Error('Modelo indisponível <img>')}}})
  vm.runInContext(html.slice(html.indexOf('window.loadAI=async function(){'),html.indexOf('// ── TABS')),ctx)
  await ctx.window.loadAI();assert.match(node.textContent,/Modelo indisponível <img>/);assert.equal(node.innerHTML,undefined)
})
