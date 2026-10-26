use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};

use crate::store::AppStore;

pub const CLOUDFLARED_DOWNLOADS: &str = "https://developers.cloudflare.com/tunnel/downloads/";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInfo {
    pub status: String,
    pub url: Option<String>,
    pub error: Option<String>,
    pub expires_at: Option<i64>,
}

impl TunnelInfo {
    fn starting() -> Self {
        Self { status: "starting".into(), url: None, error: None, expires_at: None }
    }

    fn live(url: String, expires_at: Option<i64>) -> Self {
        Self { status: "live".into(), url: Some(url), error: None, expires_at }
    }

    fn error(message: String) -> Self {
        Self { status: "error".into(), url: None, error: Some(message), expires_at: None }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub async fn start(app: AppHandle, store: Arc<Mutex<AppStore>>, port: u16) {
    let (stop_tx, stop_rx) = oneshot::channel();
    let lifetime;
    {
        let mut s = store.lock().await;
        if !s.begin_tunnel(port, TunnelInfo::starting(), stop_tx) {
            return;
        }
        lifetime = crate::settings::link_expiry_minutes(&s.get_settings().link_expiry).map(|m| Duration::from_secs(m * 60));
        crate::emit_state(&app, &mut s);
    }

    tauri::async_runtime::spawn(async move {
        let outcome = run(&app, &store, port, stop_rx, lifetime).await;
        let mut s = store.lock().await;
        match outcome {
            Outcome::Stopped => return,
            Outcome::Exited => s.end_tunnel(port),
            Outcome::Failed(message) => s.fail_tunnel(port, TunnelInfo::error(message)),
        }
        crate::emit_state(&app, &mut s);
    });
}

enum Outcome {
    Stopped,
    Exited,
    Failed(String),
}

/// An app opened from the Dock or Finder gets a bare PATH that leaves out Homebrew, so a cloudflared
/// installed with `brew install` would be reported as missing. Adds the usual places.
fn search_path() -> std::ffi::OsString {
    let mut dirs: Vec<std::path::PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let extra: &[&str] = if cfg!(target_os = "macos") {
        &["/opt/homebrew/bin", "/usr/local/bin"]
    } else if cfg!(target_os = "linux") {
        &["/usr/local/bin", "/usr/bin"]
    } else {
        &[]
    };
    for dir in extra {
        let dir = std::path::PathBuf::from(dir);
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

async fn run(app: &AppHandle, store: &Arc<Mutex<AppStore>>, port: u16, mut stop_rx: oneshot::Receiver<()>, lifetime: Option<Duration>) -> Outcome {
    let mut cmd = Command::new("cloudflared");
    cmd.args(["tunnel", "--no-autoupdate", "--url", &format!("http://localhost:{port}")])
        .env("PATH", search_path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Outcome::Failed(format!("cloudflared is not installed. Get it at {CLOUDFLARED_DOWNLOADS}"));
        }
        Err(e) => return Outcome::Failed(e.to_string()),
    };
    let Some(stderr) = child.stderr.take() else {
        return Outcome::Failed("Could not read cloudflared output.".into());
    };

    // cloudflared logs to stderr. The URL is printed before the edge connection is up, so the link only
    // counts as live once a connection is registered (opening it earlier fails to resolve).
    let mut lines = BufReader::new(stderr).lines();
    let mut url: Option<String> = None;
    let mut registered = false;
    let timeout = tokio::time::sleep(Duration::from_secs(30));
    tokio::pin!(timeout);
    let mut live = false;
    let expiry = tokio::time::sleep(Duration::from_secs(60 * 60 * 24 * 365));
    tokio::pin!(expiry);

    loop {
        tokio::select! {
            _ = &mut stop_rx => return Outcome::Stopped,
            _ = &mut expiry, if live && lifetime.is_some() => return Outcome::Exited,
            _ = &mut timeout, if !live => {
                return Outcome::Failed("Timed out waiting for Cloudflare to assign a URL.".into());
            }
            line = lines.next_line() => match line {
                Ok(Some(text)) if !live => {
                    if url.is_none() { url = find_url(&text); }
                    registered |= text.contains("Registered tunnel connection");
                    if let (Some(found), true) = (&url, registered) {
                        live = true;
                        let expires_at = lifetime.map(|d| {
                            expiry.as_mut().reset(tokio::time::Instant::now() + d);
                            now_ms() + d.as_millis() as i64
                        });
                        let (app, store, link) = (app.clone(), store.clone(), found.clone());
                        tauri::async_runtime::spawn(async move {
                            wait_for_dns(&link).await;
                            let mut s = store.lock().await;
                            if s.tunnel_status(port).as_deref() == Some("starting") {
                                s.set_tunnel(port, TunnelInfo::live(link, expires_at));
                                crate::emit_state(&app, &mut s);
                            }
                        });
                    }
                }
                Ok(Some(_)) => {}
                _ if !live => {
                    return Outcome::Failed("cloudflared exited before the tunnel was ready. Check your internet connection.".into());
                }
                _ => return Outcome::Exited,
            },
        }
    }
}

/// A new trycloudflare.com name takes a while to appear in DNS. Opening the link before then fails,
/// and the computer's own resolver then caches "not found" for minutes. So the link is only shown once
/// Cloudflare's public resolver (1.1.1.1) answers for it, which keeps the local cache out of it.
async fn wait_for_dns(url: &str) {
    let Some(host) = url.strip_prefix("https://").map(|h| h.trim_end_matches('/').to_string()) else { return };
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    while tokio::time::Instant::now() < deadline {
        if resolves(&host).await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(1500)).await;
    }
}

async fn resolves(host: &str) -> bool {
    let Ok(socket) = tokio::net::UdpSocket::bind("0.0.0.0:0").await else { return false };
    if socket.connect("1.1.1.1:53").await.is_err() {
        return false;
    }
    let query = dns_query(host, 0x5350);
    if socket.send(&query).await.is_err() {
        return false;
    }
    let mut buf = [0u8; 512];
    match tokio::time::timeout(Duration::from_secs(2), socket.recv(&mut buf)).await {
        Ok(Ok(n)) => answer_count(&buf[..n], 0x5350) > 0,
        _ => false,
    }
}

fn dns_query(host: &str, id: u16) -> Vec<u8> {
    let mut q = Vec::with_capacity(32 + host.len());
    q.extend_from_slice(&id.to_be_bytes());
    q.extend_from_slice(&[0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]); // recursion desired, one question
    for label in host.split('.') {
        q.push(label.len() as u8);
        q.extend_from_slice(label.as_bytes());
    }
    q.extend_from_slice(&[0, 0, 1, 0, 1]); // end of name, type A, class IN
    q
}

fn answer_count(reply: &[u8], id: u16) -> u16 {
    if reply.len() < 12 || reply[0..2] != id.to_be_bytes() || reply[3] & 0x0f != 0 {
        return 0;
    }
    u16::from_be_bytes([reply[6], reply[7]])
}

fn find_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let url: String = line[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '/' | '.' | '-'))
        .collect();
    let host = url.strip_prefix("https://")?;
    // The API host shows up in error logs; only the generated subdomain is a share link.
    (host.ends_with(".trycloudflare.com") && host != "api.trycloudflare.com").then_some(url)
}

#[cfg(test)]
mod tests {
    use super::find_url;

    #[test]
    fn finds_the_banner_url() {
        let line = "2026-10-23T10:00:00Z INF |  https://quiet-river-demo.trycloudflare.com  |";
        assert_eq!(find_url(line).as_deref(), Some("https://quiet-river-demo.trycloudflare.com"));
    }

    #[test]
    fn builds_a_dns_query_and_reads_the_answer_count() {
        let q = super::dns_query("ab.trycloudflare.com", 7);
        assert_eq!(&q[..4], &[0, 7, 0x01, 0x00]);
        assert_eq!(&q[12..15], &[2, b'a', b'b']);
        let mut reply = q.clone();
        reply[2] = 0x81; reply[3] = 0x80; reply[7] = 2; // response, no error, two answers
        assert_eq!(super::answer_count(&reply, 7), 2);
        reply[3] = 0x83; // NXDOMAIN
        assert_eq!(super::answer_count(&reply, 7), 0);
        assert_eq!(super::answer_count(&reply, 8), 0);
    }

    #[test]
    fn ignores_the_api_host_and_other_urls() {
        assert_eq!(find_url("POST https://api.trycloudflare.com/tunnel failed"), None);
        assert_eq!(find_url("see https://developers.cloudflare.com/tunnel/"), None);
    }
}
