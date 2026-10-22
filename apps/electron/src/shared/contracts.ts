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
  tunnel: TunnelInfo | null;
}

export interface TunnelInfo {
  status: "starting" | "live" | "error";
  url: string | null;
  error: string | null;
}

export type SortOption = "port" | "name" | "uptime";

export interface AppSettings {
  refreshIntervalSeconds: number;
  launchAtLogin: boolean;
  hasCompletedOnboarding: boolean;
  showDiagnostics: boolean;
  sortBy: SortOption;
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

export interface PortContextMenuPayload {
  pid: number;
  port: number;
  url: string;
  pinned: boolean;
  tunnelUrl: string | null;
  tunnelOn: boolean;
}

export interface PortMenuApi {
  getInitialState: () => Promise<ScanState>;
  subscribeToState: (listener: (state: ScanState) => void) => () => void;
  scanNow: () => Promise<void>;
  killPort: (port: number, pid: number) => Promise<void>;
  killAll: () => Promise<void>;
  openPort: (port: number) => Promise<void>;
  copyUrl: (url: string) => Promise<void>;
  copyPort: (port: number) => Promise<void>;
  renamePort: (port: number, name: string) => Promise<void>;
  resetPortName: (port: number) => Promise<void>;
  setPinned: (port: number, pinned: boolean) => Promise<void>;
  startTunnel: (port: number) => Promise<void>;
  stopTunnel: (port: number) => Promise<void>;
  resizeWindow: (height: number) => void;
  getSettings: () => Promise<AppSettings>;
  subscribeToSettings: (listener: (settings: AppSettings) => void) => () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  toggleLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
  showPortContextMenu: (payload: PortContextMenuPayload) => Promise<void>;
  quit: () => Promise<void>;
}
