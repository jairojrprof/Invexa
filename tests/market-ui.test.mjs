import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')
test('falha de mercado preserva preço anterior e exibe aviso como texto',async()=>{
  const nodes={marketStatus:{hidden:true,textContent:''}}
  const context=vm.createContext({API:{quote:async()=>{throw Error('<img onerror=alert(1)>')}},el:id=>nodes[id]})
  vm.runInContext("let user={id:'user'},quotesPending=null,quotesAccount=null,carteira=[{ticker:'PETR4'}],precos={PETR4:{preco:12}},marketErrors={quote:'',dividends:''};",context)
  const status=html.slice(html.indexOf('function showMarketStatus(){'),html.indexOf('// ── INIT'))
  const loads=html.slice(html.indexOf('async function loadQuotes(){'),html.indexOf('window.refreshQuotes='))
  vm.runInContext(status+'\n'+loads,context)
  await vm.runInContext('loadQuotes()',context)
  assert.equal(vm.runInContext('precos.PETR4.preco',context),12)
  assert.equal(nodes.marketStatus.hidden,false)
  assert.match(nodes.marketStatus.textContent,/<img/)
  assert.equal(nodes.marketStatus.innerHTML,undefined)
})

test('inicialização e atualização simultâneas compartilham a busca e mostram data da consulta',async()=>{
  let calls=0,release
  const nodes={marketStatus:{},quoteInfo:{}}
  const ctx=vm.createContext({API:{quote:async()=>{calls++;await new Promise(r=>release=r);return {results:[{symbol:'PETR4',regularMarketPrice:12,regularMarketChangePercent:1}],meta:{fetchedAt:'2026-09-17T18:00:00Z'}}}},el:id=>nodes[id]})
  vm.runInContext("let user={id:'user'},quotesPending=null,quotesAccount=null,carteira=[{ticker:'PETR4'}],precos={},marketErrors={quote:'',dividends:''};",ctx)
  vm.runInContext(html.slice(html.indexOf('function showMarketStatus(){'),html.indexOf('// ── INIT'))+html.slice(html.indexOf('async function loadQuotes(){'),html.indexOf('window.refreshQuotes=')),ctx)
  const pending=vm.runInContext('Promise.all([loadQuotes(),loadQuotes()])',ctx)
  release();await pending
  assert.equal(calls,1);assert.match(nodes.quoteInfo.textContent,/17/);assert.match(nodes.quoteInfo.textContent,/1 hora/)
})

test('dividendos indisponíveis não aparecem como zero nem disparam API',()=>{
  assert.doesNotMatch(html,/API\.dividends\(/)
  const nodes={proventosLista:{}},values={}
  const ctx=vm.createContext({el:id=>nodes[id],set:(id,value)=>values[id]=value})
  vm.runInContext(html.slice(html.indexOf('function renderProventos(){'),html.indexOf('function renderAportesList(){')),ctx)
  vm.runInContext('renderProventos()',ctx)
  assert.match(nodes.proventosLista.textContent,/indisponíveis/)
  assert.equal(values.totalProvMensal,'—');assert.equal(values.totalProvAcumulado,'—')
  const kpi={}
  const kctx=vm.createContext({carteira:[{ticker:'PETR4',cotas:1,preco_medio:10}],precos:{},dividendosHist:{},set:(id,v)=>kpi[id]=v,el:()=>null,fmt:String,fmtP:String})
  vm.runInContext(html.slice(html.indexOf('function renderKPIs(){'),html.indexOf('function renderAtivos(){')),kctx)
  vm.runInContext('renderKPIs()',kctx)
  assert.equal(kpi.kpiDiv,'—');assert.equal(kpi.kpiAcumulado,'—');assert.equal(kpi.kpiRetornoReal,'dados indisponíveis')
})

test('erro específico da IA aparece como texto',async()=>{
  const node={};const ctx=vm.createContext({window:{},el:()=>node,carteira:[{}],carteiraSummary:()=>'',perfil:null,API:{ai:async()=>{throw Error('Modelo indisponível <img>')}}})
  vm.runInContext(html.slice(html.indexOf('window.loadAI=async function(){'),html.indexOf('// ── TABS')),ctx)
  await ctx.window.loadAI();assert.match(node.textContent,/Modelo indisponível <img>/);assert.equal(node.innerHTML,undefined)
})
