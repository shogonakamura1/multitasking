import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useBoardStore } from "./store/boardStore";
import { useTauriEvent, registerToastCallback } from "./hooks/useTauriEvent";
import { ProjectPanel } from "./components/project/ProjectPanel";
import { ProjectForm } from "./components/project/ProjectForm";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { ToastContainer } from "./components/ui/Toast";
import type { ToastItem } from "./components/ui/Toast";
import type { Project } from "./lib/types";

// 文字サイズの倍率（ヘッダーのトグルで循環）
const FONT_SCALES = [0.85, 1, 1.2, 1.45];
const FONT_LABELS = ["小", "中", "大", "特大"];
const FONT_SCALE_KEY = "multitasking:fontScaleIndex";

export default function App() {
  const fetchBoard = useBoardStore((s) => s.fetchBoard);
  const projects = useBoardStore((s) => s.projects);
  const focusProjectId = useBoardStore((s) => s.focusProjectId);
  const focusTaskId = useBoardStore((s) => s.focusTaskId);

  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [fontScaleIndex, setFontScaleIndex] = useState<number>(() => {
    const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
    return Number.isInteger(saved) && saved >= 0 && saved < FONT_SCALES.length ? saved : 1;
  });

  const cycleFontScale = () => {
    setFontScaleIndex((prev) => {
      const next = (prev + 1) % FONT_SCALES.length;
      localStorage.setItem(FONT_SCALE_KEY, String(next));
      return next;
    });
  };

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

  // 件数に応じた列数: ceil(√n) で「2→2列, 3→上2下1, 4→2×2, 5→上3下2, 6→3×3」を満たす
  const columns = useMemo(
    () => Math.max(1, Math.ceil(Math.sqrt(visibleProjects.length))),
    [visibleProjects.length]
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
    <div className="app" style={{ "--fs": FONT_SCALES[fontScaleIndex] } as CSSProperties}>
      <header className="app-header">
        <span className="app-header__logo">◎ multitasking</span>
        <div className="app-header__actions">
          <button
            className="app-header__btn"
            onClick={cycleFontScale}
            title="文字サイズを変更"
            aria-label={`文字サイズ: ${FONT_LABELS[fontScaleIndex]}`}
          >
            A {FONT_LABELS[fontScaleIndex]}
          </button>
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
        <div
          className="project-grid"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {visibleProjects.map((p) => (
            <ProjectPanel
              key={p.id}
              project={p}
              onEdit={openEdit}
              highlightTaskId={highlightTaskId}
              isFocused={focusProjectId === p.id}
              focusTaskId={focusProjectId === p.id ? focusTaskId : null}
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
