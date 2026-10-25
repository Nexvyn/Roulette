use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::process::Command;

use crate::port_scanner::{self, PortEntry, ScanDiagnostics};
use crate::settings::{self, AppSettings};
use crate::tunnel::TunnelInfo;
use tokio::sync::oneshot;

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
    tunnels: HashMap<u16, TunnelInfo>,
    tunnel_stops: HashMap<u16, oneshot::Sender<()>>,
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
            tunnels: HashMap::new(),
            tunnel_stops: HashMap::new(),
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
            .collect::<Vec<PortEntry>>();

        let gone: Vec<u16> = self.tunnels.keys().copied().filter(|p| !entries.iter().any(|e| e.port == *p)).collect();
        for port in gone {
            self.end_tunnel(port);
        }
        let entries = entries.into_iter().map(|mut e| { e.tunnel = self.tunnels.get(&e.port).cloned(); e }).collect();

        self.state = ScanState {
            entries,
            is_scanning: false,
            last_error: diag.last_error.clone(),
            diagnostics: Some(diag),
        };
    }

    pub async fn kill_port(&mut self, port: u16, pid: u32) {
        let target = self.state.entries.iter().find(|e| e.port == port);
        let container = target.and_then(|e| e.container.as_ref()).map(|c| c.id.clone());
        if container.is_none() && target.is_some_and(|e| e.is_docker()) {
            self.state.last_error = Some(format!("Port {port} is held by Docker itself, not a container Roulette can see. Stop it from Docker."));
            return;
        }

        self.recently_killed.insert(port, std::time::Instant::now());
        self.end_tunnel(port);

        for entry in &mut self.state.entries {
            if entry.port == port { entry.status = "terminating".into(); }
        }

        let result = match &container {
            Some(id) => crate::docker::stop(id).await,
            None => terminate_process(pid).await,
        };
        if let Err(e) = result {
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
        let ports: Vec<(u16, u32)> = self.state.entries.iter().filter(|e| !e.is_docker()).map(|e| (e.port, e.pid)).collect();
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

    pub fn begin_tunnel(&mut self, port: u16, info: TunnelInfo, stop: oneshot::Sender<()>) -> bool {
        if self.tunnels.get(&port).is_some_and(|t| t.status != "error") {
            return false;
        }
        self.tunnel_stops.insert(port, stop);
        self.set_tunnel(port, info);
        true
    }

    pub fn tunnel_status(&self, port: u16) -> Option<String> {
        self.tunnels.get(&port).map(|t| t.status.clone())
    }

    pub fn set_tunnel(&mut self, port: u16, info: TunnelInfo) {
        self.tunnels.insert(port, info.clone());
        for entry in &mut self.state.entries {
            if entry.port == port { entry.tunnel = Some(info.clone()); }
        }
    }

    pub fn fail_tunnel(&mut self, port: u16, info: TunnelInfo) {
        self.tunnel_stops.remove(&port);
        self.set_tunnel(port, info);
    }

    pub fn end_tunnel(&mut self, port: u16) {
        if let Some(stop) = self.tunnel_stops.remove(&port) {
            let _ = stop.send(());
        }
        self.tunnels.remove(&port);
        for entry in &mut self.state.entries {
            if entry.port == port { entry.tunnel = None; }
        }
    }

    pub fn stop_all_tunnels(&mut self) {
        let ports: Vec<u16> = self.tunnels.keys().copied().collect();
        for port in ports { self.end_tunnel(port); }
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
