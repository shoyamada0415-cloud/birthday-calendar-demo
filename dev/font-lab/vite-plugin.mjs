import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FONTS,assetPath} from './catalog.mjs';
const root=new URL('./',import.meta.url);
const assets=new Map([['__font-lab-assets__/inventory.json',new URL('inventory.json',root)]]);
for(const font of FONTS)for(const file of ['OFL.txt','METADATA.pb',...font.faces.map(face=>face[0])])
  assets.set(assetPath(font.id,file),new URL(`fonts/${font.id}/${encodeURIComponent(file)}`,root));
export function fontLabPlugin(){return {
  name:'birthday-calendar-demo-development-font-lab',
  configResolved(config){if(config.command==='build'&&resolve(config.root,config.build.outDir)!==resolve(config.root,'test-artifacts/font-lab'))
    throw Error('Font comparison build must use test-artifacts/font-lab, never production dist.');},
  transformIndexHtml:{order:'pre',handler:()=>[{tag:'script',attrs:{type:'module',src:'/dev/font-lab/entry.js'},injectTo:'head'}]},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
    let path;try{path=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);}catch{return next();}
    if(!path.startsWith('__font-lab-assets__/'))return next();
    const file=assets.get(path);if(!file){res.statusCode=404;return res.end();}
    try{const bytes=await readFile(file);res.setHeader('Content-Type',path.endsWith('.ttf')?'font/ttf':path.endsWith('.json')?'application/json':'text/plain; charset=utf-8');
      res.setHeader('Cache-Control',path.endsWith('.ttf')?'public, max-age=31536000, immutable':'no-cache');res.end(bytes);
    }catch{res.statusCode=404;res.end('Run node scripts/acquire-dev-fonts.mjs after license review.');}
  });},
  async generateBundle(){for(const[fileName,file]of assets)this.emitFile({type:'asset',fileName,source:await readFile(file)});},
};}
