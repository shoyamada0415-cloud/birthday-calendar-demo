export const SHELL_PREFIX = 'birthday-calendar-demo-shell-';

export function obsoleteCacheNames(names, activeName, protectedNames = []) {
  const prefix = activeName?.match(/^(birthday-calendar-demo-shell-.+-)[0-9a-f]{16}$/)?.[1];
  return prefix ? names.filter((name) => name.startsWith(prefix)
    && name !== activeName && !protectedNames.includes(name)) : [];
}

async function workerCacheName(worker) {
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel(); const timer = setTimeout(() => resolve(null), 1200);
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data?.cacheName ?? null); };
    try { worker.postMessage({ type: 'CACHE_NAME' }, [channel.port2]); }
    catch { clearTimeout(timer); resolve(null); }
  });
}
async function activeCacheName() { return workerCacheName(navigator.serviceWorker?.controller); }

// 現在のアプリシェルと他アプリのCacheは保持し、IndexedDBには一切触れません。
export async function clearOldShellCaches() {
  if (!('caches' in globalThis)) return 0;
  const active = await activeCacheName();
  if (!active) return 0;
  const registration = await navigator.serviceWorker.getRegistration();
  // 待機中の新SWのキャッシュを消すと、オフライン更新が壊れるため保護する。
  const waiting = registration?.waiting;
  const waitingName = waiting ? await workerCacheName(waiting) : null;
  if (waiting && !waitingName) return 0;
  const obsolete = obsoleteCacheNames(await caches.keys(), active, waitingName ? [waitingName] : []);
  await Promise.all(obsolete.map((name) => caches.delete(name)));
  return obsolete.length;
}

export async function cacheBytes() {
  if (!('caches' in globalThis)) return null;
  const prefix = SHELL_PREFIX + encodeURIComponent(new URL('./', document.baseURI).pathname) + '-';
  let bytes = 0;
  for (const name of (await caches.keys()).filter((key) => key.startsWith(prefix))) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      bytes += (await response.clone().arrayBuffer()).byteLength;
    }
  }
  return bytes;
}
