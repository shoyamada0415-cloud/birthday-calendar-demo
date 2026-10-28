# Birthday Calendar Demo

誕生日や記念日を人物ごとに整理し、カレンダーと近日一覧で確認できるPWAです。就職活動の面談で、要件整理、データ設計、PC・タッチ双方の操作、ローカル保存、バックアップ、安全性への配慮を短時間で説明できるDemoとして構成しています。初期表示される人物はすべて架空です。

公開URLは未確定です。GitHub Pagesでは、将来 `https://USERNAME.github.io/birthday-calendar-demo/` の形式で公開することを想定しています。`USERNAME`はプレースホルダーであり、実在URLではありません。

## 開発目的

誕生日をSNSやメモへ分散して記録すると、確認時期を逃しやすく、人物情報との対応も分かりにくくなります。このDemoは、人物・誕生日・記念日・メモ・画像を一つの画面体系で管理し、直近の予定をすぐ確認できる状態を目指しています。

## 主な機能

- 月間カレンダー、人物一覧、誕生日一覧、近日予定
- 人物の登録・編集・削除、プロフィール画像、メモ、関連URL
- PCのドラッグ＆ドロップによる日付変更
- タッチ端末の長押し操作と日付選択
- 日英切替、ライト／ダーク／端末設定連動
- 5人の架空人物の初回投入とDemoデータのリセット
- 暗号化バックアップ、通常ZIPバックアップの復元
- PWAインストールとオフライン起動

## 使用技術

- HTML / CSS / JavaScript（ES Modules）
- Vite 8
- IndexedDB
- Web App Manifest / Service Worker / Cache Storage
- Web Crypto API
- AES-256-GCM / PBKDF2-HMAC-SHA-256
- fflateによるZIP生成・検証
- Node.js標準テストランナー
- GitHub Actions / GitHub Pages向け設定

フロントエンドだけで動作し、アプリ用サーバー、ログイン、クラウド同期、アクセス解析、外部APIは使用していません。

## データ保存とPWA

人物、画像、通知、表示設定はブラウザのIndexedDB `birthday-calendar-demo` に保存します。Service Workerはアプリ自身のscope内にある静的ファイルだけをキャッシュし、オフライン再起動に対応します。

保存データはブラウザとoriginに依存します。サイトデータを削除すると消えるため、必要な場合はバックアップを作成してください。同じGitHub Pagesホスト上の別リポジトリは同一originになるため、機密情報や実在人物の情報をDemoへ登録しないことを推奨します。

## バックアップと暗号化

新規バックアップは `.birthday-backup` 形式です。内部ZIP全体を次の条件で暗号化します。

- AES-256-GCM
- PBKDF2-HMAC-SHA-256、600,000回
- 16バイトのランダムsalt
- 12バイトのランダムIV
- 128ビット認証タグ
- ヘッダーをAdditional Authenticated Dataとして認証

復元時は暗号だけでなく、ZIP構造、entry名、容量、CRC、SHA-256、画像形式、参照整合性を検証してからIndexedDBを一つのtransactionで置き換えます。通常ZIP v0/v1も読み込めますが、暗号化されていないため公開・共有しないでください。匿名化前の暗号化形式には対応していません。

## セキュリティ上の工夫

- 利用者入力は`textContent`を中心に描画し、HTMLとして挿入しない
- 外部URLは`http` / `https`に限定し、認証情報入りURLを拒否
- 新規タブへ`noopener noreferrer`を指定
- ZIP Slip、重複entry、過大展開、CRC不一致、不正画像を拒否
- IndexedDB、キャッシュ、localStorage、Manifest IDをDemo専用名へ分離
- Content Security Policy、`noindex`、ソースマップ無効化
- Production build後に公開ファイルの許可リスト、秘密情報、識別情報を自動監査

`noindex`はアクセス制限ではありません。公開URLを知る人は利用できます。

## 生成AIの活用と担当範囲

このプロジェクトは、ChatGPTとCodexを利用した個人開発です。すべてのコードを人手だけで記述したものではありません。

- ChatGPT：要件の整理、設計上の論点整理、説明文の草案作成
- Codex：コードの作成・修正支援、静的監査、自動テスト、Production build、ブラウザ自動検証
- 本人：解決したい課題の設定、要件と優先順位の決定、匿名性・データ分離・公開範囲などの制約提示、AIへの具体的な指示、仕様の採否と改善方針の判断

AIの出力はそのまま採用せず、テスト、build、公開物検索、一時ブラウザプロファイルでの操作確認を受け入れ条件にしています。実機固有の挙動や公開アカウントの設定は、自動検証で代替できない項目として分けています。

## ローカルでの実行

Node.js 24を使用します。

```powershell
npm ci
node scripts/prepare-font-test-fixtures.mjs
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

表示されたHTTP URLを開いてください。`file://`で直接開く方法はService WorkerとPWAの検証に適しません。

`npm run build`はVite build、Service Worker生成、`dist/`監査を順に実行します。GitHub Actionsも`npm ci`、テスト、buildがすべて成功した場合だけ`dist/`をPages artifactとして扱う構成です。workflowは手動実行のみです。

## Demo版の注意事項

- 初期人物、メモ、画像は架空データです。
- 実在人物の個人情報を登録しないでください。
- DemoリセットはこのDemoのIndexedDB内だけを初期状態へ戻します。
- 通常ZIPには平文の人物情報が含まれます。
- iPhone Safari、Android実機、実際のGitHub Pages環境は公開前に別途確認が必要です。
- `dist/`、`node_modules/`、`test-artifacts/`、バックアップはGitへ追加しません。

面談用の説明は `INTERVIEW_GUIDE.md`、検証項目は `TEST_REPORT.md`、公開時の注意は `docs/PUBLICATION_PRIVACY.md` を参照してください。

## ライセンス

アプリ本体のライセンスは現時点で指定していません。公開前に、再利用を許可する範囲に応じてリポジトリのライセンスを決定してください。

Zen Maru Gothicを無改変で同梱しています。SIL Open Font License 1.1、著作権表示、公式取得メタデータは `public/fonts/zen-maru-gothic/` に保持しています。
