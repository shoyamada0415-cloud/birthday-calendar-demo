import {crc32} from './zip-reader.js';
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 512;
const MAX_PIXELS = 16_777_216;
const MAX_SAVED_BYTES = 2 * 1024 * 1024;
const INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

function validateFile(file) {
  if (!file || file.size > MAX_INPUT_BYTES) throw new Error('画像は20 MiB以内を選択してください。');
  const type = file.type.toLowerCase();
  const knownExtension = /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name ?? '');
  if (!INPUT_TYPES.includes(type) && !(['', 'application/octet-stream'].includes(type) && knownExtension)) {
    throw new Error('JPEG・PNG・WebP・GIF・HEIC画像を選択してください。');
  }
}

function validateDimensions(width, height) {
  if (!width || !height || width * height > MAX_PIXELS) {
    throw new Error('画像の画素数が上限を超えています。');
  }
}

// MIMEに頼らず、デコード前にも宣言寸法を検査して巨大画像を拒否する。
export function backupImageHeader(bytes,type){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const text=(p,n)=>String.fromCharCode(...bytes.subarray(p,p+n));let width,height;
  if(type==='image/png'&&bytes.length>=45&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)
    &&v.getUint32(8)===13&&text(12,4)==='IHDR'&&text(bytes.length-8,4)==='IEND'){
    width=v.getUint32(16);height=v.getUint32(20);
    let p=8,idat=false,ended=false;
    while(p+12<=bytes.length){const size=v.getUint32(p),kind=text(p+4,4);
      if(size>bytes.length-p-12||crc32(bytes.subarray(p+4,p+8+size))!==v.getUint32(p+8+size))throw new Error('バックアップ画像の実形式が正しくありません。');
      if(kind==='IDAT')idat=true;if(kind==='IEND'){ended=size===0&&p+12===bytes.length;break;}
      if(kind==='IHDR'&&p!==8||['acTL','fcTL','fdAT'].includes(kind))throw new Error('バックアップ画像の実形式が正しくありません。');p+=size+12;
    }
    if(!idat||!ended)throw new Error('バックアップ画像の実形式が正しくありません。');
  }else if(type==='image/jpeg'&&bytes.length>=12&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217){
    let p=2;while(p+4<bytes.length){if(bytes[p++]!==255)break;while(bytes[p]===255)p++;const marker=bytes[p++];
      if(marker===0xda||marker===0xd9)break;if(marker===1||marker>=0xd0&&marker<=0xd7)continue;
      const n=v.getUint16(p);if(n<2||p+n>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&n>=8){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=n;
    }
  }else if(type==='image/webp'&&bytes.length>=30&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'&&v.getUint32(4,true)+8===bytes.length){
    const chunk=text(12,4);
    if(chunk==='VP8 '&&text(23,3)==='\u009d\u0001\u002a'){width=v.getUint16(26,true)&0x3fff;height=v.getUint16(28,true)&0x3fff;}
    else if(chunk==='VP8L'&&bytes[20]===0x2f){const bits=v.getUint32(21,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
    else if(chunk==='VP8X'&&!(bytes[20]&2)){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}
  }
  if(!width||!height)throw new Error('バックアップ画像の実形式が正しくありません。');
  validateDimensions(width,height);
  if(width>4096||height>4096)throw new Error('画像の寸法が上限を超えています。');
  return {width,height};
}

export async function validateBackupImage(blob){
  if(!blob||!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>MAX_SAVED_BYTES)throw new Error('バックアップ画像の形式・容量が正しくありません。');
  const header=backupImageHeader(new Uint8Array(await blob.arrayBuffer()),blob.type);
  let decoded;
  try{decoded=await decodeImage(blob);validateDimensions(decoded.width,decoded.height);
    if(!([header.width,header.height].sort((a,b)=>a-b).every((n,i)=>n===[decoded.width,decoded.height].sort((a,b)=>a-b)[i])))throw new Error('画像の寸法が一致しません。');
  }catch{throw new Error('バックアップ画像を完全に読み込めませんでした。');}finally{decoded?.close();}
}

async function encodeCanvas(canvas, context) {
  const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.82));
  let blob = await encode('image/webp');
  if (!blob || blob.type !== 'image/webp') {
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    blob = await encode('image/jpeg');
  }
  if (!blob || blob.size > MAX_SAVED_BYTES) throw new Error('画像を2 MiB以内に圧縮できませんでした。');
  return blob;
}

// トリミング画面ではCanvasの未描画状態を見せず、読み込み済みのimgを直接表示する。
export async function loadAvatarSource(file) {
  validateFile(file);
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = reject; image.src = url;
    });
    if (typeof image.decode === 'function') await image.decode().catch(() => {});
    validateDimensions(image.naturalWidth, image.naturalHeight);
    let released = false;
    return { file, url, image, width: image.naturalWidth, height: image.naturalHeight,
      release() { if (released) return; released = true; image.removeAttribute('src'); URL.revokeObjectURL(url); } };
  } catch (error) {
    URL.revokeObjectURL(url);
    const message = String(error?.message ?? '');
    throw new Error(message.startsWith('画像の画素数') ? message
      : '画像を読み込めませんでした。HEICが開けない場合はJPEGへ変換してください。');
  }
}

// 確定後のみ512px四方へ切り出す。Exifの向きはブラウザ標準のfrom-imageに任せる。
export async function cropAvatar(source, crop) {
  const { x, y, size } = crop;
  if (!Number.isFinite(size) || size <= 0 || x < -0.01 || y < -0.01
    || x + size > source.width + 0.01 || y + size > source.height + 0.01) {
    throw new Error('トリミング範囲が正しくありません。');
  }
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を処理できませんでした。');
  context.imageSmoothingQuality = 'high';
  let bitmap;
  try {
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(source.file, { imageOrientation: 'from-image' });
        if (bitmap.width !== source.width || bitmap.height !== source.height) {
          bitmap.close(); bitmap = null;
        }
      } catch { bitmap = null; }
    }
    context.drawImage(bitmap ?? source.image, x, y, size, size, 0, 0, 512, 512);
    return await encodeCanvas(canvas, context);
  } finally { bitmap?.close(); }
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height,
        close: () => bitmap.close() };
    } catch { /* 一部Safariの画像デコード差異ではimg要素も試す。 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = reject; image.src = url;
    });
    if(typeof image.decode==='function')await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('画像を読み込めませんでした。');
  }
}

// MIME申告を信用せずブラウザで画像としてデコードし、長辺512pxへ縮小して保存します。
export async function compressAvatar(file) {
  validateFile(file);
  const bitmap = await decodeImage(file);
  try {
    validateDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像を処理できませんでした。');
    context.drawImage(bitmap.source, 0, 0, width, height);
    return await encodeCanvas(canvas, context);
  } finally { bitmap.close(); }
}
