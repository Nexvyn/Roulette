import Store from "electron-store";

export interface AppSettings {
  refreshIntervalSeconds: number;
  launchAtLogin: boolean;
  hasCompletedOnboarding: boolean;
}

const defaults: AppSettings = {
  refreshIntervalSeconds: 5,
  launchAtLogin: false,
  hasCompletedOnboarding: false,
};

const store = new Store<AppSettings>({ defaults });

export function getSettings(): AppSettings {
  return store.store as AppSettings;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  Object.assign(store.store, patch);
  return getSettings();
}