import {mkdirSync,writeFileSync} from 'node:fs';
// 必ず空の一時Edgeプロファイルで実行。実利用者のDBには接続しない。
export async function verifyPersonActions({evaluate,until,check,command,sleep}) {
  const read=()=>evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result);};};})`);
  check((await read()).length===0,'人物操作は空の一時DB専用');
  const clock=await command('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date,fixed=NativeDate.parse('2028-05-10T03:00:00Z');window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};}`});
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('document.querySelector("#home-today-date")?.dateTime==="2028-05-10"'),'人物操作の固定日付');};
  const menuOpen=()=>evaluate('!document.querySelector("#person-action-menu").hidden');
  const point=selector=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const click=async selector=>{const p=await point(selector);await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});};
  const key=async k=>{await command('Input.dispatchKeyEvent',{type:'keyDown',key:k});await command('Input.dispatchKeyEvent',{type:'keyUp',key:k});};
  const action=key=>evaluate(`document.querySelector('#person-action-menu [data-action=${key}]').click()`);
  let ids;
  try {
    await reload();await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite');
      for(const [name,birthday]of [['操作登録済み',true],['操作未登録',false],['操作別人物',false]]){const id=crypto.randomUUID(),time=new Date().toISOString();
        tx.objectStore('people').put({id,displayName:name,category:'OTHER',seriesName:'',memo:'保持',username:null,xProfileUrl:null,links:[],hasImage:name==='操作登録済み',createdAt:time,updatedAt:time,
          anniversaries:[...(birthday?[{type:'BIRTHDAY',month:5,day:10,year:2000,showAge:true},{id:crypto.randomUUID(),type:'CUSTOM',title:'対象記念日',month:5,day:11,year:2024,recurring:true,showAnniversary:true,notify:false}]:[])]});
        if(name==='操作登録済み')tx.objectStore('images').put({personId:id,blob:new Blob(['image'],{type:'image/png'}),type:'image/png'});}
      await new Promise(done=>tx.oncomplete=done);db.close();})()`);
    // 有効な画像へ置換する（画像デコードのconsoleエラーを作らない）。
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').fillRect(0,0,512,512);const blob=await new Promise(done=>c.toBlob(done,'image/png'));const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite'),q=tx.objectStore('people').getAll();q.onsuccess=()=>{const p=q.result.find(p=>p.displayName==='操作登録済み');tx.objectStore('images').put({personId:p.id,blob,type:'image/png'});};await new Promise(done=>tx.oncomplete=done);db.close();})()`);
    await reload();const people=await read();ids=Object.fromEntries(people.map(p=>[p.displayName,p.id]));
    const trigger=name=>`#people-list [data-menu-person-id="${ids[name]}"]`;
    await evaluate(`document.querySelector('[data-tab=people]').click()`);await click(trigger('操作登録済み'));
    check(await menuOpen(),'PCの⋯でメニュー');await key('ArrowDown');check(await evaluate('document.activeElement.dataset.action==="edit"'),'メニュー矢印操作');await key('Escape');check(!await menuOpen(),'Escで閉じる');
    await click(trigger('操作登録済み'));await action('edit');check(await evaluate('document.querySelector("#person-dialog").open&&document.querySelector("#person-name").value==="操作登録済み"'),'既存編集フォーム');
    await evaluate('document.querySelector("#person-dialog [data-close]").click()');
    await click(trigger('操作登録済み'));await action('edit');await evaluate(`document.querySelector('#person-memo').value='メニューから編集';document.querySelector('#person-form').requestSubmit()`);
    await until(()=>evaluate('!document.querySelector("#person-dialog").open'),'メニューから編集保存');
    check((await read()).find(p=>p.id===ids['操作登録済み']).memo==='メニューから編集','編集メニューで既存保存を利用');
    const before=JSON.stringify(await read());
    await evaluate(`window.__actionsConfirm=window.confirm;window.confirm=message=>{window.__deleteMessage=message;return false;}`);
    await click(trigger('操作登録済み'));await action('delete');check(JSON.stringify(await read())===before,'削除キャンセルは不変');check(await evaluate('window.__deleteMessage.includes("操作登録済み")'),'削除対象の名前を明示');
    const card=`.person-card[data-person-id="${ids['操作未登録']}"]`,p=await point(card);
    await command('Emulation.setTouchEmulationEnabled',{enabled:true});await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await sleep(650);await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    check(await menuOpen(),'人物タブ長押しメニュー');await action('move');check(await evaluate('location.hash==="#calendar"&&!document.querySelector("#clear-selection").hidden'),'日付選択へ');
    await evaluate('document.querySelector("#clear-selection").click()');
    const drag=async(name,date,touch)=>{
      const from=await point(`#person-rail .avatar-person[data-person-id="${ids[name]}"]`);
      if(touch){await command('Emulation.setTouchEmulationEnabled',{enabled:true});await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});await sleep(650);}
      else{await command('Emulation.setTouchEmulationEnabled',{enabled:false});await command('Input.dispatchMouseEvent',{type:'mouseMoved',...from});await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...from});await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:from.x+15,y:from.y});}
      check(await evaluate('!!document.querySelector(".drag-ghost")'),'人物欄からPointerドラッグ');
      const to=await point(`[data-date="${date}"] .day-open`);
      if(touch){await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[to]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
      else{await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...to});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...to});}
      await until(()=>evaluate('document.querySelector("#move-dialog").open'),'日付の確認');
      check(await evaluate(`document.querySelector('#move-description').textContent.includes('${date}')`),'移動先日付を明示');
    };
    await drag('操作未登録','2028-05-15',true);await evaluate('document.querySelector("#move-cancel").click()');check(JSON.stringify(await read())===before,'ドラッグキャンセル不変');
    await drag('操作未登録','2028-05-15',true);await evaluate('document.querySelector("#move-confirm").click()');await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'未登録誕生日保存');
    check((await read()).find(p=>p.id===ids['操作未登録']).anniversaries[0].day===15,'未登録への登録');
    await drag('操作登録済み','2028-05-16',false);await evaluate('document.querySelector("#move-confirm").click()');await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'登録済み移動保存');
    const saved=(await read()).find(p=>p.id===ids['操作登録済み']);check(saved.anniversaries[0].day===16&&saved.anniversaries[0].year===2000&&saved.anniversaries[1].day===11,'生年と別記念日保持');
    const stable=JSON.stringify(await read());
    // 長押し成立前の縦移動はスクロールへ渡し、通常タップは詳細へ。
    const railSelector=`#person-rail .avatar-person[data-person-id="${ids['操作未登録']}"]`;
    let start=await point(railSelector);await command('Emulation.setTouchEmulationEnabled',{enabled:true});
    await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y-30}]});await sleep(650);await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    check(await evaluate('!document.querySelector(".drag-ghost")&&!document.querySelector("#move-dialog").open'),'スクロールをドラッグにしない');check(JSON.stringify(await read())===stable,'スワイプは不変');
    start=await point(railSelector);await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await until(()=>evaluate('document.querySelector("#detail-dialog").open'),'通常タップは詳細');await evaluate('document.querySelector("#detail-dialog [data-close]").click()');
    await command('Emulation.setTouchEmulationEnabled',{enabled:false});
    for(const escape of [false,true]){
      start=await point(railSelector);await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...start});await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:start.x+15,y:start.y});
      if(escape)await key('Escape');await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:2,y:2});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:2,y:2});
      check(JSON.stringify(await read())===stable,'無効ドロップとEscapeは不変');check(await evaluate('!document.querySelector(".drag-ghost")&&!document.querySelector("#move-dialog").open'),'一時ドラッグを回収');
    }
    await drag('操作登録済み','2028-05-17',false);
    await evaluate(`(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=original.call(this,stores,mode,...args);if(mode==='readwrite'&&[...tx.objectStoreNames].includes('people')){IDBDatabase.prototype.transaction=original;queueMicrotask(()=>tx.abort());}return tx;};document.querySelector('#move-confirm').click();})()`);
    await until(()=>evaluate('!document.querySelector("#move-error").hidden'),'保存失敗を表示');check(JSON.stringify(await read())===stable,'保存失敗でも元の日付');await evaluate('document.querySelector("#move-cancel").click()');
    check(await evaluate('!document.querySelector("#calendar-grid .person-menu-trigger")'),'日付セルの⋯は削除');
    const annFrom=await point('[data-date="2028-05-11"] .calendar-event');
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...annFrom});await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:annFrom.x+15,y:annFrom.y});
    const annTo=await point('[data-date="2028-05-18"] .day-open');await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...annTo});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...annTo});
    await until(()=>evaluate('document.querySelector("#move-dialog").open'),'記念日の移動確認');await evaluate('document.querySelector("#move-confirm").click()');await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'記念日移動');
    const annSaved=(await read()).find(p=>p.id===ids['操作登録済み']);check(annSaved.anniversaries[1].id===saved.anniversaries[1].id&&annSaved.anniversaries[1].day===18&&annSaved.anniversaries[1].year===2024&&annSaved.anniversaries[0].day===16,'対象の記念日だけ移動');
    const layouts=[];
    for(const language of ['ja','en'])for(const theme of ['light','dark'])for(const width of [320,390,430,768,1280]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
      await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const l=document.querySelector('#language-choice');l.value='${language}';l.dispatchEvent(new Event('change'));const s=document.querySelector('#theme-choice');s.value='${theme}';s.dispatchEvent(new Event('change'));})()`);
      await until(()=>evaluate(`document.documentElement.lang==='${language}'&&document.documentElement.dataset.theme==='${theme}'`),'操作メニュー表示設定');
      const colors=await evaluate(`(()=>{
        const rgb=s=>s.match(/[\\d.]+/g).slice(0,3).map(Number),lum=s=>rgb(s).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0),contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        const sample=n=>{const s=getComputedStyle(n),a=getComputedStyle(n.querySelector('.avatar'));return{background:s.backgroundColor,color:s.color,border:s.borderTopColor,avatar:a.backgroundColor,avatarText:a.color,contrast:contrast(s.color,s.backgroundColor),avatarContrast:contrast(a.color,a.backgroundColor)};};
        document.querySelector('[data-tab=calendar]').click();const rail=[...document.querySelectorAll('#person-rail .avatar-person')],registered=rail.find(n=>n.classList.contains('registered')),empty=rail.find(n=>!n.classList.contains('registered'));
        const result={rail:sample(registered),empty:sample(empty),page:getComputedStyle(document.body).backgroundColor};
        registered.classList.add('selected');result.selected=sample(registered);registered.classList.remove('selected');
        registered.classList.add('dragging');result.dragOutline=getComputedStyle(registered).outlineStyle;registered.classList.remove('dragging');
        document.querySelector('[data-tab=people]').click();result.person=sample(document.querySelector('.person-card'));result.image=[...document.querySelectorAll('.person-card img')].every(n=>{const s=getComputedStyle(n);return s.filter==='none'&&s.opacity==='1'&&s.mixBlendMode==='normal';});return result;
      })()`);
      check(colors.image,'登録画像へ色補正しない');
      if(theme==='dark'){
        check(colors.rail.background==='rgb(41, 43, 57)'&&colors.empty.background===colors.rail.background&&colors.person.background===colors.rail.background,'両一覧・登録有無で暗色カード');
        check(colors.rail.background!==colors.page&&colors.rail.border!==colors.rail.background,'背景と境界線を区別');
        check([colors.rail,colors.empty,colors.person].every(s=>s.contrast>=4.5&&s.avatarContrast>=4.5),'カードと文字アバターのコントラスト');
        check(colors.selected.background!==colors.rail.background&&colors.selected.color===colors.rail.color&&colors.dragOutline==='dashed','選択とドラッグ状態を区別');
      }else check(colors.rail.background==='rgb(248, 247, 255)'&&colors.empty.background==='rgb(255, 255, 255)'&&colors.person.background==='rgb(255, 255, 255)','ライトの既存配色を維持');
      await evaluate(`document.querySelector('[data-tab=people]').click()`);await click(trigger('操作未登録'));
      const info=await evaluate(`(()=>{const m=document.querySelector('#person-action-menu'),r=m.getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,labels:[...m.querySelectorAll('button')].map(b=>b.textContent),scroll:document.documentElement.scrollWidth};})()`);
      check(info.inside&&info.scroll<=width&&info.labels[0]===(language==='ja'?'日付を移動':'Move date'),'画面端と翻訳');layouts.push({language,theme,width,...info});
      if(width===390){mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/person-menu-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:2,y:2});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:2,y:2});check(!await menuOpen(),'メニュー外で閉じる');
      if(width===390){for(const tab of ['people','calendar']){await evaluate(`document.querySelector('[data-tab=${tab}]').click();document.querySelector('${tab==='people'?'#people-list':'#person-rail'}').scrollIntoView({block:'center'})`);writeFileSync(`test-artifacts/person-cards-${tab}-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}}
    }
    await evaluate(`document.querySelector('[data-tab=people]').click();window.confirm=()=>true;document.querySelector('[data-menu-person-id="${ids['操作登録済み']}"]').click()`);await action('delete');
    await until(async()=>!(await read()).some(p=>p.id===ids['操作登録済み']),'人物削除');
    check((await read()).length===2,'他人物は保持');
    check(await evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('images').objectStore('images').count();q.onsuccess=()=>{db.close();done(q.result===0);};};})`),'画像も削除');
    return {ellipsis:true,keyboard:true,longPress:true,outside:true,edit:true,deleteCancel:true,deleteConfirmed:true,railTouch:true,railMouse:true,dateConfirm:true,dragCancel:true,scroll:true,tap:true,escape:true,invalidDrop:true,saveFailure:true,birthYear:true,anniversaryId:true,layouts:layouts.length};
  }finally{
    await command('Emulation.setTouchEmulationEnabled',{enabled:false});await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:clock.identifier});
    await evaluate(`(async()=>{if(window.__actionsConfirm)window.confirm=window.__actionsConfirm;const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images','notifications'],'readwrite');for(const n of ['people','images','notifications'])tx.objectStore(n).clear();await new Promise(done=>tx.oncomplete=done);db.close();const l=document.querySelector('#language-choice');l.value='ja';l.dispatchEvent(new Event('change'));const s=document.querySelector('#theme-choice');s.value='light';s.dispatchEvent(new Event('change'));})()`);
    await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#app-version")?.textContent'),'人物操作検証終了');
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
}
