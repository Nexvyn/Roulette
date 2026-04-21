use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::process::Command;

const MIN_PORT: u16 = 1024;
const MAX_PORT: u16 = 49151;

const DEV_PROCESS_NAMES: &[&str] = &[
    "air", "beam.smp", "bun", "cargo", "deno", "elixir", "erl", "go", "gunicorn",
    "java", "mix", "next-server", "node", "npm", "php", "pnpm", "puma", "python",
    "python3", "rails", "ruby", "uvicorn", "vite", "yarn",
];

const BLOCKED_PROCESS_NAMES: &[&str] = &[
    "code", "discord", "explorer", "launchd", "lsass", "registry", "services",
    "slack", "svchost", "system", "systemd", "teams", "wininit", "winlogon",
];

const PROJECT_MARKERS: &[&str] = &[
    ".git", "package.json", "pnpm-workspace.yaml", "turbo.json",
    "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs",
    "next.config.ts", "pyproject.toml", "requirements.txt", "manage.py",
    "go.mod", "Gemfile", "mix.exs", "Cargo.toml", "deno.json", "deno.jsonc",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    pub id: String,
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub project_name: String,
    pub detected_project_name: String,
    pub branch: String,
    pub cwd: Option<String>,
    pub git_root: Option<String>,
    pub start_time: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub url: String,
    pub status: String,
    pub pinned: bool,
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

struct ParsedPort {
    pid: u32,
    port: u16,
    process_name: String,
}

pub async fn scan_ports() -> (Vec<PortEntry>, ScanDiagnostics) {
    let started = Instant::now();
    let data_source = if cfg!(target_os = "macos") { "lsof" }
        else if cfg!(target_os = "windows") { "netstat" }
        else { "ss" };

    match get_listening_ports().await {
        Ok(parsed) => {
            let entries = build_entries(parsed).await;
            (entries.clone(), ScanDiagnostics {
                duration_ms: started.elapsed().as_millis() as u64,
                ports_found: entries.len(),
                data_source: data_source.into(),
                timestamp: now_iso(),
                last_error: None,
            })
        }
        Err(e) => {
            (vec![], ScanDiagnostics {
                duration_ms: started.elapsed().as_millis() as u64,
                ports_found: 0,
                data_source: data_source.into(),
                timestamp: now_iso(),
                last_error: Some(e),
            })
        }
    }
}

async fn get_listening_ports() -> Result<Vec<ParsedPort>, String> {
    if cfg!(target_os = "macos") {
        let out = run_cmd("/usr/sbin/lsof", &["-iTCP", "-sTCP:LISTEN", "-n", "-P"]).await?;
        Ok(parse_mac_lsof(&out))
    } else if cfg!(target_os = "windows") {
        let out = run_cmd("netstat", &["-ano", "-p", "tcp"]).await?;
        Ok(parse_windows_netstat(&out))
    } else {
        match run_cmd("ss", &["-tlnp"]).await {
            Ok(out) => Ok(parse_linux_ss(&out)),
            Err(_) => {
                let out = run_cmd("netstat", &["-tlnp"]).await?;
                Ok(parse_linux_netstat(&out))
            }
        }
    }
}

async fn build_entries(parsed: Vec<ParsedPort>) -> Vec<PortEntry> {
    let mut unique: HashMap<u16, ParsedPort> = HashMap::new();
    for p in parsed {
        unique.entry(p.port).or_insert(p);
    }
    let mut sorted: Vec<_> = unique.into_values().collect();
    sorted.sort_by_key(|p| p.port);

    let win_map = if cfg!(target_os = "windows") { Some(get_windows_process_map().await) } else { None };

    let mut result = Vec::new();
    for info in sorted {
        let (process_name, cwd, start_time, uptime_seconds): (String, Option<String>, Option<String>, Option<u64>) =
            if let Some(ref map) = win_map {
                match map.get(&info.pid) {
                    Some(p) => {
                        let pname = derive_windows_name(p.name.trim_end_matches(".exe"), &p.command_line);
                        let c = infer_windows_cwd(&p.command_line, p.executable_path.as_deref());
                        let up = if p.start_ms > 0 { Some((((now_ms() - p.start_ms).max(0)) / 1000) as u64) } else { None };
                        (pname, c, None, up)
                    }
                    None => (info.process_name.clone(), None, None, None),
                }
            } else {
                let (pn, c) = resolve_process_info(info.pid, &info.process_name).await;
                let (st, up) = get_start_time_and_uptime(info.pid).await;
                (pn, c, st, up)
            };

        let lower = process_name.to_lowercase();
        if BLOCKED_PROCESS_NAMES.contains(&lower.as_str()) {
            continue;
        }

        let docker = is_docker_process(&process_name);
        if !docker {
            if let Some(ref c) = cwd {
                if is_blocked_path(c) { continue; }
            }
        }

        let git_root = match &cwd {
            Some(c) => find_git_root(c).await,
            None => None,
        };
        let has_ctx = git_root.is_some() || has_project_markers(&cwd).await;

        let cwd_base_dev = cwd.as_deref()
            .and_then(|c| Path::new(c).file_name())
            .map(|n| DEV_PROCESS_NAMES.contains(&n.to_string_lossy().to_lowercase().as_str()))
            .unwrap_or(false);

        if !docker && !has_ctx && !DEV_PROCESS_NAMES.contains(&lower.as_str()) && !lower.starts_with("python") && !cwd_base_dev {
            continue;
        }

        let branch = match &git_root {
            Some(r) => resolve_git_branch(r).await,
            None => String::new(),
        };
        let project_name = get_project_name(&process_name, &cwd, &git_root);

        result.push(PortEntry {
            id: format!("{}-{}", info.port, info.pid),
            port: info.port,
            pid: info.pid,
            process_name: process_name.clone(),
            project_name: project_name.clone(),
            detected_project_name: project_name,
            branch,
            cwd,
            git_root,
            start_time,
            uptime_seconds,
            url: format!("http://localhost:{}", info.port),
            status: "running".into(),
            pinned: false,
        });
    }
    result
}

struct WinProc {
    name: String,
    command_line: String,
    executable_path: Option<String>,
    start_ms: i64,
}

fn is_docker_process(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with("com.docker") || ["docker", "dockerd", "vpnkit", "vpnkit-bridge", "wslrelay"].contains(&n.as_str())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn get_windows_process_map() -> HashMap<u32, WinProc> {
    let mut map = HashMap::new();
    let script = "Get-CimInstance Win32_Process | ForEach-Object { [PSCustomObject]@{ P=$_.ProcessId; N=$_.Name; C=$_.CommandLine; E=$_.ExecutablePath; S=if ($_.CreationDate) { [int64](($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) } else { 0 } } } | ConvertTo-Json -Compress";
    if let Ok(out) = run_cmd("powershell", &["-NoProfile", "-Command", script]).await {
        let raw = out.trim();
        if !raw.is_empty() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
                let arr = match val {
                    serde_json::Value::Array(a) => a,
                    other => vec![other],
                };
                for p in arr {
                    if let Some(pid) = p["P"].as_u64() {
                        map.insert(pid as u32, WinProc {
                            name: p["N"].as_str().unwrap_or("").to_string(),
                            command_line: p["C"].as_str().unwrap_or("").to_string(),
                            executable_path: p["E"].as_str().map(String::from),
                            start_ms: p["S"].as_i64().unwrap_or(0),
                        });
                    }
                }
            }
        }
    }
    if map.is_empty() {
        if let Ok(out) = run_cmd("tasklist", &["/NH", "/FO", "CSV"]).await {
            for line in out.lines() {
                let parts: Vec<&str> = line.split("\",\"").collect();
                if parts.len() >= 2 {
                    let name = parts[0].trim_start_matches('"').to_string();
                    if let Ok(pid) = parts[1].trim_matches('"').parse::<u32>() {
                        map.insert(pid, WinProc { name, command_line: String::new(), executable_path: None, start_ms: 0 });
                    }
                }
            }
        }
    }
    map
}

async fn resolve_process_info(pid: u32, fallback: &str) -> (String, Option<String>) {
    if cfg!(target_os = "windows") {
        let script = format!(
            "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\"; \
             if ($null -ne $p) {{ \
               [PSCustomObject]@{{ Name=$p.Name; CommandLine=$p.CommandLine; ExecutablePath=$p.ExecutablePath }} | ConvertTo-Json -Compress \
             }}"
        );
        if let Ok(out) = run_cmd("powershell", &["-NoProfile", "-Command", &script]).await {
            let trimmed = out.trim().to_string();
            if !trimmed.is_empty() {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&trimmed) {
                    let name = val["Name"].as_str().unwrap_or(fallback).trim_end_matches(".exe").to_string();
                    let exe = val["ExecutablePath"].as_str().map(String::from);
                    let cmd = val["CommandLine"].as_str().unwrap_or("");
                    let pname = derive_windows_name(&name, cmd);
                    let cwd = infer_windows_cwd(cmd, exe.as_deref());
                    return (pname, cwd);
                }
            }
        }
        (fallback.into(), None)
    } else if cfg!(target_os = "macos") {
        let cwd = run_cmd("/usr/sbin/lsof", &["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"]).await.ok()
            .and_then(|out| out.lines().find(|l| l.starts_with("n/")).map(|l| l[1..].to_string()));
        (fallback.into(), cwd)
    } else {
        let cwd = tokio::fs::read_link(format!("/proc/{pid}/cwd")).await.ok()
            .map(|p| p.to_string_lossy().into_owned());
        (fallback.into(), cwd)
    }
}

fn clean_seg(s: &str) -> String {
    s.split(|c| c == '"' || c == '\'').next().unwrap_or(s).trim().to_string()
}

fn last_drive_path(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut start: Option<usize> = None;
    let mut i = 0;
    while i + 2 < bytes.len() {
        if (bytes[i] as char).is_ascii_alphabetic()
            && bytes[i + 1] == b':'
            && (bytes[i + 2] == b'\\' || bytes[i + 2] == b'/')
        {
            start = Some(i);
        }
        i += 1;
    }
    let st = start?;
    let path = s[st..]
        .trim_matches(|c| c == '"' || c == '\'')
        .trim_end_matches(|c| c == '\\' || c == '/');
    Some(path.to_string())
}

fn extract_node_modules_info(cmd: &str) -> (Option<String>, Option<String>) {
    let lower = cmd.to_ascii_lowercase();
    let idx = match lower.rfind("node_modules") {
        Some(i) => i,
        None => return (None, None),
    };
    let dir = last_drive_path(&cmd[..idx]);
    let after = cmd[idx + "node_modules".len()..]
        .trim_start_matches(|c| c == '"' || c == '\'' || c == '\\' || c == '/');
    let mut segs = after.split(|c| c == '\\' || c == '/').filter(|s| !s.is_empty());
    let pkg = match segs.next() {
        Some(s) if s.starts_with('@') => segs.next().map(clean_seg),
        Some(s) => Some(clean_seg(s)),
        None => None,
    };
    (dir, pkg)
}

fn derive_windows_name(name: &str, cmd_line: &str) -> String {
    if let (_, Some(pkg)) = extract_node_modules_info(cmd_line) {
        return pkg;
    }
    for candidate in extract_quoted(cmd_line) {
        let lower = candidate.to_lowercase();
        if let Some(pos) = lower.find("node_modules") {
            let after = &candidate[pos + 12..];
            let segs: Vec<&str> = after.split(&['/', '\\'][..]).filter(|s| !s.is_empty()).collect();
            if let Some(&first) = segs.first() {
                if first.starts_with('@') {
                    if let Some(&second) = segs.get(1) { return second.into(); }
                }
                return first.into();
            }
        }
        if lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".ts") {
            if let Some(stem) = Path::new(&*candidate).file_stem() {
                let s = stem.to_string_lossy().to_string();
                if !["index", "server", "start-server"].contains(&s.to_lowercase().as_str()) {
                    return s;
                }
            }
        }
    }
    name.into()
}

fn infer_windows_cwd(cmd_line: &str, exe_path: Option<&str>) -> Option<String> {
    if let (Some(dir), _) = extract_node_modules_info(cmd_line) {
        return Some(dir);
    }
    for candidate in extract_quoted(cmd_line) {
        let lower = candidate.to_lowercase();
        if !(lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".ts")
            || lower.ends_with(".cmd") || lower.ends_with(".ps1")) { continue; }
        if let Some(pos) = candidate.find("node_modules") {
            return Some(candidate[..pos].trim_end_matches(&['/', '\\'][..]).into());
        }
        return Path::new(&*candidate).parent().map(|p| p.to_string_lossy().into_owned());
    }
    exe_path.and_then(|p| Path::new(p).parent().map(|pp| pp.to_string_lossy().into_owned()))
}

fn extract_quoted(s: &str) -> Vec<String> {
    s.split('"').enumerate().filter(|(i, _)| i % 2 == 1).map(|(_, v)| v.to_string()).collect()
}

async fn find_git_root(start: &str) -> Option<String> {
    let mut cur = PathBuf::from(start);
    loop {
        if tokio::fs::metadata(cur.join(".git")).await.is_ok() {
            return Some(cur.to_string_lossy().into_owned());
        }
        if !cur.pop() { return None; }
    }
}

async fn resolve_git_branch(root: &str) -> String {
    run_cmd("git", &["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]).await
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

async fn has_project_markers(cwd: &Option<String>) -> bool {
    let c = match cwd { Some(c) => c.clone(), None => return false };
    let mut cur = PathBuf::from(&c);
    for _ in 0..3 {
        for m in PROJECT_MARKERS {
            if tokio::fs::metadata(cur.join(m)).await.is_ok() { return true; }
        }
        if !cur.pop() { break; }
    }
    false
}

fn is_blocked_path(cwd: &str) -> bool {
    let lower = cwd.to_lowercase();
    if cfg!(target_os = "windows") {
        ["\\windows\\system32", "\\program files\\windowsapps", "\\windows\\",
         "\\appdata\\local\\discord", "\\appdata\\roaming\\discord",
         "\\appdata\\local\\slack", "\\appdata\\local\\microsoft\\teams",
         "\\appdata\\local\\programs\\"].iter().any(|f| lower.contains(f))
    } else if cfg!(target_os = "macos") {
        ["/system/", "/applications/", "/library/"].iter().any(|f| lower.contains(f))
    } else {
        ["/snap/", "/usr/", "/var/", "/run/"].iter().any(|f| lower.starts_with(f))
    }
}

fn get_project_name(process_name: &str, cwd: &Option<String>, git_root: &Option<String>) -> String {
    if is_docker_process(process_name) {
        return "Docker".into();
    }
    if let Some(root) = git_root {
        return Path::new(root).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| process_name.into());
    }
    if let Some(c) = cwd {
        let base = Path::new(c).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !base.is_empty() && !base.starts_with('.') && !["build","dist","tmp","deps","_build","cache"].contains(&base.to_lowercase().as_str()) {
            return base;
        }
    }
    process_name.into()
}

async fn get_start_time_and_uptime(pid: u32) -> (Option<String>, Option<u64>) {
    if cfg!(target_os = "windows") {
        let script = format!("(Get-Process -Id {} -ErrorAction SilentlyContinue).StartTime.ToString(\"o\")", pid);
        if let Ok(out) = run_cmd("powershell", &["-NoProfile", "-Command", &script]).await {
            let s = out.trim().to_string();
            if !s.is_empty() {
                return (Some(s), None); // Frontend computes uptime from ISO string
            }
        }
        (None, None)
    } else if cfg!(target_os = "macos") {
        if let Ok(out) = run_cmd("/bin/ps", &["-p", &pid.to_string(), "-o", "lstart="]).await {
            let s = out.trim().to_string();
            if !s.is_empty() { return (Some(s), None); }
        }
        (None, None)
    } else {
        match tokio::fs::metadata(format!("/proc/{}", pid)).await {
            Ok(meta) => {
                if let Ok(modified) = meta.modified() {
                    if let Ok(elapsed) = modified.elapsed() {
                        return (None, Some(elapsed.as_secs()));
                    }
                }
                (None, None)
            }
            Err(_) => (None, None),
        }
    }
}

async fn run_cmd(program: &str, args: &[&str]) -> Result<String, String> {
    let output = new_hidden_cmd(program, args).output().await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn new_hidden_cmd(program: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

fn now_iso() -> String {
    // Minimal ISO timestamp
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    // Return unix timestamp as string - frontend doesn't use this for display
    format!("{}", secs)
}

fn parse_mac_lsof(output: &str) -> Vec<ParsedPort> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for line in output.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 9 { continue; }
        let process_name = cols[0].to_string();
        let pid: u32 = match cols[1].parse() { Ok(p) => p, Err(_) => continue };
        let endpoint = cols.get(cols.len() - 2).copied().unwrap_or("");
        let state = cols.last().copied().unwrap_or("");
        if state != "(LISTEN)" { continue; }
        let port: u16 = match endpoint.rsplit(':').next().and_then(|s| s.parse().ok()) {
            Some(p) if p >= MIN_PORT && p <= MAX_PORT => p, _ => continue,
        };
        if seen.insert(port) { result.push(ParsedPort { pid, port, process_name }); }
    }
    result
}

fn parse_windows_netstat(output: &str) -> Vec<ParsedPort> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for line in output.lines() {
        let t = line.trim();
        if !t.starts_with("TCP") { continue; }
        let cols: Vec<&str> = t.split_whitespace().collect();
        if cols.len() < 5 || cols[3].to_uppercase() != "LISTENING" { continue; }
        let port: u16 = match cols[1].rsplit(':').next().and_then(|s| s.parse().ok()) {
            Some(p) if p >= MIN_PORT && p <= MAX_PORT => p, _ => continue,
        };
        let pid: u32 = match cols[4].parse() { Ok(p) => p, Err(_) => continue };
        if seen.insert(port) { result.push(ParsedPort { pid, port, process_name: "process".into() }); }
    }
    result
}

fn parse_linux_ss(output: &str) -> Vec<ParsedPort> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for line in output.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        let port: u16 = match cols.get(3).and_then(|a| a.rsplit(':').next()).and_then(|s| s.parse().ok()) {
            Some(p) if p >= MIN_PORT && p <= MAX_PORT => p, _ => continue,
        };
        let (name, pid) = match extract_ss_process(line) { Some(v) => v, None => continue };
        if seen.insert(port) { result.push(ParsedPort { pid, port, process_name: name }); }
    }
    result
}

fn parse_linux_netstat(output: &str) -> Vec<ParsedPort> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for line in output.lines() {
        if !line.contains("LISTEN") { continue; }
        let cols: Vec<&str> = line.split_whitespace().collect();
        let port: u16 = match cols.get(3).and_then(|a| a.rsplit(':').next()).and_then(|s| s.parse().ok()) {
            Some(p) if p >= MIN_PORT && p <= MAX_PORT => p, _ => continue,
        };
        let (name, pid) = match cols.get(6).and_then(|s| {
            let parts: Vec<&str> = s.splitn(2, '/').collect();
            if parts.len() == 2 { Some((parts[1].to_string(), parts[0].parse::<u32>().ok()?)) } else { None }
        }) { Some(v) => v, None => continue };
        if seen.insert(port) { result.push(ParsedPort { pid, port, process_name: name }); }
    }
    result
}

fn extract_ss_process(line: &str) -> Option<(String, u32)> {
    let start = line.find("users:((\"")?;
    let after = &line[start + 9..];
    let name_end = after.find('"')?;
    let name = after[..name_end].to_string();
    let pid_start = after.find("pid=")?;
    let pid_str = &after[pid_start + 4..];
    let pid_end = pid_str.find(|c: char| !c.is_ascii_digit()).unwrap_or(pid_str.len());
    let pid: u32 = pid_str[..pid_end].parse().ok()?;
    Some((name, pid))
}
