import test from 'node:test';
import assert from 'node:assert/strict';
import { setupUpdates } from '../src/update.js';

test('更新待ちを延期し、利用者操作で1回だけ切替・再読込する。オフライン確認は通信しない', async () => {
  const names = ['navigator', 'document', 'location', 'localStorage', 'window'];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const node = () => ({ hidden:true, disabled:false, textContent:'', onclick:null });
  const elements = new Map(['update-banner','update-message','update-app','update-later']
    .map((name) => [name, node()]));
  const doc = new EventTarget(); doc.baseURI = 'https://example.com/repo/';
  doc.visibilityState = 'visible'; doc.getElementById = (name) => elements.get(name);
  const win = new EventTarget();
  const worker = new EventTarget(); worker.state = 'installed';
  const posts = []; worker.postMessage = (value) => posts.push(value);
  const registration = new EventTarget(); registration.waiting = worker;
  let checks = 0, reloads = 0;
  registration.update = async () => { checks++; };
  const serviceWorker = new EventTarget(); serviceWorker.controller = {};
  serviceWorker.register = async () => registration;
  const local = new Map();
  for (const [name, value] of Object.entries({
    navigator:{ serviceWorker, onLine:true }, document:doc,
    location:{ reload:() => { reloads++; } },
    localStorage:{ getItem:(key) => local.get(key), setItem:(key, value) => local.set(key, value) },
    window:win,
  })) Object.defineProperty(globalThis, name, { configurable:true, value });
  try {
    const manager = await setupUpdates({ t:(key) => key });
    assert.equal(elements.get('update-banner').hidden, false);
    await new Promise(setImmediate);
    assert.equal(checks, 1);
    await manager.check(); assert.equal(checks, 1);
    elements.get('update-later').onclick();
    assert.equal(elements.get('update-banner').hidden, true);
    manager.show(); assert.equal(elements.get('update-banner').hidden, true);
    navigator.onLine = false; await manager.check(); assert.equal(checks, 1);
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(elements.get('update-banner').hidden, false);
    assert.equal(checks, 1, 'オフライン復帰で通信しない');
    elements.get('update-later').onclick();
    manager.show(); assert.equal(elements.get('update-banner').hidden, true);
    win.dispatchEvent(new Event('pagehide'));
    win.dispatchEvent(new Event('pageshow'));
    assert.equal(elements.get('update-banner').hidden, false);
    elements.get('update-later').onclick();
    const replacement = new EventTarget(); replacement.state = 'installed';
    replacement.postMessage = (value) => posts.push(value);
    registration.waiting = replacement; registration.installing = replacement;
    registration.dispatchEvent(new Event('updatefound'));
    replacement.dispatchEvent(new Event('statechange'));
    assert.equal(elements.get('update-banner').hidden, false);
    elements.get('update-app').onclick();
    assert.equal(elements.get('update-message').textContent, 'updating');
    assert.deepEqual(posts, [{ type:'SKIP_WAITING' }]);
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    assert.equal(reloads, 1);
  } finally {
    for (const name of names) {
      const descriptor = originals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('初回インストールは更新扱いせず、既存activeとwaitingがあれば起動時に案内する', async () => {
  const names = ['navigator', 'document', 'location', 'localStorage', 'window'];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const elements = new Map(['update-banner','update-message','update-app','update-later']
    .map((name) => [name, { hidden:true, disabled:false, textContent:'', onclick:null }]));
  const doc = new EventTarget(); doc.baseURI = 'https://example.com/repo/';
  doc.visibilityState = 'visible'; doc.getElementById = (name) => elements.get(name);
  const waiting = new EventTarget(); waiting.state = 'installed'; waiting.postMessage = () => {};
  const registration = new EventTarget(); registration.waiting = waiting; registration.active = null;
  registration.update = async () => {};
  const serviceWorker = new EventTarget(); serviceWorker.controller = null;
  serviceWorker.register = async () => registration;
  for (const [name, value] of Object.entries({ navigator:{ serviceWorker, onLine:false },
    document:doc, location:{ reload:() => {} },
    localStorage:{ getItem:() => null, setItem:() => {} }, window:new EventTarget() })) {
    Object.defineProperty(globalThis, name, { configurable:true, value });
  }
  try {
    const manager = await setupUpdates({ t:(key) => key });
    assert.equal(elements.get('update-banner').hidden, true);
    registration.installing = waiting;
    registration.dispatchEvent(new Event('updatefound'));
    waiting.dispatchEvent(new Event('statechange'));
    assert.equal(elements.get('update-banner').hidden, true);
    registration.active = { scriptURL:'https://example.com/repo/old-sw.js' };
    manager.show();
    assert.equal(elements.get('update-banner').hidden, false);
    elements.get('update-later').onclick();
    assert.equal(elements.get('update-banner').hidden, true);
  } finally {
    for (const name of names) {
      const descriptor = originals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

async function withUpdateScreen(run, { controlled = true, online = true, update = async () => {} } = {}) {
  const names = ['navigator', 'document', 'location', 'localStorage', 'window'];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const ids = ['update-banner', 'update-message', 'update-app', 'update-later',
    'settings-update-status', 'settings-check-update', 'settings-apply-update'];
  const elements = new Map(ids.map((id) => [id, { hidden:true, disabled:false, textContent:'', onclick:null }]));
  const document = new EventTarget(); document.baseURI = 'https://example.com/repo/';
  document.visibilityState = 'visible'; document.getElementById = (id) => elements.get(id);
  const registration = new EventTarget(); registration.active = controlled ? {} : null;
  registration.waiting = null; registration.update = update;
  const serviceWorker = new EventTarget(); serviceWorker.controller = controlled ? {} : null;
  serviceWorker.register = async () => registration;
  let reloads = 0;
  const values = { document, navigator:{ serviceWorker, onLine:online },
    location:{ reload:() => { reloads++; } }, window:new EventTarget(),
    localStorage:{ getItem:() => null, setItem:() => {} } };
  for (const [name, value] of Object.entries(values))
    Object.defineProperty(globalThis, name, { configurable:true, value });
  try {
    const manager = await setupUpdates({ t:(key) => key });
    await run({ manager, elements, registration, serviceWorker, reloads:() => reloads });
  } finally {
    for (const name of names) {
      const descriptor = originals.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

test('設定から明示確認し、確認中・検出なし・更新発見を表示する。延期後も設定から更新できる', async () => {
  let finishCheck, checks = 0, posts = 0;
  await withUpdateScreen(async ({ manager, elements, registration, serviceWorker, reloads }) => {
    await new Promise(setImmediate);
    assert.equal(elements.get('settings-update-status').textContent, 'updateNoneFound');
    assert.equal(elements.get('settings-apply-update').hidden, true);
    const pending = manager.checkNow();
    assert.equal(elements.get('settings-update-status').textContent, 'updateChecking');
    assert.equal(elements.get('settings-check-update').disabled, true);
    finishCheck(); await pending;
    assert.equal(elements.get('settings-update-status').textContent, 'updateNoneFound');
    assert.equal(checks, 2, '手動確認は自動確認の6時間制限を受けない');
    const worker = new EventTarget(); worker.state = 'installed';
    worker.postMessage = () => { posts++; };
    registration.waiting = worker; registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    worker.dispatchEvent(new Event('statechange'));
    assert.equal(elements.get('settings-update-status').textContent, 'updateAvailable');
    assert.equal(elements.get('update-banner').hidden, false);
    elements.get('update-later').onclick();
    assert.equal(elements.get('update-banner').hidden, true);
    assert.equal(elements.get('settings-apply-update').hidden, false);
    elements.get('settings-apply-update').onclick();
    assert.equal(posts, 1);
    assert.equal(elements.get('settings-update-status').textContent, 'updateApplying');
    assert.equal(elements.get('settings-apply-update').disabled, true);
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    assert.equal(reloads(), 1);
    manager.refreshLanguage();
    assert.equal(elements.get('settings-update-status').textContent, 'updateApplying');
  }, { update:async () => { checks++; if (checks === 2) await new Promise((resolve) => { finishCheck = resolve; }); } });
});

test('設定の明示確認はオフライン・失敗を区別し、初回導入と自動切替を更新待ちと誤認しない', async () => {
  let checks = 0;
  await withUpdateScreen(async ({ manager, elements, registration, serviceWorker, reloads }) => {
    await new Promise(setImmediate);
    assert.equal(elements.get('settings-update-status').textContent, 'updateNotChecked');
    assert.equal(elements.get('update-banner').hidden, true);
    await manager.checkNow();
    assert.equal(elements.get('settings-update-status').textContent, 'updateOffline');
    assert.equal(checks, 0);
    navigator.onLine = true;
    await manager.checkNow();
    assert.equal(elements.get('settings-update-status').textContent, 'updateCheckFailed');
    assert.equal(checks, 1);
    serviceWorker.controller = {};
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    assert.equal(reloads(), 0, 'ブラウザ自身の切替を強制reloadしない');
    assert.equal(elements.get('settings-update-status').textContent, 'updateCheckFailed');
  }, { controlled:false, online:false, update:async () => { checks++; throw new Error('network'); } });
});
