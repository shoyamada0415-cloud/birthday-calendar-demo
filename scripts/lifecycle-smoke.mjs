import {normalizePerson} from '../src/model.js';
import {enterBackupPassword,TEST_BACKUP_PASSWORD} from './backup-password-smoke.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';

// Destructive checks run ONLY in the caller's disposable localhost browser profile.
export async function verifyLifecycle({evaluate,until,check,command,baseUrl}){
  if(!baseUrl.startsWith('http://127.0.0.1:'))throw new Error('Lifecycle smoke must never run against a deployed origin');
  const source=normalizePerson({displayName:'架空の暗号化確認',category:'OTHER',memo:'fictional only',anniversaries:[{type:'BIRTHDAY',month:2,day:29,year:2000,showAge:true},{type:'CUSTOM',title:'架空記念日',month:8,day:15,recurring:true,notify:false}]});
  const snapshot=()=>evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(d=>r.onsuccess=()=>d(r.result));const rows=await Promise.all(['people','images','settings','notifications'].map(n=>new Promise(d=>db.transaction(n).objectStore(n).getAll().onsuccess=e=>d(e.target.result))));rows[1]=await Promise.all(rows[1].map(async i=>({personId:i.personId,type:i.type,blob:[...new Uint8Array(await i.blob.arrayBuffer())]})));db.close();return JSON.stringify(rows);})()`);
  await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=48;c.getContext('2d').fillRect(0,0,48,48);const blob=await new Promise(d=>c.toBlob(d,'image/png')),r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(d=>r.onsuccess=()=>d(r.result)),tx=db.transaction(['people','images','settings','notifications'],'readwrite');for(const n of ['people','images','settings','notifications'])tx.objectStore(n).clear();const p=${JSON.stringify(source)};p.hasImage=true;tx.objectStore('people').put(p);tx.objectStore('images').put({personId:p.id,blob,type:'image/png'});for(const row of [{key:'language',value:'ja'},{key:'appearance',value:{theme:'light'}},{key:'notifications',value:{enabled:true,seven:true,three:true,one:true,today:true}}])tx.objectStore('settings').put(row);await new Promise(d=>tx.oncomplete=d);db.close();})()`);
  await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#app-version")?.textContent&&!!navigator.serviceWorker.controller'));
  const seed=await snapshot();
  let layouts=0;
  for(const language of ['ja','en'])for(const theme of ['light','dark'])for(const width of [320,390,430,768,1280]){
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
    await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();for(const [id,value]of ${JSON.stringify([['language-choice',language],['theme-choice',theme]])}){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}})()`);
    await until(()=>evaluate(`document.documentElement.lang==='${language}'&&document.documentElement.dataset.theme==='${theme}'`));
    await evaluate(`document.querySelector('#export-backup').click()`);await until(()=>evaluate('Boolean(document.querySelector("#backup-password-dialog")?.open)'));
    const layout=await evaluate(`(()=>{const d=document.querySelector('#backup-password-dialog'),b=d.getBoundingClientRect(),i=d.querySelector('input');return {left:b.left,right:b.right,width:innerWidth,scroll:d.scrollWidth,client:d.clientWidth,font:parseFloat(getComputedStyle(i).fontSize),auto:i.autocomplete,confirmation:!!d.querySelector('#backup-password-confirm')};})()`);
    check(layout.left>=0&&layout.right<=layout.width&&layout.scroll<=layout.client+1&&layout.font>=16&&layout.auto==='new-password'&&layout.confirmation,'Password layout '+language+theme+width);
    if(width===390){mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/encrypted-password-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
    await evaluate('document.querySelector("#backup-password-dialog .actions button[type=button]").click()');
    // Escape is independent of button order and must leave persistent data alone.
    if(await evaluate('Boolean(document.querySelector("#backup-password-dialog")?.open)'))await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await until(()=>evaluate('!document.querySelector("#backup-password-dialog")'));
    layouts++;
  }
  await evaluate(`(()=>{for(const [id,value]of [['language-choice','ja'],['theme-choice','light']]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}})()`);
  await until(()=>evaluate('document.documentElement.lang==="ja"&&document.documentElement.dataset.theme==="light"'));
  check(await snapshot()===seed,'Cancelling password prompts must preserve all stores');
  await evaluate(`(()=>{window.__sealedURL=URL.createObjectURL;URL.createObjectURL=function(b){if(b.type==='application/octet-stream')window.__sealedBackup=b;return window.__sealedURL.call(this,b);};window.__savedAnchor=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download)return window.__savedAnchor.call(this);};document.querySelector('#export-backup').click();})()`);
  await until(()=>evaluate('Boolean(document.querySelector("#backup-password-dialog")?.open)'));
  await evaluate(`(()=>{document.querySelector('#backup-password').value='fictional-password-one';document.querySelector('#backup-password-confirm').value='fictional-password-two';document.querySelector('#backup-password-dialog form').requestSubmit();})()`);
  check(await evaluate('!document.querySelector("#backup-password-dialog .error").hidden'),'Password mismatch shown');
  await evaluate('document.querySelector("#backup-password-dialog form > button.quiet").click()');
  check(await evaluate('document.querySelector("#backup-password").type==="text"&&document.querySelector("#backup-password-confirm").type==="text"'),'Show password');
  await evaluate('document.querySelector("#backup-password-dialog form > button.quiet").click()');
  check(await evaluate('document.querySelector("#backup-password").type==="password"'),'Hide password');
  await enterBackupPassword({evaluate,until});await until(()=>evaluate('!!window.__sealedBackup'));
  check(await snapshot()===seed,'Encrypted export changed data');
  check(await evaluate(`!document.querySelector('#backup-password-dialog')&&![...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>v.includes(${JSON.stringify(TEST_BACKUP_PASSWORD)}))`),'Password persisted or dialog retained');
  async function choose(kind){await evaluate(`(async()=>{let blob=window.__sealedBackup;if(${JSON.stringify(kind)}==='tampered'){const b=new Uint8Array(await blob.arrayBuffer());b[b.length-1]^=1;blob=new Blob([b]);}const n=document.querySelector('#import-backup'),files=new DataTransfer();files.items.add(new File([blob],'dummy.birthday-backup',{type:'application/octet-stream'}));n.files=files.files;document.querySelector('#toast').hidden=true;n.dispatchEvent(new Event('change'));})()`);}
  for(const kind of ['wrong','tampered']){
    await choose(kind);await enterBackupPassword({evaluate,until},false,kind==='wrong'?'incorrect-dummy-password':TEST_BACKUP_PASSWORD);
    await until(()=>evaluate('!document.querySelector("#toast").hidden&&document.querySelector("#toast").textContent.includes("パスワードが違う")'));
    check(await snapshot()===seed,'Failed decryption changed stores');
  }
  await choose('valid');await enterBackupPassword({evaluate,until},false);await until(()=>evaluate('!document.querySelector("#restore-preview").hidden'));
  check(await snapshot()===seed,'Preview changed stores');
  await evaluate(`window.confirm=()=>false;document.querySelector('#restore-preview .primary').click()`);check(await snapshot()===seed,'Restore cancel changed stores');
  await evaluate(`(()=>{window.confirm=()=>true;window.prompt=()=> '復元';document.querySelector('#restore-preview .primary').click();})()`);
  await until(()=>evaluate('document.querySelector("#restore-preview").hidden'));
  check(await snapshot()===seed,'Encrypted round trip did not preserve all stores/images');
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate(`window.__sealedBackup=null;document.querySelector('#export-backup').click()`);
  await enterBackupPassword({evaluate,until});await until(()=>evaluate('!!window.__sealedBackup'));
  await choose('valid');await enterBackupPassword({evaluate,until},false);await until(()=>evaluate('!document.querySelector("#restore-preview").hidden'));
  await evaluate(`document.querySelector('#restore-preview .primary').click()`);await until(()=>evaluate('document.querySelector("#restore-preview").hidden'));
  check(await snapshot()===seed,'Offline encryption/restore changed the snapshot');
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  // Another application's sentinels must survive every deletion step.
  await evaluate(`(async()=>{localStorage.setItem('unrelated-app','preserve');sessionStorage.setItem('unrelated-app','preserve');localStorage.setItem('birthday-calendar-demo-last-update-check','1');const r=indexedDB.open('unrelated-app',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');const db=await new Promise(d=>r.onsuccess=()=>d(r.result)),tx=db.transaction('records','readwrite');tx.objectStore('records').put('preserve','sentinel');await new Promise(d=>tx.oncomplete=d);db.close();const cache=await caches.open('unrelated-app');await cache.put(new URL('./other-sentinel',document.baseURI),new Response('preserve'));})()`);
  await evaluate(`document.querySelector('#data-privacy-section').open=true;window.confirm=()=>false;document.querySelector('#delete-managed-data').click()`);check(await snapshot()===seed,'Deletion cancel changed data');
  const {targetId}=await command('Target.createTarget',{url:baseUrl+'?second-window'});
  await until(()=>evaluate(`navigator.locks.query().then(r=>r.held.filter(l=>l.name==='birthday-calendar-demo-session:birthday-calendar-demo').length>=2)`),'Second Birthday Calendar Demo session');
  await evaluate(`window.confirm=()=>true;window.prompt=()=> '削除';document.querySelector('#delete-managed-data').click()`);
  await until(()=>evaluate('document.querySelector("#toast").textContent.includes("他のBirthday Calendar Demo画面")'));
  check(await snapshot()===seed&&await evaluate('localStorage.getItem("birthday-calendar-demo-retired")===null'),'Blocked deletion changed data');
  await command('Target.closeTarget',{targetId});
  await until(()=>evaluate(`new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>{c.port1.close();resolve(e.data.otherWindows===0);};navigator.serviceWorker.controller.postMessage({type:'BIRTHDAY_DEMO_WINDOWS'},[c.port2]);})`),'Other window closed');
  // Force a synchronous failure halfway through the transaction, then retry explicitly.
  await evaluate(`(()=>{window.__originalClear=IDBObjectStore.prototype.clear;IDBObjectStore.prototype.clear=function(){if(this.name==='images')throw new Error('fictional failure');return window.__originalClear.call(this);};document.querySelector('#delete-managed-data').click();})()`);
  await until(()=>evaluate('Boolean(document.querySelector(".stopped-screen ul"))'));
  check(await snapshot()===seed,'Failed deletion was not atomic');
  check(await evaluate('document.querySelector(".stopped-screen").textContent.includes("未完了")'),'Partial failure not reported');
  await evaluate(`window.confirm=()=>false;document.querySelector('.stopped-screen button.danger').click()`);
  await until(()=>evaluate('!document.querySelector(".stopped-screen button.danger").disabled'));
  check(await snapshot()===seed,'Cancelling a retry changed data');
  await evaluate('window.confirm=()=>true');
  await evaluate(`IDBObjectStore.prototype.clear=window.__originalClear;window.__realCacheDelete=caches.delete.bind(caches);caches.delete=async name=>name.startsWith('birthday-calendar-demo-shell-')?false:window.__realCacheDelete(name);document.querySelector('.stopped-screen button.danger').click()`);
  await until(()=>evaluate('document.querySelector(".stopped-screen ul")?.textContent.includes("未完了")&&localStorage.getItem("birthday-calendar-demo-retired")==="partial"'));
  await until(()=>evaluate('document.querySelector(".stopped-screen ul")?.textContent.includes("人物・画像・通知・設定: 削除確認済み")'));
  check(JSON.parse(await snapshot()).every(rows=>rows.length===0),'Records should be deleted even if cache cleanup fails');
  await evaluate(`caches.delete=window.__realCacheDelete;document.querySelector('.stopped-screen button.danger').click()`);
  await until(()=>evaluate('document.querySelector(".stopped-screen h1")?.textContent.includes("削除を確認")'),'Verified deletion');
  const deleted=JSON.parse(await snapshot());check(deleted.every(rows=>rows.length===0),'Managed records remain');
  const other=await evaluate(`(async()=>{const r=indexedDB.open('unrelated-app'),db=await new Promise(d=>r.onsuccess=()=>d(r.result)),v=await new Promise(d=>db.transaction('records').objectStore('records').get('sentinel').onsuccess=e=>d(e.target.result));db.close();const names=await caches.keys();return {db:v,local:localStorage.getItem('unrelated-app'),session:sessionStorage.getItem('unrelated-app'),cache:names.includes('unrelated-app'),ownCache:names.some(n=>n.startsWith('birthday-calendar-demo-shell-'+encodeURIComponent(new URL('./',document.baseURI).pathname)+'-')),registration:!!(await navigator.serviceWorker.getRegistration(new URL('./',document.baseURI).href)),flag:localStorage.getItem('birthday-calendar-demo-retired')};})()`);
  check(other.db==='preserve'&&other.local==='preserve'&&other.session==='preserve'&&other.cache&&!other.ownCache&&!other.registration&&other.flag==='done','Deletion boundary failed '+JSON.stringify(other));
  await command('Page.reload');await until(()=>evaluate('!!document.querySelector(".stopped-screen")'));
  check(JSON.parse(await snapshot()).every(rows=>rows.length===0),'Data recreated after restart');
  return {layouts,encryptedRoundTrip:true,offlineEncryptionAndRestore:true,wrongPasswordAndTamperRejected:true,cancelPreserved:true,multiWindowBlocked:true,atomicFailurePreserved:true,partialCacheFailureReported:true,allStoresDeleted:true,otherAppPreserved:true,restartDoesNotRecreate:true};
}
