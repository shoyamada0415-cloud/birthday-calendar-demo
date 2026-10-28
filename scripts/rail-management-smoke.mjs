import {mkdirSync,writeFileSync} from 'node:fs';
// 一時プロファイルの空DBだけで検証する。実利用者データは操作しない。
export async function verifyRailManagement({evaluate,until,check,command,sleep}){
  const read=()=>evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result));const values=await Promise.all(['people','images','settings','notifications'].map(s=>new Promise(done=>{db.transaction(s).objectStore(s).getAll().onsuccess=e=>done(e.target.result);})));values[1]=await Promise.all(values[1].map(async i=>({personId:i.personId,type:i.type,bytes:[...new Uint8Array(await i.blob.arrayBuffer())]})));db.close();return values;})()`);
  check((await read())[0].length===0,'管理テストは空DBのみ');
  const clock=await command('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date,fixed=NativeDate.parse('2028-05-10T03:00:00Z');window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};}`});
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('document.querySelector("#home-today-date")?.dateTime==="2028-05-10"'),'管理テスト起動');};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const enter=async()=>{await click('#rail-manage');await click('#rail-manage-menu [data-action=bulk]');};
  let ids;
  try{
    await reload();await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').fillRect(0,0,512,512);const blob=await new Promise(done=>c.toBlob(done,'image/png')),r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite');
      for(const [name,year,day] of [['Alpha',2023,12],['Beta',2021,10],['Gamma',2022,null]]){const id=crypto.randomUUID(),time=year+'-01-01T00:00:00.000Z';tx.objectStore('people').put({id,displayName:name,category:'OTHER',memo:'管理テスト',links:[],hasImage:name==='Alpha',createdAt:time,updatedAt:time,anniversaries:day?[{type:'BIRTHDAY',month:5,day,year:2000,showAge:true},{type:'CUSTOM',id:crypto.randomUUID(),title:'Anniversary',month:5,day,year:2024,recurring:true,notify:true,calendarOrder:1}]:[]});if(name==='Alpha')tx.objectStore('images').put({personId:id,blob,type:'image/png'});}
      await new Promise(done=>tx.oncomplete=done);db.close();})()`);await reload();
    ids=Object.fromEntries((await read())[0].map(p=>[p.displayName,p.id]));
    await click('[data-tab=calendar]');check(await evaluate('!document.querySelector("#calendar-grid .person-menu-trigger")&&document.querySelectorAll("#person-rail .person-menu-trigger").length===3'),'カレンダー⋯だけ除去');
    const before=JSON.stringify(await read());
    await click('#rail-manage');await click('#rail-manage-menu [data-action=sort]');
    for(const [sort,names]of [['nameAsc',['Alpha','Beta','Gamma']],['nameDesc',['Gamma','Beta','Alpha']],['birthday',['Beta','Alpha','Gamma']],['newest',['Alpha','Gamma','Beta']],['oldest',['Beta','Gamma','Alpha']]]){
      await evaluate(`{const s=document.querySelector('#rail-sort');s.value='${sort}';s.dispatchEvent(new Event('change'));}`);
      check(JSON.stringify(await evaluate('[...document.querySelectorAll("#person-rail .avatar-person small")].map(n=>n.textContent)'))===JSON.stringify(names),'人物欄ソート '+sort);
    }
    check(JSON.stringify(await read())===before,'全ソートで保存データ不変');
    await enter();check(await evaluate('document.querySelectorAll("[data-bulk-person-id]").length===3&&document.querySelector("#rail-delete-selected").disabled'),'チェックボックスと0件保護');
    const select=name=>click(`[data-bulk-person-id="${ids[name]}"]`);
    await select('Alpha');await select('Beta');check(await evaluate('document.querySelector("#rail-selected-count").textContent.includes("2")'),'選択数');
    await evaluate('window.__bulkConfirm=window.confirm;window.confirm=m=>{window.__bulkMessage=m;return false;}');await click('#rail-delete-selected');
    check(await evaluate('window.__bulkMessage.includes("2")&&window.__bulkMessage.includes("Alpha")&&window.__bulkMessage.includes("Beta")'),'人数と全対象名の確認');check(JSON.stringify(await read())===before,'確認キャンセルで全データ不変');
    // 一括モードではカレンダー・人物欄双方のPointerドラッグを開始しない。
    for(const selector of ['#calendar-grid .calendar-event','#person-rail .bulk-person']){
      const p=await evaluate(`(()=>{const n=document.querySelector('${selector}');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await command('Emulation.setTouchEmulationEnabled',{enabled:true});await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await sleep(650);await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+20,y:p.y+20}]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      check(await evaluate('!document.querySelector(".drag-ghost")&&!document.querySelector("#move-dialog").open'),'一括時のタッチドラッグ抑止');
    }
    await command('Emulation.setTouchEmulationEnabled',{enabled:false});check(JSON.stringify(await read())===before,'ドラッグ試行でデータ不変');
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape'});check(await evaluate('document.querySelector("#rail-bulk-actions").hidden'),'Escapeで一括モード解除');
    await enter();await select('Alpha');await click('[data-rail-filter=unregistered]');
    check(await evaluate('document.querySelectorAll("[data-bulk-person-id]").length===1&&document.querySelectorAll("[data-bulk-person-id]:checked").length===0&&document.querySelector("#rail-delete-selected").disabled'),'フィルター変更で見えない選択を残さない');
    await click('#rail-bulk-cancel');await click('[data-rail-filter=all]');
    await enter();await select('Alpha');await select('Beta');
    await evaluate(`window.confirm=()=>true;(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=original.call(this,stores,mode,...args);if(mode==='readwrite'&&[...tx.objectStoreNames].includes('people')){IDBDatabase.prototype.transaction=original;queueMicrotask(()=>tx.abort());}return tx;};document.querySelector('#rail-delete-selected').click();})()`);
    await until(()=>evaluate('!document.querySelector("#rail-error").hidden&&!document.querySelector("#rail-delete-selected").disabled'),'一括保存失敗表示');check(JSON.stringify(await read())===before,'一括失敗で画像・記念日・設定・通知を保持');
    check(await evaluate('document.querySelectorAll("[data-bulk-person-id]:checked").length===2'),'失敗時の選択保持');await click('#rail-bulk-cancel');
    let layouts=0;
    for(const language of ['ja','en'])for(const theme of ['light','dark'])for(const width of [320,390,430,768,1280]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
      await evaluate(`document.querySelector('[data-tab=settings]').click();for(const [id,value]of [['language-choice','${language}'],['theme-choice','${theme}']]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}`);
      await until(()=>evaluate(`document.documentElement.lang==='${language}'&&document.documentElement.dataset.theme==='${theme}'`),'管理UI言語テーマ');await click('[data-tab=calendar]');
      check(await evaluate(`(()=>{const b=document.querySelector('#rail-manage'),r=b.getBoundingClientRect();return b.textContent.includes('${language==='ja'?'管理':'Manage'}')&&r.width>=44&&document.documentElement.scrollWidth<=${width};})()`),'管理ボタンと横幅');
      await enter();check(await evaluate(`document.querySelector('#rail-selected-count').textContent==='${language==='ja'?'0人を選択中':'0 selected'}'&&document.documentElement.scrollWidth<=${width}`),'一括ツールバー翻訳と横幅');
      if(width===390){await evaluate('document.querySelector(".people-rail").scrollIntoView({block:"center"})');mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/rail-management-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      await click('#rail-bulk-cancel');layouts++;
    }
    await enter();await select('Alpha');await select('Beta');await click('#rail-delete-selected');await until(async()=>(await read())[0].length===1,'一括削除成功');
    const after=await read();check(after[0][0].displayName==='Gamma'&&after[1].length===0&&after[3].length===0,'対象画像・記念日・通知を整理し他人物を保持');
    return{calendarEllipsisRemoved:true,sorts:5,sortDoesNotWrite:true,bulkCancel:true,bulkFailureAtomic:true,selectionRetained:true,dragDisabled:true,escape:true,bulkDelete:true,relatedData:true,layouts};
  }finally{
    await command('Emulation.setTouchEmulationEnabled',{enabled:false});await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:clock.identifier});
    await evaluate(`(async()=>{if(window.__bulkConfirm)window.confirm=window.__bulkConfirm;const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images','notifications'],'readwrite');for(const name of ['people','images','notifications'])tx.objectStore(name).clear();await new Promise(done=>tx.oncomplete=done);db.close();document.querySelector('[data-tab=settings]').click();for(const [id,value]of [['language-choice','ja'],['theme-choice','light']]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}})()`);
    await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#app-version")?.textContent'),'管理テスト終了');await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
}
