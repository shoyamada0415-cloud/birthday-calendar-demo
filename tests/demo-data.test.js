import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,all,get,savePerson,saveLanguage,loadLanguage} from '../src/db.js';
import {demoPeople,ensureDemoData,resetDemoData,DEMO_MARKER_KEY} from '../src/demo-data.js';

const fresh = () => openDatabase(`demo-test-${crypto.randomUUID()}`);

async function clearPeople(db) {
  await new Promise((resolve,reject) => {
    const tx=db.transaction('people','readwrite');tx.objectStore('people').clear();
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}

test('初回の空DBにだけ架空の5人を登録する',async()=>{
  const db=await fresh();
  assert.deepEqual(await ensureDemoData(db),{seeded:true,people:5});
  const people=await all(db,'people');
  assert.deepEqual(people.map(p=>[p.displayName,p.anniversaries[0].month,p.anniversaries[0].day]).sort(),[
    ['伊藤 あおい',10,30],['佐藤 はるか',1,15],['田中 みさき',5,22],['鈴木 けんた',3,8],['高橋 そうた',7,7],
  ].sort());
  assert.equal((await get(db,'settings',DEMO_MARKER_KEY)).value.version,1);
  db.close();
});

test('再起動相当の再実行で編集内容を上書きせず、全削除後も勝手に再投入しない',async()=>{
  const db=await fresh();await ensureDemoData(db);
  const person=(await all(db,'people'))[0];await savePerson(db,{...person,memo:'編集を保持'});
  assert.equal((await ensureDemoData(db)).seeded,false);
  assert.equal((await get(db,'people',person.id)).memo,'編集を保持');
  await clearPeople(db);await ensureDemoData(db);assert.equal((await all(db,'people')).length,0);
  db.close();
});

test('既存人物があるDBは初期データで置換しない',async()=>{
  const db=await fresh();
  await savePerson(db,{displayName:'既存の人物',category:'OTHER',anniversaries:[],links:[]});
  assert.deepEqual(await ensureDemoData(db),{seeded:false,people:1});
  assert.deepEqual((await all(db,'people')).map(p=>p.displayName),['既存の人物']);
  db.close();
});

test('Demo初期化は人物・画像・通知を戻し、表示言語を保持する',async()=>{
  const db=await fresh();await ensureDemoData(db);await saveLanguage(db,'en');
  const person=(await all(db,'people'))[0];
  await savePerson(db,{...person,displayName:'変更済み'},{image:new Blob(['demo'],{type:'image/png'})});
  const count=await resetDemoData(db);
  assert.equal(count,5);assert.deepEqual((await all(db,'people')).map(p=>p.displayName).sort(),demoPeople().map(p=>p.displayName).sort());
  assert.equal((await all(db,'images')).length,0);assert.equal((await all(db,'notifications')).length,0);
  assert.equal(await loadLanguage(db),'en');db.close();
});
