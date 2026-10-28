import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CATEGORIES,normalizePerson,filterPeople} from '../src/model.js';
import {setLanguage,categoryLabel,t} from '../src/i18n.js';
import {openDatabase,savePerson,all} from '../src/db.js';
import {createBackup,inspectBackup,restoreBackup} from '../src/backup.js';

test('カテゴリ表示名だけを日英で変更し他カテゴリを維持する',()=>{
  const previous=globalThis.document;globalThis.document={documentElement:{lang:'ja'}};
  try{setLanguage('ja');assert.equal(categoryLabel('REAL_FRIEND'),'現実の知り合い');assert.equal(categoryLabel('PET'),'ペット');assert.equal(t('addPerson'),'＋ 人物を追加');
    setLanguage('en');assert.equal(categoryLabel('REAL_FRIEND'),'In-person acquaintances');assert.equal(categoryLabel('PET'),'Pet');assert.equal(t('addPerson'),'+ Add person');
  }finally{setLanguage('ja');globalThis.document=previous;}
  assert.deepEqual(Object.keys(CATEGORIES),['X_FRIEND','REAL_FRIEND','CHARACTER','PET','OTHER']);
});
test('既存REAL_FRIENDは名前の編集・検索・分類絞り込みで維持される',()=>{
  const p=normalizePerson({displayName:'架空の知人',category:'REAL_FRIEND',memo:'仕事関係',anniversaries:[],links:[]});
  const edited=normalizePerson({...p,displayName:'架空の知人・編集'},p);
  assert.equal(edited.category,'REAL_FRIEND');
  assert.equal(filterPeople([edited],{category:'REAL_FRIEND',search:'仕事'}).length,1);
  assert.equal(filterPeople([edited],{category:'PET'}).length,0);
});
test('DB v3とZIP v1は旧カテゴリ値REAL_FRIENDを往復で保持する',async()=>{
  const db=await openDatabase(`nav-category-${crypto.randomUUID()}`);
  try{await savePerson(db,{displayName:'架空の知人',category:'REAL_FRIEND',anniversaries:[],links:[]});
    const before=await all(db,'people');const zip=await createBackup(db);const inspected=await inspectBackup(zip);
    await restoreBackup(db,inspected);assert.equal(db.version,3);assert.deepEqual(await all(db,'people'),before);
  }finally{db.close();}
});
test('人物追加は月間カレンダーと人物欄の間で既存フォームを使い、ナビは従来の5項目',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const nav=html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]),['home','calendar','people','birthdays','settings']);
  assert.equal((nav.match(/<button /g)||[]).length,5);assert.ok(!html.includes('id="home-add"'));assert.ok(!html.includes('id="nav-add"'));
  const calendar=html.match(/<section class="view" id="view-calendar"[\s\S]*?<\/section>/)[0];
  assert.match(calendar,/id="calendar-grid"[^]*?<\/div><\/div>\s*<button class="quiet calendar-add" id="calendar-add"[^]*?<\/button>\s*<aside class="panel people-rail"/);
  assert.match(calendar,/id="calendar-add" type="button" aria-haspopup="dialog" aria-controls="person-dialog"/);
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(app,/\['calendar-add', 'people-add'\].*openForm\(\)/);
});
test('追加ボタンを重複せず、DOMとPC・スマホの表示順を一致させる',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal((html.match(/id="calendar-add"/g)||[]).length,1);
  const css=readFileSync(new URL('../src/demo.css',import.meta.url),'utf8');
  assert.match(css,/#view-calendar \.calendar-layout \{ grid-template-columns:minmax\(0,1fr\)/);
  for(const [name,order] of [['calendar-panel',0],['calendar-add',1],['people-rail',2]])
    assert.match(css,new RegExp('#view-calendar \\.'+name+' \\{ order:'+order+';'));
});
test('カレンダーの追加ボタンは幅80%・中央・48px・文字折返しなし',()=>{
  const css=readFileSync(new URL('../src/demo.css',import.meta.url),'utf8');
  const rule=css.match(/#view-calendar \.calendar-add \{([^}]+)\}/)[1];
  for(const declaration of ['width:80%','justify-self:center','height:48px','min-height:48px',
    'align-items:center','justify-content:center','text-align:center','white-space:nowrap'])
    assert.ok(rule.includes(declaration),declaration);
});
