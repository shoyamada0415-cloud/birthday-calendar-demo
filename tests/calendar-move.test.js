import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { movedPerson } from '../src/calendar-move.js';
import { openDatabase, savePerson, all, get } from '../src/db.js';
const sample = () => ({ displayName:'移動テスト', category:'PET', links:[], anniversaries:[
  {type:'BIRTHDAY', month:2, day:29, year:2000, showAge:true},
  {id:'first', type:'CUSTOM', title:'出会った日', month:2, day:29, year:2024, recurring:true, showAnniversary:true, notify:true},
  {id:'second', type:'CUSTOM', title:'一度きり', month:2, day:28, year:2027, recurring:false, showAnniversary:false, notify:false},
] });
test('誕生日移動は生年と年齢設定を保持し元データと別記念日を変更しない', () => {
  const person=sample(), before=structuredClone(person);
  const moved=movedPerson(person,'BIRTHDAY','2027-02-28','2027-12-31');
  assert.deepEqual(moved.anniversaries[0], {...person.anniversaries[0],month:12,day:31});
  assert.deepEqual(moved.anniversaries.slice(1), person.anniversaries.slice(1));
  assert.deepEqual(person,before);
});
test('同じ人物の記念日をIDで識別し、毎年型の起点年と通知設定を維持する', () => {
  const person=sample(), moved=movedPerson(person,'first','2027-02-28','2027-03-01');
  assert.deepEqual(moved.anniversaries[1], {...person.anniversaries[1],month:3,day:1});
  assert.deepEqual(moved.anniversaries[0],person.anniversaries[0]);
  assert.deepEqual(moved.anniversaries[2],person.anniversaries[2]);
});
test('一度きりの記念日は移動先の年・月・日を使う', () => {
  const moved=movedPerson(sample(),'second','2027-02-28','2028-01-01');
  assert.equal(moved.anniversaries[2].year,2028);
  assert.equal(moved.anniversaries[2].month,1);
  assert.equal(moved.anniversaries[2].day,1);
  assert.equal(moved.anniversaries[2].recurring,false);
});
test('同じ表示日への移動は2/29の平年表示でも何も変更しない', () => {
  assert.equal(movedPerson(sample(),'BIRTHDAY','2027-02-28','2027-02-28'),null);
});
test('存在しない予定ID・古い元日付・不正移動先を拒否する', () => {
  for(const [key,from,to] of [['missing','2027-02-28','2027-03-01'],['first','2027-02-27','2027-03-01'],['first','2027-02-28','2027-02-30']]) {
    assert.throws(()=>movedPerson(sample(),key,from,to));
  }
});
test('年なし記念日・年末年始・うるう日を移動できる', () => {
  const person=sample(); person.anniversaries[1].year=null;
  const moved=movedPerson(person,'first','2028-02-29','2028-12-31');
  assert.equal(moved.anniversaries[1].year,null);
  assert.equal(movedPerson(moved,'first','2028-12-31','2029-01-01').anniversaries[1].day,1);
});
test('既存savePersonで移動すると対象通知のみ整理され画像を保持する', async () => {
  const db=await openDatabase(`move-${crypto.randomUUID()}`);
  const input=sample(), first=crypto.randomUUID(), second=crypto.randomUUID();
  input.anniversaries[1].id=first; input.anniversaries[2].id=second;
  const person=await savePerson(db,input,{image:new Blob(['test'],{type:'image/png'})});
  const tx=db.transaction('notifications','readwrite');
  tx.objectStore('notifications').put({id:'one',personId:person.id,anniversaryId:first});
  tx.objectStore('notifications').put({id:'two',personId:person.id,anniversaryId:second});
  await new Promise((done,fail)=>{tx.oncomplete=done;tx.onabort=fail;});
  await savePerson(db,movedPerson(person,first,'2027-02-28','2027-03-01'));
  assert.deepEqual((await all(db,'notifications')).map(item=>item.id),['two']);
  assert.equal((await get(db,'images',person.id)).blob.size,4);
  assert.equal((await get(db,'people',person.id)).anniversaries[1].day,1);
  db.close();
});
