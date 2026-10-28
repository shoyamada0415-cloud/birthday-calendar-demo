import 'fake-indexeddb/auto';
import {imageFixture} from './helpers/image-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, savePerson, all, reorderDayEvents, get, deletePerson } from '../src/db.js';
import { calendarEvents } from '../src/model.js';
import { entryId, reorderedPeople } from '../src/calendar-order.js';
import { createBackup, inspectBackup, restoreBackup } from '../src/backup.js';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
const date='2028-05-10';
async function fixture(){
  const db=await openDatabase('order-'+crypto.randomUUID());
  const a=await savePerson(db,{displayName:'A',category:'OTHER',anniversaries:[{type:'BIRTHDAY',month:5,day:10,year:2000},
    {id:crypto.randomUUID(),type:'CUSTOM',title:'記念日',month:5,day:10,year:2020,notify:true}]},{image:imageFixture()});
  const b=await savePerson(db,{displayName:'B',category:'PET',anniversaries:[{type:'BIRTHDAY',month:5,day:10}]});
  return {db,a,b};
}
const entries=people=>calendarEvents(people,2028,5).get(date);
test('誕生日と同一人物の記念日を独立して並び替え、代表1件に反映',async()=>{
  const {db,a}=await fixture(),before=await all(db,'people'),ids=entries(before).map(entryId).reverse();
  await reorderDayEvents(db,date,ids);assert.deepEqual(entries(await all(db,'people')).map(entryId),ids);
  assert.equal(entryId(entries(await all(db,'people'))[0]),ids[0]);
  assert.equal((await get(db,'people',a.id)).anniversaries[0].year,2000);
  assert.deepEqual(await all(db,'images'),[{personId:a.id,blob:imageFixture(),type:'image/png'}]);db.close();
});
test('順序は再起動しても保持しDB v3を維持',async()=>{
  let {db}=await fixture();const name=db.name,ids=entries(await all(db,'people')).map(entryId).reverse();
  await reorderDayEvents(db,date,ids);db.close();db=await openDatabase(name);assert.equal(db.version,3);
  assert.deepEqual(entries(await all(db,'people')).map(entryId),ids);db.close();
});
test('フィルター非表示イベントの位置を維持し、同順の操作は書換えなし',async()=>{
  const {db}=await fixture(),people=await all(db,'people'),visible=entries(people).filter(e=>e.person.category==='OTHER').map(entryId);
  assert.deepEqual(reorderedPeople(people,date,visible),[]);
  const changed=reorderedPeople(people,date,visible.reverse()),next=people.map(p=>changed.find(c=>c.id===p.id)??p);
  assert.deepEqual(entries(next).filter(e=>e.person.category==='OTHER').map(entryId),visible);
  assert.equal(entries(next).findIndex(e=>e.person.category==='PET'),entries(people).findIndex(e=>e.person.category==='PET'));db.close();
});
test('不正・重複・削除済みイベントの並び替えは全件保持',async()=>{
  const {db}=await fixture(),before=await all(db,'people'),ids=entries(before).map(entryId);
  for(const bad of [[ids[0],ids[0]],['missing'],[],null])await assert.rejects(reorderDayEvents(db,date,bad));
  assert.deepEqual(await all(db,'people'),before);db.close();
});
test('編集で順序を保持し日付変更では古い順序を持ち越さない',async()=>{
  const {db,a}=await fixture();await reorderDayEvents(db,date,entries(await all(db,'people')).map(entryId).reverse());
  const p=await get(db,'people',a.id),rank=p.anniversaries[0].calendarOrder;
  let updated=await savePerson(db,{...p,displayName:'編集',anniversaries:p.anniversaries.map(({calendarOrder,...ann})=>ann)});
  assert.equal(updated.anniversaries[0].calendarOrder,rank);
  updated=await savePerson(db,{...updated,anniversaries:updated.anniversaries.map((ann,i)=>i?ann:{...ann,day:11})});
  assert.equal(updated.anniversaries[0].calendarOrder,undefined);db.close();
});
test('ZIP v1で順序を完全復元し旧ZIP相当の順序なし人物も受け入れる',async()=>{
  const {db,a}=await fixture(),ids=entries(await all(db,'people')).map(entryId).reverse();await reorderDayEvents(db,date,ids);
  const backup=await inspectBackup(await createBackup(db));assert.equal(backup.manifest.formatVersion,1);
  await deletePerson(db,a.id);await restoreBackup(db,backup);assert.deepEqual(entries(await all(db,'people')).map(entryId),ids);
  for(const p of backup.snapshot.people)for(const ann of p.anniversaries)delete ann.calendarOrder;
  await restoreBackup(db,backup);assert.equal((await all(db,'people')).length,2);db.close();
});
test('通知の既読・画像を変えず、不正な順序値も書込み前に拒否',async()=>{
  const {db,a}=await fixture(),tx=db.transaction('notifications','readwrite');tx.objectStore('notifications').put({id:'kept',personId:a.id,readAt:'2028-05-01'});
  await new Promise(done=>tx.oncomplete=done);const before=await all(db,'notifications');
  await reorderDayEvents(db,date,entries(await all(db,'people')).map(entryId).reverse());assert.deepEqual(await all(db,'notifications'),before);
  const person=await get(db,'people',a.id);await assert.rejects(savePerson(db,{...person,anniversaries:person.anniversaries.map(ann=>({...ann,calendarOrder:-1}))}));
  assert.deepEqual(await get(db,'people',a.id),person);db.close();
});
test('ZIPの不正な順序値はチェックサムが一致しても復元前に拒否',async()=>{
  const {db}=await fixture(),before=await all(db,'people'),files=unzipSync(new Uint8Array(await (await createBackup(db)).arrayBuffer()));
  const data=JSON.parse(strFromU8(files['data.json'])),manifest=JSON.parse(strFromU8(files['manifest.json']));
  data.people[0].anniversaries[0].calendarOrder=-1;files['data.json']=strToU8(JSON.stringify(data));
  const sha=await crypto.subtle.digest('SHA-256',files['data.json']);
  manifest.entries['data.json']={bytes:files['data.json'].length,sha256:[...new Uint8Array(sha)].map(v=>v.toString(16).padStart(2,'0')).join('')};
  files['manifest.json']=strToU8(JSON.stringify(manifest));await assert.rejects(inspectBackup(new Blob([zipSync(files)])),/orderInvalid/);
  assert.deepEqual(await all(db,'people'),before);db.close();
});
test('複数人物の並び替え保存が途中失敗した場合は全員元の順序',async()=>{
  const {db}=await fixture(),before=await all(db,'people'),transaction=db.transaction.bind(db);
  db.transaction=(...args)=>{const tx=transaction(...args);if(args[1]==='readwrite'){
    const store=tx.objectStore('people'),put=store.put.bind(store);let count=0;
    store.put=value=>{if(++count===2)throw new Error('simulated write failure');return put(value);};
  }return tx;};
  try{await assert.rejects(reorderDayEvents(db,date,entries(before).map(entryId).reverse()),/simulated/);}
  finally{db.transaction=transaction;}
  assert.deepEqual(await all(db,'people'),before);db.close();
});
