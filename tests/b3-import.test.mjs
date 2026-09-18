import test from 'node:test'
import assert from 'node:assert/strict'
import {parseB3Rows,b3Number,importWarnings} from '../b3-import.js'
const header=['Entrada/Saída','Data','Movimentação','Produto','Instituição','Quantidade','Preço unitário','Valor da Operação']
const row=(mov='Transferência - Liquidação',qty=2,price=20,product='TEST3 - Empresa')=>['Credito','05/02/2024',mov,product,'Corretora S/A.',qty,price,40]
test('compra e desdobro preservam custo; atualização, empréstimo e Tesouro são informados',()=>{
  const result=parseB3Rows([header,row(),row('Desdobro',4,'-'),row('Atualização',6,'-'),row('Empréstimo',6,'-'),row('Compra',.01,1000,'Tesouro Educa+ 2027'),['Debito',...row().slice(1)]])
  assert.equal(result.entries.length,2);assert.equal(result.entries[1].kind,'split');assert.equal(result.entries[1].cotas,4);assert.equal(result.entries[1].total,0)
  assert.equal(result.entries[0].instituicao,'CORRETORASA');assert.equal(result.entries[0].total,40)
  assert.equal(result.ignored.reduce((n,r)=>n+r.lines.length,0),4);assert.match(importWarnings(result.ignored),/renda fixa/)
})
test('compras idênticas são preservadas; cabeçalho, números e datas são validados',()=>{
  assert.equal(parseB3Rows([header,row(),row()]).entries.length,2)
  assert.throws(()=>parseB3Rows([['Arquivo incorreto'],row()]))
  assert.equal(b3Number('1.234,56'),1234.56);assert.equal(b3Number(12.34),12.34);assert.ok(Number.isNaN(b3Number('12abc')))
  const invalid=row();invalid[1]='30/02/2024'
  const serial=row();serial[1]=45327
  const result=parseB3Rows([header,invalid,serial,row('Desdobro',-2,'-')])
  assert.equal(result.entries.length,1);assert.equal(result.entries[0].data,'2024-02-05')
})
