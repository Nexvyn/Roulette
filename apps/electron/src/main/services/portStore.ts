import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { clipboard, shell } from "electron";
import { promisify } from "node:util";
import type { AppSettings, PortEntry, ScanState } from "@shared/contracts";
import { getLaunchAtLogin, setLaunchAtLogin } from "./autoLaunch";
import { scanPorts } from "./portScanner";
import { TunnelManager } from "./tunnel";
import {
  clearCustomPortName,
  getCustomPortNames,
  getPinnedPorts,
  getSettings,
  setCustomPortName,
  setPinnedPort,
  updateSettings
} from "./settings";

const execFileAsync = promisify(execFile);

export class PortStore extends EventEmitter {
  private state: ScanState = {
    entries: [],
    isScanning: false,
    lastError: null,
    diagnostics: null
  };

  private settings: AppSettings;
  private timer: NodeJS.Timeout | null = null;
  private recentlyKilled = new Map<number, number>();
  private tunnels = new TunnelManager();

  constructor() {
    super();
    this.settings = {
      ...getSettings(),
      launchAtLogin: getLaunchAtLogin()
    };
    this.tunnels.on("change", () => this.redecorate());
  }

  getState(): ScanState {
    return this.state;
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  start(): void {
    void this.scanNow();
    this.restartTimer();
  }

  stop(): void {
    this.tunnels.stopAll();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scanNow(): Promise<void> {
    if (this.state.isScanning) {
      return;
    }

    this.state = {
      ...this.state,
      isScanning: true
    };
    this.emitState();

    const result = await scanPorts();
    this.pruneKilled();
    const found = this.applyCustomNames(result.entries).filter((entry) => !this.recentlyKilled.has(entry.port));
    for (const port of this.tunnels.ports()) {
      if (!found.some((entry) => entry.port === port)) this.tunnels.stop(port);
    }
    const entries = this.decorate(found);

    this.state = {
      entries,
      isScanning: false,
      lastError: result.diagnostics.lastError,
      diagnostics: result.diagnostics
    };
    this.emitState();
  }

  async killPort(port: number, pid: number): Promise<void> {
    this.recentlyKilled.set(port, Date.now());
    this.tunnels.stop(port);
    this.state = {
      ...this.state,
      entries: this.state.entries.map((entry) =>
        entry.port === port ? { ...entry, status: "terminating" } : entry
      )
    };
    this.emitState();

    try {
      await terminateProcess(pid);
    } catch (error) {
      this.recentlyKilled.delete(port);
      this.state = {
        ...this.state,
        entries: this.state.entries.map((entry) =>
          entry.port === port ? { ...entry, status: "error" } : entry
        ),
        lastError: error instanceof Error ? error.message : "Failed to terminate process"
      };
      this.emitState();
      return;
    }

    this.state = {
      ...this.state,
      entries: this.state.entries.filter((entry) => entry.port !== port)
    };
    this.emitState();
  }

  async killAll(): Promise<void> {
    const current = [...this.state.entries];
    for (const entry of current) {
      await this.killPort(entry.port, entry.pid);
    }
  }

  async openPort(port: number): Promise<void> {
    await shell.openExternal(`http://localhost:${port}`);
  }

  copyUrl(url: string): void {
    clipboard.writeText(url);
  }

  copyPort(port: number): void {
    clipboard.writeText(String(port));
  }

  renamePort(port: number, name: string): void {
    const trimmed = name.trim();
    const current = this.state.entries.find((entry) => entry.port === port);
    if (!current) {
      return;
    }

    if (!trimmed || trimmed === current.detectedProjectName) {
      this.resetPortName(port);
      return;
    }

    setCustomPortName(port, trimmed);
    this.state = {
      ...this.state,
      entries: this.state.entries.map((entry) =>
        entry.port === port ? { ...entry, projectName: trimmed } : entry
      )
    };
    this.emitState();
  }

  resetPortName(port: number): void {
    clearCustomPortName(port);
    this.state = {
      ...this.state,
      entries: this.state.entries.map((entry) =>
        entry.port === port ? { ...entry, projectName: entry.detectedProjectName } : entry
      )
    };
    this.emitState();
  }

  setPinned(port: number, pinned: boolean): void {
    setPinnedPort(port, pinned);
    this.state = {
      ...this.state,
      entries: this.state.entries.map((entry) =>
        entry.port === port ? { ...entry, pinned } : entry
      )
    };
    this.emitState();
  }

  startTunnel(port: number): void {
    this.tunnels.start(port);
  }

  stopTunnel(port: number): void {
    this.tunnels.stop(port);
  }

  private redecorate(): void {
    this.state = { ...this.state, entries: this.decorate(this.state.entries) };
    this.emitState();
  }

  private decorate(entries: PortEntry[]): PortEntry[] {
    return entries.map((entry) => ({ ...entry, tunnel: this.tunnels.get(entry.port) }));
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.settings = updateSettings(patch);
    this.restartTimer();
    return this.settings;
  }

  async toggleLaunchAtLogin(enabled: boolean): Promise<boolean> {
    const nextValue = await setLaunchAtLogin(enabled);
    this.settings = updateSettings({
      launchAtLogin: nextValue
    });
    return nextValue;
  }

  private applyCustomNames(entries: PortEntry[]): PortEntry[] {
    const names = getCustomPortNames();
    const pinned = new Set(getPinnedPorts());
    return entries.map((entry) => ({
      ...entry,
      projectName: names[String(entry.port)] || entry.detectedProjectName,
      pinned: pinned.has(entry.port)
    }));
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.scanNow();
    }, this.settings.refreshIntervalSeconds * 1000);
  }

  private pruneKilled(): void {
    const cutoff = Date.now() - 8_000;
    for (const [port, timestamp] of this.recentlyKilled.entries()) {
      if (timestamp < cutoff) {
        this.recentlyKilled.delete(port);
      }
    }
  }

  private emitState(): void {
    this.emit("state", this.state);
  }
}

export function isPortEntry(payload: unknown): payload is PortEntry {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return typeof value.port === "number" && typeof value.pid === "number" && typeof value.url === "string";
}

async function terminateProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "SIGTERM failed");
  }

  await wait(800);

  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    // Process is already gone, which is the expected success path.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
