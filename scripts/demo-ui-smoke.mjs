export async function verifyDemoUI({evaluate,until,check,command,screenshot=async()=>{}}) {
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  check(await evaluate(`document.title==='Birthday Calendar Demo'&&document.querySelector('#brand-name').textContent==='Birthday Calendar Demo'&&document.querySelector('.demo-badge').textContent==='DEMO'`),'Birthday Calendar Demo表示名');
  await evaluate(`document.querySelector('#header-settings').click()`);
  check(await evaluate(`location.hash==='#settings'&&document.querySelectorAll('.setting-section').length===7
    &&[...document.querySelectorAll('.setting-section')].every(s=>!s.open)`),'初期設定は全セクション折りたたみ');
  await screenshot('birthday-calendar-demo-settings-closed-390');
  await evaluate(`document.querySelector('#appearance-section summary').focus()`);
  check(await evaluate('document.activeElement.tagName==="SUMMARY"'),'summaryフォーカス');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',text:' ',windowsVirtualKeyCode:32});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await until(()=>evaluate('document.querySelector("#appearance-section").open'),'キーボードで設定展開');
  const choose=async theme=>{await evaluate(`(()=>{const s=document.querySelector('#theme-choice');s.value='${theme}';s.dispatchEvent(new Event('change'));})()`);};
  await choose('dark');await until(()=>evaluate('document.documentElement.dataset.theme==="dark"'),'ダーク適用');
  await screenshot('birthday-calendar-demo-settings-dark-390');
  const contrast=await evaluate(`(()=>{const rgb=c=>c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
    const luminance=c=>{const p=rgb(c);return .2126*p[0]+.7152*p[1]+.0722*p[2];};
    const form=document.querySelector('#person-name'),style=getComputedStyle(form),a=luminance(style.color),b=luminance(style.backgroundColor);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);})()`);
  check(contrast>=4.5,'ダーク入力欄のコントラスト');
  for(const tab of ['home','calendar','people','birthdays','settings']){
    await evaluate(`document.querySelector('[data-tab=${tab}]').click()`);
    check(await evaluate('document.documentElement.scrollWidth<=390'),'ダーク画面幅 '+tab);
  }
  await command('Page.reload');await until(()=>evaluate('document.querySelector("#app-version")?.textContent&&document.documentElement.dataset.theme==="dark"'),'再起動後テーマ保持');
  check(await evaluate('document.querySelector("#theme-choice").value==="dark"'),'再起動後設定値');
  await evaluate(`document.querySelector('#header-settings').click();document.querySelector('#appearance-section').open=true;`);
  await choose('system');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  await until(()=>evaluate('document.documentElement.dataset.theme==="dark"'),'端末ダーク追従');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await until(()=>evaluate('document.documentElement.dataset.theme==="light"'),'端末ライト追従');
  await choose('light');await until(()=>evaluate('document.querySelector("#theme-choice").value==="light"'),'明示ライト設定');
  await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  check(await evaluate('document.documentElement.dataset.theme==="light"'),'明示ライトは端末変更に影響されない');
  await command('Emulation.setEmulatedMedia',{features:[]});
  await evaluate(`document.querySelector('#appearance-section').open=false;document.querySelector('#appearance-section').open=true`);
  check(await evaluate('document.querySelector("#theme-choice").value==="light"'),'折りたたみで設定値保持');
  const icons=await evaluate(`(async()=>{const manifest=await(await fetch(new URL('./manifest.webmanifest',document.baseURI))).json();
    const names=[['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180],['favicon-48.png',48],['icon-maskable-512.png',512]],results=[];
    for(const[name,size]of names){const image=new Image();image.src=new URL('./icons/'+name,document.baseURI);await image.decode();
      const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');g.drawImage(image,0,0);const p=g.getImageData(0,0,size,size).data;
      const corners=[0,(size-1)*4,(size*(size-1))*4,(size*size-1)*4].map(i=>[...p.slice(i,i+4)]);
      results.push({name,size: image.naturalWidth,correct:image.naturalWidth===size&&image.naturalHeight===size,corners});}
    return {name:manifest.name,short:manifest.short_name,id:manifest.id,scope:manifest.scope,apple:document.querySelector('meta[name=apple-mobile-web-app-title]').content,results};})()`);
  check(icons.name==='Birthday Calendar Demo'&&icons.short==='Birthday Calendar Demo'&&icons.apple==='Birthday Calendar Demo'&&icons.id==='./?app=birthday-calendar-demo'&&icons.scope==='./','manifest/iPhone名称と識別子');
  check(icons.results.every(icon=>icon.correct&&icon.corners.every(c=>c[3]===255&&!(c[0]===255&&c[1]===255&&c[2]===255))),'PNG寸法・不透明四隅・白余白なし');
  check(await evaluate(`document.querySelectorAll('.header-actions .outline-icon').length===2&&document.querySelector('.bottom-nav [data-tab=settings] svg')!==null`),'統一線画アイコン');
  await evaluate(`document.querySelectorAll('.setting-section').forEach(s=>s.open=false);document.querySelector('[data-tab=home]').click()`);
  return {name:'Birthday Calendar Demo',sections:7,keyboard:true,themePersisted:true,systemTheme:true,darkContrast:contrast,icons};
}
