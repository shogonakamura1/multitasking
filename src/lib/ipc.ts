// IPC_CONTRACT.md の全 command を型付き invoke ラッパで実装
import { invoke } from "@tauri-apps/api/core";
import type {
  Board,
  Project,
  Task,
  HookInfo,
  CreateProjectInput,
  CreateTaskInput,
  TaskStatus,
} from "./types";

export async function getBoard(): Promise<Board> {
  return invoke<Board>("get_board");
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  return invoke<Project>("create_project", { input });
}

export async function updateProject(project: Project): Promise<Project> {
  return invoke<Project>("update_project", { project });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke<void>("delete_project", { id });
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return invoke<Task>("create_task", { input });
}

export async function updateTask(task: Task): Promise<Task> {
  return invoke<Task>("update_task", { task });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke<void>("delete_task", { id });
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  return invoke<Task>("set_task_status", { id, status });
}

export async function reorderTasks(ids: string[]): Promise<void> {
  return invoke<void>("reorder_tasks", { ids });
}

export async function getHookInfo(): Promise<HookInfo> {
  return invoke<HookInfo>("get_hook_info");
}

export async function setFocusDetection(enabled: boolean): Promise<void> {
  return invoke<void>("set_focus_detection", { enabled });
}

export async function getFocusDetection(): Promise<boolean> {
  return invoke<boolean>("get_focus_detection");
}
