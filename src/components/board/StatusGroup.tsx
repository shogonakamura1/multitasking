import type { ReactNode } from "react";

interface StatusGroupProps {
  label: string;
  count: number;
  status: "waiting" | "progress" | "today" | "todo";
  children: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const STATUS_ICON: Record<StatusGroupProps["status"], string> = {
  waiting:  "⏳",
  progress: "▶",
  today:    "☑",
  todo:     "○",
};

export function StatusGroup({
  label,
  count,
  status,
  children,
  collapsed,
  onToggleCollapse,
}: StatusGroupProps) {
  return (
    <section className={`status-group status-group--${status}`} aria-label={label}>
      <button
        className="status-group__header"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
      >
        <span className="status-group__icon">{STATUS_ICON[status]}</span>
        <span className="status-group__label">{label}</span>
        <span className="status-group__count">{count}</span>
        {onToggleCollapse && (
          <span className="status-group__chevron">{collapsed ? "›" : "⌄"}</span>
        )}
      </button>
      {!collapsed && (
        <div className="status-group__tasks" role="listbox" aria-label={`${label}のタスク`}>
          {count === 0 ? (
            <div className="status-group__empty">なし</div>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
