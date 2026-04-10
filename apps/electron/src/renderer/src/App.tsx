import { useEffect, useState } from "react";
import type { AppSettings, PortEntry, ScanState } from "@shared/contracts";

const initialState: ScanState = {
  entries: [],
  isScanning: true,
  lastError: null,
  diagnostics: null
};

export function App() {
  const [state, setState] = useState<ScanState>(initialState);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const api = window.portMenu;

  useEffect(() => {
    if (!api) return;
    void api.getSettings().then(setSettings);
    void api.getInitialState().then(setState);
    const unsub = api.onStateChange(setState);
    return unsub;
  }, []);

  return (
    <div id="panel">
      <header className="header">
        <div className="title">Lyra</div>
        <button onClick={() => api?.quit()}>Quit</button>
      </header>
      <div className="portList">
        {state.entries.map(e => (
          <div key={e.id} className="portRow">
            <span className="portNumber">{e.port}</span>
            <span className="portName">{e.projectName}</span>
          </div>
        ))}
        {state.entries.length === 0 && !state.isScanning && (
          <div className="empty">No servers detected</div>
        )}
      </div>
    </div>
  );
}