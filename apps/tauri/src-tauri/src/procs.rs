use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

const RUNNERS: &[&str] = &[
    "node", "npm", "npx", "pnpm", "yarn", "bun", "bunx", "deno", "turbo", "nx",
    "python", "python3", "uv", "poetry", "pipenv", "uvicorn", "gunicorn",
    "ruby", "bundle", "rails", "go", "air", "cargo", "java", "gradle", "mvn",
    "dotnet", "php", "mix", "beam.smp", "elixir", "erl",
];
const SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "fish", "cmd"];
const AGENT_MARKERS: &[&str] = &["@anthropic-ai/claude-code", "/codex/", "\\codex\\", "com.conductor.app"];
pub const PROTECTED: &[&str] = &["postgres", "redis-server", "redis", "mongod", "mysqld", "mysql", "mariadbd"];

#[derive(Debug, Clone, Default)]
pub struct Node {
    pub ppid: Option<u32>,
    pub name: String,
    pub cmd: String,
    pub memory: u64,
    pub resident: u64,
    pub cpu: f32,
    pub start: u64,
}

#[derive(Debug, Clone)]
pub struct Launch {
    pub argv: Vec<String>,
    pub exe: Option<String>,
    pub cwd: String,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    pub memory: u64,
}

pub fn normalize(name: &str) -> String {
    let lower = name.to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

fn is_runner(name: &str) -> bool {
    RUNNERS.contains(&name) || name.starts_with("python")
}

pub fn is_protected(name: &str) -> bool {
    PROTECTED.contains(&normalize(name).as_str())
}

pub struct Procs {
    sys: System,
    nodes: HashMap<u32, Node>,
    kids: HashMap<u32, Vec<u32>>,
}

impl Procs {
    pub fn new() -> Self {
        Self { sys: System::new(), nodes: HashMap::new(), kids: HashMap::new() }
    }

    pub fn refresh(&mut self) {
        self.sys.refresh_memory();
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_memory().with_cpu().with_cmd(UpdateKind::OnlyIfNotSet),
        );
        self.nodes = self
            .sys
            .processes()
            .iter()
            .map(|(pid, p)| {
                let cmd = p.cmd().iter().map(|s| s.to_string_lossy()).collect::<Vec<_>>().join(" ");
                (pid.as_u32(), Node {
                    ppid: p.parent().map(|x| x.as_u32()),
                    name: normalize(&p.name().to_string_lossy()),
                    cmd,
                    // Windows trims the working set of idle processes to almost nothing, so its
                    // figure says little about what a server costs; private bytes do.
                    memory: if cfg!(windows) { p.virtual_memory() } else { p.memory() },
                    resident: p.memory(),
                    cpu: p.cpu_usage(),
                    start: p.start_time(),
                })
            })
            .collect();
        self.kids = children_of(&self.nodes);
    }

    /// Reads command lines, environments and folders, which are slow to read, only for the
    /// processes that need them.
    pub fn load_details(&mut self, pids: &[u32]) {
        let wanted: Vec<Pid> = pids.iter().map(|p| Pid::from_u32(*p)).collect();
        if wanted.is_empty() {
            return;
        }
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&wanted),
            false,
            ProcessRefreshKind::nothing()
                .with_environ(UpdateKind::OnlyIfNotSet)
                .with_cwd(UpdateKind::OnlyIfNotSet)
                .with_exe(UpdateKind::OnlyIfNotSet),
        );
    }

    pub fn node(&self, pid: u32) -> Option<&Node> {
        self.nodes.get(&pid)
    }

    pub fn root_for(&self, listener: u32, listeners: &HashSet<u32>) -> u32 {
        root_for(&self.nodes, &self.kids, listener, listeners)
    }

    pub fn tree(&self, root: u32) -> Vec<u32> {
        tree(&self.kids, root)
    }

    pub fn ancestors(&self, pid: u32, limit: usize) -> Vec<u32> {
        let mut out = vec![pid];
        let mut cur = pid;
        while out.len() <= limit {
            match parent_of(&self.nodes, cur) {
                Some(p) if p > 1 => {
                    out.push(p);
                    cur = p;
                }
                _ => break,
            }
        }
        out
    }

    pub fn usage(&self, pids: &[u32]) -> (u64, f32) {
        pids.iter().filter_map(|p| self.nodes.get(p)).fold((0, 0.0), |(m, c), n| (m + n.memory, c + n.cpu))
    }

    pub fn processes(&self, pids: &[u32]) -> Vec<ProcInfo> {
        let mut list: Vec<ProcInfo> = pids
            .iter()
            .filter_map(|p| self.nodes.get(p).map(|n| ProcInfo { pid: *p, name: n.name.clone(), memory: n.memory }))
            .collect();
        list.sort_by(|a, b| b.memory.cmp(&a.memory));
        list
    }

    pub fn env_var(&self, pids: &[u32], key: &str) -> Option<String> {
        pids.iter().find_map(|p| {
            let proc = self.sys.process(Pid::from_u32(*p))?;
            proc.environ().iter().find_map(|kv| {
                let kv = kv.to_string_lossy();
                let (k, v) = kv.split_once('=')?;
                (k == key && !v.is_empty()).then(|| v.to_string())
            })
        })
    }

    pub fn cwd(&self, pid: u32) -> Option<String> {
        let cwd = self.sys.process(Pid::from_u32(pid))?.cwd()?.to_string_lossy().into_owned();
        (!cwd.is_empty()).then_some(cwd)
    }

    pub fn launch(&self, pid: u32) -> Option<Launch> {
        let p = self.sys.process(Pid::from_u32(pid))?;
        let argv: Vec<String> = p.cmd().iter().map(|s| s.to_string_lossy().trim().to_string()).filter(|s| !s.is_empty()).collect();
        if argv.is_empty() {
            return None;
        }
        let env = p
            .environ()
            .iter()
            .filter_map(|kv| kv.to_string_lossy().split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
            .filter(|(k, _)| !k.is_empty())
            .collect();
        Some(Launch {
            argv,
            exe: p.exe().map(|e| e.to_string_lossy().into_owned()),
            cwd: self.cwd(pid)?,
            env,
        })
    }

    /// Bytes in use by everything, and the machine's total.
    pub fn memory(&self) -> (u64, u64) {
        let total = self.sys.total_memory();
        (total.saturating_sub(self.sys.available_memory()), total)
    }
}

/// Which of these processes are still running.
#[cfg_attr(windows, allow(dead_code))]
pub fn alive(pids: &[u32]) -> Vec<u32> {
    let wanted: Vec<Pid> = pids.iter().map(|p| Pid::from_u32(*p)).collect();
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&wanted), true, ProcessRefreshKind::nothing());
    pids.iter().copied().filter(|p| sys.process(Pid::from_u32(*p)).is_some()).collect()
}

fn children_of(nodes: &HashMap<u32, Node>) -> HashMap<u32, Vec<u32>> {
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for pid in nodes.keys() {
        if let Some(p) = parent_of(nodes, *pid) {
            kids.entry(p).or_default().push(*pid);
        }
    }
    kids
}

fn parent_of(nodes: &HashMap<u32, Node>, pid: u32) -> Option<u32> {
    let node = nodes.get(&pid)?;
    let ppid = node.ppid?;
    if ppid == pid {
        return None;
    }
    // Windows hands out a dead parent's pid again, so a "parent" that started later is someone else.
    let parent = nodes.get(&ppid)?;
    (parent.start <= node.start).then_some(ppid)
}

pub fn tree(kids: &HashMap<u32, Vec<u32>>, root: u32) -> Vec<u32> {
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        if let Some(ks) = kids.get(&out[i]) {
            for k in ks {
                if !out.contains(k) {
                    out.push(*k);
                }
            }
        }
        i += 1;
    }
    out
}

fn is_agent(node: &Node) -> bool {
    ["claude", "codex", "conductor"].contains(&node.name.as_str()) || AGENT_MARKERS.iter().any(|m| node.cmd.contains(m))
}

/// Climbs from the process holding the port to the command that started it (`pnpm dev` over
/// `next-server`), through package managers and the shell they run scripts in. It stops below a
/// terminal, a coding agent, or a runner that also started other servers, so stopping one server
/// never takes those with it.
pub fn root_for(nodes: &HashMap<u32, Node>, kids: &HashMap<u32, Vec<u32>>, listener: u32, listeners: &HashSet<u32>) -> u32 {
    let own = std::process::id();
    let usable = |pid: u32| {
        pid != own
            && nodes.get(&pid).is_some_and(|n| is_runner(&n.name) && !is_agent(n))
            && !tree(kids, pid).iter().any(|p| *p != listener && listeners.contains(p))
    };
    let mut cur = listener;
    loop {
        let Some(parent) = parent_of(nodes, cur).filter(|p| *p > 1) else { break };
        if usable(parent) {
            cur = parent;
            continue;
        }
        let shell = nodes.get(&parent).is_some_and(|n| SHELLS.contains(&n.name.as_str()));
        match parent_of(nodes, parent).filter(|g| *g > 1) {
            Some(grand) if shell && usable(grand) => cur = grand,
            _ => break,
        }
    }
    cur
}

pub fn pretty_command(argv: &[String]) -> String {
    let mut parts = argv.to_vec();
    if let Some(first) = parts.first_mut() {
        let base = first.rsplit(['/', '\\']).next().unwrap_or(first).to_string();
        *first = base.strip_suffix(".exe").map(String::from).unwrap_or(base);
    }
    parts
        .iter()
        .map(|a| {
            let short = match a.to_lowercase().rfind("node_modules") {
                Some(i) if a.contains(['/', '\\']) => a[i + "node_modules".len() + 1..].replace('\\', "/"),
                _ => a.clone(),
            };
            if short.contains(' ') { format!("\"{short}\"") } else { short }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(ppid: u32, name: &str, start: u64) -> Node {
        Node { ppid: Some(ppid), name: name.into(), cmd: String::new(), memory: 0, resident: 0, cpu: 0.0, start }
    }

    fn table(rows: &[(u32, Node)]) -> (HashMap<u32, Node>, HashMap<u32, Vec<u32>>) {
        let nodes: HashMap<u32, Node> = rows.iter().cloned().collect();
        let kids = children_of(&nodes);
        (nodes, kids)
    }

    #[test]
    fn climbs_to_the_package_manager() {
        let (nodes, kids) = table(&[
            (10, node(1, "zsh", 1)),
            (20, node(10, "pnpm", 2)),
            (30, node(20, "sh", 3)),
            (40, node(30, "node", 4)),
            (50, node(40, "next-server", 5)),
        ]);
        assert_eq!(root_for(&nodes, &kids, 50, &HashSet::from([50])), 20);
        assert_eq!(tree(&kids, 20), vec![20, 30, 40, 50]);
    }

    #[test]
    fn stops_below_a_runner_with_other_servers() {
        let (nodes, kids) = table(&[
            (10, node(1, "bash", 1)),
            (20, node(10, "turbo", 2)),
            (30, node(20, "node", 3)),
            (31, node(20, "node", 3)),
        ]);
        let listeners = HashSet::from([30, 31]);
        assert_eq!(root_for(&nodes, &kids, 30, &listeners), 30);
        assert_eq!(root_for(&nodes, &kids, 31, &listeners), 31);
    }

    #[test]
    fn never_climbs_into_an_agent() {
        let mut agent = node(1, "node", 1);
        agent.cmd = "node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js".into();
        let (nodes, kids) = table(&[(10, agent), (20, node(10, "bash", 2)), (30, node(20, "node", 3))]);
        assert_eq!(root_for(&nodes, &kids, 30, &HashSet::from([30])), 30);
    }

    #[test]
    fn ignores_a_reused_parent_pid() {
        let (nodes, kids) = table(&[(20, node(1, "npm", 9)), (30, node(20, "node", 3))]);
        assert_eq!(root_for(&nodes, &kids, 30, &HashSet::from([30])), 30);
    }

    #[test]
    fn shortens_commands() {
        let argv = vec![
            "C:\\Program Files\\nodejs\\node.exe".to_string(),
            "C:\\work\\kudos\\node_modules\\next\\dist\\bin\\next".to_string(),
            "dev".to_string(),
        ];
        assert_eq!(pretty_command(&argv), "node next/dist/bin/next dev");
    }
}
