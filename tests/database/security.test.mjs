import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const connectionString=process.env.LOCAL_TEST_DATABASE_URL
if(!connectionString) throw Error('Defina LOCAL_TEST_DATABASE_URL para um PostgreSQL local descartável.')
const url=new URL(connectionString)
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw Error('Testes aceitam somente PostgreSQL local; nunca use o banco ativo.')
const dbName=`invexa_security_test_${process.pid}_${Date.now()}`
const admin=new pg.Client({connectionString})
const dbUrl=new URL(url);dbUrl.pathname='/'+dbName
let db
async function connect(){const c=new pg.Client({connectionString:dbUrl.href});await c.connect();return c}
async function asRole(role,id,query,params=[]){
  await db.query('begin')
  try{
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||''])
    await db.query(`set local role ${role}`)
    return await db.query(query,params)
  }finally{await db.query('rollback')}
}
async function createUser(client,code,{id=randomUUID(),email=`${randomUUID()}@example.test`,extra={}}={}){
  await client.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)',[id,email,{invite_code:code,nome:'Pessoa Teste',...extra}])
  return id
}
async function invite(code,overrides={}){
  const id=randomUUID()
  await db.query('insert into public.convites(id,codigo,ativo,usado_em) values ($1,$2,$3,$4)',[id,code,overrides.ativo??true,overrides.usado_em??null])
  return id
}
async function count(table,where='',params=[]){return Number((await db.query(`select count(*) as n from ${table} ${where}`,params)).rows[0].n)}

test('segurança de cadastro e perfil em PostgreSQL isolado',async t=>{
  await admin.connect()
  await admin.query(`create database ${dbName}`)
  try{
    db=await connect()
    await db.query(fs.readFileSync(new URL('./baseline.sql',import.meta.url),'utf8'))
    const legacy=randomUUID()
    await db.query('insert into auth.users(id,email) values ($1,$2)',[legacy,'legacy@example.test'])
    await db.query("update public.profiles set plano='pro',nome='Legado' where id=$1",[legacy])
    const migration=fs.readFileSync(new URL('../../supabase/migrations/20260916222754_secure_invite_signup.sql',import.meta.url),'utf8')
    await db.query('begin')
    try{await db.query(migration);await db.query('commit')}catch(e){await db.query('rollback');throw e}

    await t.test('usuário existente e seu plano permanecem intactos',async()=>{
      assert.deepEqual((await db.query('select nome,plano from public.profiles where id=$1',[legacy])).rows[0],{nome:'Legado',plano:'pro'})
    })
    await t.test('sinal público de compatibilidade funciona sem acessar dados privados',async()=>{
      for(const role of ['anon','authenticated']){
        assert.equal((await asRole(role,null,'select public.invexa_signup_ready() as ready')).rows[0].ready,true)
      }
    })
    await t.test('cadastro sem convite é recusado mesmo fora do frontend',async()=>{
      const before=await count('auth.users')
      await assert.rejects(createUser(db,''),{code:'23514'})
      await assert.rejects(createUser(db,'INEXISTENTE'),{code:'23514'})
      await assert.rejects(createUser(db,'x'.repeat(129)),{code:'23514'})
      assert.equal(await count('auth.users'),before)
    })
    await t.test('convite inativo ou com data de uso não é aceito',async()=>{
      await invite('INATIVO',{ativo:false});await invite('JA-USADO',{usado_em:new Date()})
      await assert.rejects(createUser(db,'INATIVO'),{code:'23514'})
      await assert.rejects(createUser(db,'JA-USADO'),{code:'23514'})
    })
    let owner
    await t.test('Auth cria usuário, perfil gratuito e consome convite juntos',async()=>{
      await invite('VALIDO')
      await db.query('set role supabase_auth_admin')
      try{owner=await createUser(db,' valido ',{extra:{plano:'pro',is_admin:true}})}finally{await db.query('reset role')}
      assert.deepEqual((await db.query('select nome,plano,convite_usado from public.profiles where id=$1',[owner])).rows[0],{nome:'Pessoa Teste',plano:'gratuito',convite_usado:'VALIDO'})
      const invitation=(await db.query("select ativo,usado_por,usado_em from public.convites where codigo='VALIDO'")).rows[0]
      assert.equal(invitation.ativo,false);assert.equal(invitation.usado_por,owner);assert.ok(invitation.usado_em)
      await assert.rejects(createUser(db,'VALIDO'),{code:'23514'})
    })
    await t.test('falha no perfil desfaz usuário e preserva convite',async()=>{
      await invite('FALHA-PERFIL')
      const id=randomUUID()
      await assert.rejects(createUser(db,'FALHA-PERFIL',{id,email:'legacy@example.test'}),{code:'23505'})
      assert.equal(await count('auth.users','where id=$1',[id]),0)
      assert.equal(await count('public.profiles','where id=$1',[id]),0)
      const row=(await db.query("select ativo,usado_por from public.convites where codigo='FALHA-PERFIL'")).rows[0]
      assert.equal(row.ativo,true);assert.equal(row.usado_por,null)
    })
    await t.test('nome grande não consome convite nem cria conta',async()=>{
      await invite('NOME-GRANDE')
      await assert.rejects(createUser(db,'NOME-GRANDE',{extra:{nome:'x'.repeat(121)}}),{code:'23514'})
      assert.equal((await db.query("select ativo from public.convites where codigo='NOME-GRANDE'")).rows[0].ativo,true)
    })
    for(const role of ['anon','authenticated']){
      await t.test(`${role} não consulta nem altera convites`,async()=>{
        await assert.rejects(asRole(role,role==='anon'?null:owner,'select codigo from public.convites'),{code:'42501'})
        await assert.rejects(asRole(role,role==='anon'?null:owner,'update public.convites set ativo=true'),{code:'42501'})
        await assert.rejects(asRole(role,role==='anon'?null:owner,"insert into public.convites(codigo) values ('CRIADO-CLIENTE')"),{code:'42501'})
        await assert.rejects(asRole(role,role==='anon'?null:owner,'delete from public.convites'),{code:'42501'})
        await assert.rejects(asRole(role,role==='anon'?null:owner,'select invexa_private.handle_new_user()'),{code:'42501'})
      })
    }
    await t.test('perfil pode mudar nome, mas não plano, email, convite ou proprietário',async()=>{
      const updated=await asRole('authenticated',owner,"update public.profiles set nome='Novo nome' where id=$1 returning nome",[owner])
      assert.equal(updated.rows[0].nome,'Novo nome')
      for(const column of ['plano','email','convite_usado','id','criado_em']){
        await assert.rejects(asRole('authenticated',owner,`update public.profiles set ${column}=${column} where id=$1`,[owner]),{code:'42501'})
      }
      await assert.rejects(asRole('anon',null,'select * from public.profiles'),{code:'42501'})
      assert.equal((await asRole('authenticated',owner,'select id from public.profiles')).rows.length,1)
      assert.equal((await asRole('authenticated',owner,'update public.profiles set nome=$1 where id=$2',['Ataque',legacy])).rowCount,0)
      await assert.rejects(asRole('authenticated',owner,'delete from public.profiles where id=$1',[owner]),{code:'42501'})
    })
    await t.test('duas transações concorrentes não consomem o mesmo convite',async()=>{
      await invite('CONCORRENTE')
      const first=await connect(),second=await connect()
      let pending
      try{
        await first.query('begin');await second.query('begin')
        await second.query("set local statement_timeout='5s'")
        const winner=await createUser(first,'CONCORRENTE')
        const pid=(await second.query('select pg_backend_pid() as pid')).rows[0].pid
        pending=createUser(second,'CONCORRENTE').then(value=>({value}),error=>({error}))
        let blocked=false
        for(let i=0;i<50;i++){
          const waits=await db.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])
          if(waits.rows[0]?.wait_event_type==='Lock'){blocked=true;break}
          await new Promise(resolve=>setTimeout(resolve,20))
        }
        assert.equal(blocked,true,'segunda transação deve aguardar o lock do convite')
        await first.query('commit')
        const result=await pending
        assert.equal(result.error?.code,'23514')
        await second.query('rollback')
        assert.equal((await db.query("select usado_por from public.convites where codigo='CONCORRENTE'")).rows[0].usado_por,winner)
        assert.equal(await count('public.profiles',"where convite_usado='CONCORRENTE'"),1)
      }finally{
        await first.query('rollback').catch(()=>{});await second.query('rollback').catch(()=>{})
        if(pending)await pending
        await first.end();await second.end()
      }
    })
    await t.test('cancelamento da transação devolve o convite',async()=>{
      await invite('ROLLBACK')
      await db.query('begin');const id=await createUser(db,'ROLLBACK');await db.query('rollback')
      assert.equal(await count('auth.users','where id=$1',[id]),0)
      assert.equal((await db.query("select ativo from public.convites where codigo='ROLLBACK'")).rows[0].ativo,true)
      await createUser(db,'ROLLBACK')
    })
  }finally{
    if(db)await db.end()
    try{
      if(process.env.KEEP_TEST_DATABASE==='1') console.log(`Banco fictício preservado para inspeção: ${dbName}`)
      else await admin.query(`drop database ${dbName} with (force)`)
    }finally{await admin.end()}
  }
})
