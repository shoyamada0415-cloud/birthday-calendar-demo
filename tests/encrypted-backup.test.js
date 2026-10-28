import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptBackup,decryptBackup,isEncryptedBackup,validatePassword,MAX_ENCRYPTED_BYTES,PBKDF2_ITERATIONS} from '../src/encrypted-backup.js';
import {readFileSync} from 'node:fs';
import {inspectBackup} from '../src/backup.js';
const password='fictional-test-passphrase-only';
test('AES256-GCM round trip hides plaintext and nested filenames',async()=>{
  const raw=new Blob(['person-private-dummy images/fictional.png']);const sealed=await encryptBackup(raw,password);
  assert.equal(await isEncryptedBackup(sealed),true);assert.equal(await(await decryptBackup(sealed,password)).text(),await raw.text());
  assert.ok(!new TextDecoder().decode(await sealed.arrayBuffer()).includes('person-private-dummy'));assert.equal(sealed.size,raw.size+80);
});
test('same data and password produce independent random salts and IVs',async()=>{
  const a=new Uint8Array(await(await encryptBackup(new Blob(['same']),password)).arrayBuffer()),b=new Uint8Array(await(await encryptBackup(new Blob(['same']),password)).arrayBuffer());
  assert.notDeepEqual(a.slice(16,32),b.slice(16,32));assert.notDeepEqual(a.slice(32,44),b.slice(32,44));assert.notDeepEqual(a,b);
});
test('only the current encrypted header is accepted',async()=>{
  const current=await encryptBackup(new Blob(['current-format']),password);
  const unknown=new Uint8Array(await current.arrayBuffer());unknown[0]^=255;
  assert.equal(await isEncryptedBackup(new Blob([unknown])),false);
  await assert.rejects(decryptBackup(new Blob([unknown]),password),/encryptedInvalid/);
});
test('wrong password and authenticated-header/ciphertext modifications are rejected',async()=>{
  const b=await encryptBackup(new Blob(['private']),password);await assert.rejects(decryptBackup(b,'wrong-password'),/decryptFailed/);
  for(const offset of [16,32,64,b.size-1]){const bytes=new Uint8Array(await b.arrayBuffer());bytes[offset]^=1;await assert.rejects(decryptBackup(new Blob([bytes]),password),/decryptFailed/);}
});
test('unknown versions, excessive KDF work, truncation, trailers and reserved flags are rejected',async()=>{
  const b=await encryptBackup(new Blob(['zip']),password);
  for(const offset of [8,9,10,11,12,44,48]){const bytes=new Uint8Array(await b.arrayBuffer());bytes[offset]^=127;await assert.rejects(decryptBackup(new Blob([bytes]),password),/encryptedInvalid/);}
  await assert.rejects(decryptBackup(b.slice(0,-1),password),/encryptedInvalid/);await assert.rejects(decryptBackup(new Blob([b,'extra']),password),/encryptedInvalid/);
  assert.equal(PBKDF2_ITERATIONS,600000);
});
test('oversized encrypted input is rejected before any file read',async()=>{
  const huge={size:MAX_ENCRYPTED_BYTES+1,slice(){throw new Error('must not read');},arrayBuffer(){throw new Error('must not read');}};
  await assert.rejects(decryptBackup(huge,password),/encryptedTooLarge/);await assert.rejects(isEncryptedBackup(huge),/encryptedTooLarge/);
});
test('password checks preserve whitespace exactly and reject weak or mismatching values',async()=>{
  for(const p of ['short',' '.repeat(14),'x'.repeat(1025),'a'.repeat(15)+'\n'])assert.throws(()=>validatePassword(p),/passwordWeak/);
  assert.throws(()=>validatePassword(password,password+'!'),/passwordMismatch/);
  const p='  long-unique-password  ',b=await encryptBackup(new Blob(['secret']),p);await assert.rejects(decryptBackup(b,p.trim()),/decryptFailed/);assert.equal(await(await decryptBackup(b,p)).text(),'secret');
});
test('ordinary ZIP detection remains non-encrypted and no password/key persistence is introduced',async()=>{
  assert.equal(await isEncryptedBackup(new Blob(['PK\x03\x04ordinary-zip'])),false);
  for(const file of ['encrypted-backup.js','password-dialog.js'])assert.doesNotMatch(readFileSync(new URL('../src/'+file,import.meta.url),'utf8'),/localStorage|sessionStorage|indexedDB|console\.|fetch\(/);
  const ui=readFileSync(new URL('../src/password-dialog.js',import.meta.url),'utf8');assert.match(ui,/new-password/);assert.match(ui,/current-password/);assert.match(ui,/input.value=''/);
});
test('successful decryption does not bypass the existing ZIP structural validation',async()=>{
  const file=await encryptBackup(new Blob(['PK fictional invalid ZIP']),password);
  await assert.rejects(inspectBackup(await decryptBackup(file,password)),/ZIP/);
});
test('new backup filename is anonymous while file selection remains content based',()=>{
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(app,/birthday-calendar-backup-\$\{state\.today\}\.birthday-backup/);
  assert.match(app,/removeAttribute\('accept'\)/);assert.doesNotMatch(html,/id="import-backup"[^>]+accept=/);
});
