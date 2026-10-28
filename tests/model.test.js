import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, daysBetween, birthdayRows, filterPeople, normalizePerson,
  tokyoToday, anniversaryRows, anniversaryYears, occurrenceForYear,
  nextEventOccurrence, calendarEvents } from '../src/model.js';

const birthday = (month, day) => ({ type: 'BIRTHDAY', month, day, year: null, showAge: false });
const person = (name, month = null, day = null, category = 'OTHER') => normalizePerson({
  displayName: name, category, anniversaries: month ? [birthday(month, day)] : [], links: [],
});

test('年跨ぎと2月29日はSpring版と同じ日付ルール', () => {
  assert.equal(nextOccurrence(birthday(1, 2), '2026-12-31'), '2027-01-02');
  assert.equal(daysBetween('2026-12-31', '2027-01-02'), 2);
  assert.equal(nextOccurrence(birthday(2, 29), '2027-02-27'), '2027-02-28');
  assert.equal(nextOccurrence(birthday(2, 29), '2028-02-27'), '2028-02-29');
  assert.equal(tokyoToday(new Date('2026-12-31T15:30:00Z')), '2027-01-01');
});

test('誕生日一覧は次回日付順で未登録を除外', () => {
  const people = [person('未登録'), person('元日', 1, 1), person('大晦日', 12, 31)];
  const rows = birthdayRows(people, '2026-12-30');
  assert.deepEqual(rows.map((row) => [row.person.displayName, row.daysUntil]), [['大晦日', 1], ['元日', 2]]);
});

test('カテゴリ・月・検索・未登録フィルターを組み合わせる', () => {
  const people = [person('山田さん', 8, 27, 'X_FRIEND'), person('佐藤さん', null, null, 'X_FRIEND'),
    person('ミク', 8, 31, 'CHARACTER')];
  assert.deepEqual(filterPeople(people, { category: 'X_FRIEND', birthday: 'unregistered' })
    .map((p) => p.displayName), ['佐藤さん']);
  assert.deepEqual(filterPeople(people, { category: 'CHARACTER', month: 8, search: 'ミク' })
    .map((p) => p.displayName), ['ミク']);
});

test('不正なX URL・危険なURL・不正日付は拒否', () => {
  assert.throws(() => normalizePerson({ displayName: 'A', xProfileUrl: 'https://evil.example/me' }));
  assert.throws(() => normalizePerson({ displayName: 'A', username: 'one', xProfileUrl: 'https://x.com/two' }));
  assert.throws(() => normalizePerson({ displayName: 'A', links: [{ url: 'javascript:alert(1)' }] }));
  assert.throws(() => normalizePerson({ displayName: 'A', anniversaries: [birthday(4, 31)] }));
  assert.equal(normalizePerson({ displayName: 'A', username: '@neko' }).xProfileUrl, 'https://x.com/neko');
});

test('記念日0件・1件・複数件と年なし/年ありを保存できる', () => {
  const empty = person('ゼロ'); assert.deepEqual(empty.anniversaries, []);
  const one = normalizePerson({ displayName:'一人', anniversaries:[
    { type:'CUSTOM', title:'○○の日', month:8, day:15, recurring:true, notify:false },
  ] });
  assert.equal(one.anniversaries[0].year, null);
  const two = normalizePerson({ ...one, anniversaries:[...one.anniversaries,
    { type:'CUSTOM', title:'出会った日', month:5, day:10, year:2024,
      recurring:true, showAnniversary:true, notify:true }], links:[] }, one);
  assert.equal(two.anniversaries.length, 2);
  assert.equal(two.anniversaries[0].id, one.anniversaries[0].id);
  assert.equal(two.anniversaries[1].title, '出会った日');
  assert.equal(anniversaryYears(two.anniversaries[1], '2027-05-10'), 3);
  assert.equal(anniversaryYears(two.anniversaries[1], '2024-05-10'), null);
  assert.equal(anniversaryYears(two.anniversaries[0], '2027-08-15'), null);
});

test('記念日の年跨ぎ・2月29日・一度きり・同日複数を扱う', () => {
  const recurring = { type:'CUSTOM', title:'うるう', month:2, day:29,
    year:2024, recurring:true, showAnniversary:true };
  assert.equal(nextEventOccurrence(recurring, '2026-12-31'), '2027-02-28');
  assert.equal(occurrenceForYear(recurring, 2028), '2028-02-29');
  assert.equal(occurrenceForYear(recurring, 2027), '2027-02-28');
  const once = { type:'CUSTOM', title:'一回', month:1, day:2, year:2027, recurring:false };
  assert.equal(nextEventOccurrence(once, '2026-12-31'), '2027-01-02');
  assert.equal(nextEventOccurrence(once, '2027-01-03'), null);
  assert.equal(occurrenceForYear(once, 2028), null);
  const same = normalizePerson({ displayName:'同日', category:'PET', anniversaries:[
    birthday(5, 10),
    { type:'CUSTOM', title:'A', month:5, day:10 },
    { type:'CUSTOM', title:'B', month:5, day:10 },
  ] });
  assert.equal(anniversaryRows([same], '2027-05-10').length, 2);
  assert.equal(birthdayRows([same], '2027-05-10').length, 1);
  assert.equal(anniversaryRows([same], '2027-05-10').filter((r) => r.daysUntil === 0).length, 2);
});

test('不正な記念日名称・日付・重複ID・一度きりの年なしを拒否', () => {
  const make = (anniversaries) => normalizePerson({ displayName:'検証', anniversaries });
  assert.throws(() => make([{ type:'CUSTOM', title:'', month:5, day:10 }]));
  assert.throws(() => make([{ type:'CUSTOM', title:'A', month:2, day:30 }]));
  assert.throws(() => make([{ type:'CUSTOM', title:'A', month:5, day:10, recurring:false }]));
  const id = crypto.randomUUID();
  assert.throws(() => make([{ id, type:'CUSTOM', title:'A', month:5, day:10 },
    { id, type:'CUSTOM', title:'B', month:5, day:11 }]));
});

test('カテゴリと予定種類を併用してカレンダーを絞る', () => {
  const pet = normalizePerson({ displayName:'ペット', category:'PET', anniversaries:[birthday(5, 10),
    { type:'CUSTOM', title:'お迎え日', month:5, day:10 }] });
  const friend = normalizePerson({ displayName:'友人', category:'REAL_FRIEND', anniversaries:[birthday(5, 10),
    { type:'CUSTOM', title:'出会い', month:5, day:10 }] });
  assert.equal(calendarEvents([pet, friend], 2027, 5).get('2027-05-10').length, 4);
  assert.equal(calendarEvents([pet, friend], 2027, 5, 'PET', 'ANNIVERSARY')
    .get('2027-05-10')[0].ann.title, 'お迎え日');
  assert.equal(calendarEvents([pet, friend], 2027, 5, 'REAL_FRIEND', 'BIRTHDAY')
    .get('2027-05-10').length, 1);
  assert.equal(calendarEvents([pet, friend], 2027, 6).size, 0);
});

test('カレンダーは同じ人物の複数予定も省略せずイベント単位で保持する', () => {
  const a = normalizePerson({ displayName:'同日3予定', category:'PET', anniversaries:[birthday(5, 10),
    { type:'CUSTOM', title:'お迎え日', month:5, day:10 },
    { type:'CUSTOM', title:'もう一つ', month:5, day:10 }] });
  const b = normalizePerson({ displayName:'同日2予定', anniversaries:[birthday(5, 10),
    { type:'CUSTOM', title:'出会った日', month:5, day:10 }] });
  const rows = calendarEvents([a, b], 2027, 5).get('2027-05-10');
  assert.equal(rows.length, 5);
  assert.equal(rows.filter((row) => row.person.id === a.id).length, 3);
  assert.equal(rows.filter((row) => row.ann.type === 'BIRTHDAY').length, 2);
  assert.equal(calendarEvents([a, b], 2027, 5, 'PET', 'ANNIVERSARY').get('2027-05-10').length, 2);
});
