# M1（MVP）技術設計・タスク分解

> 対象: REQUIREMENTS.md の M1（MVP）/ 作成日: 2026-05-20 / ステータス: ドラフト
> 確定事項: Tauri / React+TS / SQLite(rusqlite) / hooks受け口=ローカルHTTP(loopback)

---

## 1. M1スコープの確認

含む:
- 常時二ペインUI（マスター=一覧 / ディテール=詳細）、ダーク×状態色（§7）
- プロジェクト・タスクのCRUD、状態管理（F-01〜F-03）
- 待ち / 進行中 / 今日やること の3グループ表示（F-04〜F-06）
- 経過時間バッジ（F-07）、ローカル永続化（F-08）
- Claude Code hooks 連携＝ローカルHTTP受け口 + 完了でOS通知（F-10, F-11）
- always-on-top・トレイ常駐（N-01）、レスポンシブ退避（U-04）

含まない（後続）: 外部ツール連携・ローカルLLM（M2）、自動検知L2/L3（M3）。

## 2. アーキテクチャ

```
┌─────────────────────────── Tauri App ───────────────────────────┐
│                                                                  │
│  React + TS (WebView)            Rust (core)                     │
│  ┌──────────────────┐  invoke   ┌────────────────────────────┐  │
│  │ MasterPane       │ ───────▶  │ commands (CRUD/query)       │  │
│  │ DetailPane       │  events   │ ─ repository (rusqlite)     │  │
│  │ store (Zustand)  │ ◀───────  │ ─ SQLite (app data dir)     │  │
│  └──────────────────┘           │ local HTTP server (loopback)│  │
│         ▲ emit                  │   └ POST /hook              │  │
│         └─────────────────────  │ tray / always-on-top / notify│  │
│                                 └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
        ▲ POST http://127.0.0.1:<port>/hook
        └── Claude Code hooks (Stop / Notification)
```

- **状態の正本は Rust + SQLite**。フロントは `invoke` で取得・更新し、変更は Rust が `emit` でフロントへ通知（hooks由来の更新も同経路でUIへ反映）。
- ローカルHTTPサーバは Rust 側に同居（`axum` 等）。`127.0.0.1` のみbind、起動時に空きポート確定→トークン付き。

## 3. データ設計（SQLite）

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,        -- uuid
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,           -- アクセント色キー
  status      TEXT NOT NULL,           -- active | paused | done
  workdir     TEXT,                    -- hooks紐づけ用（任意）
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,        -- epoch ms
  updated_at  INTEGER NOT NULL
);

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL,          -- todo|in_progress|waiting_ai|blocked|done
  next_action  TEXT,                   -- 復帰時にやること（最重要）
  note         TEXT,
  due_today    INTEGER NOT NULL DEFAULT 0,  -- 0/1
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL        -- 経過時間バッジの基点
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status  ON tasks(status);
```

- `sources` テーブルは M2 で追加（今は作らない＝YAGNI）。
- マイグレーションは単純な version 管理（`PRAGMA user_version`）。

## 4. Rust commands（フロント↔コア API）

| command | 入出力 | 用途 |
|---------|--------|------|
| `list_board` | → `{ waiting, inProgress, today, projects }` | マスター描画用の集約取得 |
| `get_task` | `id` → `Task` | ディテール表示 |
| `create_project` / `update_project` / `delete_project` | Project | プロジェクトCRUD |
| `create_task` / `update_task` / `delete_task` | Task | タスクCRUD |
| `set_task_status` | `id, status` | ワンクリック状態変更（楽観更新） |
| `reorder` | ids[] | 並び替え |

イベント（Rust→フロント emit）:
- `board_changed`: 何らかの更新（hooks含む）でマスター再取得を促す
- `ai_completed`: `{ projectId, taskId }` 通知トースト用

## 5. ローカルHTTP hooks 受け口

```
POST http://127.0.0.1:<port>/hook
Authorization: Bearer <token>     # 起動時生成、~/.config 等に保存
Content-Type: application/json

{ "event": "stop" | "start" | "notify",
  "workdir": "/path/to/project",   # projects.workdir と突合
  "task": "optional title hint",
  "message": "optional" }
```

挙動:
- `workdir` で対象プロジェクトを特定（複数候補時は最も具体的なパス）。
- `event=stop` → 当該プロジェクトの `waiting_ai` タスクを `in_progress` に更新 → `ai_completed` emit → OS通知。
- `event=start` → 対象タスクを `waiting_ai` に。
- 不一致/未登録workdirは安全に無視（誤爆させない）。

連携手順（ドキュメント化する）: ユーザーのプロジェクト `.claude/settings.json` の Stop hook に `curl` を1行登録。ポート/トークンはアプリ設定画面からコピーできるようにする。

## 6. フロント構成（feature単位）

```
src/
├─ components/
│  ├─ board/        MasterPane.tsx, StatusGroup.tsx, TaskRow.tsx
│  ├─ detail/       DetailPane.tsx, StatusToggle.tsx, NextActionField.tsx
│  ├─ project/      ProjectForm.tsx
│  └─ ui/           Badge.tsx, ElapsedBadge.tsx, Button.tsx
├─ hooks/           useBoard.ts, useTauriEvent.ts, useElapsed.ts
├─ store/           boardStore.ts (Zustand)
├─ lib/             ipc.ts (invokeラッパ), time.ts
└─ styles/          tokens.css (ダーク×状態色), global.css
```

設計トークン（tokens.css）方針:
- `--surface-0/1/2`（ダーク階層）、`--text`, `--text-dim`
- `--state-waiting`(緑) / `--state-progress`(青) / `--state-blocked`(赤) / `--state-todo`(中立) / `--state-done`(減光)
- 状態色は左ボーダー・ドット・バッジに限定使用（面塗り回避＝N-02眩しさ対策）

## 7. 非機能の実装方針

- **always-on-top / トレイ**: `tauri.conf.json` + tray plugin。閉じる=トレイ格納。
- **軽量**: 経過時間は1分間隔の単一タイマーで再描画（タスク毎タイマー禁止）。待機時ポーリングしない（イベント駆動）。
- **即復元**: ウィンドウ位置/サイズ・選択中タスクを保存し起動時復元。
- **通知最小**: OS通知は `ai_completed` のみ（N-05）。

## 8. タスク分解（実装順）

### Step 0: 土台
- T-00 Tauri + React + TS 雛形作成、`tauri.conf.json`（always-on-top/トレイ/最小サイズ）
- T-01 SQLite初期化・マイグレーション（`PRAGMA user_version`）、app data dir配置

### Step 1: コアCRUD（縦に1本通す）
- T-02 repository（rusqlite）: projects/tasks のCRUD
- T-03 commands: `list_board` / CRUD / `set_task_status` / `reorder`
- T-04 boardStore（Zustand）+ ipcラッパ + `board_changed` 購読

### Step 2: UI（二ペイン）
- T-05 MasterPane: 待ち/進行中/今日 の3グループ、TaskRow、選択ハイライト
- T-06 DetailPane: nextAction常時表示、状態トグル、インライン編集、削除/完了
- T-07 tokens.css（ダーク×状態色）+ ElapsedBadge（単一タイマー）
- T-08 ProjectForm（作成/編集/色選択/workdir）
- T-09 レスポンシブ退避（U-04）: 幅しきい値で単一カラム＋詳細オーバーレイ

### Step 3: hooks連携（L1）
- T-10 ローカルHTTPサーバ（axum, loopback, token）、ポート/トークン生成・永続化
- T-11 `POST /hook` 実装（workdir突合→状態更新→`ai_completed` emit）
- T-12 OS通知（ai_completed）+ フロントのトースト/ハイライト
- T-13 設定画面: ポート/トークン表示・コピー、Stook hook用 `curl` スニペット生成

### Step 4: 仕上げ
- T-14 ウィンドウ位置/選択状態の保存・復元
- T-15 キーボード操作（U-07: 上下移動・状態トグル）
- T-16 手動E2E（待ち→hooksでstop→通知→in_progress化 の一連）と簡易ユニット（repository, time）

## 9. 受け入れ条件（M1完了の定義）

- [ ] 二ペインで全プロジェクトの現在地が一目で分かり、選択タスクの詳細が右に出る
- [ ] 状態をワンクリックで変えられ、再起動後も保持される
- [ ] Claude Code の Stop hook → 対象プロジェクトが `in_progress` 化しOS通知が出る
- [ ] 常時最前面・トレイ常駐、狭幅でも破綻しない
- [ ] 待機時CPUがほぼ0（イベント駆動・単一タイマー）

## 10. 着手前判断（確定済み）
- [x] D1 ウィンドウ「×」→ **トレイに格納**（終了しない。終了はトレイメニューから）
- [x] D2 task ヒント無し・複数 `waiting_ai` の場合 → **`updated_at` が最古（最も長く待っている）1件**を `in_progress` に
- [x] D3 「今日やること」は M1 では **手動 `due_today` フラグのみ**（期日・外部由来は M2）
