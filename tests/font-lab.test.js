import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolveConfig} from 'vite';
import {FONTS,SOURCE_COMMIT} from '../dev/font-lab/catalog.mjs';
const inventory=JSON.parse(readFileSync('dev/font-lab/inventory.json','utf8'));
test('6書体は事前確認した固定公式commit・ライセンス文書と対応する',()=>{
  const review=readFileSync('docs/font-license-review.md','utf8');assert.equal(FONTS.length,6);assert.equal(inventory.sourceCommit,SOURCE_COMMIT);
  for(const font of FONTS){assert.ok(review.includes(font.id));const ofl=readFileSync(`dev/font-lab/fonts/${font.id}/OFL.txt`,'utf8');assert.match(ofl,/SIL OPEN FONT LICENSE Version 1.1/);
    assert.match(readFileSync(`dev/font-lab/fonts/${font.id}/METADATA.pb`,'utf8'),/copyright/);assert.ok(inventory.families.some(f=>f.id===font.id));}
});
test('取得した全フォント・権利文書は記録されたSHA-256・バイト数に一致',()=>{
  for(const font of inventory.families)for(const file of font.files){const bytes=readFileSync(`dev/font-lab/fonts/${font.id}/${file.filename}`);
    assert.equal(bytes.length,file.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    assert.ok(file.url.startsWith(`https://raw.githubusercontent.com/google/fonts/${SOURCE_COMMIT}/`));
    if(file.filename.endsWith('.ttf')){assert.equal(bytes.readUInt32BE(0),0x00010000);assert.ok(file.version.length&&file.copyright.length);}}
});
function hasGlyph(bytes,code){
  let cmap;for(let i=0;i<bytes.readUInt16BE(4);i++){const p=12+i*16;if(bytes.toString('ascii',p,p+4)==='cmap')cmap=bytes.readUInt32BE(p+8);}
  for(let i=0;i<bytes.readUInt16BE(cmap+2);i++){
    const p=cmap+4+i*8,table=cmap+bytes.readUInt32BE(p+4),format=bytes.readUInt16BE(table);
    if(format===12){for(let g=0;g<bytes.readUInt32BE(table+12);g++){const q=table+16+g*12,start=bytes.readUInt32BE(q),end=bytes.readUInt32BE(q+4);if(code>=start&&code<=end)return bytes.readUInt32BE(q+8)+code-start!==0;}}
    if(format===4&&code<=65535){const n=bytes.readUInt16BE(table+6)/2,end=table+14,start=end+n*2+2,delta=start+n*2,range=delta+n*2;
      for(let s=0;s<n;s++){if(code>bytes.readUInt16BE(end+s*2)||code<bytes.readUInt16BE(start+s*2))continue;
        const offset=bytes.readUInt16BE(range+s*2),d=bytes.readInt16BE(delta+s*2);
        if(!offset)return ((code+d)&65535)!==0;
        const glyph=bytes.readUInt16BE(range+s*2+offset+(code-bytes.readUInt16BE(start+s*2))*2);if(glyph)return ((glyph+d)&65535)!==0;
      }
    }
  }return false;
}
test('全ファイルに比較で使う日本語・英数字・記号の実グリフがある',()=>{
  for(const font of FONTS)for(const[file]of font.faces){const bytes=readFileSync(`dev/font-lab/fonts/${font.id}/${file}`);
    for(const char of '今日誕生日人物登録設定記念日年月あと日本語ABCxyz0123456789!?+@/()')assert.ok(hasGlyph(bytes,char.codePointAt(0)),`${file}: ${char}`);}
});
test('本番・通常devはプラグイン無効、明示比較モードだけ有効',async()=>{
  for(const mode of ['production','development']){const config=await resolveConfig({mode},mode==='production'?'build':'serve');assert.ok(!config.plugins.some(p=>p.name==='birthday-calendar-demo-development-font-lab'));}
  const config=await resolveConfig({mode:'font-lab'},'serve');assert.ok(config.plugins.some(p=>p.name==='birthday-calendar-demo-development-font-lab'));
  const lab=await resolveConfig({mode:'font-lab'},'build');assert.equal(lab.build.outDir,'test-artifacts/font-lab');
  await assert.rejects(resolveConfig({mode:'font-lab',build:{outDir:'dist'}},'build'),/never production dist/);
});
test('比較はフォントだけを上書きし保存処理・外部フォント通信を追加しない',()=>{
  const css=readFileSync('dev/font-lab/families.css','utf8'),entry=readFileSync('dev/font-lab/entry.js','utf8');
  assert.doesNotMatch(css,/(?:font-size|font-weight|line-height|margin|padding|color):/);assert.match(css,/font-family:/);
  assert.doesNotMatch(entry.replace(/^\/\/.*$/gm,''),/indexedDB|localStorage|sessionStorage|https:\/\//);assert.match(entry,/document\.fonts\.delete/);assert.match(entry,/delete document\.documentElement\.dataset\.fontLab/);
});
