import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PortEntry {
  id: string; port: number; pid: number;
  processName: string; projectName: string;
  url: string; status: string; pinned: boolean;
}
interface ScanState { entries: PortEntry[]; isScanning: boolean; lastError: string | null; }

export function App() {
  const [state, setState] = useState<ScanState>({ entries: [], isScanning: true, lastError: null });

  useEffect(() => {
    invoke<ScanState>("get_state").then(setState).catch(console.error);
    const unsub = listen<ScanState>("state-changed", e => setState(e.payload));
    return () => { unsub.then(f => f()); };
  }, []);

  return (
    <div id="panel">
      <header className="header">
        <div className="title">Lyra</div>
        <button onClick={() => invoke("quit_app")}>Quit</button>
      </header>
      <div className="portList">
        {state.entries.map(e => (
          <div key={e.id} className="portRow">
            <span className="portNumber">{e.port}</span>
            <div className="portInfo">
              <span className="portName">{e.projectName}</span>
              <span className="portMeta">{e.processName}</span>
            </div>
            <div className="portActions">
              <button onClick={() => invoke("open_port", { port: e.port })}>Open</button>
              <button onClick={() => invoke("kill_port", { port: e.port })} className="destructive">Kill</button>
            </div>
          </div>
        ))}
        {state.entries.length === 0 && !state.isScanning && (
          <div className="empty">No servers detected</div>
        )}
      </div>
    </div>
  );
}