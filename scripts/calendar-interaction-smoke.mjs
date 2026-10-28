// 呼び出し元の一時Edgeプロファイルだけを使う。CDP入力から実際のPointer Eventsも検証。
export async function verifyCalendarInteractions({ evaluate, until, check, command, sleep, screenshot = async () => {} }) {
  const records=()=>evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result);};};})`);
  check((await records()).length===0,'操作検証は空の一時DBでのみ実行');
  const goMonth=()=>evaluate(`(()=>{document.querySelector('[data-tab=calendar]').click();const match=document.querySelector('#month-title').textContent.match(/(\\d+)年(\\d+)月/);
    const diff=2028*12+4-(Number(match[1])*12+Number(match[2])-1);
    for(let n=0;n<Math.abs(diff);n++)document.querySelector(diff>0?'#month-next':'#month-prev').click();})()`);
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('Boolean(document.querySelector("#home-today-date")?.dateTime)'),'再起動');await goMonth();};
  const measure=()=>evaluate(`(()=>{const cells=[...document.querySelectorAll('.day-cell')],cell=document.querySelector('[data-date="2028-05-10"]');return {
    grid:document.querySelector('#calendar-grid').getBoundingClientRect().height,heights:[...new Set(cells.map(c=>c.getBoundingClientRect().height))],square:cells.every(c=>Math.abs(c.getBoundingClientRect().width-c.getBoundingClientRect().height)<1),
    visible:cell.querySelectorAll('.calendar-event').length,more:cell.querySelector('.more')?.textContent||'',scroll:document.documentElement.scrollWidth};})()`);
  const emptyCheck=()=>evaluate(`(()=>{const rail=document.querySelector('#person-rail .empty'),list=document.querySelector('#people-list .empty');
    document.querySelector('[data-tab=people]').click();const listBox=list.getBoundingClientRect(),container=document.querySelector('#people-list').getBoundingClientRect();
    document.querySelector('[data-tab=calendar]').click();const box=rail.getBoundingClientRect();return {railWidth:box.width,railHeight:box.height,listWidth:listBox.width,container:container.width,
      horizontal:getComputedStyle(rail).writingMode==='horizontal-tb',scroll:document.documentElement.scrollWidth};})()`);
  await goMonth(); const empty=await emptyCheck();
  check(empty.horizontal&&empty.railWidth>200&&empty.railHeight<100&&empty.listWidth===empty.container&&empty.scroll===390,'空状態の横書き・配置');
  const heights=[await measure()], pcHeights=[];
  const checkPC=async()=>{await command('Emulation.clearDeviceMetricsOverride');await sleep(50);pcHeights.push(await measure());
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(50);};
  await checkPC();
  await evaluate(`window.__interactionIds=[];window.__interactionAnn=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];`);
  for(const count of [1,2,10]) {
    await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo');const db=await new Promise(done=>r.onsuccess=()=>done(r.result));const tx=db.transaction('people','readwrite');
      while(window.__interactionIds.length<${count}){const index=window.__interactionIds.length,id=crypto.randomUUID();window.__interactionIds.push(id);
        const time=new Date().toISOString();tx.objectStore('people').put({id,displayName:'操作テスト'+index,category:index?'PET':'OTHER',seriesName:'',memo:'',username:null,xProfileUrl:null,links:[],hasImage:false,createdAt:time,updatedAt:time,
          anniversaries:[{type:'BIRTHDAY',month:5,day:10,year:2000,showAge:true},...(index?[]:[
            {id:window.__interactionAnn[0],type:'CUSTOM',title:'毎年',month:5,day:11,year:2020,recurring:true,showAnniversary:true,notify:true},
            {id:window.__interactionAnn[1],type:'CUSTOM',title:'一度だけ',month:5,day:12,year:2028,recurring:false,showAnniversary:false,notify:false},
            {id:window.__interactionAnn[2],type:'CUSTOM',title:'年なし',month:5,day:11,year:null,recurring:true,showAnniversary:false,notify:false}])]});}
      await new Promise((done,fail)=>{tx.oncomplete=done;tx.onabort=fail;});db.close();})()`);
    // ページ再読み込みをまたぐfixture IDはDBから回収する。
    await reload();
    await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo');const db=await new Promise(done=>r.onsuccess=()=>done(r.result));const q=db.transaction('people').objectStore('people').getAll();
      const people=await new Promise(done=>q.onsuccess=()=>done(q.result));window.__interactionIds=people.map(p=>p.id);window.__interactionAnn=people.find(p=>p.displayName==='操作テスト0').anniversaries.slice(1).map(a=>a.id);db.close();})()`);
    heights.push(await measure());
    await checkPC();
  }
  check(heights.every(m=>m.grid===heights[0].grid&&m.square&&m.scroll===390),'0/1/2/10件で正方形・高さ不変');
  check(heights[3].visible===1&&heights[3].more==='+9'&&heights[2].more==='+1','スマホ省略数');
  check(pcHeights.every(m=>m.grid===pcHeights[0].grid&&m.square)
    &&pcHeights[3].visible===1&&pcHeights[3].more==='+9','PC正方形・省略数');
  await evaluate(`document.querySelector('[data-date="2028-05-10"] .more').click()`);
  check(await evaluate('document.querySelectorAll("#detail-body .item-row").length===10'),'省略分の全予定');
  await evaluate('document.querySelector("#detail-dialog [data-close]").click()');
  await evaluate(`document.querySelector('[data-date="2028-05-10"]').scrollIntoView({block:'center'});document.querySelector('#toast').hidden=true;`);
  await screenshot('calendar-fixed-height-390');
  const data=await records(), main=data.find(p=>p.displayName==='操作テスト0');
  await evaluate(`document.querySelector('#calendar-category').value='OTHER';document.querySelector('#calendar-category').dispatchEvent(new Event('change'))`);
  const selector=(key)=>`.calendar-event[data-person-id="${main.id}"][data-event-key="${key}"]`;
  await evaluate(`window.__pointerTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(type,event=>window.__pointerTrace.push({type:event.type,pointer:event.pointerType,trusted:event.isTrusted}),true);`);
  async function drag(key, date, touch=false, mode='normal') {
    await sleep(350);
    const points=await evaluate(`(()=>{const item=document.querySelector(${JSON.stringify(selector(key))});item.scrollIntoView({block:'center'});const rect=item.getBoundingClientRect();
      const target=document.querySelector('[data-date="${date}"]').getBoundingClientRect(),source=item.closest('.day-cell').getBoundingClientRect();return {start:{x:rect.left+rect.width/2,y:rect.top+rect.height/2},end:{x:target.left+target.width/2,y:target.top+rect.top-source.top+rect.height/2}};})()`);
    if(mode==='invalid')points.end={x:2,y:2};
    if(mode==='scroll')points.end={x:points.start.x,y:points.start.y+90};
    if(touch) {
      await command('Emulation.setTouchEmulationEnabled',{enabled:true});
      await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points.start]});await sleep(mode==='scroll'?30:650);
      if(mode==='hide')await evaluate('window.dispatchEvent(new Event("pagehide"))');
      for(let n=1;n<=5;n++)await command('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:points.start.x+(points.end.x-points.start.x)*n/5,y:points.start.y+(points.end.y-points.start.y)*n/5}]});
    } else {
      await command('Input.dispatchMouseEvent',{type:'mouseMoved',...points.start});
      await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...points.start});
      for(let n=1;n<=5;n++)await command('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:points.start.x+(points.end.x-points.start.x)*n/5,y:points.start.y+(points.end.y-points.start.y)*n/5});
    }
    const highlighted=await evaluate('document.querySelectorAll(".drop-target").length');
    if(touch){await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await command('Emulation.setTouchEmulationEnabled',{enabled:false});}
    else await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...points.end});
    await sleep(80);return highlighted;
  }
  const before=JSON.stringify(await records());
  await command('Emulation.clearDeviceMetricsOverride');await sleep(50);
  check(await drag('BIRTHDAY','2028-05-11')===1,'PCドラッグ先強調');
  check(await evaluate('document.querySelector("#move-dialog").open && !document.querySelector("#detail-dialog").open'),'ドラッグとタップの区別');
  check(JSON.stringify(await records())===before,'確認前に保存している');
  await evaluate('document.querySelector("#move-cancel").click()');
  check(JSON.stringify(await records())===before,'キャンセルで保存');
  await drag('BIRTHDAY','2028-05-11');await evaluate('document.querySelector("#move-confirm").click()');
  await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'誕生日保存');
  let updated=(await records()).find(p=>p.id===main.id);
  check(updated.anniversaries[0].day===11&&updated.anniversaries[0].year===2000,'誕生日移動・生年');
  await evaluate(`document.querySelector('#calendar-event-type').value='ANNIVERSARY';document.querySelector('#calendar-event-type').dispatchEvent(new Event('change'))`);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(50);
  check(await drag(main.anniversaries[1].id,'2028-05-20',true)===1,'タッチドラッグの移動先強調');
  check(await evaluate('document.querySelector("#move-dialog").open'),'タッチdropの確認');
  await screenshot('calendar-move-confirm-390');
  await evaluate('document.querySelector("#move-confirm").click()');await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'記念日保存');
  updated=(await records()).find(p=>p.id===main.id);
  check(updated.anniversaries[1].day===20&&updated.anniversaries[1].year===2020&&updated.anniversaries[3].day===11,'記念日ID別変更');
  await drag(main.anniversaries[2].id,'2028-05-14');await evaluate('document.querySelector("#move-confirm").click()');
  await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'単発記念日保存');
  check((await records()).find(p=>p.id===main.id).anniversaries[2].day===14,'単発記念日移動');
  await evaluate(`document.querySelector('#calendar-event-type').value='ALL';document.querySelector('#calendar-event-type').dispatchEvent(new Event('change'))`);
  const stable=JSON.stringify(await records());
  await drag('BIRTHDAY','2028-05-11');check(!await evaluate('document.querySelector("#move-dialog").open'),'同日dropで確認');
  await drag('BIRTHDAY','2028-05-12',false,'invalid');check(!await evaluate('document.querySelector("#move-dialog").open'),'無効dropで確認');
  await drag('BIRTHDAY','2028-05-12',true,'hide');check(!await evaluate('document.querySelector("#move-dialog").open || !!document.querySelector(".drag-ghost")'),'画面離脱キャンセル');
  await drag('BIRTHDAY','2028-05-12',true,'scroll');check(!await evaluate('document.querySelector("#move-dialog").open'),'長押し前移動はドラッグしない');
  check(JSON.stringify(await records())===stable,'無効操作でデータ変更');
  await drag('BIRTHDAY','2028-05-15');
  check(await evaluate('document.querySelector("#move-dialog").open'),'保存失敗検証のdrop確認が開かない');
  await evaluate(`(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=original.call(this,stores,mode,...args);
    if(mode==='readwrite'&&[...tx.objectStoreNames].includes('people')){IDBDatabase.prototype.transaction=original;queueMicrotask(()=>tx.abort());}return tx;};document.querySelector('#move-confirm').click();})()`);
  await until(()=>evaluate('!document.querySelector("#move-error").hidden'),'保存失敗の案内');
  check(JSON.stringify(await records())===stable&&await evaluate('document.querySelector("#move-dialog").open'),'保存失敗時の元日付維持');
  await evaluate('document.querySelector("#move-cancel").click();document.querySelector("[data-tab=people]").click()');
  const point=await evaluate(`(()=>{const card=document.querySelector('.person-card');card.scrollIntoView({block:'center'});const r=card.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await command('Emulation.setTouchEmulationEnabled',{enabled:true});
  await command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await sleep(650);
  await command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await command('Emulation.setTouchEmulationEnabled',{enabled:false});
  check(await evaluate(`!document.querySelector('#person-action-menu').hidden&&location.hash==='#people'`),'人物長押しは操作メニュー');
  await evaluate(`document.querySelector('#person-action-menu [data-action=move]').click()`);
  check(await evaluate(`location.hash==='#calendar'&&!document.querySelector('#clear-selection').hidden&&!document.querySelector('#detail-dialog').open
    &&document.querySelector('.avatar-person.selected')!==null&&window.getSelection().toString()===''
    &&getComputedStyle(document.querySelector('.avatar-person')).userSelect==='none'`),'人物長押し選択・文字選択抑止');
  await screenshot('calendar-selection-390');
  await evaluate('document.querySelector("#clear-selection").click()');
  // 日英の新規登録・移動確認と、検索0件の全幅空状態。
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const language=document.querySelector('#language-choice');language.value='en';language.dispatchEvent(new Event('change'));})()`);
  await until(()=>evaluate('document.documentElement.lang==="en"'),'英語切替');
  await evaluate(`(()=>{document.querySelector('[data-tab=people]').click();const search=document.querySelector('#people-search');search.value='no-such-person';search.dispatchEvent(new Event('input'));})()`);
  check(await evaluate(`document.querySelector('#people-list .empty').textContent==='No people match these filters.'
    &&document.querySelector('#people-list .empty').getBoundingClientRect().width===document.querySelector('#people-list').getBoundingClientRect().width`),'英語検索0件の全幅表示');
  await evaluate(`document.querySelector('#people-search').value='';document.querySelector('#people-search').dispatchEvent(new Event('input'));document.querySelector('[data-tab=calendar]').click();`);
  await drag('BIRTHDAY','2028-05-16');
  check(await evaluate(`document.querySelector('#move-title').textContent==='Change event date'&&document.querySelector('#move-confirm').textContent==='Change date'
    &&document.querySelector('#move-cancel').textContent==='Cancel'&&document.querySelector('#day-add').textContent==='Add a new person on this date'`),'新UIの英語');
  await evaluate(`(()=>{document.querySelector('#move-cancel').click();document.querySelector('[data-tab=settings]').click();const language=document.querySelector('#language-choice');language.value='ja';language.dispatchEvent(new Event('change'));})()`);
  await until(()=>evaluate('document.documentElement.lang==="ja"'),'日本語復帰');
  await evaluate(`document.querySelector('[data-tab=calendar]').click()`);
  check(await evaluate('document.querySelector("#clear-selection").hidden&&!document.querySelector(".avatar-person.selected")'),'選択解除');
  await evaluate(`document.querySelector('.avatar-person').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true}))`);
  check(await evaluate('!document.querySelector("#clear-selection").hidden'),'キーボード選択');
  await evaluate('document.querySelector("#clear-selection").click()');
  await command('Emulation.clearDeviceMetricsOverride');
  await evaluate(`document.querySelector('#calendar-category').value='ALL';document.querySelector('#calendar-category').dispatchEvent(new Event('change'))`);
  const pc=await measure();check(pc.square&&pc.visible===1,'PC正方形・1予定');
  const trace=await evaluate('window.__pointerTrace');
  for(const pointer of ['mouse','touch'])for(const type of ['pointerdown','pointermove','pointerup'])check(trace.some(e=>e.type===type&&e.pointer===pointer&&e.trusted),'実Pointer Events '+pointer+' '+type);
  // fixtureだけを削除。利用者DB初期化の実装は一切追加しない。
  await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo');const db=await new Promise(done=>r.onsuccess=()=>done(r.result));const tx=db.transaction(['people','notifications'],'readwrite');
    const q=tx.objectStore('people').getAll();q.onsuccess=()=>{for(const p of q.result)if(p.displayName.startsWith('操作テスト'))tx.objectStore('people').delete(p.id);};
    const n=tx.objectStore('notifications').getAll();n.onsuccess=()=>{for(const notice of n.result)tx.objectStore('notifications').delete(notice.id);};
    await new Promise(done=>tx.oncomplete=done);db.close();})()`);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await reload();
  await evaluate('document.querySelector("#calendar-today").click();document.querySelector("[data-tab=home]").click()');
  return {heights,pcHeights,empty,pc,mouse:true,touch:true,trustedPointerEvents:true,confirmation:true,birthYearPreserved:true,anniversaryId:true,singleEvent:true,cancel:true,invalid:true,saveFailure:true,selection:true,english:true};
}
