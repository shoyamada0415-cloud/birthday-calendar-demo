// browser-smokeの一時プロファイルだけで、日付→一覧→既存フォームを操作する。
export async function verifyCalendarRegistration({ evaluate, until, check }) {
  const people = () => evaluate(`new Promise((done,fail)=>{const r=indexedDB.open('birthday-calendar-demo');
    r.onsuccess=()=>{const db=r.result,q=db.transaction('people').objectStore('people').getAll();
      q.onsuccess=()=>{db.close();done(q.result);};q.onerror=()=>{db.close();fail(q.error);};};r.onerror=()=>fail(r.error);})`);
  check((await people()).length === 0, '日付登録検証は空の一時DBでのみ実行します。');
  await evaluate(`window.__openCalendarDay=(year,month,day)=>{document.querySelector('[data-tab=calendar]').click();
    const current=document.querySelector('#month-title').textContent.match(/(\\d+)年(\\d+)月/);
    const difference=year*12+month-1-(Number(current[1])*12+Number(current[2])-1);
    if(Math.abs(difference)>120)throw new Error('Unexpected calendar range');
    for(let i=0;i<Math.abs(difference);i++)document.querySelector(difference>0?'#month-next':'#month-prev').click();
    const date=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    document.querySelector('[data-date="'+date+'"] .day-open').click();};`);
  const closeForm = async () => {
    await evaluate('document.querySelector("#person-dialog [data-close]").click()');
    await until(() => evaluate('!document.querySelector("#person-dialog").open'), '登録キャンセル');
  };
  const boundaries = [[2028,2,29], [2027,12,31], [2028,1,1]];
  for (const [year, month, day] of boundaries) {
    await evaluate(`window.__openCalendarDay(${year},${month},${day})`);
    const list = await evaluate(`({open:document.querySelector('#detail-dialog').open,
      empty:document.querySelector('#detail-body').textContent,button:!document.querySelector('#day-add').hidden,
      form:document.querySelector('#person-dialog').open,dialogs:document.querySelectorAll('dialog[open]').length,
      height:document.querySelector('#day-add').getBoundingClientRect().height,scroll:document.documentElement.scrollWidth})`);
    check(list.open && list.empty === 'この日の予定はありません' && list.button && !list.form
      && list.dialogs === 1 && list.height >= 44 && list.scroll <= 390, `空の日付一覧が不正: ${JSON.stringify(list)}`);
    await evaluate('document.querySelector("#day-add").click()');
    const form = await evaluate(`({month:document.querySelector('#person-birth-month').value,
      day:document.querySelector('#person-birth-day').value,year:document.querySelector('#person-birth-year').value,
      focused:document.activeElement.id,dialogs:document.querySelectorAll('dialog[open]').length})`);
    check(form.month === String(month) && form.day === String(day) && form.year === ''
      && form.focused === 'person-name' && form.dialogs === 1, `日付の初期値かダイアログが不正: ${JSON.stringify(form)}`);
    await closeForm();
    await until(() => evaluate('document.activeElement.classList.contains("day-open")'), 'キャンセル後の日付フォーカス');
    check((await people()).length === 0, 'キャンセルで人物を作成しています。');
    await evaluate('document.querySelector("[data-tab=calendar]").click();document.querySelector("#calendar-add").click()');
    check(await evaluate('document.querySelector("#person-birth-month").value === "" && document.querySelector("#person-birth-day").value === "" && document.querySelector("#person-birth-year").value === ""'), '通常追加に前回の日付が残っています。');
    await closeForm();
  }
  await evaluate(`(()=>{window.__openCalendarDay(2028,1,1);document.querySelector('#detail-dialog [data-close]').click();
    document.querySelector('#calendar-category').value='PET';document.querySelector('#calendar-category').dispatchEvent(new Event('change'));
    document.querySelector('#calendar-event-type').value='ANNIVERSARY';document.querySelector('#calendar-event-type').dispatchEvent(new Event('change'));
    window.__openCalendarDay(2028,1,1);document.querySelector('#day-add').click();
    document.querySelector('#person-name').value='日付導線テスト';document.querySelector('#person-birth-month').value='2';
    document.querySelector('#person-birth-day').value='30';document.querySelector('#person-form').requestSubmit();})()`);
  await until(() => evaluate('!document.querySelector("#person-error").hidden'), '不正日付の検証');
  check((await people()).length === 0 && await evaluate('document.querySelector("#person-dialog").open && document.querySelector("#person-name").value === "日付導線テスト" && document.querySelector("#person-birth-day").value === "30"'), '保存失敗時に入力またはデータが失われました。');
  await evaluate(`(()=>{document.querySelector('#person-birth-day').value='29';const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(stores,mode,...args){const tx=original.call(this,stores,mode,...args);
      if(mode==='readwrite' && [...tx.objectStoreNames].includes('people')){IDBDatabase.prototype.transaction=original;queueMicrotask(()=>tx.abort());}return tx;};
    document.querySelector('#person-form').requestSubmit();})()`);
  await until(() => evaluate('!document.querySelector("#person-error").hidden && document.querySelector("#person-error").textContent.includes("保存を完了できませんでした")'), 'DB書き込み失敗の案内');
  check((await people()).length === 0 && await evaluate('document.querySelector("#person-dialog").open && document.querySelector("#person-name").value === "日付導線テスト" && document.querySelector("#person-birth-day").value === "29"'), 'DB書き込み失敗で入力を失いました。');
  await evaluate('document.querySelector("#person-birth-day").value="29";document.querySelector("#person-form").requestSubmit()');
  await until(() => evaluate('!document.querySelector("#person-dialog").open && document.querySelector("#month-title").textContent === "2028年2月" && !!document.querySelector("[data-date=\\"2028-02-29\\"] .calendar-event")'), '変更後の日付で人物登録');
  const created = (await people())[0];
  check(created.anniversaries[0].year === null && created.anniversaries[0].month === 2
    && created.anniversaries[0].day === 29 && !created.hasImage, '生年または変更後の誕生日が不正です。');
  check(await evaluate('document.querySelector("#calendar-category").value === "ALL" && document.querySelector("#calendar-event-type").value === "ALL" && document.querySelector(".calendar-event .avatar").textContent === "日" && location.hash === "#calendar"'), '登録後に人物がカレンダーへ表示されません。');
  await evaluate(`(()=>{document.querySelector('.calendar-event').click();document.querySelector('#detail-body .day-event-row').click();document.querySelector('#detail-edit').click();
    document.querySelector('#person-birth-month').value='12';document.querySelector('#person-birth-month').dispatchEvent(new Event('change'));document.querySelector('#person-birth-day').value='31';
    document.querySelector('#person-form').requestSubmit();})()`);
  await until(async () => (await people())[0].anniversaries[0].month === 12
    && await evaluate('document.querySelector("#people-list .person-card").textContent.includes("12月31日")'), '登録後の誕生日編集');
  await evaluate('window.__openCalendarDay(2028,12,31)');
  check(await evaluate('document.querySelector("#detail-body .item-row") !== null && !document.querySelector("#day-add").hidden && document.querySelector(".detail-top") === null && !document.querySelector("#person-dialog").open'), '予定1件の日付が一覧を経由しません。');
  await evaluate('document.querySelector("#detail-body .item-row").click()');
  check(await evaluate('document.querySelector(".detail-top h3").textContent === "日付導線テスト" && document.querySelector("#day-add").hidden'), '予定項目から人物詳細へ遷移できません。');
  await evaluate('document.querySelector("#detail-choose").click();window.__openCalendarDay(2029,1,1)');
  check(await evaluate('!document.querySelector("#day-assign").hidden'), '既存人物の誕生日選択を失っています。');
  await evaluate('document.querySelector("#day-assign").click()');
  await until(async () => (await people())[0].anniversaries[0].month === 1
    && await evaluate('document.querySelector("#toast").textContent.includes("1月1日")'), '一覧から既存人物へ誕生日割り当て');
  await evaluate('window.__openCalendarDay(2029,1,1);document.querySelector("#day-add").click()');
  await closeForm();
  check((await people()).length === 1, '既存予定からの登録キャンセルで人物数が変化しました。');
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const select=document.querySelector('#language-choice');
    select.value='en';select.dispatchEvent(new Event('change'));})()`);
  await until(() => evaluate('document.documentElement.lang === "en"'), '日付登録の英語');
  await evaluate(`(()=>{document.querySelector('[data-tab=calendar]').click();
    document.querySelector('[data-date="2029-01-02"] .day-open').click();})()`);
  check(await evaluate('document.querySelector("#detail-body").textContent === "No events on this date" && document.querySelector("#day-add").textContent === "Add a new person on this date" && document.querySelector("#detail-dialog h2").textContent === "Events on 1/2"'), '日付一覧の英語表示が不正です。');
  await evaluate('document.querySelector("#day-add").click()'); await closeForm();
  await evaluate(`(()=>{document.querySelector('[data-tab=settings]').click();const select=document.querySelector('#language-choice');
    select.value='ja';select.dispatchEvent(new Event('change'));})()`);
  await until(() => evaluate('document.documentElement.lang === "ja"'), '日付登録の日本語復帰');
  await evaluate(`(()=>{window.__registrationOriginalConfirm=window.confirm;window.confirm=()=>true;
    document.querySelector('[data-tab=people]').click();document.querySelector('.person-card').click();
    document.querySelector('#detail-edit').click();document.querySelector('#delete-person').click();})()`);
  await until(async () => (await people()).length === 0
    && await evaluate('document.querySelectorAll("#people-list .person-card").length === 0'), '一時検証人物の後片付け');
  await evaluate(`window.confirm=window.__registrationOriginalConfirm;document.querySelector('#calendar-today').click();document.querySelector('[data-tab=home]').click();`);
  return { boundaries, emptyDay:true, singleEvent:true, presetYear:null, changedBeforeSave:true,
    invalidSavePreserved:true, databaseFailurePreserved:true, cancelPreserved:true, ordinaryAddReset:true, selectedBirthdayAssignment:true, english:true };
}
