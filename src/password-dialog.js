import {validatePassword} from './encrypted-backup.js';

// Passwords exist only in this short-lived dialog and the caller's current operation.
export function askBackupPassword(t,creating){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.id='backup-password-dialog';dialog.className='sheet password-dialog';
    const form=document.createElement('form');form.method='dialog';
    const heading=document.createElement('h2');heading.id='backup-password-title';heading.textContent=t(creating?'encryptedCreate':'encryptedOpen');dialog.setAttribute('aria-labelledby',heading.id);
    const hint=document.createElement('p');hint.className='help';hint.id='backup-password-hint';hint.textContent=t('passwordHelp');
    const fields=[];
    for(const [name,key] of creating?[['backup-password','passwordLabel'],['backup-password-confirm','passwordConfirm']]:[['backup-password','passwordLabel']]){
      const label=document.createElement('label');label.textContent=t(key);const input=document.createElement('input');input.id=name;input.name=name;input.type='password';input.required=true;input.maxLength=1024;input.autocomplete=creating?'new-password':'current-password';input.autocapitalize='none';input.spellcheck=false;input.setAttribute('aria-describedby',hint.id);if(creating)input.minLength=12;label.append(input);fields.push({label,input});
    }
    const toggle=document.createElement('button');toggle.type='button';toggle.className='quiet';toggle.textContent=t('passwordShow');toggle.setAttribute('aria-pressed','false');
    toggle.onclick=()=>{const show=fields[0].input.type==='password';for(const f of fields)f.input.type=show?'text':'password';toggle.textContent=t(show?'passwordHide':'passwordShow');toggle.setAttribute('aria-pressed',String(show));};
    const error=document.createElement('p');error.className='error';error.setAttribute('role','alert');error.hidden=true;
    const actions=document.createElement('div');actions.className='actions';
    const cancel=document.createElement('button');cancel.type='button';cancel.className='quiet';cancel.textContent=t('cancel');cancel.onclick=()=>finish(null);
    const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent=t(creating?'encryptedCreate':'encryptedOpen');actions.append(cancel,submit);
    form.append(heading,hint,...fields.map(f=>f.label),toggle,error,actions);dialog.append(form);document.body.append(dialog);
    let done=false;
    function finish(value){if(done)return;done=true;for(const f of fields)f.input.value='';dialog.close();dialog.remove();resolve(value);}
    form.onsubmit=event=>{event.preventDefault();try{const p=fields[0].input.value;if(creating)validatePassword(p,fields[1].input.value);finish(p);}catch(e){error.textContent=t(e.message);error.hidden=false;}};
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});dialog.showModal();fields[0].input.focus();
  });
}
