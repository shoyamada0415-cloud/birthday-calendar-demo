import './style.css';
import './crop.css';
import './demo.css';
import './home.css';
import './fonts.css';
import './date-fields.css';
import {setupMonthDay,setupBirthYear} from './date-fields.js';
import { openDatabase, all, get, savePerson, deletePerson, deletePeople, loadSettings, saveSettings,
  markNotificationRead, markAllRead, storageSummary, loadLanguage, saveLanguage } from './db.js';
import { CATEGORIES, birthdayOf, birthdayRows, anniversaryYears,
  occurrenceForYear, calendarEvents, filterPeople, tokyoToday } from './model.js';
import { synchronizeNotifications } from './notifications.js';
import { setupAvatarEditor } from './avatar-editor.js';
import { createBackup, inspectBackup, restoreBackup } from './backup.js';
import {encryptBackup,decryptBackup,isEncryptedBackup} from './encrypted-backup.js';
import {askBackupPassword} from './password-dialog.js';
import {isRetired,startDataSession,eraseManagedData,RETIRED_KEY} from './data-lifecycle.js';
import {setupExitUI,refreshExitGuide,showStopped} from './exit-ui.js';
import { clearOldShellCaches, cacheBytes } from './cache-ops.js';
import { t, setLanguage, currentLanguage, applyStaticTranslations, categoryLabel,
  anniversaryLabel, monthLabel, dayLabel, errorText } from './i18n.js';
import { setupUpdates } from './update.js';
import { APP_VERSION } from './version.js';
import { eventKey, movedPerson, birthdayAssignedPerson } from './calendar-move.js';
import {setupPersonMenu} from './person-menu.js';
import { setupCalendarGestures } from './calendar-gestures.js';
import { loadAppearance, saveAppearance } from './db.js';
import { DEFAULT_APPEARANCE, applyAppearance } from './appearance.js';
import { setupSettingsSections, setupOutlineIcons } from './settings-ui.js';
import { reorderDayEvents } from './db.js';
import { entryId } from './calendar-order.js';
import { homeOverview } from './home.js';
import {RAIL_SORTS,sortedRailPeople} from './rail-management.js';
import {ensureDemoData,resetDemoData} from './demo-data.js';

const $ = (id) => document.getElementById(id);
let avatarEditor, updates, gestures, personMenu, railMenu, birthDateFields, birthYearFields, pendingMove = null, moveSaving = false;
let calendarDialogOrigin=null;
let restoreBusy=false;
let exportBusy=false;
let deletionBusy=false;
let dataSession;
const compactCalendar = window.matchMedia('(max-width:520px)');
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
let appearance = { ...DEFAULT_APPEARANCE };
const state = { db: null, people: [], images: new Map(), notices: [], settings: null,
  today: tokyoToday(), month: null, selectedPersonId: null, detailPersonId: null, detailDay:null, formCalendarDate:null,
  railFilter: 'all', transferRoute: 'phone-pc', preparedBackup: null, selectionEvent:null,
  railSort:'nameAsc',railSortOpen:false,railBulk:false,railSelected:new Set(),railDeleting:false };
const [todayYear, todayMonth] = state.today.split('-').map(Number);
state.month = new Date(Date.UTC(todayYear, todayMonth - 1, 1));

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = String(content);
  return node;
}
function empty(container, message) { container.replaceChildren(el('div', 'empty', message)); }
function toast(message) { const node = $('toast'); node.textContent = message; node.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 4200); }
function avatar(person, large = false) {
  const node = el('span', `avatar${large ? ' large' : ''}`, person.displayName.slice(0, 1));
  const url = state.images.get(person.id);
  if (url) { const img = el('img'); img.alt = '';
    img.addEventListener('error', () => { node.textContent = person.displayName.slice(0, 1); }, { once:true });
    img.src = url; node.replaceChildren(img); }
  return node;
}
function birthdayText(person) { const b = birthdayOf(person); return b ? t('dateDay', { month:b.month, day:b.day }) : t('birthdayUnregistered'); }
function formatDays(days) { return days === 0 ? t('daysToday') : days === 1 ? t('daysTomorrow') : t('daysUntil', { days }); }
function byId(id) { return state.people.find((person) => person.id === id); }
function eventTitle(ann) { return ann.title || anniversaryLabel(ann.type); }
function anniversaryText(ann, date) { const years = anniversaryYears(ann, date);
  return `${eventTitle(ann)}${years ? ` · ${t('anniversaryYears', { years })}` : ''}`; }

async function refresh() {
  if(state.ending)return;
  gestures?.cancel();
  const [people, images] = await Promise.all([all(state.db, 'people'), all(state.db, 'images')]);
  const previousImages = state.images;
  state.people = people;
  state.images = new Map(images.map((image) => [image.personId, URL.createObjectURL(image.blob)]));
  const notifications = await synchronizeNotifications(state.db, state.today);
  state.notices = notifications.notifications; state.settings = notifications.settings;
  $('unread-badge').textContent = notifications.unread;
  $('unread-badge').hidden = notifications.unread === 0;
  renderHome(); renderCalendar(); renderPeople(); renderBirthdays(); renderNotifications(); renderSettings();
  // 古い画像が画面に残ったまま失効しないよう、DOMを差し替えてから解放する。
  for (const url of previousImages.values()) URL.revokeObjectURL(url);
}

function switchTab(tab) {
  personMenu?.close(false);
  railMenu?.close(false);
  if(tab!=='calendar'&&state.railBulk&&!state.railDeleting){state.railBulk=false;state.railSelected.clear();$('rail-error').hidden=true;renderCalendar();}
  gestures?.cancel();
  if (!['home', 'calendar', 'people', 'birthdays', 'settings'].includes(tab)) tab = 'home';
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `view-${tab}`;
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false');
  }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  if (tab === 'settings') renderStorageStats();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function makePersonRow(person, subtitle, right = '') {
  const button = el('button', 'item-row'); button.type = 'button';
  button.append(avatar(person));
  const body = el('span', 'item-row-main'); body.append(el('strong', '', person.displayName), el('small', '', subtitle));
  button.append(body);
  if (right) button.append(el('span', 'pill', right));
  button.addEventListener('click', () => openDetail(person.id));
  return button;
}

function renderHome() {
  const overview=homeOverview(state.people,state.today);
  const time=$('home-today-date');time.dateTime=state.today;
  time.textContent=new Intl.DateTimeFormat(currentLanguage()==='ja'?'ja-JP':'en-US',{
    month:'short',day:'numeric',weekday:'short',timeZone:'UTC',
  }).format(new Date(`${state.today}T00:00:00Z`));
  const show=(id,rows,message)=>$(id).replaceChildren(...(rows.length?rows:[el('p','home-empty',message)]));
  show('home-today',overview.today.map(entry=>makePersonRow(entry.person,
    entry.ann.type==='BIRTHDAY'?t('birthday'):anniversaryText(entry.ann,entry.date))),t('noTodayEvents'));
  const birthdayRow=row=>makePersonRow(row.person,
    t('dateDay',{month:Number(row.nextDate.slice(5,7)),day:Number(row.nextDate.slice(8,10))}),formatDays(row.daysUntil));
  show('home-next',overview.nextBirthdays.map(birthdayRow),t('noNext'));
  show('home-upcoming',overview.upcoming.map(birthdayRow),t('noUpcoming'));
  show('home-anniversaries',overview.anniversaries.map((row) => makePersonRow(row.person,
    `${t('dateDay', { month:Number(row.nextDate.slice(5, 7)), day:Number(row.nextDate.slice(8, 10)) })}`
      + ` · ${anniversaryText(row.ann, row.nextDate)}`,
    formatDays(row.daysUntil))),t('noOtherUpcoming'));
}

function renderCalendar() {
  personMenu?.close(false);
  railMenu?.close(false);
  gestures?.cancel();
  const year = state.month.getUTCFullYear(), month = state.month.getUTCMonth() + 1;
  $('month-title').textContent = t('dateMonth', { year, month });
  renderSelection();
  const railPeople = state.railFilter === 'unregistered'
    ? state.people.filter((person) => !birthdayOf(person)) : state.people;
  $('rail-count').textContent = t('peopleCount', { count:railPeople.length });
  renderRailManagement();
  if (!railPeople.length) empty($('person-rail'), t('noPeople'));
  else $('person-rail').replaceChildren(...sortedRailPeople(railPeople,state.railSort,state.today,currentLanguage())
    .map((person) => {
      if(state.railBulk){const label=el('label','avatar-person bulk-person'),check=el('input');check.type='checkbox';check.checked=state.railSelected.has(person.id);check.disabled=state.railDeleting;check.dataset.bulkPersonId=person.id;
        check.setAttribute('aria-label',t('selectPerson',{name:person.displayName}));
        check.onchange=()=>{if(check.checked)state.railSelected.add(person.id);else state.railSelected.delete(person.id);renderRailManagement();};
        label.append(check,avatar(person),el('small','',person.displayName));return label;}
      const button = el('button', `avatar-person${birthdayOf(person) ? ' registered' : ''}${state.selectedPersonId === person.id ? ' selected' : ''}`);
      button.type = 'button'; button.draggable = false; button.dataset.personId = person.id;
      button.title = t('railTitle', { name:person.displayName });
      button.append(avatar(person), el('small', '', person.displayName));
      button.setAttribute('aria-pressed', String(state.selectedPersonId === person.id));
      button.addEventListener('click', () => openDetail(person.id));
      button.addEventListener('dragstart',event=>event.preventDefault());
      const wrap=el('div','person-action-wrap rail-action-wrap');wrap.append(button,personMenuTrigger(person));return wrap;
    }));
  const grid = $('calendar-grid'); grid.replaceChildren();
  for (let day = 0; day < 7; day++) grid.append(el('div', 'weekday', t(`day${day}`)));
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  for (let i = 0; i < firstWeekday; i++) grid.append(el('div', 'day-spacer'));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // 人物を月ごとに一度だけ集計し、31日×人数の繰り返し走査を避ける。
  const byDay = calendarEvents(state.people, year, month,
    $('calendar-category').value, $('calendar-event-type').value);
  for (let day = 1; day <= last; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const events = byDay.get(date) ?? [];
    // 日付・人物は別ボタンのまま、クリックは日付セルへ集約する（ドラッグは別処理）。
    const cell = el('div', `day-cell${date === state.today ? ' today' : ''}`);
    cell.dataset.date = date;
    cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-label', t('dayAria', { month, day, count:events.length }));
    const dayButton = el('button', 'day-number day-open', day); dayButton.type = 'button';
    dayButton.setAttribute('aria-haspopup','dialog');dayButton.setAttribute('aria-controls','detail-dialog');
    dayButton.setAttribute('aria-label', t('dayAria', { month, day, count:events.length }));
    cell.append(dayButton); const pics = el('div', 'day-avatars');
    const visibleLimit = 1;
    for (const entry of events.slice(0, visibleLimit)) {
      const birthday = entry.ann.type === 'BIRTHDAY';
      const item = el('button', `calendar-event ${birthday ? 'birthday-event' : 'anniversary-event'}`);
      item.type = 'button'; item.dataset.personId = entry.person.id;
      item.dataset.eventKey = eventKey(entry.ann); item.draggable = false;
      const label = t('calendarEventList', { name:entry.person.displayName,
        event:birthday ? t('birthday') : anniversaryText(entry.ann, date) });
      item.title = label; item.setAttribute('aria-label', label);
      item.setAttribute('aria-haspopup','dialog');item.setAttribute('aria-controls','detail-dialog');
      const icon = el('span', 'event-avatar');
      const mark = el('span', 'event-mark', birthday ? '🎂' : '🎉'); mark.setAttribute('aria-hidden', 'true');
      icon.append(avatar(entry.person), mark);
      item.append(icon, el('span', 'event-name', birthday ? entry.person.displayName
        : `${entry.person.displayName} · ${anniversaryText(entry.ann, date)}`));
      pics.append(item);
    }
    if (events.length > visibleLimit) {
      const more = el('button', 'more', `+${events.length - visibleLimit}`); more.type = 'button';
      more.setAttribute('aria-label', t('calendarMoreEvents', { count:events.length - visibleLimit }));
      more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-controls','detail-dialog');
      pics.append(more);
    }
    cell.append(pics);
    cell.addEventListener('click', () => openDayPeople(events, month, day));
    cell.addEventListener('dragover', (event) => { if(state.railBulk)return;event.preventDefault(); cell.classList.add('drop-target'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (event) => { event.preventDefault(); cell.classList.remove('drop-target');
      if(state.railBulk)return;
      const personId = event.dataTransfer.getData('text/plain'); if (byId(personId)) requestEventMove({personId,to:date,sourceRail:true}); });
    grid.append(cell);
  }
}

function renderSelection() {
  const person = byId(state.selectedPersonId);
  if (!person) {state.selectedPersonId = null;state.selectionEvent=null;}
  const selectedAnn=person&&state.selectionEvent?person.anniversaries.find(a=>eventKey(a)===state.selectionEvent.key):null;
  $('selection-hint').textContent = person ? selectedAnn?t('selectedEventHint',{name:person.displayName,event:eventTitle(selectedAnn)}):t('selectedHint', { name:person.displayName }) : t('dayHint');
  $('clear-selection').hidden = !person;
  for (const item of document.querySelectorAll('.avatar-person, .person-card')) {
    const selected = item.dataset.personId === state.selectedPersonId;
    item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected));
  }
}
function selectPerson(id, context=null) {
  if (!byId(id)) return;
  clearTimeout(toast.timer); $('toast').hidden = true;
  state.selectedPersonId = id; state.selectionEvent=context?.key?context:null;renderSelection();
  // 人物タブから選んだ場合も、操作対象と重ならないカレンダー案内へ誘導。
  switchTab('calendar');
  $('clear-selection').focus({ preventScroll:true });
}

function requestEventMove(payload) {
  if(state.railBulk)return;
  const person = byId(payload.personId); if (!person) return;
  try {
    if(payload.sourceRail){const date=new Date(payload.to+'T00:00:00Z');
      const previous=birthdayOf(person);if(previous&&occurrenceForYear(previous,date.getUTCFullYear())===payload.to)return;
      payload={...payload,key:'BIRTHDAY',kind:'assignBirthday',from:previous?t('dateDay',previous):t('unregistered')};
    }else if (!movedPerson(person, payload.key, payload.from, payload.to)) return;
    pendingMove = { ...payload, person };
    const ann = person.anniversaries.find((item) => eventKey(item) === payload.key);
    $('move-description').textContent = t('moveQuestion', { name:person.displayName,
      event:payload.kind==='assignBirthday'||ann?.type === 'BIRTHDAY' ? t('birthday') : eventTitle(ann), from:payload.from, to:payload.to });
    $('move-error').hidden = true; $('move-dialog').showModal();
  } catch { toast(t('moveStale'));if(payload.sourceList)reopenDay(); }
}
async function confirmEventMove() {
  if (!pendingMove || moveSaving) return;
  moveSaving = true; $('move-confirm').disabled = true; $('move-cancel').disabled = true;
  $('move-confirm').textContent = t('saving');
  try {
    const move = pendingMove;
    const current = await get(state.db, 'people', move.personId);
    if (JSON.stringify(current) !== JSON.stringify(move.person)) throw new Error('moveStale');
    const target=new Date(move.to+'T00:00:00Z');
    const changed = move.kind==='assignBirthday'?birthdayAssignedPerson(current,target.getUTCMonth()+1,target.getUTCDate()):movedPerson(current, move.key, move.from, move.to);
    await savePerson(state.db, changed);
    state.selectedPersonId=null;state.selectionEvent=null;
    $('move-dialog').close(); await refresh(); toast(t('eventMoved'));
    $('calendar-grid').querySelector(`[data-person-id="${move.personId}"][data-event-key="${move.key}"]`)?.focus({ preventScroll:true });
  } catch (error) {
    $('move-error').textContent = error.message === 'moveStale' ? t('moveStale') : errorText(error);
    $('move-error').hidden = false;
  } finally {
    moveSaving = false; $('move-confirm').disabled = false; $('move-cancel').disabled = false;
    $('move-confirm').textContent = t('moveConfirm');
  }
}

function openDayPeople(events, month, day) {
  if(!$('detail-dialog').open&&!calendarDialogOrigin)calendarDialogOrigin={x:window.scrollX,y:window.scrollY,month:state.month.toISOString(),date:`${state.month.getUTCFullYear()}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`};
  state.detailPersonId = null; state.detailDay = { year:state.month.getUTCFullYear(), month, day };
  $('detail-dialog').querySelector('h2').textContent = t('dayPeople', { month, day });
  const body = $('detail-body'); body.replaceChildren();
  if (!events.length) body.append(el('p', 'help', t('emptyDay')));
  if (events.length) body.append(el('p', 'help day-drag-help', t('dayDragHelp')));
  body.append(...events.map((entry) => {
    const row = makePersonRow(entry.person, entry.ann.type === 'BIRTHDAY' ? t('birthday') : anniversaryText(entry.ann, entry.date));
    row.classList.add('day-event-row'); row.dataset.personId=entry.person.id; row.dataset.eventKey=eventKey(entry.ann);
    row.dataset.entryId=entryId(entry); row.dataset.date=entry.date; row.draggable=false;
    row.setAttribute('aria-label', `${entry.person.displayName} · ${entry.ann.type === 'BIRTHDAY' ? t('birthday') : anniversaryText(entry.ann,entry.date)} · ${t('dayDragHelp')}`);
    row.addEventListener('keydown', async event => {
      if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();const ids=events.map(entryId),index=ids.indexOf(entryId(entry)),next=index+(event.key==='ArrowUp'?-1:1);
      if(next<0||next>=ids.length)return;[ids[index],ids[next]]=[ids[next],ids[index]];
      await saveDayOrder(entry.date,ids);$('detail-body').querySelector(`[data-entry-id="${entryId(entry)}"]`)?.focus();
    });
    return row;
  }));
  $('detail-edit').hidden = true; $('detail-choose').hidden = true; $('day-add').hidden = false;
  const selected = byId(state.selectedPersonId);
  $('day-assign').hidden = !selected;
  if (selected) $('day-assign').textContent = state.selectionEvent?t('moveSelectedEvent',{name:selected.displayName}):t('assignBirthdayOnDate', { name:selected.displayName });
  if (!$('detail-dialog').open) $('detail-dialog').showModal();
}

function reopenDay() {
  const date=state.detailDay;if(!date)return;
  const key=`${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`;
  const events=calendarEvents(state.people,date.year,date.month,$('calendar-category').value,$('calendar-event-type').value).get(key)??[];
  openDayPeople(events,date.month,date.day);
}
async function saveDayOrder(date,ids) {
  try { await reorderDayEvents(state.db,date,ids);state.people=await all(state.db,'people');renderCalendar();reopenDay();toast(t('orderSaved')); }
  catch(error) { toast(errorText(error)); }
}

async function assignBirthday(personId, month, day) {
  const person = byId(personId); if (!person) return;
  try { await savePerson(state.db, birthdayAssignedPerson(person,month,day)); state.selectedPersonId = null;state.selectionEvent=null;
    await refresh(); toast(t('birthdaySaved', { name:person.displayName, date:t('dateDay', { month, day }) })); }
  catch (error) { toast(errorText(error)); }
}

function personMenuTrigger(person,context={}) {
  const button=el('button','person-menu-trigger','⋯');button.type='button';button.dataset.menuPersonId=person.id;
  button.setAttribute('aria-label',t('personActions',{name:person.displayName}));button.setAttribute('aria-haspopup','menu');
  button.setAttribute('aria-controls','person-action-menu');button.setAttribute('aria-expanded','false');
  button.onclick=event=>{event.stopPropagation();railMenu?.close(false);personMenu.open(person.id,button,context);};return button;
}
function setupRailManagement(){
  const heading=document.querySelector('.people-rail .section-heading'),actions=el('div','rail-heading-actions');
  const manage=el('button','quiet');manage.id='rail-manage';manage.type='button';manage.setAttribute('aria-haspopup','menu');manage.setAttribute('aria-controls','rail-manage-menu');manage.setAttribute('aria-expanded','false');
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.classList.add('outline-icon');
  const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d','M4 7h16M4 17h16M9 4v6M15 14v6');icon.append(path);
  const text=el('span');text.id='rail-manage-label';manage.append(icon,text);actions.append($('rail-count'),manage);heading.append(actions);
  const sortLabel=el('label','rail-sort'),sortText=el('span'),sort=el('select');sortLabel.id='rail-sort-control';sortText.id='rail-sort-label';sort.id='rail-sort';sort.setAttribute('aria-labelledby','rail-sort-label');
  for(const value of RAIL_SORTS){const option=el('option');option.value=value;sort.append(option);}sortLabel.append(sortText,sort);
  const toolbar=el('div','rail-bulk-actions');toolbar.id='rail-bulk-actions';const count=el('span');count.id='rail-selected-count';count.setAttribute('role','status');
  const remove=el('button','danger-link');remove.type='button';remove.id='rail-delete-selected';remove.onclick=deleteSelectedPeople;
  const cancel=el('button','quiet');cancel.type='button';cancel.id='rail-bulk-cancel';cancel.onclick=()=>{if(state.railDeleting)return;state.railBulk=false;state.railSelected.clear();$('rail-error').hidden=true;renderCalendar();$('rail-manage').focus({preventScroll:true});};
  toolbar.append(count,remove,cancel);const error=el('p','form-error');error.id='rail-error';error.setAttribute('role','alert');error.hidden=true;
  heading.after(sortLabel,toolbar,error);
  railMenu=setupPersonMenu({id:'rail-manage-menu',label:()=>t('managePeople'),actions:[
    {key:'bulk',label:()=>t('bulkDeleteMode'),run:()=>{state.railBulk=true;state.railSelected.clear();state.selectedPersonId=null;state.selectionEvent=null;$('rail-error').hidden=true;renderCalendar();$('rail-bulk-cancel').focus({preventScroll:true});}},
    {key:'sort',label:()=>t('sort'),run:()=>{state.railSortOpen=true;renderCalendar();$('rail-sort').focus({preventScroll:true});}},
  ]});
  manage.onclick=()=>{personMenu?.close(false);railMenu.open('rail',manage);};
  sort.onchange=()=>{state.railSort=sort.value;renderCalendar();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.railBulk&&!state.railDeleting&&!document.querySelector('dialog[open]')){event.preventDefault();cancel.click();}});
}
function renderRailManagement(){
  $('rail-manage-label').textContent=t('managePeople');$('rail-manage').disabled=state.railBulk||state.railDeleting;
  $('rail-sort-control').hidden=!state.railSortOpen;$('rail-sort-label').textContent=t('sort');$('rail-sort').value=state.railSort;
  $('rail-sort').disabled=state.railDeleting;
  document.querySelector('.people-rail .help').textContent=t(state.railBulk?'railBulkHelp':'railHelp');
  for(const option of $('rail-sort').options)option.textContent=t('railSort_'+option.value);
  $('rail-bulk-actions').hidden=!state.railBulk;$('rail-selected-count').textContent=t('selectedPeopleCount',{count:state.railSelected.size});
  $('rail-delete-selected').textContent=t(state.railDeleting?'saving':'deleteSelected');$('rail-delete-selected').disabled=state.railDeleting||!state.railSelected.size;
  $('rail-bulk-cancel').textContent=t('cancel');$('rail-bulk-cancel').disabled=state.railDeleting;
  for(const input of document.querySelectorAll('[data-bulk-person-id]'))input.disabled=state.railDeleting;
  for(const button of document.querySelectorAll('[data-rail-filter]'))button.disabled=state.railDeleting;
}
async function deleteSelectedPeople(){
  if(state.railDeleting||!state.railSelected.size)return;
  const ids=[...state.railSelected],people=ids.map(byId);if(people.some(p=>!p))return;
  if(!confirm(t('bulkDeleteQuestion',{count:ids.length,names:people.map(p=>p.displayName).join('\n')})))return;
  state.railDeleting=true;$('rail-error').hidden=true;renderRailManagement();
  try{await deletePeople(state.db,ids);state.railSelected.clear();state.railBulk=false;state.selectedPersonId=null;state.selectionEvent=null;await refresh();toast(t('peopleDeleted',{count:ids.length}));}
  catch(error){$('rail-error').textContent=errorText(error);$('rail-error').hidden=false;}
  finally{state.railDeleting=false;renderRailManagement();}
}
async function requestPersonDeletion(id) {
  const person=byId(id);if(!person||!confirm(t('deleteQuestion',{name:person.displayName})))return;
  try{await deletePerson(state.db,id);personMenu?.removePerson(id);
    if(state.selectedPersonId===id){state.selectedPersonId=null;state.selectionEvent=null;}
    if($('person-dialog').open&&$('person-id').value===id)$('person-dialog').close();
    if($('detail-dialog').open)$('detail-dialog').close();
    await refresh();toast(t('personDeleted'));
  }catch(error){toast(errorText(error));}
}
function renderPeople() {
  personMenu?.close(false);
  const options = { category: $('people-category').value, month: Number($('people-month').value),
    search: $('people-search').value, birthday: $('people-birthday').value };
  const people = filterPeople(state.people, options);
  const sort = $('people-sort').value;
  if (sort === 'name') people.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
  else if (sort === 'recent') people.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  else { const ranks = new Map(birthdayRows(state.people, state.today).map((row) => [row.person.id, row.daysUntil]));
    people.sort((a, b) => (ranks.get(a.id) ?? 999) - (ranks.get(b.id) ?? 999)
      || a.displayName.localeCompare(b.displayName, 'ja')); }
  $('people-count').textContent = t('peopleShown', { count:people.length });
  if (!people.length) empty($('people-list'), t('noMatches'));
  else $('people-list').replaceChildren(...people.map((person) => {
    const card = el('button', 'person-card'); card.type = 'button'; card.append(avatar(person));
    card.dataset.personId = person.id;
    card.classList.toggle('selected', state.selectedPersonId === person.id);
    card.setAttribute('aria-pressed', String(state.selectedPersonId === person.id));
    card.title = t('railTitle', { name:person.displayName });
    const content = el('span', 'person-card-content'); content.append(el('strong', '', person.displayName),
      el('small', '', `${categoryLabel(person.category)} · ${birthdayText(person)}`)); card.append(content);
    card.addEventListener('click', () => openDetail(person.id));
    const wrap=el('div','person-action-wrap');wrap.append(card,personMenuTrigger(person));return wrap;
  }));
}

function renderBirthdays() {
  const month = Number($('birthday-month').value), category = $('birthday-category').value;
  const rows = birthdayRows(state.people, state.today).filter((row) =>
    (!month || row.birthday.month === month) && (category === 'ALL' || row.person.category === category));
  if (!rows.length) empty($('birthday-list'), t('noBirthdays'));
  else $('birthday-list').replaceChildren(...rows.map((row) => makePersonRow(row.person,
    `${t('dateDay', { month:row.birthday.month, day:row.birthday.day })} · ${categoryLabel(row.person.category)}`, formatDays(row.daysUntil))));
}

function detailBlock(title, values) {
  const block = el('div', 'detail-block'); block.append(el('h4', '', title));
  for (const value of values) block.append(el('p', '', value)); return block;
}
function openDetail(id) {
  const person = byId(id); if (!person) return;
  if ($('detail-dialog').open) $('detail-dialog').close();
  state.detailPersonId = id; state.detailDay = null;
  $('detail-dialog').querySelector('h2').textContent = t('detail');
  $('day-add').hidden = true; $('day-assign').hidden = true;
  $('detail-edit').hidden = false; $('detail-choose').hidden = false;
  const body = $('detail-body'); body.replaceChildren();
  const top = el('div', 'detail-top'); top.append(avatar(person, true));
  const text = el('div'); text.append(el('h3', '', person.displayName), el('p', '',
    `${categoryLabel(person.category)}${person.username ? ` · @${person.username}` : ''}`)); top.append(text); body.append(top);
  const birthdays = [birthdayText(person)]; const b = birthdayOf(person);
  if (b?.year) birthdays.push(`${t('yearLabel')} ${t('dateYear', { year:b.year })}${b.showAge ? ` · ${t('ageApprox', { age:Math.max(0, Number(state.today.slice(0, 4)) - b.year) })}` : ''}`);
  body.append(detailBlock(t('birthday'), birthdays));
  if (person.seriesName) body.append(detailBlock(t('series'), [person.seriesName]));
  if (person.memo) body.append(detailBlock(t('memo'), [person.memo]));
  if (person.anniversaries.some((ann) => ann.type !== 'BIRTHDAY')) body.append(detailBlock(t('otherAnniversaries'),
    person.anniversaries.filter((ann) => ann.type !== 'BIRTHDAY')
      .map((ann) => {
        const date = occurrenceForYear(ann, Number(state.today.slice(0, 4)));
        return `${anniversaryText(ann, date)}: ${ann.year ? `${ann.year}/` : ''}${ann.month}/${ann.day}`
          + ` · ${t(ann.recurring === false ? 'onceOnly' : 'repeatYearly')}`
          + ` · ${t(ann.notify ? 'notifyOn' : 'notifyOff')}`;
      })));
  if (person.xProfileUrl) {
    const block = detailBlock(t('xProfile'), []); const link = el('a', '', t('openX'));
    link.href = person.xProfileUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; block.append(link); body.append(block);
  }
  if (person.links.length) {
    const block = detailBlock(t('relatedUrls'), []);
    for (const item of person.links) { const link = el('a', '', item.label || item.url); link.href = item.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; block.append(link); }
    body.append(block);
  }
  $('detail-dialog').showModal();
}

function anniversaryRow(value = null) {
  const row = el('div', 'repeat-row anniversary-edit'); row.dataset.annId = value?.id ?? '';
  const titleLabel = el('label', '', t('anniversaryName')); const title = el('input', 'ann-title');
  title.maxLength = 100; title.required = true; title.placeholder = t('anniversaryExample');
  title.value = value ? eventTitle(value) : ''; titleLabel.append(title);
  row.append(titleLabel);
  const month=el('select','ann-month'),day=el('select','ann-day');
  for(const [label,select]of [[t('month'),month],[t('day'),day]]){const wrap=el('label','short',label);wrap.append(select);row.append(wrap);}
  const dates=setupMonthDay(month,day,{monthLabel,dayLabel,empty:()=>t('unregistered'),required:true});dates.set(value?.month,value?.day);dates.bind();
  const yearWrap=el('label','short',t('optionalYear')),year=el('input','ann-year');
  year.type='number';year.min=1900;year.max=2100;year.value=value?.year??'';yearWrap.append(year);row.append(yearWrap);
  for (const [key, label, checked] of [
    ['recurring', t('repeatYearly'), value?.recurring !== false],
    ['showAnniversary', t('showAnniversary'), value?.showAnniversary === true],
    ['notify', t('notifyAnniversary'), value?.notify === true],
  ]) { const wrap = el('label', 'check', label); const input = el('input', `ann-${key}`);
    input.type = 'checkbox'; input.checked = checked; wrap.prepend(input); row.append(wrap); }
  const remove = el('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', t('removeAnn'));
  remove.onclick = () => row.remove(); row.append(remove);
  row.append(el('small', 'anniversary-hint', t('onceNeedsYear'))); return row;
}
function linkRow(value = null) {
  const row = el('div', 'repeat-row');
  for (const [label, cls, current] of [[t('url'), 'link-url', value?.url], [t('label'), 'link-label', value?.label]]) {
    const wrap = el('label', cls === 'link-label' ? 'short' : '', label); const input = el('input', cls);
    input.value = current ?? ''; if (cls === 'link-url') { input.type = 'url'; input.required = true; }
    wrap.append(input); row.append(wrap);
  }
  const remove = el('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', t('removeUrl'));
  remove.onclick = () => row.remove(); row.append(remove); return row;
}

function openForm(id = null, initialDate = null) {
  const person = id ? byId(id) : null;
  // 登録経路の一時状態のみ。表示中の年は生年へ渡さない。
  state.formCalendarDate = !person && initialDate ? { ...initialDate } : null;
  $('person-form').reset(); $('person-id').value = person?.id ?? '';
  $('person-dialog-title').textContent = person ? t('personEdit') : t('personAdd');
  $('person-name').value = person?.displayName ?? ''; $('person-category').value = person?.category ?? 'OTHER';
  $('person-series').value = person?.seriesName ?? ''; $('person-username').value = person?.username ?? '';
  $('person-x-url').value = person?.xProfileUrl ?? ''; $('person-memo').value = person?.memo ?? '';
  const b = person && birthdayOf(person);
  birthDateFields.set(b?.month??state.formCalendarDate?.month??'',b?.day??state.formCalendarDate?.day??'');
  birthYearFields.set(b?.year??''); $('person-show-age').checked = b?.showAge ?? false;
  $('remove-image-wrap').hidden = !person?.hasImage; $('delete-person').hidden = !person;
  $('anniversary-fields').replaceChildren(...(person?.anniversaries.filter((ann) => ann.type !== 'BIRTHDAY') ?? []).map(anniversaryRow));
  $('link-fields').replaceChildren(...(person?.links ?? []).map(linkRow));
  $('person-error').hidden = true;
  avatarEditor.reset(person ? state.images.get(person.id) : null);
  $('person-dialog').showModal();
  $('person-form').scrollTop = 0;
  $('person-name').focus({ preventScroll:true });
}

async function submitPerson(event) {
  event.preventDefault(); const errorNode = $('person-error'); errorNode.hidden = true;
  if ($('avatar-crop-dialog').open) return;
  const id = $('person-id').value; const old = id ? byId(id) : null;
  const month = $('person-birth-month').value, day = $('person-birth-day').value;
  if (Boolean(month) !== Boolean(day)) { errorNode.textContent = t('bothMonthDay'); errorNode.hidden = false; return; }
  const anniversaries = [...document.querySelectorAll('#anniversary-fields .repeat-row')].map((row) => ({
    id: row.dataset.annId || undefined, type: 'CUSTOM', title: row.querySelector('.ann-title').value,
    month: row.querySelector('.ann-month').value, day: row.querySelector('.ann-day').value,
    year: row.querySelector('.ann-year').value,
    recurring: row.querySelector('.ann-recurring').checked,
    showAnniversary: row.querySelector('.ann-showAnniversary').checked,
    notify: row.querySelector('.ann-notify').checked,
  }));
  if (month) anniversaries.unshift({ type: 'BIRTHDAY', month, day, year: $('person-birth-year').value,
    showAge: $('person-show-age').checked });
  const links = [...document.querySelectorAll('#link-fields .repeat-row')].map((row) => ({
    url: row.querySelector('.link-url').value, label: row.querySelector('.link-label').value,
  }));
  const person = { ...old, displayName: $('person-name').value, category: $('person-category').value,
    seriesName: $('person-series').value, username: $('person-username').value,
    xProfileUrl: $('person-x-url').value, memo: $('person-memo').value, anniversaries, links };
  try {
    const image = avatarEditor.imageForSave();
    const saved = await savePerson(state.db, person, { image, removeImage: !image && $('person-remove-image').checked });
    const calendarDate = state.formCalendarDate, birthday = birthdayOf(saved);
    if (calendarDate) {
      state.month = new Date(Date.UTC(calendarDate.year, (birthday?.month ?? calendarDate.month) - 1, 1));
      if ($('calendar-category').value !== 'ALL' && $('calendar-category').value !== saved.category) $('calendar-category').value = 'ALL';
      if ($('calendar-event-type').value === 'ANNIVERSARY') $('calendar-event-type').value = 'ALL';
    }
    state.formCalendarDate = null;
    $('person-dialog').close(); await refresh();
    if (calendarDate) {
      switchTab('calendar');
      const targetDate = birthday ? occurrenceForYear(birthday, calendarDate.year)
        : `${calendarDate.year}-${String(calendarDate.month).padStart(2, '0')}-${String(calendarDate.day).padStart(2, '0')}`;
      const target = $('calendar-grid').querySelector(`[data-person-id="${saved.id}"]`)
        ?? $('calendar-grid').querySelector(`[data-date="${targetDate}"] .day-open`);
      target?.focus({ preventScroll:true }); target?.scrollIntoView({ block:'nearest' });
    }
    toast(t(calendarDate && birthday ? 'birthdaySaved' : old ? 'personUpdated' : 'personAdded',
      { name:saved.displayName, date:birthday ? t('dateDay', birthday) : '' }));
  } catch (error) { errorNode.textContent = errorText(error); errorNode.hidden = false; }
}

function notificationMessage(notice, person) {
  if (notice.anniversaryId) {
    const ann = person.anniversaries.find((item) => item.id === notice.anniversaryId);
    if (!ann) return '';
    return t(notice.daysBefore === 0 ? 'annNoticeToday' : notice.daysBefore === 1
      ? 'annNoticeTomorrow' : 'annNoticeFuture', { name:person.displayName,
      title:anniversaryText(ann, notice.birthdayDate), days:notice.daysBefore });
  }
  return notice.daysBefore === 0 ? t('noticeToday', { name:person.displayName })
    : notice.daysBefore === 1 ? t('noticeTomorrow', { name:person.displayName })
      : t('noticeFuture', { name:person.displayName, days:notice.daysBefore });
}
function renderNotifications() {
  const list = $('notification-list'); list.replaceChildren();
  if (!state.notices.length) { empty(list, t('noNotices')); return; }
  for (const notice of state.notices) {
    const person = byId(notice.personId); if (!person) continue;
    const wrap = el('div', `notification-item${notice.readAt ? '' : ' unread'}`);
    const button = makePersonRow(person, notificationMessage(notice, person),
      notice.readAt ? t('read') : t('unread'));
    button.addEventListener('click', async () => { if (!notice.readAt) await markNotificationRead(state.db, notice.id);
      $('notification-dialog').close(); await refresh(); });
    wrap.append(button); list.append(wrap);
  }
}
function renderTransferGuide() {
  const [source, destination] = state.transferRoute.split('-').map((device) => t(device === 'phone' ? 'devicePhone' : 'devicePc'));
  const steps = [t('transferStepExport', { source }), t('transferStepSend', { destination }),
    t('transferStepOpen', { destination }), t('transferStepBackup'),
    t('transferStepImport'), t('transferStepConfirm')];
  $('transfer-steps').replaceChildren(...steps.map((step) => el('li', '', step)));
  for (const button of document.querySelectorAll('[data-transfer-route]'))
    button.setAttribute('aria-pressed', String(button.dataset.transferRoute === state.transferRoute));
}
function renderSettings() {
  $('theme-choice').value = appearance.theme;
  const form = $('notification-settings');
  for (const [key, value] of Object.entries(state.settings ?? {})) if (form.elements[key]) form.elements[key].checked = value;
  renderTransferGuide();
}
function formatBytes(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`; }
async function renderStorageStats() {
  const summary = await storageSummary(state.db);
  let estimate, appCache;
  try { estimate = await navigator.storage?.estimate?.(); } catch { /* Safari等では取得不可 */ }
  try { appCache = await cacheBytes(); } catch { /* Cache Storage取得不可 */ }
  const items = [[t('storagePeople'), t('peopleCount', { count:summary.people })],
    [t('storageImages'), t('imageUnit', { count:summary.images })],
    [t('storageImageBytes'), formatBytes(summary.imageBytes)],
    [t('storageCacheBytes'), appCache == null ? t('unavailable') : formatBytes(appCache)],
    [t('storageTotal'), Number.isFinite(estimate?.usage) ? formatBytes(estimate.usage) : t('unavailable')],
    [t('storageIntegrity'), summary.missing.length || summary.orphan.length
      ? t('integrityBad', { missing:summary.missing.length, orphan:summary.orphan.length }) : t('integrityOk')]];
  $('storage-stats').replaceChildren(...items.map(([name, value]) => el('div', 'stat-line', `${name}：${value}`)));
}

async function exportBackup() {
  if(exportBusy||restoreBusy||state.ending)return;
  exportBusy=true;let password;
  for(const id of ['export-backup','transfer-export'])$(id).disabled=true;
  try { password=await askBackupPassword(t,true);if(password===null)return;
    toast(t('encrypting'));
    const blob = await encryptBackup(await createBackup(state.db),password);password=null;
    const url = URL.createObjectURL(blob);
    const link = el('a'); link.href = url; link.download = `birthday-calendar-backup-${state.today}.birthday-backup`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(t('backupDone')); }
  catch (error) { toast(errorText(error)); }
  finally{password=null;exportBusy=false;for(const id of ['export-backup','transfer-export'])$(id).disabled=false;}
}
async function previewRestore(file) {
  if(restoreBusy||exportBusy||state.ending){toast(t('restoreBusy'));return;}
  const busy=value=>{restoreBusy=value;$('import-backup').disabled=value;$('transfer-import').disabled=value;};
  busy(true);
  const host = $('restore-preview'); host.hidden = true; state.preparedBackup = null;
  try {
    let password,zip=file;
    try{if(await isEncryptedBackup(file)){
      password=await askBackupPassword(t,false);if(password===null)return;
      toast(t('decrypting'));zip=await decryptBackup(file,password);
    }}finally{password=null;}
    const prepared = await inspectBackup(zip); state.preparedBackup = prepared;
    const current = await storageSummary(state.db);
    host.replaceChildren(el('p', '', t('backupDate', { date:prepared.manifest.createdAt, version:prepared.manifest.formatVersion })),
      el('p', '', t('backupCounts', { people:prepared.summary.people, images:prepared.summary.images, notices:prepared.summary.notifications })),
      el('p', '', t('restoreReplaceCounts', { currentPeople:current.people, currentImages:current.images,
        incomingPeople:prepared.summary.people, incomingImages:prepared.summary.images })),
      el('p', '', t('restoreWarning')));
    const backupButton = el('button', 'quiet', t('backupCurrent')); backupButton.type = 'button';
    backupButton.onclick = exportBackup;
    const confirmButton = el('button', 'primary', t('restoreButton')); confirmButton.type = 'button';
    confirmButton.onclick = async () => {
      if (state.preparedBackup !== prepared||restoreBusy) return;
      if (!confirm(t('restoreConfirm'))) return;
      if (prompt(t('restorePrompt')) !== t('restoreWord')) return;
      busy(true);confirmButton.disabled=true;backupButton.disabled=true;
      try { await restoreBackup(state.db, prepared); state.preparedBackup = null; host.hidden = true;
        try{
        appearance = await loadAppearance(state.db); applyAppearance(appearance);
        setLanguage(await loadLanguage(state.db)); $('language-choice').value = currentLanguage();
        applyStaticTranslations();refreshExitGuide(t); avatarEditor.refreshLanguage(); birthYearFields.refresh();birthDateFields.refresh(); await refresh();
        await renderStorageStats(); updates?.refreshLanguage(); toast(t('restoreDone'));
        }catch{toast(t('restoreDisplayFailed'));} }
      catch (error) { toast(errorText(error)); }
      finally{busy(false);confirmButton.disabled=false;backupButton.disabled=false;}
    };
    const actions = el('div', 'actions'); actions.append(backupButton, confirmButton);
    host.append(actions); host.hidden = false;
  } catch (error) { toast(t('restoreFailed', { message:errorText(error) })); }
  finally{busy(false);}
}

function initOptions() {
  for (const key of Object.keys(CATEGORIES)) {
    for (const id of ['people-category', 'birthday-category', 'person-category', 'calendar-category']) {
      const option = el('option', '', categoryLabel(key)); option.value = key; $(id).append(option);
    }
  }
  for (let month = 1; month <= 12; month++) {
    for (const id of ['people-month', 'birthday-month', 'person-birth-month']) {
      const option = el('option', '', monthLabel(month)); option.value = month; $(id).append(option);
    }
  }
  for (let day = 1; day <= 31; day++) { const option = el('option', '', dayLabel(day));
    option.value = day; $('person-birth-day').append(option); }
}

function bindEvents() {
  setupSettingsSections(t); setupOutlineIcons();
  setupExitUI(t,{backup:exportBackup,erase:deleteDeviceData});
  birthDateFields=setupMonthDay($('person-birth-month'),$('person-birth-day'),{monthLabel,dayLabel,empty:()=>t('unregistered')});birthDateFields.bind();
  birthYearFields=setupBirthYear({input:$('person-birth-year'),choice:$('person-birth-year-choice'),mode:$('person-birth-year-mode'),currentYear:todayYear,t});birthYearFields.set();
  $('header-settings').onclick = () => switchTab('settings');
  $('theme-choice').onchange = async (event) => {
    try { const next = { theme:event.target.value }; await saveAppearance(state.db,next); appearance=next; applyAppearance(appearance); }
    catch(error) { $('theme-choice').value=appearance.theme; toast(errorText(error)); }
  };
  systemTheme.addEventListener('change', () => applyAppearance(appearance, systemTheme.matches));
  avatarEditor = setupAvatarEditor();
  personMenu=setupPersonMenu({label:id=>t('personActions',{name:byId(id)?.displayName??''}),actions:[
    {key:'move',label:()=>t('menuMoveDate'),run:(id,context)=>{if($('detail-dialog').open)$('detail-dialog').close();selectPerson(id,context);}},
    {key:'edit',label:()=>t('menuEditPerson'),run:id=>{if($('detail-dialog').open)$('detail-dialog').close();openForm(id);}},
    {key:'delete',label:()=>t('menuDeletePerson'),run:requestPersonDeletion},
  ]});
  setupRailManagement();
  gestures = setupCalendarGestures({ grid:$('calendar-grid'),
    enabled:()=>!state.railBulk&&!state.railDeleting,
    roots:[$('calendar-grid'), $('person-rail'), $('people-list'), $('detail-body')], onMove:requestEventMove, onSelect:selectPerson,
    onMenu:(id,item)=>personMenu.open(id,item),onRailStart:()=>$('calendar-grid').scrollIntoView({block:'center',behavior:'instant'}),
    onReorder:saveDayOrder, onCancelList:reopenDay,
    onLeaveList:() => { $('detail-dialog').close();$('calendar-grid').scrollIntoView({block:'center',behavior:'instant'}); } });
  $('detail-body').addEventListener('dragstart',event=>event.preventDefault());
  // 画像の標準ドラッグがPointer Eventsを横取りしないよう、カレンダーだけ抑止。
  $('calendar-grid').addEventListener('dragstart', (event) => event.preventDefault());
  $('person-rail').addEventListener('dragstart',event=>event.preventDefault());
  compactCalendar.addEventListener('change', renderCalendar);
  $('clear-selection').onclick = () => { state.selectedPersonId = null;state.selectionEvent=null; renderSelection(); };
  $('move-confirm').onclick = confirmEventMove;
  $('move-cancel').onclick = () => { if (!moveSaving) { const restore=pendingMove?.sourceList;$('move-dialog').close();if(restore)reopenDay(); } };
  $('move-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();if(moveSaving)return;
    const restore=pendingMove?.sourceList;$('move-dialog').close();if(restore)reopenDay();
  });
  $('move-dialog').addEventListener('close', () => { pendingMove = null; });
  for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => switchTab(button.dataset.tab);
  $('language-choice').onchange = async (event) => {
    try {
      await saveLanguage(state.db, event.target.value);
      setLanguage(event.target.value); applyStaticTranslations();refreshExitGuide(t); avatarEditor.refreshLanguage();
      birthDateFields.refresh();birthYearFields.refresh();
      renderHome(); renderCalendar(); renderPeople(); renderBirthdays(); renderNotifications(); renderSettings();
      if ($('detail-dialog').open && state.detailPersonId) openDetail(state.detailPersonId);
      else if ($('detail-dialog').open && state.detailDay) {
        const { year, month, day } = state.detailDay;
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        openDayPeople(calendarEvents(state.people, year, month, $('calendar-category').value, $('calendar-event-type').value).get(date) ?? [], month, day);
      }
      state.preparedBackup = null; $('restore-preview').hidden = true;
      updates?.refreshLanguage();
      if (!updates) $('settings-update-status').textContent = t('updateUnavailable');
      await renderStorageStats();
    } catch (error) { toast(errorText(error)); }
  };
  window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.db) {
      const current = tokyoToday();
      if (current !== state.today) { state.today = current; await refresh(); }
    }
  });
  for (const id of ['calendar-add', 'people-add']) $(id).onclick = () => openForm();
  $('person-form').addEventListener('submit', submitPerson);
  $('person-dialog').addEventListener('close', () => {
    if ($('person-dialog').open || !state.formCalendarDate) return;
    const { year, month, day } = state.formCalendarDate; state.formCalendarDate = null;
    $('calendar-grid').querySelector(`[data-date="${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}"] .day-open`)?.focus({ preventScroll:true });
  });
  $('add-anniversary').onclick = () => $('anniversary-fields').append(anniversaryRow());
  $('add-link').onclick = () => $('link-fields').append(linkRow());
  for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => $(button.dataset.close).close();
  $('detail-dialog').addEventListener('close',()=>{
    // 同じdialogを一覧→人物詳細へ使い直している間は復帰を待つ。
    if($('detail-dialog').open)return;
    const origin=calendarDialogOrigin;calendarDialogOrigin=null;
    // 登録フォームやドラッグへの遷移では既存のフォーカス・スクロール処理を優先。
    if(!origin||$('view-calendar').hidden||document.querySelector('dialog[open],.drag-ghost')||state.month.toISOString()!==origin.month)return;
    $('calendar-grid').querySelector(`[data-date="${origin.date}"] .day-open`)?.focus({preventScroll:true});
    window.scrollTo({left:origin.x,top:origin.y,behavior:'instant'});
  });
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !(dialog.id === 'move-dialog' && moveSaving)) dialog.close(); });
  $('detail-edit').onclick = () => { $('detail-dialog').close(); openForm(state.detailPersonId); };
  $('day-add').onclick = () => {
    const date = state.detailDay; if (!date) return;
    $('detail-dialog').close(); state.selectedPersonId = null; renderCalendar(); openForm(null, date);
  };
  $('day-assign').onclick = async () => {
    const date = state.detailDay, id = state.selectedPersonId; if (!date || !id) return;
    $('detail-dialog').close();
    if(state.selectionEvent){requestEventMove({personId:id,...state.selectionEvent,to:`${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`});}
    else await assignBirthday(id, date.month, date.day);
  };
  $('detail-choose').onclick = () => { const id=state.detailPersonId;
    $('detail-dialog').close();selectPerson(id);renderCalendar(); };
  $('delete-person').onclick = () => requestPersonDeletion($('person-id').value);
  $('calendar-today').onclick = () => { state.month = new Date(Date.UTC(todayYear, todayMonth - 1, 1)); renderCalendar(); };
  $('month-prev').onclick = () => { state.month = new Date(Date.UTC(state.month.getUTCFullYear(), state.month.getUTCMonth() - 1, 1)); renderCalendar(); };
  $('month-next').onclick = () => { state.month = new Date(Date.UTC(state.month.getUTCFullYear(), state.month.getUTCMonth() + 1, 1)); renderCalendar(); };
  for (const button of document.querySelectorAll('[data-rail-filter]')) button.onclick = () => {
    state.railSelected.clear();$('rail-error').hidden=true;
    state.railFilter = button.dataset.railFilter;
    for (const peer of document.querySelectorAll('[data-rail-filter]')) peer.classList.toggle('active', peer === button);
    renderCalendar(); };
  $('calendar-category').onchange = renderCalendar;
  $('calendar-event-type').onchange = renderCalendar;
  for (const id of ['people-search', 'people-category', 'people-month', 'people-birthday', 'people-sort'])
    $(id).addEventListener('input', renderPeople);
  for (const id of ['birthday-month', 'birthday-category']) $(id).addEventListener('change', renderBirthdays);
  $('bell').onclick = async () => { await refresh(); $('notification-dialog').showModal(); };
  $('read-all').onclick = async () => { await markAllRead(state.db); await refresh(); };
  $('notification-settings').onsubmit = async (event) => { event.preventDefault(); const fields = event.currentTarget.elements;
    await saveSettings(state.db, Object.fromEntries(['enabled', 'seven', 'three', 'one', 'today']
      .map((key) => [key, fields[key].checked]))); await refresh(); toast(t('settingsSaved')); };
  // Keep selection content-based so both current encrypted backups and ordinary
  // ZIP backups can be validated without trusting a filename or MIME type.
  $('import-backup').removeAttribute('accept');
  $('export-backup').onclick = exportBackup;
  $('transfer-export').onclick = exportBackup;
  $('transfer-import').onclick = () => $('import-backup').click();
  for (const button of document.querySelectorAll('[data-transfer-route]')) button.onclick = () => {
    state.transferRoute = button.dataset.transferRoute; renderTransferGuide(); };
  $('import-backup').onchange = (event) => { const file = event.target.files[0]; if (file) previewRestore(file);
    event.target.value = ''; };
  $('clear-cache').onclick = async () => { try { const removed = await clearOldShellCaches();
    await renderStorageStats(); toast(t('cacheCleared', { count:removed })); }
    catch (error) { toast(errorText(error)); } };
  $('reset-demo-data').onclick = async () => {
    if (!confirm(t('demoResetConfirm'))) return;
    const button = $('reset-demo-data'); button.disabled = true;
    try {
      const count = await resetDemoData(state.db);
      state.selectedPersonId = null; state.detailPersonId = null; state.selectionEvent = null;
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
      await refresh(); switchTab('home'); toast(t('demoResetDone', { count }));
    } catch (error) { toast(errorText(error)); }
    finally { button.disabled = false; }
  };
}

async function boot() {
  try {
    dataSession=await startDataSession();
    if(isRetired()){state.ending=true;showStopped(t,null,deleteDeviceData);return;}
    initOptions(); bindEvents(); state.db = await openDatabase();
    await ensureDemoData(state.db);
    appearance = await loadAppearance(state.db); applyAppearance(appearance);
    setLanguage(await loadLanguage(state.db)); $('language-choice').value = currentLanguage();
    $('app-version').textContent = APP_VERSION; applyStaticTranslations();refreshExitGuide(t);birthYearFields.refresh(); await refresh();
    switchTab(location.hash.slice(1) || 'home');
    if (import.meta.env.PROD) updates = await setupUpdates({ t, errorText,isStopped:()=>Boolean(state.ending),
      confirmUpdate: () => !document.querySelector('dialog[open]') || confirm(t('updateUnsaved')) });
    if (!updates) { $('settings-update-status').textContent = t('updateUnavailable');
      $('settings-check-update').disabled = true; }
  } catch (error) {
    document.querySelector('main').replaceChildren(el('div', 'empty',
      t('dbFailed', { message:errorText(error) })));
    console.error(error);
  }
}
async function deleteDeviceData(){
  if(deletionBusy)return;
  if(exportBusy||restoreBusy||moveSaving||state.railDeleting){toast(t('restoreBusy'));return;}
  if(!confirm(t('deleteBackupConfirm'))||!confirm(t('deleteWindowsConfirm'))||prompt(t('deletePrompt'))!==t('deleteWord'))return;
  deletionBusy=true;
  if($('toast'))toast(t('deleteWorking'));
  else {const heading=document.querySelector('.stopped-screen h1');if(heading)heading.textContent=t('deleteWorking');}
  document.body.inert=true;
  try{
    const report=await dataSession.exclusive(markEnded=>eraseManagedData(state.db,{markEnded,onStop:()=>{
      state.ending=true;gestures?.cancel();personMenu?.close(false);railMenu?.close(false);
      for(const url of state.images.values())URL.revokeObjectURL(url);
      state.images.clear();state.people=[];state.notices=[];state.preparedBackup=null;
      showStopped(t);
    }}));
    showStopped(t,report,deleteDeviceData);
  }catch(error){if(state.ending)showStopped(t,null,deleteDeviceData);else toast(errorText(error));}
  finally{deletionBusy=false;document.body.inert=false;}
}
window.addEventListener('storage',event=>{if(event.key===RETIRED_KEY&&event.newValue){state.ending=true;state.db?.close();gestures?.cancel();showStopped(t);}});
boot();
