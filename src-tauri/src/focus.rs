/// Focus detection: polls the window under the mouse cursor every second and
/// emits a `focus_changed` event so the frontend can highlight the relevant
/// project/task card.
///
/// macOS-only implementation.  On other platforms the poller is a no-op stub
/// so the crate still compiles cross-platform.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::DbState;
use crate::repository;

// ── Constants ─────────────────────────────────────────────────────────────────

/// Ollama model used for LLM-based project inference.
const FOCUS_LLM_MODEL: &str = "llama3.2";

/// Timeout for a single Ollama request (seconds).
const OLLAMA_TIMEOUT_SECS: u64 = 2;

/// Browsers that trigger LLM inference when they are the front window.
const BROWSER_NAMES: &[&str] = &["Chrome", "Safari", "Arc", "Edge", "Brave", "Firefox"];

// ── Shared state ──────────────────────────────────────────────────────────────

/// Managed state for focus-detection ON/OFF toggle.
pub struct FocusState {
    pub enabled: Arc<AtomicBool>,
}

impl FocusState {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(enabled)),
        }
    }
}

// ── Payload emitted to the frontend ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FocusChangedPayload {
    pub project_id: Option<String>,
    pub task_id: Option<String>,
    /// "name" | "llm" | "none"
    pub source: String,
    pub app_name: String,
    pub window_title: String,
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Spawn the background polling thread.  Must be called after `DbState` and
/// `FocusState` have been registered with Tauri.
pub fn start_poller(app: AppHandle) {
    std::thread::spawn(move || {
        run_poll_loop(app);
    });
}

/// macOS: 画面収録権限が無ければ一度だけ要求する。
/// これを呼ぶことで OS がアプリを「画面収録」リストに登録し、ユーザーにプロンプトを出す。
/// ウィンドウタイトル（タブ名）の取得にはこの権限が必要で、未許可だと kCGWindowName が空になる。
#[cfg(target_os = "macos")]
fn ensure_screen_recording_access() {
    use core_graphics::access::ScreenCaptureAccess;
    let access = ScreenCaptureAccess::default();
    if !access.preflight() {
        // 未許可: プロンプトを出し、システム設定の画面収録リストにアプリを登録する。
        access.request();
    }
}

#[cfg(not(target_os = "macos"))]
fn ensure_screen_recording_access() {}

// ── Poll loop ─────────────────────────────────────────────────────────────────

fn run_poll_loop(app: AppHandle) {
    let mut prev: Option<(Option<String>, Option<String>)> = None; // (project_id, task_id)

    // 起動時に一度だけ画面収録権限を要求（リスト登録＋プロンプト）
    ensure_screen_recording_access();

    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));

        // Check enabled flag
        let enabled = app
            .try_state::<FocusState>()
            .map(|s| s.enabled.load(Ordering::Relaxed))
            .unwrap_or(false);

        if !enabled {
            // Send a single "cleared" event if we were previously tracking
            let cleared_key = (None, None);
            if prev.as_ref() != Some(&cleared_key) {
                prev = Some(cleared_key);
                let payload = FocusChangedPayload {
                    project_id: None,
                    task_id: None,
                    source: "none".to_string(),
                    app_name: String::new(),
                    window_title: String::new(),
                };
                let _ = app.emit("focus_changed", &payload);
            }
            continue;
        }

        // Detect front window under cursor
        let (app_name, window_title) = match detect_front_window() {
            Some(info) => info,
            None => continue,
        };

        // Load projects + tasks from DB
        let db_state = match app.try_state::<DbState>() {
            Some(s) => s,
            None => continue,
        };
        let conn = match db_state.0.lock() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let projects = match repository::list_projects(&conn) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let tasks = match repository::list_tasks(&conn) {
            Ok(t) => t,
            Err(_) => continue,
        };
        drop(conn);

        // Determine project/task
        let payload = determine_focus(&app_name, &window_title, &projects, &tasks);

        // Debounce: skip emit if result identical to previous
        let key = (payload.project_id.clone(), payload.task_id.clone());
        if prev.as_ref() == Some(&key) {
            continue;
        }
        prev = Some(key);

        let _ = app.emit("focus_changed", &payload);
    }
}

// ── Window detection (macOS) ──────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn detect_front_window() -> Option<(String, String)> {
    use core_foundation::array::CFArray;
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_foundation_sys::array::CFArrayGetCount;
    use core_foundation_sys::array::CFArrayGetValueAtIndex;
    use core_foundation_sys::base::CFTypeRef;
    use core_foundation_sys::dictionary::CFDictionaryRef;
    use core_foundation_sys::number::CFNumberRef;
    use core_foundation_sys::string::CFStringRef;
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowLayer, kCGWindowListOptionOnScreenOnly,
        kCGWindowName, kCGWindowOwnerName,
    };

    // 1. Get cursor position via a null CGEvent
    let cursor = {
        let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok()?;
        CGEvent::new(src).ok()?.location()
    };

    // 2. Get on-screen window list (untyped CFArray<*const c_void>)
    let windows: CFArray = copy_window_info(kCGWindowListOptionOnScreenOnly, kCGNullWindowID)?;

    // Pre-build key CFStrings for lookup
    // SAFETY: kCGWindow* statics are valid CFStringRef exported by CG framework.
    let layer_key: CFString = unsafe { CFString::wrap_under_get_rule(kCGWindowLayer) };
    let bounds_key = CFString::new("kCGWindowBounds");
    let owner_key: CFString = unsafe { CFString::wrap_under_get_rule(kCGWindowOwnerName) };
    let name_key: CFString = unsafe { CFString::wrap_under_get_rule(kCGWindowName) };

    // 3. Iterate windows front-to-back using raw CFArray access
    // SAFETY: `windows` is a valid CFArray whose elements are CFDictionaryRefs.
    let count = unsafe { CFArrayGetCount(windows.as_concrete_TypeRef()) };

    for i in 0..count {
        // SAFETY: index is within bounds.
        let raw_ptr: CFTypeRef =
            unsafe { CFArrayGetValueAtIndex(windows.as_concrete_TypeRef(), i) };
        let dict_ref: CFDictionaryRef = raw_ptr as CFDictionaryRef;

        // Wrap as untyped CFDictionary — get_rule because we don't own it.
        // SAFETY: each element in the CG window array is a CFDictionary.
        let dict: CFDictionary<CFString, *const std::ffi::c_void> =
            unsafe { TCFType::wrap_under_get_rule(dict_ref) };

        // kCGWindowLayer must be 0
        let layer: i64 = dict
            .find(&layer_key)
            .and_then(|v| {
                let num_ref: CFNumberRef = *v as CFNumberRef;
                // SAFETY: value under kCGWindowLayer is a CFNumber.
                let num: CFNumber = unsafe { TCFType::wrap_under_get_rule(num_ref) };
                num.to_i64()
            })
            .unwrap_or(i64::MAX);

        if layer != 0 {
            continue;
        }

        // kCGWindowBounds
        let (x, y, w, h) = {
            let bounds_ptr = match dict.find(&bounds_key) {
                Some(v) => *v,
                None => continue,
            };
            let bounds_ref: CFDictionaryRef = bounds_ptr as CFDictionaryRef;
            // SAFETY: value under kCGWindowBounds is a CFDictionary.
            let bounds_dict: CFDictionary<CFString, *const std::ffi::c_void> =
                unsafe { TCFType::wrap_under_get_rule(bounds_ref) };

            let x = cf_dict_f64(&bounds_dict, "X").unwrap_or(0.0);
            let y = cf_dict_f64(&bounds_dict, "Y").unwrap_or(0.0);
            let w = cf_dict_f64(&bounds_dict, "Width").unwrap_or(0.0);
            let h = cf_dict_f64(&bounds_dict, "Height").unwrap_or(0.0);
            (x, y, w, h)
        };

        // Check if cursor is inside this window's bounding rect
        if cursor.x < x || cursor.x > x + w || cursor.y < y || cursor.y > y + h {
            continue;
        }

        // kCGWindowOwnerName (always present)
        let app_name = dict
            .find(&owner_key)
            .and_then(|v| {
                let sref: CFStringRef = *v as CFStringRef;
                // SAFETY: value under kCGWindowOwnerName is a CFString.
                let s: CFString = unsafe { TCFType::wrap_under_get_rule(sref) };
                Some(s.to_string())
            })
            .unwrap_or_default();

        // kCGWindowName (may be absent without Screen Recording permission)
        let window_title = dict
            .find(&name_key)
            .and_then(|v| {
                let sref: CFStringRef = *v as CFStringRef;
                // SAFETY: value under kCGWindowName is a CFString.
                let s: CFString = unsafe { TCFType::wrap_under_get_rule(sref) };
                Some(s.to_string())
            })
            .unwrap_or_default();

        return Some((app_name, window_title));
    }

    None
}

/// Read an f64 value from a raw-pointer CFDictionary<CFString, *const c_void>
/// using a string key.  Returns None if the key is absent or the value is not
/// a CFNumber.
#[cfg(target_os = "macos")]
fn cf_dict_f64(
    dict: &core_foundation::dictionary::CFDictionary<
        core_foundation::string::CFString,
        *const std::ffi::c_void,
    >,
    key: &str,
) -> Option<f64> {
    use core_foundation::base::TCFType;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_foundation_sys::number::CFNumberRef;

    let k = CFString::new(key);
    let val = dict.find(&k)?;
    let num_ref: CFNumberRef = *val as CFNumberRef;
    // SAFETY: values in the kCGWindowBounds dict are CFNumbers (CGFloat).
    let num: CFNumber = unsafe { TCFType::wrap_under_get_rule(num_ref) };
    num.to_f64()
}

/// Stub for non-macOS targets (keeps the crate cross-compilable).
#[cfg(not(target_os = "macos"))]
fn detect_front_window() -> Option<(String, String)> {
    None
}

// ── Focus determination ───────────────────────────────────────────────────────

fn determine_focus(
    app_name: &str,
    window_title: &str,
    projects: &[crate::models::Project],
    tasks: &[crate::models::Task],
) -> FocusChangedPayload {
    // 1. Name match
    if let Some((project_id, task_id)) = name_match(app_name, window_title, projects, tasks) {
        return FocusChangedPayload {
            project_id: Some(project_id),
            task_id,
            source: "name".to_string(),
            app_name: app_name.to_string(),
            window_title: window_title.to_string(),
        };
    }

    // 2. LLM match — only for browser windows
    if is_browser(app_name) {
        if let Some(project_id) = llm_match(window_title, projects) {
            return FocusChangedPayload {
                project_id: Some(project_id),
                task_id: None,
                source: "llm".to_string(),
                app_name: app_name.to_string(),
                window_title: window_title.to_string(),
            };
        }
    }

    // 3. No match
    FocusChangedPayload {
        project_id: None,
        task_id: None,
        source: "none".to_string(),
        app_name: app_name.to_string(),
        window_title: window_title.to_string(),
    }
}

/// Check if `app_name` contains any known browser identifier.
fn is_browser(app_name: &str) -> bool {
    BROWSER_NAMES.iter().any(|b| app_name.contains(b))
}

/// Try to match `window_title` or `app_name` against project names.
/// Returns `(project_id, Option<task_id>)` on success.
fn name_match(
    app_name: &str,
    window_title: &str,
    projects: &[crate::models::Project],
    tasks: &[crate::models::Task],
) -> Option<(String, Option<String>)> {
    let haystack_lower = format!("{} {}", window_title, app_name).to_lowercase();

    let matched_project = projects.iter().find(|p| {
        let needle = p.name.to_lowercase();
        haystack_lower.contains(&needle)
    })?;

    // Check if any task title also appears in the window title
    let matched_task = tasks
        .iter()
        .filter(|t| t.project_id == matched_project.id)
        .find(|t| {
            let needle = t.title.to_lowercase();
            window_title.to_lowercase().contains(&needle)
        })
        .map(|t| t.id.clone());

    Some((matched_project.id.clone(), matched_task))
}

/// Ask local Ollama to identify which project the window title belongs to.
/// Returns a project id on success, or `None` on any failure/timeout.
fn llm_match(window_title: &str, projects: &[crate::models::Project]) -> Option<String> {
    if projects.is_empty() || window_title.is_empty() {
        return None;
    }

    let project_names: Vec<&str> = projects.iter().map(|p| p.name.as_str()).collect();
    let names_list = project_names.join(", ");

    let prompt = format!(
        "Given these project names: [{names_list}]\n\
         And this browser window title: \"{window_title}\"\n\
         Which project name is most relevant? Reply with ONLY the exact project name, or \"none\" if none match."
    );

    let body = serde_json::json!({
        "model": FOCUS_LLM_MODEL,
        "prompt": prompt,
        "stream": false
    });

    let response = ureq::post("http://localhost:11434/api/generate")
        .timeout(std::time::Duration::from_secs(OLLAMA_TIMEOUT_SECS))
        .send_json(body);

    let response = match response {
        Ok(r) => r,
        Err(_) => return None, // connection refused, timeout, etc.
    };

    let json: serde_json::Value = match response.into_json() {
        Ok(j) => j,
        Err(_) => return None,
    };

    let answer = json
        .get("response")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())?;

    if answer.eq_ignore_ascii_case("none") || answer.is_empty() {
        return None;
    }

    // Match answer back to a real project id (case-insensitive)
    projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&answer))
        .map(|p| p.id.clone())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Project, ProjectStatus, Task, TaskStatus};

    fn make_project(id: &str, name: &str) -> Project {
        Project {
            id: id.to_string(),
            name: name.to_string(),
            color: "blue".to_string(),
            status: ProjectStatus::Active,
            workdir: None,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn make_task(id: &str, project_id: &str, title: &str) -> Task {
        Task {
            id: id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            status: TaskStatus::Todo,
            next_action: None,
            note: None,
            due_today: false,
            sort_order: 0,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn name_match_finds_project_by_window_title() {
        let projects = vec![make_project("p1", "MyProject")];
        let tasks = vec![];
        let result = name_match("Code", "MyProject - main.rs", &projects, &tasks);
        assert!(result.is_some());
        let (pid, tid) = result.unwrap();
        assert_eq!(pid, "p1");
        assert!(tid.is_none());
    }

    #[test]
    fn name_match_finds_task_when_title_in_window() {
        let projects = vec![make_project("p1", "Alpha")];
        let tasks = vec![make_task("t1", "p1", "Fix login bug")];
        let result = name_match("Code", "Alpha – Fix login bug — VS Code", &projects, &tasks);
        assert!(result.is_some());
        let (pid, tid) = result.unwrap();
        assert_eq!(pid, "p1");
        assert_eq!(tid, Some("t1".to_string()));
    }

    #[test]
    fn name_match_returns_none_when_no_project_matches() {
        let projects = vec![make_project("p1", "Backend")];
        let tasks = vec![];
        let result = name_match("Safari", "Google – Web Search", &projects, &tasks);
        assert!(result.is_none());
    }

    #[test]
    fn is_browser_detects_known_browsers() {
        assert!(is_browser("Google Chrome"));
        assert!(is_browser("Safari"));
        assert!(is_browser("Arc"));
        assert!(!is_browser("Xcode"));
        assert!(!is_browser("Terminal"));
    }

    #[test]
    fn determine_focus_name_match_source() {
        let projects = vec![make_project("p1", "Multitasking")];
        let tasks = vec![];
        let payload = determine_focus("Code", "Multitasking – lib.rs", &projects, &tasks);
        assert_eq!(payload.source, "name");
        assert_eq!(payload.project_id, Some("p1".to_string()));
    }

    #[test]
    fn determine_focus_none_when_no_match_non_browser() {
        let projects = vec![make_project("p1", "SomeOtherProject")];
        let tasks = vec![];
        let payload = determine_focus("Xcode", "Unrelated window", &projects, &tasks);
        assert_eq!(payload.source, "none");
        assert!(payload.project_id.is_none());
    }
}
