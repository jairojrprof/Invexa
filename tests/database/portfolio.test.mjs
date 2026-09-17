import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {randomUUID} from 'node:crypto'
import pg from 'pg'
const url=new URL(process.env.LOCAL_TEST_DATABASE_URL||'http://invalid')
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use banco local descartável')
const name=`invexa_portfolio_${process.pid}_${Date.now()}`,local=new URL(url);local.pathname='/'+name
const admin=new pg.Client({connectionString:url.href})
const sql=fs.readFileSync(new URL('../../supabase/migrations/20260917155311_atomic_portfolio_import.sql',import.meta.url),'utf8')
const row=(ticker='PETR4',cotas=2,preco=10)=>({ticker,cotas,preco,data:'2026-01-10'})
async function connect(){const c=new pg.Client({connectionString:local.href});await c.connect();return c}
async function mutate(c,user,action,entries=[],id=null,request=randomUUID(),role='authenticated'){
  await c.query('begin')
  try{await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user||'']);await c.query(`set local role ${role}`)
    const r=await c.query('select public.mutate_portfolio($1,$2,$3,$4) as result',[action,request,JSON.stringify(entries),id]);await c.query('commit');return r.rows[0].result
  }catch(e){await c.query('rollback');throw e}
}
test('importação e carteira permanecem consistentes em PostgreSQL real',async t=>{
  await admin.connect();let c
  try{
    await admin.query(`create database ${name}`);c=await connect()
    await c.query(fs.readFileSync(new URL('./baseline.sql',import.meta.url),'utf8'))
    const owner=randomUUID(),other=randomUUID()
    for(const id of [owner,other])await c.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test'])
    await c.query(fs.readFileSync(new URL('../../supabase/migrations/20260916225659_secure_invite_signup.sql',import.meta.url),'utf8'))
    await c.query("insert into public.carteira(user_id,ticker,cotas,preco_medio,ativo) values($1,'PETR4',999,999,false)",[owner])
    await c.query("insert into public.aportes(user_id,ticker,cotas,preco,data) values($1,'PETR4',2,10,'2026-01-10'),($1,'PETR4',3,20,'2026-01-11')",[owner])
    await t.test('reproduz conflito de ativo inativo e recupera sem duplicar histórico',async()=>{
      await assert.rejects(c.query("insert into public.carteira(user_id,ticker,cotas,preco_medio) values($1,'PETR4',5,16)",[owner]),{code:'23505'})
      await c.query('begin');try{await c.query(sql);await c.query('commit')}catch(e){await c.query('rollback');throw e}
      const p=(await c.query('select * from carteira where user_id=$1',[owner])).rows[0]
      assert.equal(p.ativo,true);assert.equal(Number(p.cotas),5);assert.equal(Number(p.preco_medio),16)
      assert.equal((await c.query('select count(*)::int n from aportes')).rows[0].n,2)
    })
    await t.test('reset e reimportação reativam sem somar saldo anterior',async()=>{
      await mutate(c,owner,'reset');await mutate(c,owner,'add',[row(),row('PETR4',3,20),row('MXRF11',4,12)])
      const p=(await c.query("select * from carteira where user_id=$1 and ticker='PETR4'",[owner])).rows[0]
      assert.equal(Number(p.cotas),5);assert.equal(Number(p.preco_medio),16);assert.equal(p.ativo,true)
      assert.equal((await c.query('select count(*)::int n from aportes where user_id=$1',[owner])).rows[0].n,3)
    })
    await t.test('repetição do mesmo pedido grava uma vez e rejeita conteúdo diferente',async()=>{
      const id=randomUUID();await mutate(c,owner,'add',[row()],null,id);await mutate(c,owner,'add',[row()],null,id)
      assert.equal(Number((await c.query("select cotas from carteira where user_id=$1 and ticker='PETR4'",[owner])).rows[0].cotas),7)
      await assert.rejects(mutate(c,owner,'add',[row('PETR4',8)],null,id),{code:'22023'})
    })
    await t.test('falha ao atualizar carteira desfaz todos os aportes do lote',async()=>{
      await c.query("create function public.reject_test() returns trigger language plpgsql as $$ begin if new.ticker='FAIL3' then raise exception 'forced failure'; end if; return new; end $$; create trigger reject_test before insert or update on carteira for each row execute function public.reject_test()")
      const before=(await c.query('select count(*)::int n from aportes')).rows[0].n
      await assert.rejects(mutate(c,owner,'add',[row('VALE3'),row('FAIL3')]))
      assert.equal((await c.query('select count(*)::int n from aportes')).rows[0].n,before)
      assert.equal((await c.query("select count(*)::int n from carteira where ticker='VALE3'")).rows[0].n,0)
    })
    await t.test('duas conexões adicionam sem perder quantidade nem custo',async()=>{
      const clients=await Promise.all([connect(),connect()])
      try{await Promise.all(clients.map((db,i)=>mutate(db,other,'add',[row('VALE3',i+1,10*(i+1))])))}finally{await Promise.all(clients.map(db=>db.end()))}
      const p=(await c.query('select * from carteira where user_id=$1',[other])).rows[0]
      assert.equal(Number(p.cotas),3);assert.equal(Number(p.preco_medio),16.6667)
    })
    await t.test('anônimo, sem perfil, dados inválidos e alteração de outra conta recusados',async()=>{
      for(const [who,role] of [[owner,'anon'],[null,'authenticated'],[randomUUID(),'authenticated']])await assert.rejects(mutate(c,who,'add',[row()],null,randomUUID(),role),{code:'42501'})
      for(const entries of [[],[row('BAD<script>')],[row('PETR4',-1)],[{...row(),data:'2026-02-30'}],[{...row(),cotas:null}]])await assert.rejects(mutate(c,owner,'add',entries))
      const foreign=(await c.query('select id from aportes where user_id=$1 limit 1',[other])).rows[0].id
      await assert.rejects(mutate(c,owner,'remove_aporte',[],foreign),{code:'22023'})
      await c.query('begin');try{await c.query('set local role authenticated');await assert.rejects(c.query('select * from invexa_private.portfolio_requests'),{code:'42501'})}finally{await c.query('rollback')}
    })
    await t.test('excluir último aporte desativa ativo; aporte manual reativa; reset isola conta',async()=>{
      const ids=(await c.query("select id from aportes where user_id=$1 and ticker='MXRF11'",[owner])).rows
      for(const {id} of ids)await mutate(c,owner,'remove_aporte',[],id)
      assert.equal((await c.query("select ativo from carteira where user_id=$1 and ticker='MXRF11'",[owner])).rows[0].ativo,false)
      await mutate(c,owner,'add',[row('MXRF11',1,15)])
      const p=(await c.query("select * from carteira where user_id=$1 and ticker='MXRF11'",[owner])).rows[0]
      assert.equal(p.ativo,true);assert.equal(Number(p.cotas),1)
      await mutate(c,owner,'remove_ativo',[],p.id)
      assert.equal((await c.query("select count(*)::int n from aportes where user_id=$1 and ticker='MXRF11'",[owner])).rows[0].n,0)
      await mutate(c,owner,'reset')
      assert.equal((await c.query('select count(*)::int n from aportes where user_id=$1',[owner])).rows[0].n,0)
      assert.equal((await c.query('select count(*)::int n from carteira where user_id=$1 and ativo',[other])).rows[0].n,1)
    })
  }finally{await c?.end();try{if(process.env.KEEP_TEST_DATABASE!=='1')await admin.query(`drop database if exists ${name}`)}finally{await admin.end()}}
})
