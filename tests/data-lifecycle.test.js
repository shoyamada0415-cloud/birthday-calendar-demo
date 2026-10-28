import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {openDatabase,all,STORES} from '../src/db.js';
import {clearManagedRecords,ownedCacheNames,isRetired,RETIRED_KEY,startDataSession,eraseManagedData} from '../src/data-lifecycle.js';
import {createBackup} from '../src/backup.js';
import {lifecycleMessages} from '../src/lifecycle-messages.js';
import {readFileSync} from 'node:fs';
globalThis.indexedDB=indexedDB;
async function fixture(){const db=await openDatabase('lifecycle-'+crypto.randomUUID());const tx=db.transaction(STORES,'readwrite');for(const name of STORES)tx.objectStore(name).put(name==='settings'?{key:'test',value:'dummy'}:name==='images'?{personId:'dummy',blob:new Blob(['dummy'])}:{id:'dummy',anniversaries:[{type:'CUSTOM',title:'dummy'}]});await new Promise(r=>tx.oncomplete=r);return db;}
test('explicit managed clear atomically removes people/images/anniversaries/notices/settings, not another DB',async()=>{
  const db=await fixture(),other=await fixture();await clearManagedRecords(db);for(const n of STORES){assert.equal((await all(db,n)).length,0);assert.equal((await all(other,n)).length,1);}db.close();other.close();
});
test('clear failure rolls back all four stores',async()=>{
  const db=await fixture(),original=db.transaction.bind(db);db.transaction=(...args)=>{const tx=original(...args);const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name);if(name==='images')store.clear=()=>{throw new Error('dummy failure');};return store;};return tx;};
  await assert.rejects(clearManagedRecords(db));db.transaction=original;for(const n of STORES)assert.equal((await all(db,n)).length,1);db.close();
});
test('cache deletion is limited to exact app path/hash, never the whole origin',()=>{
  const own='birthday-calendar-demo-shell-%2Fbirthday-calendar-demo-test%2F-0123456789abcdef';assert.deepEqual(ownedCacheNames([own,'birthday-calendar-demo-shell-%2Fother%2F-0123456789abcdef','other-app','birthday-calendar-demo-shell-%2Fbirthday-calendar-demo-test%2F-not-a-hash'],'https://example.test/birthday-calendar-demo-test/'),[own]);
});
test('stop flag prevents automatic bootstrap; absence of Web Locks refuses destructive action',async()=>{
  assert.equal(isRetired({getItem:key=>key===RETIRED_KEY?'done':null}),true);assert.equal(isRetired({getItem:()=>null}),false);
  const session=await startDataSession(null);await assert.rejects(session.exclusive(()=>assert.fail('must not run')),/deleteUnavailable/);
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');assert.ok(app.indexOf('if(isRetired())')<app.indexOf('initOptions(); bindEvents(); state.db = await openDatabase()'));
});
test('lifecycle notices are bilingual, no external contact and distinguish exclusions/uninstall',()=>{
  assert.deepEqual(Object.keys(lifecycleMessages.ja).sort(),Object.keys(lifecycleMessages.en).sort());for(const language of ['ja','en'])for(const value of Object.values(lifecycleMessages[language]))assert.doesNotMatch(value,/https?:\/\/|mailto:/);
  assert.match(lifecycleMessages.en.deleteExcluded,/password-manager/);assert.match(lifecycleMessages.en.endUseHelp,/cannot force an uninstall/);
});

function deletionEnvironment(db,{otherWindows=0,badScope=false,storageFail=false,cacheFail=false}={}){
  const name=db.name,scope='https://example.test/birthday-calendar-demo/',values=new Map([['unrelated','preserve'],['birthday-calendar-demo-last-update-check','1']]),sessionValues=new Map([['unrelated','preserve']]);
  const makeStorage=map=>({getItem:k=>map.get(k)??null,setItem(k,v){if(storageFail)throw new Error('storage denied');map.set(k,v);},removeItem:k=>map.delete(k)});
  const own='birthday-calendar-demo-shell-%2Fbirthday-calendar-demo%2F-0123456789abcdef',cacheNames=new Set([own,'unrelated']);let removed=false;
  const worker={scriptURL:scope+'sw.js',postMessage({type},[port]){port.postMessage(type==='BIRTHDAY_DEMO_WINDOWS'?{otherWindows}:{stopped:true});port.close();}};
  const registration={scope:badScope?'https://example.test/other/':scope,active:worker,unregister:async()=>{removed=true;return true;}};
  const options={scope,nav:{serviceWorker:{controller:worker,getRegistration:async()=>removed?undefined:registration}},storage:makeStorage(values),session:makeStorage(sessionValues),cacheStorage:{keys:async()=>[...cacheNames],delete:async key=>cacheFail?false:cacheNames.delete(key)},open:()=>openDatabase(name)};
  return {options,values,sessionValues,cacheNames,own};
}
test('managed erasure verifies data, exact caches/SW and keys while preserving unrelated storage',async()=>{
  const db=await fixture(),name=db.name,env=deletionEnvironment(db),report=await eraseManagedData(db,env.options);assert.equal(report.complete,true);assert.equal(env.values.get(RETIRED_KEY),'done');assert.equal(env.values.get('unrelated'),'preserve');assert.equal(env.sessionValues.get('unrelated'),'preserve');assert.equal(env.values.has('birthday-calendar-demo-last-update-check'),false);assert.deepEqual([...env.cacheNames],['unrelated']);const check=await openDatabase(name);for(const n of STORES)assert.equal((await all(check,n)).length,0);check.close();
});
test('other windows refuse erasure before any data or stop flag changes',async()=>{
  const db=await fixture(),env=deletionEnvironment(db,{otherWindows:1});await assert.rejects(eraseManagedData(db,env.options),/deleteOtherWindows/);assert.equal(env.values.has(RETIRED_KEY),false);assert.equal((await all(db,'people')).length,1);db.close();
});
test('unrelated SW scope refuses erasure before data is touched',async()=>{
  const db=await fixture(),env=deletionEnvironment(db,{badScope:true});await assert.rejects(eraseManagedData(db,env.options),/deleteUnavailable/);assert.equal(env.values.has(RETIRED_KEY),false);assert.equal((await all(db,'people')).length,1);db.close();
});
test('failure to persist the stop guard leaves all records intact',async()=>{
  const db=await fixture(),env=deletionEnvironment(db,{storageFail:true});await assert.rejects(eraseManagedData(db,env.options),/storage denied/);for(const n of STORES)assert.equal((await all(db,n)).length,1);db.close();
});
test('cache cleanup failure is partial, not success; the guard remains',async()=>{
  const db=await fixture(),env=deletionEnvironment(db,{cacheFail:true}),report=await eraseManagedData(db,env.options);assert.equal(report.dataDeleted,true);assert.equal(report.complete,false);assert.equal(report.cachesDeleted,false);assert.equal(env.values.get(RETIRED_KEY),'partial');assert.equal(env.cacheNames.has('unrelated'),true);
});
test('database clear failure preserves data and does not unregister SW or remove caches',async()=>{
  const db=await fixture(),name=db.name,env=deletionEnvironment(db);env.options.open=async()=>{const c=await openDatabase(name);c.transaction=()=>{throw new Error('fictional failure');};return c;};const report=await eraseManagedData(db,env.options);assert.equal(report.complete,false);assert.equal(report.dataDeleted,false);assert.equal(env.cacheNames.has(env.own),true);assert.ok(await env.options.nav.serviceWorker.getRegistration());const check=await openDatabase(name);for(const n of STORES)assert.equal((await all(check,n)).length,1);check.close();
});
test('backup uses one readonly transaction for a coherent four-store snapshot',async()=>{
  const db=await openDatabase('backup-snapshot-'+crypto.randomUUID()),original=db.transaction.bind(db),calls=[];db.transaction=(...args)=>{calls.push(args);return original(...args);};await createBackup(db);assert.equal(calls.length,1);assert.deepEqual(calls[0],[['people','images','notifications','settings'],'readonly']);db.close();
});
