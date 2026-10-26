use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub project: Option<String>,
    #[serde(skip)]
    pub started_unix: Option<i64>,
}

const TIMEOUT: Duration = Duration::from_secs(3);

fn candidates() -> Vec<String> {
    let mut list = vec!["docker".to_string()];
    if cfg!(target_os = "macos") {
        list.push("/usr/local/bin/docker".into());
        list.push("/opt/homebrew/bin/docker".into());
        if let Some(home) = dirs::home_dir() {
            list.push(home.join(".docker/bin/docker").to_string_lossy().into_owned());
        }
        list.push("/Applications/Docker.app/Contents/Resources/bin/docker".into());
    } else if cfg!(target_os = "linux") {
        list.push("/usr/bin/docker".into());
        list.push("/usr/local/bin/docker".into());
    }
    list
}

static FOUND: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

fn command(bin: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000);
    }
    cmd
}

async fn binary() -> Option<String> {
    if let Some(bin) = FOUND.lock().ok().and_then(|f| f.clone()) {
        return Some(bin);
    }
    for bin in candidates() {
        let exists = if bin.contains('/') {
            std::path::Path::new(&bin).exists()
        } else {
            command(&bin, &["--version"]).output().await.is_ok()
        };
        if exists {
            if let Ok(mut f) = FOUND.lock() {
                *f = Some(bin.clone());
            }
            return Some(bin);
        }
    }
    None
}

async fn docker(args: &[&str]) -> Option<String> {
    let bin = binary().await?;
    let out = tokio::time::timeout(TIMEOUT, command(&bin, args).output()).await.ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn containers_by_port() -> Option<HashMap<u16, ContainerInfo>> {
    let out = docker(&["ps", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Label \"com.docker.compose.project\"}}"]).await?;
    let mut map = HashMap::new();
    let mut ids = Vec::new();
    for line in out.lines() {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 4 {
            continue;
        }
        let project = cols.get(4).map(|s| s.trim()).filter(|s| !s.is_empty()).map(String::from);
        let info = ContainerInfo {
            id: cols[0].trim().into(),
            name: cols[1].trim().into(),
            image: cols[2].trim().into(),
            project,
            started_unix: None,
        };
        ids.push(info.id.clone());
        for port in host_ports(cols[3]) {
            map.entry(port).or_insert_with(|| info.clone());
        }
    }
    if !ids.is_empty() {
        let mut args = vec!["inspect", "--format", "{{.Id}} {{.State.StartedAt}}"];
        args.extend(ids.iter().map(|s| s.as_str()));
        if let Some(out) = docker(&args).await {
            let started: HashMap<String, i64> = out
                .lines()
                .filter_map(|l| {
                    let (id, at) = l.split_once(' ')?;
                    Some((id.to_string(), parse_rfc3339(at.trim())?))
                })
                .collect();
            for info in map.values_mut() {
                info.started_unix = started.iter().find(|(full, _)| full.starts_with(&info.id)).map(|(_, t)| *t);
            }
        }
    }
    Some(map)
}

pub async fn stop(id: &str) -> Result<(), String> {
    run(&["stop", "--time", "3", id], "stop").await
}

pub async fn restart(id: &str) -> Result<(), String> {
    run(&["restart", "--time", "3", id], "restart").await
}

async fn run(args: &[&str], verb: &str) -> Result<(), String> {
    let bin = binary().await.ok_or("Couldn't find the docker command.")?;
    match tokio::time::timeout(Duration::from_secs(15), command(&bin, args).output()).await {
        Ok(Ok(out)) if out.status.success() => Ok(()),
        Ok(Ok(out)) => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(format!("Docker took too long to {verb} the container.")),
    }
}

fn host_ports(ports: &str) -> Vec<u16> {
    let mut out = Vec::new();
    for part in ports.split(',') {
        let Some((host, _)) = part.trim().split_once("->") else { continue };
        let Some(range) = host.rsplit(':').next() else { continue };
        let (a, b) = match range.split_once('-') {
            Some((a, b)) => (a.parse::<u16>().ok(), b.parse::<u16>().ok()),
            None => (range.parse::<u16>().ok(), range.parse::<u16>().ok()),
        };
        if let (Some(a), Some(b)) = (a, b) {
            for p in a..=b.min(a.saturating_add(256)) {
                if !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    out
}

fn parse_rfc3339(s: &str) -> Option<i64> {
    let s = s.trim_end_matches('Z');
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|v| v.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let time = time.split('.').next()?;
    let mut t = time.split(':').map(|v| v.parse::<i64>().ok());
    let (h, min, sec) = (t.next()??, t.next()??, t.next()??);
    if y < 1971 {
        return None;
    }
    let (y2, m2) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(days * 86400 + h * 3600 + min * 60 + sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_host_ports() {
        assert_eq!(host_ports("0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"), vec![5432]);
        assert_eq!(host_ports("0.0.0.0:8080-8081->80-81/tcp"), vec![8080, 8081]);
        assert_eq!(host_ports("6379/tcp"), Vec::<u16>::new());
        assert_eq!(host_ports("127.0.0.1:3001->3000/tcp, [::1]:3001->3000/tcp"), vec![3001]);
    }

    #[test]
    fn reads_started_at() {
        assert_eq!(parse_rfc3339("1970-01-01T00:00:00Z"), None);
        assert_eq!(parse_rfc3339("2026-10-25T09:12:04.123456789Z"), Some(1792919524));
        assert_eq!(parse_rfc3339("0001-01-01T00:00:00Z"), None);
    }
}
