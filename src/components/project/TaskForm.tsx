import { useState } from "react";
import type { Project, TaskStatus, CreateTaskInput } from "../../lib/types";
import { useBoardStore } from "../../store/boardStore";
import { Button } from "../ui/Button";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo",        label: "未着手" },
  { value: "in_progress", label: "進行中" },
  { value: "waiting_ai",  label: "AI待ち" },
  { value: "blocked",     label: "ブロック" },
];

interface TaskFormProps {
  defaultProjectId?: string;
  onClose: () => void;
}

export function TaskForm({ defaultProjectId, onClose }: TaskFormProps) {
  const createTask = useBoardStore((s) => s.createTask);
  const selectTask = useBoardStore((s) => s.selectTask);
  const projects = useBoardStore((s) => s.projects).filter((p) => p.status !== "done");

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [nextAction, setNextAction] = useState("");
  const [dueToday, setDueToday] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId) return;
    setSubmitting(true);
    try {
      const input: CreateTaskInput = {
        projectId,
        title: title.trim(),
        status,
        nextAction: nextAction.trim() || null,
        dueToday,
      };
      const task = await createTask(input);
      selectTask(task.id);
      onClose();
    } catch (err) {
      console.error("createTask error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="project-form-overlay" role="dialog" aria-modal="true" aria-label="タスクを追加">
      <form className="project-form" onSubmit={handleSubmit}>
        <div className="project-form__header">
          <h3>タスクを追加</h3>
          <button type="button" className="project-form__close" onClick={onClose} aria-label="閉じる">✕</button>
        </div>

        <div className="project-form__field">
          <label className="project-form__label" htmlFor="task-title">タイトル</label>
          <input
            id="task-title"
            className="project-form__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="今やっていること"
            required
            autoFocus
          />
        </div>

        <div className="project-form__field">
          <label className="project-form__label" htmlFor="task-project">プロジェクト</label>
          <select
            id="task-project"
            className="project-form__select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p: Project) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="project-form__field">
          <label className="project-form__label" htmlFor="task-status">状態</label>
          <select
            id="task-status"
            className="project-form__select"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="project-form__field">
          <label className="project-form__label" htmlFor="task-next-action">次にやること（任意）</label>
          <input
            id="task-next-action"
            className="project-form__input"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="復帰時にやること"
          />
        </div>

        <div className="project-form__field project-form__field--checkbox">
          <label className="project-form__check-label">
            <input
              type="checkbox"
              checked={dueToday}
              onChange={(e) => setDueToday(e.target.checked)}
            />
            今日やること
          </label>
        </div>

        <div className="project-form__actions">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={submitting || !title.trim()}>
            {submitting ? "追加中..." : "追加"}
          </Button>
        </div>
      </form>
    </div>
  );
}
