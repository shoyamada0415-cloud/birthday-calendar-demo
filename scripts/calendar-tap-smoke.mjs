import {mkdirSync,writeFileSync} from 'node:fs';
// 空の一時プロファイルだけを対象とし、架空人物でタップとドラッグの競合を検証。
export async function verifyCalendarTaps({evaluate,until,check,command,sleep}){
  const records=()=>evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result);};};})`);
  check((await records()).length===0,'タップ検証は空の一時DBだけ');
  const clock=await command('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date,fixed=NativeDate.parse('2028-05-10T03:00:00Z');window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};}`});
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('document.querySelector("#home-today-date")?.dateTime==="2028-05-10"'),'日付タップ検証起動');};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const point=async(selector,position='center')=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:${position==='background'?'r.right-4':'r.left+r.width/2'},y:${position==='number'?'r.top+7':'r.top+r.height/2'},scrollX,scrollY,month:document.querySelector('#month-title').textContent};})()`);
  const pointer=async(p,touch)=>{await command('Emulation.setTouchEmulationEnabled',{enabled:touch});
    if(touch){await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else{await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:p.x,y:p.y});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p.x,y:p.y});}};
  const close=async(before,escape=false)=>{
    if(escape){await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});}
    else await click('#detail-dialog [data-close]');
    await until(()=>evaluate('!document.querySelector("#detail-dialog").open'),`日付一覧を閉じる（Escape=${escape}）`);await sleep(80);
    check(await evaluate(`Math.abs(scrollY-${before.scrollY})<2&&Math.abs(scrollX-${before.scrollX})<2&&document.querySelector('#month-title').textContent===${JSON.stringify(before.month)}`),'表示月とスクロール位置を保持');
  };
  const list=async(count)=>{await until(()=>evaluate(`document.querySelector('#detail-dialog').open&&document.querySelectorAll('#detail-body .day-event-row').length===${count}&&!document.querySelector('.detail-top')&&!document.querySelector('#day-add').hidden`),'同じ日付一覧');};
  try{
    await reload();await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').fillRect(0,0,512,512);const blob=await new Promise(done=>c.toBlob(done,'image/png'));const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite');
      for(const [index,name]of ['Tap Alpha','Tap Beta','Tap Gamma'].entries()){const id=crypto.randomUUID(),time=new Date().toISOString();tx.objectStore('people').put({id,displayName:name,category:'OTHER',memo:'Tap test',links:[],hasImage:index===0,createdAt:time,updatedAt:time,anniversaries:[{type:'BIRTHDAY',month:5,day:10,year:2000,calendarOrder:index},...(index===0?[{id:crypto.randomUUID(),type:'CUSTOM',title:'出会った日',month:5,day:10,year:2024,recurring:true,showAnniversary:true,notify:false}]:[])]});if(index===0)tx.objectStore('images').put({personId:id,blob,type:'image/png'});}
      await new Promise(done=>tx.oncomplete=done);db.close();})()`);await reload();await click('[data-tab=calendar]');
    const before=JSON.stringify(await records()),base='[data-date="2028-05-10"]';
    let taps=0;
    for(const touch of [false,true])for(const [selector,position]of [[base,'background'],[base+' .day-open','number'],[base+' .calendar-event','center'],[base+' .avatar img','center'],[base+' .more','center']]){
      const p=await point(selector,position);await pointer(p,touch);await list(4);
      check(await evaluate(`(()=>{const rows=[...document.querySelectorAll('#detail-body .day-event-row')];return new Set(rows.map(r=>r.dataset.personId)).size===3&&rows.some(r=>r.textContent.includes('出会った日'))&&rows.filter(r=>r.querySelector('img')).length===2;})()`),'画像・全人物・記念日表示');
      await close(p,touch);taps++;
    }
    // 現在は人物名はCSSで省略。名前要素のclickも同じセルへ届くことを確認。
    let p=await point(base);await click(base+' .event-name');await list(4);await close(p);
    p=await point(base+' .calendar-event');await pointer(p,false);await list(4);
    const row=await point('#detail-body .day-event-row');await pointer(row,true);await until(()=>evaluate('!!document.querySelector("#detail-body .detail-top")'),'一覧内の人物タップで既存詳細');await close(p);
    // 空の日も同じdialog→既存登録フォーム。生年を設定せず、キャンセルは保存しない。
    p=await point('[data-date="2028-05-20"]');await pointer(p,true);await list(0);
    check(await evaluate('document.querySelector("#detail-body").textContent.includes("この日の予定はありません")'),'空日付の案内');await click('#day-add');
    check(await evaluate('document.querySelector("#person-dialog").open&&document.querySelector("#person-birth-month").value==="5"&&document.querySelector("#person-birth-day").value==="20"'),'空日付から既存フォーム');
    await click('#person-dialog [data-close]');await sleep(80);check(JSON.stringify(await records())===before,'登録キャンセルでデータ不変');
    // 実Pointer操作でドロップ確認だけが開き、タップ一覧が同時に開かない。
    const drag=async(selector,to,touch)=>{const start=await point(selector);await command('Emulation.setTouchEmulationEnabled',{enabled:touch});
      if(touch){await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y}]});await sleep(650);}
      else{await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:start.x,y:start.y});await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:start.x+15,y:start.y});}
      check(await evaluate('!!document.querySelector(".drag-ghost")&&!document.querySelector("#detail-dialog").open'),'長押しドラッグは一覧を開かない');
      const end=await point(`[data-date="${to}"] .day-open`);
      if(touch){await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:end.x,y:end.y}]});await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
      else{await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:end.x,y:end.y});await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:end.x,y:end.y});}
      await until(()=>evaluate('document.querySelector("#move-dialog").open'),'ドロップの移動確認');await sleep(100);
      check(await evaluate('!document.querySelector("#detail-dialog").open'),'ドロップ直後のタップ一覧を抑止');await click('#move-cancel');check(JSON.stringify(await records())===before,'移動確認キャンセルでデータ保持');
    };
    for(const touch of [false,true]){await drag(base+' .calendar-event','2028-05-11',touch);await drag('#person-rail .avatar-person','2028-05-12',touch);}
    await command('Emulation.setTouchEmulationEnabled',{enabled:false});
    // 登録用の日付選択は今までどおり一覧の明示ボタンを経由する。
    await click('#person-rail .person-menu-trigger');await click('#person-action-menu [data-action=move]');await click('[data-date="2028-05-20"] .day-open');await list(0);
    check(await evaluate('!document.querySelector("#day-assign").hidden'),'既存人物の誕生日選択を維持');await click('#detail-dialog [data-close]');await click('#clear-selection');
    let layouts=0;
    for(const language of ['ja','en'])for(const theme of ['light','dark'])for(const width of [320,390,430,768,1280]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
      await evaluate(`document.querySelector('[data-tab=settings]').click();for(const [id,value]of [['language-choice','${language}'],['theme-choice','${theme}']]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}`);
      await until(()=>evaluate(`document.documentElement.lang==='${language}'&&document.documentElement.dataset.theme==='${theme}'`),'日付一覧の表示設定');await click('[data-tab=calendar]');
      p=await point(base+' .calendar-event');await pointer(p,width<768);await list(4);
      check(await evaluate(`document.documentElement.scrollWidth<=${width}&&document.querySelector('#detail-dialog h2').textContent==='${language==='ja'?'5月10日の予定':'Events on 5/10'}'`),'日付一覧の翻訳・横幅');
      if(width===390){mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/calendar-tap-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      await close(p);layouts++;
    }
    check(JSON.stringify(await records())===before,'全タップ・表示設定で人物データ不変');
    await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await reload();await click('[data-tab=calendar]');await click(base+' .calendar-event');await list(4);await click('#detail-dialog [data-close]');
    return{tapTargets:taps,nameBubbles:true,allPeople:true,image:true,eventTypes:true,detailFromList:true,emptyDay:true,addFromEmpty:true,monthAndScroll:true,mouseDrag:true,touchDrag:true,railDrag:true,dropWins:true,cancelPreserved:true,dateSelection:true,layouts,offline:true,dataUnchanged:true};
  }finally{
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:0,uploadThroughput:0});await command('Emulation.setTouchEmulationEnabled',{enabled:false});await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:clock.identifier});
    await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images','notifications'],'readwrite');for(const n of ['people','images','notifications'])tx.objectStore(n).clear();await new Promise(done=>tx.oncomplete=done);db.close();document.querySelector('[data-tab=settings]').click();for(const [id,value]of [['language-choice','ja'],['theme-choice','light']]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change'));}})()`);
    await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#app-version")?.textContent'),'日付タップ検証終了');await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
}
