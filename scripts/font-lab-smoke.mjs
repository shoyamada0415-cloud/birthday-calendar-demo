import {mkdirSync,writeFileSync} from 'node:fs';
import {FONTS} from '../dev/font-lab/catalog.mjs';

export async function verifyFontLab({evaluate,until,check,command}){
  await command('DOM.enable');await command('CSS.enable');
  const dir='test-artifacts/font-comparison';mkdirSync(dir,{recursive:true});
  const snap=`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),names=['people','images','settings','notifications'],tx=db.transaction(names);
    const records=await Promise.all(names.map(n=>new Promise(done=>{const q=tx.objectStore(n).getAll();q.onsuccess=()=>done(q.result);})));db.close();
    records[1]=await Promise.all(records[1].map(async i=>({personId:i.personId,type:i.type,sha:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await i.blob.arrayBuffer()))]})));return {version:db.version,records};})()`;
  check((await evaluate(snap)).records[0].length===0,'フォント検証は空の一時DBのみ');
  await command('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date,fixed=NativeDate.parse('2027-05-10T03:00:00Z');window.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};}`});
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#font-lab-choice")&&document.querySelector("#home-today-date")?.dateTime==="2027-05-10"'),'比較版起動');};
  await reload();
  check(await evaluate('document.querySelectorAll("#font-lab-choice option").length===7'),'現在＋6書体');
  await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');g.fillStyle='#b4c3b0';g.fillRect(0,0,512,512);const blob=await new Promise(done=>c.toBlob(done,'image/png'));
    const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite');
    for(const[name,day]of [['比較用の葵',10],['長い人物名の比較テスト ABC 0123456789 🎂🙂 名前が長くても既存の表示方法を維持します',13],['比較用の凪',24]]){
      const id=crypto.randomUUID(),time=new Date().toISOString();tx.objectStore('people').put({id,displayName:name,category:'OTHER',seriesName:'',memo:'記号 !? @123 / English',username:null,xProfileUrl:null,links:[],hasImage:day===10,createdAt:time,updatedAt:time,
        anniversaries:[{type:'BIRTHDAY',month:5,day,year:null,showAge:false},{id:crypto.randomUUID(),type:'CUSTOM',title:'出会った日',month:5,day,year:2020,recurring:true,showAnniversary:true,notify:false}]});
      if(day===10)tx.objectStore('images').put({personId:id,type:'image/png',blob});}
    await new Promise(done=>tx.oncomplete=done);db.close();})()`);
  await reload();
  const settings=async(lang,theme)=>{
    await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const l=document.querySelector('#language-choice');l.value='${lang}';l.dispatchEvent(new Event('change'));})()`);
    await until(()=>evaluate(`document.documentElement.lang==='${lang}'`),'言語');
    await evaluate(`(()=>{const t=document.querySelector('#theme-choice');t.value='${theme}';t.dispatchEvent(new Event('change'));})()`);
    await until(()=>evaluate(`document.documentElement.dataset.theme==='${theme}'`),'テーマ');
    await evaluate(`document.querySelector('[data-tab=home]').click();document.querySelector('#font-lab-panel').hidden=true;scrollTo(0,0)`);
  };
  await settings('ja','light');
  await evaluate(`document.querySelector('#bell').click()`);await until(()=>evaluate('document.querySelector("#notification-dialog").open'),'通知既読検証の準備');
  await evaluate('document.querySelector("#read-all").click()');await until(()=>evaluate('document.querySelector("#unread-badge").hidden'),'既読状態');
  await evaluate('document.querySelector("#notification-dialog [data-close]").click()');
  const before=await evaluate(snap);
  const choose=async id=>{
    await evaluate(`(()=>{const s=document.querySelector('#font-lab-choice');s.value='${id}';s.dispatchEvent(new Event('change'));})()`);
    await until(()=>evaluate(id==='current'?'!document.documentElement.dataset.fontLab&&!document.querySelector("#font-lab-choice").disabled':`document.documentElement.dataset.fontLab==='${id}'&&!document.querySelector('#font-lab-choice').disabled&&document.querySelector('#font-lab-status').textContent.includes('Ready')`),'書体 '+id);
  };
  const screenshot=async id=>{await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate('(async()=>{scrollTo(0,0);await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));})()');
    writeFileSync(`${dir}/home-${id}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));
  };
  const reports=[];
  for(const font of [{id:'current',name:'現在のフォント'},...FONTS]){
    await settings('ja','light');await choose(font.id);await screenshot(font.id);
    await evaluate(`(()=>{const p=document.createElement('p');p.id='font-lab-probe';p.textContent='今日の誕生日 日本語 ABCxyz 0123456789 !? 🎂🙂';document.querySelector('#view-home').append(p);})()`);
    await evaluate(`(async()=>{document.querySelector('#font-lab-probe').scrollIntoView();await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));})()`);
    const dom=await command('DOM.getDocument'),node=await command('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#font-lab-probe'});
    const rendered=await command('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
    if(font.id!=='current')check(rendered.fonts.some(f=>f.isCustomFont&&f.glyphCount>10),'実際にカスタム日本語・英数字を描画 '+font.id+' '+JSON.stringify({fonts:rendered.fonts,style:await evaluate('getComputedStyle(document.querySelector("#font-lab-probe")).fontFamily'),faces:await evaluate('[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight}))')}));
    await evaluate('document.querySelector("#font-lab-probe").remove();scrollTo(0,0)');
    const layouts=[];
    for(const lang of ['ja','en'])for(const theme of ['light','dark']){
      await settings(lang,theme);
      for(const width of [320,390,430,768,1280]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
        const layout=await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('#calendar-add'));return {width:innerWidth,scroll:document.documentElement.scrollWidth,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight};})()`);
        check(layout.scroll<=width,'横スクロール '+font.id+' '+lang+'/'+theme+'/'+width);
        check(layout.size==='15px'&&layout.weight==='500','サイズと太さは共通');layouts.push({lang,theme,...layout});
      }
    }
    for(const lang of ['ja','en']){
      await settings(lang,'dark');
      for(const width of [320,390,430,768,1280]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
        for(const tab of ['home','calendar','people','birthdays','settings']){
          await evaluate(`document.querySelector('[data-tab=${tab}]').click()`);
          check(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'各タブのはみ出し '+font.id+'/'+tab+'/'+lang+'/'+width);
        }
      }
    }
    const inputs=[];
    for(const width of [320,390,430]){
      await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      await evaluate('document.querySelector("[data-tab=calendar]").click();document.querySelector("#calendar-add").click()');
      const input=await evaluate(`(()=>{const i=document.querySelector('#person-name'),s=getComputedStyle(i);i.value='長い人物名の入力テスト ABC 0123456789 🎂🙂';const box=document.querySelector('#person-dialog').getBoundingClientRect();
        return {font:s.fontFamily,size:parseFloat(s.fontSize),open:document.querySelector('#person-dialog').open,inside:box.left>=0&&box.right<=innerWidth,
          buttonsFit:[...document.querySelectorAll('#person-dialog button')].filter(b=>b.offsetWidth).every(b=>b.scrollWidth<=b.clientWidth)};})()`);
      check(input.open&&input.size>=16&&input.inside&&input.buttonsFit,'フォームの16px・はみ出し・ボタン文字 '+font.id+'/'+width);
      if(font.id!=='current')check(input.font.includes('Birthday Calendar Demo Font Lab'),'フォームも同じフォント');
      inputs.push({width,...input});await evaluate('document.querySelector("#person-dialog [data-close]").click()');
    }
    reports.push({id:font.id,name:font.name,renderedFonts:rendered.fonts,layouts,inputs});
  }
  await settings('ja','light');await choose('current');
  check(await evaluate('[...document.fonts].every(f=>!f.family.includes("Birthday Calendar Demo Font Lab"))'),'比較用FontFaceは復帰時に解放（標準書体は保持）');
  check(JSON.stringify(await evaluate(snap))===JSON.stringify(before),'書体切替と設定復帰で全データ・画像が不変');
  await command('Network.setCacheDisabled',{cacheDisabled:true});
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await reload();
  for(const font of FONTS)await choose(font.id);await choose('current');
  check(JSON.stringify(await evaluate(snap))===JSON.stringify(before),'オフライン再起動で人物・画像・通知・設定を保持');
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await command('Network.setCacheDisabled',{cacheDisabled:false});
  const output={fontCount:7,source:'local files only',conditions:{date:'2027-05-10',language:'ja',theme:'light',width:390,height:844,scroll:0},dataUnchanged:true,offlineReload:true,offlineAllFonts:true,reports};
  writeFileSync(`${dir}/report.json`,JSON.stringify(output,null,2));
  const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Birthday Calendar Demo フォント比較</title><style>body{font-family:system-ui;background:#faf7f1;color:#292735;padding:20px}main{display:flex;flex-wrap:wrap;gap:20px}figure{margin:0}figcaption{padding:10px 0}img{width:390px;max-width:100%;border:1px solid #ddd}</style><h1>Birthday Calendar Demo フォント比較（開発用）</h1><p>同じ架空データ・日本語・ライト・390×844px・2027/5/10・スクロール位置0。ユーザー入力は翻訳しません。</p><main>${reports.map(f=>`<figure><figcaption>${f.name}</figcaption><img src="home-${f.id}-390.png" alt="${f.name}のホーム"></figure>`).join('')}</main></html>`;
  writeFileSync(`${dir}/index.html`,html);
  return {fontCount:7,layouts:reports.reduce((n,r)=>n+r.layouts.length,0),dataUnchanged:true,offlineReload:true,offlineAllFonts:true,baselineFonts:reports[0].renderedFonts,screenshots:dir};
}
