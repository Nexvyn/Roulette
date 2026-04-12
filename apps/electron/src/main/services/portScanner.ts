import { execSync } from "node:child_process";
import { execFileSync } from "node:child_process";

export interface ProcessInfo {
  port: number;
  pid: number;
  processName: string;
  cwd: string | null;
}

export function scanPorts(): ProcessInfo[] {
  try {
    if (process.platform === "win32") return scanWindows();
    if (process.platform === "darwin") return scanMac();
    return scanLinux();
  } catch {
    return [];
  }
}

function scanWindows(): ProcessInfo[] {
  const out = execSync("netstat -ano -p tcp", { timeout: 8000 }).toString();
  const pids = new Set<number>();
  const portPid: Map<number, number> = new Map();
  for (const line of out.split("\n")) {
    const m = line.match(/LISTENING\s+(\d+)/);
    if (!m) continue;
    const portMatch = line.match(/:(\d+)\s/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);
    const pid  = parseInt(m[1], 10);
    if (port >= 1024 && port <= 49151) {
      portPid.set(port, pid);
      pids.add(pid);
    }
  }
  return Array.from(portPid.entries()).map(([port, pid]) => ({
    port, pid, processName: String(pid), cwd: null
  }));
}

function scanMac(): ProcessInfo[] {
  const out = execFileSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P"], { timeout: 8000 }).toString();
  const results: ProcessInfo[] = [];
  for (const line of out.split("\n").slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const portMatch = parts[8]?.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);
    const pid  = parseInt(parts[1], 10);
    if (port >= 1024 && port <= 49151) {
      results.push({ port, pid, processName: parts[0], cwd: null });
    }
  }
  return results;
}

function scanLinux(): ProcessInfo[] {
  const out = execSync("ss -tlnp", { timeout: 8000 }).toString();
  const results: ProcessInfo[] = [];
  for (const line of out.split("\n").slice(1)) {
    const portMatch = line.match(/:(\d+)\s/);
    const pidMatch  = line.match(/pid=(\d+)/);
    if (!portMatch || !pidMatch) continue;
    const port = parseInt(portMatch[1], 10);
    const pid  = parseInt(pidMatch[1], 10);
    if (port >= 1024 && port <= 49151) {
      results.push({ port, pid, processName: String(pid), cwd: null });
    }
  }
  return results;
}