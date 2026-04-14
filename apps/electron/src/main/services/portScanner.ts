import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PortEntry, ScanDiagnostics } from "@shared/contracts";

const execFileAsync = promisify(execFile);
const DEV_PROCESS_NAMES = new Set([
  "air",
  "beam.smp",
  "bun",
  "cargo",
  "deno",
  "elixir",
  "erl",
  "go",
  "gunicorn",
  "java",
  "mix",
  "next-server",
  "node",
  "npm",
  "php",
  "pnpm",
  "puma",
  "python",
  "python3",
  "rails",
  "ruby",
  "uvicorn",
  "vite",
  "yarn"
]);
const BLOCKED_PROCESS_NAMES = new Set([
  "code",
  "discord",
  "explorer",
  "launchd",
  "lsass",
  "registry",
  "services",
  "slack",
  "svchost",
  "system",
  "systemd",
  "teams",
  "wininit",
  "winlogon"
]);
const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "pyproject.toml",
  "requirements.txt",
  "manage.py",
  "go.mod",
  "Gemfile",
  "mix.exs",
  "Cargo.toml",
  "deno.json",
  "deno.jsonc"
];
const MIN_PORT = 1024;
const MAX_PORT = 49151;
const BRANCH_TTL_MS = 30_000;

type ParsedPort = {
  pid: number;
  port: number;
  processName: string;
};

type WinProc = {
  name: string;
  commandLine: string;
  executablePath: string;
  startMs: number;
};

type ScanResult = {
  entries: PortEntry[];
  diagnostics: ScanDiagnostics;
};

type BranchCacheEntry = {
  branch: string;
  resolvedAt: number;
};

const branchCache = new Map<string, BranchCacheEntry>();
const rootCache = new Map<string, string | null>();
const projectContextCache = new Map<string, boolean>();

export async function scanPorts(): Promise<ScanResult> {
  const startedAt = Date.now();
  const dataSource = process.platform === "darwin" ? "lsof" : process.platform === "win32" ? "netstat" : "ss";

  try {
    const parsed = await getListeningPorts();
    const entries = await buildEntries(parsed);
    return {
      entries,
      diagnostics: {
        durationMs: Date.now() - startedAt,
        portsFound: entries.length,
        dataSource,
        timestamp: new Date().toISOString(),
        lastError: null
      }
    };
  } catch (error) {
    return {
      entries: [],
      diagnostics: {
        durationMs: Date.now() - startedAt,
        portsFound: 0,
        dataSource,
        timestamp: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "Unknown scan error"
      }
    };
  }
}

async function getListeningPorts(): Promise<ParsedPort[]> {
  if (process.platform === "darwin") {
    const { stdout } = await runCommand("/usr/sbin/lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P"]);
    return parseMacLsof(stdout);
  }

  if (process.platform === "win32") {
    const { stdout } = await runCommand("netstat", ["-ano", "-p", "tcp"]);
    return parseWindowsNetstat(stdout);
  }

  try {
    const { stdout } = await runCommand("ss", ["-tlnp"]);
    return parseLinuxSs(stdout);
  } catch {
    const { stdout } = await runCommand("netstat", ["-tlnp"]);
    return parseLinuxNetstat(stdout);
  }
}

async function buildEntries(parsed: ParsedPort[]): Promise<PortEntry[]> {
  const unique = new Map<number, ParsedPort>();
  for (const entry of parsed) {
    if (!unique.has(entry.port)) {
      unique.set(entry.port, entry);
    }
  }

  const winProcs = process.platform === "win32" ? await getWindowsProcessMap() : null;

  const result: PortEntry[] = [];
  for (const info of [...unique.values()].sort((a, b) => a.port - b.port)) {
    let processName = info.processName;
    let cwd: string | null = null;
    let startTime: Date | null = null;

    if (winProcs) {
      const proc = winProcs.get(info.pid);
      if (proc) {
        processName = deriveWindowsProcessName(proc.name, proc.executablePath, proc.commandLine);
        cwd = inferWindowsWorkingDirectory(proc.commandLine, proc.executablePath);
        startTime = proc.startMs > 0 ? new Date(proc.startMs) : null;
      }
    } else {
      cwd = await resolveWorkingDirectory(info.pid);
      startTime = await resolveStartTime(info.pid);
    }

    const gitRoot = cwd ? await findGitRoot(cwd) : null;
    const hasProjectContext = await resolveProjectContext(cwd, gitRoot);

    if (!shouldKeepProcess(processName, cwd, hasProjectContext)) {
      continue;
    }

    const branch = gitRoot ? await resolveGitBranch(gitRoot) : "";
    const projectName = getProjectName(processName, cwd, gitRoot);
    const uptimeSeconds = startTime ? Math.max(0, Math.floor((Date.now() - startTime.getTime()) / 1000)) : null;

    result.push({
      id: `${info.port}-${info.pid}`,
      port: info.port,
      pid: info.pid,
      processName,
      projectName,
      detectedProjectName: projectName,
      branch,
      cwd,
      gitRoot,
      startTime: startTime?.toISOString() ?? null,
      uptimeSeconds,
      url: `http://localhost:${info.port}`,
      status: "running",
      pinned: false
    });
  }

  pruneCaches(result);
  return result;
}

async function resolveWorkingDirectory(pid: number): Promise<string | null> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await runCommand("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
      const line = stdout.split(/\r?\n/).find((value) => value.startsWith("n/"));
      return line ? line.slice(1) : null;
    } catch {
      return null;
    }
  }

  if (process.platform === "linux") {
    try {
      return await fs.readlink(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }

  return null;
}

async function getWindowsProcessMap(): Promise<Map<number, WinProc>> {
  const map = new Map<number, WinProc>();

  try {
    const script =
      "Get-CimInstance Win32_Process | ForEach-Object { [PSCustomObject]@{ P=$_.ProcessId; N=$_.Name; C=$_.CommandLine; E=$_.ExecutablePath; S=if ($_.CreationDate) { [int64]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } else { 0 } } } | ConvertTo-Json -Compress";
    const { stdout } = await runCommand("powershell", ["-NoProfile", "-Command", script]);
    const raw = stdout.trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const p of Array.isArray(parsed) ? parsed : [parsed]) {
        const pid = Number(p.P);
        if (Number.isFinite(pid)) {
          map.set(pid, {
            name: String(p.N ?? ""),
            commandLine: String(p.C ?? ""),
            executablePath: String(p.E ?? ""),
            startMs: Number(p.S) || 0
          });
        }
      }
    }
  } catch {
    // fall through to tasklist
  }

  if (map.size === 0) {
    try {
      const { stdout } = await runCommand("tasklist", ["/NH", "/FO", "CSV"]);
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)","(\d+)"/);
        if (m) {
          map.set(Number(m[2]), { name: m[1], commandLine: "", executablePath: "", startMs: 0 });
        }
      }
    } catch {
      // give up
    }
  }

  return map;
}

async function resolveStartTime(pid: number): Promise<Date | null> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await runCommand("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
        LC_ALL: "C"
      });
      const value = stdout.trim().replace(/\s+/g, " ");
      return value ? new Date(value) : null;
    } catch {
      return null;
    }
  }

  if (process.platform === "linux") {
    try {
      const stats = await fs.stat(`/proc/${pid}`);
      return stats.birthtime ?? stats.mtime;
    } catch {
      return null;
    }
  }

  return null;
}

async function findGitRoot(startPath: string): Promise<string | null> {
  if (rootCache.has(startPath)) {
    return rootCache.get(startPath) ?? null;
  }

  let current = startPath;
  while (current && current !== path.dirname(current)) {
    try {
      const stat = await fs.stat(path.join(current, ".git"));
      if (stat.isDirectory() || stat.isFile()) {
        rootCache.set(startPath, current);
        return current;
      }
    } catch {
      // keep walking
    }
    current = path.dirname(current);
  }

  rootCache.set(startPath, null);
  return null;
}

async function resolveGitBranch(rootPath: string): Promise<string> {
  const cached = branchCache.get(rootPath);
  if (cached && Date.now() - cached.resolvedAt < BRANCH_TTL_MS) {
    return cached.branch;
  }

  try {
    const { stdout } = await runCommand("git", ["-C", rootPath, "rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = stdout.trim();
    branchCache.set(rootPath, { branch, resolvedAt: Date.now() });
    return branch;
  } catch {
    branchCache.set(rootPath, { branch: "", resolvedAt: Date.now() });
    return "";
  }
}

async function resolveProjectContext(cwd: string | null, gitRoot: string | null): Promise<boolean> {
  if (gitRoot) {
    return true;
  }

  if (!cwd) {
    return false;
  }

  if (projectContextCache.has(cwd)) {
    return projectContextCache.get(cwd) ?? false;
  }

  let current = cwd;
  for (let depth = 0; depth < 3; depth += 1) {
    for (const marker of PROJECT_MARKERS) {
      try {
        await fs.stat(path.join(current, marker));
        projectContextCache.set(cwd, true);
        return true;
      } catch {
        // keep scanning
      }
    }

    const parent = path.dirname(current);
    if (!parent || parent === current) {
      break;
    }
    current = parent;
  }

  projectContextCache.set(cwd, false);
  return false;
}

function isDockerProcess(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("com.docker") || ["docker", "dockerd", "vpnkit", "vpnkit-bridge", "wslrelay"].includes(n);
}

function getProjectName(processName: string, cwd: string | null, gitRoot: string | null): string {
  if (isDockerProcess(processName)) {
    return "Docker";
  }

  if (gitRoot) {
    return path.basename(gitRoot);
  }

  if (cwd) {
    const base = path.basename(cwd);
    if (isMeaningfulDirectory(base)) {
      return base;
    }
  }

  return processName;
}

function shouldKeepProcess(processName: string, cwd: string | null, hasProjectContext: boolean): boolean {
  const normalized = processName.toLowerCase();

  if (BLOCKED_PROCESS_NAMES.has(normalized)) {
    return false;
  }

  if (isDockerProcess(processName)) {
    return true;
  }

  if (cwd && isBlockedRuntimePath(cwd)) {
    return false;
  }

  if (hasProjectContext) {
    return true;
  }

  if (DEV_PROCESS_NAMES.has(normalized) || normalized.startsWith("python")) {
    return true;
  }

  if (cwd) {
    const base = path.basename(cwd).toLowerCase();
    if (DEV_PROCESS_NAMES.has(base)) {
      return true;
    }
  }

  return false;
}

function isMeaningfulDirectory(name: string): boolean {
  if (!name || name.startsWith(".")) {
    return false;
  }

  return !new Set(["build", "dist", "tmp", "deps", "_build", "cache"]).has(name.toLowerCase());
}

function isBlockedRuntimePath(cwd: string): boolean {
  const normalized = cwd.toLowerCase();

  if (process.platform === "win32") {
    return [
      "\\windows\\system32",
      "\\program files\\windowsapps",
      "\\windows\\",
      "\\appdata\\local\\discord",
      "\\appdata\\roaming\\discord",
      "\\appdata\\local\\slack",
      "\\appdata\\local\\microsoft\\teams",
      "\\appdata\\local\\programs\\"
    ].some((fragment) => normalized.includes(fragment));
  }

  if (process.platform === "darwin") {
    return ["/system/", "/applications/", "/library/"] .some((fragment) => normalized.includes(fragment));
  }

  return ["/snap/", "/usr/", "/var/", "/run/"].some((fragment) => normalized.startsWith(fragment));
}

function extractNodeModulesInfo(commandLine: string): { projectDir: string | null; packageName: string | null } | null {
  const idx = commandLine.toLowerCase().lastIndexOf("node_modules");
  if (idx < 0) {
    return null;
  }
  const driveMatch = commandLine.slice(0, idx).match(/[A-Za-z]:[\\/][^:]*$/);
  const projectDir = driveMatch
    ? path.normalize(driveMatch[0].replace(/["']/g, "").replace(/[\\/]+$/, ""))
    : null;
  const after = commandLine.slice(idx + "node_modules".length).replace(/^["'\\/]+/, "");
  const segs = after.split(/[\\/]/).filter(Boolean);
  const first = segs[0]?.startsWith("@") ? segs[1] : segs[0];
  const packageName = first ? first.replace(/["'].*$/, "").trim() || null : null;
  return { projectDir, packageName };
}

function deriveWindowsProcessName(name?: string, executablePath?: string, commandLine?: string): string {
  const nodeModules = commandLine ? extractNodeModulesInfo(commandLine) : null;
  if (nodeModules?.packageName) {
    return nodeModules.packageName;
  }

  const quotedPaths = commandLine?.match(/"([^"]+)"/g)?.map((value) => value.slice(1, -1)) ?? [];

  for (const candidate of quotedPaths) {
    const normalized = path.normalize(candidate);
    const lower = normalized.toLowerCase();

    const nodeModulesMatch = normalized.match(/[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?([^\\/]+)/i);
    if (nodeModulesMatch?.[1]) {
      return nodeModulesMatch[1];
    }

    if (isLikelyWindowsScriptPath(candidate)) {
      const scriptName = path.basename(normalized, path.extname(normalized));
      if (scriptName && !["index", "server", "start-server"].includes(scriptName.toLowerCase())) {
        return scriptName;
      }
    }

    if (lower.includes("\\windowsapps\\")) {
      const appName = inferWindowsStoreAppName(normalized);
      if (appName) {
        return appName;
      }
    }
  }

  if (executablePath?.toLowerCase().includes("\\windowsapps\\")) {
    const appName = inferWindowsStoreAppName(executablePath);
    if (appName) {
      return appName;
    }
  }

  const candidate = name || (executablePath ? path.basename(executablePath) : "");
  return candidate.replace(/\.exe$/i, "").trim() || "process";
}

function inferWindowsWorkingDirectory(commandLine?: string, executablePath?: string): string | null {
  const nodeModules = commandLine ? extractNodeModulesInfo(commandLine) : null;
  if (nodeModules?.projectDir) {
    return nodeModules.projectDir;
  }

  const quotedPaths = commandLine?.match(/"([^"]+)"/g)?.map((value) => value.slice(1, -1)) ?? [];

  for (const candidate of quotedPaths) {
    if (!isLikelyWindowsScriptPath(candidate)) {
      continue;
    }

    const normalized = path.normalize(candidate);
    const nodeModulesMarker = `${path.sep}node_modules${path.sep}`;
    if (normalized.includes(nodeModulesMarker)) {
      return normalized.split(nodeModulesMarker)[0] || path.dirname(normalized);
    }

    return path.dirname(normalized);
  }

  if (executablePath) {
    return path.dirname(executablePath);
  }

  return null;
}

function isLikelyWindowsScriptPath(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return (
    lower.endsWith(".js") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".cmd") ||
    lower.endsWith(".ps1")
  );
}

function inferWindowsStoreAppName(candidate: string): string | null {
  const normalized = path.normalize(candidate);
  const segments = normalized.split(path.sep).filter(Boolean);
  const packageSegment = segments.find((segment) => segment.includes("_"));
  if (!packageSegment) {
    return null;
  }

  const packageRoot = packageSegment.split("_")[0] ?? "";
  const dotSegments = packageRoot.split(".").filter(Boolean);
  const bestSegment = dotSegments.at(-1) ?? packageRoot;
  return bestSegment || null;
}

function pruneCaches(entries: PortEntry[]): void {
  const activeRoots = new Set<string>();
  const activeCwds = new Set<string>();

  for (const entry of entries) {
    if (entry.cwd) {
      activeCwds.add(entry.cwd);
    }
  }

  for (const [cwd, root] of rootCache.entries()) {
    if (!activeCwds.has(cwd)) {
      rootCache.delete(cwd);
      projectContextCache.delete(cwd);
    } else if (root) {
      activeRoots.add(root);
    }
  }

  for (const [root] of branchCache.entries()) {
    if (!activeRoots.has(root)) {
      branchCache.delete(root);
    }
  }
}

function parseMacLsof(output: string): ParsedPort[] {
  const seen = new Set<number>();
  return output
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 9) {
        return [];
      }

      const processName = cols[0];
      const pid = Number(cols[1]);
      const endpoint = cols.at(-2) ?? "";
      const state = cols.at(-1) ?? "";
      const match = endpoint.match(/:(\d+)$/);
      const port = match ? Number(match[1]) : NaN;

      if (!Number.isFinite(pid) || !Number.isFinite(port)) {
        return [];
      }

      if (state !== "(LISTEN)" || port < MIN_PORT || port > MAX_PORT || seen.has(port)) {
        return [];
      }

      seen.add(port);
      return [{ pid, port, processName }];
    });
}

function parseLinuxSs(output: string): ParsedPort[] {
  const seen = new Set<number>();
  const lines = output.split(/\r?\n/).slice(1);
  const parsed: ParsedPort[] = [];

  for (const line of lines) {
    const portMatch = line.match(/:(\d+)\s+/);
    const procMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (!portMatch || !procMatch) {
      continue;
    }

    const port = Number(portMatch[1]);
    const processName = procMatch[1];
    const pid = Number(procMatch[2]);
    if (port < MIN_PORT || port > MAX_PORT || seen.has(port)) {
      continue;
    }

    seen.add(port);
    parsed.push({ pid, port, processName });
  }

  return parsed;
}

function parseLinuxNetstat(output: string): ParsedPort[] {
  const seen = new Set<number>();
  const lines = output.split(/\r?\n/).filter(Boolean);
  const parsed: ParsedPort[] = [];

  for (const line of lines) {
    if (!line.includes("LISTEN")) {
      continue;
    }

    const cols = line.trim().split(/\s+/);
    const localAddress = cols[3] ?? "";
    const procInfo = cols[6] ?? "";
    const match = localAddress.match(/:(\d+)$/);
    const procMatch = procInfo.match(/(\d+)\/(.+)/);
    if (!match || !procMatch) {
      continue;
    }

    const port = Number(match[1]);
    const pid = Number(procMatch[1]);
    const processName = procMatch[2];

    if (port < MIN_PORT || port > MAX_PORT || seen.has(port)) {
      continue;
    }

    seen.add(port);
    parsed.push({ pid, port, processName });
  }

  return parsed;
}

function parseWindowsNetstat(output: string): ParsedPort[] {
  const seen = new Set<number>();
  const parsed: ParsedPort[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith("TCP")) {
      continue;
    }

    const cols = line.trim().split(/\s+/);
    if ((cols[3] ?? "").toUpperCase() !== "LISTENING") {
      continue;
    }

    const endpoint = cols[1] ?? "";
    const portMatch = endpoint.match(/:(\d+)$/);
    const port = portMatch ? Number(portMatch[1]) : NaN;
    const pid = Number(cols[4]);

    if (!Number.isFinite(port) || !Number.isFinite(pid)) {
      continue;
    }

    if (port < MIN_PORT || port > MAX_PORT || seen.has(port)) {
      continue;
    }

    seen.add(port);
    parsed.push({ pid, port, processName: "process" });
  }

  return parsed;
}

async function runCommand(command: string, args: string[], extraEnv?: NodeJS.ProcessEnv) {
  const environment = {
    ...process.env,
    ...extraEnv
  };

  return execFileAsync(command, args, {
    env: environment,
    timeout: 10_000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true
  });
}
