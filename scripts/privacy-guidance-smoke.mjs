import {mkdirSync,writeFileSync} from 'node:fs';

// Caller supplies an isolated browser profile; never use a real user's storage.
export async function verifyPrivacyGuidance({evaluate,until,check,command}){
  const snapshot=()=>evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(d=>r.onsuccess=()=>d(r.result));const rows=await Promise.all(['people','images','settings','notifications'].map(n=>new Promise(d=>db.transaction(n).objectStore(n).getAll().onsuccess=e=>d(e.target.result))));rows[1]=await Promise.all(rows[1].map(async i=>({...i,blob:[...new Uint8Array(await i.blob.arrayBuffer())]})));db.close();return JSON.stringify(rows);})()`);
  const original=await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();return {language:document.querySelector('#language-choice').value,theme:document.querySelector('#theme-choice').value};})()`);
  let layouts=0;
  try{
    for(const language of ['ja','en'])for(const theme of ['light','dark']){
      await evaluate(`(()=>{for(const [id,value]of ${JSON.stringify([['language-choice',language],['theme-choice',theme]])}){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
      await until(()=>evaluate(`document.documentElement.lang==='${language}'&&document.documentElement.dataset.theme==='${theme}'`));
      for(const width of [320,390,430,768,1280]){
        await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
        await evaluate(`document.querySelectorAll('.setting-section').forEach(n=>n.open=false);document.querySelector('#data-privacy-section').open=true`);
        const before=await snapshot();
        const result=await evaluate(`(()=>{const s=document.querySelector('#data-privacy-section');s.scrollIntoView();return {title:s.querySelector('summary').textContent,text:s.textContent,width:document.documentElement.scrollWidth,viewport:innerWidth,headings:s.querySelectorAll('h3').length,links:s.querySelectorAll('a,form,input').length,overflow:[...s.querySelectorAll('p,h3')].some(n=>n.scrollWidth>n.clientWidth+1)};})()`);
        check(result.title===(language==='ja'?'データとプライバシー':'Data and privacy'),'Guidance summary translation');
        check(result.headings===7&&result.links===0&&!result.overflow&&result.width<=result.viewport,'Guidance layout '+language+theme+width);
        check(result.text.includes(language==='ja'?'暗号化されていません':'not encrypted')&&result.text.includes(language==='ja'?'完全置換':'completely replaces'),'Backup privacy and replacement warning');
        await evaluate(`(()=>{const s=document.querySelector('#data-privacy-section');s.open=false;s.open=true;s.open=false;s.open=true;})()`);
        check(await snapshot()===before,'Reading or toggling guidance must not change any stored data');
        if(width===390){mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/privacy-guidance-${language}-${theme}-390.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}
        layouts++;
      }
    }
    return {layouts,bilingual:true,contactLinks:0,readingPreservesAllStores:true};
  }finally{
    await evaluate(`(()=>{for(const [id,value]of ${JSON.stringify([['language-choice',original.language],['theme-choice',original.theme]])}){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelectorAll('.setting-section').forEach(n=>n.open=false);document.querySelector('[data-tab=home]').click();scrollTo(0,0);})()`);
    await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
}
