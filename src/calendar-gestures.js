// 委譲登録し、ジェスチャー終了時に一時リスナーとghostを回収する。
// 長押し成立後だけtouchmoveを抑止。長押し前のスワイプはスクロールへ渡す。
export function setupCalendarGestures({ grid, roots, onMove, onSelect, onMenu, onRailStart, onReorder, onLeaveList, onCancelList, enabled=()=>true,
  document:doc = document, window:win = window }) {
  let gesture = null, suppressed = null;
  const clean = () => {
    if (!gesture) return;
    clearTimeout(gesture.timer); gesture.abort.abort();
    win.cancelAnimationFrame(gesture.frame);
    gesture.insertion?.classList.remove('insert-before', 'insert-after');
    gesture.ghost?.remove(); gesture.target?.classList.remove('drop-target');
    gesture.item.classList.remove('dragging');
    try { gesture.capture?.releasePointerCapture(gesture.pointerId); } catch { /* capture未成立 */ }
    gesture = null;
  };
  const cancel = (event) => { const restore = gesture?.active && gesture.list && gesture.leftList
    && (!event?.type || ['keydown','pointercancel'].includes(event.type));
    if (gesture?.active) suppressed = { item:gesture.item, until:Date.now()+800 }; clean(); if (restore) onCancelList?.(); };
  const start = (event) => {
    if(!enabled())return;
    if (gesture) { if (event.pointerId !== gesture.pointerId) cancel(); return; }
    if (event.button !== 0 || event.isPrimary === false) return;
    if(event.target.closest('.person-menu-trigger'))return;
    const item = event.target.closest('.day-event-row, .calendar-event, .avatar-person, .person-card');
    if (!item) return;
    const list = item.matches('.day-event-row');
    const rail=item.matches('.avatar-person');
    const calendar = grid.contains(item) || list || rail, touch = event.pointerType !== 'mouse';
    if (!calendar && !touch) return;
    const abort = new AbortController();
    const current = gesture = { item, calendar, list, touch, from:list ? item.dataset.date : item.closest('.day-cell')?.dataset.date,
      pointerId:event.pointerId, x:event.clientX, y:event.clientY, lastX:event.clientX, lastY:event.clientY, abort, active:false };
    const updateTarget = (x, y) => {
      if (!current.ghost) return;
      current.ghost.style.left = `${x+12}px`; current.ghost.style.top = `${y-25}px`;
      current.lastX=x; current.lastY=y;
      if (list && !current.leftList) {
        const body = item.closest('.detail-body'), rect = body.getBoundingClientRect();
        current.insertion?.classList.remove('insert-before', 'insert-after'); current.insertion=null;
        if (x < rect.left-18 || x > rect.right+18 || y < rect.top-24 || y > rect.bottom+24) {
          current.leftList = true;
          // capture先は残るdocumentElement。モーダルを閉じても追跡とghostは維持する。
          doc.body.append(current.ghost); onLeaveList?.();
        } else {
          const row = doc.elementFromPoint(x,y)?.closest('.day-event-row');
          if (row && row !== item) {
            current.insertion=row; current.after=y > row.getBoundingClientRect().top+row.offsetHeight/2;
            row.classList.add(current.after ? 'insert-after' : 'insert-before');
          }
          return;
        }
      }
      const cell = doc.elementFromPoint(x, y)?.closest('.day-cell');
      const target = cell && grid.contains(cell) ? cell : null;
      current.target?.classList.remove('drop-target'); current.target = target;
      target?.classList.add('drop-target');
    };
    const arm = () => {
      if (gesture !== current) return;
      current.active = true;
      if (!calendar) { if(onMenu)onMenu(item.dataset.personId,item);else onSelect(item.dataset.personId); return; }
      item.classList.add('dragging');
      const ghost = item.cloneNode(true); ghost.classList.add('drag-ghost');
      ghost.classList.remove('dragging', 'insert-before', 'insert-after');
      ghost.setAttribute('aria-hidden', 'true'); ghost.removeAttribute('aria-label'); ghost.tabIndex = -1;
      current.ghost = ghost; doc.body.append(ghost);
      if (list) item.closest('dialog').append(ghost);
      current.capture = list || rail ? doc.documentElement : item;
      try { current.capture.setPointerCapture(event.pointerId); } catch { /* documentでも追跡 */ }
      if(rail)onRailStart?.();
      updateTarget(current.x, current.y);
      const scroll = () => {
        if (gesture !== current) return;
        const scroller = list && !current.leftList ? item.closest('.detail-body') : null;
        const bounds = scroller?.getBoundingClientRect() ?? {top:0,bottom:win.innerHeight};
        const delta = current.lastY < bounds.top+32 ? -6 : current.lastY > bounds.bottom-32 ? 6 : 0;
        if (delta) { if(scroller)scroller.scrollTop+=delta;else win.scrollBy(0,delta);updateTarget(current.lastX,current.lastY); }
        current.frame=win.requestAnimationFrame(scroll);
      };
      current.frame=win.requestAnimationFrame(scroll);
    };
    const options = { signal:abort.signal };
    doc.addEventListener('pointermove', (move) => {
      if (move.pointerId !== current.pointerId) return;
      const distance = Math.hypot(move.clientX-current.x, move.clientY-current.y);
      if (!current.active && distance > 9) { if (touch) { clean(); return; } arm(); }
      if (current.active && calendar) { move.preventDefault(); updateTarget(move.clientX, move.clientY); }
    }, options);
    doc.addEventListener('touchmove', (move) => { if (current.active) move.preventDefault(); }, { ...options, passive:false });
    doc.addEventListener('pointerup', (up) => {
      if (up.pointerId !== current.pointerId) return;
      if (current.active) {
        suppressed = { item, until:Date.now()+800 };
        if (calendar) {
          updateTarget(up.clientX, up.clientY);
          if (list && !current.leftList) {
            const rows=[...item.parentElement.querySelectorAll('.day-event-row')];
            if (current.insertion) {
              const ordered=rows.filter(row=>row!==item), index=ordered.indexOf(current.insertion)+(current.after?1:0);
              ordered.splice(index,0,item);const ids=ordered.map(row=>row.dataset.entryId),from=current.from;
              clean();onReorder?.(from,ids);return;
            }
            clean(); return;
          }
          const to = current.target?.dataset.date;
          const payload = { personId:item.dataset.personId, key:item.dataset.eventKey, from:current.from, to, sourceList:list, sourceRail:rail };
          clean(); if (to && to !== payload.from) onMove(payload); else if (list) onCancelList?.(); return;
        }
      }
      clean();
    }, options);
    doc.addEventListener('pointercancel', cancel, options);
    doc.addEventListener('keydown', (key) => { if (key.key === 'Escape') { key.preventDefault();cancel(key); } }, options);
    if (touch) current.timer = setTimeout(arm, 550);
  };
  const click = (event) => {
    if (event.detail > 0 && suppressed && Date.now() < suppressed.until) {
      event.preventDefault(); event.stopImmediatePropagation(); suppressed = null;
    }
  };
  const menu = (event) => { if (event.target.closest('.day-event-row, .calendar-event, .avatar-person, .person-card')) event.preventDefault(); };
  const key = (event) => {
    if(!enabled())return;
    const item = event.target.closest('.avatar-person, .person-card');
    if (item && event.shiftKey && event.key === 'Enter') { event.preventDefault(); onSelect(item.dataset.personId); }
  };
  for (const root of roots) {
    root.addEventListener('pointerdown', start);
    root.addEventListener('contextmenu', menu); root.addEventListener('keydown', key);
  }
  win.addEventListener('pagehide', cancel); win.addEventListener('blur', cancel);
  // 長押し後にレイアウトが変わりclickの対象が変わっても二重操作しない。
  // 次の独立したタップはpointerdownで解除し、操作を待たせない。
  const newPointer = (event) => { suppressed = null; if (gesture && event.pointerId !== gesture.pointerId) cancel(); };
  doc.addEventListener('pointerdown', newPointer, true); doc.addEventListener('click', click, true);
  const hidden = () => { if (doc.visibilityState === 'hidden') cancel({type:'visibilitychange'}); };
  doc.addEventListener('visibilitychange', hidden);
  return { cancel:() => cancel({type:'refresh'}), destroy() { cancel({type:'destroy'}); for (const root of roots) {
    root.removeEventListener('pointerdown', start);
    root.removeEventListener('contextmenu', menu); root.removeEventListener('keydown', key);
  } win.removeEventListener('pagehide', cancel); win.removeEventListener('blur', cancel); doc.removeEventListener('visibilitychange', hidden);
    doc.removeEventListener('pointerdown', newPointer, true); doc.removeEventListener('click', click, true); } };
}
