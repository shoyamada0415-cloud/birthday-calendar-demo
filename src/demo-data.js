export const DEMO_MARKER_KEY = 'interview-demo-seeded';
export const DEMO_DATA_VERSION = 1;

const CREATED_AT = '2026-10-28T00:00:00.000Z';

const DEFINITIONS = Object.freeze([
  {
    id: '10000000-0000-4000-8000-000000000001',
    displayName: '佐藤 はるか', category: 'REAL_FRIEND', month: 1, day: 15,
    memo: '面談用の架空データです。分類: 友人。休日はカフェ巡りを楽しんでいます。',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    displayName: '鈴木 けんた', category: 'OTHER', month: 3, day: 8,
    memo: '面談用の架空データです。分類: ゲーム仲間。協力プレイでよく遊びます。',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    displayName: '田中 みさき', category: 'REAL_FRIEND', month: 5, day: 22,
    memo: '面談用の架空データです。分類: 友人。読書と写真が好きです。',
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    displayName: '高橋 そうた', category: 'X_FRIEND', month: 7, day: 7,
    memo: '面談用の架空データです。分類: SNS。個人情報や実在アカウントは使用していません。',
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    displayName: '伊藤 あおい', category: 'OTHER', month: 10, day: 30,
    memo: '面談用の架空データです。分類: ゲーム仲間。新作ゲームの情報交換をしています。',
  },
]);

export function demoPeople() {
  return DEFINITIONS.map(({ month, day, ...person }) => ({
    ...person,
    username: null,
    xProfileUrl: null,
    seriesName: '',
    anniversaries: [{ type: 'BIRTHDAY', month, day, year: null, showAge: false }],
    links: [],
    hasImage: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }));
}

function completed(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Demoデータを保存できませんでした。'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Demoデータを保存できませんでした。'));
  });
}

// 初回かつ人物が0件の場合だけ投入する。人物が既にある場合もmarkerを残し、後の空状態を上書きしない。
export async function ensureDemoData(db) {
  const tx = db.transaction(['people', 'settings'], 'readwrite');
  const done = completed(tx);
  const people = tx.objectStore('people');
  const settings = tx.objectStore('settings');
  let markerReady = false, countReady = false, marker, count = 0, seeded = false, applied = false;
  const apply = () => {
    if (applied || !markerReady || !countReady) return;
    applied = true;
    if (!marker) {
      if (count === 0) {
        for (const person of demoPeople()) people.put(person);
        seeded = true;
      }
      settings.put({ key: DEMO_MARKER_KEY, value: { version: DEMO_DATA_VERSION, seeded } });
    }
  };
  settings.get(DEMO_MARKER_KEY).onsuccess = (event) => { marker = event.target.result; markerReady = true; apply(); };
  people.count().onsuccess = (event) => { count = event.target.result; countReady = true; apply(); };
  await done;
  return { seeded, people: seeded ? demoPeople().length : count };
}

// Demo専用DBの人物・画像・通知だけを初期状態へ戻す。言語・外観などの設定は保持する。
export async function resetDemoData(db) {
  const tx = db.transaction(['people', 'images', 'notifications', 'settings'], 'readwrite');
  const done = completed(tx);
  tx.objectStore('people').clear();
  tx.objectStore('images').clear();
  tx.objectStore('notifications').clear();
  for (const person of demoPeople()) tx.objectStore('people').put(person);
  tx.objectStore('settings').put({ key: DEMO_MARKER_KEY, value: { version: DEMO_DATA_VERSION, seeded: true } });
  await done;
  return demoPeople().length;
}
