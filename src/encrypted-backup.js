// Envelope v1: fixed 64-byte authenticated header, followed by ZIP ciphertext + 16-byte tag.
// No person names, image filenames or app metadata are exposed in the envelope.
export const ENCRYPTED_VERSION = 1;
export const PBKDF2_ITERATIONS = 600000;
export const MAX_ZIP_BYTES = 128 * 1024 * 1024;
export const HEADER_BYTES = 64;
export const MAX_ENCRYPTED_BYTES = MAX_ZIP_BYTES + HEADER_BYTES + 16;
const CURRENT_MAGIC = new Uint8Array([66, 67, 65, 76, 68, 69, 77, 79]);
const hasMagic = (bytes, magic) => bytes.length >= magic.length
  && magic.every((value, index) => value === bytes[index]);
function fail(code){throw new Error(code);}
export function validatePassword(password, confirmation=password){
  if(typeof password!=='string'||[...password].length<12||password.length>1024||new TextEncoder().encode(password).length>1024||!password.trim()||/[\u0000-\u001f\u007f]/u.test(password))fail('passwordWeak');
  if(password!==confirmation)fail('passwordMismatch');
}
async function keyFor(password,salt,usage){
  if(!globalThis.crypto?.subtle)fail('cryptoUnavailable');
  if(typeof password!=='string'||!password.length||new TextEncoder().encode(password).length>1024)fail('decryptFailed');
  const bytes=new TextEncoder().encode(password);
  try{
    const material=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);
    return await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:PBKDF2_ITERATIONS,salt},material,{name:'AES-GCM',length:256},false,[usage]);
  }finally{bytes.fill(0);}
}
export async function isEncryptedBackup(file){
  if(!file||file.size>MAX_ENCRYPTED_BYTES)fail('encryptedTooLarge');
  const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());
  return bytes.length===8&&hasMagic(bytes,CURRENT_MAGIC);
}
export async function encryptBackup(zip,password,confirmation=password){
  validatePassword(password,confirmation);
  if(!zip||!zip.size||zip.size>MAX_ZIP_BYTES)fail('encryptedTooLarge');
  if(!globalThis.crypto?.subtle)fail('cryptoUnavailable');
  const header=new Uint8Array(HEADER_BYTES),view=new DataView(header.buffer);header.set(CURRENT_MAGIC);
  header[8]=ENCRYPTED_VERSION;header[9]=1;header[10]=1; // PBKDF2-SHA256 / AES-256-GCM
  view.setUint32(12,PBKDF2_ITERATIONS);header.set(crypto.getRandomValues(new Uint8Array(16)),16);
  header.set(crypto.getRandomValues(new Uint8Array(12)),32);view.setUint32(44,zip.size);
  const plain=new Uint8Array(await zip.arrayBuffer());
  try{
    const key=await keyFor(password,header.slice(16,32),'encrypt');
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:header.slice(32,44),additionalData:header,tagLength:128},key,plain);
    return new Blob([header,encrypted],{type:'application/octet-stream'});
  }finally{plain.fill(0);}
}
export async function decryptBackup(file,password){
  if(!file||file.size>MAX_ENCRYPTED_BYTES)fail('encryptedTooLarge');
  if(file.size<HEADER_BYTES+17)fail('encryptedInvalid');
  // Validate bounded header before reading the full ciphertext or running PBKDF2.
  const header=new Uint8Array(await file.slice(0,HEADER_BYTES).arrayBuffer()),view=new DataView(header.buffer);
  if(!hasMagic(header,CURRENT_MAGIC)||header[8]!==1||header[9]!==1||header[10]!==1||header[11]!==0||view.getUint32(12)!==PBKDF2_ITERATIONS||header.slice(48).some(Boolean))fail('encryptedInvalid');
  const length=view.getUint32(44);
  if(!length||length>MAX_ZIP_BYTES||file.size!==HEADER_BYTES+length+16)fail('encryptedInvalid');
  let plain;
  try{
    const key=await keyFor(password,header.slice(16,32),'decrypt');
    plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:header.slice(32,44),additionalData:header,tagLength:128},key,await file.slice(HEADER_BYTES).arrayBuffer()));
    if(plain.length!==length)fail('decryptFailed');
    return new Blob([plain],{type:'application/zip'});
  }catch(error){if(error.message==='cryptoUnavailable')throw error;fail('decryptFailed');}
  finally{plain?.fill(0);}
}
