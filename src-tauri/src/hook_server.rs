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

use crate::models::{AiCompletedPayload, CreateTaskInput, HookInfo, HookRequest, TaskStatus};
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
    // 永続化した port/token を読み込み、再起動後も .claude/settings.json が有効なままにする
    let persisted = load_persisted(&app);
    let token = persisted
        .as_ref()
        .map(|p| p.token.clone())
        .unwrap_or_else(generate_token);

    // 保存済みポートに bind を試み、使用中なら OS 任せの空きポートへ退避
    let listener = match persisted.as_ref() {
        Some(p) => match TcpListener::bind(format!("127.0.0.1:{}", p.port)).await {
            Ok(l) => l,
            Err(_) => TcpListener::bind("127.0.0.1:0")
                .await
                .expect("failed to bind hook server port"),
        },
        None => TcpListener::bind("127.0.0.1:0")
            .await
            .expect("failed to bind hook server port"),
    };

    let port = listener.local_addr().expect("no local addr").port();
    let url = format!("http://127.0.0.1:{port}/hook");

    // 次回起動でも同じ port/token を使えるよう保存
    save_persisted(&app, port, &token);

    let ctx = ServerCtx {
        token: token.clone(),
        app,
    };

    let router = Router::new()
        .route("/hook", post(handle_hook))
        .with_state(ctx);

    tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("hook server error");
    });

    HookState {
        info: Mutex::new(HookInfo { port, token, url }),
    }
}

// ── Persisted hook config (stable port/token across restarts) ─────────────────

#[derive(serde::Serialize, serde::Deserialize)]
struct PersistedHook {
    port: u16,
    token: String,
}

fn hook_config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("hook.json"))
}

fn load_persisted(app: &AppHandle) -> Option<PersistedHook> {
    let path = hook_config_path(app)?;
    let s = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&s).ok()
}

fn save_persisted(app: &AppHandle, port: u16, token: &str) {
    let Some(path) = hook_config_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(s) = serde_json::to_string(&PersistedHook {
        port,
        token: token.to_string(),
    }) {
        let _ = std::fs::write(path, s);
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

    // workdir に一致する既存プロジェクトのみ対象にする（勝手に新規作成しない）。
    // 一致させたい場合はアプリでそのプロジェクトの「作業ディレクトリ」を設定する。
    let project = match repository::find_project_by_workdir(&projects, &req.workdir) {
        Some(p) => p.clone(),
        None => return Ok(()), // no match — safe ignore
    };

    match req.event.as_str() {
        "stop" => handle_stop(app, &conn, &project.id, &project.name, req.task.as_deref()),
        "start" => handle_start(app, &conn, &project.id, req.task.as_deref()),
        "prompt" => handle_prompt(app, &conn, &project.id, req.task.as_deref()),
        "extract" => handle_extract(
            app,
            &conn,
            &project.id,
            &project.name,
            req.transcript.as_deref(),
        ),
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

/// "extract" イベント: transcript JSONL から直近の user/assistant メッセージを取り出し、
/// ローカル LLM でやるべきタスクを抽出して `todo` で追加する。
fn handle_extract(
    app: &AppHandle,
    conn: &rusqlite::Connection,
    project_id: &str,
    project_name: &str,
    transcript_path: Option<&str>,
) -> Result<(), String> {
    let path = match transcript_path {
        Some(p) => p,
        None => {
            eprintln!("[hook_server] extract: no transcript path provided");
            return Ok(());
        }
    };

    // ── transcript JSONL を読み込む ────────────────────────────────────────
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[hook_server] extract: failed to read transcript {path}: {e}");
            return Ok(());
        }
    };

    let (last_user, last_assistant) = extract_last_messages(&content);

    if last_user.is_empty() && last_assistant.is_empty() {
        eprintln!("[hook_server] extract: no user/assistant messages found in transcript");
        return Ok(());
    }

    // ── LLM でタスク抽出 ────────────────────────────────────────────────────
    let titles = match extract_tasks_via_llm(project_name, &last_user, &last_assistant) {
        Some(t) => t,
        None => return Ok(()), // LLM 未起動/失敗 → 黙ってスキップ
    };

    if titles.is_empty() {
        return Ok(());
    }

    // ── DB に重複チェックしながら登録 ──────────────────────────────────────
    let mut created_count = 0usize;
    for title in &titles {
        match repository::find_task_by_title(conn, project_id, title)? {
            Some(_) => {} // 重複 — スキップ
            None => {
                repository::create_task(
                    conn,
                    CreateTaskInput {
                        project_id: project_id.to_string(),
                        title: title.clone(),
                        status: TaskStatus::Todo,
                        next_action: None,
                        note: None,
                        due_today: false,
                    },
                )?;
                created_count += 1;
            }
        }
    }

    if created_count > 0 {
        let _ = app.emit("board_changed", ());
    }
    Ok(())
}

// ── Transcript / LLM helpers (pub(crate) for unit tests) ─────────────────────

/// JSONL の各行を解析して直近の user / assistant テキストを返す。
/// content 配列にも文字列にも対応する防御的パース。
pub(crate) fn extract_last_messages(jsonl: &str) -> (String, String) {
    let mut last_user = String::new();
    let mut last_assistant = String::new();

    for line in jsonl.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        // type フィールドで "user" / "assistant" を判定
        let msg_type = val
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let text = extract_text_from_entry(&val);
        if text.is_empty() {
            continue;
        }

        match msg_type {
            "user" => last_user = text,
            "assistant" => last_assistant = text,
            _ => {}
        }
    }

    (last_user, last_assistant)
}

/// JSON エントリからテキストを連結して返す。
/// `message.content` が文字列の場合と配列の場合に対応。
fn extract_text_from_entry(val: &serde_json::Value) -> String {
    // message.content を探す
    let content = match val.get("message").and_then(|m| m.get("content")) {
        Some(c) => c,
        None => return String::new(),
    };

    content_to_text(content)
}

/// content が文字列 / 配列どちらでもテキストに変換する。
fn content_to_text(content: &serde_json::Value) -> String {
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    if let Some(arr) = content.as_array() {
        return arr
            .iter()
            .filter_map(|item| {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    item.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

/// タスク行テキストのクリーニング: 箇条書き記号・番号を除去し trim。
/// 空行・"なし"・"none" を除外し、最大 5 件に制限して返す。
pub(crate) fn clean_task_lines(raw: &str) -> Vec<String> {
    raw.lines()
        .map(|line| {
            let s = line.trim();
            // 先頭の記号 / 番号を除去: "- ", "* ", "・", "1. ", "1) " 等
            let s = s
                .trim_start_matches(|c: char| matches!(c, '-' | '*' | '・' | '•'))
                .trim_start();
            // "1. " / "1) " パターン
            let s = if let Some(rest) = strip_leading_number(s) {
                rest
            } else {
                s
            };
            s.trim().to_string()
        })
        .filter(|s| !is_junk_line(s))
        .take(5)
        .collect()
}

/// LLM が「空」のつもりで出す無意味な行や1文字ノイズを弾く。
fn is_junk_line(s: &str) -> bool {
    let t = s.trim();
    if t.chars().count() < 2 {
        return true; // 単一文字（"空" "-" 等）はノイズ
    }
    const JUNK: &[&str] = &[
        "none", "n/a", "なし", "ない", "無し", "特になし", "該当なし", "タスクなし", "空行",
        "（空）", "(空)",
    ];
    JUNK.iter().any(|j| t.eq_ignore_ascii_case(j))
}

/// "1. text" / "1) text" / "(1) text" の先頭番号を剥がす。
fn strip_leading_number(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    let mut pos = 0usize;
    // optional '('
    if bytes.first() == Some(&b'(') {
        pos += 1;
    }
    // digits (at least one)
    let digit_start = pos;
    while pos < bytes.len() && bytes[pos].is_ascii_digit() {
        pos += 1;
    }
    if pos == digit_start {
        return None; // no digits
    }
    // closing punctuation: '.' or ')'
    if pos >= bytes.len() || (bytes[pos] != b'.' && bytes[pos] != b')') {
        return None;
    }
    pos += 1;
    // optional single space
    if pos < bytes.len() && bytes[pos] == b' ' {
        pos += 1;
    }
    Some(s[pos..].trim())
}

/// LLM を呼んでタスク行を返す。失敗時は None。
fn extract_tasks_via_llm(
    project_name: &str,
    user_text: &str,
    assistant_text: &str,
) -> Option<Vec<String>> {
    // 精度を最優先（時間より質）。判断力の高いモデルを使う。
    const EXTRACT_LLM_MODEL: &str = "qwen2.5:7b";
    const EXTRACT_TIMEOUT_SECS: u64 = 45;

    let system = "あなたはタスク抽出器です。出力は必ず日本語のみ（中国語・英語・前置き・説明文・記号は禁止）。\
会話で話題になった具体的で着手可能な作業を、後から単独で見ても分かるタスク名で抽出する。タスク名以外は一切出力しない。";

    let prompt = format!(
        "プロジェクト「{project_name}」での、ユーザーの依頼とAIの応答です。\n\
このやり取りで挙がった『次にやり得る具体的な作業・次の一手』を、忘れないよう幅広く抽出してください。\n\
AIが提案・推奨した作業も含めます。後で不要なら削除する前提なので、迷ったら含める方向で。\n\n\
【含める】\n\
・ユーザーが言った、またはAIが提案・推奨した、具体的で着手可能な作業\n\
・『対象＋動作』の形で一文にできるもの\n\n\
【含めない】\n\
・質問・あいさつ・雑談など、作業でないもの\n\
・すでに完了したと明記された作業\n\
・「精度を上げる」「実装する」のような対象の無い抽象語だけのもの\n\
・同じ内容の重複\n\n\
【書式】\n\
・各タスクは『〜の〜を〜する』のように対象を含む具体的な一文（体言止め可）\n\
・1行1タスク、箇条書き記号や番号は付けない、最大5件\n\
・作業が一つも無ければ空で返す\n\n\
良い例:\n\
汀線残差に対する白波インデックス(surf index)の相関分析を実装する\n\
hookサーバに GET /tasks エンドポイントを追加する\n\n\
[依頼]\n{user_text}\n\n[応答]\n{assistant_text}"
    );

    let body = serde_json::json!({
        "model": EXTRACT_LLM_MODEL,
        "system": system,
        "prompt": prompt,
        "stream": false,
        "options": { "temperature": 0.3 }
    });

    let response = ureq::post("http://localhost:11434/api/generate")
        .timeout(std::time::Duration::from_secs(EXTRACT_TIMEOUT_SECS))
        .send_json(body);

    let response = match response {
        Ok(r) => r,
        Err(_) => return None, // 接続失敗/タイムアウト → スキップ
    };

    let json: serde_json::Value = match response.into_json() {
        Ok(j) => j,
        Err(_) => return None,
    };

    let raw = json
        .get("response")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())?;

    Some(clean_task_lines(&raw))
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

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| rng.sample(rand::distributions::Alphanumeric) as char)
        .collect()
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_last_messages ─────────────────────────────────────────────────

    #[test]
    fn extract_messages_string_content() {
        let jsonl = r#"{"type":"user","message":{"role":"user","content":"テストを追加して"}}
{"type":"assistant","message":{"role":"assistant","content":"了解しました。テストを追加します。"}}"#;
        let (user, assistant) = extract_last_messages(jsonl);
        assert_eq!(user, "テストを追加して");
        assert_eq!(assistant, "了解しました。テストを追加します。");
    }

    #[test]
    fn extract_messages_array_content() {
        let jsonl = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"バグを直して"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"直しました"},{"type":"text","text":"確認してください"}]}}"#;
        let (user, assistant) = extract_last_messages(jsonl);
        assert_eq!(user, "バグを直して");
        assert_eq!(assistant, "直しました\n確認してください");
    }

    #[test]
    fn extract_messages_takes_last_of_each_type() {
        let jsonl = r#"{"type":"user","message":{"role":"user","content":"最初の依頼"}}
{"type":"assistant","message":{"role":"assistant","content":"最初の応答"}}
{"type":"user","message":{"role":"user","content":"2番目の依頼"}}
{"type":"assistant","message":{"role":"assistant","content":"2番目の応答"}}"#;
        let (user, assistant) = extract_last_messages(jsonl);
        assert_eq!(user, "2番目の依頼");
        assert_eq!(assistant, "2番目の応答");
    }

    #[test]
    fn extract_messages_skips_invalid_lines() {
        let jsonl = "invalid json\n{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"有効\"}}";
        let (user, _) = extract_last_messages(jsonl);
        assert_eq!(user, "有効");
    }

    #[test]
    fn extract_messages_empty_input() {
        let (user, assistant) = extract_last_messages("");
        assert!(user.is_empty());
        assert!(assistant.is_empty());
    }

    // ── clean_task_lines ──────────────────────────────────────────────────────

    #[test]
    fn clean_task_lines_removes_bullet_symbols() {
        let raw = "- タスクA\n* タスクB\n・タスクC\n• タスクD";
        let result = clean_task_lines(raw);
        assert_eq!(result, vec!["タスクA", "タスクB", "タスクC", "タスクD"]);
    }

    #[test]
    fn clean_task_lines_removes_numbered_prefix() {
        let raw = "1. 最初のタスク\n2. 2番目のタスク\n(3) 3番目のタスク";
        let result = clean_task_lines(raw);
        assert_eq!(result, vec!["最初のタスク", "2番目のタスク", "3番目のタスク"]);
    }

    #[test]
    fn clean_task_lines_filters_empty_and_none() {
        let raw = "有効なタスク\n\nnone\nなし\nもう一つ";
        let result = clean_task_lines(raw);
        assert_eq!(result, vec!["有効なタスク", "もう一つ"]);
    }

    #[test]
    fn clean_task_lines_limits_to_five() {
        let raw = "タスクA\nタスクB\nタスクC\nタスクD\nタスクE\nタスクF\nタスクG";
        let result = clean_task_lines(raw);
        assert_eq!(result.len(), 5);
        assert_eq!(result[0], "タスクA");
        assert_eq!(result[4], "タスクE");
    }

    #[test]
    fn clean_task_lines_plain_text_unchanged() {
        let raw = "テストを書く\nドキュメントを更新する";
        let result = clean_task_lines(raw);
        assert_eq!(result, vec!["テストを書く", "ドキュメントを更新する"]);
    }

    #[test]
    fn clean_task_lines_filters_junk_and_single_char() {
        // 「空」「空行」などの幻覚出力と1文字ノイズは除外し、実タスクだけ残す
        let raw = "空\n空行\nなし\n-\nREADMEを更新する";
        let result = clean_task_lines(raw);
        assert_eq!(result, vec!["READMEを更新する"]);
    }
}
