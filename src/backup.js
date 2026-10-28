import { zipSync, strToU8, strFromU8 } from 'fflate';
import { readZip,zipDirectory } from './zip-reader.js';
import { validateBackupImage } from './images.js';
import { replaceAllData } from './db.js';
import { normalizeAppearance } from './appearance.js';
import { DEFAULT_SETTINGS, birthdayOf, dateParts, normalizePerson, TIMINGS,
  occurrenceForYear } from './model.js';
import { anniversaryNotificationId, notificationId } from './notifications.js';
import { APP_VERSION } from './version.js';

export const BACKUP_FORMAT_VERSION = 1;
export { APP_VERSION };
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createBackup(db) {
  // One readonly transaction gives a coherent snapshot even when another tab edits data.
  const names=['people','images','notifications','settings'],tx=db.transaction(names,'readonly');
  const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??new Error('backupReadFailed'));tx.onerror=()=>{};});
  const [people,images,notifications,rows]=await Promise.all([...names.map(name=>new Promise((resolve,reject)=>{
    const r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  })),done]);
  const settings=rows.find(r=>r.key==='notifications')?.value??{...DEFAULT_SETTINGS};
  const language=rows.find(r=>r.key==='language')?.value==='en'?'en':'ja';
  const appearance=normalizeAppearance(rows.find(r=>r.key==='appearance')?.value);
  const referenced=new Set(people.filter(p=>p.hasImage).map(p=>p.id)),imageIds=new Set(images.map(i=>i.personId));
  if ([...referenced].some(id=>!imageIds.has(id))||[...imageIds].some(id=>!referenced.has(id))) {
    throw new Error('画像の参照不整合があります。バックアップ前に状態を確認してください。');
  }
  const files = {};
  const imageRecords = [];
  for (const image of images) {
    const path = `images/${image.personId}.bin`;
    files[path] = new Uint8Array(await image.blob.arrayBuffer());
    imageRecords.push({ personId: image.personId, path, type: image.type });
  }
  files['data.json'] = strToU8(JSON.stringify({ people, notifications, settings, language, appearance, images: imageRecords }));
  if (Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > MAX_ARCHIVE_BYTES - 1024 * 1024) {
    throw new Error('バックアップの容量が上限を超えています。画像を整理してから再試行してください。');
  }
  const entries = {};
  for (const [path, bytes] of Object.entries(files)) {
    entries[path] = { bytes: bytes.length, sha256: await sha256(bytes) };
  }
  const manifest = {
    formatVersion: BACKUP_FORMAT_VERSION, appVersion: APP_VERSION,
    createdAt: new Date().toISOString(), counts: { people: people.length, images: images.length,
      notifications: notifications.length }, entries,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 0 });
  zipDirectory(zipped); // 自分で書き出すZIPも読込側と同じ構造・容量制限を満たす。
  if (zipped.length > MAX_ARCHIVE_BYTES) throw new Error('バックアップZIPが上限を超えています。');
  return new Blob([zipped], { type: 'application/zip' });
}

// v0は初期ローカル試作形式: birthday:{month,day} を anniversaries[]へ移す。
export function migrateBackupData(version, data) {
  if (version === 1) return data;
  if (version === 0) {
    return {
      ...data,
      people: data.people.map((person) => ({ ...person,
        anniversaries: person.anniversaries ?? (person.birthday
          ? [{ type: 'BIRTHDAY', ...person.birthday, year: null, showAge: false }] : []),
        links: person.links ?? [], hasImage: Boolean(person.hasImage),
      })),
      settings: data.settings ?? { ...DEFAULT_SETTINGS },
      notifications: data.notifications ?? [], images: data.images ?? [],
    };
  }
  throw new Error('このバックアップ形式には対応していません。');
}

function validateData(data, files) {
  if (!Array.isArray(data.people) || !Array.isArray(data.images)
    || !Array.isArray(data.notifications) || !data.settings || typeof data.settings !== 'object'||Array.isArray(data.settings)) {
    throw new Error('バックアップのデータ構造が正しくありません。');
  }
  const people = data.people.map((record) => {
    if (!record||typeof record.id!=='string'||!UUID.test(record.id)) throw new Error('人物IDの形式が正しくありません。');
    return normalizePerson(record, record, record.updatedAt);
  });
  const personIds = new Set(people.map((person) => person.id));
  if (personIds.size !== people.length) throw new Error('人物IDが重複しています。');
  const images = data.images.map((record) => {
    if (!personIds.has(record.personId) || record.path !== `images/${record.personId}.bin`
      || !['image/jpeg', 'image/webp', 'image/png'].includes(record.type)
      || !files[record.path] || files[record.path].length > 2 * 1024 * 1024) {
      throw new Error('画像の参照または形式が正しくありません。');
    }
    return { personId: record.personId, type: record.type,
      blob: new Blob([files[record.path]], { type: record.type }) };
  });
  const imageIds = new Set(images.map((image) => image.personId));
  const fileImagePaths = Object.keys(files).filter((name) => name.startsWith('images/'));
  if (fileImagePaths.length !== images.length
    || fileImagePaths.some((path) => !data.images.some((image) => image.path === path))) {
    throw new Error('画像ファイル一覧がデータと一致しません。');
  }
  if (imageIds.size !== images.length || people.some((person) => person.hasImage !== imageIds.has(person.id))) {
    throw new Error('画像と人物の参照が一致しません。');
  }
  const personById = new Map(people.map((person) => [person.id, person]));
  const notifications = data.notifications.map((notice) => {
    const person = personById.get(notice.personId);
    const ann = notice.anniversaryId && person?.anniversaries.find((item) => item.id === notice.anniversaryId);
    const expectedId = notice.anniversaryId
      ? anniversaryNotificationId(notice.personId, notice.anniversaryId, notice.birthdayDate, notice.daysBefore)
      : notificationId(notice.personId, notice.birthdayDate, notice.daysBefore);
    if (!person || !TIMINGS.includes(notice.daysBefore) || notice.id !== expectedId
      || (notice.anniversaryId ? !ann || !ann.notify : !birthdayOf(person))) {
      throw new Error('通知の人物参照が正しくありません。');
    }
    const { year } = dateParts(notice.birthdayDate);
    if (notice.anniversaryId && occurrenceForYear(ann, year) !== notice.birthdayDate) {
      throw new Error('通知の記念日参照が正しくありません。');
    }
    return notice;
  });
  if (new Set(notifications.map((notice) => notice.id)).size !== notifications.length) {
    throw new Error('通知IDが重複しています。');
  }
  const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS)
    .map((key) => [key, Boolean(data.settings[key])]));
  if (data.language != null && !['ja', 'en'].includes(data.language)) {
    throw new Error('バックアップの言語設定が正しくありません。');
  }
  return { people, images, notifications, settings, language: data.language ?? 'ja', appearance:normalizeAppearance(data.appearance) };
}

// 書き込み前にZIP構造・各ハッシュ・参照整合性・形式Versionを全件確認します。
export async function inspectBackup(file) {
  if (!file || file.size > MAX_ARCHIVE_BYTES) throw new Error('バックアップファイルが大きすぎます。');
  let files;
  try {
    files = await readZip(new Uint8Array(await file.arrayBuffer()));
  } catch { throw new Error('ZIPファイルを読み込めませんでした。'); }
  if (!files['manifest.json'] || !files['data.json']) throw new Error('manifestまたはデータがありません。');
  let manifest; let rawData;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
    rawData = JSON.parse(strFromU8(files['data.json']));
  } catch { throw new Error('manifestまたはデータJSONが壊れています。'); }
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||!rawData||typeof rawData!=='object'||Array.isArray(rawData))throw new Error('バックアップのデータ構造が正しくありません。');
  if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion < 0
    || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('新しい形式または不明な形式のバックアップには対応していません。');
  }
  const expected = Object.keys(manifest.entries ?? {}).sort();
  const actual = Object.keys(files).filter((name) => name !== 'manifest.json').sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new Error('ZIP内のファイル一覧がmanifestと一致しません。');
  }
  for (const name of expected) {
    if (name !== 'data.json' && !/^images\/[0-9a-f-]{36}\.bin$/i.test(name)) {
      throw new Error('ZIPに予期しないファイルがあります。');
    }
    const info = manifest.entries[name];
    if (!info || !Number.isSafeInteger(info.bytes) || !/^[0-9a-f]{64}$/.test(info.sha256)) {
      throw new Error('manifestのファイル情報が正しくありません。');
    }
    if (files[name].length !== info.bytes || await sha256(files[name]) !== info.sha256) {
      throw new Error('バックアップファイルのチェックサムが一致しません。');
    }
  }
  const snapshot = validateData(migrateBackupData(manifest.formatVersion, rawData), files);
  for(const image of snapshot.images)await validateBackupImage(image.blob);
  if (manifest.counts?.people !== snapshot.people.length || manifest.counts?.images !== snapshot.images.length
    ||manifest.counts.notifications!=null&&manifest.counts.notifications!==snapshot.notifications.length) {
    throw new Error('manifestの件数がデータと一致しません。');
  }
  return { manifest, snapshot, summary: {
    people: snapshot.people.length, images: snapshot.images.length,
    notifications: snapshot.notifications.length,
  } };
}

export async function restoreBackup(db, prepared) {
  const snapshot=prepared.snapshot;
  const people=new Set(snapshot.people.map(p=>p.id)),images=new Set(snapshot.images.map(i=>i.personId));
  if(people.size!==snapshot.people.length||images.size!==snapshot.images.length
    ||snapshot.people.some(p=>p.hasImage!==images.has(p.id))||snapshot.images.some(i=>!people.has(i.personId))
    ||snapshot.people.length!==prepared.summary.people||snapshot.images.length!==prepared.summary.images){
    throw new Error('復元後の整合性確認に失敗しました。');
  }
  // commit後の別read失敗を「復元失敗」と誤報しない。件数確認も同じtransaction内。
  await replaceAllData(db, snapshot);
  return {people:people.size,images:images.size,imageBytes:snapshot.images.reduce((n,i)=>n+i.blob.size,0),missing:[],orphan:[]};
}
