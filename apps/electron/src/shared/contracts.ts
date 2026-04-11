export type PortStatus = "running" | "terminating" | "error";

export interface PortEntry {
  id: string;
  port: number;
  pid: number;
  processName: string;
  projectName: string;
  detectedProjectName: string;
  branch: string;
  cwd: string | null;
  gitRoot: string | null;
  startTime: string | null;
  uptimeSeconds: number | null;
  url: string;
  status: PortStatus;
  pinned: boolean;
}

export interface AppSettings {
  refreshIntervalSeconds: number;
  launchAtLogin: boolean;
  hasCompletedOnboarding: boolean;
  showDiagnostics: boolean;
  sortBy: "port" | "name" | "uptime";
  themeSource: "system";
}

export interface ScanState {
  entries: PortEntry[];
  isScanning: boolean;
  lastError: string | null;
  diagnostics: ScanDiagnostics | null;
}

export interface ScanDiagnostics {
  durationMs: number;
  portsFound: number;
  dataSource: string;
  timestamp: string;
  lastError: string | null;
}