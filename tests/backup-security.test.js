import 'fake-indexeddb/auto';
import {imageFixture} from './helpers/image-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zipSync,unzipSync,strToU8,strFromU8,Zip,ZipPassThrough} from 'fflate';
import {readZip,zipDirectory,ZIP_LIMITS,crc32} from '../src/zip-reader.js';
import {backupImageHeader,validateBackupImage} from '../src/images.js';
import {normalizePerson} from '../src/model.js';
import {openDatabase,savePerson,saveAppearance,saveLanguage,saveSettings,all,STORES} from '../src/db.js';
import {createBackup,inspectBackup,restoreBackup} from '../src/backup.js';
const make=(extra={},level=0)=>zipSync({'manifest.json':strToU8('{}'),'data.json':strToU8('{}'),...extra},{level});
function central(bytes,name){const v=new DataView(bytes.buffer);let p=v.getUint32(bytes.length-6,true);for(let i=0;i<v.getUint16(bytes.length-12,true);i++){const n=v.getUint16(p+28,true);if(strFromU8(bytes.subarray(p+46,p+46+n))===name)return p;p+=46+n+v.getUint16(p+30,true)+v.getUint16(p+32,true);}throw Error('fixture entry');}
function lie(bytes,name,n){const p=central(bytes,name),v=new DataView(bytes.buffer),local=v.getUint32(p+42,true);v.setUint32(p+24,n,true);v.setUint32(local+22,n,true);return bytes;}
for(const level of [0,6])test(`正常ZIP STORE/DEFLATEを実長・CRC付きで読む level=${level}`,async()=>{
  const result=await readZip(make({},level));assert.equal(strFromU8(result['data.json']),'{}');
});
test('data descriptor付きの標準STORE ZIPも読み込む',async()=>{
  const chunks=[],zip=new Zip((error,data)=>{if(error)throw error;chunks.push(data);});
  for(const name of ['manifest.json','data.json']){const entry=new ZipPassThrough(name);zip.add(entry);entry.push(strToU8('{}'),true);}zip.end();
  const data=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let p=0;for(const c of chunks){data.set(c,p);p+=c.length;}assert.equal(Object.keys(await readZip(data)).length,2);
});
test('STOREの宣言1byte・実長2byteを展開前に拒否',async()=>{await assert.rejects(readZip(lie(make(),'data.json',1)));});
test('DEFLATEの実展開量が宣言を超えたらstreamを中断',async()=>{await assert.rejects(readZip(lie(make({'data.json':strToU8(' '.repeat(256*1024))},6),'data.json',1)));});
test('実展開量が宣言より少ないZIPも拒否',async()=>{await assert.rejects(readZip(lie(make({},6),'data.json',3)));});
test('圧縮stream非対応時はfail closedし、旧版のSTOREは引き続き読む',async()=>{const original=globalThis.DecompressionStream;try{globalThis.DecompressionStream=class{constructor(){throw Error('unsupported')}};await assert.rejects(readZip(make({},6)),/圧縮ZIP/);assert.equal(Object.keys(await readZip(make())).length,2);}finally{globalThis.DecompressionStream=original;}});
test('1entryの上限違反はskipせずZIP全体を拒否',async()=>{await assert.rejects(readZip(make({'data.json':new Uint8Array(ZIP_LIMITS.json+1)})));});
test('許可外ファイルを容量にかかわらず拒否',async()=>{for(const n of [1,ZIP_LIMITS.json+1])await assert.rejects(readZip(make({'ignored.bin':new Uint8Array(n)})));});
test('パストラバーサル・ディレクトリ・proto名は拒否',async()=>{
  for(const name of ['../data.json','images/'])await assert.rejects(readZip(make({[name]:new Uint8Array(0)})));
  // ZIP生成ライブラリのobject処理を避け、生成後の同長の名前を書き換える。
  for(const name of ['constructor','__proto__']){const safe='x'.repeat(name.length),bytes=make({[safe]:new Uint8Array(0)}),from=strToU8(safe),to=strToU8(name);
    for(let i=0;i<=bytes.length-from.length;i++)if(from.every((n,j)=>bytes[i+j]===n)){bytes.set(to,i);i+=from.length-1;}await assert.rejects(readZip(bytes));}
});
test('重複した画像名は上書きせず拒否',async()=>{
  const a='images/00000000-0000-4000-8000-000000000001.bin',b=a.replace('001.bin','002.bin'),bytes=make({[a]:new Uint8Array(0),[b]:new Uint8Array(0)}),from=strToU8(b),to=strToU8(a);
  for(let i=0;i<=bytes.length-from.length;i++)if(from.every((v,j)=>bytes[i+j]===v)){bytes.set(to,i);i+=from.length-1;}await assert.rejects(readZip(bytes));
});
test('暗号化・非対応圧縮を拒否',async()=>{for(const [field,value]of [[8,1],[10,12]]){const bytes=make(),p=central(bytes,'data.json');new DataView(bytes.buffer).setUint16(p+field,value,true);await assert.rejects(readZip(bytes));}});
test('ローカルヘッダーと中央ヘッダーの名前不一致を拒否',async()=>{const bytes=make(),entry=zipDirectory(bytes).find(e=>e.name==='data.json');bytes[entry.local+30]=120;await assert.rejects(readZip(bytes));});
test('CRC不一致を拒否',async()=>{const bytes=make(),entry=zipDirectory(bytes).find(e=>e.name==='data.json');bytes[entry.start]^=1;await assert.rejects(readZip(bytes));});
test('切断・末尾への隠しデータ・中央サイズ不整合を拒否',async()=>{const bytes=make();await assert.rejects(readZip(bytes.subarray(0,-1)));const suffix=new Uint8Array(bytes.length+1);suffix.set(bytes);await assert.rejects(readZip(suffix));const bad=bytes.slice();new DataView(bad.buffer).setUint32(bad.length-10,1,true);await assert.rejects(readZip(bad));});
test('全体量・entry数の上限を展開前に確認',()=>{for(const limits of [{...ZIP_LIMITS,total:3},{...ZIP_LIMITS,entries:1},{...ZIP_LIMITS,archive:1}])assert.throws(()=>zipDirectory(make(),limits));});
test('カテゴリと種別の継承プロパティを拒否',()=>{for(const key of ['constructor','toString','__proto__']){assert.throws(()=>normalizePerson({displayName:'dummy',category:key}));assert.throws(()=>normalizePerson({displayName:'dummy',anniversaries:[{type:key,month:1,day:1}]}));}});
test('既知の実PNG画像は検証後も原本を維持',async()=>{const blob=imageFixture(),before=new Uint8Array(await blob.arrayBuffer());await validateBackupImage(blob);assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),before);});
test('偽装PNG・SVG・不一致MIME・切断画像を拒否',async()=>{for(const blob of [new Blob(['<svg/>'],{type:'image/png'}),new Blob(['dummy'],{type:'image/webp'}),new Blob([await imageFixture().arrayBuffer()],{type:'image/jpeg'}),imageFixture().slice(0,35,'image/png')])await assert.rejects(validateBackupImage(blob));});
test('画像の宣言画素数・辺長・容量をデコード前に制限',async()=>{
  for(const [w,h]of [[4097,4097],[5000,1]]){const bytes=new Uint8Array(await imageFixture().arrayBuffer()),v=new DataView(bytes.buffer);v.setUint32(16,w);v.setUint32(20,h);v.setUint32(29,crc32(bytes.subarray(12,29)));assert.throws(()=>backupImageHeader(bytes,'image/png'),/画素|寸法/);}
  await assert.rejects(validateBackupImage(new Blob([new Uint8Array(2*1024*1024+1)],{type:'image/png'})));
});
test('ヘッダーが正常でも完全decoderが拒否した画像は受け付けない',async()=>{const bytes=new Uint8Array(await imageFixture().arrayBuffer());bytes[60]^=1;await assert.rejects(validateBackupImage(new Blob([bytes],{type:'image/png'})));});
async function fixture(){const db=await openDatabase('security-'+crypto.randomUUID());await savePerson(db,{displayName:'架空保持人物',category:'OTHER',anniversaries:[{type:'BIRTHDAY',month:5,day:10},{type:'CUSTOM',title:'架空記念日',month:5,day:10,notify:true}]},{image:imageFixture()});await saveLanguage(db,'en');await saveAppearance(db,{theme:'dark'});await saveSettings(db,{enabled:true,seven:true,three:false,one:true,today:true});const {synchronizeNotifications}=await import('../src/notifications.js');await synchronizeNotifications(db,'2028-05-03');return db;}
const snapshot=async db=>Promise.all(STORES.map(s=>all(db,s)));
test('不正ZIP画像は書込み前に拒否し全store・画像を保持',async()=>{const db=await fixture();try{const before=await snapshot(db),files=unzipSync(new Uint8Array(await(await createBackup(db)).arrayBuffer())),data=JSON.parse(strFromU8(files['data.json'])),name=data.images[0].path;files[name]=strToU8('fake');const manifest=JSON.parse(strFromU8(files['manifest.json']));manifest.entries[name]={bytes:files[name].length,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',files[name])).toString('hex')};files['manifest.json']=strToU8(JSON.stringify(manifest));await assert.rejects(inspectBackup(new Blob([zipSync(files)])));assert.deepEqual(await snapshot(db),before);}finally{db.close();}});
test('復元中の同期例外でもclearを含む全操作がrollbackする',async()=>{const db=await fixture();try{const prepared=await inspectBackup(await createBackup(db)),before=await snapshot(db),original=db.transaction;db.transaction=function(...args){const tx=original.apply(this,args);if(args[1]==='readwrite')tx.objectStore('images').put=()=>{throw Error('injected clone failure');};return tx;};await assert.rejects(restoreBackup(db,prepared));db.transaction=original;assert.deepEqual(await snapshot(db),before);}finally{db.close();}});
test('復元transactionの件数不一致もcommit前にabortする',async()=>{const db=await fixture();try{const prepared=await inspectBackup(await createBackup(db)),before=await snapshot(db);prepared.snapshot.notifications.push(prepared.snapshot.notifications[0]);await assert.rejects(restoreBackup(db,prepared));assert.deepEqual(await snapshot(db),before);}finally{db.close();}});
test('Pages用CSPは先頭charset直後に設定しframe/mediaを拒否する',()=>{const source=readFileSync('scripts/generate-sw.mjs','utf8');assert.ok(source.includes("frame-src 'none'; media-src 'none'"));assert.ok(source.includes("html.replace('<meta charset=\"UTF-8\">'"));assert.ok(!source.includes("frame-ancestors 'none'"),'metaでは無効な防御を追加しない');});
test('JSONのnull root・配列ID・配列settingsを厳密に拒否し既存storeを保持',async()=>{const db=await fixture();try{const before=await snapshot(db),zip=await createBackup(db);for(const kind of ['null','id','settings']){const files=unzipSync(new Uint8Array(await zip.arrayBuffer())),data=JSON.parse(strFromU8(files['data.json'])),manifest=JSON.parse(strFromU8(files['manifest.json']));if(kind==='id')data.people[0].id=[data.people[0].id];if(kind==='settings')data.settings=[];files['data.json']=strToU8(JSON.stringify(kind==='null'?null:data));manifest.entries['data.json']={bytes:files['data.json'].length,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',files['data.json'])).toString('hex')};files['manifest.json']=strToU8(JSON.stringify(manifest));await assert.rejects(inspectBackup(new Blob([zipSync(files)])));assert.deepEqual(await snapshot(db),before);}}finally{db.close();}});
test('manifestの通知件数が実データと違う場合も拒否',async()=>{const db=await fixture();try{const files=unzipSync(new Uint8Array(await(await createBackup(db)).arrayBuffer())),manifest=JSON.parse(strFromU8(files['manifest.json']));manifest.counts.notifications++;files['manifest.json']=strToU8(JSON.stringify(manifest));await assert.rejects(inspectBackup(new Blob([zipSync(files)])),/件数/);}finally{db.close();}});
