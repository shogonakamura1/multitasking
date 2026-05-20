import { useState, useCallback } from "react";
import { useBoardStore } from "../../store/boardStore";
import { StatusToggle } from "./StatusToggle";
import { NextActionField } from "./NextActionField";
import { Badge } from "../ui/Badge";
import { ElapsedBadge } from "../ui/ElapsedBadge";
import { Button } from "../ui/Button";
import { useNow } from "../../hooks/useElapsed";
import type { Task } from "../../lib/types";

const COLOR_TO_VAR: Record<string, string> = {
  blue:   "var(--proj-blue)",
  green:  "var(--proj-green)",
  red:    "var(--proj-red)",
  amber:  "var(--proj-amber)",
  purple: "var(--proj-purple)",
  slate:  "var(--proj-slate)",
};

interface DetailPaneProps {
  onClose?: () => void;
}

export function DetailPane({ onClose }: DetailPaneProps) {
  const task = useBoardStore((s) => s.selectedTask());
  const projectById = useBoardStore((s) => s.projectById);
  const updateTask = useBoardStore((s) => s.updateTask);
  const deleteTask = useBoardStore((s) => s.deleteTask);
  const setStatus = useBoardStore((s) => s.setStatus);
  const now = useNow();

  const [editTitle, setEditTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editNote, setEditNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const project = task ? projectById(task.projectId) : undefined;
  const accentColor = project ? (COLOR_TO_VAR[project.color] ?? "var(--proj-slate)") : "var(--proj-slate)";

  const saveTask = useCallback(
    async (patch: Partial<Task>) => {
      if (!task) return;
      try {
        await updateTask({ ...task, ...patch });
      } catch (err) {
        console.error("updateTask failed:", err);
      }
    },
    [task, updateTask]
  );

  if (!task) {
    return (
      <div className="detail-pane detail-pane--empty">
        <div className="detail-pane__empty-msg">
          <div className="detail-pane__empty-icon">◎</div>
          <p>タスクを選択してください</p>
          <p className="detail-pane__empty-hint">← 左一覧から選択</p>
        </div>
        {onClose && (
          <button className="detail-pane__close" onClick={onClose} aria-label="閉じる">✕</button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`detail-pane detail-pane--${task.status}`}
      style={{ "--accent": accentColor } as React.CSSProperties}
    >
      {onClose && (
        <button className="detail-pane__close" onClick={onClose} aria-label="閉じる">✕</button>
      )}

      {/* プロジェクト名 */}
      <div className="detail-pane__project">
        <span
          className="detail-pane__proj-dot"
          style={{ background: accentColor }}
        />
        <span className="detail-pane__proj-name">{project?.name ?? "—"}</span>
      </div>

      {/* タイトル（インライン編集） */}
      <div className="detail-pane__title-area">
        {editTitle ? (
          <input
            className="detail-pane__title-input"
            value={titleDraft}
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              setEditTitle(false);
              if (titleDraft.trim()) void saveTask({ title: titleDraft.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setEditTitle(false);
                if (titleDraft.trim()) void saveTask({ title: titleDraft.trim() });
              }
              if (e.key === "Escape") setEditTitle(false);
            }}
          />
        ) : (
          <h2
            className="detail-pane__title"
            onClick={() => {
              setTitleDraft(task.title);
              setEditTitle(true);
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setTitleDraft(task.title);
                setEditTitle(true);
              }
            }}
            title="クリックして編集"
          >
            {task.title}
          </h2>
        )}
      </div>

      {/* ステータス + バッジ */}
      <div className="detail-pane__meta">
        <Badge status={task.status} />
        <ElapsedBadge updatedAt={task.updatedAt} now={now} status={task.status} />
        {task.dueToday && <span className="detail-pane__due-badge">今日</span>}
      </div>

      {/* U-02: nextAction を最優先・常時表示 */}
      <NextActionField
        value={task.nextAction}
        onChange={(val) => {
          // 楽観的に state を更新したあと保存
          void saveTask({ nextAction: val || null });
        }}
        onBlur={() => {}}
      />

      {/* 状態トグル */}
      <StatusToggle taskId={task.id} currentStatus={task.status} />

      {/* メモ（インライン編集） */}
      <div className="detail-pane__note-area">
        <div className="detail-pane__note-label">メモ</div>
        {editNote ? (
          <textarea
            className="detail-pane__note-input"
            value={noteDraft}
            autoFocus
            rows={4}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={() => {
              setEditNote(false);
              void saveTask({ note: noteDraft || null });
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditNote(false);
            }}
          />
        ) : (
          <div
            className={`detail-pane__note ${!task.note ? "detail-pane__note--empty" : ""}`}
            onClick={() => {
              setNoteDraft(task.note ?? "");
              setEditNote(true);
            }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setNoteDraft(task.note ?? "");
                setEditNote(true);
              }
            }}
            role="button"
            aria-label="メモを編集"
          >
            {task.note || "（なし — クリックして入力）"}
          </div>
        )}
      </div>

      {/* 今日フラグ */}
      <label className="detail-pane__due-toggle">
        <input
          type="checkbox"
          checked={task.dueToday}
          onChange={(e) => void saveTask({ dueToday: e.target.checked })}
        />
        <span>今日やること</span>
      </label>

      {/* アクションボタン */}
      <div className="detail-pane__actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void setStatus(task.id, "done")}
          disabled={task.status === "done"}
        >
          ✓ 完了
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={async () => {
            if (confirm(`「${task.title}」を削除しますか？`)) {
              await deleteTask(task.id);
            }
          }}
        >
          削除
        </Button>
      </div>
    </div>
  );
}
