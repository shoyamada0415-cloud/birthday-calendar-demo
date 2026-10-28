import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {menuPosition} from '../src/person-menu.js';
import {birthdayAssignedPerson} from '../src/calendar-move.js';
import {openDatabase,savePerson,get,all,deletePerson} from '../src/db.js';
import {setLanguage,t} from '../src/i18n.js';

test('メニューは人物付近の下へ表示する',()=>{
  assert.deepEqual(menuPosition({left:40,bottom:100},{width:220,height:150},{width:390,height:844}),{left:40,top:104});
});
test('右下端のメニューは画面内へ移す',()=>{
  const p=menuPosition({left:375,bottom:830},{width:220,height:150},{width:390,height:844});
  assert.deepEqual(p,{left:162,top:686});
});
test('320pxの左上端でもメニューの余白を保つ',()=>{
  const p=menuPosition({left:-10,bottom:-10},{width:220,height:150},{width:320,height:640});
  assert.deepEqual(p,{left:8,top:8});
});
const fixture=()=>({displayName:'架空の操作対象',category:'REAL_FRIEND',memo:'保持するメモ',links:[],anniversaries:[
  {id:crypto.randomUUID(),type:'CUSTOM',title:'出会い',month:3,day:4,year:2024,recurring:true,showAnniversary:true,notify:true},
]});
test('未登録人物への割当は誕生日だけ追加し元データを変えない',()=>{
  const person=fixture(),before=structuredClone(person),changed=birthdayAssignedPerson(person,2,29);
  assert.deepEqual(person,before);assert.deepEqual(changed.anniversaries[0],{type:'BIRTHDAY',month:2,day:29,year:null,showAge:false});
  assert.deepEqual(changed.anniversaries.slice(1),before.anniversaries);assert.equal(changed.memo,before.memo);
});
test('登録済みの割当は生年・年齢表示・別記念日を保持する',()=>{
  const person=fixture();person.anniversaries.unshift({type:'BIRTHDAY',month:1,day:2,year:1998,showAge:true});
  const changed=birthdayAssignedPerson(person,12,31);assert.equal(changed.anniversaries[0].year,1998);assert.equal(changed.anniversaries[0].showAge,true);
  assert.deepEqual(changed.anniversaries.slice(1),person.anniversaries.slice(1));assert.equal(changed.anniversaries.length,2);
});
test('既存savePersonで画像を保持し、無効な日付は元データを保持する',async()=>{
  const db=await openDatabase(`actions-${crypto.randomUUID()}`);
  try{const person=await savePerson(db,fixture(),{image:new Blob(['image'],{type:'image/png'})});
    await savePerson(db,birthdayAssignedPerson(person,5,10));const saved=await get(db,'people',person.id);
    assert.equal((await get(db,'images',person.id)).blob.size,5);assert.equal(db.version,3);
    await assert.rejects(savePerson(db,birthdayAssignedPerson(saved,2,30)));assert.deepEqual(await get(db,'people',person.id),saved);
  }finally{db.close();}
});
test('既存deletePersonで対象人物・画像だけを削除し別人物を保持する',async()=>{
  const db=await openDatabase(`delete-actions-${crypto.randomUUID()}`);
  try{const a=await savePerson(db,fixture(),{image:new Blob(['a'],{type:'image/png'})});const b=await savePerson(db,{...fixture(),displayName:'別の架空人物'});
    await deletePerson(db,a.id);assert.equal((await all(db,'people')).length,1);assert.equal((await get(db,'people',b.id)).displayName,b.displayName);assert.equal((await all(db,'images')).length,0);
  }finally{db.close();}
});
test('人物操作メニューは日英で意味を保つ',()=>{
  const previous=globalThis.document;globalThis.document={documentElement:{lang:'ja'}};
  try{setLanguage('ja');assert.equal(t('menuMoveDate'),'日付を移動');assert.equal(t('menuDeletePerson'),'人物を削除');
    setLanguage('en');assert.equal(t('menuMoveDate'),'Move date');assert.equal(t('menuEditPerson'),'Edit person');assert.equal(t('personActions',{name:'A'}),'Actions for A');
  }finally{setLanguage('ja');globalThis.document=previous;}
});
