import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {birthdayYearChoices,monthDays,yearInputMode} from '../src/date-fields.js';
import {normalizePerson,birthdayOf} from '../src/model.js';
import {openDatabase,savePerson,get,DB_VERSION} from '../src/db.js';
import {createBackup,inspectBackup,restoreBackup,BACKUP_FORMAT_VERSION} from '../src/backup.js';
import {setLanguage,t,errorText} from '../src/i18n.js';
const person=year=>({displayName:'年の確認',anniversaries:[{type:'BIRTHDAY',month:5,day:10,year}]});
test('誕生年候補は現在年から120年前まで降順・範囲外は自由入力',()=>{
  const choices=birthdayYearChoices(2027);assert.equal(choices.length,121);assert.equal(choices[0],2027);assert.equal(choices.at(-1),1907);
  assert.equal(yearInputMode(1998,2027),'select');for(const year of [1500,2099,100,9999])assert.equal(yearInputMode(year,2027),'custom');
  assert.equal(yearInputMode(null,2027),'select');assert.equal(yearInputMode('',2027),'select');assert.equal(birthdayYearChoices(2028)[0],2028);
});
test('月日候補は月末を守り、2月29日を選択できる',()=>{
  assert.equal(monthDays(1).at(-1),31);assert.equal(monthDays(4).at(-1),30);assert.equal(monthDays(2).at(-1),29);
  assert.ok(!monthDays(2).includes(30));assert.ok(!monthDays(4).includes(31));
  assert.equal(monthDays('').length,31);
});
test('誕生年は100〜9999の整数・年なしを受け付け、月日を維持する',()=>{
  for(const year of [100,1500,1998,2099,9999,'1500']){const b=birthdayOf(normalizePerson(person(year)));assert.equal(b.year,Number(year));assert.equal(b.month,5);assert.equal(b.day,10);}
  for(const year of ['',null,undefined])assert.equal(birthdayOf(normalizePerson(person(year))).year,null);
});
test('不正な年・実在しない日付を拒否し、記念日の従来の年範囲を保つ',()=>{
  for(const year of [0,99,10000,-1,1500.5,'abc','1e3','Infinity',[],['1500'],true])assert.throws(()=>normalizePerson(person(year)));
  const make=(month,day,year)=>normalizePerson({displayName:'日付',anniversaries:[{type:'CUSTOM',title:'記念日',month,day,year}]});
  assert.throws(()=>make(2,30));assert.throws(()=>make(4,31));assert.throws(()=>make(2,29,2027));assert.doesNotThrow(()=>make(2,29));assert.doesNotThrow(()=>make(2,29,2024));assert.throws(()=>make(5,10,1500));
});
test('拡張した誕生年をDB v3とZIP v1で保存・再編集・完全復元する',async()=>{
  const db=await openDatabase('year-fields-'+crypto.randomUUID());
  assert.equal(db.version,DB_VERSION);assert.equal(DB_VERSION,3);
  for(const year of [1500,2099,null]){
    const saved=await savePerson(db,person(year));assert.equal(birthdayOf(await get(db,'people',saved.id)).year,year);
    const zip=await inspectBackup(await createBackup(db));assert.equal(zip.manifest.formatVersion,BACKUP_FORMAT_VERSION);assert.equal(BACKUP_FORMAT_VERSION,1);
    await savePerson(db,{...saved,anniversaries:[{...saved.anniversaries[0],year:1998}]});await restoreBackup(db,zip);
    assert.equal(birthdayOf(await get(db,'people',saved.id)).year,year);
  }db.close();
});
test('入力方式と不正年の案内は日本語とEnglishで切り替わる',()=>{
  const previous=globalThis.document;globalThis.document={documentElement:{lang:'ja'}};
  try{setLanguage('ja');assert.equal(t('yearCustomMode'),'自由入力');assert.match(errorText(new Error('birthYearInvalid')),/100〜9999/);
    setLanguage('en');assert.equal(t('yearSelectMode'),'Select a year');assert.match(errorText(new Error('birthYearInvalid')),/whole calendar year/);
  }finally{setLanguage('ja');globalThis.document=previous;}
});
