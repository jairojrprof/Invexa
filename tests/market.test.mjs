import test from 'node:test'
import assert from 'node:assert/strict'
import { createMarketHandler, parseTickers } from '../lib/market.js'
import { createMarketClient } from '../market-client.js'

const json = (body, status=200, headers={}) => new Response(JSON.stringify(body), {status,headers})
const account={id:'test-user',email_confirmed_at:'2026-09-17T00:00:00Z'}
const quote=ticker=>({results:[{symbol:ticker,regularMarketPrice:12,regularMarketChangePercent:1.5}]})
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.statusCode=s;return this},json(b){this.body=b;return this}}}
function request(kind='quote',value='PETR4',auth='Bearer user-token'){return {method:'GET',headers:{authorization:auth},query:{[kind==='quote'?'tickers':'ticker']:value}}}
function setup({kind='quote',auth=()=>json(account),quota=()=>json({allowed:true}),provider=url=>json(quote(new URL(url).pathname.split('/').at(-1))),cacheFail=false}={}){
  const calls=[],values=new Map();let time=100000
  const cache={get:async k=>{if(cacheFail)throw Error();return values.get(k)},set:async(k,v)=>{if(cacheFail)throw Error();values.set(k,v)}}
  const handler=createMarketHandler(kind,{cache,now:()=>time,token:()=> 'provider-secret',fetcher:async(url,opts)=>{
    calls.push({url,opts})
    if(url.includes('/auth/v1/user'))return auth(url,opts)
    if(url.includes('/rpc/'))return quota(url,opts)
    return provider(url,opts)
  }})
  return {handler,calls,values,advance:n=>time+=n,run:async(req=request(kind))=>{const r=res();await handler(req,r);return r}}
}
test('método e sessão obrigatórios antes de cache ou provedor',async()=>{
  for(const kind of ['quote','dividends']){
    const s=setup({kind})
    assert.equal((await s.run({...request(kind),method:'POST'})).statusCode,405)
    for(const auth of [undefined,'Basic x','Bearer x y','Bearer '+ 'x'.repeat(8200)]) assert.equal((await s.run(request(kind,'PETR4',auth===undefined?'':auth))).statusCode,401)
    assert.equal(s.calls.length,0)
  }
})
test('token inválido, usuário anônimo, email não confirmado e Auth indisponível bloqueiam o provedor',async()=>{
  for(const [auth,status] of [[()=>json({},401),401],[()=>json({...account,is_anonymous:true}),401],[()=>json({id:'x'}),401],[()=>json({},500),503],[()=>{throw Error('network')},503]]){
    const s=setup({auth});assert.equal((await s.run()).statusCode,status);assert.equal(s.calls.length,1)
  }
})
test('validação impede query injection, repetição de parâmetro e lotes grandes',async()=>{
  for(const value of ['',null,['PETR4'], '../PETR4','PETR4?token=secret','PETR4%2FVALE3',Array(11).fill('PETR4').join(','),'A'.repeat(130)]){
    const s=setup();assert.equal((await s.run(request('quote',value))).statusCode,400);assert.equal(s.calls.length,1)
  }
  assert.deepEqual(parseTickers(' petr4 ,B5P211,PETR4','quote'),['B5P211','PETR4'])
  assert.throws(()=>parseTickers('PETR4,VALE3','dividends'))
})
test('quota negada retorna 429 com Retry-After sem consultar cache ou BRAPI',async()=>{
  const s=setup({quota:()=>json({allowed:false,retry_after:42})})
  const r=await s.run();assert.equal(r.statusCode,429);assert.equal(r.headers['Retry-After'],'42');assert.equal(s.calls.length,2)
})
test('contador indisponível ou resposta inválida falham fechados',async()=>{
  for(const quota of [()=>json({},404),()=>json({}),()=>json({allowed:false}),()=>{throw Error()}]){
    const s=setup({quota});assert.equal((await s.run()).statusCode,503);assert.equal(s.calls.length,2)
  }
})
test('cache por ativo reutiliza consulta, mas cada chamada verifica Auth e cota',async()=>{
  const s=setup();const first=await s.run(request('quote','VALE3,PETR4,PETR4'))
  assert.equal(first.statusCode,200)
  assert.equal(first.headers['Cache-Control'],'private, no-store')
  assert.equal(first.headers['Access-Control-Allow-Origin'],undefined)
  assert.deepEqual(JSON.parse(s.calls.find(c=>c.url.includes('/rpc/')).opts.body),{p_kind:'quote',p_cost:2})
  const second=await s.run(request('quote','PETR4'))
  assert.equal(second.statusCode,200);assert.equal(s.calls.filter(c=>c.url.includes('brapi.dev')).length,2)
  assert.equal(s.calls.filter(c=>c.url.includes('/auth/')).length,2)
  assert.equal(s.calls.filter(c=>c.url.includes('/rpc/')).length,2)
  for(const c of s.calls.filter(c=>c.url.includes('brapi.dev'))){assert.equal(c.opts.headers.Authorization,'Bearer provider-secret');assert.ok(!c.url.includes('secret'))}
  assert.ok(!JSON.stringify(second.body).includes('secret'))
  s.advance(60000);await s.run();assert.equal(s.calls.filter(c=>c.url.includes('brapi.dev')).length,3)
})
test('falha de cache mantém serviço autenticado e com quota',async()=>{
  const s=setup({cacheFail:true});assert.equal((await s.run()).statusCode,200);assert.equal(s.calls.length,3)
})
test('consultas simultâneas do mesmo ativo compartilham fetch sem compartilhar autorização',async()=>{
  const s=setup();await Promise.all([s.run(),s.run(),s.run()]);assert.equal(s.calls.filter(c=>c.url.includes('brapi.dev')).length,1);assert.equal(s.calls.filter(c=>c.url.includes('/rpc/')).length,3)
})
test('erros do provedor não viram sucesso nem entram no cache',async()=>{
  for(const [provider,status] of [[()=>json({error:'provider-secret'},401),502],[()=>json({},429),503],[()=>json({error:true}),502],[()=>json(quote('VALE3')),502],[()=>json({results:[{symbol:'PETR4',regularMarketPrice:null}]}),502],[()=>new Response('invalid json'),502],[()=>{throw new DOMException('timeout','TimeoutError')},504]]){
    const s=setup({provider});const r=await s.run();assert.equal(r.statusCode,status);assert.equal(s.values.size,0);assert.ok(!JSON.stringify(r.body).includes('secret'))
  }
})
test('dividendos ausentes são erro; lista vazia explícita é válida e tem TTL de seis horas',async()=>{
  const missing=setup({kind:'dividends'});assert.equal((await missing.run()).statusCode,502)
  const s=setup({kind:'dividends',provider:()=>json({results:[{symbol:'PETR4',dividendsData:{cashDividends:[]}}]})})
  const r=await s.run();assert.deepEqual(r.body.dividends,[]);assert.equal(r.body.meta.cacheTtlSeconds,21600)
  s.advance(60000);await s.run();assert.equal(s.calls.filter(c=>c.url.includes('brapi.dev')).length,1)
  s.advance(21600000);await s.run();assert.equal(s.calls.filter(c=>c.url.includes('brapi.dev')).length,2)
})
test('cliente envia token atualizado e divide carteira grande em lotes de dez',async()=>{
  let sessions=0;const calls=[]
  const sb={auth:{getSession:async()=>({data:{session:{access_token:'session-'+ ++sessions}}})}}
  const c=createMarketClient(sb,async(url,opts)=>{calls.push({url,opts});return json({results:[]})})
  await c.quote(Array.from({length:23},(_,i)=>'TEST'+i).join(','))
  assert.equal(calls.length,3)
  assert.equal(calls[2].opts.headers.Authorization,'Bearer session-3')
  assert.equal(new URL(calls[0].url,'https://local.test').searchParams.get('tickers').split(',').length,10)
  assert.ok(calls.every(c=>!c.url.includes('session-')))
})
test('cliente rejeita sessão ausente e respeita Retry-After',async()=>{
  let calls=0
  const bad=createMarketClient({auth:{getSession:async()=>({data:{}})}},async()=>{calls++})
  await assert.rejects(bad.dividends('PETR4'));assert.equal(calls,0)
  const c=createMarketClient({auth:{getSession:async()=>({data:{session:{access_token:'x'}}})}},async()=>{calls++;return json({error:'Aguarde'},429,{'Retry-After':'60'})})
  await assert.rejects(c.dividends('PETR4'),/Aguarde/)
  await assert.rejects(c.quote('VALE3'),/Aguarde/);assert.equal(calls,1)
})

test('cliente preserva origem BRAPI durante espera, sem culpar a cota do usuário',async()=>{
  let calls=0
  const c=createMarketClient({auth:{getSession:async()=>({data:{session:{access_token:'x'}}})}},async()=>{calls++;return json({error:'A BRAPI limitou o serviço.',code:'PROVIDER_LIMITED'},503,{'Retry-After':'300'})})
  for(let i=0;i<2;i++)await assert.rejects(c.quote('PETR4'),e=>e.code==='PROVIDER_LIMITED'&&e.message==='A BRAPI limitou o serviço.')
  assert.equal(calls,1)
})
test('lote para no primeiro bloqueio BRAPI e respeita Retry-After sem expor credenciais',async()=>{
  const s=setup({provider:()=>json({},429,{'Retry-After':'1800'})})
  const r=await s.run(request('quote','PETR4,VALE3,ITUB4'))
  assert.equal(r.statusCode,503);assert.equal(r.body.code,'PROVIDER_LIMITED');assert.equal(r.headers['Retry-After'],'1800')
  assert.equal(s.calls.filter(c=>c.url.includes('brapi.dev')).length,1)
})
test('erros de autenticação e plano BRAPI são distintos do limite local',async()=>{
  for(const [status,code] of [[401,'PROVIDER_AUTH_ERROR'],[403,'PROVIDER_PLAN_RESTRICTED']]){
    const s=setup({provider:()=>json({error:'provider-secret'},status)});const r=await s.run()
    assert.equal(r.body.code,code);assert.equal(r.statusCode,502);assert.ok(!JSON.stringify(r.body).includes('secret'))
  }
})
