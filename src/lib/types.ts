// IPC_CONTRACT.md の型定義

export type ProjectStatus = "active" | "paused" | "done";
export type TaskStatus = "todo" | "in_progress" | "waiting_ai" | "blocked" | "done";
export type ProjectColor = "blue" | "green" | "red" | "amber" | "purple" | "slate";

export interface Project {
  id: string;
  name: string;
  color: string; // "blue"|"green"|"red"|"amber"|"purple"|"slate"
  status: ProjectStatus;
  workdir: string | null;
  sortOrder: number;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  nextAction: string | null;
  note: string | null;
  dueToday: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number; // 経過時間バッジの基点
}

export interface Board {
  projects: Project[];
  tasks: Task[]; // 全タスク。グルーピングはフロントで導出
}

export interface CreateProjectInput {
  name: string;
  color: string;
  status?: ProjectStatus;
  workdir?: string | null;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  status?: TaskStatus;
  nextAction?: string | null;
  note?: string | null;
  dueToday?: boolean;
}

export interface HookInfo {
  port: number;
  token: string;
  url: string; // "http://127.0.0.1:<port>/hook"
}

export interface AiCompletedPayload {
  projectId: string;
  taskId: string | null;
  projectName: string;
  taskTitle: string | null;
}
