import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync('src/demo.css','utf8');
test('人物カードの暗色補正はダーク限定で登録済みカードにも優先する',()=>{
  assert.match(css,/html\[data-theme=dark\] :is\(\.avatar-person,\.person-card\) \{ background:var\(--surface\); color:var\(--ink\); border-color:var\(--line\); \}/);
  assert.match(css,/html\[data-theme=dark\] :is\(\.avatar-person,\.person-card\) \.avatar \{ background:var\(--soft\); color:var\(--brand\); \}/);
  assert.doesNotMatch(css,/html\[data-theme=dark\][^{]*\bimg\b[^}]*\b(?:filter|opacity|mix-blend-mode):/);
});
test('暗色人物カードは選択・フォーカス・ドラッグの輪郭を維持する',()=>{
  for(const state of ['.selected',':focus-visible','.dragging']){
    const rule=css.split('\n').find(line=>line.startsWith('html[data-theme=dark] :is(.avatar-person,.person-card)'+state+' '));
    assert.ok(rule,state);assert.match(rule,/outline:.*var\(--brand\)/);
  }
});
