import { EventEmitter } from "node:events";
import type { PortEntry, ScanState } from "@shared/contracts";
import { scanPorts } from "./portScanner";

export class PortStore extends EventEmitter {
  private state: ScanState = { entries: [], isScanning: false, lastError: null, diagnostics: null };
  private interval: ReturnType<typeof setInterval> | null = null;

  getState(): ScanState { return this.state; }

  start(intervalSeconds = 5) {
    this.scan();
    this.interval = setInterval(() => this.scan(), intervalSeconds * 1000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  private async scan() {
    this.state = { ...this.state, isScanning: true };
    const raw = scanPorts();
    const entries: PortEntry[] = raw.map(r => ({
      id: String(r.port),
      port: r.port,
      pid: r.pid,
      processName: "unknown",
      projectName: "unknown",
      detectedProjectName: "unknown",
      url: `http://localhost:${r.port}`,
      status: "running",
      pinned: false,
      branch: "",
      cwd: null,
      gitRoot: null,
      startTime: null,
      uptimeSeconds: null,
    }));
    this.state = { entries, isScanning: false, lastError: null, diagnostics: null };
    this.emit("state", this.state);
  }
}