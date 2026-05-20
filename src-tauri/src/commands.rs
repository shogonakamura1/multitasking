use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::models::{Board, CreateProjectInput, CreateTaskInput, HookInfo, Project, Task, TaskStatus};
use crate::repository;
use crate::hook_server::HookState;

pub struct DbState(pub Mutex<rusqlite::Connection>);

// ── Board ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_board(state: State<'_, DbState>) -> Result<Board, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    repository::get_board(&conn)
}

// ── Project commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_project(
    input: CreateProjectInput,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let project = repository::create_project(&conn, input)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(project)
}

#[tauri::command]
pub fn update_project(
    project: Project,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let updated = repository::update_project(&conn, project)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(updated)
}

#[tauri::command]
pub fn delete_project(
    id: String,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    repository::delete_project(&conn, &id)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(())
}

// ── Task commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_task(
    input: CreateTaskInput,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let task = repository::create_task(&conn, input)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(task)
}

#[tauri::command]
pub fn update_task(
    task: Task,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let updated = repository::update_task(&conn, task)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(updated)
}

#[tauri::command]
pub fn delete_task(
    id: String,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    repository::delete_task(&conn, &id)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(())
}

#[tauri::command]
pub fn set_task_status(
    id: String,
    status: TaskStatus,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let task = repository::set_task_status(&conn, &id, status)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(task)
}

#[tauri::command]
pub fn reorder_tasks(
    ids: Vec<String>,
    state: State<'_, DbState>,
    app: AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    repository::reorder_tasks(&conn, &ids)?;
    drop(conn);
    let _ = app.emit("board_changed", ());
    Ok(())
}

// ── Hook info ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_hook_info(hook_state: State<'_, HookState>) -> Result<HookInfo, String> {
    let info = hook_state.info.lock().map_err(|e| e.to_string())?;
    Ok(info.clone())
}
