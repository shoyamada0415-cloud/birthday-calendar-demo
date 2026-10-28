// 明示的に実行したときだけ公式の固定commitから取得。アプリ実行時には通信しない。
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FONTS,SOURCE_COMMIT,REVIEW_DATE} from '../dev/font-lab/catalog.mjs';
const root=new URL('../dev/font-lab/',import.meta.url);
const review=await readFile(new URL('../docs/font-license-review.md',import.meta.url),'utf8');
if(!review.includes(SOURCE_COMMIT)||!review.includes('導入可'))throw Error('License review required first');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function names(bytes,id){
  const n=bytes.readUInt16BE(4);let table;
  for(let i=0;i<n;i++){const p=12+i*16;if(bytes.toString('ascii',p,p+4)==='name')table=bytes.readUInt32BE(p+8);}
  if(table==null)throw Error('Missing SFNT name table');
  const count=bytes.readUInt16BE(table+2),storage=table+bytes.readUInt16BE(table+4),result=[];
  for(let i=0;i<count;i++){const p=table+6+i*12,platform=bytes.readUInt16BE(p);
    if(bytes.readUInt16BE(p+6)!==id||![0,3].includes(platform))continue;
    const length=bytes.readUInt16BE(p+8),offset=storage+bytes.readUInt16BE(p+10);
    result.push(new TextDecoder('utf-16be').decode(bytes.subarray(offset,offset+length)));
  }return [...new Set(result)];
}
const inventory={sourceCommit:SOURCE_COMMIT,reviewDate:REVIEW_DATE,acquiredAt:new Date().toISOString(),families:[]};
for(const font of FONTS){
  if(!review.includes(font.id))throw Error('Unreviewed family');
  const dir=new URL(`fonts/${font.id}/`,root);await mkdir(dir,{recursive:true});const files=[];
  // OFLと権利メタデータを先に取得。本体はその後に取得する。
  for(const filename of ['OFL.txt','METADATA.pb',...font.faces.map(f=>f[0])]){
    const url=`https://raw.githubusercontent.com/google/fonts/${SOURCE_COMMIT}/ofl/${font.id}/${encodeURIComponent(filename)}`;
    const response=await fetch(url);if(!response.ok)throw Error(`${font.id}/${filename}: HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(filename==='OFL.txt'&&!bytes.toString().includes('SIL OPEN FONT LICENSE Version 1.1'))throw Error('Unexpected license');
    const info={filename,url,bytes:bytes.length,sha256:hash(bytes)};
    if(filename.endsWith('.ttf')){
      if(bytes.readUInt32BE(0)!==0x00010000)throw Error('Expected original TTF');
      info.weight=font.faces.find(f=>f[0]===filename)[1];info.version=names(bytes,5);info.copyright=names(bytes,0);
    }
    await writeFile(new URL(encodeURIComponent(filename),dir),bytes);files.push(info);
  }
  inventory.families.push({id:font.id,name:font.name,credit:font.credit,files});
}
await writeFile(new URL('inventory.json',root),JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify(inventory.families.map(f=>({id:f.id,bytes:f.files.filter(p=>p.filename.endsWith('.ttf')).reduce((sum,p)=>sum+p.bytes,0),versions:f.files.filter(p=>p.version).map(p=>({file:p.filename,version:p.version,copyright:p.copyright}))})),null,2));
