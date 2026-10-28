// ZIPをファイルシステムへ展開しない。全entryを先に検査し、順次・上限付きで読む。
export const ZIP_LIMITS = Object.freeze({archive:128*1024*1024,total:160*1024*1024,json:8*1024*1024,image:2*1024*1024,entries:2000});
const fail=()=>{throw new Error('ZIPの構造・ファイル一覧・容量が正しくありません。');};
const nameAllowed=name=>name==='manifest.json'||name==='data.json'||/^images\/[0-9a-f-]{36}\.bin$/i.test(name);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const byte of bytes)c=(c>>>8)^crcTable[(c^byte)&255];return(c^0xffffffff)>>>0;}

export function zipDirectory(bytes,limits=ZIP_LIMITS){
  if(bytes.length>limits.archive||bytes.length<22)fail();
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u16=p=>v.getUint16(p,true),u32=p=>v.getUint32(p,true);
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-65557)&&(u32(end)!==0x06054b50||end+22+u16(end+20)!==bytes.length))end--;
  if(end<0||end<bytes.length-65557)fail();
  const count=u16(end+10),offset=u32(end+16),size=u32(end+12);
  if(u16(end+4)||u16(end+6)||count<2||count>limits.entries||u16(end+8)!==count||offset+size!==end)fail();
  const names=new Set(),entries=[];let cursor=offset,total=0;
  const text=new TextDecoder('utf-8',{fatal:true});
  const extra=(start,length)=>{const stop=start+length;while(start<stop){if(start+4>stop)fail();const tag=u16(start),n=u16(start+2);if(tag===1||start+4+n>stop)fail();start+=4+n;}};
  for(let i=0;i<count;i++){
    if(cursor+46>end||u32(cursor)!==0x02014b50)fail();
    const flags=u16(cursor+8),method=u16(cursor+10),crc=u32(cursor+16),compressed=u32(cursor+20),length=u32(cursor+24),n=u16(cursor+28),x=u16(cursor+30),comment=u16(cursor+32),local=u32(cursor+42);
    if(cursor+46+n+x+comment>end||u16(cursor+34)||flags&~0x080e||![0,8].includes(method)||(u32(cursor+38)>>>16&0xf000)===0xa000)fail();
    const name=text.decode(bytes.subarray(cursor+46,cursor+46+n));
    if(!nameAllowed(name)||names.has(name)||length>(name.startsWith('images/')?limits.image:limits.json))fail();
    names.add(name);total+=length;if(total>limits.total)fail();extra(cursor+46+n,x);
    if(local+30>offset||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)fail();
    const ln=u16(local+26),lx=u16(local+28),start=local+30+ln+lx;
    if(start+compressed>offset||text.decode(bytes.subarray(local+30,local+30+ln))!==name)fail();extra(local+30+ln,lx);
    if(!(flags&8)&&(u32(local+14)!==crc||u32(local+18)!==compressed||u32(local+22)!==length))fail();
    if(method===0&&compressed!==length)fail();
    let finish=start+compressed;
    if(flags&8){if(finish+12>offset)fail();if(u32(finish)===0x08074b50)finish+=4;
      if(finish+12>offset||u32(finish)!==crc||u32(finish+4)!==compressed||u32(finish+8)!==length)fail();finish+=12;}
    entries.push({name,method,crc,compressed,length,start,local,finish});cursor+=46+n+x+comment;
  }
  if(cursor!==end||!names.has('manifest.json')||!names.has('data.json'))fail();
  let position=0;for(const e of [...entries].sort((a,b)=>a.local-b.local)){if(e.local!==position)fail();position=e.finish;}
  if(position!==offset)fail();return entries;
}

export async function readZip(bytes,limits=ZIP_LIMITS){
  const entries=zipDirectory(bytes,limits),files=Object.create(null);let actualTotal=0;
  for(const entry of entries){
    const input=bytes.subarray(entry.start,entry.start+entry.compressed);let output;
    if(entry.method===0)output=input;
    else{
      let stream;try{stream=new DecompressionStream('deflate-raw');}catch{throw new Error('このブラウザは圧縮ZIPに対応していません。元のBirthday Calendar Demoバックアップを使用してください。');}
      // native streamのbackpressureを利用し、宣言量を超えた時点で中断する。
      let inputOffset=0;
      const source=new ReadableStream({pull(controller){if(inputOffset===input.length){controller.close();return;}
        const end=Math.min(inputOffset+1024,input.length);controller.enqueue(input.subarray(inputOffset,end));inputOffset=end;}});
      const reader=source.pipeThrough(stream).getReader(),chunks=[];let size=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;
        if(size>entry.length||actualTotal+size>limits.total)fail();chunks.push(value);}
        if(size!==entry.length)fail();output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
    actualTotal+=output.length;
    if(output.length!==entry.length||actualTotal>limits.total||crc32(output)!==entry.crc)fail();files[entry.name]=output;
    // 大きな正常ZIPでもentryの間にUIへ制御を返す。
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  return files;
}
