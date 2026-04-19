import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PortEntry {
  id: string; port: number; pid: number;
  processName: string; projectName: string; detectedProjectName: string;
  url: string; status: string; pinned: boolean; branch: string;
  uptimeSeconds: number | null;
}
interface ScanState { entries: PortEntry[]; isScanning: boolean; lastError: string | null; diagnostics: unknown }

function PortRow({ entry }: { entry: PortEntry }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.projectName);
  const save = () => { setEditing(false); invoke("rename_port", { port: entry.port, name }); };
  return (
    <div className="portRow">
      <span className="portNumber">{entry.port}</span>
      <div className="portInfo">
        {editing
          ? <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onBlur={save} onKeyDown={e => { if(e.key==="Enter") save(); if(e.key==="Escape") setEditing(false); }}
              className="renameInput" />
          : <span className="portName" onDoubleClick={() => setEditing(true)}>{entry.projectName}</span>}
        <span className="portMeta">{entry.processName}{entry.branch ? ` [${entry.branch}]` : ""}</span>
      </div>
      <div className="portActions">
        <button onClick={() => invoke("open_port",  { port: entry.port })}>Open</button>
        <button onClick={() => invoke("copy_url",   { port: entry.port })}>Copy</button>
        <button onClick={() => invoke("kill_port",  { port: entry.port })} className="destructive">Kill</button>
      </div>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<ScanState>({ entries: [], isScanning: true, lastError: null, diagnostics: null });
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<ScanState>("get_state").then(setState).catch(console.error);
    const unsub = listen<ScanState>("state-changed", e => setState(e.payload));
    return () => { unsub.then(f => f()); };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { setQuery(""); searchRef.current?.blur(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const filtered = useMemo(() =>
    query ? state.entries.filter(e =>
      String(e.port).includes(query) || e.projectName.toLowerCase().includes(query.toLowerCase())
    ) : state.entries,
    [state.entries, query]
  );

  return (
    <div id="panel">
      <header className="header">
        <div className="title">Lyra</div>
        <div className="headerActions">
          {state.entries.length > 0 && <button className="destructive" onClick={() => invoke("kill_all")}>Kill all</button>}
          <button onClick={() => invoke("quit_app")}>Quit</button>
        </div>
      </header>
      <div className="searchBar">
        <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search... (/)" className="searchInput" />
      </div>
      <div className="portList">
        {filtered.map(e => <PortRow key={e.id} entry={e} />)}
        {filtered.length === 0 && !state.isScanning && (
          <div className="empty">{query ? "No matches" : "No servers detected"}</div>
        )}
      </div>
    </div>
  );
}