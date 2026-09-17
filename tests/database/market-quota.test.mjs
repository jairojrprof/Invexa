import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url=new URL(process.env.LOCAL_TEST_DATABASE_URL || 'http://invalid')
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Use LOCAL_TEST_DATABASE_URL com PostgreSQL local descartável.')
const name=`invexa_market_test_${process.pid}_${Date.now()}`
const admin=new pg.Client({connectionString:url.href})
const local=new URL(url);local.pathname='/'+name
const migration=fs.readFileSync(new URL('../../supabase/migrations/20260917151704_protect_market_api.sql',import.meta.url),'utf8')
async function connection(){const c=new pg.Client({connectionString:local.href});await c.connect();return c}
async function asUser(db,id,kind='quote',cost=1,role='authenticated'){
  await db.query('begin')
  try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||''])
    await db.query(`set local role ${role}`)
    const r=await db.query('select public.consume_market_quota($1,$2) as quota',[kind,cost])
    await db.query('commit');return r.rows[0].quota
  }catch(e){await db.query('rollback');throw e}
}
test('quota de mercado em PostgreSQL real',async t=>{
  await admin.connect();let db
  try{
    await admin.query(`create database ${name}`);db=await connection()
    await db.query(fs.readFileSync(new URL('./baseline.sql',import.meta.url),'utf8'))
    const owner=randomUUID(),other=randomUUID()
    for(const id of [owner,other])await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@example.test'])
    await db.query(fs.readFileSync(new URL('../../supabase/migrations/20260916225659_secure_invite_signup.sql',import.meta.url),'utf8'))
    await db.query('begin');try{await db.query(migration);await db.query('commit')}catch(e){await db.query('rollback');throw e}
    await t.test('anônimo, sem identidade e usuário sem perfil não consomem quota',async()=>{
      for(const [id,role] of [[owner,'anon'],[null,'authenticated'],[randomUUID(),'authenticated']])await assert.rejects(asUser(db,id,'quote',1,role),{code:'42501'})
      assert.equal((await db.query('select count(*)::int as n from invexa_private.market_usage')).rows[0].n,0)
    })
    await t.test('custo nulo, negativo, zero, excessivo ou operação desconhecida são recusados',async()=>{
      for(const [kind,cost] of [['quote',null],['quote',-1],['quote',0],['quote',11],['dividends',2],['invalid',1],[null,1]])await assert.rejects(asUser(db,owner,kind,cost),{code:'22023'})
    })
    await t.test('limite por minuto, custo por ticker e isolamento entre usuários',async()=>{
      for(let i=0;i<12;i++)assert.equal((await asUser(db,owner,'quote',10)).allowed,true)
      const denied=await asUser(db,owner);assert.equal(denied.allowed,false);assert.ok(denied.retry_after>0&&denied.retry_after<=60)
      assert.equal((await asUser(db,other)).allowed,true)
      assert.equal((await db.query("select minute_used from invexa_private.market_usage where user_id=$1 and kind='quote'",[owner])).rows[0].minute_used,120)
    })
    await t.test('limite diário permanece após virar o minuto e libera no dia seguinte',async()=>{
      await db.query("update invexa_private.market_usage set minute_start=now()-interval '2 minutes',day_used=1200 where user_id=$1",[owner])
      const denied=await asUser(db,owner);assert.equal(denied.allowed,false);assert.ok(denied.retry_after>0&&denied.retry_after<=86400)
      await db.query("update invexa_private.market_usage set day_start=now()-interval '2 days' where user_id=$1",[owner])
      assert.equal((await asUser(db,owner,'quote',10)).allowed,true)
      assert.equal((await db.query('select day_used from invexa_private.market_usage where user_id=$1',[owner])).rows[0].day_used,10)
    })
    await t.test('dividendos têm cota independente de cotações',async()=>{
      for(let i=0;i<30;i++)assert.equal((await asUser(db,owner,'dividends')).allowed,true)
      assert.equal((await asUser(db,owner,'dividends')).allowed,false)
      assert.equal((await asUser(db,owner,'quote')).allowed,true)
    })
    await t.test('usuário não lê, altera ou remove o contador nem executa trigger de cadastro',async()=>{
      for(const sql of ['select * from invexa_private.market_usage',"update invexa_private.market_usage set day_used=0",'delete from invexa_private.market_usage',"insert into invexa_private.market_usage(user_id,kind,minute_start,day_start) values(gen_random_uuid(),'quote',now(),now())",'select invexa_private.handle_new_user()']){
        await db.query('begin');try{await db.query('set local role authenticated');await assert.rejects(db.query(sql),{code:'42501'})}finally{await db.query('rollback')}
      }
    })
    await t.test('requisições em conexões concorrentes não ultrapassam a última unidade diária',async()=>{
      await db.query("update invexa_private.market_usage set day_used=1199,minute_used=0 where user_id=$1 and kind='quote'",[owner])
      const clients=await Promise.all(Array.from({length:8},connection))
      try{const result=await Promise.all(clients.map(c=>asUser(c,owner)));assert.equal(result.filter(r=>r.allowed).length,1)}finally{await Promise.all(clients.map(c=>c.end()))}
      assert.equal((await db.query("select day_used from invexa_private.market_usage where user_id=$1 and kind='quote'",[owner])).rows[0].day_used,1200)
    })
  }finally{
    await db?.end()
    try{if(process.env.KEEP_TEST_DATABASE!=='1')await admin.query(`drop database if exists ${name}`)}finally{await admin.end()}
  }
})
