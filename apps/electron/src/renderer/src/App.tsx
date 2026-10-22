import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, ScanState } from "@shared/contracts";
import { Panel, type Backend } from "./ui/Panel";
import { Onboarding } from "./ui/Onboarding";
import { useWindowFit } from "./ui/windowFit";

const initialState: ScanState = {
  entries: [],
  isScanning: true,
  lastError: null,
  diagnostics: null
};

export function App() {
  const [state, setState] = useState<ScanState>(initialState);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const api = window.portMenu;

  useEffect(() => {
    if (!api) {
      setApiError("Bridge failed to load. Restart the app so Electron can attach preload.");
      return;
    }

    void api.getSettings().then(setSettings).catch(() => undefined);
    void api.getInitialState().then(setState).catch((error: unknown) => {
      setApiError(error instanceof Error ? error.message : "Failed to fetch initial state");
    });

    const unsubscribe = api.subscribeToState(setState);
    const unsubscribeSettings = api.subscribeToSettings(setSettings);
    return () => {
      unsubscribe();
      unsubscribeSettings();
    };
  }, [api]);

  const resize = useCallback((h: number) => api?.resizeWindow(h), [api]);
  const atBottom = useWindowFit(panelRef, api && settings?.hasCompletedOnboarding ? resize : null, [resize, settings?.hasCompletedOnboarding]);

  const backend = useMemo<Backend | null>(() => {
    if (!api) return null;
    return {
      scan: () => void api.scanNow(),
      kill: (port, pid) => void api.killPort(port, pid),
      killAll: () => void api.killAll(),
      open: (port) => void api.openPort(port),
      copy: (text) => void api.copyUrl(text),
      rename: (port, name) => void api.renamePort(port, name),
      resetName: (port) => void api.resetPortName(port),
      pin: (port, pinned) => void api.setPinned(port, pinned),
      startTunnel: (port) => void api.startTunnel(port),
      stopTunnel: (port) => void api.stopTunnel(port),
      updateSettings: (patch) => {
        setSettings((s) => (s ? { ...s, ...patch } : s));
        void api.updateSettings(patch).then(setSettings).catch(() => undefined);
      },
      setLaunchAtLogin: (enabled) =>
        void api.toggleLaunchAtLogin(enabled).then((on) => setSettings((s) => (s ? { ...s, launchAtLogin: on } : s))),
      quit: () => void api.quit()
    };
  }, [api]);

  if (!backend || !settings) {
    return apiError ? <div className="bridgeError">{apiError}</div> : null;
  }

  if (!settings.hasCompletedOnboarding) {
    return (
      <div className="shell">
        <Onboarding
          resize={resize}
          onDone={() => {
            setSettings({ ...settings, hasCompletedOnboarding: true });
            void api?.updateSettings({ hasCompletedOnboarding: true });
          }}
        />
      </div>
    );
  }

  return (
    <div className={`shell ${atBottom ? "at-bottom" : ""}`}>
      <Panel state={state} settings={settings} backend={backend} apiError={apiError} panelRef={panelRef} />
    </div>
  );
}
