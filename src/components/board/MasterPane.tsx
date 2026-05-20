import { useState } from "react";
import { useBoardStore } from "../../store/boardStore";
import { StatusGroup } from "./StatusGroup";
import { TaskRow } from "./TaskRow";
// Task import kept for renderTask typing
import type { Task } from "../../lib/types";

interface MasterPaneProps {
  highlightTaskId?: string | null;
  onAddTaskClick: () => void;
}

export function MasterPane({ highlightTaskId, onAddTaskClick }: MasterPaneProps) {
  const projects = useBoardStore((s) => s.projects);
  const waitingTasks = useBoardStore((s) => s.waitingTasks());
  const inProgressTasks = useBoardStore((s) => s.inProgressTasks());
  const dueTodayTasks = useBoardStore((s) => s.dueTodayTasks());
  const selectedTaskId = useBoardStore((s) => s.selectedTaskId);
  const selectTask = useBoardStore((s) => s.selectTask);
  const projectById = useBoardStore((s) => s.projectById);

  const [collapsedToday, setCollapsedToday] = useState(false);

  // ↑↓ キー操作は App レベルのグローバル keydown で管理（WARN#2 対応）

  const renderTask = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      project={projectById(task.projectId)}
      isSelected={task.id === selectedTaskId}
      highlightId={highlightTaskId}
      onClick={() => selectTask(task.id)}
    />
  );

  return (
    <div className="master-pane">
      <div className="master-pane__header">
        <span className="master-pane__title">一覧</span>
        <button
          className="master-pane__add-btn"
          onClick={onAddTaskClick}
          title="タスクを追加"
          aria-label="タスクを追加"
        >
          ＋
        </button>
      </div>

      <div className="master-pane__groups">
        {/* U-06: 待ちを最上部に集約 */}
        <StatusGroup
          label="待ち"
          count={waitingTasks.length}
          status="waiting"
        >
          {waitingTasks.map(renderTask)}
        </StatusGroup>

        <StatusGroup
          label="進行中"
          count={inProgressTasks.length}
          status="progress"
        >
          {inProgressTasks.map(renderTask)}
        </StatusGroup>

        <StatusGroup
          label="今日やること"
          count={dueTodayTasks.length}
          status="today"
          collapsed={collapsedToday}
          onToggleCollapse={() => setCollapsedToday((v) => !v)}
        >
          {dueTodayTasks.map(renderTask)}
        </StatusGroup>

        {/* プロジェクト一覧フッタ */}
        <div className="master-pane__projects">
          <div className="master-pane__projects-label">プロジェクト</div>
          {projects.filter((p) => p.status !== "done").map((p) => (
            <div key={p.id} className="master-pane__project-item">
              <span
                className="project-dot"
                style={{
                  background: `var(--proj-${p.color}, var(--proj-slate))`,
                }}
              />
              <span className="project-name">{p.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
