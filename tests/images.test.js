import test from 'node:test';
import assert from 'node:assert/strict';
import { compressAvatar, loadAvatarSource, cropAvatar } from '../src/images.js';

test('画像デコードのSafari向け代替経路でも512pxへ縮小し、一時URLを解放する', async () => {
  const originals = {
    createImageBitmap: globalThis.createImageBitmap, Image: globalThis.Image,
    document: globalThis.document, createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const revoked = [];
  try {
    globalThis.createImageBitmap = async () => { throw new Error('unsupported'); };
    URL.createObjectURL = () => 'blob:test-image';
    URL.revokeObjectURL = (url) => revoked.push(url);
    globalThis.Image = class {
      naturalWidth = 1024;
      naturalHeight = 768;
      set src(_value) { queueMicrotask(() => this.onload()); }
    };
    const canvas = { width: 0, height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (done) => done(new Blob(['small'], { type: 'image/webp' })),
    };
    globalThis.document = { createElement: (tag) => tag === 'canvas' ? canvas : null };
    const result = await compressAvatar(new Blob(['image'], { type: 'image/png' }));
    assert.equal(result.type, 'image/webp');
    assert.equal(canvas.width, 512);
    assert.equal(canvas.height, 384);
    assert.deepEqual(revoked, ['blob:test-image']);
  } finally {
    globalThis.createImageBitmap = originals.createImageBitmap;
    globalThis.Image = originals.Image;
    globalThis.document = originals.document;
    URL.createObjectURL = originals.createObjectURL;
    URL.revokeObjectURL = originals.revokeObjectURL;
  }
});

test('保存上限を超える画像はIndexedDB登録前に拒否する', async () => {
  const originals = { createImageBitmap: globalThis.createImageBitmap, document: globalThis.document };
  let closed = false;
  try {
    globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close: () => { closed = true; } });
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage: () => {} }),
      toBlob: (done) => done(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' })) }) };
    await assert.rejects(compressAvatar(new Blob(['image'], { type: 'image/png' })), /2 MiB/);
    assert.equal(closed, true);
  } finally {
    globalThis.createImageBitmap = originals.createImageBitmap;
    globalThis.document = originals.document;
  }
});

test('iPhone由来HEICはブラウザで読める場合だけ受け付け、一時URLを1回だけ解放する', async () => {
  const originals = { Image: globalThis.Image, createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL };
  const revoked = [];
  try {
    URL.createObjectURL = () => 'blob:heic-test';
    URL.revokeObjectURL = (url) => revoked.push(url);
    globalThis.Image = class {
      naturalWidth = 900;
      naturalHeight = 1200;
      set src(_value) { queueMicrotask(() => this.onload()); }
      decode() { return Promise.resolve(); }
      removeAttribute() {}
    };
    const file = new Blob(['photo'], { type: 'image/heic' });
    const source = await loadAvatarSource(file);
    assert.equal(source.width, 900);
    assert.equal(source.height, 1200);
    source.release(); source.release();
    assert.deepEqual(revoked, ['blob:heic-test']);
  } finally {
    globalThis.Image = originals.Image;
    URL.createObjectURL = originals.createObjectURL;
    URL.revokeObjectURL = originals.revokeObjectURL;
  }
});

test('未対応HEICは既存画像を触らずエラーにし、選択中URLを解放する', async () => {
  const originals = { Image: globalThis.Image, createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL };
  const revoked = [];
  try {
    URL.createObjectURL = () => 'blob:unsupported-heic';
    URL.revokeObjectURL = (url) => revoked.push(url);
    globalThis.Image = class { set src(_value) { queueMicrotask(() => this.onerror(new Event('error'))); } };
    await assert.rejects(loadAvatarSource(new Blob(['unsupported'], { type: 'image/heic' })), /JPEGへ変換/);
    assert.deepEqual(revoked, ['blob:unsupported-heic']);
  } finally {
    globalThis.Image = originals.Image;
    URL.createObjectURL = originals.createObjectURL;
    URL.revokeObjectURL = originals.revokeObjectURL;
  }
});

test('トリミングは正方形512pxに出力し、向きに配慮したbitmapを解放する', async () => {
  const originals = { createImageBitmap: globalThis.createImageBitmap, document: globalThis.document };
  const drawn = []; let closed = false; let orientation;
  try {
    const bitmap = { width: 800, height: 400, close: () => { closed = true; } };
    globalThis.createImageBitmap = async (_file, options) => { orientation = options.imageOrientation; return bitmap; };
    const canvas = { width: 0, height: 0, getContext: () => ({
      drawImage: (...args) => drawn.push(args),
    }), toBlob: (done) => done(new Blob(['cropped'], { type: 'image/webp' })) };
    globalThis.document = { createElement: () => canvas };
    const result = await cropAvatar({ width: 800, height: 400, file: new Blob(['source']), image: {} },
      { x: 200, y: 0, size: 400 });
    assert.equal(result.type, 'image/webp');
    assert.equal(canvas.width, 512);
    assert.equal(canvas.height, 512);
    assert.deepEqual(drawn[0].slice(1), [200, 0, 400, 400, 0, 0, 512, 512]);
    assert.equal(orientation, 'from-image');
    assert.equal(closed, true);
  } finally {
    globalThis.createImageBitmap = originals.createImageBitmap;
    globalThis.document = originals.document;
  }
});
