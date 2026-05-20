mod commands;
mod db;
mod focus;
mod hook_server;
mod models;
mod repository;

use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

use commands::DbState;
use focus::FocusState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ──────────────────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // ── Setup ─────────────────────────────────────────────────────────────
        .setup(|app| {
            // DB initialisation
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir)?;

            let db_path = data_dir.join("multitasking.db");
            let conn = db::init_db(&db_path).expect("failed to init sqlite db");
            app.manage(DbState(Mutex::new(conn)));

            // Hook server (async setup — block_on inside tokio rt)
            let app_handle = app.handle().clone();
            let hook_state = tauri::async_runtime::block_on(hook_server::start(app_handle));
            app.manage(hook_state);

            // Focus detection state — load persisted ON/OFF preference
            let initial_enabled = {
                let path = data_dir.join("focus_detection.txt");
                std::fs::read_to_string(&path)
                    .ok()
                    .map(|s| s.trim() != "0")
                    .unwrap_or(true) // default ON
            };
            app.manage(FocusState::new(initial_enabled));

            // Start the focus-detection polling thread
            let poller_handle = app.handle().clone();
            focus::start_poller(poller_handle);

            // Tray icon
            let handle = app.handle();
            build_tray(handle)?;

            Ok(())
        })
        // ── Window close → hide to tray (D1) ─────────────────────────────────
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        // ── Commands ──────────────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            commands::get_board,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::set_task_status,
            commands::reorder_tasks,
            commands::get_hook_info,
            commands::set_focus_detection,
            commands::get_focus_detection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    // Build with a programmatic 1×1 white RGBA image as placeholder icon
    // (the real icon is supplied by Tauri from icons/ at build time; this avoids
    //  a hard crash when no tray icon file is configured in tauri.conf.json yet)
    let rgba = vec![255u8, 255, 255, 255];
    let icon = Image::new_owned(rgba, 1, 1);

    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
