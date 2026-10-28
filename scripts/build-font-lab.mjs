import {build} from 'vite';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {APP_VERSION} from '../src/version.js';
// 通常distへは絶対に出力しない。手元の比較専用シェルに既存SWの仕組みを使う。
const root='test-artifacts/font-lab';
await build({mode:'font-lab',build:{outDir:root,emptyOutDir:true}});
const index=join(root,'index.html');
const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
await writeFile(index,(await readFile(index,'utf8')).replace('</head>',`${csp}\n</head>`));
async function walk(dir){const entries=await readdir(dir,{withFileTypes:true}),files=[];
  for(const entry of entries){const file=join(dir,entry.name);if(entry.isDirectory())files.push(...await walk(file));else if(entry.name!=='sw.js')files.push(file);}return files;
}
const files=(await walk(root)).sort(),paths=files.map(file=>'./'+relative(root,file).replaceAll('\\','/'));
const hash=createHash('sha256');for(const file of files){hash.update(relative(root,file));hash.update(await readFile(file));}
const version=hash.digest('hex').slice(0,16);
const template=await readFile('src/sw-template.js','utf8');
await writeFile(join(root,'sw.js'),template.replace('__APP_VERSION__',APP_VERSION).replace('__CACHE_VERSION__',version).replace('__PRECACHE_JSON__',JSON.stringify(paths)));
console.log(`Development font lab only: ${root}, ${files.length+1} files, cache ${version}. Normal dist unchanged.`);
