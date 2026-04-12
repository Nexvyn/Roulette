import { useEffect, useState } from "react";
import type { AppSettings, PortEntry, ScanState } from "@shared/contracts";

const initialState: ScanState = {
  entries: [],
  isScanning: true,
  lastError: null,
  diagnostics: null
};

function PortRow({ entry, api }: { entry: PortEntry; api: typeof window.portMenu }) {
  return (
    <div className="portRow">
      <span className="portNumber">{entry.port}</span>
      <div className="portInfo">
        <span className="portName">{entry.projectName}</span>
        <span className="portMeta">{entry.processName}</span>
      </div>
      <div className="portActions">
        <button onClick={() => api?.openPort(entry.port)} title="Open in browser">Open</button>
        <button onClick={() => api?.copyUrl(entry.port)} title="Copy URL">Copy</button>
        <button onClick={() => api?.killPort(entry.port)} className="destructive" title="Kill process">Kill</button>
      </div>
    </div>
  );
}

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
        <div className="headerActions">
          {state.entries.length > 0 && (
            <button className="destructive" onClick={() => api?.killAll()}>Kill all</button>
          )}
          <button onClick={() => api?.quit()}>Quit</button>
        </div>
      </header>
      <div className="portList">
        {state.entries.map(e => (
          <PortRow key={e.id} entry={e} api={api} />
        ))}
        {state.entries.length === 0 && !state.isScanning && (
          <div className="empty">No servers detected</div>
        )}
      </div>
    </div>
  );
}