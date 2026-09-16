import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')
const source=html.slice(html.indexOf('window.cadastrar=async function(){'),html.indexOf('window.logout='))
function setup(signupClient){
  const nodes=Object.fromEntries(['btnCadastro','authError','authEmail','authSenha','authNome','authConvite'].map(id=>[id,{value:'',textContent:'',disabled:false,style:{}}]))
  nodes.authSenha.value='senha de teste'
  nodes.authConvite.value='CODIGO'
  const window={}
  const context=vm.createContext({window,el:id=>nodes[id],val:id=>nodes[id].value,signupClient})
  vm.runInContext(source,context)
  return {nodes,window}
}

test('formulário impede duplo envio e informa confirmação por email',async()=>{
  let calls=0,finish
  const {nodes,window}=setup(()=>{calls++;return new Promise(resolve=>{finish=resolve})})
  const first=window.cadastrar()
  assert.equal(nodes.btnCadastro.disabled,true)
  await window.cadastrar()
  assert.equal(calls,1)
  finish({hasSession:false});await first
  assert.equal(nodes.btnCadastro.disabled,false)
  assert.equal(nodes.btnCadastro.textContent,'criar conta')
  assert.equal(nodes.authSenha.value,'')
  assert.match(nodes.authError.textContent,/email de confirmação/)
})

test('erro de cadastro reabilita o botão e mantém a senha para correção',async()=>{
  const {nodes,window}=setup(async()=>{throw new Error('Convite indisponível')})
  await window.cadastrar()
  assert.equal(nodes.btnCadastro.disabled,false)
  assert.equal(nodes.authError.textContent,'Convite indisponível')
  assert.equal(nodes.authError.style.color,'var(--red)')
  assert.equal(nodes.authSenha.value,'senha de teste')
})

test('sessão imediata não mostra pedido de confirmação por email',async()=>{
  const {nodes,window}=setup(async()=>({hasSession:true}))
  await window.cadastrar()
  assert.equal(nodes.authError.textContent,'')
  assert.equal(nodes.authSenha.value,'')
})

test('login existente continua usando email e senha e permite nova tentativa',async()=>{
  const nodes={btnLogin:{disabled:false,textContent:''},authError:{textContent:''}}
  let payload
  const window={}
  const context=vm.createContext({window,el:id=>nodes[id],val:id=>id==='authEmail'?'existente@example.test':'senha',set:(id,text)=>{nodes[id].textContent=text},sb:{auth:{signInWithPassword:async input=>{payload=input;return {error:{message:'invalid'}}}}}})
  const start=html.indexOf('window.login=async function(){')
  vm.runInContext(html.slice(start,html.indexOf('window.cadastrar=',start)),context)
  await window.login()
  assert.equal(payload.email,'existente@example.test');assert.equal(payload.password,'senha')
  assert.equal(nodes.btnLogin.disabled,false)
  assert.equal(nodes.authError.textContent,'Email ou senha incorretos.')
})
