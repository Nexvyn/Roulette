import Store from "electron-store";
import type { AppSettings } from "@shared/contracts";

interface StoredData extends AppSettings {
  customPortNames: Record<string, string>;
  pinnedPorts: number[];
}

const defaults: StoredData = {
  refreshIntervalSeconds: 5,
  launchAtLogin: false,
  hasCompletedOnboarding: false,
  showDiagnostics: false,
  sortBy: "port",
  themeSource: "system",
  customPortNames: {},
  pinnedPorts: []
};

const store = new Store<StoredData>({ defaults });

export function getSettings(): AppSettings {
  return {
    refreshIntervalSeconds: store.get("refreshIntervalSeconds"),
    launchAtLogin: store.get("launchAtLogin"),
    hasCompletedOnboarding: store.get("hasCompletedOnboarding"),
    showDiagnostics: store.get("showDiagnostics"),
    sortBy: store.get("sortBy"),
    themeSource: "system"
  };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) store.set(key as keyof AppSettings, value as never);
  }
  return getSettings();
}

export function getCustomPortNames(): Record<string, string> {
  return store.get("customPortNames");
}

export function setCustomPortName(port: number, name: string): void {
  store.set("customPortNames", { ...getCustomPortNames(), [String(port)]: name });
}

export function clearCustomPortName(port: number): void {
  const { [String(port)]: _removed, ...rest } = getCustomPortNames();
  store.set("customPortNames", rest);
}

export function getPinnedPorts(): number[] {
  return store.get("pinnedPorts");
}

export function setPinnedPort(port: number, pinned: boolean): void {
  const next = new Set(getPinnedPorts());
  if (pinned) next.add(port);
  else next.delete(port);
  store.set("pinnedPorts", [...next]);
}
