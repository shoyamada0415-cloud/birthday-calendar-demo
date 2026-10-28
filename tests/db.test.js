import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, all, get, savePerson, deletePerson, storageSummary, saveSettings,
  loadSettings, markAllRead, markNotificationRead, loadLanguage, saveLanguage } from '../src/db.js';
import { reconcileNotifications } from '../src/notifications.js';

const fresh = () => openDatabase(`test-${crypto.randomUUID()}`);
const person = (name, month = 8, day = 27) => ({ displayName: name, category: 'X_FRIEND',
  anniversaries: [{ type: 'BIRTHDAY', month, day, year: null, showAge: false }], links: [] });

test('人物CRUDと画像の置換・削除が孤児を残さない', async () => {
  const db = await fresh();
  const one = await savePerson(db, person('山田'), { image: new Blob(['first'], { type: 'image/jpeg' }) });
  assert.equal((await storageSummary(db)).images, 1);
  assert.equal((await get(db, 'images', one.id)).blob.size, 5);
  await savePerson(db, { ...one, displayName: '山田さん' },
    { image: new Blob(['new'], { type: 'image/webp' }) });
  assert.equal((await get(db, 'images', one.id)).blob.size, 3);
  assert.equal((await all(db, 'people'))[0].displayName, '山田さん');
  assert.deepEqual((await storageSummary(db)).orphan, []);
  await savePerson(db, { ...(await get(db, 'people', one.id)) }, { removeImage: true });
  assert.equal((await storageSummary(db)).images, 0);
  await deletePerson(db, one.id);
  assert.equal((await storageSummary(db)).people, 0);
  db.close();
});

test('IndexedDB v1からv2へ人物を保ったまま通知storeを追加', async () => {
  const name = `migration-${crypto.randomUUID()}`;
  const v1 = await openDatabase(name, 1);
  const old = await savePersonV1(v1, { id: crypto.randomUUID(), displayName: '移行対象' });
  v1.close();
  const v2 = await openDatabase(name, 2);
  assert.equal((await get(v2, 'people', old.id)).displayName, '移行対象');
  assert.deepEqual(await all(v2, 'notifications'), []);
  v2.close();
});
async function savePersonV1(db, value) {
  await new Promise((resolve, reject) => { const tx = db.transaction('people', 'readwrite');
    tx.objectStore('people').put(value); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  return value;
}

test('通知は7/3/1/0日前に1件ずつ、重複せず、既読を保持', async () => {
  const db = await fresh();
  const item = await savePerson(db, person('通知さん', 1, 1));
  const settings = await loadSettings(db);
  let notices = reconcileNotifications([item], [], settings, '2026-12-25');
  assert.equal(notices.length, 1);
  assert.equal(reconcileNotifications([item], notices, settings, '2026-12-25').length, 1);
  for (const [date, count] of [['2026-12-29', 2], ['2026-12-31', 3], ['2027-01-01', 4]]) {
    notices = reconcileNotifications([item], notices, settings, date); assert.equal(notices.length, count);
  }
  assert.equal(reconcileNotifications([item], [], settings, '2026-12-26').length, 0);
  await saveSettings(db, { ...settings, enabled: false });
  assert.equal(reconcileNotifications([item], notices, await loadSettings(db), '2027-01-01').length, 0);
  assert.equal(reconcileNotifications([item], [], { ...settings, seven: false }, '2026-12-25').length, 0);
  db.close();
});

test('通知の既読・全既読、誕生日変更・人物削除で古い通知を除去', async () => {
  const db = await fresh();
  const item = await savePerson(db, person('通知さん', 8, 27));
  const { synchronizeNotifications } = await import('../src/notifications.js');
  let state = await synchronizeNotifications(db, '2026-08-20'); assert.equal(state.unread, 1);
  await markNotificationRead(db, state.notifications[0].id); state = await synchronizeNotifications(db, '2026-08-20');
  assert.equal(state.unread, 0);
  await markAllRead(db); assert.equal((await all(db, 'notifications'))[0].readAt != null, true);
  const changed = { ...item, anniversaries: [{ ...item.anniversaries[0], day: 29 }] };
  await savePerson(db, changed); assert.equal((await all(db, 'notifications')).length, 0);
  await synchronizeNotifications(db, '2026-08-22'); assert.equal((await all(db, 'notifications')).length, 1);
  await deletePerson(db, item.id); assert.equal((await all(db, 'notifications')).length, 0);
  db.close();
});

test('キャッシュ操作とIndexedDBは別物', async () => {
  const db = await fresh(); await savePerson(db, person('残る人'));
  const { obsoleteCacheNames } = await import('../src/cache-ops.js');
  const old = 'birthday-calendar-demo-shell-%2Frepo%2F-aaaaaaaaaaaaaaaa';
  const current = 'birthday-calendar-demo-shell-%2Frepo%2F-bbbbbbbbbbbbbbbb';
  const sibling = 'birthday-calendar-demo-shell-%2Fother%2F-cccccccccccccccc';
  assert.deepEqual(obsoleteCacheNames([old, current, sibling, 'other-app'], current), [old]);
  assert.deepEqual(obsoleteCacheNames([old, current], current, [old]), []);
  assert.equal((await all(db, 'people')).length, 1); db.close();
});

test('言語は既存設定storeに保存し、人物と画像と通知設定を変更しない', async () => {
  const db = await fresh();
  const item = await savePerson(db, person('テスト太郎'), { image:new Blob(['image'], { type:'image/webp' }) });
  const defaults = await loadSettings(db);
  assert.equal(await loadLanguage(db), 'ja');
  await saveLanguage(db, 'en');
  assert.equal(await loadLanguage(db), 'en');
  assert.equal((await get(db, 'people', item.id)).displayName, 'テスト太郎');
  assert.equal((await get(db, 'images', item.id)).blob.size, 5);
  assert.deepEqual(await loadSettings(db), defaults);
  db.close();
});

test('旧公開版相当のv2データと画像・通知設定を新バージョンでそのまま開ける', async () => {
  const name = `old-release-${crypto.randomUUID()}`;
  const old = await openDatabase(name, 2);
  const saved = await savePerson(old, person('テスト太郎', 2, 29),
    { image:new Blob(['previous-image'], { type:'image/webp' }) });
  await saveSettings(old, { enabled:true, seven:false, three:true, one:true, today:true });
  old.close();
  const current = await openDatabase(name);
  assert.equal((await get(current, 'people', saved.id)).anniversaries[0].day, 29);
  assert.equal((await get(current, 'images', saved.id)).blob.size, 14);
  assert.equal((await loadSettings(current)).seven, false);
  assert.equal(await loadLanguage(current), 'ja');
  assert.equal(current.version, 3);
  current.close();
});

test('IndexedDB v2からv3で旧記念日にIDを付け、人物・画像・通知設定を保持', async () => {
  const name = `anniversary-migration-${crypto.randomUUID()}`;
  const old = await openDatabase(name, 2);
  const saved = await savePerson(old, { ...person('旧人物'), anniversaries: [
    { type:'BIRTHDAY', month:8, day:27, year:null, showAge:false },
    { type:'FRIEND_SINCE', month:5, day:10, year:2024, showAge:false },
  ] }, { image:new Blob(['keep-image'], { type:'image/webp' }) });
  await savePersonV1(old, { ...saved, anniversaries:[saved.anniversaries[0],
    { type:'FRIEND_SINCE', month:5, day:10, year:2024, showAge:false }] });
  await saveSettings(old, { enabled:true, seven:false, three:true, one:true, today:true });
  old.close();
  const db = await openDatabase(name);
  const migrated = await get(db, 'people', saved.id);
  assert.equal(db.version, 3);
  assert.equal(migrated.anniversaries[1].type, 'FRIEND_SINCE');
  assert.match(migrated.anniversaries[1].id, /^[0-9a-f-]{36}$/i);
  assert.equal(migrated.anniversaries[1].notify, false);
  assert.equal((await get(db, 'images', saved.id)).blob.size, 10);
  assert.equal((await loadSettings(db)).seven, false);
  db.close();
});

test('v1由来で記念日配列のない人物もv3では0件として扱う', async () => {
  const name = `old-empty-${crypto.randomUUID()}`;
  const old = await openDatabase(name, 1);
  const id = crypto.randomUUID();
  await savePersonV1(old, { id, displayName:'古い人物', category:'OTHER' });
  old.close();
  const db = await openDatabase(name);
  assert.deepEqual((await get(db, 'people', id)).anniversaries, []);
  db.close();
});

test('記念日編集・削除・人物削除で関連通知だけを整理する', async () => {
  const db = await fresh();
  const saved = await savePerson(db, { ...person('複数'), anniversaries: [
    { type:'BIRTHDAY', month:5, day:10 },
    { type:'CUSTOM', title:'出会った日', month:5, day:10, year:2024,
      recurring:true, showAnniversary:true, notify:true },
    { type:'CUSTOM', title:'別の日', month:5, day:11, recurring:true, notify:false },
  ] });
  const { synchronizeNotifications } = await import('../src/notifications.js');
  let notices = (await synchronizeNotifications(db, '2027-05-03')).notifications;
  assert.equal(notices.length, 2);
  assert.equal(notices.filter((item) => item.anniversaryId).length, 1);
  const changed = { ...saved, anniversaries:saved.anniversaries.map((ann) =>
    ann.title === '出会った日' ? { ...ann, day:12 } : ann) };
  await savePerson(db, changed);
  notices = await all(db, 'notifications');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].anniversaryId, undefined);
  await savePerson(db, { ...changed, anniversaries:changed.anniversaries.filter((ann) => ann.type === 'BIRTHDAY') });
  assert.equal((await get(db, 'people', saved.id)).anniversaries.length, 1);
  assert.equal((await all(db, 'notifications')).length, 1);
  await deletePerson(db, saved.id);
  assert.equal((await all(db, 'notifications')).length, 0);
  db.close();
});

test('記念日通知ON/OFFと7・3・1・0日前、既読、重複防止', async () => {
  const db = await fresh();
  const saved = await savePerson(db, { displayName:'記念日さん', category:'OTHER', anniversaries:[
    { type:'CUSTOM', title:'出会い', month:1, day:1, year:2024, notify:true },
    { type:'CUSTOM', title:'通知なし', month:1, day:1, notify:false },
  ] });
  const settings = await loadSettings(db);
  let notices = [];
  for (const [date, count] of [['2026-12-25',1],['2026-12-29',2],['2026-12-31',3],['2027-01-01',4]]) {
    notices = reconcileNotifications([saved], notices, settings, date);
    assert.equal(notices.length, count);
    assert.equal(reconcileNotifications([saved], notices, settings, date).length, count);
  }
  assert.equal(notices.every((notice) => notice.anniversaryId === saved.anniversaries[0].id), true);
  notices[0].readAt = '2026-12-25T00:00:00.000Z';
  assert.equal(reconcileNotifications([saved], notices, settings, '2027-01-01')[0].readAt != null, true);
  assert.equal(reconcileNotifications([saved], [], { ...settings, enabled:false }, '2027-01-01').length, 0);
  assert.equal(reconcileNotifications([saved], [], { ...settings, today:false }, '2027-01-01').length, 0);
  db.close();
});
