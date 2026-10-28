import {DB_NAME,STORES,openDatabase} from './db.js';

export const RETIRED_KEY='birthday-calendar-demo-retired';
export const SESSION_LOCK='birthday-calendar-demo-session:'+DB_NAME;
const UPDATE_KEY='birthday-calendar-demo-last-update-check';
export function isRetired(storage=globalThis.localStorage){try{return Boolean(storage?.getItem(RETIRED_KEY));}catch{return false;}}

// New tabs share this lock for their entire lifetime. Erasure requires exclusivity.
// Legacy tabs are additionally checked through the current SW before any deletion.
export async function startDataSession(locks=globalThis.navigator?.locks){
  let release,held,ended=false;
  if(!locks)return {exclusive:async()=>{throw new Error('deleteUnavailable');}};
  async function acquire(){let ready,failed;const started=new Promise((r,j)=>{ready=r;failed=j;});held=locks.request(SESSION_LOCK,{mode:'shared'},()=>{ready();return new Promise(r=>release=r);});held.catch(failed);await started;}
  await acquire();
  return {async exclusive(operation){release();await held;
    try{return await locks.request(SESSION_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
      if(!lock)throw new Error('deleteOtherWindows');
      const result=await operation(()=>{ended=true;});return result;
    });}finally{if(!ended)await acquire();}
  }};
}
function workerMessage(worker,type){
  return new Promise((resolve,reject)=>{
    if(!worker){reject(new Error('deleteUnavailable'));return;}
    const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();channel.port2.close();reject(new Error('deleteUnavailable'));},2000);
    channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(e.data);};
    try{worker.postMessage({type},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();reject(new Error('deleteUnavailable'));}
  });
}
export function ownedCacheNames(names,scope){
  const prefix='birthday-calendar-demo-shell-'+encodeURIComponent(new URL(scope).pathname)+'-';
  return names.filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{16}$/.test(name.slice(prefix.length)));
}
export async function clearManagedRecords(db){
  const tx=db.transaction(STORES,'readwrite');
  const done=new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('deleteRecordsFailed'));tx.onerror=()=>{};});
  try{for(const name of STORES)tx.objectStore(name).clear();
    for(const name of STORES)tx.objectStore(name).count().onsuccess=e=>{if(e.target.result!==0)tx.abort();};
    await done;
  }catch(error){try{tx.abort();}catch{/* already complete */}await done.catch(()=>{});throw error;}
}
export async function eraseManagedData(db,{scope=new URL('./',document.baseURI).href,onStop=()=>{},markEnded=()=>{},
  nav=navigator,cacheStorage=globalThis.caches,storage=localStorage,session=globalThis.sessionStorage,open=openDatabase}={}){
  const expected=new URL('sw.js',scope).href;
  const registration=await nav.serviceWorker?.getRegistration(scope);
  if(registration){
    if(registration.scope!==scope||nav.serviceWorker.controller?.scriptURL!==expected)throw new Error('deleteUnavailable');
    const windows=await workerMessage(nav.serviceWorker.controller,'BIRTHDAY_DEMO_WINDOWS');
    if(windows?.otherWindows!==0)throw new Error('deleteOtherWindows');
  }else if(!isRetired(storage))throw new Error('deleteUnavailable');
  // Failure to persist the guard means deletion must not start.
  storage.setItem(RETIRED_KEY,'pending');if(storage.getItem(RETIRED_KEY)!=='pending')throw new Error('deleteUnavailable');
  markEnded();onStop();db?.close();
  const report={dataDeleted:false,cachesDeleted:false,workerRemoved:false,preferencesDeleted:false};
  let cleanupDB;
  try{
    cleanupDB=await open();await clearManagedRecords(cleanupDB);report.dataDeleted=true;
  }catch{/* Atomic clear failure is not success; keep guard and allow explicit retry. */}
  finally{cleanupDB?.close();}
  if(!report.dataDeleted){storage.setItem(RETIRED_KEY,'partial');return {...report,complete:false};}
  // Stop our exact registration's workers before cache deletion; no origin-wide cleanup.
  try{
    for(const worker of new Set([registration?.active,registration?.waiting,registration?.installing].filter(Boolean))){
      if(worker.scriptURL!==expected)throw new Error();
      const reply=await workerMessage(worker,'BIRTHDAY_DEMO_STOP');if(reply?.stopped!==true)throw new Error();
    }
    report.workerRemoved=registration?await registration.unregister():true;
    if(cacheStorage){for(const name of ownedCacheNames(await cacheStorage.keys(),scope))await cacheStorage.delete(name);
      report.cachesDeleted=ownedCacheNames(await cacheStorage.keys(),scope).length===0;
    }else report.cachesDeleted=true;
  }catch{/* Report partial completion rather than claiming complete removal. */}
  try{storage.removeItem(UPDATE_KEY);session?.removeItem(UPDATE_KEY);report.preferencesDeleted=storage.getItem(UPDATE_KEY)===null&&(!session||session.getItem(UPDATE_KEY)===null);}catch{}
  const complete=Object.values(report).every(Boolean);
  storage.setItem(RETIRED_KEY,complete?'done':'partial');
  return {...report,complete};
}
