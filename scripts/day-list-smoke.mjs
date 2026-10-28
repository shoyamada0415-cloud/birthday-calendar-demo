// 一時プロファイル専用。dispatchEventではなくCDPの実マウス・タッチ入力を使う。
export async function verifyDayListGestures({evaluate,until,check,command,sleep,screenshot=async()=>{}}) {
  const people=()=>evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result);};};})`);
  check((await people()).length===0,'一覧ドラッグ検証は空の一時DBのみ');
  await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result));
    const tx=db.transaction('people','readwrite'),time=new Date().toISOString();tx.objectStore('people').put({id:crypto.randomUUID(),displayName:'一覧ドラッグ試験',category:'PET',seriesName:'',memo:'保持',links:[],hasImage:false,createdAt:time,updatedAt:time,
    anniversaries:[{type:'BIRTHDAY',month:5,day:10,year:2000,showAge:true},...['出会い','単発'].map((title,i)=>({id:crypto.randomUUID(),type:'CUSTOM',title,month:5,day:10,year:i?2028:2020,recurring:!i,showAnniversary:true,notify:false}))]});
    await new Promise(done=>tx.oncomplete=done);db.close();})()`);
  const month=async()=>evaluate(`(()=>{document.querySelector('[data-tab=calendar]').click();const p=document.querySelector('#month-title').textContent.match(/(\\d+)年(\\d+)月/);const diff=2028*12+4-(Number(p[1])*12+Number(p[2])-1);for(let n=0;n<Math.abs(diff);n++)document.querySelector(diff>0?'#month-next':'#month-prev').click();})()`);
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('Boolean(document.querySelector("#home-today-date")?.dateTime)'),'一覧再起動');await month();};
  await reload();await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`document.querySelector('[data-tab=settings]').click();const s=document.querySelector('#theme-choice');s.value='dark';s.dispatchEvent(new Event('change'));document.querySelector('[data-tab=calendar]').click()`);
  await until(()=>evaluate('document.documentElement.dataset.theme==="dark"'),'一覧ドラッグをダークで検証');
  const open=async()=>{await sleep(350);await evaluate(`document.querySelector('[data-date="2028-05-10"] .day-open').click();document.querySelector('#toast').hidden=true;`);};
  const ids=()=>evaluate(`[...document.querySelectorAll('.day-event-row')].map(r=>r.dataset.entryId)`);
  const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const start=async(touch=false)=>{await sleep(350);const p=await point('.day-event-row');
    if(touch){await command('Emulation.setTouchEmulationEnabled',{enabled:true});await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});await sleep(650);}
    else{await command('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});}
    return p;
  };
  const move=async(p,touch)=>{if(touch)await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[p]});else await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...p});await sleep(35);};
  const end=async(p,touch)=>{if(touch){await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await command('Emulation.setTouchEmulationEnabled',{enabled:false});}
    else await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});};
  await open();const before=await ids();await start();let target=await point('.day-event-row:last-child');target.y+=10;await move(target,false);
  check(await evaluate('!!document.querySelector(".insert-after")'),'並び替え挿入位置');await screenshot('day-list-reorder-dark-390');await end(target,false);
  await until(async()=>JSON.stringify(await ids())===JSON.stringify([before[1],before[2],before[0]]),'PC並び替え保存');
  await reload();await open();check(JSON.stringify(await ids())===JSON.stringify([before[1],before[2],before[0]]),'再起動で順序保持');
  check(await evaluate(`document.querySelector('[data-date="2028-05-10"] .calendar-event').dataset.eventKey===document.querySelector('.day-event-row').dataset.eventKey`),'代表アイコン順序');
  await start(true);target=await point('.day-event-row:last-child');target.y+=10;await move(target,true);await end(target,true);
  await until(async()=>JSON.stringify(await ids())===JSON.stringify([before[2],before[0],before[1]]),'タッチ並び替え');
  const snapshot=JSON.stringify(await people());
  const leave=async touch=>{const p=await start(touch);const out=await evaluate(`(()=>{const r=document.querySelector('#detail-body').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top-38};})()`);
    // マウスは9px以上でarmした後、一覧外へ出す。タッチは長押し成立済み。
    if(!touch)await move({x:p.x+10,y:p.y},false);await move(out,touch);
    check(await evaluate('!document.querySelector("#detail-dialog").open&&!!document.querySelector(".drag-ghost")'),'一覧を閉じてもドラッグ継続');
    check(await evaluate(`(()=>{const g=document.querySelector('.drag-ghost'),s=getComputedStyle(g);return g.textContent.includes('一覧ドラッグ試験')&&s.color!==s.backgroundColor&&Number(s.opacity)>=.8;})()`),'ダークの追従名表示');
    return point('[data-date="2028-05-15"]');
  };
  target=await leave(true);await move(target,true);
  await screenshot('day-list-calendar-drag-dark-390');
  check(await evaluate('!!document.querySelector(".drop-target")'),'一覧からカレンダー移動先');await end(target,true);
  await until(()=>evaluate('document.querySelector("#move-dialog").open'),'一覧から記念日移動確認');
  check(JSON.stringify(await people())===snapshot,'確認前データ保持');await evaluate('document.querySelector("#move-cancel").click()');
  check(JSON.stringify(await people())===snapshot&&await evaluate('document.querySelector("#detail-dialog").open'),'移動キャンセルと元一覧');
  target=await leave(false);await move(target,false);await end(target,false);await until(()=>evaluate('document.querySelector("#move-dialog").open'),'PC記念日確認');
  await evaluate('document.querySelector("#move-confirm").click()');await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'PC記念日保存');
  let record=(await people())[0];check(record.anniversaries.find(a=>a.title==='単発').day===15&&record.anniversaries[0].year===2000,'正しいIDの単発だけ移動');
  await open(); // 残った誕生日を先頭に並び替えてから移動。
  await evaluate(`(()=>{const row=[...document.querySelectorAll('.day-event-row')].find(r=>r.dataset.eventKey==='BIRTHDAY');row.focus();row.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}));})()`);
  await until(()=>evaluate('document.querySelector(".day-event-row").dataset.eventKey==="BIRTHDAY"'),'補助キーボード並び替え');
  target=await leave(true);await move(target,true);await end(target,true);await until(()=>evaluate('document.querySelector("#move-dialog").open'),'タッチ誕生日確認');
  await evaluate('document.querySelector("#move-confirm").click()');await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'タッチ誕生日保存');
  record=(await people())[0];check(record.anniversaries[0].day===15&&record.anniversaries[0].year===2000,'誕生日移動で生年保持');
  await open();const cancelBefore=JSON.stringify(await people());await leave(false);await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:2,y:2});
  check(JSON.stringify(await people())===cancelBefore,'Escapeはデータ保持');
  check(await evaluate('document.querySelector("#detail-dialog").open'),'Escapeは元の一覧へ戻る');
  await until(()=>evaluate('!document.querySelector(".drag-ghost")'),'Escapeで追従解除');
  if(await evaluate('document.querySelector("#detail-dialog").open'))await evaluate('document.querySelector("#detail-dialog").close()');
  await open();const invalidBefore=JSON.stringify(await people());await leave(true);target={x:2,y:100};await move(target,true);await end(target,true);
  check(JSON.stringify(await people())===invalidBefore&&await evaluate('document.querySelector("#detail-dialog").open'),'無効ドロップは元一覧へ戻す');
  const offlineBefore=JSON.stringify(await people());
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await reload();
  check(JSON.stringify(await people())===offlineBefore,'オフライン再起動でも順序保持');
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate(`document.querySelectorAll('dialog[open]').forEach(d=>d.close())`);
  await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction('people','readwrite');const q=tx.objectStore('people').getAll();q.onsuccess=()=>{for(const p of q.result)if(p.displayName==='一覧ドラッグ試験')tx.objectStore('people').delete(p.id);};await new Promise(done=>tx.oncomplete=done);db.close();})()`);
  await reload();await evaluate(`document.querySelector('#theme-choice').value='light';document.querySelector('#theme-choice').dispatchEvent(new Event('change'));document.querySelector('#calendar-today').click();document.querySelector('[data-tab=home]').click()`);
  return {mouseReorder:true,touchReorder:true,persisted:true,representative:true,modalTransition:true,cancel:true,invalid:true,darkGhost:true,offline:true,anniversaryMove:true,birthdayMove:true,birthYear:true};
}
