import type { TaskStatus } from "../../lib/types";
import { formatElapsed, formatWaiting, isLongWait, isStale } from "../../lib/time";

interface ElapsedBadgeProps {
  updatedAt: number;
  now: number;
  status: TaskStatus;
}

export function ElapsedBadge({ updatedAt, now, status }: ElapsedBadgeProps) {
  const isWaiting = status === "waiting_ai";
  const label = isWaiting
    ? formatWaiting(updatedAt, now)
    : formatElapsed(updatedAt, now);

  const isHighlighted = isWaiting ? isLongWait(updatedAt, now) : isStale(updatedAt, now);

  return (
    <span
      className={`elapsed-badge ${isHighlighted ? "elapsed-badge--alert" : ""}`}
      title={`最終更新: ${new Date(updatedAt).toLocaleString("ja-JP")}`}
    >
      {label}
    </span>
  );
}
