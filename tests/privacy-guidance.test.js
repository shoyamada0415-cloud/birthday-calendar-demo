import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupSettingsSections} from '../src/settings-ui.js';
import {setLanguage,t,applyStaticTranslations} from '../src/i18n.js';

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.childNodes=[];this.dataset={};this.attributes={};this.listeners={};}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(key,fn){this.listeners[key]=fn;}
}
function fixture(){
  const view=new Element(),cards=Array.from({length:5},()=>new Element());
  view.querySelectorAll=()=>cards;view.querySelector=()=>new Element();
  const doc={documentElement:{},getElementById:()=>view,createElement:tag=>new Element(tag)};
  doc.querySelectorAll=selector=>{if(selector==='[data-tab]')return Array.from({length:5},()=>new Element());if(selector==='#person-form .section-heading h3')return [new Element(),new Element()];const nodes=[];function walk(n){if(selector==='[data-section-key]'&&n.dataset.sectionKey||selector==='[data-guidance-key]'&&n.dataset.guidanceKey)nodes.push(n);n.children.forEach(walk);}walk(view);return nodes;};
  doc.querySelector=()=>new Element();
  return {view,doc};
}
test('guidance uses the existing accessible disclosure without forms, links or HTML injection',()=>{
  const old=globalThis.document,{view,doc}=fixture();globalThis.document=doc;
  try{setupSettingsSections(key=>key);assert.equal(view.children.length,7);
    const section=view.children.find(n=>n.id==='data-privacy-section');assert.ok(section);
    assert.equal(section.children[0].tagName,'summary');assert.equal(section.children[0].attributes['aria-expanded'],'false');
    section.open=true;section.listeners.toggle();assert.equal(section.children[0].attributes['aria-expanded'],'true');
    const body=section.children[1];assert.equal(body.children.length,10);assert.deepEqual(body.children.map(n=>n.tagName),Array.from({length:5},()=>['h3','p']).flat());
    assert.ok(body.children.every(n=>n.textContent===n.dataset.guidanceKey));
  }finally{globalThis.document=old;}
});
test('all guidance resources are bilingual and language switching updates existing nodes',()=>{
  const old=globalThis.document,{view,doc}=fixture();globalThis.document=doc;
  try{setLanguage('ja');setupSettingsSections(t);const section=view.children.find(n=>n.id==='data-privacy-section'),nodes=section.children[1].children;
    assert.equal(t('dataPrivacyTitle'),'データとプライバシー');assert.match(nodes[5].textContent,/暗号化されていません/);
    setLanguage('en');applyStaticTranslations();assert.equal(section.children[0].children[0].textContent,'Data and privacy');
    assert.match(nodes[5].textContent,/not encrypted/);assert.match(nodes[7].textContent,/completely replaces/);assert.match(nodes[1].textContent,/no automatic cloud sync or automatic backup/);
    for(const n of nodes){assert.notEqual(n.textContent,n.dataset.guidanceKey);assert.doesNotMatch(n.textContent,/https?:|mailto:|<[^>]+>/);}
    setLanguage('ja');applyStaticTranslations();assert.equal(section.children[1].children[0],nodes[0]);assert.match(nodes[7].textContent,/完全置換/);
  }finally{setLanguage('ja');globalThis.document=old;}
});
test('guidance is display-only: no persistence, external requests or contact widgets',()=>{
  const code=readFileSync(new URL('../src/settings-ui.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/innerHTML|fetch\(|XMLHttpRequest|indexedDB|localStorage|https:\/\/|mailto:/);
  const css=readFileSync(new URL('../src/demo.css',import.meta.url),'utf8');assert.match(css,/\.data-privacy-guide\s*\{[^}]*overflow-wrap:anywhere/);
});
test('the guidance keeps the anonymous application, database and backup versions stable',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));assert.equal(pkg.version,'1.0.0-demo.1');
  const db=readFileSync(new URL('../src/db.js',import.meta.url),'utf8');assert.match(db,/DB_VERSION\s*=\s*3/);
  const backup=readFileSync(new URL('../src/backup.js',import.meta.url),'utf8');assert.match(backup,/FORMAT_VERSION\s*=\s*1/);
});
