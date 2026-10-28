// 検証専用原本はGitへ入れず、記録済み公式commit・SHAで再現する。
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {FONTS,SOURCE_COMMIT} from '../dev/font-lab/catalog.mjs';
const root=new URL('../dev/font-lab/',import.meta.url);
const inventory=JSON.parse(await readFile(new URL('inventory.json',root),'utf8'));
if(inventory.sourceCommit!==SOURCE_COMMIT||!/^[a-f0-9]{40}$/.test(SOURCE_COMMIT))throw Error('Unexpected source commit');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let downloaded=0,verified=0;
for(const family of inventory.families){
  const font=FONTS.find(f=>f.id===family.id);if(!font)throw Error('Unreviewed font');
  const allowed=new Set(['OFL.txt','METADATA.pb',...font.faces.map(f=>f[0])]);
  const dir=new URL(`fonts/${family.id}/`,root);await mkdir(dir,{recursive:true});
  for(const file of family.files){
    const expected=`https://raw.githubusercontent.com/google/fonts/${SOURCE_COMMIT}/ofl/${family.id}/${encodeURIComponent(file.filename)}`;
    if(!allowed.has(file.filename)||file.url!==expected||!/^[a-f0-9]{64}$/.test(file.sha256)
      ||!Number.isSafeInteger(file.bytes)||file.bytes<=0||file.bytes>32*1024*1024)throw Error('Unexpected fixture record');
    const path=new URL(encodeURIComponent(file.filename),dir);
    let bytes;try{bytes=await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!bytes){const response=await fetch(expected);if(!response.ok)throw Error('Font fixture HTTP '+response.status);
      bytes=Buffer.from(await response.arrayBuffer());downloaded++;}
    if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw Error('Fixture checksum mismatch: '+file.filename);
    if(file.filename==='OFL.txt'&&!bytes.toString().includes('SIL OPEN FONT LICENSE Version 1.1'))throw Error('Unexpected license');
    // 同じ検証済み原本だけを書き込む。inventory・採用フォント・アプリデータは変更しない。
    await writeFile(path,bytes);verified++;
  }
}
console.log(JSON.stringify({fontFixturesVerified:verified,downloaded,gitIgnored:true,notInPages:true}));
