import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase,savePerson,deletePeople,all,get} from '../src/db.js';
import {sortedRailPeople} from '../src/rail-management.js';
const rows=[{id:'b',displayName:'Beta',createdAt:'2024-01-01',anniversaries:[{type:'BIRTHDAY',month:1,day:1}]},{id:'a',displayName:'Alpha',createdAt:'2025-01-01',anniversaries:[{type:'BIRTHDAY',month:12,day:31}]},{id:'c',displayName:'Gamma',createdAt:'2023-01-01',anniversaries:[]}];
for(const [sort,expected] of [['nameAsc',['a','b','c']],['nameDesc',['c','b','a']],['birthday',['a','b','c']],['newest',['a','b','c']],['oldest',['c','b','a']]])test('人物欄の表示専用ソート: '+sort,()=>{
  const before=structuredClone(rows);assert.deepEqual(sortedRailPeople(rows,sort,'2028-12-30','en').map(p=>p.id),expected);assert.deepEqual(rows,before);
});
test('誕生日順は当日・平年2/29・未登録と同日名前順を既存ルールで扱う',()=>{
  const people=[{...rows[0],anniversaries:[{type:'BIRTHDAY',month:2,day:29}]},{...rows[1],anniversaries:[{type:'BIRTHDAY',month:2,day:28}]},rows[2]];
  assert.deepEqual(sortedRailPeople(people,'birthday','2027-02-28','en').map(p=>p.id),['a','b','c']);
});
async function fixture(){const db=await openDatabase('bulk-'+crypto.randomUUID());const people=[];
  for(const name of ['A','B','C'])people.push(await savePerson(db,{displayName:name,category:'OTHER',memo:name,anniversaries:[{type:'BIRTHDAY',month:5,day:10,year:2000},{id:crypto.randomUUID(),type:'CUSTOM',title:'架空記念日',month:6,day:1,recurring:true,notify:true}],links:[]},{image:new Blob([name],{type:'image/png'})}));
  const tx=db.transaction(['notifications','settings'],'readwrite');for(const p of people)tx.objectStore('notifications').put({id:p.id,personId:p.id,readAt:null});tx.objectStore('settings').put({key:'language',value:'en'});await new Promise((done,fail)=>{tx.oncomplete=done;tx.onabort=()=>fail(tx.error);});return{db,people};}
test('一括削除は人物内記念日・画像・通知を削除し他人物と設定を保持する',async()=>{const {db,people:[a,b,c]}=await fixture();try{
  await deletePeople(db,[a.id,b.id,a.id]);assert.deepEqual((await all(db,'people')).map(p=>p.id),[c.id]);assert.equal((await all(db,'images')).length,1);assert.equal((await all(db,'notifications')).length,1);assert.equal((await get(db,'people',c.id)).anniversaries.length,2);assert.equal((await get(db,'settings','language')).value,'en');assert.equal(db.version,3);
}finally{db.close();}});
test('対象欠落時は一括削除全体をロールバックする',async()=>{const {db,people}=await fixture();try{const before=await Promise.all(['people','images','notifications','settings'].map(s=>all(db,s)));
  await assert.rejects(deletePeople(db,[people[0].id,crypto.randomUUID()]));assert.deepEqual(await Promise.all(['people','images','notifications','settings'].map(s=>all(db,s))),before);
}finally{db.close();}});
test('途中でtransactionがabortしても一人も削除しない',async()=>{const {db,people}=await fixture();const original=db.transaction;try{
  const before=await Promise.all(['people','images','notifications'].map(s=>all(db,s)));
  db.transaction=function(...args){const tx=original.apply(this,args);if(args[1]==='readwrite')tx.objectStore('images').delete=()=>{tx.abort();};return tx;};
  await assert.rejects(deletePeople(db,people.map(p=>p.id)));db.transaction=original;assert.deepEqual(await Promise.all(['people','images','notifications'].map(s=>all(db,s))),before);
}finally{db.transaction=original;db.close();}});
test('空の一括選択は削除しない',async()=>{const {db}=await fixture();try{await assert.rejects(deletePeople(db,[]));assert.equal((await all(db,'people')).length,3);}finally{db.close();}});
test('日付セル内メニューを生成せず人物欄メニューと一括ドラッグガードを維持する',()=>{
  const app=readFileSync('src/app.js','utf8');assert.doesNotMatch(app,/cell\.append\(personMenuTrigger/);assert.match(app,/wrap\.append\(button,personMenuTrigger/);assert.match(app,/enabled:\(\)=>!state\.railBulk/);assert.match(app,/if\(state\.railBulk\)return/);
});
