// 明示実行する開発用原本コピー。ネットワーク取得・変換・サブセット化はしない。
import {readFile,copyFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('../',import.meta.url);
const inventory=JSON.parse(await readFile(new URL('dev/font-lab/inventory.json',base),'utf8'));
const font=inventory.families.find(f=>f.id==='zenmarugothic');
const expected=['OFL.txt','METADATA.pb','ZenMaruGothic-Regular.ttf','ZenMaruGothic-Medium.ttf','ZenMaruGothic-Bold.ttf'];
if(!font||font.files.length!==expected.length||!expected.every(name=>font.files.some(f=>f.filename===name)))throw Error('Unexpected original font set');
// 全ファイルを検証してから、無改変の公開用コピーを作る。
for(const file of font.files){
  const bytes=await readFile(new URL(`dev/font-lab/fonts/zenmarugothic/${file.filename}`,base));
  if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error(`Original mismatch: ${file.filename}`);
}
const target=new URL('public/fonts/zen-maru-gothic/',base);await mkdir(target,{recursive:true});
for(const file of font.files)await copyFile(new URL(`dev/font-lab/fonts/zenmarugothic/${file.filename}`,base),new URL(file.filename,target));
await writeFile(new URL('SOURCE.json',target),JSON.stringify({
  family:font.name,license:'SIL Open Font License 1.1',sourceCommit:inventory.sourceCommit,
  acquiredAt:inventory.acquiredAt,verifiedAt:'2026-10-21',unmodified:true,files:font.files,
},null,2)+'\n');
console.log('Zen Maru Gothic: 3 original TTFs + OFL + METADATA + provenance copied unchanged');
