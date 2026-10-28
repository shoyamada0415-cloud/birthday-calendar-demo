import {mkdirSync,writeFileSync} from 'node:fs';

// 明示呼出し・一時Edgeプロファイル専用。実利用者のデータには使用しない。
export async function verifyStandardFont({evaluate,until,check,command,errors}){
  const dir='test-artifacts/zen-maru';mkdirSync(dir,{recursive:true});
  await command('DOM.enable');await command('CSS.enable');
  const snapshot=`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),names=['people','images','settings','notifications'],tx=db.transaction(names);
    const rows=await Promise.all(names.map(n=>new Promise(done=>{const q=tx.objectStore(n).getAll();q.onsuccess=()=>done(q.result);})));db.close();
    rows[1]=await Promise.all(rows[1].map(async i=>({personId:i.personId,type:i.type,sha:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await i.blob.arrayBuffer()))]})));return {version:db.version,rows};})()`;
  check((await evaluate(snapshot)).rows[0].length===0,'書体検証は空の一時DBのみ');
  const clock=await command('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date,fixed=NativeDate.parse('2027-05-10T03:00:00Z');window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};}`});
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('document.querySelector("#home-today-date")?.dateTime==="2027-05-10"'),'正式書体アプリ起動');};
  const load=()=>evaluate(`(async()=>{for(const w of [400,500,700])await document.fonts.load(w+' 16px "Zen Maru Gothic"','今日 日本語 ABC 0123456789');await document.fonts.ready;return [...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status}));})()`);
  await reload();check((await load()).filter(f=>f.status==='loaded').length===3,'3ウェイト読み込み');
  await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').fillRect(0,0,512,512);const blob=await new Promise(done=>c.toBlob(done,'image/png'));
    const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite');
    const id=crypto.randomUUID(),time=new Date().toISOString();tx.objectStore('people').put({id,displayName:'長い人物名の確認テスト 日本語 ABC 0123456789 🎂🙂',category:'OTHER',seriesName:'',memo:'記号 !? @123',username:null,xProfileUrl:null,links:[],hasImage:true,createdAt:time,updatedAt:time,
      anniversaries:[{type:'BIRTHDAY',month:5,day:10,year:null,showAge:false},{id:crypto.randomUUID(),type:'CUSTOM',title:'出会った日',month:5,day:12,year:2020,recurring:true,showAnniversary:true,notify:false}]});
    tx.objectStore('images').put({personId:id,type:'image/png',blob});await new Promise(done=>tx.oncomplete=done);db.close();})()`);
  await reload();await load();
  await evaluate('document.querySelector("#bell").click()');await until(()=>evaluate('document.querySelector("#notification-dialog").open'),'通知');
  await evaluate('document.querySelector("#read-all").click()');await until(()=>evaluate('document.querySelector("#unread-badge").hidden'),'既読');
  await evaluate('document.querySelector("#notification-dialog [data-close]").click()');
  const settings=async(lang,theme)=>{
    await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const l=document.querySelector('#language-choice');l.value='${lang}';l.dispatchEvent(new Event('change'));})()`);
    await until(()=>evaluate(`document.documentElement.lang==='${lang}'`),'言語');
    await evaluate(`(()=>{const t=document.querySelector('#theme-choice');t.value='${theme}';t.dispatchEvent(new Event('change'));})()`);
    await until(()=>evaluate(`document.documentElement.dataset.theme==='${theme}'`),'テーマ');
  };
  await settings('ja','light');const before=await evaluate(snapshot),layouts=[];
  for(const lang of ['ja','en'])for(const theme of ['light','dark']){
    await settings(lang,theme);
    for(const width of [320,390,430,768,1280]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
      for(const tab of ['home','calendar','people','birthdays','settings']){
        await evaluate(`document.querySelector('[data-tab=${tab}]').click()`);
        const info=await evaluate(`(()=>{const root=document.querySelector('#view-${tab}'),nodes=[root,...root.querySelectorAll('button,input,select,textarea,h1,h2,strong,summary')];return {overflow:document.documentElement.scrollWidth>innerWidth,
          wrong:nodes.filter(n=>n.offsetWidth&&!getComputedStyle(n).fontFamily.includes('Zen Maru Gothic')).map(n=>n.id||n.tagName)};})()`);
        check(!info.overflow&&!info.wrong.length,'書体・横幅 '+lang+'/'+theme+'/'+width+'/'+tab+' '+JSON.stringify(info));layouts.push({lang,theme,width,tab});
      }
      if(width===390&&lang==='ja'){
        await evaluate(`document.querySelector('[data-tab=home]').click();scrollTo(0,0);`);
        await evaluate('document.fonts.ready');
        writeFileSync(`${dir}/home-ja-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
      }
      await evaluate('document.querySelector("[data-tab=calendar]").click();document.querySelector("#calendar-add").click()');
      const form=await evaluate(`(()=>{const d=document.querySelector('#person-dialog'),r=d.getBoundingClientRect();return {open:d.open,inside:r.left>=0&&r.right<=innerWidth,controls:[...d.querySelectorAll('input,select,textarea,button')].filter(n=>n.offsetWidth).map(n=>({tag:n.tagName,id:n.id,type:n.type,family:getComputedStyle(n).fontFamily,size:parseFloat(getComputedStyle(n).fontSize)}))};})()`);
      check(form.open&&form.inside&&form.controls.every(n=>n.family.includes('Zen Maru Gothic')&&(!['INPUT','SELECT','TEXTAREA'].includes(n.tag)||['checkbox','radio','range'].includes(n.type)||n.size>=16)),`全入力・ボタンとiOS16px ${width} ${JSON.stringify(form)}`);
      await evaluate('document.querySelector("#person-dialog [data-close]").click()');
    }
  }
  await settings('ja','light');await evaluate('document.querySelector("[data-tab=home]").click()');
  const weights=await evaluate(`Object.fromEntries([['body','body'],['brand','.brand strong'],['heading','#home-today-title'],['button','#calendar-add'],['name','#home-today strong'],['date','#home-today-date'],['badge','#unread-badge']].map(([k,s])=>[k,{weight:getComputedStyle(document.querySelector(s)).fontWeight,family:getComputedStyle(document.querySelector(s)).fontFamily}]))`);
  check(weights.body.weight==='400'&&weights.brand.weight==='700'&&weights.heading.weight==='500'&&weights.name.weight==='500'&&weights.button.weight==='500'&&weights.date.weight==='400','意図した文字階層 '+JSON.stringify(weights));
  await evaluate(`(()=>{const p=document.createElement('p');p.id='standard-font-probe';p.textContent='今日 日本語 ABCxyz 0123456789 !? 🎂🙂';document.querySelector('#view-home').append(p);})()`);
  await load();
  const rendered=async()=>{const dom=await command('DOM.getDocument'),node=await command('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#standard-font-probe'});return (await command('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})).fonts;};
  const fonts=await rendered();check(fonts.some(f=>f.isCustomFont&&f.familyName==='Zen Maru Gothic'&&f.glyphCount>10),'実グリフ描画 '+JSON.stringify(fonts));
  await evaluate('document.querySelector("#standard-font-probe").remove()');
  check(JSON.stringify(await evaluate(snapshot))===JSON.stringify(before),'表示操作後に4storeと画像が不変');
  await command('Network.setCacheDisabled',{cacheDisabled:true});
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await reload();
  const offline=await load();check(offline.every(f=>f.status==='loaded'),'オフライン3ウェイト');
  check(JSON.stringify(await evaluate(snapshot))===JSON.stringify(before),'オフライン再起動で全データ不変');
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  // 意図的にローカルTTFのみ遮断。SW/HTTPキャッシュを迂回し、代替書体で日本語を描画する。
  const errorStart=errors.length;
  await command('Network.setBypassServiceWorker',{bypass:true});await command('Network.setBlockedURLs',{urls:['*fonts/zen-maru-gothic/*.ttf']});await reload();
  await evaluate('document.fonts.ready');
  await evaluate(`(()=>{const p=document.createElement('p');p.id='standard-font-probe';p.textContent='今日 日本語 ABCxyz 0123456789 !? 🎂🙂';document.querySelector('#view-home').append(p);})()`);
  const fallback=await rendered();check(fallback.length>0&&fallback.every(f=>!f.isCustomFont),'取得失敗時のシステム書体 '+JSON.stringify(fallback));
  const blockedFaces=await evaluate('[...document.fonts].filter(f=>f.status==="error").length');
  check(blockedFaces>0,'TTFの遮断が実際に発生');
  const expectedErrors=errors.slice(errorStart).filter(e=>typeof e==='object'&&e.source==='network'&&e.url?.includes('/fonts/zen-maru-gothic/')&&e.text.includes('ERR_BLOCKED_BY_CLIENT'));
  // アプリ例外は残す。実験で発生させた既知のTTF遮断だけ別途報告する。
  for(const error of expectedErrors)errors.splice(errors.indexOf(error),1);
  check(JSON.stringify(await evaluate(snapshot))===JSON.stringify(before),'取得失敗時もデータ不変');
  await command('Network.setBlockedURLs',{urls:[]});await command('Network.setBypassServiceWorker',{bypass:false});await command('Network.setCacheDisabled',{cacheDisabled:false});await reload();await load();
  await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:clock.identifier});
  const result={layouts:layouts.length,weights,fonts,offline,allStoresAndImageUnchanged:true,fallback,blockedFaces,expectedBlockedFontErrors:expectedErrors.length,screenshots:dir};
  writeFileSync(`${dir}/report.json`,JSON.stringify(result,null,2));return result;
}
