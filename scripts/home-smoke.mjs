// 一時Edgeプロファイル専用。固定した東京日付でホームの内容と表示を検証する。
export async function verifyHome({evaluate,until,check,command,screenshot=async()=>{}}) {
  const read=()=>evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result);};};})`);
  check((await read()).length===0,'ホーム検証は空の一時DBでのみ実行');
  const clock=await command('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date;const fixed=NativeDate.parse('2027-05-10T03:00:00Z');window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};}`});
  const reload=async()=>{await command('Page.reload');await until(()=>evaluate(`document.querySelector('#home-today-date')?.dateTime==='2027-05-10'`),'固定日付ホーム');};
  try {
    await reload();await evaluate(`document.querySelector('[data-tab=home]').click()`);
    check(await evaluate(`document.querySelectorAll('#view-home .home-section').length===4&&document.querySelectorAll('#view-home .hero,#summary-grid,#view-home .eyebrow').length===0&&document.querySelectorAll('#view-home .home-empty').length===4`),'カード廃止と4空状態');
    check(await evaluate(`JSON.stringify([...document.querySelectorAll('#view-home h2')].map(n=>n.id))===JSON.stringify(['home-today-title','home-next-title','home-upcoming-title','home-anniversaries-title'])`),'セクション順');
    await evaluate(`document.querySelector('[data-tab=calendar]').click()`);
    const p=await evaluate(`(()=>{const add=document.querySelector('#calendar-add');add.scrollIntoView({block:'center'});const r=add.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
    check(await evaluate('document.querySelector("#person-dialog").open'),'追加ボタンは既存フォームへ');
    await evaluate('document.querySelector("#person-dialog [data-close]").click()');check((await read()).length===0,'追加キャンセルで作成しない');
    for(const tab of ['home','calendar','people','birthdays','settings']){
      await evaluate(`document.querySelector('[data-tab=${tab}]').click()`);
      check(await evaluate(`Boolean(document.querySelector('#calendar-add').getClientRects().length)===${tab==='calendar'}`),'追加ボタンはカレンダーだけに表示');
    }
    check((await read()).length===0,'キャンセルで未保存人物なし');
    await evaluate(`document.querySelector('[data-tab=calendar]').click();document.querySelector('#calendar-add').click();document.querySelector('#person-name').value='分類確認';document.querySelector('#person-category').value='REAL_FRIEND';document.querySelector('#person-form').requestSubmit()`);
    await until(()=>evaluate('!document.querySelector("#person-dialog").open'),'ナビから人物保存');
    const created=(await read())[0];check(created.category==='REAL_FRIEND','表示名変更後も保存値はREAL_FRIEND');
    check(await evaluate(`location.hash==='#calendar'&&!document.querySelector('#view-calendar').hidden`),'保存後もカレンダーを維持');
    await evaluate(`document.querySelector('[data-tab=people]').click();document.querySelector('#people-list .person-card').click();document.querySelector('#detail-edit').click()`);
    check(await evaluate(`document.querySelector('#person-category').value==='REAL_FRIEND'&&document.querySelector('#person-category option:checked').textContent==='現実の知り合い'`),'既存人物の分類を再編集');
    await evaluate(`document.querySelector('#person-name').value='分類確認・編集';document.querySelector('#person-form').requestSubmit()`);
    await until(()=>evaluate('!document.querySelector("#person-dialog").open'),'編集保存');
    check((await read())[0].category==='REAL_FRIEND'&&(await read())[0].displayName==='分類確認・編集','編集後も分類を保持');
    await evaluate(`(()=>{const filter=document.querySelector('#people-category');filter.value='REAL_FRIEND';filter.dispatchEvent(new Event('input'));})()`);
    check(await evaluate('document.querySelectorAll("#people-list .person-card").length===1'),'既存キーで絞り込み');
    await evaluate(`(()=>{const filter=document.querySelector('#people-category');filter.value='PET';filter.dispatchEvent(new Event('input'));})()`);
    check(await evaluate('document.querySelectorAll("#people-list .person-card").length===0'),'他カテゴリを混同しない');
    await evaluate(`(async()=>{const filter=document.querySelector('#people-category');filter.value='ALL';filter.dispatchEvent(new Event('input'));const r=indexedDB.open('birthday-calendar-demo');const db=await new Promise(done=>r.onsuccess=()=>done(r.result));const tx=db.transaction('people','readwrite');tx.objectStore('people').delete(${JSON.stringify(created.id)});await new Promise(done=>tx.oncomplete=done);db.close();})()`);
    await reload();await evaluate(`document.querySelector('[data-tab=home]').click()`);
    await screenshot('home-empty-390');
    await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const g=canvas.getContext('2d');g.fillStyle='#b4c3b0';g.fillRect(0,0,512,512);g.fillStyle='#344b37';g.font='260px sans-serif';g.fillText('A',160,350);const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));
      const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images'],'readwrite');
      const birthday=(month,day)=>({type:'BIRTHDAY',month,day,year:null,showAge:false});
      const ann=(title,month,day)=>({id:crypto.randomUUID(),type:'CUSTOM',title,month,day,year:2020,recurring:true,showAnniversary:true,notify:false});
      for(const [name,anns]of [['葵',[birthday(5,10),ann('出会った日',5,10)]],['陽',[birthday(5,13)]],['凪',[birthday(6,9)]],['真白',[birthday(6,10)]],['詩',[ann('応援を始めた日',5,24)]],['はる',[ann('対象外',5,25)]]]){
        const time=new Date().toISOString(),id=crypto.randomUUID();tx.objectStore('people').put({id,displayName:name,category:'OTHER',seriesName:'',memo:'',username:null,xProfileUrl:null,links:[],hasImage:name==='葵',createdAt:time,updatedAt:time,anniversaries:anns});
        if(name==='葵')tx.objectStore('images').put({personId:id,blob,type:'image/png'});
      }await new Promise(done=>tx.oncomplete=done);db.close();})()`);
    await reload();const before=JSON.stringify(await read());
    check(await evaluate(`(async()=>{const img=document.querySelector('#home-today .avatar img');await img.decode();return img.naturalWidth===512;})()`),'既存画像URLでホーム人物画像');
    check(await evaluate(`document.querySelectorAll('#home-today .item-row').length===2&&document.querySelectorAll('#home-next .item-row').length===1&&document.querySelector('#home-next').textContent.includes('陽')&&!document.querySelector('#home-next').textContent.includes('葵')&&!document.querySelector('#home-upcoming').textContent.includes('葵')&&document.querySelectorAll('#home-upcoming .item-row').length===2&&document.querySelectorAll('#home-anniversaries .item-row').length===2`),'当日は今日のみ・次回と30日から除外・14日記念日は維持');
    for(const id of ['home-today','home-next','home-upcoming','home-anniversaries']){
      await evaluate(`document.querySelector('#${id} .item-row').click()`);
      check(await evaluate('document.querySelector("#detail-dialog").open&&document.querySelector("#detail-body .detail-top")!==null'),'既存人物詳細へ');
      await evaluate('document.querySelector("#detail-dialog [data-close]").click()');
    }
    const layouts=[];
    for(const language of ['ja','en'])for(const theme of ['light','dark']){
      await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const l=document.querySelector('#language-choice');l.value='${language}';l.dispatchEvent(new Event('change'));})()`);
      await until(()=>evaluate(`document.documentElement.lang==='${language}'`),'ホーム言語切替');
      await evaluate(`(()=>{const s=document.querySelector('#theme-choice');s.value='${theme}';s.dispatchEvent(new Event('change'));})()`);
      await until(()=>evaluate(`document.documentElement.dataset.theme==='${theme}'`),'ホームテーマ切替');
      await evaluate(`document.querySelector('[data-tab=home]').click()`);
      check(await evaluate(`document.querySelector('#home-today-title').textContent===${JSON.stringify(language==='ja'?'今日の予定':"Today's events")}`),'ホーム見出し翻訳');
      for(const width of [320,390,430,768,1280]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
        const layout=await evaluate(`(()=>{const row=document.querySelector('#home-next .item-row'),nav=[...document.querySelectorAll('.bottom-nav button')];
          return {width:innerWidth,scroll:document.documentElement.scrollWidth,row:row.getBoundingClientRect().height,nav:nav.length,order:nav.map(b=>b.dataset.tab),targets:nav.every(b=>b.getBoundingClientRect().width>=44&&b.getBoundingClientRect().height>=44),category:[...document.querySelectorAll('option[value="REAL_FRIEND"]')].every(o=>o.textContent===${JSON.stringify(language==='ja'?'現実の知り合い':'In-person acquaintances')}),noHomeButton:!document.querySelector('#view-home #calendar-add,#nav-add,#home-add')};})()`);
        await evaluate(`document.querySelector('[data-tab=calendar]').click()`);
        const placement=await evaluate(`(()=>{const add=document.querySelector('#calendar-add');add.scrollIntoView({block:'center'});const r=add.getBoundingClientRect(),parent=add.parentElement.getBoundingClientRect(),style=getComputedStyle(add),range=document.createRange();range.selectNodeContents(add);const text=range.getBoundingClientRect(),panel=document.querySelector('.calendar-panel'),p=panel.getBoundingClientRect(),rail=document.querySelector('.people-rail'),h=rail.querySelector('h2').getBoundingClientRect(),last=document.querySelector('.calendar-grid .day-cell:last-child').getBoundingClientRect();return {between:panel.nextElementSibling===add&&add.nextElementSibling===rail&&r.top>=p.bottom&&r.bottom<=h.top&&r.top>=last.bottom,inside:r.left>=0&&r.right<=innerWidth,large:r.width>=44&&r.height>=44,width80:Math.abs(r.width-parent.width*.8)<1,center:Math.abs((r.left+r.right)-(parent.left+parent.right))<1,height48:Math.abs(r.height-48)<.5,textCenter:Math.abs((text.left+text.right)-(r.left+r.right))<1,noWrap:style.whiteSpace==='nowrap'&&range.getClientRects().length===1&&add.scrollWidth<=add.clientWidth,label:add.textContent,scroll:document.documentElement.scrollWidth};})()`);
        check(placement.between&&placement.inside&&placement.large&&placement.scroll<=width&&placement.label===(language==='ja'?'＋ 人物を追加':'+ Add person'),'カレンダー最終週の下・人物見出しの上');
        check(placement.width80&&placement.center&&placement.height48&&placement.textCenter&&placement.noWrap,`幅80%・中央・48px・文字折返しなし ${language}/${theme}/${width}: ${JSON.stringify(placement)}`);
        await evaluate(`document.querySelector('#calendar-add').click()`);
        check(await evaluate(`document.querySelector('#person-dialog').open&&document.querySelector('#person-birth-month').value===''`),'通常追加は日付未指定');
        await evaluate(`document.querySelector('#person-dialog [data-close]').click()`);
        check(await evaluate(`location.hash==='#calendar'`),'キャンセル後カレンダーへ');
        if(width===390||width===1280)await screenshot(`calendar-add-${language}-${theme}-${width}`);
        await evaluate(`document.querySelector('[data-tab=home]').click()`);
        // デスクトップの縦スクロールバー分だけscrollWidthが小さいのは正常。
        const correct=layout.scroll<=width&&layout.row>=44&&layout.nav===5&&layout.targets&&layout.category&&layout.noHomeButton&&JSON.stringify(layout.order)===JSON.stringify(['home','calendar','people','birthdays','settings']);
        if(!correct)await screenshot('home-layout-failure');
        check(correct,`幅・44pxタップ領域・5項目ナビ・分類 ${language}/${theme}: ${JSON.stringify(layout)}`);
        layouts.push({language,theme,...layout});if(width===390){
          await screenshot(`home-${language}-${theme}-390`);
          check(await evaluate(`(()=>{scrollTo(0,document.body.scrollHeight);const last=document.querySelector('#home-anniversaries .item-row:last-child').getBoundingClientRect(),nav=document.querySelector('.bottom-nav').getBoundingClientRect();const visible=last.bottom<=nav.top;scrollTo(0,0);return visible;})()`),'最終行が固定ナビの上までスクロール可能');
        }
      }
    }
    check(JSON.stringify(await read())===before,'表示とテーマ・言語操作で人物は不変');
    await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await reload();
    check(await evaluate('document.querySelectorAll("#home-upcoming .item-row").length===2'),'オフラインホーム');
    check(JSON.stringify(await read())===before,'オフライン再起動で人物保持');
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    return {sections:4,add:true,empty:true,today:2,next:1,upcoming:2,anniversaries:2,todayExcluded:true,details:true,dataUnchanged:true,offline:true,layouts};
  } finally {
    await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await command('Page.removeScriptToEvaluateOnNewDocument',{identifier:clock.identifier});
    // この一時プロファイルで自分が作った架空人物だけを回収する。
    await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images','notifications'],'readwrite');
      const ids=new Set(),q=tx.objectStore('people').getAll();q.onsuccess=()=>{for(const p of q.result){ids.add(p.id);tx.objectStore('people').delete(p.id);tx.objectStore('images').delete(p.id);}const n=tx.objectStore('notifications').getAll();n.onsuccess=()=>{for(const notice of n.result)if(ids.has(notice.personId))tx.objectStore('notifications').delete(notice.id);};};await new Promise(done=>tx.oncomplete=done);db.close();})()`);
    await command('Page.reload');await until(()=>evaluate('Boolean(document.querySelector("#home-today-date")?.dateTime)'),'元の日付へ戻す');
    await evaluate(`document.querySelector('#language-choice').value='ja';document.querySelector('#language-choice').dispatchEvent(new Event('change'));document.querySelector('#theme-choice').value='light';document.querySelector('#theme-choice').dispatchEvent(new Event('change'));`);
    await until(()=>evaluate('document.documentElement.lang==="ja"&&document.documentElement.dataset.theme==="light"'),'元の設定へ戻す');
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
}
