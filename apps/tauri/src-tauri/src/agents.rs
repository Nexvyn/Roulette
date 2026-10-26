use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub kind: String,
    pub id: String,
    pub title: Option<String>,
    pub directory: Option<String>,
    pub resume: String,
}

struct Cache {
    claude: HashMap<String, (Instant, AgentSession)>,
    codex: HashMap<String, AgentSession>,
    codex_at: Option<Instant>,
}

static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

pub fn resolve(claude_id: Option<String>, cwd: Option<&str>) -> Option<AgentSession> {
    let mut guard = CACHE.lock().ok()?;
    let cache = guard.get_or_insert_with(|| Cache { claude: HashMap::new(), codex: HashMap::new(), codex_at: None });
    if let Some(id) = claude_id {
        if let Some((at, s)) = cache.claude.get(&id) {
            if at.elapsed() < Duration::from_secs(30) {
                return Some(s.clone());
            }
        }
        let s = claude_session(&id);
        cache.claude.insert(id, (Instant::now(), s.clone()));
        return Some(s);
    }
    if cache.codex_at.is_none_or(|at| at.elapsed() > Duration::from_secs(60)) {
        cache.codex = codex_index();
        cache.codex_at = Some(Instant::now());
    }
    let home = dirs::home_dir()?;
    let mut dir = PathBuf::from(cwd?);
    // A session started in the home folder or above would claim every server.
    while dir.starts_with(&home) && dir != home {
        if let Some(s) = cache.codex.get(&key(&dir)) {
            return Some(s.clone());
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(windows) { s.to_lowercase() } else { s.to_string() }
}

pub fn resume_command(kind: &str, id: &str, dir: Option<&str>) -> String {
    let run = if kind == "Codex" { format!("codex resume {id}") } else { format!("claude --resume {id}") };
    match dir {
        Some(d) if cfg!(windows) => format!("cd \"{d}\"; {run}"),
        Some(d) => format!("cd '{}' && {run}", d.replace('\'', "'\\''")),
        None => run,
    }
}

fn claude_session(id: &str) -> AgentSession {
    let file = dirs::home_dir()
        .map(|h| h.join(".claude").join("projects"))
        .and_then(|p| std::fs::read_dir(p).ok())
        .and_then(|dirs| dirs.flatten().map(|d| d.path().join(format!("{id}.jsonl"))).find(|f| f.exists()));
    let (title, directory) = match &file {
        Some(f) => {
            let head = read_head(f, 256 * 1024);
            let title = last_title(&read_tail(f, 512 * 1024)).or_else(|| last_title(&head)).or_else(|| first_prompt(&head));
            (title, first_string(&head, "cwd"))
        }
        None => (None, None),
    };
    AgentSession { kind: "Claude Code".into(), id: id.into(), resume: resume_command("Claude Code", id, directory.as_deref()), title, directory }
}

fn codex_index() -> HashMap<String, AgentSession> {
    let Some(root) = dirs::home_dir().map(|h| h.join(".codex")) else { return HashMap::new() };
    let mut titles = HashMap::new();
    for line in read_tail(&root.join("session_index.jsonl"), 1024 * 1024).lines() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let (Some(id), Some(name)) = (v["id"].as_str(), v["thread_name"].as_str()) {
                titles.insert(id.to_string(), name.to_string());
            }
        }
    }
    let cutoff = SystemTime::now() - Duration::from_secs(3 * 24 * 3600);
    let mut files = vec![];
    collect_jsonl(&root.join("sessions"), cutoff, &mut files, 0);
    files.sort_by_key(|(_, modified)| *modified);
    let mut index = HashMap::new();
    for (file, _) in files {
        let head = read_head(&file, 64 * 1024);
        let Some(first) = head.lines().next() else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(first) else { continue };
        let (Some(id), Some(cwd)) = (v["payload"]["id"].as_str(), v["payload"]["cwd"].as_str()) else { continue };
        index.insert(key(Path::new(cwd)), AgentSession {
            kind: "Codex".into(),
            id: id.into(),
            title: titles.get(id).cloned(),
            directory: Some(cwd.into()),
            resume: resume_command("Codex", id, Some(cwd)),
        });
    }
    index
}

fn collect_jsonl(dir: &Path, cutoff: SystemTime, out: &mut Vec<(PathBuf, SystemTime)>, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        let Ok(meta) = e.metadata() else { continue };
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if meta.is_dir() {
            if depth < 4 && modified >= cutoff {
                collect_jsonl(&path, cutoff, out, depth + 1);
            }
        } else if path.extension().is_some_and(|x| x == "jsonl") && modified >= cutoff {
            out.push((path, modified));
        }
    }
}

fn last_title(text: &str) -> Option<String> {
    let mut ai = None;
    for line in text.lines().filter(|l| l.contains("\"type\":\"custom-title\"") || l.contains("\"type\":\"ai-title\"")) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if let Some(t) = v["customTitle"].as_str().filter(|t| !t.is_empty()) {
            return Some(t.into());
        }
        if let Some(t) = v["aiTitle"].as_str().filter(|t| !t.is_empty()) {
            ai = Some(t.to_string());
        }
    }
    ai
}

fn first_prompt(text: &str) -> Option<String> {
    text.lines().filter(|l| l.contains("\"type\":\"user\"")).find_map(|line| {
        let v = serde_json::from_str::<serde_json::Value>(line).ok()?;
        let t = v["message"]["content"].as_str()?.trim();
        if t.is_empty() || t.starts_with('<') {
            return None;
        }
        Some(t.lines().next().unwrap_or(t).chars().take(60).collect())
    })
}

fn first_string(text: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\"");
    text.lines().filter(|l| l.contains(&needle)).find_map(|l| {
        serde_json::from_str::<serde_json::Value>(l).ok()?[field].as_str().map(String::from)
    })
}

fn read_head(path: &Path, bytes: u64) -> String {
    let mut buf = Vec::new();
    if let Ok(f) = std::fs::File::open(path) {
        let _ = f.take(bytes).read_to_end(&mut buf);
    }
    String::from_utf8_lossy(&buf).into_owned()
}

fn read_tail(path: &Path, bytes: u64) -> String {
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    let offset = size.saturating_sub(bytes);
    if f.seek(SeekFrom::Start(offset)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf).into_owned();
    match (offset > 0, text.find('\n')) {
        (true, Some(i)) => text[i + 1..].to_string(),
        _ => text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_a_custom_title() {
        let text = "{\"type\":\"ai-title\",\"aiTitle\":\"Fix the header\"}\n{\"type\":\"custom-title\",\"customTitle\":\"Header\"}\n";
        assert_eq!(last_title(text).as_deref(), Some("Header"));
        assert_eq!(last_title("{\"type\":\"ai-title\",\"aiTitle\":\"Fix the header\"}").as_deref(), Some("Fix the header"));
    }

    #[test]
    fn skips_command_prompts() {
        let text = "{\"type\":\"user\",\"message\":{\"content\":\"<command-name>/clear</command-name>\"}}\n{\"type\":\"user\",\"message\":{\"content\":\"start the dev server\\nthen open it\"}}\n";
        assert_eq!(first_prompt(text).as_deref(), Some("start the dev server"));
    }
}
