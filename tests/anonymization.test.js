import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
const rootPath=fileURLToPath(root);
const text=/\.(?:html|css|js|mjs|json|webmanifest|md|yml|yaml|txt|pb)$/i;
const ignored=new Set(['node_modules','dist','test-artifacts']);
const oldName=['yo','ribi'].join('');
const oldOwner=['nami','noto'].join('');
const oldInternal=['birthday','-circle'].join('');
const oldRepository=['birthday','-calendar','-pwa'].join('');
const forbidden=[new RegExp(oldName,'i'),new RegExp(oldOwner,'i'),new RegExp(oldInternal,'i'),new RegExp(oldRepository,'i')];
function files(directory){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    if(ignored.has(entry.name))return [];
    const path=join(directory,entry.name);
    return entry.isDirectory()?files(path):[path];
  });
}

test('public source, documentation, tests and filenames contain no former project identifiers',()=>{
  for(const path of files(rootPath)){
    const name=relative(rootPath,path).replaceAll('\\','/');
    for(const pattern of forbidden)assert.doesNotMatch(name,pattern,`filename: ${name}`);
    if(text.test(path))for(const pattern of forbidden)
      assert.doesNotMatch(readFileSync(path,'utf8'),pattern,`content: ${name}`);
  }
});

test('public source and filenames contain no previous release fingerprints',()=>{
  for(const path of files(rootPath)){
    const name=relative(rootPath,path).replaceAll('\\','/');
    assert.doesNotMatch(name,/v\d+\.\d+\.\d+/i,`filename: ${name}`);
    if(text.test(path))assert.doesNotMatch(readFileSync(path,'utf8'),/\b1\.4\.\d+\b/,`content: ${name}`);
  }
  const encrypted=readFileSync(new URL('../src/encrypted-backup.js',import.meta.url),'utf8');
  assert.doesNotMatch(encrypted,/LEGACY_MAGIC|encryptedWithPreviousHeader/);
  assert.equal([...encrypted.matchAll(/const\s+\w*MAGIC\s*=/g)].length,1);
});

test('manifest, HTML and storage namespaces use only the anonymous demo identity',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal(manifest.name,'Birthday Calendar Demo');assert.equal(manifest.short_name,'Birthday Calendar Demo');
  assert.equal(manifest.id,'./?app=birthday-calendar-demo');
  assert.match(html,/<title>Birthday Calendar Demo<\/title>/);
  assert.match(html,/name="robots" content="noindex, nofollow, noarchive, nosnippet"/);
  assert.match(readFileSync(new URL('../src/db.js',import.meta.url),'utf8'),/DB_NAME = 'birthday-calendar-demo'/);
  assert.match(readFileSync(new URL('../src/sw-template.js',import.meta.url),'utf8'),/birthday-calendar-demo-shell-/);
});

test('repository and build settings do not publish history or source maps',()=>{
  assert.equal(existsSync(join(rootPath,'.git')),false);
  const vite=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
  assert.match(vite,/sourcemap:\s*false/);
  if(existsSync(join(rootPath,'dist')))for(const path of files(join(rootPath,'dist')))
    assert.equal(path.endsWith('.map'),false,path);
});

test('application code contains no fixed external network request',()=>{
  const sources=files(join(rootPath,'src')).filter(path=>/\.js$/.test(path))
    .map(path=>readFileSync(path,'utf8')).join('\n');
  assert.doesNotMatch(sources,/\b(?:fetch|sendBeacon)\s*\(\s*['"]https?:/i);
  assert.doesNotMatch(sources,/new\s+WebSocket\s*\(\s*['"]wss?:/i);
});
