use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::time::{Duration, Instant};

use crate::agents::{self, AgentSession};
use crate::github::{self, PullRequest};
use crate::port_scanner::PortEntry;
use crate::procs::{self, Launch, ProcInfo, Procs};
use crate::settings::AppSettings;

const WINDOW: Duration = Duration::from_secs(10 * 60);
const GROWTH: u64 = 500 * 1024 * 1024;
const ACTIVE_CPU: f32 = 2.0;
const GB: f64 = 1024.0 * 1024.0 * 1024.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Sample {
    pub t: i64,
    pub mem: u64,
    pub cpu: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub root_pid: u32,
    pub memory_bytes: Option<u64>,
    pub cpu_percent: Option<f32>,
    pub history: Vec<Sample>,
    pub processes: Vec<ProcInfo>,
    pub command: Option<String>,
    pub idle_seconds: Option<u64>,
    pub folder_missing: bool,
    pub protected: bool,
    pub attention: Option<String>,
    pub snoozed: bool,
    pub cleanup: Option<String>,
    pub can_restart: bool,
    pub session: Option<AgentSession>,
    pub workspace: Option<Workspace>,
    pub pull_request: Option<PullRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub app: String,
    pub name: String,
    pub link: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemory {
    pub used: u64,
    pub total: u64,
    pub servers: u64,
}

pub enum Notice {
    Memory { name: String, port: u16, bytes: u64 },
    Growing { name: String, port: u16, bytes: u64 },
    Forgotten(Vec<u16>),
}

struct Track {
    samples: VecDeque<Sample>,
    last_active: Instant,
    alerted: bool,
    snoozed_until: Option<Instant>,
    handled: bool,
}

pub struct Monitor {
    procs: Procs,
    tracks: HashMap<String, Track>,
    keys: HashMap<u16, String>,
    launches: HashMap<u16, Launch>,
}

impl Monitor {
    pub fn new() -> Self {
        Self { procs: Procs::new(), tracks: HashMap::new(), keys: HashMap::new(), launches: HashMap::new() }
    }

    /// CPU use is measured between two refreshes, so a one-off scan takes a first reading early.
    pub fn prime(&mut self) {
        self.procs.refresh();
    }

    pub fn enrich(&mut self, entries: &mut [PortEntry], settings: &AppSettings) -> Vec<Notice> {
        self.procs.refresh();
        let now = Instant::now();
        let now_ms = now_ms();
        let listeners: HashSet<u32> = entries.iter().filter(|e| e.pid > 0 && !e.is_docker()).map(|e| e.pid).collect();

        let mut wanted = vec![];
        let roots: Vec<Option<u32>> = entries
            .iter()
            .map(|e| {
                if e.pid == 0 || e.is_docker() || self.procs.node(e.pid).is_none() {
                    return None;
                }
                let root = self.procs.root_for(e.pid, &listeners);
                wanted.push(root);
                wanted.extend(self.procs.ancestors(e.pid, 8));
                Some(root)
            })
            .collect();
        wanted.sort_unstable();
        wanted.dedup();
        self.procs.load_details(&wanted);

        let threshold = (settings.memory_alert_gb > 0.0).then(|| (settings.memory_alert_gb * GB) as u64);
        let mut notices = vec![];
        let mut forgotten = vec![];
        let mut seen = HashSet::new();
        self.keys.clear();
        self.launches.clear();

        for (entry, root) in entries.iter_mut().zip(roots) {
            entry.live.root_pid = entry.pid;
            entry.live.protected = procs::is_protected(&entry.process_name)
                || self.procs.node(entry.pid).is_some_and(|n| procs::is_protected(&n.name));
            let Some(root) = root else { continue };
            entry.live.root_pid = root;
            if entry.uptime_seconds.is_none() {
                let start = self.procs.node(entry.pid).map(|n| n.start).unwrap_or(0) as i64;
                entry.uptime_seconds = (start > 0).then(|| (now_ms / 1000 - start).max(0) as u64);
            }

            let tree = self.procs.tree(root);
            let (mem, cpu) = self.procs.usage(&tree);
            entry.live.memory_bytes = Some(mem);
            entry.live.cpu_percent = Some(cpu);
            entry.live.processes = self.procs.processes(&tree).into_iter().take(8).collect();

            let cwd = self.procs.cwd(entry.pid).or_else(|| entry.cwd.clone());
            entry.live.folder_missing = cwd.as_deref().is_some_and(folder_gone);
            if let Some(launch) = self.procs.launch(root) {
                entry.live.command = Some(procs::pretty_command(&launch.argv));
                entry.live.can_restart = Path::new(&launch.cwd).is_dir();
                self.launches.insert(entry.port, launch);
            }

            let chain = self.procs.ancestors(entry.pid, 8);
            if settings.agent_sessions {
                let claude = self.procs.env_var(&chain, "CLAUDE_CODE_SESSION_ID");
                entry.live.session = agents::resolve(claude, cwd.as_deref());
                entry.live.workspace = self.workspace(&chain);
            }
            if settings.pull_requests {
                if let Some(root) = &entry.git_root {
                    entry.live.pull_request = github::lookup(root, &entry.branch);
                }
            }

            let start = self.procs.node(root).map(|n| n.start).unwrap_or(0);
            let key = format!("{}-{}-{}", entry.port, root, start);
            seen.insert(key.clone());
            self.keys.insert(entry.port, key.clone());
            let track = self.tracks.entry(key).or_insert_with(|| Track {
                samples: VecDeque::new(),
                last_active: now,
                alerted: false,
                snoozed_until: None,
                handled: false,
            });
            track.samples.push_back(Sample { t: now_ms, mem, cpu });
            while track.samples.front().is_some_and(|s| now_ms - s.t > WINDOW.as_millis() as i64) {
                track.samples.pop_front();
            }
            if cpu >= ACTIVE_CPU {
                track.last_active = now;
            }
            let idle = now.duration_since(track.last_active).as_secs();
            entry.live.idle_seconds = Some(idle);
            entry.live.history = track.samples.iter().copied().collect();

            let low = track.samples.iter().map(|s| s.mem).min().unwrap_or(mem);
            let attention = match threshold {
                Some(t) if mem >= t => Some("memory"),
                _ if settings.leak_alerts && mem.saturating_sub(low) >= GROWTH => Some("growing"),
                _ => None,
            };
            let snoozed = track.snoozed_until.is_some_and(|u| u > now);
            entry.live.snoozed = snoozed && attention.is_some();
            entry.live.attention = attention.filter(|_| !snoozed).map(String::from);
            match attention {
                Some(kind) if !track.alerted && !snoozed => {
                    track.alerted = true;
                    let name = entry.project_name.clone();
                    notices.push(if kind == "memory" {
                        Notice::Memory { name, port: entry.port, bytes: mem }
                    } else {
                        Notice::Growing { name, port: entry.port, bytes: mem.saturating_sub(low) }
                    });
                }
                None => track.alerted = false,
                _ => {}
            }

            let reason = if entry.live.protected || entry.pinned || entry.tunnel.is_some() {
                None
            } else if entry.live.folder_missing {
                Some("folder")
            } else if idle >= settings.idle_hours.max(1) * 3600 {
                Some("idle")
            } else {
                None
            };
            entry.live.cleanup = reason.map(String::from);
            match reason {
                Some(_) if !track.handled && entry.live.attention.is_none() => {
                    track.handled = true;
                    forgotten.push(entry.port);
                }
                None => track.handled = false,
                _ => {}
            }
        }

        self.tracks.retain(|k, _| seen.contains(k));
        if !forgotten.is_empty() {
            notices.push(Notice::Forgotten(forgotten));
        }
        notices
    }

    /// Conductor and Pane leave these in every command they start.
    fn workspace(&self, chain: &[u32]) -> Option<Workspace> {
        if let (Some(pane), Some(path)) = (self.procs.env_var(chain, "PANE_SESSION_ID"), self.procs.env_var(chain, "PANE_WORKSPACE_PATH")) {
            let panel = self.procs.env_var(chain, "PANE_PANEL_ID").map(|p| format!("&panel={}", encode(&p))).unwrap_or_default();
            let name = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(path);
            return Some(Workspace { app: "Pane".into(), name, link: Some(format!("pane://open?pane={}{panel}", encode(&pane))) });
        }
        let name = self.procs.env_var(chain, "CONDUCTOR_WORKSPACE_NAME")?;
        Some(Workspace { app: "Conductor".into(), name, link: None })
    }

    pub fn system(&self, entries: &[PortEntry]) -> SystemMemory {
        let (used, total) = self.procs.memory();
        let mut pids = HashSet::new();
        for e in entries.iter().filter(|e| e.live.memory_bytes.is_some()) {
            pids.extend(self.procs.tree(e.live.root_pid));
        }
        // RAM held right now, so servers, other apps and free add up to the machine's memory.
        let servers = pids.iter().filter_map(|p| self.procs.node(*p)).map(|n| n.resident).sum::<u64>().min(used);
        SystemMemory { used, total, servers }
    }

    pub fn launch(&self, port: u16) -> Option<Launch> {
        self.launches.get(&port).cloned()
    }

    pub fn snooze(&mut self, port: u16, minutes: u64) {
        if let Some(track) = self.keys.get(&port).and_then(|k| self.tracks.get_mut(k)) {
            track.snoozed_until = Some(Instant::now() + Duration::from_secs(minutes * 60));
        }
    }

    pub fn tree(&self, root: u32) -> Vec<u32> {
        self.procs.tree(root)
    }
}

fn encode(value: &str) -> String {
    value.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn folder_gone(cwd: &str) -> bool {
    cwd.ends_with(" (deleted)") || !Path::new(cwd).exists()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::encode;

    #[test]
    fn encodes_pane_ids() {
        assert_eq!(encode("abc-123"), "abc-123");
        assert_eq!(encode("a b&c"), "a%20b%26c");
    }
}
