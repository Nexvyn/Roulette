use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::process::Command;

use crate::monitor::{Monitor, Notice, SystemMemory};
use crate::port_scanner::{self, PortEntry, ScanDiagnostics};
use crate::procs::Launch;
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
    pub memory: Option<SystemMemory>,
}

pub struct Alert {
    pub title: String,
    pub body: String,
}

pub enum RestartPlan {
    Container(String),
    Process { port: u16, root: u32, launch: Launch },
}

const SNOOZE_MINUTES: u64 = 60;

pub struct AppStore {
    state: ScanState,
    settings: AppSettings,
    recently_killed: HashMap<u16, std::time::Instant>,
    restarting: HashMap<u16, (Instant, PortEntry)>,
    tunnels: HashMap<u16, TunnelInfo>,
    tunnel_stops: HashMap<u16, oneshot::Sender<()>>,
    monitor: Monitor,
    alerts: Vec<Alert>,
}

impl AppStore {
    pub fn new() -> Self {
        Self {
            state: ScanState {
                entries: vec![],
                is_scanning: false,
                last_error: None,
                diagnostics: None,
                memory: None,
            },
            settings: settings::get_settings(),
            recently_killed: HashMap::new(),
            restarting: HashMap::new(),
            tunnels: HashMap::new(),
            tunnel_stops: HashMap::new(),
            monitor: Monitor::new(),
            alerts: vec![],
        }
    }

    pub fn get_state(&self) -> &ScanState {
        &self.state
    }

    pub fn get_settings(&self) -> &AppSettings {
        &self.settings
    }

    pub fn take_alerts(&mut self) -> Vec<Alert> {
        std::mem::take(&mut self.alerts)
    }

    pub fn needs_attention(&self) -> bool {
        self.state.entries.iter().any(|e| e.live.attention.is_some())
    }

    pub async fn scan_now(&mut self) {
        if self.state.is_scanning { return; }
        self.state.is_scanning = true;

        let (entries, diag) = port_scanner::scan_ports().await;
        self.prune_killed();

        let mut entries = apply_custom_names(entries)
            .into_iter()
            .filter(|e| !self.recently_killed.contains_key(&e.port))
            .collect::<Vec<PortEntry>>();

        self.restarting.retain(|port, (since, old)| {
            if entries.iter().any(|e| e.port == *port && e.pid != old.pid) {
                return false;
            }
            since.elapsed() < Duration::from_secs(45)
        });
        for (port, (_, old)) in &self.restarting {
            entries.retain(|e| e.port != *port);
            let mut kept = old.clone();
            kept.status = "restarting".into();
            entries.push(kept);
        }
        entries.sort_by_key(|e| e.port);

        let gone: Vec<u16> = self.tunnels.keys().copied().filter(|p| !entries.iter().any(|e| e.port == *p)).collect();
        for port in gone {
            self.end_tunnel(port);
        }
        for e in &mut entries {
            e.tunnel = self.tunnels.get(&e.port).cloned();
        }

        let notices = self.monitor.enrich(&mut entries, &self.settings);
        let memory = Some(self.monitor.system(&entries));

        self.state = ScanState {
            entries,
            is_scanning: false,
            last_error: diag.last_error.clone(),
            diagnostics: Some(diag),
            memory,
        };
        self.handle(notices).await;
    }

    async fn handle(&mut self, notices: Vec<Notice>) {
        let mut alerts = vec![];
        for notice in notices {
            match notice {
                Notice::Memory { name, port, bytes } => alerts.push(Alert {
                    title: format!("{name} is using {}", format_bytes(bytes)),
                    body: format!(":{port} is over your {} limit. Open Roulette to stop or snooze it.", format_bytes((self.settings.memory_alert_gb * 1024.0 * 1024.0 * 1024.0) as u64)),
                }),
                Notice::Growing { name, port, bytes } => alerts.push(Alert {
                    title: format!("{name} grew by {}", format_bytes(bytes)),
                    body: format!(":{port} grew that much in the last 10 minutes. It may be leaking memory."),
                }),
                Notice::Forgotten(ports) => {
                    let names: Vec<String> = ports.iter().filter_map(|p| self.state.entries.iter().find(|e| e.port == *p)).map(|e| e.project_name.clone()).collect();
                    match self.settings.cleanup.as_str() {
                        "ask" => alerts.push(Alert {
                            title: if names.len() == 1 { format!("{} looks forgotten", names[0]) } else { format!("{} servers look forgotten", names.len()) },
                            body: "They have been idle for a while or their folder is gone. Open Roulette and press Clean up.".into(),
                        }),
                        "auto" => {
                            self.stop_many(&ports).await;
                            alerts.push(Alert {
                                title: if names.len() == 1 { format!("Stopped {}", names[0]) } else { format!("Stopped {} forgotten servers", names.len()) },
                                body: format!("{} had been idle or their folder was gone.", names.join(", ")),
                            });
                        }
                        _ => {}
                    }
                }
            }
        }
        if self.settings.notifications {
            self.alerts.extend(alerts);
        }
    }

    pub async fn kill_port(&mut self, port: u16, pid: u32) {
        let target = self.state.entries.iter().find(|e| e.port == port);
        let container = target.and_then(|e| e.container.as_ref()).map(|c| c.id.clone());
        if container.is_none() && target.is_some_and(|e| e.is_docker()) {
            self.state.last_error = Some(format!("Port {port} is held by Docker itself, not a container Roulette can see. Stop it from Docker."));
            return;
        }
        let root = target.map(|e| e.live.root_pid).filter(|r| *r > 0).unwrap_or(pid);

        self.recently_killed.insert(port, std::time::Instant::now());
        self.restarting.remove(&port);
        self.end_tunnel(port);

        for entry in &mut self.state.entries {
            if entry.port == port { entry.status = "terminating".into(); }
        }

        let result = match &container {
            Some(id) => crate::docker::stop(id).await,
            None => stop_tree(root, self.monitor.tree(root)).await,
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
        let ports: Vec<(u16, u32)> = self.state.entries.iter().filter(|e| !e.is_docker() && !e.live.protected).map(|e| (e.port, e.pid)).collect();
        for (port, pid) in ports {
            self.kill_port(port, pid).await;
        }
    }

    pub async fn stop_many(&mut self, ports: &[u16]) {
        let targets: Vec<(u16, u32)> = self.state.entries.iter().filter(|e| ports.contains(&e.port)).map(|e| (e.port, e.pid)).collect();
        for (port, pid) in targets {
            self.kill_port(port, pid).await;
        }
    }

    pub fn snooze(&mut self, port: u16) {
        self.monitor.snooze(port, SNOOZE_MINUTES);
        for entry in &mut self.state.entries {
            if entry.port == port && entry.live.attention.is_some() {
                entry.live.attention = None;
                entry.live.snoozed = true;
            }
        }
    }

    pub fn begin_restart(&mut self, port: u16) -> Result<RestartPlan, String> {
        let entry = self.state.entries.iter().find(|e| e.port == port).cloned().ok_or("That server is no longer running.")?;
        let plan = match &entry.container {
            Some(c) => RestartPlan::Container(c.id.clone()),
            None => {
                let launch = self.monitor.launch(port).ok_or("Roulette can't see the command that started this server.")?;
                RestartPlan::Process { port, root: entry.live.root_pid, launch }
            }
        };
        for e in &mut self.state.entries {
            if e.port == port { e.status = "restarting".into(); }
        }
        self.restarting.insert(port, (Instant::now(), entry));
        Ok(plan)
    }

    pub fn tree(&self, root: u32) -> Vec<u32> {
        self.monitor.tree(root)
    }

    pub fn fail_restart(&mut self, port: u16, error: &str) {
        self.restarting.remove(&port);
        self.state.last_error = Some(error.into());
        for e in &mut self.state.entries {
            if e.port == port { e.status = "error".into(); }
        }
    }

    pub fn rename_port(&mut self, port: u16, name: &str) {
        let trimmed = name.trim();
        if trimmed.is_empty() { self.reset_port_name(port); return; }
        let Some(project) = self.detected_name(port) else { return };
        settings::set_custom_port_name(port, &project, trimmed);
        for entry in &mut self.state.entries {
            if entry.port == port { entry.project_name = trimmed.into(); }
        }
    }

    pub fn reset_port_name(&mut self, port: u16) {
        if let Some(project) = self.detected_name(port) {
            settings::clear_custom_port_name(port, &project);
        }
        for entry in &mut self.state.entries {
            if entry.port == port { entry.project_name = entry.detected_project_name.clone(); }
        }
    }

    fn detected_name(&self, port: u16) -> Option<String> {
        self.state.entries.iter().find(|e| e.port == port).map(|e| e.detected_project_name.clone())
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

    fn prune_killed(&mut self) {
        let cutoff = std::time::Duration::from_secs(8);
        self.recently_killed.retain(|_, t| t.elapsed() < cutoff);
    }
}

pub fn apply_custom_names(entries: Vec<PortEntry>) -> Vec<PortEntry> {
    let names = settings::get_custom_port_names();
    let pinned = settings::get_pinned_ports();
    entries.into_iter().map(|mut e| {
        if let Some(custom) = names.get(&settings::name_key(e.port, &e.detected_project_name)).or_else(|| names.get(&e.port.to_string())) {
            e.project_name = custom.clone();
        }
        e.pinned = pinned.contains(&e.port);
        e
    }).collect()
}

pub fn format_bytes(bytes: u64) -> String {
    let mb = bytes as f64 / (1024.0 * 1024.0);
    if mb >= 1024.0 {
        let gb = mb / 1024.0;
        if gb >= 10.0 { format!("{gb:.0} GB") } else { format!("{gb:.1} GB") }
    } else {
        format!("{mb:.0} MB")
    }
}

/// Stops a server and everything it started. Windows walks the tree itself; elsewhere every
/// process gets SIGTERM, and whatever is still running a moment later gets SIGKILL.
async fn stop_tree(root: u32, tree: Vec<u32>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = tree;
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &root.to_string(), "/T", "/F"]);
        cmd.creation_flags(0x08000000);
        cmd.output().await.map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let pids: Vec<String> = if tree.is_empty() { vec![root.to_string()] } else { tree.iter().map(|p| p.to_string()).collect() };
        Command::new("kill").arg("-TERM").args(&pids).output().await.map_err(|e| e.to_string())?;
        let ids: Vec<u32> = pids.iter().filter_map(|p| p.parse().ok()).collect();
        for _ in 0..10 {
            tokio::time::sleep(Duration::from_millis(150)).await;
            if crate::procs::alive(&ids).is_empty() {
                return Ok(());
            }
        }
        let left: Vec<String> = crate::procs::alive(&ids).iter().map(|p| p.to_string()).collect();
        if !left.is_empty() {
            let _ = Command::new("kill").arg("-KILL").args(&left).output().await;
        }
        Ok(())
    }
}

pub async fn run_restart(plan: RestartPlan, tree: Vec<u32>) -> Result<(), String> {
    match plan {
        RestartPlan::Container(id) => crate::docker::restart(&id).await,
        RestartPlan::Process { port, root, launch } => {
            stop_tree(root, tree).await?;
            for _ in 0..25 {
                if port_free(port) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            spawn(&launch, port)
        }
    }
}

fn port_free(port: u16) -> bool {
    let timeout = Duration::from_millis(150);
    ["127.0.0.1", "[::1]"].iter().all(|host| {
        format!("{host}:{port}").parse().map(|addr| std::net::TcpStream::connect_timeout(&addr, timeout).is_err()).unwrap_or(true)
    })
}

/// Runs the server's command again in its folder with its environment. There is no terminal to
/// print to, so its output goes to a log file next to the settings.
fn spawn(launch: &Launch, port: u16) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let log = settings::log_path(port);
    let out = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let first = &launch.argv[0];
    let mut cmd = if !cfg!(windows) && launch.argv.len() == 1 && first.contains(' ') {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", first.split(" (").next().unwrap_or(first)]);
        c
    } else {
        let program = if std::path::Path::new(first).is_absolute() { first.clone() } else { launch.exe.clone().unwrap_or_else(|| first.clone()) };
        let mut c = Command::new(program);
        c.args(&launch.argv[1..]);
        c
    };
    cmd.current_dir(&launch.cwd).stdin(Stdio::null()).stdout(out).stderr(err);
    if !launch.env.is_empty() {
        cmd.env_clear().envs(launch.env.iter().cloned());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000 | 0x00000200);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start it again: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
