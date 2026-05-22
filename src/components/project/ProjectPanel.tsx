import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { useBoardStore } from "../../store/boardStore";
import { useCompositionGuard } from "../../hooks/useCompositionGuard";
import type { Project, Task } from "../../lib/types";

interface ProjectPanelProps {
  project: Project;
  onEdit: (project: Project) => void;
  highlightTaskId?: string | null;
  /** マウス直下から判定された集中先プロジェクトか（青ネオン発光） */
  isFocused?: boolean;
  /** 集中先タスク（null かつ isFocused のときは最上位の未完了タスクを光らせる） */
  focusTaskId?: string | null;
}

/** プロジェクト1つ分のパネル（グリッドセル）。Todoリスト＋下部にインライン追加。 */
export function ProjectPanel({
  project,
  onEdit,
  highlightTaskId,
  isFocused = false,
  focusTaskId = null,
}: ProjectPanelProps) {
  const tasks = useBoardStore((s) => s.tasks);
  const createTask = useBoardStore((s) => s.createTask);
  const reorderProjectTasks = useBoardStore((s) => s.reorderProjectTasks);

  // このプロジェクトのタスク。未完了（並べ替え対象）と完了に分ける。
  const { activeTasks, doneTasks } = useMemo(() => {
    const mine = tasks.filter((t) => t.projectId === project.id);
    return {
      activeTasks: mine.filter((t) => t.status !== "done"),
      doneTasks: mine.filter((t) => t.status === "done"),
    };
  }, [tasks, project.id]);

  // 光らせるタスク: 明示指定があればそれ、無ければ最上位の未完了タスク（迷ったら上優先）
  const glowTaskId = useMemo(() => {
    if (!isFocused) return null;
    if (focusTaskId && activeTasks.some((t) => t.id === focusTaskId)) {
      return focusTaskId;
    }
    return activeTasks[0]?.id ?? null;
  }, [isFocused, focusTaskId, activeTasks]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const guard = useCompositionGuard();

  // ドラッグ並べ替え（未完了タスクのみ。完了は末尾固定）
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    const sourceId = draggingId;
    setDraggingId(null);
    setDropTargetId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = activeTasks.map((t) => t.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    void reorderProjectTasks(project.id, [...ids, ...doneTasks.map((t) => t.id)]);
  };

  // ▲▼ ボタンによる並べ替え（未完了タスク内で1つ上/下に移動）
  const moveTask = (taskId: string, dir: "up" | "down") => {
    const ids = activeTasks.map((t) => t.id);
    const i = ids.indexOf(taskId);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i === -1 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void reorderProjectTasks(project.id, [...ids, ...doneTasks.map((t) => t.id)]);
  };

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const submitAdd = async () => {
    const title = draft.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    // やること（タイトル）のみ追加。残りは既定値。
    await createTask({ projectId: project.id, title });
    setDraft("");
    // 連続入力できるよう開いたまま再フォーカス
    inputRef.current?.focus();
  };

  // 発光色はプロジェクト固有の色を使う
  const panelStyle = {
    "--focus-color": `var(--proj-${project.color}, var(--proj-slate))`,
  } as CSSProperties;

  return (
    <section
      className={`project-panel ${isFocused ? "project-panel--focused" : ""}`}
      style={panelStyle}
    >
      <header className="project-panel__header">
        <span
          className="project-dot"
          style={{ background: `var(--proj-${project.color}, var(--proj-slate))` }}
        />
        <span className="project-panel__name" title={project.name}>
          {project.name}
        </span>
        <button
          className="project-panel__edit"
          onClick={() => onEdit(project)}
          title="プロジェクトを編集"
          aria-label={`${project.name} を編集`}
        >
          ⚙
        </button>
      </header>

      <ul className="todo-list">
        {activeTasks.map((task, index) => (
          <TodoItem
            key={task.id}
            task={task}
            highlight={task.id === highlightTaskId}
            focused={task.id === glowTaskId}
            draggable
            onMoveUp={() => moveTask(task.id, "up")}
            onMoveDown={() => moveTask(task.id, "down")}
            canMoveUp={index > 0}
            canMoveDown={index < activeTasks.length - 1}
            isDragging={draggingId === task.id}
            isDropTarget={dropTargetId === task.id}
            onDragStart={(e) => {
              // WKWebView では dataTransfer を設定しないと drop が発火しないことがある
              e.dataTransfer.setData("text/plain", task.id);
              e.dataTransfer.effectAllowed = "move";
              setDraggingId(task.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (draggingId && draggingId !== task.id) setDropTargetId(task.id);
            }}
            onDragLeave={() =>
              setDropTargetId((cur) => (cur === task.id ? null : cur))
            }
            onDrop={() => handleDrop(task.id)}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
            }}
          />
        ))}
        {doneTasks.map((task) => (
          <TodoItem
            key={task.id}
            task={task}
            highlight={task.id === highlightTaskId}
          />
        ))}
        {activeTasks.length === 0 && doneTasks.length === 0 && !adding && (
          <li className="todo-empty">やることなし</li>
        )}
      </ul>

      <div className="project-panel__add">
        {adding ? (
          <input
            ref={inputRef}
            className="todo-add__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionEnd={guard.onCompositionEnd}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // IME 変換確定の Enter は無視。確定後の Enter のみ追加。
                if (guard.isImeEnter(e)) return;
                e.preventDefault();
                void submitAdd();
              } else if (e.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            onBlur={() => {
              if (!draft.trim()) setAdding(false);
            }}
            placeholder="やることを入力 ↵"
            aria-label="やることを追加"
          />
        ) : (
          <button
            className="todo-add__btn"
            onClick={() => setAdding(true)}
            aria-label={`${project.name} にやることを追加`}
          >
            ＋ 追加
          </button>
        )}
      </div>
    </section>
  );
}

interface TodoItemProps {
  task: Task;
  highlight: boolean;
  focused?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}

const ACTIVE_STATUS_LABEL: Partial<Record<Task["status"], string>> = {
  waiting_ai: "AI待ち",
  in_progress: "進行中",
  blocked: "ブロック",
};

/** 1件のやること: チェックで完了トグル、ダブルクリックで改名、ホバーで削除。 */
function TodoItem({
  task,
  highlight,
  focused = false,
  draggable = false,
  isDragging = false,
  isDropTarget = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
}: TodoItemProps) {
  const setStatus = useBoardStore((s) => s.setStatus);
  const updateTask = useBoardStore((s) => s.updateTask);
  const deleteTask = useBoardStore((s) => s.deleteTask);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const guard = useCompositionGuard();

  const done = task.status === "done";
  const statusLabel = ACTIVE_STATUS_LABEL[task.status];

  const toggleDone = () => {
    void setStatus(task.id, done ? "todo" : "done");
  };

  const commitRename = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== task.title) {
      void updateTask({ ...task, title });
    } else {
      setDraft(task.title);
    }
  };

  return (
    <li
      className={`todo-item todo-item--${task.status} ${done ? "todo-item--done" : ""} ${
        highlight ? "todo-item--highlight" : ""
      } ${focused ? "todo-item--focused" : ""} ${
        isDragging ? "todo-item--dragging" : ""
      } ${isDropTarget ? "todo-item--drop-target" : ""}`}
      draggable={draggable && !editing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <button
        className={`todo-item__check ${done ? "todo-item__check--on" : ""}`}
        onClick={toggleDone}
        role="checkbox"
        aria-checked={done}
        aria-label={done ? "未完了に戻す" : "完了にする"}
      >
        {done ? "✓" : ""}
      </button>

      {editing ? (
        <input
          className="todo-item__edit"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onCompositionEnd={guard.onCompositionEnd}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // IME 変換確定の Enter は無視
              if (guard.isImeEnter(e)) return;
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              setDraft(task.title);
              setEditing(false);
            }
          }}
          onBlur={commitRename}
        />
      ) : (
        <span
          className="todo-item__title"
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
          title="クリックで編集"
        >
          {task.title}
        </span>
      )}

      {statusLabel && !done && (
        <span className={`todo-item__status todo-item__status--${task.status}`}>
          {statusLabel}
        </span>
      )}

      {onMoveUp && onMoveDown && (
        <span className="todo-item__move">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="上へ"
            aria-label="ひとつ上へ移動"
          >
            ▲
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="下へ"
            aria-label="ひとつ下へ移動"
          >
            ▼
          </button>
        </span>
      )}

      <button
        className="todo-item__delete"
        onClick={() => void deleteTask(task.id)}
        title="削除"
        aria-label="このやることを削除"
      >
        ✕
      </button>
    </li>
  );
}
