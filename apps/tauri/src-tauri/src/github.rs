use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
}

struct Entry {
    at: Instant,
    pr: Option<PullRequest>,
    busy: bool,
}

static CACHE: Mutex<Option<HashMap<String, Entry>>> = Mutex::new(None);
const FRESH: Duration = Duration::from_secs(300);

/// The branch's pull request as last seen, looking it up again in the background when it's stale.
pub fn lookup(root: &str, branch: &str) -> Option<PullRequest> {
    if branch.is_empty() || branch == "HEAD" {
        return None;
    }
    let key = format!("{root}\n{branch}");
    let mut guard = CACHE.lock().ok()?;
    let cache = guard.get_or_insert_with(HashMap::new);
    let entry = cache.entry(key.clone()).or_insert(Entry { at: Instant::now() - FRESH * 2, pr: None, busy: false });
    if !entry.busy && entry.at.elapsed() > FRESH {
        entry.busy = true;
        let (root, branch) = (root.to_string(), branch.to_string());
        tauri::async_runtime::spawn(async move {
            let pr = fetch(&root, &branch).await;
            if let Ok(mut guard) = CACHE.lock() {
                if let Some(e) = guard.get_or_insert_with(HashMap::new).get_mut(&key) {
                    *e = Entry { at: Instant::now(), pr, busy: false };
                }
            }
        });
    }
    entry.pr.clone()
}

async fn fetch(root: &str, branch: &str) -> Option<PullRequest> {
    let mut cmd = tokio::process::Command::new("gh");
    cmd.args(["pr", "view", branch, "--json", "number,title,url,state"]).current_dir(root);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);
    let out = tokio::time::timeout(Duration::from_secs(15), cmd.output()).await.ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let url = v["url"].as_str()?.to_string();
    if !url.starts_with("https://") {
        return None;
    }
    Some(PullRequest {
        number: v["number"].as_u64()?,
        title: v["title"].as_str().unwrap_or_default().to_string(),
        url,
        state: v["state"].as_str().unwrap_or_default().to_lowercase(),
    })
}
