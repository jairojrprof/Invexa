import test from 'node:test'
import assert from 'node:assert/strict'
import { createSignupClient } from '../signup-client.js'

const input = {email:' pessoa@example.test ',password:'Senha de teste 123!',nome:' Pessoa ',convite:' codigo-teste '}
const ready = async name => {assert.equal(name,'invexa_signup_ready');return {data:true,error:null}}

test('cadastro envia o convite como entrada e não acessa tabelas', async () => {
  let payload
  const signup = createSignupClient({
    rpc: ready,
    from() { throw new Error('Cadastro não deve consultar tabelas') },
    auth: { async signUp(value) { payload=value;return {data:{user:{id:'id'},session:null},error:null} } }
  })
  assert.deepEqual(await signup(input),{hasSession:false})
  assert.deepEqual(payload,{email:'pessoa@example.test',password:input.password,options:{data:{nome:'Pessoa',invite_code:'CODIGO-TESTE'}}})
})

test('cadastro reconhece sessão quando confirmação por email não é exigida', async () => {
  const signup=createSignupClient({rpc:ready,auth:{signUp:async()=>({data:{user:{id:'id'},session:{access_token:'teste'}},error:null})}})
  assert.deepEqual(await signup(input),{hasSession:true})
})

test('validação local impede solicitações incompletas ou grandes demais',async()=>{
  const signup=createSignupClient({auth:{signUp:()=>{throw Error('não deveria chamar')}}})
  for(const fields of [{convite:''},{convite:'x'.repeat(129)},{email:''},{password:''},{nome:'x'.repeat(121)}]) {
    await assert.rejects(signup({...input,...fields}),e=>e.message!=='não deveria chamar')
  }
})

test('erro de banco é apresentado sem expor detalhes internos',async()=>{
  const signup=createSignupClient({rpc:ready,auth:{signUp:async()=>({data:null,error:{code:'unexpected_failure',message:'internal SQL detail'}})}})
  await assert.rejects(signup(input),e=>e.message.includes('Confira o convite')&&!e.message.includes('internal SQL'))
})

test('limite de tentativas e senha fraca recebem mensagens específicas',async()=>{
  for(const [error,expected] of [[{status:429},/Muitas tentativas/],[{code:'weak_password'},/senha mais forte/]]){
    const signup=createSignupClient({rpc:ready,auth:{signUp:async()=>({error})}})
    await assert.rejects(signup(input),expected)
  }
})

test('resposta sem usuário não é tratada como cadastro concluído',async()=>{
  const signup=createSignupClient({rpc:ready,auth:{signUp:async()=>({data:{user:null},error:null})}})
  await assert.rejects(signup(input),/confirmar o cadastro/)
})

test('frontend recusa cadastro enquanto a migração não está pronta',async()=>{
  for(const response of [{data:null,error:{code:'PGRST202'}},{data:false,error:null}]){
    let calls=0
    const signup=createSignupClient({rpc:async()=>response,auth:{signUp:async()=>{calls++}}})
    await assert.rejects(signup(input),/temporariamente indisponível/)
    assert.equal(calls,0)
  }
})
