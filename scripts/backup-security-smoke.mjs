import {zipSync,strToU8} from 'fflate';
import {normalizePerson} from '../src/model.js';
import {APP_VERSION} from '../src/version.js';

// 実decoderと通常の復元UIを使う。呼出し元の分離プロファイルの架空データだけを扱う。
export async function verifyBackupSecurity({evaluate,until,check,command}){
  const id=crypto.randomUUID(),person=normalizePerson({displayName:'架空の安全性確認',category:'OTHER',memo:'dummy',anniversaries:[{type:'BIRTHDAY',month:5,day:10},{type:'CUSTOM',title:'架空記念日',month:5,day:10,notify:true}]});person.id=id;person.hasImage=true;
  const fixtures=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=48;c.height=48;const x=c.getContext('2d');x.fillStyle='#a080af';x.fillRect(0,0,48,48);return ['image/png','image/jpeg','image/webp'].map(type=>({type,url:c.toDataURL(type)}));})()`);
  const hash=async b=>Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');
  async function backup(image,type,level=0,extra={}){
    const path=`images/${id}.bin`,data={people:[person],images:[{personId:id,path,type}],notifications:[],settings:{enabled:true,seven:true,three:true,one:true,today:true},language:'ja',appearance:{theme:'dark'}};
    const files={'data.json':strToU8(JSON.stringify(data)),[path]:image,...extra},entries={};for(const [name,b]of Object.entries(files))entries[name]={bytes:b.length,sha256:await hash(b)};
    files['manifest.json']=strToU8(JSON.stringify({formatVersion:1,appVersion:APP_VERSION,createdAt:'2028-05-03T00:00:00Z',counts:{people:1,images:1,notifications:0},entries}));return Buffer.from(zipSync(files,{level})).toString('base64');
  }
  const snapshot=()=>evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(d=>r.onsuccess=()=>d(r.result));const values=await Promise.all(['people','images','settings','notifications'].map(n=>new Promise(d=>db.transaction(n).objectStore(n).getAll().onsuccess=e=>d(e.target.result))));values[1]=await Promise.all(values[1].map(async i=>({personId:i.personId,type:i.type,bytes:[...new Uint8Array(await i.blob.arrayBuffer())]})));db.close();return JSON.stringify(values);})()`);
  async function choose(base64,accepted){
    const blocked=await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();for(const d of document.querySelectorAll('details'))d.open=true;document.querySelector('#toast').hidden=true;const i=document.querySelector('#import-backup'),t=new DataTransfer();t.items.add(new File([Uint8Array.from(atob('${base64}'),c=>c.charCodeAt(0))],'dummy.zip',{type:'application/zip'}));i.files=t.files;i.dispatchEvent(new Event('change'));return i.disabled;})()`);
    check(blocked,'File selection must be blocked while validating');
    await until(()=>evaluate(accepted?'!document.querySelector("#restore-preview").hidden':'!document.querySelector("#toast").hidden'),'Backup security expected '+(accepted?'accepted':'rejected'));
    check(await evaluate('document.querySelector("#restore-preview").hidden')===!accepted,'Invalid restore preview visibility');
  }
  const initial=JSON.parse(await snapshot());check(initial[0].length===0&&initial[1].length===0&&initial[3].length===0,'Backup security smoke requires an empty isolated profile');
  const png=Buffer.from(fixtures[0].url.split(',')[1],'base64');
  await choose(await backup(png,'image/png'),true);
  await evaluate(`(()=>{window.__secConfirm=window.confirm;window.__secPrompt=window.prompt;window.__secConfirmCount=0;window.confirm=()=>{window.__secConfirmCount++;return true;};window.prompt=()=> '復元';const b=document.querySelector('#restore-preview .primary');b.click();b.dispatchEvent(new Event('click'));})()`);
  await until(()=>evaluate('document.querySelector("#restore-preview").hidden'));
  const before=await snapshot();const formats=[];
  check(await evaluate('window.__secConfirmCount')===1,'Restore must not run twice');
  try{
    for(const f of fixtures){check(f.url.startsWith('data:'+f.type),'Missing native format encoder');await choose(await backup(Buffer.from(f.url.split(',')[1],'base64'),f.type),true);check(await snapshot()===before,'Preview wrote data');formats.push(f.type);}
    await choose(await backup(png,'image/png',6),true);check(await snapshot()===before,'Compressed preview wrote data');
    await evaluate('window.confirm=()=>false;document.querySelector("#restore-preview .primary").click()');check(await snapshot()===before,'Cancel changed data');
    const bad=Buffer.from(png);for(let p=8;p+12<bad.length;){const n=bad.readUInt32BE(p),kind=bad.toString('ascii',p+4,p+8);if(kind==='IDAT'){bad[p+8]^=255;break;}p+=12+n;}
    const over=Buffer.from(png);over.writeUInt32BE(4097,16);over.writeUInt32BE(4097,20);
    const invalid=[[Buffer.from('<svg/>'),'image/png'],[png,'image/jpeg'],[bad,'image/png'],[over,'image/png'],[png.subarray(0,-1),'image/png']];
    for(const [bytes,type]of invalid){await choose(await backup(bytes,type),false);check(await snapshot()===before,'Invalid image wrote data');}
    await choose(await backup(png,'image/png',0,{'unexpected.txt':strToU8('dummy')}),false);check(await snapshot()===before,'Extra entry wrote data');
    return {formats,compressedZIP:true,invalidImages:invalid.length,extraEntryRejected:true,previewAndCancelPreserveData:true,realDecoder:true,doubleSubmitBlocked:true};
  }finally{
    await evaluate(`(()=>{window.confirm=window.__secConfirm;window.prompt=window.__secPrompt;})()`);
    // 一時試験データを除去して他のsmokeに渡す。実アプリのデータは対象外。
    await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(d=>r.onsuccess=()=>d(r.result)),tx=db.transaction(['people','images','notifications','settings'],'readwrite');for(const n of ['people','images','notifications','settings'])tx.objectStore(n).clear();for(const row of ${JSON.stringify(initial[2])})tx.objectStore('settings').put(row);await new Promise(d=>tx.oncomplete=d);db.close();})()`);
    await command('Page.reload');await until(()=>evaluate('!!document.querySelector("#app-version")?.textContent'));
  }
}
