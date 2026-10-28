import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
const root=resolve('test-artifacts/font-lab');
const mime={'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.ttf':'font/ttf','.json':'application/json','.txt':'text/plain; charset=utf-8','.pb':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  let path;try{const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/font-lab/')){res.writeHead(404).end();return;}
    path=resolve(root,decodeURIComponent(url.pathname.slice('/font-lab/'.length))||'index.html');}catch{res.writeHead(400).end();return;}
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  try{const bytes=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?undefined:bytes);}
  catch{res.writeHead(404).end();}
});
server.listen(5191,'127.0.0.1',()=>console.log('Development font comparison ONLY: http://127.0.0.1:5191/font-lab/ (separate origin/port; never deploy this directory)'));
