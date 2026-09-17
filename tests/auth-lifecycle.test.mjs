import test from 'node:test'
import assert from 'node:assert/strict'
import { startAuthLifecycle } from '../auth-lifecycle.js'
const flush=()=>new Promise(r=>setTimeout(r,0))
test('sessão inicial, SIGNED_IN e refresh não repetem carregamento; logout permite nova entrada',async()=>{
  let emit,calls=0,out=0;const queue=[],session={user:{id:'a'}}
  const sb={auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{emit=fn;return {data:{}}}}}
  startAuthLifecycle(sb,{onSession:()=>{calls++},onSignedOut:()=>{out++},onError:e=>{throw e}},task=>queue.push(task))
  await flush()
  assert.equal(emit('INITIAL_SESSION',session),undefined)
  emit('SIGNED_IN',session);emit('TOKEN_REFRESHED',session)
  assert.equal(calls,0);assert.equal(queue.length,1)
  queue.shift()();await flush();assert.equal(calls,1)
  emit('SIGNED_OUT',null);queue.shift()();await flush();assert.equal(out,1)
  emit('SIGNED_IN',session);queue.shift()();await flush();assert.equal(calls,2)
})
test('mudança de conta invalida tarefa antiga ainda não iniciada',async()=>{
  let emit;const queue=[],seen=[]
  const sb={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:fn=>{emit=fn;return {}}}}
  startAuthLifecycle(sb,{onSession:s=>seen.push(s.user.id),onSignedOut:()=>seen.push('out'),onError:e=>{throw e}},task=>queue.push(task))
  emit('SIGNED_IN',{user:{id:'a'}});emit('SIGNED_IN',{user:{id:'b'}})
  await flush();queue.forEach(task=>task());await flush();assert.deepEqual(seen,['b'])
})
