import './panel.css';
import './families.css';
import {FONTS,assetPath} from './catalog.mjs';

// アプリの設定・IndexedDB・localStorage・人物へは触れず、CSS上書きだけを比較する。
const panel=document.createElement('details');panel.id='font-lab-panel';
const summary=document.createElement('summary');summary.textContent='Aa フォント比較 / Font comparison · 開発専用';
const label=document.createElement('label');label.textContent='書体 / Typeface';
const select=document.createElement('select');select.id='font-lab-choice';
for(const [value,name]of [['current','現在のフォント / Original'],...FONTS.map(f=>[f.id,f.name])]){
  const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);
}label.append(select);
const status=document.createElement('p');status.id='font-lab-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
const help=document.createElement('p');help.textContent='開発専用・端末内比較。設定やデータは保存しません。サイズ・太さ・色・余白は共通です。絵文字・未収録文字は端末フォールバック。 / No saved app settings; missing glyphs use device fallback.';
const credits=document.createElement('div');credits.id='font-lab-credits';
for(const font of FONTS){const p=document.createElement('p');p.append(`${font.name} — ${font.credit} · `);
  const link=document.createElement('a');link.textContent='SIL OFL 1.1 / Copyright';link.href=new URL(assetPath(font.id,'OFL.txt'),document.baseURI);link.target='_blank';link.rel='noopener';p.append(link);credits.append(p);
}
panel.append(summary,label,status,help,credits);
let faces=[],current='current',sequence=0;
function reset(){for(const face of faces)document.fonts.delete(face);faces=[];select.disabled=false;delete document.documentElement.dataset.fontLab;current='current';status.textContent='現在のCSSフォント指定 / Original CSS font stack';}
async function choose(id){
  const token=++sequence;
  if(id==='current'){reset();return;}
  const font=FONTS.find(f=>f.id===id);if(!font)return;
  status.textContent='読み込み中… / Loading…';select.disabled=true;
  try{
    const family=`Birthday Calendar Demo Font Lab ${font.id}`;
    const loaded=await Promise.all(font.faces.map(async([file,weight])=>{
      const face=new FontFace(family,`url(${JSON.stringify(new URL(assetPath(font.id,file),document.baseURI).href)})`,{weight,style:'normal',display:'swap'});
      return face.load();
    }));
    if(token!==sequence)return;
    for(const face of faces)document.fonts.delete(face);faces=loaded;for(const face of faces)document.fonts.add(face);
    document.documentElement.dataset.fontLab=font.id;current=font.id;
    await document.fonts.ready;
    if(token===sequence)status.textContent=`${font.name} · 読み込み完了 / Ready · ${font.faces.map(f=>f[1]).join(', ')}`;
  }catch{if(token===sequence){select.value=current;status.textContent='読み込めませんでした。前の表示を保持します。 / Load failed; previous font retained.';}}
  finally{if(token===sequence)select.disabled=false;}
}
select.addEventListener('change',()=>choose(select.value));
reset();document.body.append(panel);
