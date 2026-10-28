import test from 'node:test';
import assert from 'node:assert/strict';
import { homeOverview } from '../src/home.js';
import { normalizePerson } from '../src/model.js';
import { setLanguage, t } from '../src/i18n.js';
const person=(name,month,day,others=[])=>normalizePerson({displayName:name,category:'OTHER',links:[],
  anniversaries:[...(month?[{type:'BIRTHDAY',month,day}]:[]),...others]});
const ann=(title,month,day)=>({type:'CUSTOM',title,month,day,notify:false});

test('ホーム空状態は4区分で空を返し、旧統計も計算可能',()=>{
  const data=homeOverview([],'2027-01-01');
  assert.deepEqual(data,{today:[],next:null,nextBirthdays:[],upcoming:[],anniversaries:[],counts:{today:0,seven:0,month:0}});
});
test('今日の誕生日と複数記念日をそれぞれ表示し、人物・IDを保持',()=>{
  const people=[person('今日',5,10,[ann('出会い',5,10),ann('応援',5,10)]),person('別の人',5,10)];
  const before=structuredClone(people),data=homeOverview(people,'2027-05-10');
  assert.equal(data.today.length,4);assert.equal(new Set(data.today.filter(e=>e.ann.id).map(e=>e.ann.id)).size,2);
  assert.equal(data.next,null);assert.deepEqual(data.nextBirthdays,[]);assert.deepEqual(data.upcoming,[]);assert.equal(data.counts.today,2);assert.deepEqual(people,before);
});
test('次の1件・30日以内の誕生日・14日以内の記念日を境界込みで選ぶ',()=>{
  const people=[person('30日後',1,31),person('今日',1,1),person('31日後',2,1),person('記念日だけ',null,null,[ann('14日後',1,15),ann('15日後',1,16)])];
  const data=homeOverview(people,'2027-01-01');assert.equal(data.next.person.displayName,'30日後');
  assert.deepEqual(data.upcoming.map(r=>r.daysUntil),[30]);assert.deepEqual(data.anniversaries.map(r=>r.ann.title),['14日後']);
});
test('誕生日は年末から年始へ、2/29は平年2/28・うるう年2/29',()=>{
  assert.equal(homeOverview([person('元日',1,1)],'2026-12-31').next.daysUntil,1);
  const leap=[person('うるう',2,29,[ann('うるう記念日',2,29)])];
  assert.equal(homeOverview(leap,'2027-02-28').today.length,2);
  assert.equal(homeOverview(leap,'2027-02-27').next.nextDate,'2027-02-28');
  assert.equal(homeOverview(leap,'2028-02-28').next.nextDate,'2028-02-29');
});
test('単発の過去記念日は近日に残さず、非誕生日の記念日を14日以内に出す',()=>{
  const p=person('記念日',null,null,[{...ann('過去',12,31),year:2026,recurring:false},ann('翌年',1,2)]);
  const data=homeOverview([p],'2027-01-01');assert.equal(data.next,null);assert.deepEqual(data.anniversaries.map(r=>r.ann.title),['翌年']);
});
test('ホームの新見出し・空状態は日本語とEnglishで切り替え可能',()=>{
  const prev=globalThis.document;globalThis.document={documentElement:{lang:'ja'}};
  try{setLanguage('ja');assert.equal(t('todayEvents'),'今日の予定');assert.match(t('noTodayEvents'),/予定/);
    setLanguage('en');assert.equal(t('todayEvents'),"Today's events");assert.equal(t('noTodayEvents'),'No events scheduled for today.');
  }finally{setLanguage('ja');globalThis.document=prev;}
});

test('次回同日2人を返し、異なる日付と未登録を除外する',()=>{
  const people=[person('A',11,5),person('B',11,5),person('翌日',11,6),person('未登録',null,null)];
  assert.deepEqual(homeOverview(people,'2027-11-01').nextBirthdays.map(r=>r.person.displayName),['A','B']);
});
test('同日3人以上と年なしを全員表示し、元データを変更しない',()=>{
  const people=['C','A','D','B'].map(name=>person(name,11,5)),before=structuredClone(people);
  assert.deepEqual(homeOverview(people,'2027-11-01').nextBirthdays.map(r=>r.person.displayName),['A','B','C','D']);
  assert.deepEqual(people,before);
});
test('同日の手動順を優先し、未設定同士は既存の名前・ID順を維持する',()=>{
  const people=['A','B','C','D'].map(name=>person(name,11,5));
  people[1].anniversaries[0].calendarOrder=1;people[2].anniversaries[0].calendarOrder=0;
  assert.deepEqual(homeOverview(people,'2027-11-01').nextBirthdays.map(r=>r.person.displayName),['C','B','A','D']);
});
test('12月31日と元日をまたぐ次回同日グループを取りこぼさない',()=>{
  const people=[person('元日A',1,1),person('元日B',1,1),person('大晦日',12,31)];
  assert.equal(homeOverview(people,'2027-12-30').nextBirthdays.length,1);
  assert.equal(homeOverview(people,'2027-12-31').nextBirthdays.length,2);assert.equal(homeOverview(people,'2027-12-31').nextBirthdays[0].daysUntil,1);
  const next=homeOverview(people,'2028-01-01');assert.equal(next.nextBirthdays.length,1);assert.equal(next.next.person.displayName,'大晦日');assert.equal(next.today.length,2);
  assert.equal(homeOverview(people.slice(0,2),'2027-12-31').nextBirthdays[0].nextDate,'2028-01-01');
});
test('平年は2月28日と29日生まれを同日表示し、うるう年は分ける',()=>{
  const people=[person('28日',2,28),person('29日A',2,29),person('29日B',2,29)];
  assert.equal(homeOverview(people,'2027-02-27').nextBirthdays.length,3);
  assert.equal(homeOverview(people,'2028-02-27').nextBirthdays.length,1);
  assert.equal(homeOverview(people,'2028-02-29').nextBirthdays.length,1);assert.equal(homeOverview(people,'2028-02-29').today.length,2);
});
test('当日誕生日は全員今日へ表示し次回・30日一覧は空、当日の記念日は維持',()=>{
  const people=[person('A',5,10,[ann('同日記念日',5,10)]),person('B',5,10),person('C',5,10)];
  const data=homeOverview(people,'2027-05-10');
  assert.equal(data.today.length,4);assert.equal(data.nextBirthdays.length,0);assert.equal(data.upcoming.length,0);assert.equal(data.anniversaries.length,1);
});

test('当日1人と明日2人は今日と次回へ分離し、次回と近日の重複は維持',()=>{
  const people=[person('今日',5,10),person('明日A',5,11),person('明日B',5,11)],before=structuredClone(people);
  const data=homeOverview(people,'2027-05-10');
  assert.deepEqual(data.today.map(e=>e.person.displayName),['今日']);
  assert.deepEqual(data.nextBirthdays.map(r=>r.person.displayName),['明日A','明日B']);
  assert.deepEqual(data.upcoming.map(r=>r.person.displayName),['明日A','明日B']);assert.deepEqual(people,before);
});
test('当日だけ1人の場合は翌年へ再表示せず既存の空データを返す',()=>{
  const data=homeOverview([person('今日だけ',5,10)],'2027-05-10');
  assert.equal(data.today.length,1);assert.equal(data.next,null);assert.deepEqual(data.nextBirthdays,[]);assert.deepEqual(data.upcoming,[]);
});
test('当日を除いた次回同日グループにも手動順を適用する',()=>{
  const people=[person('今日',5,10),person('A',5,11),person('B',5,11)];people[2].anniversaries[0].calendarOrder=0;
  const data=homeOverview(people,'2027-05-10');assert.deepEqual(data.nextBirthdays.map(r=>r.person.displayName),['B','A']);
});
test('当日以外が31日後だけなら次回へ表示し30日以内は空にする',()=>{
  const data=homeOverview([person('今日',1,1),person('次回',2,1)],'2027-01-01');
  assert.equal(data.next.daysUntil,31);assert.equal(data.nextBirthdays.length,1);assert.deepEqual(data.upcoming,[]);
});
test('平年2/28当日は2/29生まれも今日へ限定し、翌日の人物を次回へ出す',()=>{
  const data=homeOverview([person('28日',2,28),person('29日',2,29),person('明日',3,1)],'2027-02-28');
  assert.equal(data.today.length,2);assert.deepEqual(data.nextBirthdays.map(r=>r.person.displayName),['明日']);assert.deepEqual(data.upcoming.map(r=>r.daysUntil),[1]);
});
test('日付が翌日になれば新しい今日を除外し、前日の人は通常の翌年計算を維持',()=>{
  const people=[person('10日',5,10),person('11日',5,11)];
  const data=homeOverview(people,'2027-05-11');assert.equal(data.today[0].person.displayName,'11日');
  assert.equal(data.next.person.displayName,'10日');assert.equal(data.next.nextDate,'2028-05-10');assert.deepEqual(data.upcoming,[]);
});
