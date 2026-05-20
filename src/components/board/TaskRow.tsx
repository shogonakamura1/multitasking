import type { Task, Project } from "../../lib/types";
import { ElapsedBadge } from "../ui/ElapsedBadge";
import { useNow } from "../../hooks/useElapsed";

const COLOR_TO_VAR: Record<string, string> = {
  blue:   "var(--proj-blue)",
  green:  "var(--proj-green)",
  red:    "var(--proj-red)",
  amber:  "var(--proj-amber)",
  purple: "var(--proj-purple)",
  slate:  "var(--proj-slate)",
};

interface TaskRowProps {
  task: Task;
  project: Project | undefined;
  isSelected: boolean;
  highlightId?: string | null;
  onClick: () => void;
}

export function TaskRow({ task, project, isSelected, highlightId, onClick }: TaskRowProps) {
  const now = useNow();
  const dotColor = project ? (COLOR_TO_VAR[project.color] ?? "var(--proj-slate)") : "var(--proj-slate)";
  const isHighlighted = task.id === highlightId;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      className={`task-row task-row--${task.status} ${isSelected ? "task-row--selected" : ""} ${isHighlighted ? "task-row--ai-highlight" : ""}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* 左状態ボーダーはCSSで */}
      <span
        className="task-row__dot"
        style={{ background: dotColor }}
        title={project?.name}
      />
      <span className="task-row__title" title={task.title}>
        {task.title}
      </span>
      <ElapsedBadge updatedAt={task.updatedAt} now={now} status={task.status} />
    </div>
  );
}
