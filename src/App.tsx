import { useEffect, useMemo, useState } from "react";
import { useBoardStore } from "./store/boardStore";
import { useTauriEvent, registerToastCallback } from "./hooks/useTauriEvent";
import { ProjectPanel } from "./components/project/ProjectPanel";
import { ProjectForm } from "./components/project/ProjectForm";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { ToastContainer } from "./components/ui/Toast";
import type { ToastItem } from "./components/ui/Toast";
import type { Project } from "./lib/types";

export default function App() {
  const fetchBoard = useBoardStore((s) => s.fetchBoard);
  const projects = useBoardStore((s) => s.projects);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);

  // Tauri イベント購読（board_changed → 再取得 / ai_completed → トースト）
  useTauriEvent();

  // トーストコールバック登録
  useEffect(() => {
    registerToastCallback((toast) => {
      setToasts((prev) => [...prev, { id: toast.id, message: toast.message }]);
      if (toast.highlightTaskId) {
        setHighlightTaskId(toast.highlightTaskId);
        setTimeout(() => setHighlightTaskId(null), 5000);
      }
    });
  }, []);

  // 初期ロード
  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  // 完了したプロジェクトは隠す（done 以外を表示）
  const visibleProjects = useMemo(
    () => projects.filter((p) => p.status !== "done"),
    [projects]
  );

  const openCreate = () => {
    setEditingProject(null);
    setShowProjectForm(true);
  };
  const openEdit = (p: Project) => {
    setEditingProject(p);
    setShowProjectForm(true);
  };
  const closeForm = () => {
    setShowProjectForm(false);
    setEditingProject(null);
  };

  const dismissToast = (id: string) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-header__logo">◎ multitasking</span>
        <div className="app-header__actions">
          <button
            className="app-header__btn"
            onClick={openCreate}
            title="プロジェクトを追加"
          >
            ＋ プロジェクト
          </button>
          <button
            className="app-header__btn"
            onClick={() => setShowSettings(true)}
            title="設定"
            aria-label="設定"
          >
            ⚙
          </button>
        </div>
      </header>

      {visibleProjects.length === 0 ? (
        <div className="app-empty">
          <p className="app-empty__msg">プロジェクトがありません</p>
          <button className="btn btn--primary btn--md" onClick={openCreate}>
            ＋ 最初のプロジェクトを作成
          </button>
        </div>
      ) : (
        <div className="project-grid">
          {visibleProjects.map((p) => (
            <ProjectPanel
              key={p.id}
              project={p}
              onEdit={openEdit}
              highlightTaskId={highlightTaskId}
            />
          ))}
        </div>
      )}

      {showProjectForm && (
        <ProjectForm project={editingProject ?? undefined} onClose={closeForm} />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
