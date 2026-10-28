import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppearance, applyAppearance } from '../src/appearance.js';
import { openDatabase, savePerson, saveAppearance, loadAppearance, all, replaceAllData } from '../src/db.js';
import { createBackup, inspectBackup, restoreBackup } from '../src/backup.js';
test('既存利用者はライトを維持し不正なテーマを拒否する',()=>{
  assert.deepEqual(normalizeAppearance(),{theme:'light'});
  for(const value of [null,{theme:'unknown'},'dark'])assert.throws(()=>normalizeAppearance(value));
});
test('端末追従と明示テーマを区別して適用する',()=>{
  const previous=globalThis.document;
  globalThis.document={documentElement:{dataset:{}},querySelector:()=>null};
  try {
    applyAppearance({theme:'system'},true);assert.equal(document.documentElement.dataset.theme,'dark');
    applyAppearance({theme:'system'},false);assert.equal(document.documentElement.dataset.theme,'light');
    applyAppearance({theme:'light'},true);assert.equal(document.documentElement.dataset.theme,'light');
    applyAppearance({theme:'dark'},false);assert.equal(document.documentElement.dataset.theme,'dark');
  } finally {globalThis.document=previous;}
});
test('テーマは既存settings storeへ保存し人物・画像を変えず再起動後も残る',async()=>{
  const name=`theme-${crypto.randomUUID()}`;let db=await openDatabase(name);
  const person=await savePerson(db,{displayName:'保持',category:'PET',links:[],anniversaries:[]},{image:new Blob(['img'],{type:'image/png'})});
  const before=await all(db,'people');await saveAppearance(db,{theme:'dark'});db.close();db=await openDatabase(name);
  assert.deepEqual(await loadAppearance(db),{theme:'dark'});assert.deepEqual(await all(db,'people'),before);
  assert.equal((await all(db,'images'))[0].personId,person.id);assert.equal(db.version,3);db.close();
});
test('ZIP v1でテーマを完全復元し、追加設定がない旧snapshotもライトへ戻る',async()=>{
  const db=await openDatabase(`theme-zip-${crypto.randomUUID()}`);
  await saveAppearance(db,{theme:'system'});const archive=await createBackup(db),prepared=await inspectBackup(archive);
  assert.equal(prepared.manifest.formatVersion,1);await saveAppearance(db,{theme:'dark'});await restoreBackup(db,prepared);
  assert.deepEqual(await loadAppearance(db),{theme:'system'});
  delete prepared.snapshot.appearance;await restoreBackup(db,prepared);assert.deepEqual(await loadAppearance(db),{theme:'light'});db.close();
});
test('不正な外観snapshotをclear前に拒否し既存データを保持する',async()=>{
  const db=await openDatabase(`theme-invalid-${crypto.randomUUID()}`);await saveAppearance(db,{theme:'dark'});
  await assert.rejects(replaceAllData(db,{appearance:{theme:'invalid'}}));assert.deepEqual(await loadAppearance(db),{theme:'dark'});db.close();
});
