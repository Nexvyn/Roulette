use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub refresh_interval_seconds: u64,
    pub launch_at_login: bool,
    pub has_completed_onboarding: bool,
    pub show_diagnostics: bool,
    pub sort_by: String,
    pub theme_source: String,
    #[serde(default = "default_link_expiry")]
    pub link_expiry: String,
}

fn default_link_expiry() -> String {
    "never".into()
}

pub fn link_expiry_minutes(value: &str) -> Option<u64> {
    match value {
        "1h" => Some(60),
        "4h" => Some(240),
        _ => None,
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            refresh_interval_seconds: 5,
            launch_at_login: false,
            has_completed_onboarding: false,
            show_diagnostics: false,
            sort_by: "port".into(),
            theme_source: "system".into(),
            link_expiry: default_link_expiry(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredData {
    #[serde(flatten)]
    settings: AppSettings,
    #[serde(default)]
    custom_port_names: HashMap<String, String>,
    #[serde(default)]
    pinned_ports: Vec<u16>,
}

impl Default for StoredData {
    fn default() -> Self {
        Self { settings: AppSettings::default(), custom_port_names: HashMap::new(), pinned_ports: vec![] }
    }
}

fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    let path = base.join("Roulette").join("settings.json");
    // The app was called Ports; carry its settings over once.
    let old = base.join("Ports").join("settings.json");
    if !path.exists() && old.exists() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::copy(&old, &path);
    }
    path
}

fn load() -> StoredData {
    let path = config_path();
    fs::read_to_string(&path).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(data: &StoredData) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(data).unwrap_or_default());
}

pub fn get_settings() -> AppSettings {
    load().settings
}

pub fn update_settings(patch: &serde_json::Value) -> AppSettings {
    let mut data = load();
    if let Some(v) = patch.get("refreshIntervalSeconds").and_then(|v| v.as_u64()) {
        data.settings.refresh_interval_seconds = v;
    }
    if let Some(v) = patch.get("launchAtLogin").and_then(|v| v.as_bool()) {
        data.settings.launch_at_login = v;
    }
    if let Some(v) = patch.get("hasCompletedOnboarding").and_then(|v| v.as_bool()) {
        data.settings.has_completed_onboarding = v;
    }
    if let Some(v) = patch.get("showDiagnostics").and_then(|v| v.as_bool()) {
        data.settings.show_diagnostics = v;
    }
    if let Some(v) = patch.get("sortBy").and_then(|v| v.as_str()) {
        data.settings.sort_by = v.to_string();
    }
    if let Some(v) = patch.get("linkExpiry").and_then(|v| v.as_str()) {
        if ["1h", "4h", "never"].contains(&v) {
            data.settings.link_expiry = v.to_string();
        }
    }
    save(&data);
    data.settings
}

pub fn get_pinned_ports() -> Vec<u16> {
    load().pinned_ports
}

pub fn set_pinned_port(port: u16, pinned: bool) {
    let mut data = load();
    data.pinned_ports.retain(|&p| p != port);
    if pinned {
        data.pinned_ports.push(port);
    }
    save(&data);
}

pub fn get_custom_port_names() -> HashMap<String, String> {
    load().custom_port_names
}

pub fn name_key(port: u16, project: &str) -> String {
    format!("{port}:{project}")
}

pub fn set_custom_port_name(port: u16, project: &str, name: &str) {
    let mut data = load();
    data.custom_port_names.remove(&port.to_string());
    data.custom_port_names.insert(name_key(port, project), name.into());
    save(&data);
}

pub fn clear_custom_port_name(port: u16, project: &str) {
    let mut data = load();
    data.custom_port_names.remove(&port.to_string());
    data.custom_port_names.remove(&name_key(port, project));
    save(&data);
}
