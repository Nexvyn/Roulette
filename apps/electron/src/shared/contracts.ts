export type PortStatus = "running" | "terminating" | "error";

export interface PortEntry {
  id: string;
  port: number;
  pid: number;
  processName: string;
  projectName: string;
  detectedProjectName: string;
  url: string;
  status: PortStatus;
  pinned: boolean;
}