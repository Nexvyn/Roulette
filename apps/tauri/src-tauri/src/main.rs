#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod port_scanner;
mod settings;
mod store;

use store::AppStore;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewWindow,
};
use std::sync::Arc;
use tokio::sync::Mutex;

type SharedStore = Arc<Mutex<AppStore>>;

#[tauri::command]
async fn get_state(store: State<'_, SharedStore>) -> Result<serde_json::Value, String> {
    let s = store.lock().await;
    serde_json::to_value(s.get_state()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_settings(store: State<'_, SharedStore>) -> Result<serde_json::Value, String> {
    let s = store.lock().await;
    serde_json::to_value(s.get_settings()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_now(store: State<'_, SharedStore>, app: AppHandle) -> Result<(), String> {
    let mut s = store.lock().await;
    s.scan_now().await;
    emit_state(&app, &s);
    Ok(())
}

#[tauri::command]
async fn kill_port(store: State<'_, SharedStore>, app: AppHandle, port: u16, pid: u32) -> Result<(), String> {
    let mut s = store.lock().await;
    s.kill_port(port, pid).await;
    emit_state(&app, &s);
    Ok(())
}

#[tauri::command]
async fn kill_all(store: State<'_, SharedStore>, app: AppHandle) -> Result<(), String> {
    let mut s = store.lock().await;
    s.kill_all().await;
    emit_state(&app, &s);
    Ok(())
}

#[tauri::command]
async fn open_port(port: u16) -> Result<(), String> {
    open::that(format!("http://localhost:{}", port)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn copy_url(app: AppHandle, url: String) -> Result<(), String> {
    set_clipboard(&app, &url)
}

#[tauri::command]
async fn copy_port(app: AppHandle, port: u16) -> Result<(), String> {
    set_clipboard(&app, &port.to_string())
}

#[tauri::command]
async fn rename_port(store: State<'_, SharedStore>, app: AppHandle, port: u16, name: String) -> Result<(), String> {
    let mut s = store.lock().await;
    s.rename_port(port, &name);
    emit_state(&app, &s);
    Ok(())
}

#[tauri::command]
async fn reset_port_name(store: State<'_, SharedStore>, app: AppHandle, port: u16) -> Result<(), String> {
    let mut s = store.lock().await;
    s.reset_port_name(port);
    emit_state(&app, &s);
    Ok(())
}

#[tauri::command]
async fn set_pinned(store: State<'_, SharedStore>, app: AppHandle, port: u16, pinned: bool) -> Result<(), String> {
    let mut s = store.lock().await;
    s.set_pinned(port, pinned);
    emit_state(&app, &s);
    Ok(())
}

#[tauri::command]
async fn update_settings(store: State<'_, SharedStore>, patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut s = store.lock().await;
    s.update_settings(&patch);
    serde_json::to_value(s.get_settings()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_launch_at_login(store: State<'_, SharedStore>, enabled: bool) -> Result<bool, String> {
    let result = set_autostart(enabled);
    let mut s = store.lock().await;
    s.update_settings(&serde_json::json!({ "launchAtLogin": result }));
    Ok(result)
}

fn set_autostart(enabled: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        let mut cmd = std::process::Command::new("reg");
        if enabled {
            cmd.args(["add", key, "/v", "Port Menu", "/t", "REG_SZ", "/d", &format!("\"{}\" --hidden", exe), "/f"]);
        } else {
            cmd.args(["delete", key, "/v", "Port Menu", "/f"]);
        }
        cmd.creation_flags(0x08000000);
        let _ = cmd.output();
    }
    enabled
}

#[tauri::command]
async fn quit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

fn emit_state(app: &AppHandle, store: &AppStore) {
    let _ = app.emit("state-changed", store.get_state());
}

fn set_clipboard(app: &AppHandle, text: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let script = format!(
            "navigator.clipboard.writeText({})",
            serde_json::to_string(text).unwrap_or_default()
        );
        let _ = window.eval(&script);
    }
    Ok(())
}

fn toggle_window(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        position_near_tray(window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn position_near_tray(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let m = monitor.size();
        let scale = monitor.scale_factor();
        let size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(340, 400));
        let margin = (12.0 * scale) as i32;
        let taskbar = (48.0 * scale) as i32;
        let x = (m.width as i32 - size.width as i32 - margin).max(0);
        let y = (m.height as i32 - size.height as i32 - taskbar).max(0);
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let store = Arc::new(Mutex::new(AppStore::new()));
            app.manage(store.clone());

            // Build tray
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show Port Menu", true, None::<&str>)?;
            let refresh_item = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &refresh_item, &quit_item])?;

            let icon_bytes = include_bytes!("../icons/icon.png");
            let icon = Image::from_bytes(icon_bytes).unwrap_or_else(|_| Image::from_bytes(icon_bytes).unwrap());

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Port Menu")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                toggle_window(&w);
                            }
                        }
                        "refresh" => {
                            let store = app.state::<SharedStore>().inner().clone();
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut s = store.lock().await;
                                s.scan_now().await;
                                emit_state(&app_handle, &s);
                            });
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            toggle_window(&w);
                        }
                    }
                })
                .build(app)?;

            // Start background scanning
            let store_bg = store.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Initial scan
                {
                    let mut s = store_bg.lock().await;
                    s.scan_now().await;
                    emit_state(&app_handle, &s);
                }
                // Periodic scan, honoring the configured refresh interval
                loop {
                    let secs = {
                        store_bg.lock().await.get_settings().refresh_interval_seconds.max(1)
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
                    let mut s = store_bg.lock().await;
                    s.scan_now().await;
                    emit_state(&app_handle, &s);
                }
            });

            // Hide on blur (macOS only, matching the Electron app)
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let w = window.clone();
                    window.on_window_event(move |event| {
                        if let tauri::WindowEvent::Focused(false) = event {
                            let _ = w.hide();
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_settings,
            scan_now,
            kill_port,
            kill_all,
            open_port,
            copy_url,
            copy_port,
            rename_port,
            reset_port_name,
            set_pinned,
            update_settings,
            toggle_launch_at_login,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
