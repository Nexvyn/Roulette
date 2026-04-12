import { EventEmitter } from "node:events";
import type { PortEntry, ScanState } from "@shared/contracts";
import { scanPorts } from "./portScanner";
import { getSettings } from "./settings";

export class PortStore extends EventEmitter {
  private state: ScanState = { entries: [], isScanning: false, lastError: null, diagnostics: null };
  private interval: ReturnType<typeof setInterval> | null = null;
  private names: Record<string, string> = {};
  private pins: Set<number> = new Set();

  getState(): ScanState { return this.state; }

  start(intervalSeconds = 5) {
    void this.scan();
    this.interval = setInterval(() => void this.scan(), intervalSeconds * 1000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  async scanNow() { await this.scan(); }

  renamePort(port: number, name: string) {
    const trimmed = name.trim();
    if (trimmed) this.names[String(port)] = trimmed;
    else delete this.names[String(port)];
    this.applyNames();
    this.emit("state", this.state);
  }

  pinPort(port: number, pinned: boolean) {
    if (pinned) this.pins.add(port);
    else this.pins.delete(port);
    this.state = {
      ...this.state,
      entries: this.state.entries.map(e =>
        e.port === port ? { ...e, pinned } : e
      )
    };
    this.emit("state", this.state);
  }

  private applyNames() {
    this.state = {
      ...this.state,
      entries: this.state.entries.map(e => ({
        ...e,
        projectName: this.names[String(e.port)] || e.detectedProjectName
      }))
    };
  }

  private async scan() {
    this.state = { ...this.state, isScanning: true };
    const raw = scanPorts();
    const entries: PortEntry[] = raw.map(r => ({
      id: String(r.port),
      port: r.port,
      pid: r.pid,
      processName: r.processName,
      projectName: this.names[String(r.port)] || r.processName,
      detectedProjectName: r.processName,
      branch: "",
      cwd: r.cwd,
      gitRoot: null,
      startTime: null,
      uptimeSeconds: null,
      url: `http://localhost:${r.port}`,
      status: "running",
      pinned: this.pins.has(r.port),
    }));
    const sorted = [
      ...entries.filter(e => e.pinned),
      ...entries.filter(e => !e.pinned),
    ];
    this.state = { entries: sorted, isScanning: false, lastError: null, diagnostics: null };
    this.emit("state", this.state);
  }
}