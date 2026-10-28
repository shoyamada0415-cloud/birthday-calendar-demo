import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('公開アイコンは必要な各サイズをPNGで配布する',()=>{
  for(const [path,size]of [['public/icons/icon-192.png',192],['public/icons/icon-512.png',512],['public/icons/apple-touch-icon.png',180],['public/icons/icon-maskable-512.png',512],['public/icons/favicon-48.png',48]]){
    const png=readFileSync(new URL('../'+path,import.meta.url));
    assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
  }
  assert.notDeepEqual(readFileSync(new URL('../public/icons/icon-512.png',import.meta.url)),readFileSync(new URL('../public/icons/icon-maskable-512.png',import.meta.url)));
});
test('Demo専用manifest IDと表示名を使い、scope/start_urlは相対パスを維持する',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.name,'Birthday Calendar Demo');assert.equal(manifest.short_name,'Birthday Calendar Demo');
  assert.equal(manifest.id,'./?app=birthday-calendar-demo');
  for(const key of ['scope','start_url'])assert.equal(manifest[key],'./');
});
