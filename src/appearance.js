export const THEMES = ['light', 'dark', 'system'];
// 既存版の明るい表示を維持。端末追従は利用者が選択できる。
export const DEFAULT_APPEARANCE = Object.freeze({ theme:'light' });
export function normalizeAppearance(value = DEFAULT_APPEARANCE) {
  if (!value || typeof value !== 'object' || !THEMES.includes(value.theme)) {
    throw new Error('外観設定が正しくありません。');
  }
  return { theme:value.theme };
}
export function applyAppearance(value, dark = matchMedia('(prefers-color-scheme: dark)').matches) {
  const settings = normalizeAppearance(value);
  document.documentElement.dataset.theme = settings.theme === 'system' ? (dark ? 'dark' : 'light') : settings.theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#1e202b' : '#faf7f1');
}
