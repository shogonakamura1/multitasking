import type { TaskStatus } from "../../lib/types";
import { useBoardStore } from "../../store/boardStore";
import { Button } from "../ui/Button";

const ALL_STATUSES: TaskStatus[] = ["todo", "in_progress", "waiting_ai", "blocked", "done"];

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo:        "未着手",
  in_progress: "進行中",
  waiting_ai:  "AI待ち",
  blocked:     "ブロック",
  done:        "完了",
};

interface StatusToggleProps {
  taskId: string;
  currentStatus: TaskStatus;
}

export function StatusToggle({ taskId, currentStatus }: StatusToggleProps) {
  const setStatus = useBoardStore((s) => s.setStatus);

  const nextStatus = (): TaskStatus => {
    const idx = ALL_STATUSES.indexOf(currentStatus);
    return ALL_STATUSES[(idx + 1) % ALL_STATUSES.length];
  };

  return (
    <div className="status-toggle">
      <div className="status-toggle__buttons">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            className={`status-btn status-btn--${s} ${s === currentStatus ? "status-btn--active" : ""}`}
            onClick={() => {
              if (s !== currentStatus) void setStatus(taskId, s);
            }}
            title={STATUS_LABEL[s]}
            aria-pressed={s === currentStatus}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void setStatus(taskId, nextStatus())}
        title="次の状態へ (S キー)"
      >
        → 次の状態
      </Button>
    </div>
  );
}
