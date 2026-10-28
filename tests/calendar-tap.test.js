import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarEvents} from '../src/model.js';
const app=readFileSync('src/app.js','utf8');
test('日付内のタップはセルの既存一覧処理へ集約する',()=>{
  const draw=app.slice(app.indexOf("const grid = $('calendar-grid');"),app.indexOf('function renderSelection()'));
  assert.match(draw,/cell\.addEventListener\('click', \(\) => openDayPeople\(events, month, day\)\)/);
  assert.doesNotMatch(draw,/openDetail\(|item\.addEventListener\('click'|more\.addEventListener\('click'/);
  assert.match(draw,/calendarEventList/);assert.doesNotMatch(draw,/cell\.append\(personMenuTrigger/);
});
test('日付一覧は空表示・追加導線・既存人物詳細行を再利用する',()=>{
  const draw=app.slice(app.indexOf('function openDayPeople('),app.indexOf('function reopenDay('));
  assert.match(draw,/if \(!events.length\).*t\('emptyDay'\)/);
  assert.match(draw,/makePersonRow\(entry.person/);assert.match(draw,/\$\('day-add'\)\.hidden = false/);
  const row=app.slice(app.indexOf('function makePersonRow('),app.indexOf('function renderHome('));assert.match(row,/openDetail\(person.id\)/);
});
test('一覧を閉じると元のスクロール位置へ戻しフォーム・ドラッグ遷移を妨げない',()=>{
  assert.match(app,/calendarDialogOrigin=\{x:window.scrollX,y:window.scrollY,month:state.month.toISOString\(\)/);
  assert.match(app,/document.querySelector\('dialog\[open\],\.drag-ghost'\)/);
  assert.match(app,/window.scrollTo\(\{left:origin.x,top:origin.y,behavior:'instant'\}\)/);
  assert.match(app,/focus\(\{preventScroll:true\}\)/);
});
test('同日複数人と複数種別を省略せず日付一覧へ渡す',()=>{
  const people=[{id:'a',anniversaries:[{type:'BIRTHDAY',month:5,day:10},{id:'ann-a',type:'CUSTOM',month:5,day:10}]},{id:'b',anniversaries:[{type:'BIRTHDAY',month:5,day:10}]}];
  const rows=calendarEvents(people,2028,5).get('2028-05-10');assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.person.id)).size,2);assert.ok(rows.some(r=>r.ann.id==='ann-a'));
});
