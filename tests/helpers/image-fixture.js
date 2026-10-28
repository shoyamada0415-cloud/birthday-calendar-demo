import {readFileSync} from 'node:fs';
// Nodeには画像decoderがない。既知の実PNGだけを許可するテスト用shim。
// 任意画像の完全decode・破損拒否はEdgeで別途検証する。アプリへはbundleしない。
const bytes=readFileSync(new URL('../../public/icons/favicon-48.png',import.meta.url));
export const imageFixture=()=>new Blob([bytes],{type:'image/png'});
if(typeof globalThis.createImageBitmap!=='function')globalThis.createImageBitmap=async blob=>{
  const actual=Buffer.from(await blob.arrayBuffer());
  if(!actual.equals(bytes))throw new Error('Test decoder accepts only the known real PNG');
  return {width:48,height:48,close(){}};
};
