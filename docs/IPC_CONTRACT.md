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
| `set_focus_detection` | `{ enabled: boolean }` | `void` | マウス直下フォーカス検知の ON/OFF（既定 ON、設定で永続化） |
| `get_focus_detection` | なし | `boolean` | 現在の ON/OFF 状態 |

- すべての command は失敗時 `Result<T, String>`（エラーメッセージ文字列）を返す。

## イベント（Rust → フロント `emit`）

| イベント名 | payload | フロント挙動 |
|-----------|---------|-------------|
| `board_changed` | なし | `get_board` を再取得してUI更新（hooks由来の更新もこれ経由） |
| `ai_completed` | `{ projectId: string, taskId: string \| null, projectName: string, taskTitle: string \| null }` | トースト表示＋ハイライト（OS通知は Rust 側で送出） |
| `focus_changed` | `{ projectId: string \| null, taskId: string \| null, source: "name" \| "llm" \| "none", appName: string, windowTitle: string }` | マウス直下から判定した「集中先」。`projectId` のカードを青ネオン発光、`taskId` のタスクを発光。`taskId=null` かつ `projectId` ありの場合はフロントが**最上位の未完了タスク**を発光（迷ったら上優先）。`projectId=null` は発光解除 |

## マウス直下フォーカス検知（Rust, macOS）

1秒ごとにマウスカーソル直下のウィンドウを調べ、どのプロジェクト/タスクに取り組んでいるかを判定して `focus_changed` を emit する。

- **取得**: `CGEventGetLocation` でカーソル座標、`CGWindowListCopyWindowInfo(onScreenOnly)` で最前面ウィンドウ群の bounds / owner名(アプリ) / name(タイトル) を取得し、座標を含む最前面ウィンドウを特定。
  - **タイトル取得には Screen Recording 権限が必要**（macOS）。未許可時は owner名のみで判定にフォールバック。
- **判定（優先順）**:
  1. **名前一致**: ウィンドウタイトル or アプリ名にプロジェクト名が含まれれば即マッチ（`source="name"`）。さらにタイトルにタスク名が含まれればその `taskId`。
  2. **LLM 推定**: 名前一致せず、ブラウザ（Chrome/Safari/Arc 等）の場合、ローカル Ollama（`http://localhost:11434/api/generate`）にプロジェクト一覧＋タイトルを渡し、どのプロジェクトかを推定（`source="llm"`）。Ollama 未起動/タイムアウト時はスキップ（`source="none"`, `projectId=null`）。
  3. どれにも当たらなければ `projectId=null`（発光解除）。
- **debounce**: 判定結果（projectId+taskId）が前回と同じなら emit しない（チラつき防止）。
- 既定 ON。設定で OFF 可・状態は永続化。

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
