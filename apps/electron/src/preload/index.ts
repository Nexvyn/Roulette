import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  PortContextMenuPayload,
  PortMenuApi,
  ScanState
} from "@shared/contracts";

const api: PortMenuApi = {
  getInitialState: () => ipcRenderer.invoke("state:get") as Promise<ScanState>,
  subscribeToState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: ScanState) => listener(state);
    ipcRenderer.on("state:changed", wrapped);
    return () => {
      ipcRenderer.removeListener("state:changed", wrapped);
    };
  },
  scanNow: () => ipcRenderer.invoke("scan:now") as Promise<void>,
  killPort: (port, pid) => ipcRenderer.invoke("ports:kill", { port, pid }) as Promise<void>,
  killAll: () => ipcRenderer.invoke("ports:killAll") as Promise<void>,
  openPort: (port) => ipcRenderer.invoke("ports:open", port) as Promise<void>,
  copyUrl: (url) => ipcRenderer.invoke("clipboard:url", url) as Promise<void>,
  copyPort: (port) => ipcRenderer.invoke("clipboard:port", port) as Promise<void>,
  renamePort: (port, name) => ipcRenderer.invoke("ports:rename", { port, name }) as Promise<void>,
  resetPortName: (port) => ipcRenderer.invoke("ports:rename:reset", port) as Promise<void>,
  setPinned: (port, pinned) => ipcRenderer.invoke("ports:pin", { port, pinned }) as Promise<void>,
  startTunnel: (port) => ipcRenderer.invoke("tunnel:start", port) as Promise<void>,
  stopTunnel: (port) => ipcRenderer.invoke("tunnel:stop", port) as Promise<void>,
  resizeWindow: (height) => ipcRenderer.send("window:resize", height),
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<AppSettings>,
  subscribeToSettings: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, settings: AppSettings) => listener(settings);
    ipcRenderer.on("settings:changed", wrapped);
    return () => {
      ipcRenderer.removeListener("settings:changed", wrapped);
    };
  },
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch) as Promise<AppSettings>,
  toggleLaunchAtLogin: (enabled) =>
    ipcRenderer.invoke("settings:launchAtLogin", enabled) as Promise<boolean>,
  showPortContextMenu: (payload: PortContextMenuPayload) =>
    ipcRenderer.invoke("ports:menu", payload) as Promise<void>,
  quit: () => ipcRenderer.invoke("app:quit") as Promise<void>
};

contextBridge.exposeInMainWorld("portMenu", api);

declare global {
  interface Window {
    portMenu: PortMenuApi;
  }
}
