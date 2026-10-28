import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const template = new URL('../src/sw-template.js', import.meta.url);
const appVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile() && entry.name !== 'sw.js') files.push(path);
  }
  return files;
}
const root = dist.pathname.startsWith('/') && process.platform === 'win32'
  ? decodeURIComponent(dist.pathname.slice(1)) : decodeURIComponent(dist.pathname);
// 開発サーバーのHMRは妨げず、配布HTMLにだけ外部通信を禁止するCSPを加える。
const indexFile = join(root, 'index.html');
const html = await readFile(indexFile, 'utf8');
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
if (!html.includes('http-equiv="Content-Security-Policy"')) {
  await writeFile(indexFile, html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n  ${csp}`));
}
const files = (await filesIn(root)).sort();
const paths = files.map((file) => `./${relative(root, file).split(sep).join('/')}`);
const hash = createHash('sha256');
for (const file of files) { hash.update(relative(root, file)); hash.update(await readFile(file)); }
const cacheVersion = hash.digest('hex').slice(0, 16);
const source = (await readFile(template, 'utf8'))
  .replace('__CACHE_VERSION__', cacheVersion).replace('__APP_VERSION__', appVersion)
  .replace('__PRECACHE_JSON__', JSON.stringify(paths));
await writeFile(new URL('../dist/sw.js', import.meta.url), source);
console.log(`Service Worker version: ${cacheVersion}, ${paths.length} assets`);
