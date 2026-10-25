export type SortOption = "port" | "name" | "uptime";

export interface TunnelInfo {
  status: "starting" | "live" | "error";
  url: string | null;
  error: string | null;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  project: string | null;
}

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
  status: string;
  pinned: boolean;
  tunnel: TunnelInfo | null;
  container: ContainerInfo | null;
}

export interface ScanDiagnostics {
  durationMs: number;
  portsFound: number;
  dataSource: string;
  timestamp: string;
  lastError: string | null;
}

export interface ScanState {
  entries: PortEntry[];
  isScanning: boolean;
  lastError: string | null;
  diagnostics: ScanDiagnostics | null;
}

export interface AppSettings {
  refreshIntervalSeconds: number;
  launchAtLogin: boolean;
  hasCompletedOnboarding: boolean;
  showDiagnostics: boolean;
  sortBy: SortOption;
  themeSource: "system";
}
