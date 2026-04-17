use std::sync::{Arc, Mutex};
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
    pub url: String,
    pub status: String,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanState {
    pub entries: Vec<PortEntry>,
    pub is_scanning: bool,
    pub last_error: Option<String>,
}

pub struct AppStore {
    state: Arc<Mutex<ScanState>>,
}

impl AppStore {
    pub fn new() -> Self {
        Self { state: Arc::new(Mutex::new(ScanState::default())) }
    }

    pub fn get_state(&self) -> ScanState {
        self.state.lock().unwrap().clone()
    }

    pub async fn scan(&self) {
        let raw = scan_ports().await;
        let entries = raw.into_iter().map(|r| PortEntry {
            id: r.port.to_string(),
            port: r.port,
            pid: r.pid,
            process_name: r.process_name.clone(),
            project_name: r.process_name,
            url: format!("http://localhost:{}", r.port),
            status: "running".to_string(),
            pinned: false,
        }).collect();
        let mut state = self.state.lock().unwrap();
        state.entries = entries;
        state.is_scanning = false;
    }
}