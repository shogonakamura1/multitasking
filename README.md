# multitasking

並行作業中のコンテキストスイッチ負荷を下げる常駐ダッシュボード。
AI待ち時間に別プロジェクトへ移っても「何をやっていたか／次に何をするか」を一目で取り戻せることを目指す。

## ドキュメント

- [要件定義](docs/REQUIREMENTS.md) — 背景・課題、機能/非機能要件、技術構成、ロードマップ
- [M1（MVP）技術設計](docs/DESIGN_M1.md) — アーキテクチャ、データ設計、hooks連携、タスク分解

## 技術構成

Tauri 2 / React 19 + TypeScript / Vite / SQLite / ローカルHTTP（Claude Code hooks受け口）

## 開発

```bash
npm install            # 依存インストール
npm run tauri dev      # デスクトップアプリを開発起動
npm run build          # フロントのビルド + 型チェック
```

前提: Node、Rust（rustup）、macOS は Xcode Command Line Tools。
