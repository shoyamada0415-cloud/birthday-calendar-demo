import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DB_NAME} from '../src/db.js';
import {SHELL_PREFIX} from '../src/cache-ops.js';
import {RETIRED_KEY,SESSION_LOCK,ownedCacheNames} from '../src/data-lifecycle.js';

test('Demoは本番PWAと異なる保存・キャッシュ・ライフサイクル識別子を使う',()=>{
  assert.equal(DB_NAME,'birthday-calendar-demo');
  assert.equal(SHELL_PREFIX,'birthday-calendar-demo-shell-');
  assert.equal(RETIRED_KEY,'birthday-calendar-demo-retired');
  assert.equal(SESSION_LOCK,'birthday-calendar-demo-session:birthday-calendar-demo');
  const scope='https://example.test/birthday-calendar-demo-demo/';
  const demo='birthday-calendar-demo-shell-%2Fbirthday-calendar-demo-demo%2F-0123456789abcdef';
  const production='separate-production-app-shell-%2Fbirthday-calendar-demo-demo%2F-0123456789abcdef';
  assert.deepEqual(ownedCacheNames([demo,production,'other-app'],scope),[demo]);
});

test('manifestと更新キーもDemo専用である',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.id,'./?app=birthday-calendar-demo');
  const update=readFileSync(new URL('../src/update.js',import.meta.url),'utf8');
  assert.match(update,/birthday-calendar-demo-last-update-check/);
  assert.doesNotMatch(update,/separate-production-app-last-update-check/);
});
