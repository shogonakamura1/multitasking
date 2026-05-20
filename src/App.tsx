import { useCallback, useEffect, useMemo, useState } from "react";
import { useBoardStore } from "./store/boardStore";
import { useTauriEvent, registerToastCallback } from "./hooks/useTauriEvent";
import { MasterPane } from "./components/board/MasterPane";
import { DetailPane } from "./components/detail/DetailPane";
import { ProjectForm } from "./components/project/ProjectForm";
import { TaskForm } from "./components/project/TaskForm";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { ToastContainer } from "./components/ui/Toast";
import type { ToastItem } from "./components/ui/Toast";

// レスポンシブ退避のしきい値（U-04）
const NARROW_BREAKPOINT = 560;

const SELECTED_TASK_KEY = "multitasking:selectedTaskId";

export default function App() {
  const fetchBoard = useBoardStore((s) => s.fetchBoard);
  const selectedTaskId = useBoardStore((s) => s.selectedTaskId);
  const selectTask = useBoardStore((s) => s.selectTask);
  const setStatus = useBoardStore((s) => s.setStatus);
  const tasks = useBoardStore((s) => s.tasks);

  const [isNarrow, setIsNarrow] = useState(window.innerWidth < NARROW_BREAKPOINT);
  const [showDetail, setShowDetail] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);

  // Tauri イベント購読
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

  // 初期ロード + 選択状態の復元（T-14）
  useEffect(() => {
    void fetchBoard().then(() => {
      const saved = localStorage.getItem(SELECTED_TASK_KEY);
      if (saved) {
        const state = useBoardStore.getState();
        const exists = state.tasks.find((t) => t.id === saved);
        if (exists) {
          state.selectTask(saved);
        }
      }
    });
  }, [fetchBoard]);

  // 選択状態を localStorage に保存（T-14）
  useEffect(() => {
    if (selectedTaskId) {
      localStorage.setItem(SELECTED_TASK_KEY, selectedTaskId);
    } else {
      localStorage.removeItem(SELECTED_TASK_KEY);
    }
  }, [selectedTaskId]);

  // レスポンシブ監視
  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // narrow モードで選択時に詳細パネルを表示
  useEffect(() => {
    if (isNarrow && selectedTaskId) {
      setShowDetail(true);
    }
  }, [isNarrow, selectedTaskId]);

  // 全タスク（表示順）: 待ち → 進行中 → 今日
  // zustand v5: セレクタで新配列を返すと無限ループになるため raw tasks から useMemo で導出
  const waitingTasks = useMemo(
    () => tasks.filter((t) => t.status === "waiting_ai"),
    [tasks]
  );
  const inProgressTasks = useMemo(
    () => tasks.filter((t) => t.status === "in_progress"),
    [tasks]
  );
  const dueTodayTasks = useMemo(
    () => tasks.filter((t) => t.dueToday && t.status !== "done"),
    [tasks]
  );

  // キーボード操作（U-07 + WARN#2）
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // モーダルが開いているときはスキップ
      if (showProjectForm || showTaskForm || showSettings) return;

      // 入力中は ↑↓ 以外の独自キーをスキップ（input/textarea 判定）
      const target = e.target as HTMLElement;
      const isEditing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // ↑↓ グローバル選択移動（入力中は無効）
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isEditing) {
        e.preventDefault();
        const allDisplayed = [...waitingTasks, ...inProgressTasks, ...dueTodayTasks];
        if (allDisplayed.length === 0) return;
        const currentIndex = allDisplayed.findIndex((t) => t.id === selectedTaskId);
        if (currentIndex === -1) {
          // 未選択なら先頭を選択
          selectTask(allDisplayed[0].id);
        } else {
          const nextIndex =
            e.key === "ArrowDown"
              ? Math.min(currentIndex + 1, allDisplayed.length - 1)
              : Math.max(currentIndex - 1, 0);
          const nextTask = allDisplayed[nextIndex];
          if (nextTask) selectTask(nextTask.id);
        }
        return;
      }

      // S キー: 選択タスクの状態を次へ
      if (e.key === "s" || e.key === "S") {
        if (isEditing) return;
        if (!selectedTaskId) return;
        const task = tasks.find((t) => t.id === selectedTaskId);
        if (!task) return;
        const ALL = ["todo", "in_progress", "waiting_ai", "blocked", "done"] as const;
        const idx = ALL.indexOf(task.status);
        const next = ALL[(idx + 1) % ALL.length];
        void setStatus(selectedTaskId, next);
      }

      // Escape: 詳細パネルを閉じる（narrow モード）
      if (e.key === "Escape" && isNarrow && showDetail) {
        setShowDetail(false);
      }

      // N キー: タスク追加
      if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey) {
        if (isEditing) return;
        setShowTaskForm(true);
      }

      // , キー: 設定を開く
      if (e.key === ",") {
        if (isEditing) return;
        setShowSettings(true);
      }
    },
    [
      selectedTaskId,
      selectTask,
      tasks,
      setStatus,
      isNarrow,
      showDetail,
      showProjectForm,
      showTaskForm,
      showSettings,
      waitingTasks,
      inProgressTasks,
      dueTodayTasks,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <div className={`app ${isNarrow ? "app--narrow" : "app--wide"}`}>
      {/* ヘッダー */}
      <header className="app-header">
        <span className="app-header__logo">◎ multitasking</span>
        <div className="app-header__actions">
          <button
            className="app-header__btn"
            onClick={() => setShowProjectForm(true)}
            title="プロジェクトを追加"
            aria-label="プロジェクトを追加"
          >
            ＋ プロジェクト
          </button>
          <button
            className="app-header__btn"
            onClick={() => setShowSettings(true)}
            title="設定 (,)"
            aria-label="設定"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="app-main">
        {/* マスターペイン（常時表示） */}
        <section
          className={`app-master ${isNarrow && showDetail ? "app-master--hidden" : ""}`}
          aria-label="タスク一覧"
        >
          <MasterPane
            highlightTaskId={highlightTaskId}
            onAddTaskClick={() => setShowTaskForm(true)}
          />
        </section>

        {/* ディテールペイン */}
        {!isNarrow ? (
          // 通常幅: 右ペインとして常時表示
          <section className="app-detail" aria-label="タスク詳細">
            <DetailPane />
          </section>
        ) : showDetail ? (
          // narrow: オーバーレイ表示
          <div className="app-detail-overlay" role="dialog" aria-modal="true" aria-label="タスク詳細">
            <DetailPane onClose={() => setShowDetail(false)} />
          </div>
        ) : null}
      </main>

      {/* モーダル類 */}
      {showProjectForm && (
        <ProjectForm onClose={() => setShowProjectForm(false)} />
      )}
      {showTaskForm && (
        <TaskForm onClose={() => setShowTaskForm(false)} />
      )}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* トースト */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* キーボードヘルプ */}
      <div className="keyboard-hint" aria-hidden="true">
        <span>↑↓ 選択</span>
        <span>S 状態</span>
        <span>N 追加</span>
        <span>, 設定</span>
      </div>
    </div>
  );
}
