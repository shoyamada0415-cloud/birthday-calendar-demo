import {mkdirSync,writeFileSync} from 'node:fs';
import {zipSync,unzipSync,strFromU8,strToU8} from 'fflate';
import {enterBackupPassword,TEST_BACKUP_PASSWORD} from './backup-password-smoke.mjs';
import {decryptBackup} from '../src/encrypted-backup.js';

// 調査用。アプリのCSS/viewport/復元処理を改変せず、空の一時プロファイルだけで実行。
export async function verifyRestoreLayout({evaluate,until,check,command,sleep}){
  const snapshot=()=>evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),names=['people','images','settings','notifications'];const rows=await Promise.all(names.map(s=>new Promise(done=>db.transaction(s).objectStore(s).getAll().onsuccess=e=>done(e.target.result))));rows[1]=await Promise.all(rows[1].map(async i=>({personId:i.personId,type:i.type,bytes:[...new Uint8Array(await i.blob.arrayBuffer())]})));db.close();return rows;})()`);
  check((await snapshot())[0].length===0,'復元調査は空の一時DBだけ');
  const click=s=>evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
  const settle=()=>evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  const metrics=()=>evaluate(`(()=>{const nav=document.querySelector('.bottom-nav'),preview=document.querySelector('#restore-preview'),button=preview.querySelector('.primary'),vv=visualViewport;
    const box=n=>{if(!n)return null;const r=n.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth};};
    return{scrollY,innerWidth,innerHeight,docHeight:document.documentElement.scrollHeight,docWidth:document.documentElement.scrollWidth,nav:box(nav),navPosition:getComputedStyle(nav).position,navPadding:getComputedStyle(nav).paddingBottom,zIndex:getComputedStyle(nav).zIndex,preview:box(preview),previewHidden:preview.hidden,button:box(button),shellPadding:getComputedStyle(document.querySelector('.app-shell')).paddingBottom,viewport:vv?{height:vv.height,width:vv.width,offsetTop:vv.offsetTop,pageTop:vv.pageTop,scale:vv.scale}:null};})()`);
  const choose=async(base64,name)=>{
    await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(base64)}),c=>c.charCodeAt(0)),input=document.querySelector('#import-backup'),transfer=new DataTransfer();transfer.items.add(new File([bytes],${JSON.stringify(name)},{type:'application/zip'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>evaluate('!document.querySelector("#restore-preview").hidden'),'復元プレビュー');await settle();
  };
  const visibleButton=async()=>{
    await evaluate('document.querySelector("#restore-preview .primary").scrollIntoView({block:"center",behavior:"instant"})');await settle();
    return evaluate(`(()=>{const b=document.querySelector('#restore-preview .primary'),r=b.getBoundingClientRect(),nav=document.querySelector('.bottom-nav').getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return{reachable:r.top>=0&&r.bottom<=nav.top&&b.contains(hit),top:r.top,bottom:r.bottom,navTop:nav.top};})()`);
  };
  const results=[];let normalZip;
  try{
    await click('[data-tab=people]');await click('#people-add');await evaluate(`document.querySelector('#person-name').value='架空の復元調査人物';document.querySelector('#person-category').value='PET';document.querySelector('#person-form').requestSubmit()`);
    await until(()=>evaluate('!document.querySelector("#person-dialog").open&&document.querySelector(".person-card")?.textContent.includes("架空の復元調査人物")'),'調査fixture');
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').fillRect(0,0,512,512);const blob=await new Promise(done=>c.toBlob(done,'image/png')),r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite');tx.objectStore('people').getAll().onsuccess=e=>{const p=e.target.result[0];p.hasImage=true;p.anniversaries=[{type:'BIRTHDAY',month:2,day:29,year:2000,showAge:true},{id:crypto.randomUUID(),type:'CUSTOM',title:'架空の記念日',month:3,day:1,year:2024,recurring:true,notify:false}];tx.objectStore('people').put(p);tx.objectStore('images').put({personId:p.id,blob,type:'image/png'});};await new Promise(done=>tx.oncomplete=done);db.close();})()`);
    await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#app-version")?.textContent'),'調査再起動');
    await evaluate(`(()=>{window.__layoutURL=URL.createObjectURL;window.__layoutAnchor=HTMLAnchorElement.prototype.click;URL.createObjectURL=function(blob){if(blob.type==='application/octet-stream')window.__layoutZIP=blob;return window.__layoutURL.call(this,blob);};HTMLAnchorElement.prototype.click=function(){if(!this.download)return window.__layoutAnchor.call(this);};document.querySelector('[data-tab=settings]').click();document.querySelector('#backup-section').open=true;document.querySelector('#export-backup').click();})()`);
    await enterBackupPassword({evaluate,until});
    await until(()=>evaluate('!!window.__layoutZIP'),'復元調査ZIP');
    normalZip=await evaluate(`(async()=>{const bytes=new Uint8Array(await window.__layoutZIP.arrayBuffer());let text='';for(const b of bytes)text+=String.fromCharCode(b);return btoa(text);})()`);
    normalZip=Buffer.from(await(await decryptBackup(new Blob([Buffer.from(normalZip,'base64')]),TEST_BACKUP_PASSWORD)).arrayBuffer()).toString('base64');
    const unzipped=unzipSync(Buffer.from(normalZip,'base64')),manifest=JSON.parse(strFromU8(unzipped['manifest.json']));
    manifest.createdAt='2026-10-22T00:00:00.'+'0'.repeat(200)+'Z';unzipped['manifest.json']=strToU8(JSON.stringify(manifest));const stressZip=Buffer.from(zipSync(unzipped)).toString('base64');
    await evaluate(`window.__restoreLayoutEvents=[];for(const target of [window,visualViewport])for(const type of ['scroll','resize'])target?.addEventListener(type,()=>{if(window.__restoreLayoutEvents.length<500)window.__restoreLayoutEvents.push({type,source:target===window?'window':'visualViewport',y:scrollY,height:innerHeight,vv:visualViewport?.height});},{passive:true});`);
    for(const language of ['ja','en'])for(const theme of ['light','dark'])for(const width of [320,390,430]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      await evaluate(`document.querySelector('[data-tab=settings]').click();document.querySelector('#appearance-section').open=true;for(const [id,value]of [['language-choice','${language}'],['theme-choice','${theme}']]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}`);
      await until(()=>evaluate(`document.documentElement.lang==='${language}'&&document.documentElement.dataset.theme==='${theme}'`),'復元調査の言語テーマ');
      await evaluate(`document.querySelector('#backup-section').open=true;document.querySelector('#import-backup').closest('.actions').scrollIntoView({block:'center'});document.querySelector('#toast').hidden=true`);await settle();
      const before=JSON.stringify(await snapshot()),prior=await metrics(),cycles=[];
      if(width===390){mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/restore-layout-before-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      for(let cycle=0;cycle<3;cycle++){
        await choose(normalZip,'架空のバックアップ情報'.repeat(15)+'.zip');const selected=await metrics(),samples=[];
        for(const fraction of [0,.3,.65,1,.5,0]){
          await evaluate(`window.scrollTo({top:(document.documentElement.scrollHeight-innerHeight)*${fraction},behavior:'instant'})`);await settle();const m=await metrics();
          check(m.navPosition==='fixed'&&Math.abs(m.nav.bottom-m.innerHeight)<2,'スクロール中のナビはviewport下端');
          check(m.docWidth<=width&&m.preview.scrollWidth<=m.preview.clientWidth+1,'通常ZIPの幅はみ出しなし');samples.push(m);
        }
        // CDPの実タッチスクロール経路も測定する（iOSのブラウザUI/慣性の再現ではない）。
        await command('Input.synthesizeScrollGesture',{x:Math.round(width/2),y:500,yDistance:-300,gestureSourceType:'touch',speed:500});await settle();
        const touch=await metrics();check(Math.abs(touch.nav.bottom-touch.innerHeight)<2,'タッチスクロールでもナビ下端');
        const reachable=await visibleButton();check(reachable.reachable,'復元ボタンへスクロールして操作可能');
        await evaluate('window.__layoutConfirm=window.confirm;window.confirm=()=>false;document.querySelector("#restore-preview .primary").click();window.confirm=window.__layoutConfirm');
        check(JSON.stringify(await snapshot())===before,'選択・プレビュー・スクロール・確認キャンセルで全データ不変');
        cycles.push({selected,samples,touch,reachable});
      }
      const resized=[];
      for(const height of [500,667,844]){
        await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await settle();const r=await visibleButton();check(r.reachable,'viewport縮小後も復元ボタンへ到達');resized.push({height,...await metrics(),reachable:r});
      }
      await evaluate('window.__layoutConfirm=window.confirm;window.__layoutPrompt=window.prompt;window.confirm=()=>true;window.prompt=()=>null;document.querySelector("#restore-preview .primary").click();window.confirm=window.__layoutConfirm;window.prompt=window.__layoutPrompt');
      check(JSON.stringify(await snapshot())===before,'最終確認入力キャンセルでも保持');
      await evaluate(`(()=>{window.__layoutConfirm=window.confirm;window.__layoutPrompt=window.prompt;window.confirm=()=>true;window.prompt=()=>${JSON.stringify(language==='ja'?'復元':'RESTORE')};window.__layoutAborted=false;document.querySelector('#toast').hidden=true;const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=original.call(this,stores,mode,...args);if(mode==='readwrite'&&[...tx.objectStoreNames].includes('people')){IDBDatabase.prototype.transaction=original;queueMicrotask(()=>{window.__layoutAborted=true;tx.abort();});}return tx;};document.querySelector('#restore-preview .primary').click();})()`);
      await until(()=>evaluate(`window.__layoutAborted&&!document.querySelector('#toast').hidden&&document.querySelector('#toast').textContent.length>0`),'復元失敗表示');
      await evaluate('window.confirm=window.__layoutConfirm;window.prompt=window.__layoutPrompt;document.querySelector("#toast").hidden=true');check(JSON.stringify(await snapshot())===before,'復元transaction失敗でも人物・画像・記念日・設定保持');
      check((await visibleButton()).reachable,'エラー後も復元ボタンへ到達');
      if(width===390){mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/restore-layout-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      // 通常の書出しでは作られない、長い非改行日時の独立したストレス試験。
      await choose(stressZip,'stress.zip');const stress=await metrics();check(JSON.stringify(await snapshot())===before,'長い日時のプレビューもデータ不変');
      results.push({language,theme,width,prior,cycles,resized,stress,allDataUnchanged:true});
    }
    const invalidBefore=JSON.stringify(await snapshot());
    await evaluate(`(()=>{document.querySelector('#toast').hidden=true;const input=document.querySelector('#import-backup'),d=new DataTransfer();d.items.add(new File(['broken'],'invalid.zip'));input.files=d.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>evaluate('document.querySelector("#restore-preview").hidden&&!document.querySelector("#toast").hidden'),'壊れたZIPの拒否');check(JSON.stringify(await snapshot())===invalidBefore,'壊れたZIP拒否でも全データ保持');
    return{engine:'Microsoft Edge / Chromium; not iOS WebKit',cases:results.length,normalPreviews:results.length*3,normalIssueReproduced:false,results,events:await evaluate('window.__restoreLayoutEvents'),keyboardAndIOSSafeArea:'not emulated',nativeIOSFilePicker:'not tested'};
  }finally{
    await evaluate(`(async()=>{if(window.__layoutURL)URL.createObjectURL=window.__layoutURL;if(window.__layoutAnchor)HTMLAnchorElement.prototype.click=window.__layoutAnchor;if(window.__layoutConfirm)window.confirm=window.__layoutConfirm;if(window.__layoutPrompt)window.prompt=window.__layoutPrompt;const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images','notifications'],'readwrite');for(const n of ['people','images','notifications'])tx.objectStore(n).clear();await new Promise(done=>tx.oncomplete=done);db.close();for(const [id,value]of [['language-choice','ja'],['theme-choice','light']]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}})()`);
    await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#app-version")?.textContent'),'復元調査終了');await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
}
