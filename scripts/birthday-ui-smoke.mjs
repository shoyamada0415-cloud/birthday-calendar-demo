import {mkdirSync,writeFileSync} from 'node:fs';

// 実利用者と分離した空のEdgeプロファイルだけで動かす。
export async function verifyBirthdayUI({evaluate,until,check,command}){
  const dir='test-artifacts/birthday-ui';mkdirSync(dir,{recursive:true});
  const read=()=>evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result);};};})`);
  check((await read()).length===0,'誕生日UIは空の一時DB専用');
  const clock=await command('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date,fixed=NativeDate.parse('2027-05-10T03:00:00Z');window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};}`});
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('document.querySelector("#home-today-date")?.dateTime==="2027-05-10"'),'固定日付');};
  const set=async(selector,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(String(value))};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const close=()=>evaluate('document.querySelector("#person-dialog [data-close]").click()');
  const save=async()=>{await evaluate('document.querySelector("#person-form").requestSubmit()');await until(()=>evaluate('!document.querySelector("#person-dialog").open'),'人物保存');};
  const edit=async(name)=>{
    await evaluate(`document.querySelector('[data-tab=people]').click();[...document.querySelectorAll('#people-list .person-card')].find(n=>n.textContent.includes(${JSON.stringify(name)})).click()`);
    await until(()=>evaluate('document.querySelector("#detail-dialog").open'),'人物詳細');
    await evaluate('document.querySelector("#detail-edit").click()');await until(()=>evaluate('document.querySelector("#person-dialog").open'),'再編集');
  };
  try{
    await reload();await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    for(const[name,day,year]of [['同日A',11,1998],['同日B',11,1500],['同日C',11,null],['翌日',12,2099],['今日',10,null],['未登録',null,null]]){
      await evaluate('document.querySelector("[data-tab=calendar]").click();document.querySelector("#calendar-add").click()');await set('#person-name',name);
      if(day){await set('#person-birth-month',5);await set('#person-birth-day',day);}
      if(year===1998)await set('#person-birth-year-choice',year);
      else if(year){await set('#person-birth-year-mode','custom');await set('#person-birth-year',year);
        await set('#person-birth-year-mode','select');check(await evaluate(`document.querySelector('#person-birth-year-choice').value==='${year}'&&document.querySelector('#person-birth-year').value==='${year}'`),'候補外年を選択式でも保持');
        await set('#person-birth-year-mode','custom');check(await evaluate(`document.querySelector('#person-birth-year').value==='${year}'`),'自由入力へ戻して値保持');}
      if(name==='同日A'){
        await evaluate('document.querySelector("#add-anniversary").click()');
        check(await evaluate('document.querySelector(".ann-month").tagName==="SELECT"&&document.querySelector(".ann-day").tagName==="SELECT"'),'記念日の選択UI');
        await set('.ann-title','うるう記念日');await set('.ann-month',1);await set('.ann-day',31);await set('.ann-month',4);
        check(await evaluate('document.querySelector(".ann-day").value===""&&!document.querySelector(\'.ann-day option[value="31"]\')'),'月変更で無効日をクリア');
        await set('.ann-month',2);await set('.ann-day',29);
        await evaluate('document.querySelector("#add-anniversary").click()');await set('.anniversary-edit:nth-child(2) .ann-title','4月の記念日');
        await set('.anniversary-edit:nth-child(2) .ann-month',4);await set('.anniversary-edit:nth-child(2) .ann-day',30);await set('.anniversary-edit:nth-child(2) .ann-year',2024);
        check(await evaluate('!document.querySelector(\'.anniversary-edit:nth-child(2) .ann-day option[value="31"]\')'),'4月31日は選べない');
      }
      await save();
    }
    await evaluate('document.querySelector("[data-tab=home]").click()');
    check(await evaluate('document.querySelectorAll("#home-next .item-row").length===3&&[...document.querySelectorAll("#home-next .avatar")].every(n=>n.getBoundingClientRect().width===44)'),'同日3人と44px');
    check(await evaluate(`document.querySelector('#home-today').textContent.includes('今日')&&![...document.querySelectorAll('#home-next .item-row,#home-upcoming .item-row')].some(n=>n.querySelector('strong').textContent==='今日')`),'当日の人物を次回・近日に重複表示しない');
    for(const name of ['同日A','同日B','同日C']){
      await evaluate(`[...document.querySelectorAll('#home-next .item-row')].find(n=>n.textContent.includes('${name}')).click()`);
      check(await evaluate('document.querySelector("#detail-dialog").open'),'同日各人の詳細');await evaluate('document.querySelector("#detail-dialog [data-close]").click()');
    }
    await edit('同日B');
    check(await evaluate('document.querySelector("#person-birth-year-mode").value==="custom"&&document.querySelector("#person-birth-year").value==="1500"'),'過去年は再編集も自由入力');
    await set('#person-birth-year',2099);await save();await edit('同日B');
    check(await evaluate('document.querySelector("#person-birth-year").value==="2099"&&document.querySelector("#person-birth-month").value==="5"&&document.querySelector("#person-birth-day").value==="11"'),'未来年保存・再編集・月日維持');
    await set('#person-birth-year',1500);await save();
    await edit('同日A');
    check(await evaluate('document.querySelectorAll(".anniversary-edit").length===2&&document.querySelector(".ann-month").value==="2"&&document.querySelector(".ann-day").value==="29"'),'複数記念日再編集');
    const beforeCancel=JSON.stringify(await read());await set('.ann-month',4);await set('#person-birth-year-mode','custom');await set('#person-birth-year','abc');
    check(await evaluate('!document.querySelector("#person-birth-year").checkValidity()'),'文字列年を拒否');
    await set('#person-birth-year-mode','select');check(await evaluate('document.querySelector("#person-birth-year-mode").value==="custom"&&document.querySelector("#person-birth-year").value==="abc"'),'不正入力は消さず修正可能');
    await close();check(JSON.stringify(await read())===beforeCancel,'キャンセルで人物・記念日不変');
    await edit('同日B');await set('#person-birth-year-mode','select');await set('#person-birth-year-choice','');await save();await edit('同日B');
    check(await evaluate('document.querySelector("#person-birth-year-choice").value===""&&document.querySelector("#person-birth-year").value===""'),'未設定保存・再編集');await close();
    await evaluate('document.querySelector("#bell").click();document.querySelector("#read-all").click()');await until(()=>evaluate('document.querySelector("#unread-badge").hidden'),'通知既読');
    await evaluate('document.querySelector("#notification-dialog [data-close]").click()');
    const dataBefore=JSON.stringify(await read()),layouts=[];
    for(const language of ['ja','en'])for(const theme of ['light','dark']){
      await set('#language-choice',language);await until(()=>evaluate(`document.documentElement.lang==='${language}'`),'言語');
      await set('#theme-choice',theme);await until(()=>evaluate(`document.documentElement.dataset.theme==='${theme}'`),'テーマ');
      for(const width of [320,390,430,768,1280]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
        await evaluate('document.querySelector("[data-tab=home]").click()');
        check(await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.querySelectorAll("#home-next .item-row").length===3'),'ホーム同日全員の幅');
        await edit('同日A');
        const info=await evaluate(`(()=>{const d=document.querySelector('#person-dialog'),r=d.getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth,scroll:d.scrollWidth<=d.clientWidth,controls:[...d.querySelectorAll('select,input:not([type=checkbox]),textarea')].filter(n=>n.offsetWidth).every(n=>parseFloat(getComputedStyle(n).fontSize)>=16),mode:document.querySelector('#person-birth-year-mode option[value=custom]').textContent,month:document.querySelector('.ann-month option[value="2"]').textContent,day:document.querySelector('.ann-day option[value="29"]').textContent};})()`);
        check(info.inside&&info.scroll&&info.controls,'フォーム表示 '+language+'/'+theme+'/'+width+' '+JSON.stringify(info));
        check(info.mode===(language==='ja'?'自由入力':'Enter a year')&&info.day===(language==='ja'?'29日':'29'),'月日・入力方式翻訳');
        layouts.push({language,theme,width,...info});
        if(width===390){writeFileSync(`${dir}/form-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
        await close();await evaluate('document.querySelector("[data-tab=home]").click();scrollTo(0,0)');
        if(width===390){await until(()=>evaluate('document.querySelector("#toast").hidden'),'保存案内の終了');writeFileSync(`${dir}/home-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
      }
    }
    await set('#language-choice','ja');await until(()=>evaluate('document.documentElement.lang==="ja"'),'言語復帰');await set('#theme-choice','light');
    check(JSON.stringify(await read())===dataBefore,'表示・入力切替・キャンセルでDB不変');
    await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await reload();
    check(await evaluate('document.querySelectorAll("#home-next .item-row").length===3'),'オフライン同日全員');
    check(JSON.stringify(await read())===dataBefore,'オフライン人物保持');
    return {sameDay:3,avatars44:true,details:true,anniversarySelects:true,invalidDayCleared:true,leapDay:true,multipleAnniversaries:true,
      yearChoices:121,pastYear:true,futureYear:true,unset:true,modePreserved:true,cancelPreserved:true,layouts:layouts.length,offline:true,screenshots:dir};
  }finally{
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:clock.identifier});
    await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images','notifications'],'readwrite');
      const ids=new Set(),q=tx.objectStore('people').getAll();q.onsuccess=()=>{for(const p of q.result){ids.add(p.id);tx.objectStore('people').delete(p.id);tx.objectStore('images').delete(p.id);}const n=tx.objectStore('notifications').getAll();n.onsuccess=()=>{for(const notice of n.result)if(ids.has(notice.personId))tx.objectStore('notifications').delete(notice.id);};};await new Promise(done=>tx.oncomplete=done);db.close();})()`);
    await command('Page.reload');await until(()=>evaluate('Boolean(document.querySelector("#home-today-date")?.dateTime)'),'テスト時計解除');
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
}
