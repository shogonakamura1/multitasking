use axum::{
    extract::State as AxumState,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use rand::Rng;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpListener;

use crate::models::{
    AiCompletedPayload, CreateProjectInput, CreateTaskInput, HookInfo, HookRequest, ProjectStatus,
    TaskStatus,
};
use crate::repository;
use crate::commands::DbState;

// ── State held in Tauri (also accessed by commands) ──────────────────────────

pub struct HookState {
    pub info: Mutex<HookInfo>,
}

// ── Internal axum shared state ────────────────────────────────────────────────

#[derive(Clone)]
struct ServerCtx {
    token: String,
    app: AppHandle,
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Spawn the axum hook server on a random loopback port.
/// Returns a `HookState` ready to be registered with Tauri.
pub async fn start(app: AppHandle) -> HookState {
    let port = find_free_port().await;
    let token = generate_token();
    let url = format!("http://127.0.0.1:{port}/hook");

    let ctx = ServerCtx {
        token: token.clone(),
        app,
    };

    let router = Router::new()
        .route("/hook", post(handle_hook))
        .with_state(ctx);

    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .expect("failed to bind hook server port");

    tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("hook server error");
    });

    HookState {
        info: Mutex::new(HookInfo { port, token, url }),
    }
}

// ── Request handler ───────────────────────────────────────────────────────────

async fn handle_hook(
    AxumState(ctx): AxumState<ServerCtx>,
    headers: HeaderMap,
    Json(req): Json<HookRequest>,
) -> StatusCode {
    // Bearer token check
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = format!("Bearer {}", ctx.token);
    if auth != expected {
        return StatusCode::UNAUTHORIZED;
    }

    // workdir matching — delegate to blocking thread to access Tauri state (Mutex<Connection>)
    let app = ctx.app.clone();
    let event = req.event.clone();
    let workdir = req.workdir.clone();
    tokio::task::spawn_blocking(move || {
        if let Err(e) = process_hook(&app, &req) {
            eprintln!(
                "[hook_server] error processing hook: event={event:?} workdir={workdir:?} err={e}"
            );
        }
    });

    StatusCode::OK
}

fn process_hook(app: &AppHandle, req: &HookRequest) -> Result<(), String> {
    let db_state = app
        .try_state::<DbState>()
        .ok_or_else(|| "DbState not initialised".to_string())?;

    let conn = db_state
        .0
        .lock()
        .map_err(|e| format!("db mutex poisoned: {e}"))?;

    // Load all projects to find the best workdir match
    let projects = repository::list_projects(&conn)?;

    let project = match repository::find_project_by_workdir(&projects, &req.workdir) {
        Some(p) => p.clone(),
        None => {
            // "prompt"（タスク自動追加）は workdir 未登録なら、フォルダ名でプロジェクトを自動作成
            if req.event == "prompt" {
                match project_name_from_workdir(&req.workdir) {
                    Some(name) => repository::create_project(
                        &conn,
                        CreateProjectInput {
                            name,
                            color: pick_color(projects.len()),
                            status: ProjectStatus::Active,
                            workdir: Some(req.workdir.clone()),
                        },
                    )?,
                    None => return Ok(()),
                }
            } else {
                return Ok(()); // no match — safe ignore
            }
        }
    };

    match req.event.as_str() {
        "stop" => handle_stop(app, &conn, &project.id, &project.name, req.task.as_deref()),
        "start" => handle_start(app, &conn, &project.id, req.task.as_deref()),
        "prompt" => handle_prompt(app, &conn, &project.id, req.task.as_deref()),
        "notify" => handle_notify(app, &project.id, &project.name, None, None),
        _ => Ok(()), // unknown event — ignore
    }
}

/// "prompt" イベント: ユーザがClaude Codeに頼んだ内容をタスクとして自動追加し、
/// AI作業中(waiting_ai)にする。同名タスクがあれば作り直さず再活性化（重複防止）。
fn handle_prompt(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    project_id: &str,
    text: Option<&str>,
) -> Result<(), String> {
    let raw = match text {
        Some(t) => t.trim(),
        None => return Ok(()),
    };
    if raw.is_empty() {
        return Ok(());
    }
    let title = truncate_title(raw, 80);

    match repository::find_task_by_title(conn, project_id, &title)? {
        Some(t) => {
            repository::set_task_status(conn, &t.id, TaskStatus::WaitingAi)?;
        }
        None => {
            repository::create_task(
                conn,
                CreateTaskInput {
                    project_id: project_id.to_string(),
                    title,
                    status: TaskStatus::WaitingAi,
                    next_action: None,
                    note: None,
                    due_today: false,
                },
            )?;
        }
    }

    let _ = app.emit("board_changed", ());
    Ok(())
}

/// プロンプト先頭行を最大 `max` 文字に丸めてタスク名にする。
fn truncate_title(s: &str, max: usize) -> String {
    let first_line = s.lines().next().unwrap_or(s).trim();
    let chars: Vec<char> = first_line.chars().collect();
    if chars.len() <= max {
        first_line.to_string()
    } else {
        let mut t: String = chars[..max].iter().collect();
        t.push('…');
        t
    }
}

/// workdir のフォルダ名を取り出す（自動作成プロジェクト名に使う）。
fn project_name_from_workdir(workdir: &str) -> Option<String> {
    std::path::Path::new(workdir)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

/// 自動作成プロジェクトの色をパレットから順番に割り当てる。
fn pick_color(index: usize) -> String {
    const PALETTE: &[&str] = &["blue", "green", "red", "amber", "purple", "slate"];
    PALETTE[index % PALETTE.len()].to_string()
}

fn handle_stop(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    project_id: &str,
    project_name: &str,
    task_hint: Option<&str>,
) -> Result<(), String> {
    // Prefer title-matching task if hint provided; fall back to oldest waiting_ai
    let target_task = if let Some(hint) = task_hint {
        repository::find_task_by_title(conn, project_id, hint)?
            .filter(|t| matches!(t.status, crate::models::TaskStatus::WaitingAi))
    } else {
        None
    };

    let task = match target_task {
        Some(t) => Some(t),
        None => repository::get_waiting_ai_tasks(conn, project_id)?
            .into_iter()
            .next(),
    };

    let task = match task {
        Some(t) => t,
        None => {
            // No waiting_ai task — emit notify only
            return handle_notify(app, project_id, project_name, None, None);
        }
    };

    let updated = repository::set_task_status(conn, &task.id, TaskStatus::InProgress)?;

    let payload = AiCompletedPayload {
        project_id: project_id.to_string(),
        task_id: Some(updated.id.clone()),
        project_name: project_name.to_string(),
        task_title: Some(updated.title.clone()),
    };

    let _ = app.emit("board_changed", ());
    let _ = app.emit("ai_completed", &payload);

    send_os_notification(app, project_name, Some(&updated.title));
    Ok(())
}

fn handle_start(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    project_id: &str,
    task_hint: Option<&str>,
) -> Result<(), String> {
    // Find task by title hint or fall back to latest created task
    let task = if let Some(hint) = task_hint {
        repository::find_task_by_title(conn, project_id, hint)?
    } else {
        None
    };

    let task = match task {
        Some(t) => Some(t),
        None => repository::get_latest_task(conn, project_id)?,
    };

    let task = match task {
        Some(t) => t,
        None => return Ok(()), // no task found — nothing to do
    };

    repository::set_task_status(conn, &task.id, TaskStatus::WaitingAi)?;
    let _ = app.emit("board_changed", ());
    Ok(())
}

fn handle_notify(
    app: &AppHandle,
    project_id: &str,
    project_name: &str,
    task_id: Option<String>,
    task_title: Option<String>,
) -> Result<(), String> {
    let payload = AiCompletedPayload {
        project_id: project_id.to_string(),
        task_id,
        project_name: project_name.to_string(),
        task_title: task_title.clone(),
    };

    let _ = app.emit("ai_completed", &payload);
    send_os_notification(app, project_name, task_title.as_deref());
    Ok(())
}

fn send_os_notification(app: &AppHandle, project_name: &str, task_title: Option<&str>) {
    use tauri_plugin_notification::NotificationExt;

    let body = task_title
        .map(|t| format!("{project_name}: {t} is ready"))
        .unwrap_or_else(|| format!("{project_name}: AI task completed"));

    let _ = app
        .notification()
        .builder()
        .title("Multitasking")
        .body(&body)
        .show();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async fn find_free_port() -> u16 {
    // Bind to port 0 and let the OS assign a free port
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to find free port");
    listener.local_addr().expect("no local addr").port()
}

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect()
}
