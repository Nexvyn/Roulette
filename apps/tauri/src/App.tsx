import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Panel, type Backend } from "./ui/Panel";
import { Onboarding } from "./ui/Onboarding";
import { useWindowFit } from "./ui/windowFit";
import type { AppSettings, ScanState, UpdateInfo } from "./ui/types";

const initialState: ScanState = { entries: [], isScanning: true, lastError: null, diagnostics: null };

export function App() {
  const [state, setState] = useState<ScanState>(initialState);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(console.error);
    invoke<ScanState>("get_state").then(setState).catch(console.error);
    const unlisten = listen<ScanState>("state-changed", (e) => setState(e.payload));
    const unlistenSettings = listen<AppSettings>("settings-changed", (e) => setSettings(e.payload));
    invoke<UpdateInfo | null>("get_update").then(setUpdate).catch(console.error);
    const unlistenUpdate = listen<UpdateInfo | null>("update-changed", (e) => setUpdate(e.payload));
    return () => {
      unlisten.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
      unlistenUpdate.then((fn) => fn());
    };
  }, []);

  const resize = useCallback((h: number) => void invoke("resize_window", { height: h }).catch(() => undefined), []);
  const atBottom = useWindowFit(panelRef, settings?.hasCompletedOnboarding ? resize : null, [resize, settings?.hasCompletedOnboarding]);

  const readySent = useRef(false);
  const loaded = settings !== null && (!state.isScanning || state.entries.length > 0);
  useEffect(() => {
    if (readySent.current || settings === null) return;
    const send = () => {
      if (readySent.current) return;
      readySent.current = true;
      void invoke("panel_ready").catch(() => undefined);
    };
    if (loaded) {
      const frame = requestAnimationFrame(() => requestAnimationFrame(send));
      return () => cancelAnimationFrame(frame);
    }
    const fallback = setTimeout(send, 1500);
    return () => clearTimeout(fallback);
  }, [loaded, settings]);

  const backend = useMemo<Backend>(() => {
    const patch = (p: Partial<AppSettings>) => invoke<AppSettings>("update_settings", { patch: p }).then(setSettings).catch(console.error);
    return {
      scan: () => void invoke("scan_now"),
      kill: (port, pid) => void invoke("kill_port", { port, pid }),
      stopMany: (ports) => void invoke("stop_ports", { ports }),
      restart: (port) => invoke<void>("restart_port", { port }),
      snooze: (port) => void invoke("snooze_port", { port }),
      openLink: (url) => void invoke("open_link", { url }).catch(console.error),
      installCli: () => invoke<string>("install_cli"),
      openInEditor: (path) => invoke<void>("open_in_editor", { path }),
      open: (port) => void invoke("open_port", { port }),
      copy: (text) => void invoke("copy_url", { url: text }),
      rename: (port, name) => void invoke("rename_port", { port, name }),
      resetName: (port) => void invoke("reset_port_name", { port }),
      pin: (port, pinned) => void invoke("set_pinned", { port, pinned }),
      startTunnel: (port) => void invoke("start_tunnel", { port }),
      stopTunnel: (port) => void invoke("stop_tunnel", { port }),
      updateSettings: (p) => {
        setSettings((s) => (s ? { ...s, ...p } : s));
        void patch(p);
      },
      setLaunchAtLogin: (enabled) =>
        void invoke<boolean>("toggle_launch_at_login", { enabled }).then((on) => setSettings((s) => (s ? { ...s, launchAtLogin: on } : s))),
      installUpdate: () => void invoke("install_update").catch(console.error),
      quit: () => void invoke("quit_app"),
    };
  }, []);

  if (!settings) return null;

  if (!settings.hasCompletedOnboarding) {
    return (
      <div className="shell">
        <Onboarding
          resize={resize}
          onDone={() => {
            setSettings({ ...settings, hasCompletedOnboarding: true });
            invoke("update_settings", { patch: { hasCompletedOnboarding: true } });
          }}
        />
      </div>
    );
  }

  return (
    <div className={`shell ${atBottom ? "at-bottom" : ""}`}>
      <Panel state={state} settings={settings} backend={backend} apiError={null} panelRef={panelRef} update={update} />
    </div>
  );
}
