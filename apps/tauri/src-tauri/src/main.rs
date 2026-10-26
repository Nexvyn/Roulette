#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod cli;
mod docker;
mod github;
mod monitor;
mod port_scanner;
mod procs;
mod settings;
mod store;
mod tunnel;
mod updater;

use store::AppStore;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewWindow, Wry,
};
use std::sync::Arc;
use tokio::sync::Mutex;

type SharedStore = Arc<Mutex<AppStore>>;

struct TrayItems {
    show: MenuItem<Wry>,
    launch: CheckMenuItem<Wry>,
}

const TRAY_ID: &str = "main";

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
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn kill_port(store: State<'_, SharedStore>, app: AppHandle, port: u16, pid: u32) -> Result<(), String> {
    let mut s = store.lock().await;
    s.kill_port(port, pid).await;
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn kill_all(store: State<'_, SharedStore>, app: AppHandle) -> Result<(), String> {
    let mut s = store.lock().await;
    s.kill_all().await;
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn stop_ports(store: State<'_, SharedStore>, app: AppHandle, ports: Vec<u16>) -> Result<(), String> {
    let mut s = store.lock().await;
    s.stop_many(&ports).await;
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn restart_port(store: State<'_, SharedStore>, app: AppHandle, port: u16) -> Result<(), String> {
    let (plan, tree) = {
        let mut s = store.lock().await;
        let plan = s.begin_restart(port);
        let tree = match &plan {
            Ok(store::RestartPlan::Process { root, .. }) => s.tree(*root),
            _ => vec![],
        };
        emit_state(&app, &mut s);
        (plan?, tree)
    };
    let result = store::run_restart(plan, tree).await;
    let mut s = store.lock().await;
    if let Err(e) = &result {
        s.fail_restart(port, e);
    }
    s.scan_now().await;
    emit_state(&app, &mut s);
    result
}

#[tauri::command]
async fn snooze_port(store: State<'_, SharedStore>, app: AppHandle, port: u16) -> Result<(), String> {
    let mut s = store.lock().await;
    s.snooze(port);
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn open_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("pane://open?") {
        return Err("Only https links open from here.".into());
    }
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_in_editor(path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_dir() {
        return Err("That folder no longer exists.".into());
    }
    let missing = || "Couldn't open VS Code. Install it, or add the code command to your PATH.".to_string();
    #[cfg(target_os = "windows")]
    let status = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd").raw_arg(format!("/c code \"{path}\"")).creation_flags(0x08000000).status()
    };
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").args(["-a", "Visual Studio Code", &path]).status();
    #[cfg(target_os = "linux")]
    let status = std::process::Command::new("code").arg(&path).status();
    match status {
        Ok(s) if s.success() => Ok(()),
        _ => Err(missing()),
    }
}

#[tauri::command]
async fn install_cli() -> Result<String, String> {
    cli::install()
}

#[tauri::command]
async fn start_tunnel(store: State<'_, SharedStore>, app: AppHandle, port: u16) -> Result<(), String> {
    tunnel::start(app, store.inner().clone(), port).await;
    Ok(())
}

#[tauri::command]
async fn stop_tunnel(store: State<'_, SharedStore>, app: AppHandle, port: u16) -> Result<(), String> {
    let mut s = store.lock().await;
    s.end_tunnel(port);
    emit_state(&app, &mut s);
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
async fn rename_port(store: State<'_, SharedStore>, app: AppHandle, port: u16, name: String) -> Result<(), String> {
    let mut s = store.lock().await;
    s.rename_port(port, &name);
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn reset_port_name(store: State<'_, SharedStore>, app: AppHandle, port: u16) -> Result<(), String> {
    let mut s = store.lock().await;
    s.reset_port_name(port);
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn set_pinned(store: State<'_, SharedStore>, app: AppHandle, port: u16, pinned: bool) -> Result<(), String> {
    let mut s = store.lock().await;
    s.set_pinned(port, pinned);
    emit_state(&app, &mut s);
    Ok(())
}

#[tauri::command]
async fn update_settings(store: State<'_, SharedStore>, app: AppHandle, patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut s = store.lock().await;
    s.update_settings(&patch);
    if let Some(on) = patch.get("shortcut").and_then(|v| v.as_bool()) {
        set_shortcut(&app, on);
    }
    serde_json::to_value(s.get_settings()).map_err(|e| e.to_string())
}

fn shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let mods = if cfg!(target_os = "macos") { Modifiers::SUPER | Modifiers::ALT } else { Modifiers::CONTROL | Modifiers::ALT };
    Shortcut::new(Some(mods), Code::KeyP)
}

fn set_shortcut(app: &AppHandle, on: bool) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let registered = gs.is_registered(shortcut());
    if on && !registered {
        let _ = gs.register(shortcut());
    } else if !on && registered {
        let _ = gs.unregister(shortcut());
    }
}

#[tauri::command]
async fn toggle_launch_at_login(store: State<'_, SharedStore>, app: AppHandle, enabled: bool) -> Result<bool, String> {
    Ok(apply_launch_at_login(&app, store.inner(), enabled).await)
}

async fn apply_launch_at_login(app: &AppHandle, store: &SharedStore, enabled: bool) -> bool {
    let result = set_autostart(enabled);
    let mut s = store.lock().await;
    s.update_settings(&serde_json::json!({ "launchAtLogin": result }));
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.launch.set_checked(result);
    }
    let _ = app.emit("settings-changed", s.get_settings());
    result
}

fn set_autostart(enabled: bool) -> bool {
    match apply_autostart(enabled) {
        Ok(()) => enabled,
        Err(_) => !enabled,
    }
}

#[cfg(target_os = "windows")]
fn apply_autostart(enabled: bool) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    let exe = std::env::current_exe()?.to_string_lossy().into_owned();
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let mut cmd = std::process::Command::new("reg");
    if enabled {
        cmd.args(["add", key, "/v", "Roulette", "/t", "REG_SZ", "/d", &format!("\"{}\" --hidden", exe), "/f"]);
    } else {
        cmd.args(["delete", key, "/v", "Roulette", "/f"]);
    }
    cmd.creation_flags(0x08000000);
    cmd.output().map(|_| ())
}

#[cfg(target_os = "macos")]
fn apply_autostart(enabled: bool) -> std::io::Result<()> {
    let dir = dirs::home_dir().unwrap_or_default().join("Library/LaunchAgents");
    let file = dir.join("com.nexvyn.roulette.plist");
    if enabled {
        let exe = std::env::current_exe()?.to_string_lossy().into_owned();
        std::fs::create_dir_all(&dir)?;
        std::fs::write(
            file,
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict><key>Label</key><string>com.nexvyn.roulette</string><key>ProgramArguments</key><array><string>{exe}</string><string>--hidden</string></array><key>RunAtLoad</key><true/></dict></plist>
"
            ),
        )
    } else if file.exists() {
        std::fs::remove_file(file)
    } else {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn apply_autostart(enabled: bool) -> std::io::Result<()> {
    let dir = dirs::config_dir().unwrap_or_default().join("autostart");
    let file = dir.join("roulette.desktop");
    if enabled {
        let exe = std::env::current_exe()?.to_string_lossy().into_owned();
        std::fs::create_dir_all(&dir)?;
        std::fs::write(
            file,
            format!("[Desktop Entry]
Type=Application
Name=Roulette
Comment=Monitor and control local dev servers
Exec=\"{exe}\" --hidden
Terminal=false
X-GNOME-Autostart-enabled=true
"),
        )
    } else if file.exists() {
        std::fs::remove_file(file)
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn quit_app(store: State<'_, SharedStore>, app: AppHandle) -> Result<(), String> {
    quit(app, store.inner().clone()).await;
    Ok(())
}

/// Signals every tunnel to stop and gives the tasks a moment to kill cloudflared before exiting,
/// so no public URL is left running.
async fn quit(app: AppHandle, store: SharedStore) {
    store.lock().await.stop_all_tunnels();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    app.exit(0);
}

fn emit_state(app: &AppHandle, store: &mut AppStore) {
    let _ = app.emit("state-changed", store.get_state());
    let attention = store.needs_attention();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let count = store.get_state().entries.len();
        let tip = match (count, attention) {
            (0, _) => "Roulette".to_string(),
            (n, true) => format!("Roulette ({n}) · a server needs attention"),
            (n, false) => format!("Roulette ({n})"),
        };
        let _ = tray.set_tooltip(Some(tip));
        if TRAY_ALERT.swap(attention, std::sync::atomic::Ordering::SeqCst) != attention {
            let _ = tray.set_icon(Some(tray_icon(attention)));
        }
    }
    use tauri_plugin_notification::NotificationExt;
    for alert in store.take_alerts() {
        let _ = app.notification().builder().title(alert.title).body(alert.body).show();
    }
}

static TRAY_ALERT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The tray icon, with an amber dot in the corner while a server is using too much memory.
fn tray_icon(alert: bool) -> Image<'static> {
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png")).expect("bundled tray icon");
    if !alert {
        return icon.to_owned();
    }
    let (w, h) = (icon.width() as i32, icon.height() as i32);
    let mut rgba = icon.rgba().to_vec();
    let r = w.min(h) as f32 * 0.2;
    let (cx, cy) = (w as f32 - r - 1.0, h as f32 - r - 1.0);
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let cover = (r + 0.5 - d).clamp(0.0, 1.0);
            if cover <= 0.0 {
                continue;
            }
            let i = ((y * w + x) * 4) as usize;
            for (c, v) in [0xf5u8, 0x9e, 0x0b].iter().enumerate() {
                rgba[i + c] = (rgba[i + c] as f32 * (1.0 - cover) + *v as f32 * cover) as u8;
            }
            rgba[i + 3] = rgba[i + 3].max((cover * 255.0) as u8);
        }
    }
    Image::new_owned(rgba, w as u32, h as u32)
}

/// The global shortcut opens the panel where the tray click last put it.
fn toggle_from_shortcut(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        position_near_tray(window);
        let _ = window.show();
        let _ = window.set_focus();
    }
    sync_show_label(window);
}

fn sync_show_label(window: &WebviewWindow) {
    if let Some(items) = window.app_handle().try_state::<TrayItems>() {
        let visible = window.is_visible().unwrap_or(false);
        let _ = items.show.set_text(if visible { "Hide" } else { "Show" });
    }
}

// Written natively: the page's navigator.clipboard silently fails whenever the window isn't focused.
fn set_clipboard(app: &AppHandle, text: &str) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text.to_string()).map_err(|e| e.to_string())
}

static LAST_ANCHOR: std::sync::Mutex<Option<(f64, f64)>> = std::sync::Mutex::new(None);
static BLUR_HIDDEN: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
static SHOW_WHEN_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn hide_on_blur(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        if let Ok(mut at) = BLUR_HIDDEN.lock() {
            *at = Some(std::time::Instant::now());
        }
        sync_show_label(window);
    }
}

fn just_hidden_by_blur() -> bool {
    BLUR_HIDDEN.lock().ok().and_then(|at| *at).is_some_and(|at| at.elapsed() < std::time::Duration::from_millis(300))
}

fn toggle_window(window: &WebviewWindow, anchor: Option<tauri::PhysicalPosition<f64>>) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else if anchor.is_none() || !just_hidden_by_blur() {
        if let Ok(mut last) = LAST_ANCHOR.lock() {
            *last = anchor.map(|a| (a.x, a.y));
        }
        position_near_tray(window);
        let _ = window.show();
        let _ = window.set_focus();
    }
    sync_show_label(window);
}

fn clamp_i32(v: i32, lo: i32, hi: i32) -> i32 {
    if hi < lo { lo } else { v.clamp(lo, hi) }
}

fn compute_position(
    area: (i32, i32, i32, i32),
    win: (i32, i32),
    margin: i32,
    anchor: Option<(i32, i32)>,
    mac: bool,
) -> (i32, i32) {
    let (left, top) = (area.0, area.1);
    let (right, bottom) = (left + area.2, top + area.3);
    let (w, h) = win;

    let mut x = right - w - margin;
    let mut y = if mac { top + margin } else { bottom - h - margin };

    if let Some((ax, ay)) = anchor {
        let edges = [
            ((ay - top).abs(), "top"),
            ((bottom - ay).abs(), "bottom"),
            ((ax - left).abs(), "left"),
            ((right - ax).abs(), "right"),
        ];
        match edges.iter().min_by_key(|e| e.0).map(|e| e.1) {
            Some("top") => { x = ax - w / 2; y = top + margin; }
            Some("bottom") => { x = ax - w / 2; y = bottom - h - margin; }
            Some("left") => { x = left + margin; y = ay - h / 2; }
            _ => { x = right - w - margin; y = ay - h / 2; }
        }
    }

    (
        clamp_i32(x, left + margin, right - w - margin),
        clamp_i32(y, top + margin, bottom - h - margin),
    )
}

fn position_near_tray(window: &WebviewWindow) {
    let size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(340, 400));
    place_near_tray(window, (size.width as i32, size.height as i32));
}

/// Puts a window of `size` (physical pixels) next to the tray. When the size changes too, the move
/// and the resize land together, so a window hanging above a bottom taskbar never shows a frame
/// where it has grown downward before moving up.
fn place_near_tray(window: &WebviewWindow, size: (i32, i32)) {
    let anchor = LAST_ANCHOR.lock().ok().and_then(|a| *a);
    let monitor = anchor
        .and_then(|(x, y)| window.monitor_from_point(x, y).ok().flatten())
        .or_else(|| window.current_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let area = monitor.work_area();
    let (x, y) = compute_position(
        without_taskbar((area.position.x, area.position.y, area.size.width as i32, area.size.height as i32)),
        size,
        (12.0 * monitor.scale_factor()) as i32,
        anchor.map(|(ax, ay)| (ax as i32, ay as i32)),
        cfg!(target_os = "macos"),
    );
    set_bounds(window, x, y, size);
}

#[cfg(target_os = "windows")]
fn without_taskbar(area: (i32, i32, i32, i32)) -> (i32, i32, i32, i32) {
    #[repr(C)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
    #[repr(C)]
    struct AppBarData { size: u32, hwnd: isize, callback: u32, edge: u32, rc: Rect, lparam: isize }
    #[link(name = "shell32")]
    extern "system" {
        fn SHAppBarMessage(message: u32, data: *mut AppBarData) -> usize;
    }
    const ABM_GETTASKBARPOS: u32 = 5;
    let mut data = AppBarData {
        size: std::mem::size_of::<AppBarData>() as u32,
        hwnd: 0,
        callback: 0,
        edge: 0,
        rc: Rect { left: 0, top: 0, right: 0, bottom: 0 },
        lparam: 0,
    };
    if unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut data) } == 0 {
        return area;
    }
    trim_taskbar(area, data.edge, (data.rc.left, data.rc.top, data.rc.right, data.rc.bottom))
}

#[cfg(not(target_os = "windows"))]
fn without_taskbar(area: (i32, i32, i32, i32)) -> (i32, i32, i32, i32) {
    area
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn trim_taskbar((x, y, w, h): (i32, i32, i32, i32), edge: u32, (l, t, r, b): (i32, i32, i32, i32)) -> (i32, i32, i32, i32) {
    let (right, bottom) = (x + w, y + h);
    let overlaps = l < right && r > x && t < bottom && b > y;
    if !overlaps {
        return (x, y, w, h);
    }
    match edge {
        0 => (r.max(x), y, right - r.max(x), h),
        1 => (x, b.max(y), w, bottom - b.max(y)),
        2 => (x, y, l.min(right) - x, h),
        _ => (x, y, w, t.min(bottom) - y),
    }
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn SetWindowPos(hwnd: isize, insert_after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
}

/// Moves and resizes in one step. Windows has a native call for it; elsewhere the window hangs from
/// the top edge (macOS menu bar, most Linux panels), where resizing keeps the top in place anyway.
fn set_bounds(window: &WebviewWindow, x: i32, y: i32, (w, h): (i32, i32)) {
    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = window.hwnd() {
        const SWP_NOZORDER: u32 = 0x0004;
        const SWP_NOACTIVATE: u32 = 0x0010;
        unsafe { SetWindowPos(hwnd.0 as isize, 0, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE) };
        return;
    }
    let _ = window.set_size(tauri::PhysicalSize::new(w as u32, h as u32));
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

#[cfg(test)]
mod tests {
    use super::{compute_position, trim_taskbar};

    #[test]
    fn auto_hidden_taskbar_is_kept_clear() {
        assert_eq!(trim_taskbar((0, 0, 1920, 1080), 3, (0, 1032, 1920, 1080)), (0, 0, 1920, 1032));
        assert_eq!(trim_taskbar((0, 0, 1920, 1080), 1, (0, 0, 1920, 48)), (0, 48, 1920, 1032));
        assert_eq!(trim_taskbar((0, 0, 1920, 1080), 0, (0, 0, 60, 1080)), (60, 0, 1860, 1080));
        assert_eq!(trim_taskbar((0, 0, 1920, 1032), 3, (0, 1032, 1920, 1080)), (0, 0, 1920, 1032));
    }

    const AREA: (i32, i32, i32, i32) = (0, 0, 1920, 1080);
    const WIN: (i32, i32) = (425, 255);
    const M: i32 = 15;

    fn inside(p: (i32, i32)) -> bool {
        p.0 >= M && p.1 >= M && p.0 + WIN.0 <= 1920 - M && p.1 + WIN.1 <= 1080 - M
    }

    #[test]
    fn bottom_taskbar_windows() {
        let p = compute_position(AREA, WIN, M, Some((1500, 1065)), false);
        assert_eq!(p, (1500 - 212, 1080 - 255 - M));
        assert!(inside(p));
        let p = compute_position(AREA, WIN, M, Some((1800, 1065)), false);
        assert_eq!(p, (1920 - 425 - M, 1080 - 255 - M));
    }

    #[test]
    fn top_menu_bar_mac() {
        let p = compute_position(AREA, WIN, M, Some((1500, 5)), true);
        assert_eq!(p, (1500 - 212, M));
        assert!(inside(p));
        let p = compute_position(AREA, WIN, M, Some((1700, 5)), true);
        assert_eq!(p, (1920 - 425 - M, M));
    }

    #[test]
    fn left_edge() {
        let p = compute_position(AREA, WIN, M, Some((4, 500)), false);
        assert_eq!(p, (M, 500 - 127));
        assert!(inside(p));
    }

    #[test]
    fn right_edge() {
        let p = compute_position(AREA, WIN, M, Some((1916, 500)), false);
        assert_eq!(p, (1920 - 425 - M, 500 - 127));
        assert!(inside(p));
    }

    #[test]
    fn clamps_near_corner() {
        let p = compute_position(AREA, WIN, M, Some((1915, 1075)), false);
        assert!(inside(p));
    }

    #[test]
    fn no_anchor_defaults() {
        let win = compute_position(AREA, WIN, M, None, false);
        assert_eq!(win, (1920 - 425 - M, 1080 - 255 - M));
        let mac = compute_position(AREA, WIN, M, None, true);
        assert_eq!(mac, (1920 - 425 - M, M));
    }
}

#[tauri::command]
async fn panel_ready(window: WebviewWindow) -> Result<(), String> {
    if !SHOW_WHEN_READY.swap(false, std::sync::atomic::Ordering::SeqCst) || window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    toggle_window(&window, None);
    Ok(())
}

#[tauri::command]
async fn resize_window(window: WebviewWindow, height: f64) -> Result<(), String> {
    let h = height.ceil().clamp(80.0, 600.0);
    if !window.is_visible().unwrap_or(false) {
        return window.set_size(tauri::LogicalSize::new(340.0, h)).map_err(|e| e.to_string());
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    // `height` is the content height; the native move-and-resize works in outer size, which on
    // Windows includes an invisible border, so add whatever the window has around its content.
    let (outer, inner) = (window.outer_size().map_err(|e| e.to_string())?, window.inner_size().map_err(|e| e.to_string())?);
    let extra = (outer.width as i32 - inner.width as i32, outer.height as i32 - inner.height as i32);
    place_near_tray(&window, ((340.0 * scale).round() as i32 + extra.0, (h * scale).round() as i32 + extra.1));
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = cli::run(&args) {
        std::process::exit(code);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            toggle_from_shortcut(&w);
                        }
                    }
                })
                .build(),
        )
        .manage(updater::Updates::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let store = Arc::new(Mutex::new(AppStore::new()));
            app.manage(store.clone());

            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let refresh_item = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let launch_on = tauri::async_runtime::block_on(async { store.lock().await.get_settings().launch_at_login });
            let launch_item = CheckMenuItem::with_id(app, "launch", "Launch at Login", true, launch_on, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &refresh_item, &launch_item, &quit_item])?;
            app.manage(TrayItems { show: show_item.clone(), launch: launch_item.clone() });

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(tray_icon(false))
                .tooltip("Roulette")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            let store = app.state::<SharedStore>().inner().clone();
                            tauri::async_runtime::spawn(quit(app.clone(), store));
                        }
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                toggle_window(&w, None);
                            }
                        }
                        "launch" => {
                            let store = app.state::<SharedStore>().inner().clone();
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let current = store.lock().await.get_settings().launch_at_login;
                                apply_launch_at_login(&app_handle, &store, !current).await;
                            });
                        }
                        "refresh" => {
                            let store = app.state::<SharedStore>().inner().clone();
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let mut s = store.lock().await;
                                s.scan_now().await;
                                emit_state(&app_handle, &mut s);
                            });
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, position, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            toggle_window(&w, Some(position));
                        }
                    }
                })
                .build(app)?;

            let store_bg = store.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                {
                    let mut s = store_bg.lock().await;
                    s.scan_now().await;
                    emit_state(&app_handle, &mut s);
                }
                loop {
                    let secs = {
                        store_bg.lock().await.get_settings().refresh_interval_seconds.max(1)
                    };
                    tokio::time::sleep(std::time::Duration::from_secs(secs)).await;
                    let mut s = store_bg.lock().await;
                    s.scan_now().await;
                    emit_state(&app_handle, &mut s);
                }
            });

            updater::start(app.handle().clone());

            if tauri::async_runtime::block_on(async { store.lock().await.get_settings().shortcut }) {
                set_shortcut(app.handle(), true);
            }

            SHOW_WHEN_READY.store(cfg!(any(debug_assertions, target_os = "macos")), std::sync::atomic::Ordering::SeqCst);

            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = w.hide();
                        sync_show_label(&w);
                    }
                    tauri::WindowEvent::Focused(false) => hide_on_blur(&w),
                    _ => {}
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            get_settings,
            scan_now,
            kill_port,
            kill_all,
            stop_ports,
            restart_port,
            snooze_port,
            open_link,
            open_in_editor,
            install_cli,
            open_port,
            start_tunnel,
            stop_tunnel,
            copy_url,
            rename_port,
            reset_port_name,
            set_pinned,
            update_settings,
            toggle_launch_at_login,
            quit_app,
            resize_window,
            panel_ready,
            updater::get_update,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
