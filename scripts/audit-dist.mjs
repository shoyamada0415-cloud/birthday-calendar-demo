import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Pagesへアップロードするdistだけを検査する。ソース/テスト/ZIP/DBを公開物へ混ぜない。
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const required = ['index.html', 'manifest.webmanifest', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png','icons/favicon-48.png',
  ...['ZenMaruGothic-Regular.ttf','ZenMaruGothic-Medium.ttf','ZenMaruGothic-Bold.ttf','OFL.txt','METADATA.pb','SOURCE.json'].map(name=>`fonts/zen-maru-gothic/${name}`)];
const textExtensions = /\.(?:html|js|css|webmanifest|json|txt|pb)$/;
const formerHeaderBytes = [...`${['yo','ribi'].join('').toUpperCase()}\r\n`]
  .map((character) => character.charCodeAt(0));
const formerHeaderPattern = new RegExp(formerHeaderBytes.join('\\s*,\\s*'));
const forbidden = [
  ['開発用フォント比較・不採用書体', /(?:__font-lab|Birthday Calendar Demo Font Lab|LINE Seed JP|Zen Kaku Gothic New|M PLUS 1p|Noto Sans JP|Noto Serif JP)/],
  ['秘密鍵', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['認証らしき値', /(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{24,}|AKIA[0-9A-Z]{16})/],
  ['DB接続文字列', /(?:jdbc:postgresql:|postgres(?:ql)?:\/\/)/i],
  ['ローカル絶対パス', /(?:[A-Z]:\\(?:Users|プログラミング)\\|\/home\/runner\/|\/Users\/[^/]+\/)/i],
  ['X API送信先', /(?:api\.x\.com|api\.twitter\.com)/i],
  ['旧公開識別子', new RegExp(['yo','ribi'].join(''),'i')],
  ['旧暗号化ヘッダー列', formerHeaderPattern],
  ['旧作者識別子', new RegExp(['nami','noto'].join(''),'i')],
  ['旧内部識別子', new RegExp(['birthday','-circle'].join(''),'i')],
  ['旧リポジトリ識別子', new RegExp(['birthday','-calendar','-pwa'].join(''),'i')],
  ['過去版番号', /\b1\.4\.\d+\b/],
  ['source map参照', /sourceMappingURL|\.map(?:\?|$)/i],
];
function assert(condition, message) { if (!condition) throw new Error(`公開物監査: ${message}`); }
async function walk(directory) {
  const items = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) items.push(...await walk(path));
    else { assert(item.isFile(), '通常ファイル以外を含めません。'); items.push(path); }
  }
  return items;
}
const paths = (await walk(root)).map((path) => relative(root, path).split(sep).join('/')).sort();
assert(!paths.some((name) => name.endsWith('.map')), 'source mapを公開しません。');
assert(paths.length >= required.length + 2, 'ビルド成果物が不足しています。');
for (const name of required) assert(paths.includes(name), `${name}がありません。`);
for (const name of paths) {
  assert(required.includes(name) || /^assets\/[^/]+\.(?:js|css)$/.test(name),
    `${name}は公開許可リスト外です。`);
  const bytes = await readFile(join(root, name));
  assert(bytes.length > 0, `${name}が空です。`);
  if (textExtensions.test(name)) {
    const content = bytes.toString('utf8');
    for (const [label, pattern] of forbidden) assert(!pattern.test(content), `${name}に${label}の疑いがあります。`);
  }
}
const html = await readFile(join(root, 'index.html'), 'utf8');
const source=JSON.parse(await readFile(join(root,'fonts/zen-maru-gothic/SOURCE.json'),'utf8'));
assert(source.family==='Zen Maru Gothic'&&source.unmodified===true&&source.files.length===5,'採用書体の取得記録が不正です。');
for(const file of source.files){
  assert(required.includes(`fonts/zen-maru-gothic/${file.filename}`),'フォント記録に許可外ファイルがあります。');
  const bytes=await readFile(join(root,'fonts/zen-maru-gothic',file.filename));
  const original=await readFile(new URL(`../public/fonts/zen-maru-gothic/${file.filename}`,import.meta.url));
  assert(bytes.equals(original)&&bytes.length===file.bytes&&createHash('sha256').update(bytes).digest('hex')===file.sha256,`${file.filename}の原本・SHA-256が不一致です。`);
}
const css=(await Promise.all(paths.filter(name=>name.endsWith('.css')).map(name=>readFile(join(root,name),'utf8')))).join('\n');
assert((css.match(/@font-face/g)||[]).length===3,'採用3ウェイト以外のWebフォントがあります。');
assert(!/url\(["']?(?:https?:|\/)/.test(css),'CSSに外部/ルート固定アセットURLがあります。');
for(const file of source.files.filter(f=>f.filename.endsWith('.ttf')))assert(css.includes(`../fonts/zen-maru-gothic/${file.filename}`),`${file.filename}の相対URLがありません。`);
assert(html.includes('http-equiv="Content-Security-Policy"')
  && html.includes("connect-src 'self'") && html.includes("img-src 'self' blob:"),
  '配布HTMLのCSPが不足しています。');
assert(html.includes('name="robots" content="noindex, nofollow, noarchive, nosnippet"')
  && html.includes('<title>Birthday Calendar Demo</title>'), '匿名Demoの検索除外または表示名が不足しています。');
assert(!/(?:src|href)="\//.test(html), 'HTMLにroot固定のアセットパスがあります。');
const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
assert(manifest.id === './?app=birthday-calendar-demo' && manifest.start_url === './' && manifest.scope === './'
  && manifest.display === 'standalone' && manifest.name === 'Birthday Calendar Demo'
  && manifest.short_name === 'Birthday Calendar Demo',
  'manifestの相対パス/インストール設定が不正です。');
const icons = new Map(manifest.icons.map((icon) => [icon.src, icon]));
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],['apple-touch-icon.png',180],['favicon-48.png',48]]) {
  const src = `./icons/${name}`;
  if(!['apple-touch-icon.png','favicon-48.png'].includes(name)) assert(icons.get(src)?.sizes === `${size}x${size}`, `${name}のmanifest記載が不正です。`);
  const png = await readFile(join(root, 'icons', name));
  assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && png.readUInt32BE(16) === size && png.readUInt32BE(20) === size,
  `${name}の実画像寸法が不正です。`);
}
const sw = await readFile(join(root, 'sw.js'), 'utf8');
const appVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
assert(sw.includes(`const APP_VERSION = '${appVersion}'`), 'Service WorkerとアプリのVersionが一致しません。');
const list = sw.match(/const PRECACHE = (\[[^;]+\]);/);
assert(list, 'Service Workerのプリキャッシュ一覧がありません。');
const cachedPaths = JSON.parse(list[1]).map((name) => name.replace(/^\.\//, '')).sort();
assert(JSON.stringify(cachedPaths) === JSON.stringify(paths.filter((name) => name !== 'sw.js')),
  'Service Workerのキャッシュ対象が公開ファイルと一致しません。');
assert(!sw.includes('indexedDB') && sw.includes("birthday-calendar-demo-shell-") && sw.includes('encodeURIComponent(new URL(SCOPE).pathname)')
  && sw.includes('name.startsWith(CACHE_PREFIX)'),
  'Service Workerのデータ分離/旧キャッシュ清掃を確認できません。');
console.log(`公開物監査OK: ${paths.length}ファイル。許可されたアプリシェルのみ。`);
