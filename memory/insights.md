# インサイト

*記憶の定着プロセスで更新されます。最終更新: 2026-03-29*

---

## INS-001: カレンダー詳細確認時は終日予定も必ずチェック
**発生**: 2026-03-27 | **Arousal**: 0.7 | **ドメイン**: calendar
時間指定の予定だけ確認して「住所なし」と誤答。実際には終日予定に住所が登録されていた。
**ルール**: カレンダー詳細を調べるときは、時間指定の予定と終日予定の両方を確認する。

## INS-002: QA はスクショの表示内容の妥当性まで検証する
**発生**: 2026-03-27 | **Arousal**: 0.8 | **ドメイン**: qa
固定文字列が表示されていたが「表示されてる」とだけ報告し、内容がおかしいことに気づけなかった。
**ルール**: QA でスクリーンショットを読む時は、存在確認だけでなく表示内容が文脈上妥当かまで検証する。

## INS-003: コンテキストの設計原則 — 常時ロードには認識トリガーのみ
**発生**: 2026-03-29 | **Arousal**: 0.7 | **ドメイン**: architecture
常時読み込みファイル（CLAUDE.md, agents.md）に手順の詳細を書くとコンテキストが肥大化する。agents.md を 21KB → 2.4KB（88%削減）に軽量化した経験から。
**ルール**: 常時ロードファイルには「いつ何を起動するか」の認識トリガーのみ置く。手順の詳細はスキルに切り出す。`context-architecture` スキル参照。

## INS-004: summary.md はポインタであり本文ではない
**発生**: 2026-03-29 | **Arousal**: 0.7 | **ドメイン**: architecture
summary.md に判断原則とアクティブプロジェクト情報を直接書いていたが、soul.md と Session Init ログに重複していた。3.4KB → 0.5KB（87%削減）。
**ルール**: summary.md には「詳細はXX参照」というポインタのみ書く。本文は soul.md / error-patterns.md / ログに書いて参照する。

## INS-005: Electron loadFile→loadURL 移行時は Chromium origin trust 差分を必ず確認
**発生**: 2026-05-01 | **Arousal**: 0.8 | **ドメイン**: electron
`file://` origin は Chromium で trusted 扱い (autoplay/getUserMedia/mixed-content/CORS が緩い)。`http://localhost:...` origin に切り替えると同じコードでも動かなくなる、しかも症状が「silent stream」「無反応」など分かりにくい形で現れる。
**ルール**: Electron で既存 web 機能を loadFile→loadURL 化する際は、まず旧 main.js の `webPreferences` (特に `webSecurity`) と `session.setPermissionRequestHandler` を grep して同等 posture を新版に復元する。Always-On / mic / camera / clipboard 系は特に注意。
