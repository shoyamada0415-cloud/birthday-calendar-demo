function node(tag,text){const n=document.createElement(tag);if(text)n.textContent=text;return n;}
export function uninstallGuide(t){
  const root=node('section');root.className='exit-guide';
  const title=node('h3',t('endUseTitle')),intro=node('p',t('endUseHelp')),label=node('label',t('devicePlatform')),select=node('select');
  select.id='exit-platform';for(const value of ['ios','android','pc']){const option=node('option',t('platform_'+value));option.value=value;select.append(option);}label.append(select);
  const instruction=node('p');instruction.id='uninstall-instruction';instruction.setAttribute('aria-live','polite');select.onchange=()=>instruction.textContent=t('uninstall_'+select.value);select.onchange();
  root.append(title,intro,label,instruction,node('p',t('deleteExcluded')));return root;
}
export function setupExitUI(t,{backup,erase}){
  const host=document.querySelector('#data-privacy-section .data-privacy-guide');
  const zone=node('section');zone.id='delete-managed-zone';zone.className='delete-managed-zone';
  function translated(tag,key){const n=node(tag,t(key));n.dataset.guidanceKey=key;return n;}
  const create=translated('button','encryptedCreate');create.type='button';create.className='quiet';create.onclick=backup;
  const button=translated('button','deleteThisDevice');button.id='delete-managed-data';button.type='button';button.className='danger';button.onclick=erase;
  zone.append(translated('h3','deleteTitle'),translated('p','deleteTargets'),translated('p','deleteExcluded'),create,button);
  host.append(zone);
  const guide=uninstallGuide(t);guide.id='end-use-guide';host.append(guide);
}
export function refreshExitGuide(t){const old=document.getElementById('end-use-guide');if(old){const fresh=uninstallGuide(t);fresh.id=old.id;old.replaceWith(fresh);}}
export function showStopped(t,report=null,retry=null){
  const main=node('main');main.className='stopped-screen';main.setAttribute('aria-live','polite');
  main.append(node('h1',t(report?.complete?'deleteDone':'deleteStopped')),node('p',t('deleteNoRestart')));
  if(report){const list=node('ul');for(const key of ['dataDeleted','cachesDeleted','workerRemoved','preferencesDeleted'])list.append(node('li',t('delete_'+key)+': '+t(report[key]?'deleteVerified':'deleteIncomplete')));main.append(list);}
  if(!report?.complete&&retry){const button=node('button',t('deleteRetry'));button.className='danger';button.onclick=async()=>{button.disabled=true;try{await retry();}finally{if(button.isConnected)button.disabled=false;}};main.append(button);}
  main.append(node('p',t('deleteExcluded')),uninstallGuide(t));document.body.replaceChildren(main);
}
