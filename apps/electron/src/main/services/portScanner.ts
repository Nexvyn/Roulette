import { execSync } from "node:child_process";

export interface RawPort {
  port: number;
  pid: number;
}

export function scanPorts(): RawPort[] {
  try {
    if (process.platform === "win32") {
      return scanWindows();
    }
    return [];
  } catch {
    return [];
  }
}

function scanWindows(): RawPort[] {
  const out = execSync("netstat -ano -p tcp", { timeout: 5000 }).toString();
  const results: RawPort[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/LISTENING\s+(\d+)/);
    if (!m) continue;
    const portMatch = line.match(/:(\d+)\s/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);
    const pid  = parseInt(m[1], 10);
    if (port >= 1024 && port <= 49151) {
      results.push({ port, pid });
    }
  }
  return results;
}