// Fictional test password, never user data. Both fields are cleared by the real UI.
export const TEST_BACKUP_PASSWORD='fictional-test-passphrase-only';
export async function enterBackupPassword({evaluate,until},creating=true,password=TEST_BACKUP_PASSWORD){
  await until(()=>evaluate('Boolean(document.querySelector("#backup-password-dialog")?.open)'),'Backup password dialog');
  await evaluate(`(()=>{document.querySelector('#backup-password').value=${JSON.stringify(password)};const confirm=document.querySelector('#backup-password-confirm');if(confirm)confirm.value=${JSON.stringify(password)};document.querySelector('#backup-password-dialog form').requestSubmit();})()`);
}
