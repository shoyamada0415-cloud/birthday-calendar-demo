import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='public/fonts/zen-maru-gothic/';
const record=JSON.parse(readFileSync(folder+'SOURCE.json','utf8'));
test('正式Zen Maruは確認済み公式原本と同一の400/500/700・OFL・著作権文書を配布する',()=>{
  const inventory=JSON.parse(readFileSync('dev/font-lab/inventory.json','utf8'));
  assert.equal(record.sourceCommit,inventory.sourceCommit);
  assert.deepEqual(record.files,inventory.families.find(f=>f.id==='zenmarugothic').files);
  assert.deepEqual(readdirSync(folder).sort(),[...record.files.map(f=>f.filename),'SOURCE.json'].sort());
  assert.deepEqual(record.files.filter(f=>f.weight).map(f=>f.weight),['400','500','700']);
  for(const f of record.files){const bytes=readFileSync(folder+f.filename);
    assert.deepEqual(bytes,readFileSync('dev/font-lab/fonts/zenmarugothic/'+f.filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.equal(bytes.length,f.bytes);}
  assert.match(readFileSync(folder+'OFL.txt','utf8'),/^Copyright 2021 The Zen Maru Gothic Project Authors/);
  assert.match(readFileSync(folder+'METADATA.pb','utf8'),/Copyright 2021 The Zen Maru Gothic Authors/);
});
test('標準フォントは3ウェイト・swap・端末フォールバックで外部フォントへ接続しない',()=>{
  const css=readFileSync('src/fonts.css','utf8');
  assert.equal((css.match(/@font-face/g)||[]).length,3);assert.equal((css.match(/font-display:swap/g)||[]).length,3);
  for(const weight of [400,500,700])assert.ok(css.includes('font-weight:'+weight));
  assert.match(css,/--app-font:'Zen Maru Gothic'.*system-ui,sans-serif/);
  assert.doesNotMatch(css,/https?:|data:|unicode-range/);assert.match(css,/\.bell span \{ font-family:var\(--app-font\)/);
  assert.match(readFileSync('src/app.js','utf8'),/import '\.\/fonts.css'/);
});
test('フォント導入はIndexedDB・ZIP設定を変更せずSWもIndexedDBを操作しない',()=>{
  const css=readFileSync('src/fonts.css','utf8');assert.doesNotMatch(css,/indexedDB|localStorage|sessionStorage/);
  assert.doesNotMatch(readFileSync('src/sw-template.js','utf8'),/indexedDB|deleteDatabase/);
  assert.match(readFileSync('src/db.js','utf8'),/DB_VERSION\s*=\s*3/);
  assert.match(readFileSync('src/version.js','utf8'),/package\.json/);
});
test('本番監査は採用書体だけを許可し、他5書体と比較用識別子を拒否する',()=>{
  const audit=readFileSync('scripts/audit-dist.mjs','utf8');
  for(const name of ['LINE Seed JP','Zen Kaku Gothic New','M PLUS 1p','Noto Sans JP','Noto Serif JP','Birthday Calendar Demo Font Lab'])assert.ok(audit.includes(name));
  for(const file of record.files)assert.ok(audit.includes(file.filename));
  assert.match(audit,/createHash\('sha256'\)/);assert.match(audit,/キャッシュ対象が公開ファイルと一致/);
});
