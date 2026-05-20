import type { TaskStatus } from "../../lib/types";

interface BadgeProps {
  status: TaskStatus;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  waiting_ai: "待ち",
  in_progress: "進行中",
  blocked: "ブロック",
  todo: "未着手",
  done: "完了",
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  waiting_ai: "badge--waiting",
  in_progress: "badge--progress",
  blocked: "badge--blocked",
  todo: "badge--todo",
  done: "badge--done",
};

export function Badge({ status }: BadgeProps) {
  return (
    <span className={`badge ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
