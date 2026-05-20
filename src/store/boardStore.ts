import { create } from "zustand";
import type { Board, Project, Task, TaskStatus, CreateProjectInput, CreateTaskInput } from "../lib/types";
import * as ipc from "../lib/ipc";
import { showErrorToast } from "../hooks/useTauriEvent";

interface BoardState {
  projects: Project[];
  tasks: Task[];
  selectedTaskId: string | null;

  // 導出セレクタ
  waitingTasks: () => Task[];
  inProgressTasks: () => Task[];
  dueTodayTasks: () => Task[];
  selectedTask: () => Task | null;
  projectById: (id: string) => Project | undefined;

  // アクション
  fetchBoard: () => Promise<void>;
  selectTask: (id: string | null) => void;

  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (project: Project) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;

  createTask: (input: CreateTaskInput) => Promise<Task>;
  updateTask: (task: Task) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  setStatus: (id: string, status: TaskStatus) => Promise<void>;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  projects: [],
  tasks: [],
  selectedTaskId: null,

  // 導出セレクタ
  waitingTasks: () => get().tasks.filter((t) => t.status === "waiting_ai"),
  inProgressTasks: () => get().tasks.filter((t) => t.status === "in_progress"),
  dueTodayTasks: () =>
    get().tasks.filter(
      (t) => t.dueToday && t.status !== "done"
    ),
  selectedTask: () => {
    const id = get().selectedTaskId;
    if (!id) return null;
    return get().tasks.find((t) => t.id === id) ?? null;
  },
  projectById: (id: string) => get().projects.find((p) => p.id === id),

  fetchBoard: async () => {
    try {
      const board: Board = await ipc.getBoard();
      set({ projects: board.projects, tasks: board.tasks });
    } catch (err) {
      console.error("fetchBoard failed:", err);
    }
  },

  selectTask: (id) => set({ selectedTaskId: id }),

  createProject: async (input) => {
    try {
      const project = await ipc.createProject(input);
      set((s) => ({ projects: [...s.projects, project] }));
      return project;
    } catch (err) {
      console.error("createProject failed:", err);
      showErrorToast("プロジェクトの作成に失敗しました");
      throw err;
    }
  },

  updateProject: async (project) => {
    try {
      const updated = await ipc.updateProject(project);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === updated.id ? updated : p)),
      }));
      return updated;
    } catch (err) {
      console.error("updateProject failed:", err);
      showErrorToast("プロジェクトの更新に失敗しました");
      throw err;
    }
  },

  deleteProject: async (id) => {
    try {
      await ipc.deleteProject(id);
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== id),
        tasks: s.tasks.filter((t) => t.projectId !== id),
        selectedTaskId:
          s.selectedTaskId && s.tasks.find((t) => t.id === s.selectedTaskId)?.projectId === id
            ? null
            : s.selectedTaskId,
      }));
    } catch (err) {
      console.error("deleteProject failed:", err);
      showErrorToast("プロジェクトの削除に失敗しました");
      throw err;
    }
  },

  createTask: async (input) => {
    try {
      const task = await ipc.createTask(input);
      set((s) => ({ tasks: [...s.tasks, task] }));
      return task;
    } catch (err) {
      console.error("createTask failed:", err);
      showErrorToast("タスクの作成に失敗しました");
      throw err;
    }
  },

  updateTask: async (task) => {
    try {
      const updated = await ipc.updateTask(task);
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === updated.id ? updated : t)),
      }));
      return updated;
    } catch (err) {
      console.error("updateTask failed:", err);
      showErrorToast("タスクの更新に失敗しました");
      throw err;
    }
  },

  deleteTask: async (id) => {
    try {
      await ipc.deleteTask(id);
      set((s) => ({
        tasks: s.tasks.filter((t) => t.id !== id),
        selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
      }));
    } catch (err) {
      console.error("deleteTask failed:", err);
      showErrorToast("タスクの削除に失敗しました");
      throw err;
    }
  },

  setStatus: async (id, status) => {
    // 楽観更新
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, status, updatedAt: Date.now() } : t
      ),
    }));
    try {
      const updated = await ipc.setTaskStatus(id, status);
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === updated.id ? updated : t)),
      }));
    } catch (err) {
      // ロールバック
      await get().fetchBoard();
      console.error("setStatus failed:", err);
      showErrorToast("ステータスの変更に失敗しました");
    }
  },
}));
