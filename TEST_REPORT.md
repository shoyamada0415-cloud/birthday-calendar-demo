# Birthday Calendar Demo テスト報告

実施日: 2026-10-28（Asia/Tokyo）

## 結果

- Node自動テスト: `npm test`、195/195成功
- Production build: `npm run build` 成功（Vite 8.3.5）
- 公開物監査: `dist/` 16ファイル、許可リスト一致、旧識別情報・旧暗号化ヘッダー列・過去Version番号0件、source map 0件
- 保存領域: IndexedDB `birthday-calendar-demo`、Cache Storage `birthday-calendar-demo-shell-...`、更新・停止キー、Manifest IDがDemo専用
- 初期データ: 空DBの初回だけ架空人物5人を投入。通常再起動で編集内容を保持し、全削除状態も勝手に再投入しない
- リセット: 確認後に人物・画像・通知を5人の状態へ戻し、言語などのDemo設定を維持
- 人物管理: 登録、編集、誕生日・メモ変更、削除、画像追加・置換・削除、孤児画像なし
- バックアップ: ZIP v0/v1と現行 `.birthday-backup` を復元可能。匿名化前の暗号化ヘッダーは非対応
- 暗号化: AES-256-GCM、PBKDF2-SHA-256 600,000回、乱数salt/IV、誤パスワード・改ざん拒否
- ブラウザ総合試験: 一時Edgeプロファイルと `/birthday-calendar-demo/` サブパスで成功。PC 1280px相当、320/390/430/768/1280px、日英、ライト／ダーク、マウス・タッチ操作を確認
- PWA: Manifest、Service Worker、更新、専用キャッシュ、オフライン再起動を確認
- 通信・console: 意図しない外部通信0、console error 0
- 既存領域: 別名DB、別Cache Storage、無関係なlocalStorageを保持するテストに成功
- 公開コピー: Git履歴・remoteなし、公式Actions 5件を検証済みcommit SHAへ固定、公開対象は `dist/` のみ

## 公開物に残る第三者情報

Zen Maru GothicのOFL、著作権表示、公式Google Fonts取得元をライセンス遵守のため保持しています。Demo作者や元アプリの情報ではありません。npm lockfileの依存パッケージURLも第三者依存の検証情報です。

## 未確認

- iPhone実機のSafari、ホーム画面PWA、Files保存／選択、パスワードマネージャー
- Android実機
- 実際のGitHub Pages／Cloudflare Pages環境（今回は公開していない）

iPhoneの確認項目は `docs/PUBLICATION_PRIVACY.md` を参照してください。
