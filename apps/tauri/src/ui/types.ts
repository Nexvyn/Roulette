export type SortOption = "port" | "name" | "uptime";

export interface TunnelInfo {
  status: "starting" | "live" | "error";
  url: string | null;
  error: string | null;
  expiresAt: number | null;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  project: string | null;
}

export interface Sample {
  t: number;
  mem: number;
  cpu: number;
}

export interface ProcInfo {
  pid: number;
  name: string;
  memory: number;
}

export interface AgentSession {
  kind: string;
  id: string;
  title: string | null;
  directory: string | null;
  resume: string;
}

export interface Workspace {
  app: "Conductor" | "Pane";
  name: string;
  link: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
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
  rootPid: number;
  memoryBytes: number | null;
  cpuPercent: number | null;
  history: Sample[];
  processes: ProcInfo[];
  command: string | null;
  idleSeconds: number | null;
  folderMissing: boolean;
  protected: boolean;
  attention: "memory" | "growing" | null;
  snoozed: boolean;
  cleanup: "idle" | "folder" | null;
  canRestart: boolean;
  session: AgentSession | null;
  workspace: Workspace | null;
  pullRequest: PullRequest | null;
}

export interface UpdateInfo {
  version: string;
  manual: boolean;
  installing: boolean;
}

export interface ScanDiagnostics {
  durationMs: number;
  portsFound: number;
  dataSource: string;
  timestamp: string;
  lastError: string | null;
}

export interface SystemMemory {
  used: number;
  total: number;
  servers: number;
}

export interface ScanState {
  entries: PortEntry[];
  isScanning: boolean;
  lastError: string | null;
  diagnostics: ScanDiagnostics | null;
  memory?: SystemMemory | null;
}

export interface AppSettings {
  refreshIntervalSeconds: number;
  launchAtLogin: boolean;
  hasCompletedOnboarding: boolean;
  showDiagnostics: boolean;
  sortBy: SortOption;
  themeSource: "system";
  linkExpiry: LinkExpiry;
  memoryAlertGb: number;
  leakAlerts: boolean;
  notifications: boolean;
  cleanup: CleanupMode;
  idleHours: number;
  shortcut: boolean;
  agentSessions: boolean;
  pullRequests: boolean;
}

export type LinkExpiry = "1h" | "4h" | "never";
export type CleanupMode = "off" | "ask" | "auto";
