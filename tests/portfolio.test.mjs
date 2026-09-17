import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createPortfolioClient} from '../portfolio-client.js'
test('cliente verifica erro retornado, reutiliza pedido após falha e separa contas',async()=>{
  let calls=[],fail=true,account='a',id=0
  const sb={auth:{getSession:async()=>({data:{session:{user:{id:account}}}})},rpc:async(_,p)=>{calls.push(p);return fail?{error:{message:'duplicate'}}:{data:{ok:true,count:1}}}}
  const mutate=createPortfolioClient(sb,()=>String(++id)),entries=[{ticker:'PETR4',cotas:1,preco:10,data:'2026-01-10',total:10}]
  await assert.rejects(mutate('add',entries));fail=false;await mutate('add',entries)
  assert.equal(calls[0].p_request_id,calls[1].p_request_id);assert.equal(calls[0].p_entries[0].total,undefined)
  await mutate('add',entries);assert.notEqual(calls[1].p_request_id,calls[2].p_request_id)
  fail=true;await assert.rejects(mutate('add',entries));account='b';await assert.rejects(mutate('add',entries));assert.notEqual(calls[3].p_request_id,calls[4].p_request_id)
})
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')
function ui(mutate){
  const nodes={importStatus:{children:[],textContent:'',appendChild(n){this.children.push(n)}},button:{}}
  const ctx=vm.createContext({window:{},document:{querySelector:()=>nodes.button,createElement:()=>({})},el:id=>nodes[id],mutatePortfolio:mutate,refreshPortfolio:async()=>{},renderImportPreview:()=>{nodes.importStatus.textContent='prévia'}})
  vm.runInContext("let portfolioBusy=false,importPreview=[{ticker:'PETR4',cotas:2,preco:10,data:'2026-01-10'}];",ctx)
  vm.runInContext(html.slice(html.indexOf('window.confirmarImportacao=async function(){'),html.indexOf('// ── RESET')),ctx)
  return {ctx,nodes}
}
test('importação não anuncia sucesso nem apaga prévia quando gravação falha',async()=>{
  const {ctx,nodes}=ui(async()=>{throw Error('falha <img>')});await ctx.window.confirmarImportacao()
  assert.equal(vm.runInContext('importPreview.length',ctx),1);assert.equal(vm.runInContext('portfolioBusy',ctx),false)
  assert.equal(nodes.importStatus.textContent,'prévia');assert.equal(nodes.importStatus.children[0].textContent,'falha <img>')
})
test('importação impede clique duplo e só limpa prévia após confirmação',async()=>{
  let finish,calls=0;const {ctx,nodes}=ui(()=>{calls++;return new Promise(r=>{finish=r})})
  const first=ctx.window.confirmarImportacao();await ctx.window.confirmarImportacao();assert.equal(calls,1)
  finish({ok:true,count:1});await first
  assert.equal(vm.runInContext('importPreview.length',ctx),0);assert.match(nodes.importStatus.textContent,/carteira atualizada/)
})
