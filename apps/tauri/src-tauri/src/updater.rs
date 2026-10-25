use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

const RELEASES: &str = "https://github.com/Nexvyn/Roulette/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub manual: bool,
    pub installing: bool,
}

#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    info: std::sync::Mutex<Option<UpdateInfo>>,
}

fn can_self_update() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

fn publish(app: &AppHandle, info: Option<UpdateInfo>) {
    if let Ok(mut slot) = app.state::<Updates>().info.lock() {
        *slot = info.clone();
    }
    let _ = app.emit("update-changed", info);
}

async fn check(app: &AppHandle) {
    let Ok(updater) = app.updater() else { return };
    let Ok(Some(update)) = updater.check().await else { return };
    let info = UpdateInfo { version: update.version.clone(), manual: !can_self_update(), installing: false };
    *app.state::<Updates>().pending.lock().await = Some(update);
    publish(app, Some(info));
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            check(&app).await;
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

#[tauri::command]
pub fn get_update(updates: State<'_, Updates>) -> Option<UpdateInfo> {
    updates.info.lock().ok().and_then(|i| i.clone())
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if !can_self_update() {
        return open::that(RELEASES).map_err(|e| e.to_string());
    }
    let updates = app.state::<Updates>();
    let Some(update) = updates.pending.lock().await.take() else { return Err("No update is waiting.".into()) };
    let mut info = UpdateInfo { version: update.version.clone(), manual: false, installing: true };
    publish(&app, Some(info.clone()));

    app.state::<crate::SharedStore>().lock().await.stop_all_tunnels();
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(e) => {
            info.installing = false;
            *updates.pending.lock().await = Some(update);
            publish(&app, Some(info));
            Err(e.to_string())
        }
    }
}
