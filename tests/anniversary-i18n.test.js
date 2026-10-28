import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, t, anniversaryLabel } from '../src/i18n.js';

test('記念日UIと通知は日本語・英語を切替でき、入力した名称は翻訳しない', () => {
  const previous = globalThis.document;
  globalThis.document = { documentElement: { lang: 'ja' } };
  try {
    setLanguage('ja');
    assert.equal(t('addAnniversary'), '＋ 記念日を追加');
    assert.equal(t('anniversaryYears', { years: 3 }), '3周年');
    assert.equal(t('annNoticeToday', { name: '太郎', title: '出会った日' }),
      '今日は太郎の「出会った日」です');
    setLanguage('en');
    assert.equal(globalThis.document.documentElement.lang, 'en');
    assert.equal(t('addAnniversary'), '+ Add anniversary');
    assert.equal(t('anniversaryYears', { years: 3 }), '3 years');
    assert.equal(anniversaryLabel('FRIEND_SINCE'), 'Became friends');
    assert.match(t('annNoticeToday', { name: 'Taro', title: '出会った日' }), /出会った日/);
  } finally {
    globalThis.document = previous;
    if (previous) setLanguage('ja');
  }
});

test('カレンダーの一覧・省略予定ラベルは日英で入力済み名称と件数を保つ', () => {
  const previous = globalThis.document;
  globalThis.document = { documentElement:{ lang:'ja' } };
  try {
    setLanguage('ja');
    assert.equal(t('calendarEventList', { name:'太郎', event:'出会った日' }), '太郎・出会った日がある日の予定一覧を開く');
    assert.match(t('calendarMoreEvents', { count:2 }), /予定2件/);
    setLanguage('en');
    assert.equal(t('calendarEventList', { name:'太郎', event:'出会った日' }), 'Open events on this date · 太郎 · 出会った日');
    assert.match(t('calendarMoreEvents', { count:2 }), /2 hidden events/);
  } finally { setLanguage('ja'); globalThis.document = previous; }
});

test('日付からの人物登録と空の予定一覧を日本語・英語で案内する', () => {
  const previous = globalThis.document;
  globalThis.document = { documentElement:{ lang:'ja' } };
  try {
    setLanguage('ja');
    assert.equal(t('addOnDate'), 'この日に新しい人物を登録');
    assert.equal(t('emptyDay'), 'この日の予定はありません');
    assert.equal(t('assignBirthdayOnDate', { name:'太郎' }), 'この日を太郎の誕生日にする');
    setLanguage('en');
    assert.equal(t('addOnDate'), 'Add a new person on this date');
    assert.equal(t('emptyDay'), 'No events on this date');
    assert.equal(t('assignBirthdayOnDate', { name:'太郎' }), 'Set this date as 太郎’s birthday');
  } finally { setLanguage('ja'); globalThis.document = previous; }
});
