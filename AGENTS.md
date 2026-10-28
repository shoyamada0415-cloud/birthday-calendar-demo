# AGENTS.md

このファイルは `Birthday Calendar Demo` 専用です。

- 変更範囲はこのフォルダ内だけとし、親プロジェクトや隣接アプリへ書き込まない。
- 公開名は `Birthday Calendar Demo`、内部識別子は `birthday-calendar-demo` を維持する。
- IndexedDB、Cache Storage、localStorage、Manifest ID、Service WorkerはDemo専用の名前空間を使う。
- 初期データは架空人物5人だけ。既存データがない初回だけ投入し、通常起動で上書きしない。
- リセットはDemoの4ストアだけを対象とし、他アプリのDB、キャッシュ、Service Workerを触らない。
- 暗号化バックアップは匿名化した現行ヘッダーと `.birthday-backup` だけを使う。匿名化前の暗号化形式は読み込まない。ZIP v0/v1の読込互換、AES-256-GCM、PBKDF2-SHA-256 600,000回を弱めない。
- 外部通信、解析、SNS連携を追加しない。公開物はCSPと相対URLを維持し、ソースマップを生成しない。
- 第三者フォントのライセンス、著作権表示、公式メタデータを削除・改変しない。
- テストを無効化して成功扱いにしない。`npm test`、`npm run build`、公開物監査、主要ブラウザ操作を確認する。
- commit、push、リポジトリ作成、公開は明示承認なしに行わない。
