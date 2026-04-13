import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, PortEntry, ScanState, SortOption } from "@shared/contracts";

const initialState: ScanState = {
  entries: [],
  isScanning: true,
  lastError: null,
  diagnostics: null
};

function PortRow({ entry, api }: { entry: PortEntry; api: typeof window.portMenu }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.projectName);

  const save = () => {
    setEditing(false);
    api?.renamePort(entry.port, name);
  };

  return (
    <div className="portRow">
      <span className="portBadge">{entry.pinned ? "+" : ""}</span>
      <span className="portNumber">{entry.port}</span>
      <div className="portInfo">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={save}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            className="renameInput"
          />
        ) : (
          <span className="portName" onDoubleClick={() => setEditing(true)}>{entry.projectName}</span>
        )}
        <span className="portMeta">{entry.processName} {entry.branch ? `[${entry.branch}]` : ""}</span>
      </div>
      <div className="portActions">
        <button onClick={() => api?.openPort(entry.port)}>Open</button>
        <button onClick={() => api?.copyUrl(entry.port)}>Copy</button>
        <button onClick={() => api?.killPort(entry.port)} className="destructive">Kill</button>
      </div>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<ScanState>(initialState);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const api = window.portMenu;

  useEffect(() => {
    if (!api) return;
    void api.getSettings().then(setSettings);
    void api.getInitialState().then(setState);
    const unsub = api.onStateChange(setState);
    return unsub;
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") { setQuery(""); searchRef.current?.blur(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() =>
    query
      ? state.entries.filter(e =>
          String(e.port).includes(query) ||
          e.projectName.toLowerCase().includes(query.toLowerCase())
        )
      : state.entries,
    [state.entries, query]
  );

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
      <div className="searchBar">
        <input
          ref={searchRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search ports... (/)"
          className="searchInput"
        />
      </div>
      <div className="portList">
        {filtered.map(e => (
          <PortRow key={e.id} entry={e} api={api} />
        ))}
        {filtered.length === 0 && !state.isScanning && (
          <div className="empty">{query ? "No matches" : "No servers detected"}</div>
        )}
      </div>
    </div>
  );
}