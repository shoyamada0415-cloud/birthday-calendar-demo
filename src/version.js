import packageInfo from '../package.json' with { type: 'json' };

// package.jsonだけを人が更新する。ZIPと設定画面は同じ値を表示する。
export const APP_VERSION = packageInfo.version;
