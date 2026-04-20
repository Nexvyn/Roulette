import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";

type SortOption = "port" | "name" | "uptime";

interface PortEntry {
  id: string;
  port: number;
  pid: number;
  processName: string;
  projectName: string;
  detectedProjectName: string;
  branch: string;
  cwd: string | null;
  gitRoot: string | null;
  startTime: string | null;
  uptimeSeconds: number | null;
  url: string;
  status: string;
  pinned: boolean;
}

interface ScanDiagnostics {
  durationMs: number;
  portsFound: number;
  dataSource: string;
  timestamp: string;
  lastError: string | null;
}

interface ScanState {
  entries: PortEntry[];
  isScanning: boolean;
  lastError: string | null;
  diagnostics: ScanDiagnostics | null;
}

interface AppSettings {
  refreshIntervalSeconds: number;
  launchAtLogin: boolean;
  hasCompletedOnboarding: boolean;
  showDiagnostics: boolean;
  sortBy: SortOption;
  themeSource: string;
}

interface MenuState {
  x: number;
  y: number;
  entry: PortEntry;
}

const initialState: ScanState = { entries: [], isScanning: true, lastError: null, diagnostics: null };

export function App() {
  const [state, setState] = useState<ScanState>(initialState);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hoveredPort, setHoveredPort] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(console.error);
    invoke<ScanState>("get_state").then(setState).catch(console.error);
    const unlisten = listen<ScanState>("state-changed", (e) => setState(e.payload));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement === searchRef.current;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        setQuery("");
        searchRef.current?.blur();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        invoke("scan_now");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const report = () => {
      const h = Math.max(80, Math.min(Math.ceil(el.getBoundingClientRect().height), 600));
      getCurrentWindow().setSize(new LogicalSize(340, h)).catch(() => undefined);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings?.hasCompletedOnboarding]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.entries;
    return state.entries.filter(
      (e) =>
        e.projectName.toLowerCase().includes(q) ||
        String(e.port).includes(q) ||
        e.branch.toLowerCase().includes(q)
    );
  }, [query, state.entries]);

  const sorted = useMemo(() => {
    const by = settings?.sortBy ?? "port";
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (by === "name") return a.projectName.localeCompare(b.projectName);
      if (by === "uptime") return (b.uptimeSeconds ?? -1) - (a.uptimeSeconds ?? -1);
      return a.port - b.port;
    });
  }, [filtered, settings?.sortBy]);

  const selectedEntry = useMemo(() => {
    if (sorted.length === 0) return null;
    return sorted.find((e) => e.port === hoveredPort) ?? sorted[0];
  }, [hoveredPort, sorted]);

  const patchSettings = (patch: Partial<AppSettings>) => {
    invoke<AppSettings>("update_settings", { patch }).then(setSettings).catch(console.error);
  };

  if (settings && !settings.hasCompletedOnboarding) {
    return (
      <Onboarding
        onDone={() => {
          setSettings({ ...settings, hasCompletedOnboarding: true });
          invoke("update_settings", { patch: { hasCompletedOnboarding: true } });
        }}
      />
    );
  }

  const hasEntries = state.entries.length > 0;

  return (
    <div className="shell">
      <div className="panel" ref={panelRef}>
        <Header
          count={state.entries.length}
          settings={settings}
          onKillAll={() => invoke("kill_all")}
          onQuit={() => invoke("quit_app")}
          onToggleLaunch={(v) =>
            invoke<boolean>("toggle_launch_at_login", { enabled: v }).then((enabled) =>
              setSettings((s) => (s ? { ...s, launchAtLogin: enabled } : s))
            )
          }
          onSetInterval={(n) => patchSettings({ refreshIntervalSeconds: n })}
          onToggleDiagnostics={(v) => patchSettings({ showDiagnostics: v })}
          onSetSort={(s) => patchSettings({ sortBy: s })}
        />

        {hasEntries ? (
          <div className="searchBar">
            <SearchIcon />
            <input
              ref={searchRef}
              className="searchInput"
              placeholder="Filter ports"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button className="searchClear" onClick={() => setQuery("")} aria-label="Clear">Ã—</button>
            ) : null}
            <select
              className="sortSelect"
              value={settings?.sortBy ?? "port"}
              onChange={(e) => patchSettings({ sortBy: e.target.value as SortOption })}
              title="Sort by"
            >
              <option value="port">Port</option>
              <option value="name">Name</option>
              <option value="uptime">Uptime</option>
            </select>
          </div>
        ) : null}

        <main className="content">
          {state.lastError && state.entries.length === 0 ? (
            <ErrorState error={state.lastError} />
          ) : state.entries.length === 0 && state.isScanning ? (
            <ScanningState />
          ) : state.entries.length === 0 ? (
            <EmptyState />
          ) : sorted.length === 0 ? (
            <NoMatchState query={query} />
          ) : (
            <>
              <div className="portList">
                {sorted.map((entry, i) => (
                  <PortRow
                    key={entry.id}
                    entry={entry}
                    hovered={hoveredPort === entry.port}
                    showDivider={i > 0}
                    onHover={setHoveredPort}
                    onContextMenu={(x, y) => setMenu({ x, y, entry })}
                  />
                ))}
              </div>
              {settings?.showDiagnostics ? (
                <DiagnosticsPanel entry={selectedEntry} source={state.diagnostics?.dataSource ?? "unknown"} />
              ) : null}
            </>
          )}
        </main>
      </div>

      {menu ? <ContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function Header({
  count,
  settings,
  onKillAll,
  onQuit,
  onToggleLaunch,
  onSetInterval,
  onToggleDiagnostics,
  onSetSort
}: {
  count: number;
  settings: AppSettings | null;
  onKillAll: () => void;
  onQuit: () => void;
  onToggleLaunch: (v: boolean) => void;
  onSetInterval: (n: number) => void;
  onToggleDiagnostics: (v: boolean) => void;
  onSetSort: (s: SortOption) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const sorts: SortOption[] = ["port", "name", "uptime"];

  return (
    <header className="header">
      <div className="title">Lyra</div>
      <div className="headerActions">
        {count > 0 ? (
          <button className="headerButton destructive" onClick={onKillAll}>Kill all</button>
        ) : null}
        <button className="headerButton headerIcon" onClick={onQuit} title="Quit Lyra" aria-label="Quit">
          <PowerIcon />
        </button>
        <div className="settingsWrap">
          <button className="headerButton headerIcon" onClick={() => setShowMenu((v) => !v)} title="Settings" aria-label="Settings">
            <EllipsisIcon />
          </button>
          {showMenu ? (
            <>
              <div className="popoverScrim" onClick={() => setShowMenu(false)} />
              <div className="popover">
                <div className="popoverTitle">Lyra 0.1.0</div>
                <label className="settingRow">
                  <span>Launch at Login</span>
                  <input type="checkbox" checked={settings?.launchAtLogin ?? false} onChange={(e) => onToggleLaunch(e.target.checked)} />
                </label>
                <label className="settingRow">
                  <span>Show diagnostics</span>
                  <input type="checkbox" checked={settings?.showDiagnostics ?? false} onChange={(e) => onToggleDiagnostics(e.target.checked)} />
                </label>
                <div className="settingDivider" />
                <div className="settingLabel">Sort by</div>
                <div className="segmented">
                  {sorts.map((s) => (
                    <button key={s} className={`segment ${settings?.sortBy === s ? "active" : ""}`} onClick={() => onSetSort(s)}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="settingLabel" style={{ marginTop: 10 }}>Refresh interval</div>
                <div className="segmented">
                  {[2, 5, 10, 30].map((n) => (
                    <button key={n} className={`segment ${settings?.refreshIntervalSeconds === n ? "active" : ""}`} onClick={() => onSetInterval(n)}>
                      {n}s
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function PortRow({
  entry,
  hovered,
  showDivider,
  onHover,
  onContextMenu
}: {
  entry: PortEntry;
  hovered: boolean;
  showDivider: boolean;
  onHover: (port: number | null) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const renamePort = () => {
    const next = window.prompt(`Rename port ${entry.port}. Leave empty to reset.`, entry.projectName);
    if (next === null) return;
    if (next.trim().length === 0 || next.trim() === entry.detectedProjectName) {
      invoke("reset_port_name", { port: entry.port });
    } else {
      invoke("rename_port", { port: entry.port, name: next.trim() });
    }
  };

  return (
    <div
      className={`portRow ${entry.status === "terminating" ? "isTerminating" : ""} ${entry.pinned ? "isPinned" : ""}`}
      onMouseEnter={() => onHover(entry.port)}
      onMouseLeave={() => onHover(null)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY); }}
    >
      {showDivider && <div className="rowDivider" />}
      <div className="rowPrimary">
        <div className="rowLeft">
          <div className="statusDot" />
          <div className="projectBlock">
            <button className="projectNameButton" onDoubleClick={renamePort} title={`Double-click to rename. Detected: ${entry.detectedProjectName}`}>
              <span className="projectName">{entry.projectName}</span>
            </button>
            <div className="rowSecondary">
              {entry.branch ? (
                <span className="branchWrap">
                  <BranchIcon />
                  <span className="branch" title={entry.branch}>{entry.branch}</span>
                </span>
              ) : null}
              <span className="portValue">:{entry.port}</span>
            </div>
          </div>
        </div>

        <button
          className={`pinButton ${entry.pinned ? "pinned" : ""}`}
          onClick={() => invoke("set_pinned", { port: entry.port, pinned: !entry.pinned })}
          title={entry.pinned ? "Unpin" : "Pin to top"}
          aria-label={entry.pinned ? "Unpin" : "Pin"}
        >
          <StarIcon filled={entry.pinned} />
        </button>

        <div className="rowRight">
          <div className={`rowActions ${hovered ? "visible" : ""}`}>
            <button className="textAction kill" onClick={() => invoke("kill_port", { port: entry.port, pid: entry.pid })}>Kill</button>
            <button className="textAction" onClick={() => invoke("open_port", { port: entry.port })}>Open</button>
          </div>
          <div className="uptime">{formatUptime(entry.uptimeSeconds)}</div>
        </div>
      </div>
    </div>
  );
}

function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { x, y, entry } = menu;
  const run = (fn: () => void) => { fn(); onClose(); };
  return (
    <>
      <div className="popoverScrim" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="ctxMenu" style={{ left: x, top: y }}>
        <button className="ctxItem" onClick={() => run(() => invoke("set_pinned", { port: entry.port, pinned: !entry.pinned }))}>
          {entry.pinned ? "Unpin" : "Pin to Top"}
        </button>
        <div className="ctxDivider" />
        <button className="ctxItem" onClick={() => run(() => invoke("copy_url", { url: entry.url }))}>Copy URL</button>
        <button className="ctxItem" onClick={() => run(() => invoke("copy_port", { port: entry.port }))}>Copy Port</button>
        <div className="ctxDivider" />
        <button className="ctxItem" onClick={() => run(() => invoke("open_port", { port: entry.port }))}>Open in Browser</button>
        <div className="ctxDivider" />
        <button className="ctxItem danger" onClick={() => run(() => invoke("kill_port", { port: entry.port, pid: entry.pid }))}>Kill Server</button>
      </div>
    </>
  );
}

function DiagnosticsPanel({ entry, source }: { entry: PortEntry | null; source: string }) {
  if (!entry) return null;
  return (
    <section className="diagnosticsPanel">
      <div className="diagnosticsTitle">Diagnostics</div>
      <div className="diagnosticsGrid">
        <DiagnosticRow label="process" value={entry.processName} />
        <DiagnosticRow label="cwd" value={entry.cwd} />
        <DiagnosticRow label="gitRoot" value={entry.gitRoot} />
        <DiagnosticRow label="source" value={source} />
      </div>
    </section>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="diagnosticRow">
      <span className="diagnosticLabel">{label}</span>
      <span className="diagnosticValue" title={value ?? "-"}>{value ?? "-"}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="stateCard">
      <div className="stateGlyph">â–¦</div>
      <div className="stateTitle">No dev servers detected</div>
      <div className="stateText">Start a dev server to see it here.</div>
    </div>
  );
}

function NoMatchState({ query }: { query: string }) {
  return (
    <div className="stateCard">
      <div className="stateTitle">No matches</div>
      <div className="stateText">Nothing matches â€œ{query}â€.</div>
    </div>
  );
}

function ScanningState() {
  return (
    <div className="stateCard">
      <div className="loader" />
      <div className="stateTitle">Scanning portsâ€¦</div>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="stateCard">
      <div className="stateGlyph warn">âš </div>
      <div className="stateTitle">Scan failed</div>
      <div className="stateText">{error}</div>
      <button className="retryButton" onClick={() => invoke("scan_now")}>Retry</button>
    </div>
  );
}

function Onboarding({ onDone }: { onDone: () => void }) {
  const ports = ["localhost:3000", "localhost:5173", "localhost:8080", "localhost:4000", "localhost:3001", "localhost:9000", "localhost:8000", "localhost:5000"];
  const pos = [
    { x: 53, y: 44 }, { x: 246, y: 31 }, { x: 35, y: 135 }, { x: 237, y: 131 },
    { x: 130, y: 78 }, { x: 71, y: 222 }, { x: 240, y: 211 }, { x: 153, y: 182 }
  ];
  const [revealed, setRevealed] = useState(true);

  useEffect(() => {
    getCurrentWindow().setSize(new LogicalSize(340, 380)).catch(() => undefined);
    const t = setTimeout(() => setRevealed(false), 1900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="onboarding">
      <div className={`obPorts ${revealed ? "" : "gone"}`}>
        {ports.map((p, i) => (
          <span key={p} className="obPort" style={{ left: pos[i].x, top: pos[i].y, animationDelay: `${i * 0.08}s` }}>{p}</span>
        ))}
      </div>
      <div className={`obContent ${revealed ? "" : "in"}`}>
        <div className="obTitle">localhost,<br />organized.</div>
        <div className="obSubtitle">A menu bar app that tracks your<br />dev servers across projects.</div>
        <div className="obButtons">
          <button className="obPrimary" onClick={onDone}>Get Started</button>
        </div>
      </div>
    </div>
  );
}

function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hicon" aria-hidden="true">
      <path d="M12 3v9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 6a8 8 0 1 0 10 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hicon" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="branchIcon" aria-hidden="true">
      <circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="18" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 8v8M6 14a6 6 0 0 1 6-6h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="searchIcon" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="starIcon" aria-hidden="true">
      <path
        d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L12 16.77l-5.2 2.73.99-5.78-4.21-4.1 5.82-.85L12 3.5z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatUptime(seconds: number | null) {
  if (seconds == null) return "";
  if (seconds < 60) return "<1m";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
