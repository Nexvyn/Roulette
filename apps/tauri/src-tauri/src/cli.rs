use serde_json::json;

use crate::monitor::Monitor;
use crate::port_scanner::{self, PortEntry};
use crate::{settings, store};

const HELP: &str = "Roulette: every dev server on this machine.

Usage:
  roulette list          Print the running servers
  roulette list --json   Print them as JSON, for scripts and coding agents
  roulette --version     Print the version

Run roulette with no arguments to open the app.";

/// Handles a command-line call and returns its exit code, or None to start the app as usual.
pub fn run(args: &[String]) -> Option<i32> {
    let first = args.first()?.as_str();
    if first.starts_with('-') && !["--version", "-V", "--help", "-h"].contains(&first) {
        return None;
    }
    attach_console();
    Some(match first {
        "list" | "ls" => list(args.iter().any(|a| a == "--json")),
        "--version" | "-V" | "version" => {
            println!("roulette {}", env!("CARGO_PKG_VERSION"));
            0
        }
        "--help" | "-h" | "help" => {
            println!("{HELP}");
            0
        }
        other => {
            eprintln!("Unknown command: {other}\n\n{HELP}");
            2
        }
    })
}

fn list(as_json: bool) -> i32 {
    let mut settings = settings::get_settings();
    settings.pull_requests = false;
    let result = tauri::async_runtime::block_on(async {
        let mut monitor = Monitor::new();
        monitor.prime();
        let (entries, diag) = port_scanner::scan_ports().await;
        if let Some(e) = diag.last_error {
            return Err(e);
        }
        let mut entries = store::apply_custom_names(entries);
        monitor.enrich(&mut entries, &settings);
        Ok(entries)
    });
    let entries = match result {
        Ok(e) => e,
        Err(e) => {
            eprintln!("Scan failed: {e}");
            return 1;
        }
    };
    if as_json {
        let list: Vec<_> = entries.iter().map(to_json).collect();
        println!("{}", serde_json::to_string_pretty(&list).unwrap_or_else(|_| "[]".into()));
    } else if entries.is_empty() {
        println!("No dev servers running.");
    } else {
        print!("{}", table(&entries));
    }
    0
}

fn status(e: &PortEntry) -> &'static str {
    if e.live.attention.is_some() {
        "attention"
    } else if e.live.cleanup.is_some() {
        "idle"
    } else {
        "running"
    }
}

fn to_json(e: &PortEntry) -> serde_json::Value {
    json!({
        "port": e.port,
        "url": e.url,
        "pid": e.pid,
        "name": e.project_name,
        "branch": e.branch,
        "process": e.process_name,
        "folder": e.cwd,
        "command": e.live.command,
        "uptimeSeconds": e.uptime_seconds,
        "memoryBytes": e.live.memory_bytes,
        "cpuPercent": e.live.cpu_percent,
        "status": status(e),
        "protected": e.live.protected,
        "processes": e.live.processes,
        "container": e.container,
        "session": e.live.session.as_ref().map(|s| json!({ "kind": s.kind, "id": s.id, "title": s.title })),
    })
}

fn uptime(seconds: Option<u64>) -> String {
    let Some(s) = seconds else { return String::new() };
    let m = s / 60;
    match (s, m / 60) {
        (s, _) if s < 60 => format!("{s}s"),
        (_, 0) => format!("{m}m"),
        (_, h) if h < 24 => format!("{h}h {}m", m % 60),
        (_, h) => format!("{}d {}h", h / 24, h % 24),
    }
}

fn table(entries: &[PortEntry]) -> String {
    let rows: Vec<[String; 5]> = entries
        .iter()
        .map(|e| {
            let mem = e.live.memory_bytes.map(store::format_bytes).unwrap_or_default();
            let flag = if e.live.attention.is_some() { " !" } else { "" };
            [e.port.to_string(), e.project_name.clone(), e.branch.clone(), format!("{mem}{flag}"), uptime(e.uptime_seconds)]
        })
        .collect();
    let head = ["PORT", "NAME", "BRANCH", "MEMORY", "UP"].map(String::from);
    let widths: Vec<usize> = (0..5).map(|i| rows.iter().chain([&head]).map(|r| r[i].chars().count()).max().unwrap_or(0)).collect();
    let line = |r: &[String; 5]| {
        let cells: Vec<String> = r.iter().enumerate().map(|(i, c)| format!("{c:<w$}", w = widths[i])).collect();
        format!("{}\n", cells.join("   ").trim_end())
    };
    std::iter::once(&head).chain(rows.iter()).map(line).collect()
}

/// Puts the `roulette` command on the PATH, pointing at this copy of the app.
pub fn install() -> Result<String, String> {
    let exe = std::env::var("APPIMAGE").ok().map(std::path::PathBuf::from).or_else(|| std::env::current_exe().ok()).ok_or("Couldn't find the app.")?;
    #[cfg(target_os = "windows")]
    {
        let dir = dirs::data_local_dir().ok_or("Couldn't find your AppData folder.")?.join("Microsoft").join("WindowsApps");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("roulette.cmd"), format!("@\"{}\" %*\r\n", exe.display())).map_err(|e| e.to_string())?;
        Ok("Installed. Open a new terminal and run roulette list.".into())
    }
    #[cfg(target_os = "macos")]
    {
        let link = std::path::Path::new("/usr/local/bin/roulette");
        let _ = std::fs::remove_file(link);
        if std::os::unix::fs::symlink(&exe, link).is_err() {
            let script = format!(
                "do shell script \"mkdir -p /usr/local/bin && ln -sf '{}' /usr/local/bin/roulette\" with administrator privileges",
                exe.display()
            );
            let ok = std::process::Command::new("osascript").args(["-e", &script]).status().map(|s| s.success()).unwrap_or(false);
            if !ok {
                return Err("Installing needs your password, and it was cancelled.".into());
            }
        }
        Ok("Installed. Open a new terminal and run roulette list.".into())
    }
    #[cfg(target_os = "linux")]
    {
        let dir = dirs::home_dir().ok_or("Couldn't find your home folder.")?.join(".local").join("bin");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let link = dir.join("roulette");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&exe, &link).map_err(|e| e.to_string())?;
        Ok("Installed in ~/.local/bin. Open a new terminal and run roulette list.".into())
    }
}

/// The release build on Windows has no console of its own, so a call from a terminal borrows the
/// terminal's. Output that is already piped somewhere is left alone.
#[cfg(target_os = "windows")]
fn attach_console() {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(which: u32) -> isize;
        fn AttachConsole(pid: u32) -> i32;
    }
    const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    unsafe {
        let out = GetStdHandle(STD_OUTPUT_HANDLE);
        if out == 0 || out == -1 {
            AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn attach_console() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_app_flags_to_the_app() {
        assert_eq!(run(&["--hidden".into()]), None);
        assert_eq!(run(&[]), None);
    }

    #[test]
    fn formats_uptime() {
        assert_eq!(uptime(Some(42)), "42s");
        assert_eq!(uptime(Some(600)), "10m");
        assert_eq!(uptime(Some(7500)), "2h 5m");
        assert_eq!(uptime(Some(90000)), "1d 1h");
    }
}
