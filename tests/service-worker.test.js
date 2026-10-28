import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('Service Worker更新は旧シェルだけ消し、サブパスのオフラインHTMLを返す', async () => {
  const old = 'birthday-calendar-demo-shell-%2Frepo%2F-aaaaaaaaaaaaaaaa';
  const current = 'birthday-calendar-demo-shell-%2Frepo%2F-bbbbbbbbbbbbbbbb';
  const otherSite = 'birthday-calendar-demo-shell-%2Fother%2F-cccccccccccccccc';
  const handlers = {}; const entries = new Map([[old, new Map()], [otherSite, new Map()], ['other-app', new Map()]]);
  const open = async (name) => ({
    addAll: async (urls) => { entries.set(name, new Map(urls.map((url) => [url, { body: 'cached' }]))); },
    match: async (url) => entries.get(name)?.get(url),
  });
  const caches = { open, keys: async () => [...entries.keys()], delete: async (name) => entries.delete(name) };
  let skipped = 0, workerInfo;
  const self = { registration: { scope: 'https://example.com/repo/' },
    location: { origin: 'https://example.com' }, clients: { claim: async () => {} },
    addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: () => { skipped++; } };
  const template = readFileSync(new URL('../src/sw-template.js', import.meta.url), 'utf8');
  const source = template.replace('__CACHE_VERSION__', 'bbbbbbbbbbbbbbbb')
    .replace('__APP_VERSION__', '1.1.0')
    .replace('__PRECACHE_JSON__', JSON.stringify(['./index.html', './assets/app.js']));
  runInNewContext(source, { self, caches, URL, fetch: async () => { throw new Error('offline'); },
    Response: { error: () => ({ body: 'error' }) } });
  let work;
  handlers.install({ waitUntil: (promise) => { work = promise; } }); await work;
  assert.equal(entries.get(current).has('https://example.com/repo/index.html'), true);
  handlers.activate({ waitUntil: (promise) => { work = promise; } }); await work;
  assert.deepEqual([...entries.keys()].sort(), [current, otherSite, 'other-app'].sort());
  handlers.message({ data:{ type:'CACHE_NAME' }, ports:[{ postMessage:(value) => { workerInfo = value; } }] });
  assert.deepEqual(JSON.parse(JSON.stringify(workerInfo)), { cacheName:current, appVersion:'1.1.0' });
  assert.equal(skipped, 0);
  handlers.message({ data:{ type:'SKIP_WAITING' } });
  assert.equal(skipped, 1);
  let response;
  handlers.fetch({ request: { method: 'GET', url: 'https://example.com/repo/', mode: 'navigate' },
    respondWith: (promise) => { response = promise; } });
  assert.equal((await response).body, 'cached');
  assert.equal(source.includes('indexedDB'), false);
});
