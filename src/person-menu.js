// メニューだけを管理し、人物データの読み書きは既存アプリへ委譲する。
export function menuPosition(anchor, size, viewport) {
  const margin=8;
  return {left:Math.max(margin,Math.min(anchor.left,viewport.width-size.width-margin)),
    top:Math.max(margin,Math.min(anchor.bottom+4,viewport.height-size.height-margin))};
}
export function setupPersonMenu({label,actions,id:menuId='person-action-menu',document:doc=document,window:win=window}) {
  const menu=doc.createElement('div');menu.id=menuId;menu.className='person-action-menu';
  menu.setAttribute('role','menu');menu.hidden=true;doc.body.append(menu);
  let anchor=null,personId=null;
  const close=(restore=true)=>{if(menu.hidden)return;menu.hidden=true;anchor?.setAttribute('aria-expanded','false');
    if(restore&&anchor?.isConnected)anchor.focus({preventScroll:true});anchor=null;personId=null;};
  const open=(id,button,context={})=>{
    close(false);anchor=button;personId=id;button.setAttribute('aria-expanded','true');
    menu.setAttribute('aria-label',label(id));menu.replaceChildren();
    for(const action of actions){const item=doc.createElement('button');item.type='button';item.setAttribute('role','menuitem');
      item.dataset.action=action.key;item.textContent=action.label();
      if(action.key==='delete')item.className='danger-link';
      item.onclick=()=>{close();action.run(id,context);};menu.append(item);}
    menu.hidden=false;const size=menu.getBoundingClientRect(),p=menuPosition(button.getBoundingClientRect(),size,{width:win.innerWidth,height:win.innerHeight});
    menu.style.left=p.left+'px';menu.style.top=p.top+'px';menu.querySelector('button').focus({preventScroll:true});
  };
  const outside=e=>{if(!menu.hidden&&!menu.contains(e.target)&&!anchor?.contains(e.target))close(false);};
  const keys=e=>{if(menu.hidden)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
    if(e.key==='Tab'){close(false);return;}const items=[...menu.querySelectorAll('button')],i=items.indexOf(doc.activeElement);
    const next=e.key==='ArrowDown'?(i+1)%items.length:e.key==='ArrowUp'?(i+items.length-1)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:null;
    if(next!==null){e.preventDefault();items[next].focus();}};
  const dismiss=()=>close(false);
  doc.addEventListener('pointerdown',outside,true);doc.addEventListener('keydown',keys,true);
  win.addEventListener('resize',dismiss);win.addEventListener('scroll',dismiss,true);win.addEventListener('pagehide',dismiss);
  return {open,close,removePerson:id=>{if(personId===id)close(false);},destroy(){close(false);menu.remove();
    doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('keydown',keys,true);win.removeEventListener('resize',dismiss);win.removeEventListener('scroll',dismiss,true);win.removeEventListener('pagehide',dismiss);}};
}
