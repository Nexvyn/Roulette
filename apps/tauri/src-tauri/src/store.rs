use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::process::Command;

use crate::port_scanner::{self, PortEntry, ScanDiagnostics};
use crate::settings::{self, AppSettings};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanState {
    pub entries: Vec<PortEntry>,
    pub is_scanning: bool,
    pub last_error: Option<String>,
    pub diagnostics: Option<ScanDiagnostics>,
}

pub struct AppStore {
    state: ScanState,
    settings: AppSettings,
    recently_killed: HashMap<u16, std::time::Instant>,
}

impl AppStore {
    pub fn new() -> Self {
        Self {
            state: ScanState {
                entries: vec![],
                is_scanning: false,
                last_error: None,
                diagnostics: None,
            },
            settings: settings::get_settings(),
            recently_killed: HashMap::new(),
        }
    }

    pub fn get_state(&self) -> &ScanState {
        &self.state
    }

    pub fn get_settings(&self) -> &AppSettings {
        &self.settings
    }

    pub async fn scan_now(&mut self) {
        if self.state.is_scanning { return; }
        self.state.is_scanning = true;

        let (entries, diag) = port_scanner::scan_ports().await;
        self.prune_killed();

        let entries = self.apply_custom_names(entries)
            .into_iter()
            .filter(|e| !self.recently_killed.contains_key(&e.port))
            .collect();

        self.state = ScanState {
            entries,
            is_scanning: false,
            last_error: diag.last_error.clone(),
            diagnostics: Some(diag),
        };
    }

    pub async fn kill_port(&mut self, port: u16, pid: u32) {
        self.recently_killed.insert(port, std::time::Instant::now());

        // Mark as terminating
        for entry in &mut self.state.entries {
            if entry.port == port { entry.status = "terminating".into(); }
        }

        if let Err(e) = terminate_process(pid).await {
            self.recently_killed.remove(&port);
            for entry in &mut self.state.entries {
                if entry.port == port { entry.status = "error".into(); }
            }
            self.state.last_error = Some(e);
            return;
        }

        self.state.entries.retain(|e| e.port != port);
    }

    pub async fn kill_all(&mut self) {
        let ports: Vec<(u16, u32)> = self.state.entries.iter().map(|e| (e.port, e.pid)).collect();
        for (port, pid) in ports {
            self.kill_port(port, pid).await;
        }
    }

    pub fn rename_port(&mut self, port: u16, name: &str) {
        let trimmed = name.trim();
        if trimmed.is_empty() { self.reset_port_name(port); return; }
        settings::set_custom_port_name(port, trimmed);
        for entry in &mut self.state.entries {
            if entry.port == port { entry.project_name = trimmed.into(); }
        }
    }

    pub fn reset_port_name(&mut self, port: u16) {
        settings::clear_custom_port_name(port);
        for entry in &mut self.state.entries {
            if entry.port == port { entry.project_name = entry.detected_project_name.clone(); }
        }
    }

    pub fn set_pinned(&mut self, port: u16, pinned: bool) {
        settings::set_pinned_port(port, pinned);
        for entry in &mut self.state.entries {
            if entry.port == port { entry.pinned = pinned; }
        }
    }

    pub fn update_settings(&mut self, patch: &serde_json::Value) {
        self.settings = settings::update_settings(patch);
    }

    fn apply_custom_names(&self, entries: Vec<PortEntry>) -> Vec<PortEntry> {
        let names = settings::get_custom_port_names();
        let pinned = settings::get_pinned_ports();
        entries.into_iter().map(|mut e| {
            if let Some(custom) = names.get(&e.port.to_string()) {
                e.project_name = custom.clone();
            }
            e.pinned = pinned.contains(&e.port);
            e
        }).collect()
    }

    fn prune_killed(&mut self) {
        let cutoff = std::time::Duration::from_secs(8);
        self.recently_killed.retain(|_, t| t.elapsed() < cutoff);
    }
}

async fn terminate_process(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt as _;
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        cmd.creation_flags(0x08000000);
        cmd.output().await.map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("kill").args(["-TERM", &pid.to_string()]).output().await.map_err(|e| e.to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        let _ = Command::new("kill").args(["-KILL", &pid.to_string()]).output().await;
        Ok(())
    }
}
