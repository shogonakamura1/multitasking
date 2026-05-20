# IPC 契約（フロント React ↔ Rust コア） — M1

> この契約は backend / frontend 両実装の唯一の正本。両者はこの定義に厳密に従うこと。
> serde は `#[serde(rename_all = "camelCase")]` を全モデルに付与し、TS と命名を一致させる。
> Tauri v2 の `invoke` は JS 側 camelCase 引数を Rust 側 snake_case 引数へ自動変換する。

## 型

```ts
type ProjectStatus = "active" | "paused" | "done";
type TaskStatus = "todo" | "in_progress" | "waiting_ai" | "blocked" | "done";

interface Project {
  id: string;            // uuid v4
  name: string;
  color: string;         // アクセント色キー: "blue"|"green"|"red"|"amber"|"purple"|"slate"
  status: ProjectStatus;
  workdir: string | null;
  sortOrder: number;
  createdAt: number;     // epoch ms
  updatedAt: number;     // epoch ms
}

interface Task {
  id: string;            // uuid v4
  projectId: string;
  title: string;
  status: TaskStatus;
  nextAction: string | null;
  note: string | null;
  dueToday: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;     // 経過時間バッジの基点。状態/内容変更のたびに更新
}

interface Board {
  projects: Project[];
  tasks: Task[];         // 全タスク。グルーピング（待ち/進行中/今日）はフロントで導出
}

interface CreateProjectInput {
  name: string;
  color: string;
  status?: ProjectStatus;   // 既定 "active"
  workdir?: string | null;
}

interface CreateTaskInput {
  projectId: string;
  title: string;
  status?: TaskStatus;      // 既定 "todo"
  nextAction?: string | null;
  note?: string | null;
  dueToday?: boolean;       // 既定 false
}

interface HookInfo {
  port: number;
  token: string;
  url: string;              // 例 "http://127.0.0.1:<port>/hook"
}
```

## Tauri commands（`invoke(name, args)`）

| command 名 | 引数 (JS camelCase) | 戻り値 | 用途 |
|-----------|--------------------|--------|------|
| `get_board` | なし | `Board` | 全プロジェクト＋全タスク取得 |
| `create_project` | `{ input: CreateProjectInput }` | `Project` | |
| `update_project` | `{ project: Project }` | `Project` | |
| `delete_project` | `{ id: string }` | `void` | カスケードでタスク削除 |
| `create_task` | `{ input: CreateTaskInput }` | `Task` | |
| `update_task` | `{ task: Task }` | `Task` | |
| `delete_task` | `{ id: string }` | `void` | |
| `set_task_status` | `{ id: string, status: TaskStatus }` | `Task` | ワンクリック状態変更。`updatedAt` 更新 |
| `reorder_tasks` | `{ ids: string[] }` | `void` | 並び替え（`sortOrder` 再採番） |
| `get_hook_info` | なし | `HookInfo` | 設定画面・curl スニペット生成用 |

- すべての command は失敗時 `Result<T, String>`（エラーメッセージ文字列）を返す。

## イベント（Rust → フロント `emit`）

| イベント名 | payload | フロント挙動 |
|-----------|---------|-------------|
| `board_changed` | なし | `get_board` を再取得してUI更新（hooks由来の更新もこれ経由） |
| `ai_completed` | `{ projectId: string, taskId: string \| null, projectName: string, taskTitle: string \| null }` | トースト表示＋ハイライト（OS通知は Rust 側で送出） |

## ローカル HTTP hooks 受け口（Rust 側 axum）

```
POST http://127.0.0.1:<port>/hook
Authorization: Bearer <token>
Content-Type: application/json

{ "event": "stop" | "start" | "notify",
  "workdir": "/abs/path/to/project",
  "task": "optional title hint",
  "message": "optional" }
```

挙動:
- `127.0.0.1` のみ bind。`token` 不一致は 401。
- `workdir` を `projects.workdir` と前方一致で突合（最も具体的＝最長一致を採用）。一致なしは 200 で無視（誤爆させない）。
- `event=stop`: 対象プロジェクトの `waiting_ai` タスクのうち **`updatedAt` 最古の1件**を `in_progress` に更新（D2）。task ヒントがあればタイトル一致を優先。更新後 `board_changed` と `ai_completed` を emit、OS通知を送出。
- `event=start`: task ヒント一致 or 最新作成タスクを `waiting_ai` に。`board_changed` emit。
- `event=notify`: 状態変更せず `ai_completed`（taskId=null 可）emit ＋ OS通知のみ。

## 永続化（SQLite, rusqlite）

スキーマは `docs/DESIGN_M1.md` §3 準拠。DBファイルはアプリのデータディレクトリ（`app_data_dir`）配下 `multitasking.db`。マイグレーションは `PRAGMA user_version` で管理。
