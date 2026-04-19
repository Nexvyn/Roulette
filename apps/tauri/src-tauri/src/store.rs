use std::sync::{Arc, Mutex};
use std::collections::{HashMap, HashSet};
use crate::port_scanner::scan_ports;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    pub id: String,
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub project_name: String,
    pub detected_project_name: String,
    pub url: String,
    pub status: String,
    pub pinned: bool,
    pub branch: String,
    pub cwd: Option<String>,
    pub uptime_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanState {
    pub entries: Vec<PortEntry>,
    pub is_scanning: bool,
    pub last_error: Option<String>,
    pub diagnostics: Option<ScanDiagnostics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDiagnostics {
    pub duration_ms: u64,
    pub ports_found: usize,
    pub data_source: String,
    pub timestamp: String,
    pub last_error: Option<String>,
}

struct StoreData {
    state: ScanState,
    names: HashMap<u16, String>,
    pins: HashSet<u16>,
}

pub struct AppStore {
    data: Arc<Mutex<StoreData>>,
}

impl AppStore {
    pub fn new() -> Self {
        Self {
            data: Arc::new(Mutex::new(StoreData {
                state: ScanState::default(),
                names: HashMap::new(),
                pins: HashSet::new(),
            }))
        }
    }

    pub fn get_state(&self) -> ScanState {
        self.data.lock().unwrap().state.clone()
    }

    pub fn rename_port(&self, port: u16, name: String) {
        let mut d = self.data.lock().unwrap();
        if name.is_empty() { d.names.remove(&port); } else { d.names.insert(port, name); }
        Self::apply_names_inner(&mut d);
    }

    pub fn set_pinned(&self, port: u16, pinned: bool) {
        let mut d = self.data.lock().unwrap();
        if pinned { d.pins.insert(port); } else { d.pins.remove(&port); }
        for e in &mut d.state.entries {
            if e.port == port { e.pinned = pinned; }
        }
    }

    fn apply_names_inner(d: &mut StoreData) {
        for e in &mut d.state.entries {
            if let Some(n) = d.names.get(&e.port) {
                e.project_name = n.clone();
            } else {
                e.project_name = e.detected_project_name.clone();
            }
        }
    }

    pub async fn scan(&self) {
        let start = std::time::Instant::now();
        let raw = scan_ports().await;
        let duration_ms = start.elapsed().as_millis() as u64;
        let mut d = self.data.lock().unwrap();
        let entries: Vec<PortEntry> = raw.into_iter().map(|r| {
            let name = d.names.get(&r.port).cloned().unwrap_or_else(|| r.process_name.clone());
            PortEntry {
                id: r.port.to_string(),
                port: r.port,
                pid: r.pid,
                process_name: r.process_name.clone(),
                project_name: name,
                detected_project_name: r.process_name,
                url: format!("http://localhost:{}", r.port),
                status: "running".to_string(),
                pinned: d.pins.contains(&r.port),
                branch: String::new(),
                cwd: None,
                uptime_seconds: None,
            }
        }).collect();
        let ports_found = entries.len();
        let mut sorted = entries;
        sorted.sort_by_key(|e| (!e.pinned, e.port));
        d.state = ScanState {
            entries: sorted,
            is_scanning: false,
            last_error: None,
            diagnostics: Some(ScanDiagnostics {
                duration_ms,
                ports_found,
                data_source: "native".to_string(),
                timestamp: String::new(),
                last_error: None,
            }),
        };
    }
}