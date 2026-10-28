import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { APP_VERSION } from '../src/version.js';
import { verifyCalendarRegistration } from './calendar-registration-smoke.mjs';
import { verifyCalendarInteractions } from './calendar-interaction-smoke.mjs';
import { verifyDemoUI } from './demo-ui-smoke.mjs';
import { verifyDayListGestures } from './day-list-smoke.mjs';
import { verifyHome } from './home-smoke.mjs';
import { verifyBirthdayUI } from './birthday-ui-smoke.mjs';
import {verifyPersonActions} from './person-actions-smoke.mjs';
import {verifyRailManagement} from './rail-management-smoke.mjs';
import {verifyCalendarTaps} from './calendar-tap-smoke.mjs';
import {verifyRestoreLayout} from './restore-layout-smoke.mjs';
import {verifyBackupSecurity} from './backup-security-smoke.mjs';
import {verifyPrivacyGuidance} from './privacy-guidance-smoke.mjs';
import {enterBackupPassword} from './backup-password-smoke.mjs';

const prefix = '/birthday-calendar-demo/', root = resolve('dist');
const cachePrefix = `birthday-calendar-demo-shell-${encodeURIComponent(prefix)}-`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let serveUpdatedWorker = false;
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!path.startsWith(prefix) || path.includes('..')) return response.writeHead(404).end();
  const relative = path.slice(prefix.length) || 'index.html';
  const file = resolve(root, relative);
  if (!file.startsWith(root + '\\')) return response.writeHead(404).end();
  try { response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    const bytes = readFileSync(file);
    response.end(serveUpdatedWorker && relative === 'sw.js'
      ? Buffer.from(bytes.toString().replace(/CACHE_NAME = CACHE_PREFIX \+ '[a-f0-9]{16}'/,
        "CACHE_NAME = CACHE_PREFIX + 'ffffffffffffffff'")) : bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${server.address().port}${prefix}`;
const profile = mkdtempSync(join(tmpdir(), 'birthday-local-smoke-'));
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const errors = [], imageFailures = [], requests = [], pending = new Map(); let sequence = 0, socket, child, navigations = 0;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, label) { for (let i = 0; i < 100; i++) { try { if (await check()) return; } catch {}
  await sleep(150); } throw new Error(`${label}を待機できませんでした。`); }
async function command(method, params = {}) { const id = ++sequence;
  return new Promise((done, fail) => { pending.set(id, { done, fail }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const response = await command('Runtime.evaluate', {
  expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value; }
function check(value, message) { if (!value) throw new Error(message); }
try {
  check(existsSync(edge), 'Microsoft Edgeが見つかりません。');
  child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  await until(() => existsSync(join(profile, 'DevToolsActivePort')), 'Edge DevTools');
  const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((target) => target.type === 'page'); check(page, 'Page targetがありません。');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', fail, { once: true }); });
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data);
    if (message.method === 'Page.frameNavigated' && !message.params.frame.parentId) navigations++;
    if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task.fail(new Error(message.error.message)); else task.done(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      errors.push(`${message.params.entry.text} (${message.params.entry.url || 'unknown resource'})`);
    }
    if (message.method === 'Runtime.bindingCalled' && message.params.name === '__reportImageFailure') imageFailures.push(message.params.payload);
    if (message.method === 'Network.requestWillBeSent') {
      requests.push(message.params.request.url);
    }
  });
  for (const method of ['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable']) await command(method);
  await command('Runtime.addBinding', { name:'__reportImageFailure' });
  await command('Page.addScriptToEvaluateOnNewDocument', { source:`window.addEventListener('error',event=>{
    if(event.target instanceof HTMLImageElement)window.__reportImageFailure(JSON.stringify({src:event.target.src,
      parent:event.target.parentElement?.className,context:event.target.closest('[id]')?.id,connected:event.target.isConnected}));},true);` });
  await command('Page.navigate', { url: baseUrl });
  await until(() => evaluate('Boolean(document.querySelector("#home-today-date")?.dateTime)'), '初期ホーム');
  await until(() => evaluate('Boolean(navigator.serviceWorker.controller)'), '初回Service Worker制御');
  check(await evaluate('document.querySelector("#update-banner").hidden'),
    '初回インストールを更新と誤認しました。');
  const demoInitial=await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result));
    const people=await new Promise(done=>db.transaction('people').objectStore('people').getAll().onsuccess=e=>done(e.target.result));db.close();
    return {names:people.map(p=>p.displayName).sort(),databases:(await indexedDB.databases()).map(item=>item.name),caches:await caches.keys()};})()`);
  check(JSON.stringify(demoInitial.names)===JSON.stringify(['伊藤 あおい','佐藤 はるか','田中 みさき','鈴木 けんた','高橋 そうた'].sort()),'初回Demo人物5人が一致しません。');
  check(demoInitial.databases.includes('birthday-calendar-demo')&&!demoInitial.databases.includes('separate-production-app-local')
    &&demoInitial.caches.some(name=>name.startsWith('birthday-calendar-demo-shell-'))
    &&!demoInitial.caches.some(name=>name.startsWith('separate-production-app-shell-')),'本番版とDemo版の保存領域が分離されていません。');
  await evaluate(`(async()=>{const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction('people','readwrite'),store=tx.objectStore('people');
    store.getAll().onsuccess=e=>store.put({...e.target.result[0],memo:'再起動保持テスト'});await new Promise(done=>tx.oncomplete=done);db.close();})()`);
  await command('Page.reload');await until(()=>evaluate('Boolean(document.querySelector("#home-today-date")?.dateTime)'),'Demo再起動');
  check(await evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result.some(p=>p.memo==='再起動保持テスト'));};};})`),'再起動で編集内容が保持されません。');
  await evaluate(`window.__demoConfirm=window.confirm;window.confirm=()=>true;document.querySelector('#reset-demo-data').click()`);
  await until(()=>evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();q.onsuccess=()=>{db.close();done(q.result.length===5&&!q.result.some(p=>p.memo==='再起動保持テスト'));};};})`),'Demo初期化');
  await evaluate(`(async()=>{window.confirm=window.__demoConfirm;const r=indexedDB.open('birthday-calendar-demo'),db=await new Promise(done=>r.onsuccess=()=>done(r.result)),tx=db.transaction(['people','images','notifications'],'readwrite');
    for(const name of ['people','images','notifications'])tx.objectStore(name).clear();await new Promise(done=>tx.oncomplete=done);db.close();})()`);
  await command('Page.reload');await until(()=>evaluate('Boolean(document.querySelector("#home-today-date")?.dateTime)'),'空Demo再起動');
  check(await evaluate(`new Promise(done=>{const r=indexedDB.open('birthday-calendar-demo');r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').count();q.onsuccess=()=>{db.close();done(q.result===0);};};})`),'初期投入済みの空状態を通常再起動が上書きしました。');
  const distribution = await evaluate(`(async()=>{
    const manifestUrl=document.querySelector('link[rel=manifest]').href;
    const manifestResponse=await fetch(manifestUrl);
    const manifest=await manifestResponse.json();
    const resources=[...document.querySelectorAll('script[src],link[rel=stylesheet],link[rel=apple-touch-icon]')]
      .map(node=>node.src||node.href);
    resources.push(...manifest.icons.map(icon=>new URL(icon.src,manifestUrl).href));
    const statuses=await Promise.all(resources.map(async url=>(await fetch(url)).status));
    return {manifestStatus:manifestResponse.status,manifest,resources:resources.length,statuses};
  })()`);
  check(distribution.manifestStatus === 200 && distribution.manifest.id === './?app=birthday-calendar-demo' && distribution.manifest.start_url === './'
    && distribution.manifest.scope === './' && distribution.manifest.display === 'standalone'
    && distribution.statuses.every(status => status === 200), 'manifestまたは配布アセット取得に失敗しました。');
  const orientation = await evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;
    const context=canvas.getContext('2d');context.fillStyle='red';context.fillRect(0,0,40,40);
    context.fillStyle='blue';context.fillRect(40,0,40,40);
    const jpeg=new Uint8Array(await (await new Promise(done=>canvas.toBlob(done,'image/jpeg'))).arrayBuffer());
    const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,
      0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0]);
    const file=new Blob([jpeg.slice(0,2),exif,jpeg.slice(2)],{type:'image/jpeg'});
    const url=URL.createObjectURL(file),image=new Image();image.src=url;await image.decode();
    const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
    const result={image:[image.naturalWidth,image.naturalHeight],bitmap:[bitmap.width,bitmap.height]};
    bitmap.close();URL.revokeObjectURL(url);return result;
  })()`);
  check(orientation.image[0] === 40 && orientation.image[1] === 80
    && JSON.stringify(orientation.image) === JSON.stringify(orientation.bitmap),
    'EXIF Orientationのプレビュー/Canvas向きが一致しません。');
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();
    const input=document.querySelector('#language-choice');input.value='en';
    input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate('document.documentElement.lang === "en" && document.querySelector("#view-settings h1").textContent === "Settings & data"'), '英語切替');
  const english = await evaluate(`(() => ({lang:document.documentElement.lang,
    todayHeading:document.querySelector('#home-today-title').textContent,
    calendar:document.querySelector('#view-calendar h1').textContent,
    settings:document.querySelector('#view-settings h1').textContent,
    backup:document.querySelector('#backup-settings h2').textContent,
    form:document.querySelector('#person-form > label:nth-of-type(1)').textContent.trim(),
    crop:document.querySelector('#crop-title').textContent,
    version:document.querySelector('#app-version').textContent,
    category:document.querySelector('#calendar-category option[value=PET]').textContent,
    nav:[...document.querySelectorAll('[data-tab]')].map(node=>node.textContent.trim()),
    residual:[...document.querySelectorAll('body *')].filter(node=>node.children.length===0 && /[\u3040-\u30ff\u3400-\u9fff]/.test(node.textContent))
      .map(node=>[node.tagName,node.id||node.className,node.textContent.trim()]).slice(0,80),
    residualText:(()=>{const found=[],walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      while(walk.nextNode()){const node=walk.currentNode;
        if(node.parentElement?.closest('#language-choice'))continue;
        if(/[\u3040-\u30ff\u3400-\u9fff]/.test(node.textContent))
          found.push([node.parentElement?.tagName,node.parentElement?.id||node.parentElement?.className,node.textContent.trim()]);}
      return found.slice(0,80);})(),
  }))()`);
  check(english.todayHeading === "Today's events" && english.calendar === 'Birthday & anniversary calendar'
    && english.backup === 'Backup & restore' && english.form.startsWith('Display name')
    && english.crop === 'Adjust image' && english.version === APP_VERSION && english.category === 'Pet'
    && english.residualText.length === 0,
    `英語画面の翻訳が不足しています: ${JSON.stringify(english)}`);
  const updateEnglish = await evaluate(`({version:document.querySelector('#app-version-label').textContent,
    check:document.querySelector('#settings-check-update').textContent})`);
  check(updateEnglish.version === 'App version' && /^Check/.test(updateEnglish.check),
    `設定のVersion・更新操作が英語になりません: ${JSON.stringify(updateEnglish)}`);
  await evaluate('document.querySelector("#settings-check-update").click()');
  await until(() => evaluate('document.querySelector("#settings-update-status").textContent.includes("No available update")'),
    '設定からの明示更新確認');
  const transferEnglish = await evaluate(`(() => {document.querySelector('[data-transfer-route=pc-phone]').click();
    return {title:document.querySelector('#transfer-title').textContent,
      steps:document.querySelector('#transfer-steps').textContent,
      warning:document.querySelector('#transfer-replace').textContent,
      selected:document.querySelector('[data-transfer-route=pc-phone]').getAttribute('aria-pressed')};})()`);
  check(transferEnglish.title === 'Move data to another device'
    && transferEnglish.steps.includes('source PC') && transferEnglish.steps.includes('destination phone')
    && transferEnglish.warning.includes('replaced') && transferEnglish.selected === 'true',
    `端末移行の英語案内が不正です: ${JSON.stringify(transferEnglish)}`);
  await evaluate(`(()=>{document.querySelector('#people-add').click();
    document.querySelector('#add-anniversary').click();document.querySelector('#add-link').click();
    document.querySelector('#person-name').value='Validation';
    document.querySelector('#person-username').value='invalid!';
    const ann=document.querySelector('#anniversary-fields .repeat-row');
    const link=document.querySelector('#link-fields .repeat-row');
    window.__englishRepeat={ann:ann.textContent,link:link.textContent};
    ann.querySelector('button').click();link.querySelector('button').click();
    document.querySelector('#person-form').requestSubmit();})()`);
  check(await evaluate('window.__englishRepeat.ann.includes("Anniversary name") && window.__englishRepeat.link.includes("Label")'),
    '追加した記念日・関連URLの入力欄が英語になりません。');
  await until(() => evaluate('!document.querySelector("#person-error").hidden'), '英語バリデーション');
  check(await evaluate('document.querySelector("#person-error").textContent === "Invalid X username."'),
    '英語バリデーションエラーが表示されません。');
  await evaluate('document.querySelector("#person-dialog [data-close]").click()');
  await command('Page.reload');
  await until(() => evaluate('document.documentElement.lang === "en" && Boolean(document.querySelector("#home-today-date")?.dateTime)'), '英語設定保持');
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const input=document.querySelector('#language-choice');
    input.value='ja';input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-tab=home]').click();})()`);
  await until(() => evaluate('document.documentElement.lang === "ja"'), '日本語へ戻す');
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  const restoreLayout=await verifyRestoreLayout({evaluate,until,check,command,sleep});
  const backupSecurity=await verifyBackupSecurity({evaluate,until,check,command});
  const privacyGuidance=await verifyPrivacyGuidance({evaluate,until,check,command});
  const calendarTaps=await verifyCalendarTaps({evaluate,until,check,command,sleep});
  const calendarRegistration = await verifyCalendarRegistration({ evaluate, until, check });
  const demoFlow = await verifyDemoUI({evaluate,until,check,command,screenshot:async name=>{mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/${name}.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}});
  const calendarInteractions = await verifyCalendarInteractions({ evaluate, until, check, command, sleep,
    screenshot:async name=>{mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/${name}.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));} });
  const dayListGestures = await verifyDayListGestures({evaluate,until,check,command,sleep,
    screenshot:async name=>{mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/${name}.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}});
  const home = await verifyHome({evaluate,until,check,command,
    screenshot:async name=>{mkdirSync('test-artifacts',{recursive:true});writeFileSync(`test-artifacts/${name}.png`,Buffer.from((await command('Page.captureScreenshot',{format:'png'})).data,'base64'));}});
  const birthdayUI=await verifyBirthdayUI({evaluate,until,check,command});
  const personActions=await verifyPersonActions({evaluate,until,check,command,sleep});
  const railManagement=await verifyRailManagement({evaluate,until,check,command,sleep});
  await evaluate(`document.querySelector('[data-tab=calendar]').click();document.querySelector('.day-cell.today .day-open').click();`);
  mkdirSync('test-artifacts', { recursive:true });
  writeFileSync('test-artifacts/calendar-day-empty-390.png', Buffer.from((await command('Page.captureScreenshot', { format:'png' })).data, 'base64'));
  const dayAddPoint = await evaluate(`(()=>{const rect=document.querySelector('#day-add').getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`);
  await command('Emulation.setTouchEmulationEnabled', { enabled:true });
  await command('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[dayAddPoint] });
  await command('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await until(() => evaluate('document.querySelector("#person-dialog").open'), 'この日に登録の実タップ');
  await command('Emulation.setTouchEmulationEnabled', { enabled:false });
  writeFileSync('test-artifacts/calendar-day-form-390.png', Buffer.from((await command('Page.captureScreenshot', { format:'png' })).data, 'base64'));
  const formSizes = await evaluate(`(() => ({
    minimum: Math.min(...[...document.querySelectorAll('input:not([type=checkbox]):not([type=hidden]),select,textarea')]
      .map(node=>parseFloat(getComputedStyle(node).fontSize))),
    viewport: document.querySelector('meta[name=viewport]').content,
    width: document.documentElement.scrollWidth,
  }))()`);
  check(formSizes.minimum >= 16 && formSizes.width <= 390
    && !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(formSizes.viewport),
    'モバイルの入力文字サイズかピンチズーム設定が不適切です。');
  await evaluate(`(async () => { document.querySelector('#person-name').value='ブラウザ検証';
    const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=768;
    const context=canvas.getContext('2d');context.fillStyle='#d53b68';context.fillRect(0,0,1024,768);
    context.fillStyle='#35bf6f';context.fillRect(362,234,300,300);
    const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));
    const transfer=new DataTransfer(); transfer.items.add(new File([blob],'test.png',{type:'image/png'}));
    document.querySelector('#person-image').files=transfer.files;
    document.querySelector('#person-image').dispatchEvent(new Event('change',{bubbles:true}));
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).split('-');
    document.querySelector('#person-birth-month').value=Number(parts[1]);
    document.querySelector('#person-birth-day').value=Number(parts[2]); })()`);
  await until(() => evaluate('document.querySelector("#avatar-crop-dialog").open'), '画像トリミング画面');
  const cropMobile = await evaluate(`(() => {const dialog=document.querySelector('#avatar-crop-dialog');
    const rect=dialog.getBoundingClientRect();return {width:rect.width,left:rect.left,right:rect.right,
      viewport:document.querySelector('#crop-viewport').clientWidth,
      scroll:document.documentElement.scrollWidth};})()`);
  check(cropMobile.left >= 0 && cropMobile.right <= 390 && cropMobile.viewport > 200
    && cropMobile.scroll <= 390, '390pxでトリミング画面がはみ出しています。');
  mkdirSync('test-artifacts', { recursive: true });
  writeFileSync('test-artifacts/crop-390.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const cropPreview = await evaluate(`(() => {const img=document.querySelector('#crop-viewport .crop-image');
    const sample=document.createElement('canvas');sample.width=1;sample.height=1;
    sample.getContext('2d').drawImage(img,img.naturalWidth/2,img.naturalHeight/2,1,1,0,0,1,1);
    return {complete:img.complete,width:img.naturalWidth,height:img.naturalHeight,
      pixel:[...sample.getContext('2d').getImageData(0,0,1,1).data],blob:img.src.startsWith('blob:')};})()`);
  check(cropPreview.complete && cropPreview.blob && cropPreview.width === 1024
    && cropPreview.height === 768 && cropPreview.pixel[1] > cropPreview.pixel[0],
    '選択直後の画像プレビューが表示されていません。');
  const cropGesture = await evaluate(`(() => {const view=document.querySelector('#crop-viewport');
    const slider=document.querySelector('#crop-zoom');slider.value='2';slider.dispatchEvent(new Event('input',{bubbles:true}));
    const img=view.querySelector('img'),before=parseFloat(img.style.left),box=view.getBoundingClientRect();
    const point={bubbles:true,pointerId:7,clientX:box.left+box.width/2,clientY:box.top+box.height/2};
    view.dispatchEvent(new PointerEvent('pointerdown',point));
    view.dispatchEvent(new PointerEvent('pointermove',{...point,clientX:point.clientX+30}));
    view.dispatchEvent(new PointerEvent('pointerup',{...point,clientX:point.clientX+30}));
    const move=parseFloat(img.style.left)-before,first={...point,pointerId:8,clientX:point.clientX-50};
    const second={...point,pointerId:9,clientX:point.clientX+50};
    view.dispatchEvent(new PointerEvent('pointerdown',first));
    view.dispatchEvent(new PointerEvent('pointerdown',second));
    view.dispatchEvent(new PointerEvent('pointermove',{...first,clientX:first.clientX-20}));
    view.dispatchEvent(new PointerEvent('pointermove',{...second,clientX:second.clientX+20}));
    const pinchZoom=Number(slider.value);
    view.dispatchEvent(new PointerEvent('pointerup',first));view.dispatchEvent(new PointerEvent('pointerup',second));
    return {zoom:2,move,pinchZoom};})()`);
  check(Number(cropGesture.zoom) === 2 && cropGesture.move > 20 && cropGesture.pinchZoom > 2.5,
    'トリミングの移動・スライダー・ピンチ拡大ができません。');
  await evaluate('document.querySelector("#crop-confirm").click()');
  await until(() => evaluate('!document.querySelector("#avatar-crop-dialog").open'), 'トリミング確定');
  check(await evaluate('document.querySelector("#person-image-preview img").src.startsWith("blob:")'),
    '確定後の丸型プレビューがありません。');
  await evaluate(`(()=>{document.querySelector('#add-anniversary').click();
    const row=document.querySelector('#anniversary-fields .repeat-row');
    row.querySelector('.ann-title').value='出会った日';
    row.querySelector('.ann-month').value=document.querySelector('#person-birth-month').value;
    row.querySelector('.ann-day').value='15';row.querySelector('.ann-year').value='2024';
    row.querySelector('.ann-showAnniversary').checked=true;})()`);
  await evaluate('document.querySelector("#person-form").requestSubmit()');
  await until(() => evaluate('document.querySelector("#home-today")?.textContent.includes("ブラウザ検証")'), '人物登録');
  await until(() => evaluate('document.querySelector("#unread-badge")?.textContent === "1"'), '当日通知');
  await evaluate('document.querySelector("#bell").click()');
  await until(() => evaluate('document.querySelector("#notification-dialog").open'), '通知ダイアログ');
  check(await evaluate('document.querySelector("#notification-list").textContent.includes("ブラウザ検証")'), '通知に人物名がありません。');
  await evaluate('document.querySelector("#notification-dialog [data-close]").click()');
  await evaluate('document.querySelector("[data-tab=calendar]").click()');
  await until(() => evaluate('document.querySelector("#person-rail .avatar-person") !== null'), '人物レール');
  await evaluate(`(() => { const card=document.querySelector('#person-rail .avatar-person');
    const target=[...document.querySelectorAll('.day-cell')].find(x=>x.querySelector('.day-number').textContent==='15');
    const transfer=new DataTransfer(); transfer.setData('text/plain',card.dataset.personId);
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer})); })()`);
  await until(()=>evaluate('document.querySelector("#move-dialog").open'),'ドロップ日付の確認');
  await evaluate('document.querySelector("#move-confirm").click()');
  await until(()=>evaluate('!document.querySelector("#move-dialog").open'),'ドラッグ保存');
  await command('Page.reload');
  await until(() => evaluate('document.querySelector("#person-rail .avatar-person") !== null'), '再読み込み');
  const persisted = await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('people').objectStore('people').getAll();
      q.onsuccess=()=>resolve(q.result.map(p=>({name:p.displayName,birthday:p.anniversaries[0],anns:p.anniversaries})));};r.onerror=()=>reject(r.error);})`);
  check(persisted.length === 1 && persisted[0].birthday.day === 15
    && persisted[0].anns.length === 2 && persisted[0].anns[1].title === '出会った日',
  '再読み込み後に誕生日または記念日が残りません。');
  const image = await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('images').objectStore('images').getAll();
      q.onsuccess=async()=>{const bitmap=await createImageBitmap(q.result[0].blob);
        resolve({count:q.result.length,width:bitmap.width,height:bitmap.height,bytes:q.result[0].blob.size});};};
    r.onerror=()=>reject(r.error);})`);
  check(image.count === 1 && image.width === 512 && image.height === 512 && image.bytes <= 2 * 1024 * 1024,
    'トリミング画像が512px正方形で保存されていません。');
  const calendarAvatars = await evaluate(`(async()=>{document.querySelector('[data-tab=calendar]').click();
    const cell=[...document.querySelectorAll('.day-cell')].find(node=>node.querySelector('.day-number').textContent==='15');
    const images=[...cell.querySelectorAll('.calendar-event img')];await Promise.all(images.map(img=>img.decode()));
    window.__calendarOriginalUrl=images[0].src;window.__calendarRevoked=[];window.__calendarStaleRevokes=[];
    const revoke=URL.revokeObjectURL;window.__restoreCalendarRevoke=()=>{URL.revokeObjectURL=revoke;};
    URL.revokeObjectURL=function(url){window.__calendarRevoked.push(url);
      if([...document.querySelectorAll('main img,#notification-list img')].some(img=>img.src===url))window.__calendarStaleRevokes.push(url);
      return revoke.call(URL,url);};
    const first=images[0],fallback=first.parentElement;first.dispatchEvent(new Event('error'));
    const fallbackWorks=!fallback.querySelector('img') && fallback.textContent==='ブ';
    document.querySelector('#month-next').click();document.querySelector('#month-prev').click();
    const marks=[...document.querySelectorAll('.calendar-event .event-mark')].map(node=>node.textContent);
    const type=document.querySelector('#calendar-event-type');type.value='ANNIVERSARY';type.dispatchEvent(new Event('change'));
    marks.push(...[...document.querySelectorAll('.calendar-event .event-mark')].map(node=>node.textContent));
    type.value='ALL';type.dispatchEvent(new Event('change'));
    return {images:images.length,shared:images.every(img=>img.src===document.querySelector('#person-rail img').src),
      marks,fallbackWorks,
      nested:document.querySelectorAll('button button').length};})()`);
  check(calendarAvatars.images === 1 && calendarAvatars.shared && calendarAvatars.fallbackWorks
    && calendarAvatars.marks.includes('🎂') && calendarAvatars.marks.includes('🎉') && calendarAvatars.nested === 0,
    `カレンダー画像・共有URL・種別・代替表示に問題: ${JSON.stringify(calendarAvatars)}`);
  await evaluate('document.querySelector(".calendar-event").click()');
  check(await evaluate('document.querySelector("#detail-dialog").open && document.querySelectorAll("#detail-body .day-event-row").length>0 && !document.querySelector(".detail-top")'),
    '人物アイコンから日付一覧を開けません。');
  await evaluate('document.querySelector("#detail-body .day-event-row").click()');
  check(await evaluate('document.querySelector("#detail-dialog").open && document.querySelector(".detail-top h3").textContent === "ブラウザ検証"'),
    '日付一覧から既存の人物詳細を開けません。');
  await evaluate('document.querySelector("#detail-dialog [data-close]").click()');
  await evaluate(`(()=>{document.querySelector('[data-tab=people]').click();document.querySelector('#people-add').click();
    document.querySelector('#person-name').value='別カテゴリ';document.querySelector('#person-category').value='PET';
    document.querySelector('#person-birth-month').value='${persisted[0].birthday.month}';
    document.querySelector('#person-birth-day').value='15';
    for(const title of ['お迎え日','もう一つの記念日']){document.querySelector('#add-anniversary').click();
      const row=document.querySelector('#anniversary-fields .repeat-row:last-child');row.querySelector('.ann-title').value=title;
      row.querySelector('.ann-month').value='${persisted[0].birthday.month}';row.querySelector('.ann-day').value='15';}
    document.querySelector('#person-form').requestSubmit();})()`);
  await until(() => evaluate('document.querySelectorAll("#people-list .person-card").length === 2'), '同日2人の登録');
  const calendarFilter = await evaluate(`(()=>{document.querySelector('[data-tab=calendar]').click();
    const selector=document.querySelector('#calendar-category');
    const count=()=>{const cell=[...document.querySelectorAll('.day-cell')].find(x=>x.querySelector('.day-number').textContent==='15');
      return cell.querySelectorAll('.calendar-event').length+Number(cell.querySelector('.more')?.textContent.replace('+','')||0);};
    const all=count();selector.value='PET';selector.dispatchEvent(new Event('change',{bubbles:true}));const pet=count();
    selector.value='OTHER';selector.dispatchEvent(new Event('change',{bubbles:true}));const other=count();
    const type=document.querySelector('#calendar-event-type');type.value='ANNIVERSARY';
    type.dispatchEvent(new Event('change',{bubbles:true}));const otherAnn=count();
    type.value='BIRTHDAY';type.dispatchEvent(new Event('change',{bubbles:true}));const otherBirthday=count();
    type.value='ALL';type.dispatchEvent(new Event('change',{bubbles:true}));
    selector.value='ALL';selector.dispatchEvent(new Event('change',{bubbles:true}));
    return {all,pet,other,otherAnn,otherBirthday,reset:count(),scroll:document.documentElement.scrollWidth};})()`);
  check(calendarFilter.all === 5 && calendarFilter.pet === 3 && calendarFilter.other === 2
    && calendarFilter.otherAnn === 1 && calendarFilter.otherBirthday === 1
    && calendarFilter.reset === 5 && calendarFilter.scroll <= 390,
    `カレンダーカテゴリ絞り込みか同日複数人表示に失敗: ${JSON.stringify(calendarFilter)}`);
  const calendarOverflow = await evaluate(`(()=>{const cell=[...document.querySelectorAll('.day-cell')].find(node=>node.querySelector('.day-number').textContent==='15');
    const more=cell.querySelector('.more');const hidden=more?.textContent;more.click();
    const rows=[...document.querySelectorAll('#detail-body .item-row')];const titles=rows.map(node=>node.textContent);
    rows[rows.length-1].click();const detail=!!document.querySelector('.detail-top h3');
    document.querySelector('#detail-dialog [data-close]').click();cell.querySelector('.day-open').click();
    const viaDay=document.querySelectorAll('#detail-body .item-row').length;
    document.querySelector('#detail-dialog [data-close]').click();
    const category=document.querySelector('#calendar-category');category.value='PET';category.dispatchEvent(new Event('change'));
    const placeholder=[...document.querySelectorAll('.calendar-event .avatar')].every(node=>!node.querySelector('img') && node.textContent==='別');
    category.value='ALL';category.dispatchEvent(new Event('change'));
    return {hidden,total:rows.length,viaDay,detail,placeholder,titles};})()`);
  check(calendarOverflow.hidden === '+4' && calendarOverflow.total === 5 && calendarOverflow.viaDay === 5
    && calendarOverflow.detail && calendarOverflow.placeholder
    && calendarOverflow.titles.some(title=>title.includes('お迎え日'))
    && calendarOverflow.titles.some(title=>title.includes('もう一つの記念日')),
    `省略された同日予定・プレースホルダーに問題: ${JSON.stringify(calendarOverflow)}`);
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const select=document.querySelector('#language-choice');
    select.value='en';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate('document.documentElement.lang === "en"'), 'アイコンラベル英語');
  check(await evaluate(`[...document.querySelectorAll('.calendar-event')].every(node=>node.getAttribute('aria-label').startsWith('Open '))
    && document.querySelector('.day-cell .more').getAttribute('aria-label').includes('4 hidden events')`), 'カレンダー操作の英語ラベルが不正です。');
  await evaluate(`(()=>{const select=document.querySelector('#language-choice');select.value='ja';
    select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate('document.documentElement.lang === "ja"'), 'アイコンラベル日本語');
  const calendarReuse = await evaluate(`(()=>{document.querySelector('[data-tab=calendar]').click();
    let created=0,reads=0;const create=URL.createObjectURL,getAll=IDBObjectStore.prototype.getAll;
    URL.createObjectURL=function(blob){created++;return create.call(URL,blob);};
    IDBObjectStore.prototype.getAll=function(...args){if(this.name==='images')reads++;return getAll.apply(this,args);};
    const category=document.querySelector('#calendar-category');category.value='OTHER';category.dispatchEvent(new Event('change'));
    const before=document.querySelector('.calendar-event img').src;
    for(let i=0;i<6;i++){document.querySelector('#month-next').click();document.querySelector('#month-prev').click();
      document.querySelector('[data-tab=home]').click();document.querySelector('[data-tab=calendar]').click();}
    const after=document.querySelector('.calendar-event img').src;
    const stable=before===after;category.value='ALL';category.dispatchEvent(new Event('change'));
    URL.createObjectURL=create;IDBObjectStore.prototype.getAll=getAll;return {created,reads,stable};})()`);
  check(calendarReuse.created === 0 && calendarReuse.reads === 0 && calendarReuse.stable,
    `月移動で画像を再取得しています: ${JSON.stringify(calendarReuse)}`);
  const calendarGeometry = await evaluate(`(()=>{const grid=document.querySelector('#calendar-grid');
    const cells=[...grid.querySelectorAll('.day-cell')];const buttons=[...grid.querySelectorAll('.calendar-event')];
    const inside=buttons.every(button=>{const b=button.getBoundingClientRect(),c=button.closest('.day-cell').getBoundingClientRect();
      return b.left>=c.left && b.right<=c.right && b.top>=c.top && b.bottom<=c.bottom && b.height>=20;});
    const separate=cells.every(cell=>{const icon=cell.querySelector('.calendar-event')?.getBoundingClientRect(),more=cell.querySelector('.more')?.getBoundingClientRect();return !icon||!more||icon.right<=more.left;});
    const square=cells.every(cell=>{const box=cell.getBoundingClientRect();return Math.abs(box.width-box.height)<1;})
      &&buttons.every(button=>{const box=button.querySelector('.avatar').getBoundingClientRect();return box.width>=18 && Math.abs(box.width-box.height)<1;});
    return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,inside,separate,square,
      scroll:document.documentElement.scrollWidth};})()`);
  check(calendarGeometry.columns === 7 && calendarGeometry.inside && calendarGeometry.separate
    && calendarGeometry.square && calendarGeometry.scroll <= 390,
    `スマホのアイコン配置に問題: ${JSON.stringify(calendarGeometry)}`);
  const touchPoint = await evaluate(`(()=>{const button=document.querySelector('.calendar-event');button.scrollIntoView({block:'center'});
    const rect=button.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`);
  await command('Emulation.setTouchEmulationEnabled', { enabled:true });
  await command('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touchPoint] });
  await command('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
  await until(() => evaluate('document.querySelector("#detail-dialog").open && !!document.querySelector(".day-event-row") && !document.querySelector(".detail-top h3")'), 'アイコン実タップの日付一覧');
  await evaluate('document.querySelector("#detail-dialog [data-close]").click();window.scrollTo(0,0)');
  await command('Emulation.setTouchEmulationEnabled', { enabled:false });
  mkdirSync('test-artifacts', { recursive:true });
  writeFileSync('test-artifacts/calendar-icons-busy-390.png', Buffer.from((await command('Page.captureScreenshot', { format:'png' })).data, 'base64'));
  await evaluate(`(()=>{window.confirm=()=>true;document.querySelector('[data-tab=people]').click();
    [...document.querySelectorAll('#people-list .person-card')].find(x=>x.textContent.includes('別カテゴリ')).click();
    document.querySelector('#detail-edit').click();document.querySelector('#delete-person').click();})()`);
  await until(() => evaluate('document.querySelectorAll("#people-list .person-card").length === 1'), 'カテゴリ検証人物の削除');
  await evaluate('document.querySelector("[data-tab=calendar]").click()');
  await evaluate(`(async()=>{document.querySelector('#person-rail .avatar-person').click();
    document.querySelector('#detail-edit').click();
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;
    canvas.getContext('2d').fillStyle='blue';canvas.getContext('2d').fillRect(0,0,800,400);
    const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'new.png',{type:'image/png'}));
    document.querySelector('#person-image').files=transfer.files;
    document.querySelector('#person-image').dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate('document.querySelector("#avatar-crop-dialog").open'), '画像差し替えの調整画面');
  await evaluate('document.querySelector("#crop-cancel").click()');
  await until(() => evaluate('!document.querySelector("#avatar-crop-dialog").open'), '画像調整キャンセル');
  check(await evaluate('document.querySelector("#person-image-preview").textContent.includes("現在の画像")'),
    'キャンセル後に既存画像が残りません。');
  await evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;
    const context=canvas.getContext('2d');context.fillStyle='blue';context.fillRect(0,0,800,400);
    const blob=await new Promise(done=>canvas.toBlob(done,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'new.png',{type:'image/png'}));
    const input=document.querySelector('#person-image');input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate('document.querySelector("#avatar-crop-dialog").open'), '画像再選択');
  await evaluate('document.querySelector("#crop-confirm").click()');
  await until(() => evaluate('!document.querySelector("#avatar-crop-dialog").open'), '画像差し替え確定');
  await evaluate('document.querySelector("#person-form").requestSubmit()');
  await until(() => evaluate('document.querySelector("#toast").textContent.includes("更新しました")'), '画像差し替え');
  const replacement = await evaluate(`new Promise(resolve=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('images').objectStore('images').getAll();
      q.onsuccess=async()=>{const bitmap=await createImageBitmap(q.result[0].blob);
        resolve({count:q.result.length,width:bitmap.width,height:bitmap.height});};};})`);
  check(replacement.count === 1 && replacement.width === 512 && replacement.height === 512,
    '画像差し替えで旧画像が残ったか、新画像の縮小に失敗しました。');
  const calendarReplacement = await evaluate(`(async()=>{document.querySelector('[data-tab=calendar]').click();
    const img=document.querySelector('.calendar-event img');await img.decode();
    const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,1,1);
    return {changed:img.src!==window.__calendarOriginalUrl,oldRevoked:window.__calendarRevoked.includes(window.__calendarOriginalUrl),
      staleRevokes:window.__calendarStaleRevokes.length,
      pixel:[...ctx.getImageData(0,0,1,1).data]};})()`);
  check(calendarReplacement.changed && calendarReplacement.oldRevoked && calendarReplacement.staleRevokes === 0
    && calendarReplacement.pixel[2] > calendarReplacement.pixel[0],
    `画像変更がカレンダーに反映されません: ${JSON.stringify(calendarReplacement)}`);
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();
    const original=URL.createObjectURL;
    URL.createObjectURL=function(blob){if(blob.type==='application/octet-stream')window.__backup=blob;
      return original.call(URL,blob);};
    document.querySelector('#transfer-export').click();})()`);
  await enterBackupPassword({evaluate,until});
  await until(() => evaluate('window.__backup?.size > 0'), '画像を含むZIP書き出し');
  await evaluate(`(()=>{document.querySelector('[data-tab=calendar]').click();
    document.querySelector('#person-rail .avatar-person').click();
    document.querySelector('#detail-edit').click();document.querySelector('#person-remove-image').checked=true;
    document.querySelector('#person-form').requestSubmit();})()`);
  await until(() => evaluate('document.querySelector("#toast").textContent.includes("更新しました")'), '画像削除');
  const imagesAfterDelete = await evaluate(`new Promise(resolve=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('images').objectStore('images').getAll();
      q.onsuccess=()=>resolve(q.result.length);};})`);
  check(imagesAfterDelete === 0, '画像削除後に孤児画像が残っています。');
  check(await evaluate('document.querySelectorAll(".calendar-event img").length === 0 && [...document.querySelectorAll(".calendar-event .avatar")].every(node=>node.textContent === "ブ")'),
    '画像削除後のカレンダーがプレースホルダーへ戻りません。');
  check(await evaluate('window.__calendarStaleRevokes.length === 0'), '画面の参照中に画像URLを失効させています。');
  await evaluate('window.__restoreCalendarRevoke()');
  await evaluate(`(()=>{document.querySelector('[data-tab=people]').click();
    document.querySelector('.person-card').click();document.querySelector('#detail-edit').click();
    document.querySelector('#person-name').value='変更された名前';
    document.querySelector('#person-form').requestSubmit();})()`);
  await until(() => evaluate('document.querySelector(".person-card")?.textContent.includes("変更された名前")'), '復元前変更');
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();
    const input=document.querySelector('#import-backup');const transfer=new DataTransfer();
    transfer.items.add(new File([window.__backup],'backup.zip',{type:'application/zip'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await enterBackupPassword({evaluate,until},false);
  await until(() => evaluate('!document.querySelector("#restore-preview").hidden'), '暗号化バックアップ内容プレビュー');
  check(await evaluate(`document.querySelector('#restore-preview').textContent.includes('完全に置き換え')
    && document.querySelector('#restore-preview').textContent.includes('この端末に1人')`),
    '復元プレビューに完全置換と現在件数が示されません。');
  await evaluate(`(()=>{window.confirm=()=>false;
    document.querySelector('#restore-preview .primary').click();})()`);
  check(await evaluate('document.querySelector(".person-card")?.textContent.includes("変更された名前")'),
    '復元キャンセルで移行先データが変わりました。');
  await evaluate(`(()=>{let chosen=0;const input=document.querySelector('#import-backup');
    const original=input.click.bind(input);input.click=()=>{chosen++;};
    document.querySelector('#transfer-import').click();window.__transferChoose=chosen;input.click=original;})()`);
  check(await evaluate('window.__transferChoose === 1'), '端末移行の受取ボタンが既存のファイル選択を使いません。');
  await evaluate(`(()=>{window.confirm=()=>true;window.prompt=()=> '復元';
    document.querySelector('#restore-preview .primary').click();})()`);
  await until(() => evaluate('document.querySelector("#toast").textContent.includes("復元と画像整合性")'), 'ZIP復元');
  const restoredName = await evaluate(`new Promise(resolve=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('people').objectStore('people').getAll();
      q.onsuccess=()=>resolve(q.result[0].displayName);};})`);
  check(restoredName === 'ブラウザ検証', 'ZIP復元で元の人物名に戻りません。');
  const restoredImages = await evaluate(`new Promise(resolve=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('images').objectStore('images').count();
      q.onsuccess=()=>resolve(q.result);};})`);
  check(restoredImages === 1, 'ZIP復元でトリミング画像が戻りません。');
  await evaluate('document.querySelector("[data-tab=calendar]").click()');
  await until(() => evaluate('Boolean(navigator.serviceWorker.controller)'), 'Service Worker制御');
  await command('Emulation.clearDeviceMetricsOverride');
  await sleep(200);
  const pcDateRegistration = await evaluate(`(()=>{const cell=[...document.querySelectorAll('.day-cell')].find(node=>node.querySelector('.day-number').textContent==='1');
    cell.querySelector('.day-open').click();const list=document.querySelector('#detail-dialog').open && !document.querySelector('#day-add').hidden;
    document.querySelector('#day-add').click();const form=document.querySelector('#person-birth-day').value==='1'
      && document.querySelector('#person-birth-year').value==='' && document.querySelectorAll('dialog[open]').length===1;
    document.querySelector('#person-dialog [data-close]').click();return {list,form};})()`);
  check(pcDateRegistration.list && pcDateRegistration.form, 'PCの日付一覧→登録フォーム遷移が不正です。');
  const pc = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,sw:!!navigator.serviceWorker.controller,
    avatar:document.querySelector('.calendar-event .avatar').getBoundingClientRect().width,
    names:getComputedStyle(document.querySelector('.calendar-event .event-name')).display!=='none'})`);
  check(pc.avatar >= 28 && !pc.names, 'PC正方形カレンダーのアイコン表示が不正です。');
  mkdirSync('test-artifacts', { recursive: true });
  writeFileSync('test-artifacts/pc.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(350);
  const mobile = await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,nav:!!document.querySelector(".bottom-nav").getClientRects().length})');
  writeFileSync('test-artifacts/mobile-390.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const mobileViews = await evaluate(`(() => ['home','calendar','people','birthdays','settings'].map(tab=>{
    document.querySelector('[data-tab='+tab+']').click();
    return {tab,scroll:document.documentElement.scrollWidth};}))()`);
  writeFileSync('test-artifacts/settings-390.png', Buffer.from((await command('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  check(pc.scroll <= pc.width && mobile.scroll <= mobile.width && mobile.nav
    && mobileViews.every(view => view.scroll <= 390), '横スクロールまたはモバイルナビ問題');
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();
    document.querySelector('#notification-settings [name=seven]').checked=false;
    document.querySelector('#notification-settings').requestSubmit();
    const input=document.querySelector('#language-choice');input.value='en';
    input.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('[data-tab=calendar]').click();})()`);
  await until(() => evaluate('document.documentElement.lang === "en"'), '更新前の英語設定');
  await evaluate(`(()=>{const theme=document.querySelector('#theme-choice');theme.value='dark';theme.dispatchEvent(new Event('change'));})()`);
  await until(()=>evaluate('document.documentElement.dataset.theme==="dark"'),'更新前のダーク設定');
  serveUpdatedWorker = true;
  await evaluate(`(async()=>{const registration=await navigator.serviceWorker.getRegistration();
    await registration.update();})()`);
  await until(() => evaluate('!document.querySelector("#update-banner").hidden'), '更新案内');
  check(await evaluate('document.querySelector("#update-message").textContent.includes("update")'),
    '更新案内が英語表示ではありません。');
  await evaluate('document.querySelector("#update-later").click()');
  check(await evaluate('document.querySelector("#update-banner").hidden && !!document.querySelector("#person-rail .avatar-person")'),
    'あとでを選択した後に通常利用できません。');
  await evaluate('document.querySelector("[data-tab=settings]").click()');
  check(await evaluate(`!document.querySelector("#settings-apply-update").hidden
    && document.querySelector("#settings-update-status").textContent.includes("update")`),
    '延期後の設定画面に待機中更新が表示されません。');
  await evaluate(`(()=>{window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));})()`);
  check(await evaluate('!document.querySelector("#update-banner").hidden'),
    '同じdocumentでPWAを再開した際に待機中の更新案内が戻りません。');
  await evaluate('document.querySelector("#update-later").click()');
  check(await evaluate('document.querySelector("#update-banner").hidden'),
    '再度「あとで」を押した同一前面セッションで案内が残っています。');
  const waitingCache = await evaluate('caches.keys()');
  check(waitingCache.filter(name => name.startsWith(cachePrefix)).length === 2,
    '新旧キャッシュが更新待ち中に揃っていません。');
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();
    document.querySelector('#clear-cache').click();})()`);
  await sleep(200);
  check((await evaluate('caches.keys()')).includes(`${cachePrefix}ffffffffffffffff`),
    'キャッシュ整理で更新待ちの新キャッシュが消えました。');
  await command('Page.reload');
  await until(() => evaluate('!document.querySelector("#update-banner").hidden && document.documentElement.lang === "en"'), '更新案内の再表示');
  const beforeUpdateNavigations = navigations;
  const updatingLabel = await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();
    document.querySelector('#settings-apply-update').click();
    return document.querySelector('#settings-update-status').textContent;})()`);
  check(updatingLabel.includes('Updating'), '更新中の表示がありません。');
  await until(() => navigations > beforeUpdateNavigations, '更新後reload');
  await until(() => evaluate('Boolean(navigator.serviceWorker.controller) && document.querySelector("#person-rail .avatar-person") !== null'), '更新後再起動');
  await sleep(500);
  check(navigations - beforeUpdateNavigations === 1,
    `更新後reload回数が不正です: ${navigations-beforeUpdateNavigations} (before ${beforeUpdateNavigations}, after ${navigations})`);
  const updateReloads = navigations - beforeUpdateNavigations;
  const scopeCachePrefix = cachePrefix;
  await until(async () => (await evaluate('caches.keys()'))
    .filter(name => name.startsWith(scopeCachePrefix)).length === 1, '旧キャッシュ削除');
  const cachesAfterUpdate = await evaluate('caches.keys()');
  check(cachesAfterUpdate.filter(name => name.startsWith(scopeCachePrefix)).length === 1
    && cachesAfterUpdate.includes(`${scopeCachePrefix}ffffffffffffffff`),
    `更新後の旧キャッシュ清掃に失敗しました: ${JSON.stringify(cachesAfterUpdate)}`);
  const peopleAfterUpdate = await evaluate(`new Promise(resolve=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('people').objectStore('people').count();
      q.onsuccess=()=>resolve(q.result);};})`);
  check(peopleAfterUpdate === 1, 'Service Worker更新で人物データが失われました。');
  const imagesAfterUpdate = await evaluate(`new Promise(resolve=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const q=r.result.transaction('images').objectStore('images').count();
      q.onsuccess=()=>resolve(q.result);};})`);
  check(imagesAfterUpdate === 1, 'Service Worker更新でプロフィール画像が失われました。');
  const settingsAfterUpdate = await evaluate(`new Promise(resolve=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const tx=r.result.transaction('settings');const notices=tx.objectStore('settings').get('notifications');
      const language=tx.objectStore('settings').get('language'),theme=tx.objectStore('settings').get('appearance');tx.oncomplete=()=>resolve({seven:notices.result.value.seven,
        language:language.result.value,htmlLang:document.documentElement.lang,theme:theme.result.value.theme});};})`);
  check(settingsAfterUpdate.seven === false && settingsAfterUpdate.language === 'en' && settingsAfterUpdate.htmlLang === 'en' && settingsAfterUpdate.theme==='dark',
    'Service Worker更新後に通知設定か言語設定が失われました。');
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await command('Page.reload');
  await until(() => evaluate('document.querySelector("#person-rail .avatar-person") !== null'), 'オフライン起動');
  check(await evaluate('document.documentElement.dataset.theme==="dark"'),'オフラインでもダーク設定保持');
  check(await evaluate(`(async()=>{const images=[...document.querySelectorAll('.calendar-event img')];
    await Promise.all(images.map(img=>img.decode()));return images.length===1 && images.every(img=>img.naturalWidth===512);})()`),
    'オフラインでカレンダーのプロフィール画像を表示できません。');
  check(await evaluate(`(()=>{document.querySelector('[data-tab=calendar]').click();document.querySelector('.day-open').click();
    document.querySelector('#day-add').click();const valid=document.querySelector('#person-dialog').open
      && document.querySelector('#person-birth-day').value==='1' && document.querySelector('#person-birth-year').value==='';
    document.querySelector('#person-dialog [data-close]').click();return valid;})()`), 'オフラインの日付から登録できません。');
  await evaluate('document.querySelector("[data-tab=settings]").click()');
  await evaluate('document.querySelector("#settings-check-update").click()');
  check(await evaluate('document.querySelector("#settings-update-status").textContent.includes("offline")'),
    '設定のオフライン更新確認が区別されません。');
  check(errors.length === 0, `ブラウザエラー: ${errors.join(' | ')} ${imageFailures.join(' | ')}`);
  const externalRequests = requests.filter(url => !url.startsWith(baseUrl)
    && !url.startsWith('blob:') && !url.startsWith('data:'));
  check(externalRequests.length === 0, `外部通信がありました: ${JSON.stringify(externalRequests)}`);
  console.log(JSON.stringify({ baseUrl, people: persisted.length, birthdayDay: persisted[0].birthday.day,
    notifications: 1, formSizes, cropMobile, cropPreview, cropGesture, image, replacement, imagesAfterDelete,
    restoredName, restoredImages, offline: true, pc, mobile, calendarFilter,
    mobileViews, distribution, orientation, english, peopleAfterUpdate, imagesAfterUpdate, cachesAfterUpdate,
    calendarAvatars,calendarOverflow,calendarReuse,calendarReplacement,calendarGeometry,calendarRegistration,calendarInteractions,pcDateRegistration,demoFlow,
    waitingCache, settingsAfterUpdate, updateReloads,dayListGestures,home,birthdayUI,personActions,railManagement,calendarTaps,restoreLayout,
    backupSecurity,privacyGuidance,consoleErrors: errors.length, externalRequests: externalRequests.length }));
} finally {
  socket?.close(); child?.kill(); server.close();
  if (profile.startsWith(resolve(tmpdir()) + '\\') && profile.includes('birthday-local-smoke-')) {
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
