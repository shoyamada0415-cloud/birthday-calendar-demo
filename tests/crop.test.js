import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCrop, cropRect, zoomCrop, gestureCrop, cropLayout } from '../src/crop.js';

test('長方形画像を中央の正方形から始め、拡大と移動でも画像外へ出さない', () => {
  const initial = initialCrop(1200, 800);
  assert.deepEqual(cropRect(initial), { x: 200, y: 0, size: 800 });
  const zoomed = zoomCrop(initial, 2);
  assert.deepEqual(cropRect(zoomed), { x: 400, y: 200, size: 400 });
  const moved = gestureCrop(zoomed, [{ x: 150, y: 150 }], [{ x: -500, y: 150 }], 300);
  assert.equal(cropRect(moved).x, 800);
  assert.equal(cropRect(moved).y, 200);
  assert.deepEqual(cropLayout(initial, 300), { width: 450, height: 300, left: -75, top: 0 });
});

test('ピンチで拡大し、指の中央にあった被写体の位置を保つ', () => {
  const start = initialCrop(1000, 800);
  const next = gestureCrop(start,
    [{ x: 100, y: 150 }, { x: 200, y: 150 }],
    [{ x: 50, y: 150 }, { x: 250, y: 150 }], 300);
  assert.equal(next.zoom, 2);
  assert.deepEqual(cropRect(next), { x: 300, y: 200, size: 400 });
  assert.equal(zoomCrop(next, 100).zoom, 4);
  assert.equal(zoomCrop(next, 0).zoom, 1);
});
