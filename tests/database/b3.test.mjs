import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
const url=new URL(process.env.LOCAL_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use banco local descartável')
const name=`invexa_b3_${process.pid}_${Date.now()}`,local=new URL(url);local.pathname='/'+name
const admin=new pg.Client({connectionString:url.href})
const purchase=(cotas=2,preco=50,data='2024-01-10',ticker='TEST3')=>({kind:'purchase',ticker,cotas,preco,data,instituicao:'CORRETORASA'})
const split=(cotas=4)=>({...purchase(cotas,0,'2024-02-10'),kind:'split'})
async function connect(){const c=new pg.Client({connectionString:local.href});await c.connect();return c}
async function mutate(c,user,action,entries=[],id=null,request=randomUUID(),role='authenticated'){
  await c.query('begin')
  try{await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);await c.query(`set local role ${role}`)
    const r=await c.query('select public.mutate_portfolio($1,$2,$3,$4) as result',[action,request,JSON.stringify(entries),id]);await c.query('commit');return r.rows[0].result
  }catch(e){await c.query('rollback');throw e}
}
test('B3 reconcilia histórico e eventos sem duplicar nem alterar custo',async t=>{
  await admin.connect();let c
  try{
    await admin.query(`create database ${name}`);c=await connect()
    await c.query(fs.readFileSync(new URL('./baseline.sql',import.meta.url),'utf8'))
    const owner=randomUUID(),other=randomUUID()
    for(const id of [owner,other])await c.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test'])
    for(const file of ['20260916225659_secure_invite_signup.sql','20260917155311_atomic_portfolio_import.sql'])await c.query(fs.readFileSync(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8'))
    await mutate(c,owner,'add',[purchase(),purchase(1,15,'2024-03-10')])
    const before=(await c.query('select id,cotas,preco,data::text,total from aportes where user_id=$1 order by id',[owner])).rows
    await c.query(fs.readFileSync(new URL('../../supabase/migrations/20260918023132_b3_splits_and_reconciliation.sql',import.meta.url),'utf8'))
    const batch=[split(),purchase(),purchase(1,15,'2024-03-10')]
    const position=async user=>(await c.query("select * from carteira where user_id=$1 and ticker='TEST3'",[user])).rows[0]
    await t.test('reconhece legado, aplica unidades adicionais e preserva cada compra',async()=>{
      const result=await mutate(c,owner,'import_b3',batch)
      assert.equal(result.count,0);assert.equal(result.linked,2);assert.equal(result.splits,1)
      const p=await position(owner);assert.equal(Number(p.cotas),7);assert.equal(Number(p.preco_medio),16.4286)
      assert.deepEqual((await c.query('select id,cotas,preco,data::text,total from aportes where user_id=$1 order by id',[owner])).rows,before)
      const second=await mutate(c,owner,'import_b3',[...batch].reverse());assert.equal(second.existing,3);assert.equal(second.count,0);assert.equal(second.splits,0)
    })
    await t.test('compra posterior, exclusão e reimportação mantêm desdobro',async()=>{
      await mutate(c,owner,'add',[purchase(1,25,'2024-04-10')]);assert.equal(Number((await position(owner)).cotas),8)
      const id=(await c.query("select id from aportes where user_id=$1 and data='2024-04-10'",[owner])).rows[0].id
      await mutate(c,owner,'remove_aporte',[],id);assert.equal(Number((await position(owner)).cotas),7)
      const old=(await c.query("select id from aportes where user_id=$1 and data='2024-01-10'",[owner])).rows[0].id
      await assert.rejects(mutate(c,owner,'remove_aporte',[],old),/B3_PURCHASE_HAS_SPLIT/)
      await assert.rejects(mutate(c,owner,'import_b3',[split(5)]),/B3_SPLIT_CONFLICT/)
      assert.equal(Number((await position(owner)).cotas),7)
    })
    await t.test('lotes concorrentes e compras iguais preservam multiplicidade sem duplicar',async()=>{
      const clients=await Promise.all([connect(),connect()]),entries=[purchase(),purchase(),split()]
      try{await Promise.all(clients.map(db=>mutate(db,other,'import_b3',entries)))}finally{await Promise.all(clients.map(db=>db.end()))}
      assert.equal(Number((await position(other)).cotas),8)
      assert.equal(Number((await position(other)).preco_medio),25)
      assert.equal((await c.query('select count(*)::int n from aportes where user_id=$1',[other])).rows[0].n,2)
    })
    await t.test('falha de evento reverte compras e recibos; autenticação e acesso direto isolados',async()=>{
      const count=async()=>(await c.query('select count(*)::int n from aportes')).rows[0].n,before=await count()
      await assert.rejects(mutate(c,owner,'import_b3',[purchase(1,1,'2024-01-01','OTHR3'),{...split(),ticker:'MISS3'}]),/B3_SPLIT_WITHOUT_HISTORY/)
      assert.equal(await count(),before)
      for(const [user,role] of [[null,'authenticated'],[owner,'anon'],[randomUUID(),'authenticated']])await assert.rejects(mutate(c,user,'import_b3',batch,null,randomUUID(),role),{code:'42501'})
      for(const sql of ['select * from invexa_private.b3_records','select * from invexa_private.b3_legacy_aportes',"select invexa_private.rebuild_portfolio('TEST3')","delete from public.aportes","update carteira set cotas=999"]){
        await c.query('begin');try{await c.query('set local role authenticated');await assert.rejects(c.query(sql),{code:'42501'})}finally{await c.query('rollback')}
      }
      for(const entries of [[{...split(),preco:1}],[{...purchase(),kind:null}],[{...purchase(),instituicao:''}],[{...purchase(),cotas:-1}],[{...purchase(),data:'2024-02-30'}]])await assert.rejects(mutate(c,owner,'import_b3',entries))
    })
    await t.test('mesmo pedido é idempotente; reset e remoção do ativo limpam eventos só da conta',async()=>{
      const request=randomUUID();await mutate(c,owner,'import_b3',batch,null,request);await mutate(c,owner,'import_b3',batch,null,request)
      await assert.rejects(mutate(c,owner,'import_b3',[purchase()],null,request),/Request already used/)
      await mutate(c,owner,'remove_ativo',[],(await position(owner)).id)
      assert.equal(Number((await position(owner)).cotas),0)
      await mutate(c,owner,'import_b3',batch);assert.equal(Number((await position(owner)).cotas),7)
      await mutate(c,owner,'reset');assert.equal((await c.query('select count(*)::int n from invexa_private.b3_records where user_id=$1',[owner])).rows[0].n,0)
      await mutate(c,owner,'import_b3',batch);assert.equal(Number((await position(owner)).cotas),7)
      assert.equal(Number((await position(other)).cotas),8)
    })
  }finally{await c?.end();try{await admin.query(`drop database if exists ${name}`)}finally{await admin.end()}}
})
