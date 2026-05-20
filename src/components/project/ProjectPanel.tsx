import { useEffect, useMemo, useRef, useState } from "react";
import { useBoardStore } from "../../store/boardStore";
import { useCompositionGuard } from "../../hooks/useCompositionGuard";
import type { Project, Task } from "../../lib/types";

interface ProjectPanelProps {
  project: Project;
  onEdit: (project: Project) => void;
  highlightTaskId?: string | null;
}

/** プロジェクト1つ分のパネル（グリッドセル）。Todoリスト＋下部にインライン追加。 */
export function ProjectPanel({ project, onEdit, highlightTaskId }: ProjectPanelProps) {
  const tasks = useBoardStore((s) => s.tasks);
  const createTask = useBoardStore((s) => s.createTask);

  // このプロジェクトのタスク。未完了を上、完了を下に。
  const sortedTasks = useMemo(() => {
    const mine = tasks.filter((t) => t.projectId === project.id);
    const active = mine.filter((t) => t.status !== "done");
    const done = mine.filter((t) => t.status === "done");
    return [...active, ...done];
  }, [tasks, project.id]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const guard = useCompositionGuard();

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

  return (
    <section className="project-panel">
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
        {sortedTasks.map((task) => (
          <TodoItem key={task.id} task={task} highlight={task.id === highlightTaskId} />
        ))}
        {sortedTasks.length === 0 && !adding && (
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
}

const ACTIVE_STATUS_LABEL: Partial<Record<Task["status"], string>> = {
  waiting_ai: "AI待ち",
  in_progress: "進行中",
  blocked: "ブロック",
};

/** 1件のやること: チェックで完了トグル、ダブルクリックで改名、ホバーで削除。 */
function TodoItem({ task, highlight }: TodoItemProps) {
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
      }`}
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
