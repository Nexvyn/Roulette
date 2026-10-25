import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionGlobalConfig, motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  ContainerIcon,
  Copy01Icon,
  GitBranchIcon,
  Globe02Icon,
  Link01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  PinIcon,
  PinOffIcon,
  RefreshIcon,
  Search01Icon,
  ShutDownIcon,
  StarIcon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { runtimeFor } from "./runtime";
import { Squircle, useSquircle } from "./squircle";
import type { AppSettings, LinkExpiry, PortEntry, ScanState, SortOption, TunnelInfo, UpdateInfo } from "./types";
import "./panel.css";

export interface Backend {
  scan(): void;
  kill(port: number, pid: number): void;
  killAll(): void;
  open(port: number): void;
  copy(text: string): void;
  rename(port: number, name: string): void;
  resetName(port: number): void;
  pin(port: number, pinned: boolean): void;
  startTunnel(port: number): void;
  stopTunnel(port: number): void;
  updateSettings(patch: Partial<AppSettings>): void;
  setLaunchAtLogin(enabled: boolean): void;
  installUpdate(): void;
  quit(): void;
}

export const IS_MAC = /Mac/i.test(navigator.userAgent);
const APP_NAME = "Roulette";
const APP_VERSION = "0.1.0";

const ease = [0.23, 1, 0.32, 1] as const;
const easeInOut = [0.645, 0.045, 0.355, 1] as const;
const exitT = { duration: 0.12, ease: [0.55, 0, 1, 0.45] } as const;
const hover = { duration: 0.1, ease: [0.23, 1, 0.32, 1] } as const;
const glide = { type: "spring", duration: 0.3, bounce: 0 } as const;
const swap = { type: "spring", duration: 0.35, bounce: 0 } as const;

const MENU_H = 250;
const SETTINGS_MIN = 380;
const EDGE = 6;

export function I({ icon, size = 15, className = "", stroke = 1.6 }: { icon: IconSvgElement; size?: number; className?: string; stroke?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} className={className} aria-hidden />;
}

export function Spark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="sp-spark">
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <rect key={a} x="42" y="3" width="16" height="31" rx="8" fill="currentColor" transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="9.5" fill="currentColor" />
    </svg>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="sp-kbd">
      {children === "/" ? (
        // The "/" glyph sits low and off to one side in most fonts, so it's drawn as a centred stroke.
        <svg width="6" height="10" viewBox="0 0 6 10" aria-label="/">
          <path d="M5 1 1 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </svg>
      ) : (
        children
      )}
    </kbd>
  );
}

function Tool({ label, onClick, icon, tone }: { label: string; onClick?: () => void; icon: IconSvgElement; tone?: "danger" | "accent" | "star" | "cloud" | "cloud-on" }) {
  const shape = useSquircle<HTMLButtonElement>(8);
  return (
    <button
      ref={shape.ref}
      style={shape.style}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-label={label}
      title={label}
      className={`sp-tool ${tone ? `is-${tone}` : ""}`}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={label}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={swap}
          className="sp-tool-icon"
        >
          <I icon={icon} size={15} className={tone === "star" ? "is-filled" : ""} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function formatUptime(seconds: number | null) {
  if (seconds === null || seconds < 0) return "";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const isDocker = (e: PortEntry) => e.container !== null || /^(com\.docker.*|docker|dockerd|docker-proxy|vpnkit|vpnkit-bridge|wslrelay)$/i.test(e.processName);

function RuntimeTile({ entry }: { entry: PortEntry }) {
  const rt = runtimeFor(entry.processName);
  return (
    <span title={`${rt.name} · ${entry.processName}`} className="sp-runtime">
      <img src={rt.logo} alt={rt.name} width={20} height={20} draggable={false} className={rt.dark ? `dark-${rt.dark}` : ""} />
    </span>
  );
}

function timeLeft(at: number | null) {
  if (at === null) return null;
  const m = Math.max(1, Math.ceil((at - Date.now()) / 60000));
  return m < 60 ? `${m}m left` : `${Math.floor(m / 60)}h ${m % 60}m left`;
}

const EXPIRY_LABEL: Record<LinkExpiry, string> = { "1h": "1 hour", "4h": "4 hours", never: "Never" };

function TunnelLine({ tunnel, copied, onCopy }: { tunnel: TunnelInfo | null; copied: boolean; onCopy: () => void }) {
  const key = !tunnel ? "none" : copied ? "copied" : tunnel.status;
  return (
    <div className={`sp-expand ${tunnel ? "is-open" : ""}`}>
      <div className="sp-expand-inner">
        {tunnel ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (tunnel.status === "live") onCopy();
            }}
            title={tunnel.status === "live" ? `Copy ${tunnel.url}` : tunnel.error ?? "Connecting to Cloudflare"}
            className={`sp-tunnel is-${tunnel.status} ${copied ? "is-copied" : ""}`}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, transition: exitT }}
                transition={{ duration: 0.2, ease }}
                className="sp-tunnel-text"
              >
                {tunnel.status === "error" ? (
                  <I icon={Alert02Icon} size={11} />
                ) : copied ? (
                  <I icon={CheckmarkCircle02Icon} size={11} />
                ) : tunnel.status === "live" ? (
                  <I icon={Globe02Icon} size={11} />
                ) : (
                  <span className="sp-pulse" />
                )}
                <span className="sp-truncate">
                  {tunnel.status === "error"
                    ? tunnel.error
                    : copied
                      ? "Copied link"
                      : tunnel.status === "live" && tunnel.url
                        ? tunnel.url.replace("https://", "")
                        : "Getting a public link… (up to 30s)"}
                </span>
                {tunnel.status === "live" && !copied && tunnel.expiresAt !== null ? <span className="sp-tunnel-left">{timeLeft(tunnel.expiresAt)}</span> : null}
              </motion.span>
            </AnimatePresence>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  entry,
  selected,
  editing,
  copied,
  rowRef,
  onHover,
  onMenu,
  onEdit,
  onRename,
  onCopyLink,
  onKill,
  backend,
}: {
  entry: PortEntry;
  selected: boolean;
  editing: boolean;
  copied: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onHover: () => void;
  onMenu: (e: React.MouseEvent) => void;
  onEdit: (on: boolean) => void;
  onRename: (value: string) => void;
  onCopyLink: () => void;
  onKill: () => void;
  backend: Backend;
}) {
  const tunnel = entry.tunnel;
  const sharing = tunnel !== null && tunnel.status !== "error";
  const terminating = entry.status === "terminating";
  const done = useRef(false);
  const commit = (value: string) => {
    if (done.current) return;
    done.current = true;
    onRename(value);
  };
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: terminating ? 0.45 : 1, height: "auto", x: terminating ? 8 : 0 }}
      exit={{ opacity: 0, height: 0, x: 16, transition: { duration: 0.18, ease: easeInOut } }}
      transition={{ duration: 0.16, ease, layout: { duration: 0.28, ease: easeInOut } }}
      className="sp-row-wrap"
    >
      <div ref={rowRef} onMouseMove={onHover} onContextMenu={onMenu} className="sp-row">
        <RuntimeTile entry={entry} />

        <div className="sp-row-main">
          <div className="sp-row-title">
            {editing ? (
              <input
                className="sp-rename"
                defaultValue={entry.projectName}
                autoFocus
                onFocus={(e) => {
                  done.current = false;
                  e.currentTarget.select();
                }}
                onBlur={(e) => commit(e.currentTarget.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commit(e.currentTarget.value);
                  if (e.key === "Escape") commit(entry.projectName);
                }}
                aria-label={`Rename port ${entry.port}. Leave empty to reset.`}
              />
            ) : (
              <span
                className="sp-name"
                onDoubleClick={() => onEdit(true)}
                title={`Double-click to rename · detected as ${entry.detectedProjectName}`}
              >
                {entry.projectName}
              </span>
            )}
            {entry.pinned && !editing ? <I icon={StarIcon} size={11} stroke={2} className="sp-pin-star is-filled" /> : null}
          </div>
          {entry.container ? (
            <div className="sp-row-sub" title={`Container ${entry.container.id}`}>
              <I icon={ContainerIcon} size={11} />
              <span className="sp-truncate">{entry.container.project ? `${entry.container.project} · ${entry.container.image}` : entry.container.image}</span>
            </div>
          ) : entry.branch ? (
            <div className="sp-row-sub">
              <I icon={GitBranchIcon} size={11} />
              <span className="sp-truncate">{entry.branch}</span>
            </div>
          ) : (
            <div className="sp-row-sub">
              <span className="sp-truncate">{entry.processName}</span>
            </div>
          )}
          <TunnelLine tunnel={tunnel} copied={copied} onCopy={onCopyLink} />
        </div>

        <div className="sp-row-side">
          <motion.div initial={false} animate={{ opacity: selected ? 0 : 1 }} transition={{ duration: 0.15, ease }} className="sp-row-meta">
            <span className="sp-port">{entry.port}</span>
            <span className="sp-uptime">{formatUptime(entry.uptimeSeconds)}</span>
          </motion.div>
          <motion.div
            initial={false}
            animate={{ opacity: selected ? 1 : 0, x: selected ? 0 : 4 }}
            transition={{ duration: 0.15, ease }}
            className={`sp-row-actions ${selected ? "" : "is-hidden"}`}
          >
            <Tool label={entry.pinned ? "Unpin" : "Pin to top"} onClick={() => backend.pin(entry.port, !entry.pinned)} icon={entry.pinned ? PinOffIcon : PinIcon} tone={entry.pinned ? "star" : undefined} />
            <Tool
              label={sharing ? "Stop sharing" : "Share via Cloudflare Tunnel"}
              onClick={() => (sharing ? backend.stopTunnel(entry.port) : backend.startTunnel(entry.port))}
              icon={sharing ? StopCircleIcon : Globe02Icon}
              tone={sharing ? "cloud-on" : "cloud"}
            />
            <Tool label={`Open localhost:${entry.port}  ↵`} onClick={() => backend.open(entry.port)} icon={ArrowUpRight01Icon} />
            <Tool label={entry.container ? "Stop container  ⌫" : "Kill  ⌫"} onClick={onKill} icon={CancelCircleIcon} tone="danger" />
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

type MenuAction = "pin" | "rename" | "url" | "port" | "share" | "unshare" | "public" | "open" | "kill";

function Menu({ entry, up, maxHeight, onPick }: { entry: PortEntry; up: boolean; maxHeight: number; onPick: (a: MenuAction) => void }) {
  const tunnel = entry.tunnel;
  const sharing = tunnel !== null && tunnel.status !== "error";
  const item = (a: MenuAction, icon: IconSvgElement, label: string, hint?: string, danger?: boolean) => (
    <button key={a} type="button" onClick={() => onPick(a)} className={`sp-menu-item ${danger ? "is-danger" : ""}`}>
      <I icon={icon} size={14} />
      <span className="sp-menu-label">{label}</span>
      {hint ? <span className="sp-menu-hint">{hint}</span> : null}
    </button>
  );
  const sep = (k: string) => <div key={k} className="sp-sep" />;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: up ? 4 : -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: exitT }}
      transition={{ duration: 0.16, ease }}
      className={`sp-pop sp-menu ${up ? "from-bottom" : "from-top"}`}
    >
      <span aria-hidden className="sp-pop-shadow" />
      <Squircle radius={12} edge="var(--border)" className="sp-pop-body sp-menu-body" style={{ maxHeight }}>
        {item("pin", entry.pinned ? PinOffIcon : PinIcon, entry.pinned ? "Unpin" : "Pin to Top")}
        {item("rename", PencilEdit02Icon, "Rename…")}
        {sep("a")}
        {item("url", Link01Icon, "Copy URL")}
        {item("port", Copy01Icon, "Copy Port")}
        {sep("b")}
        {sharing ? item("unshare", StopCircleIcon, "Stop Sharing") : item("share", Globe02Icon, "Share via Cloudflare Tunnel")}
        {tunnel?.status === "live" ? item("public", Globe02Icon, "Copy Public URL") : null}
        {sep("c")}
        {item("open", ArrowUpRight01Icon, "Open in Browser", "↵")}
        {sep("d")}
        {item("kill", CancelCircleIcon, entry.container ? "Stop Container" : "Kill Server", "⌫", true)}
      </Squircle>
    </motion.div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="sp-toggle-row">
      <span>{label}</span>
      <span className={`sp-toggle ${on ? "is-on" : ""}`}>
        <motion.span className="sp-toggle-knob" initial={false} animate={{ x: on ? (IS_MAC ? 16 : 12) : 0 }} transition={{ type: "spring", duration: 0.25, bounce: 0 }} />
      </span>
    </button>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, format = String }: { value: T; options: readonly T[]; onChange: (v: T) => void; format?: (v: T) => string }) {
  const id = useId();
  return (
    <Squircle radius={8} className="sp-seg" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button key={String(o)} type="button" onClick={() => onChange(o)} className={`sp-seg-item ${value === o ? "is-on" : ""}`}>
          {value === o ? <motion.span layoutId={`seg-${id}`} transition={glide} className="sp-seg-pill" /> : null}
          <span className="sp-seg-label">{format(o)}</span>
        </button>
      ))}
    </Squircle>
  );
}

function SettingsView({ settings, backend }: { settings: AppSettings; backend: Backend }) {
  const label = (t: string) => <div className="sp-set-label">{t}</div>;
  return (
    <div className="sp-settings-view">
      <Toggle label="Launch at Login" on={settings.launchAtLogin} onChange={(v) => backend.setLaunchAtLogin(v)} />
      <Toggle label="Show diagnostics" on={settings.showDiagnostics} onChange={(v) => backend.updateSettings({ showDiagnostics: v })} />
      {label("Sort by")}
      <Segmented<SortOption> value={settings.sortBy} options={["port", "name", "uptime"] as const} onChange={(v) => backend.updateSettings({ sortBy: v })} />
      {label("Refresh every")}
      <Segmented<number>
        value={settings.refreshIntervalSeconds}
        options={[2, 5, 10, 30] as const}
        onChange={(v) => backend.updateSettings({ refreshIntervalSeconds: v })}
        format={(n) => `${n}s`}
      />
      {label("Shared links expire after")}
      <Segmented<LinkExpiry> value={settings.linkExpiry} options={["1h", "4h", "never"] as const} onChange={(v) => backend.updateSettings({ linkExpiry: v })} format={(v) => EXPIRY_LABEL[v]} />
      {label("Sharing")}
      <Squircle radius={10} className="sp-share-card">
        <I icon={Globe02Icon} size={14} className="sp-accent" />
        <div className="sp-share-text">
          <div className="sp-share-title">Cloudflare Tunnel</div>
          <div>Share gives a temporary trycloudflare.com link, no account needed. Uses your installed cloudflared.</div>
        </div>
      </Squircle>
      <div className="sp-set-foot">
        {APP_NAME} {APP_VERSION}
      </div>
    </div>
  );
}

const viewIn = (dir: 1 | -1) => ({ opacity: 0, x: 8 * dir });
const viewOut = (dir: 1 | -1) => ({ opacity: 0, x: 8 * dir, transition: { duration: 0.1, ease: [0.55, 0, 1, 0.45] as const } });
const viewShown = { opacity: 1, x: 0, transition: { duration: 0.2, ease, delay: 0.05 } };

function StateCard({ icon, title, text, action }: { icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="sp-state">
      <span className="sp-state-icon">{icon}</span>
      <span className="sp-state-title">{title}</span>
      {text ? <span className="sp-state-text">{text}</span> : null}
      {action}
    </div>
  );
}

function installCommand() {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return { os: "macOS", command: "brew install cloudflared" };
  if (/Win/i.test(ua)) return { os: "Windows", command: "winget install --id Cloudflare.cloudflared" };
  return {
    os: "Linux",
    command: "curl -fsSL -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared.deb",
  };
}
const CLOUDFLARED_DOWNLOADS = "https://developers.cloudflare.com/tunnel/downloads/";

function InstallSheet({ onCopy, onClose }: { onCopy: (text: string) => void; onClose: () => void }) {
  const { os, command } = useMemo(installCommand, []);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) => {
    onCopy(text);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };
  return (
    <motion.div
      className="sp-sheet"
      role="dialog"
      aria-label="Cloudflare Tunnel is not installed"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: exitT }}
      transition={{ duration: 0.18, ease }}
      onClick={onClose}
    >
      <motion.div
        className="sp-sheet-card"
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98, transition: exitT }}
        transition={{ duration: 0.24, ease }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sp-sheet-icon">
          <I icon={Globe02Icon} size={16} />
        </span>
        <div className="sp-sheet-title">Cloudflare Tunnel isn’t installed</div>
        <div className="sp-sheet-text">Share uses cloudflared to make the public link. Install it once, then press Share again. On {os}, run:</div>
        <div className="sp-code">
          <code>{command}</code>
          <button type="button" className="sp-code-copy" onClick={() => copy(command)} aria-label="Copy the command">
            <I icon={copied ? CheckmarkCircle02Icon : Copy01Icon} size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button type="button" className="sp-sheet-link" onClick={() => copy(CLOUDFLARED_DOWNLOADS)}>
          Or copy the download page link
        </button>
        <button type="button" className="sp-solid-btn sp-sheet-done" onClick={onClose}>
          Done
        </button>
      </motion.div>
    </motion.div>
  );
}

export function Panel({
  state,
  settings,
  backend,
  apiError,
  panelRef,
  update = null,
}: {
  state: ScanState;
  settings: AppSettings;
  update?: UpdateInfo | null;
  backend: Backend;
  apiError: string | null;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ port: number; x: number; y: number; up: boolean; maxHeight: number } | null>(null);
  const [view, setView] = useState<"list" | "settings">("list");
  const [switching, setSwitching] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [copiedPort, setCopiedPort] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [spin, setSpin] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const viaKeys = useRef(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reduce = useReducedMotion();
  useEffect(() => {
    MotionGlobalConfig.skipAnimations = !!reduce;
  }, [reduce]);

  const say = (t: string) => {
    setNote(t);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 1600);
  };
  const kill = (entry: PortEntry) => {
    if (isDocker(entry) && !entry.container) say("Held by Docker itself");
    else backend.kill(entry.port, entry.pid);
  };
  const copy = (text: string, label = text) => {
    backend.copy(text);
    say(`Copied ${label}`);
  };
  const copyLink = (entry: PortEntry) => {
    if (!entry.tunnel?.url) return;
    backend.copy(entry.tunnel.url);
    setCopiedPort(entry.port);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedPort(null), 1500);
  };
  useEffect(
    () => () => {
      clearTimeout(noteTimer.current);
      clearTimeout(copiedTimer.current);
    },
    []
  );

  const liveSeen = useRef(new Set<string>());
  useEffect(() => {
    for (const e of state.entries) {
      const url = e.tunnel?.status === "live" ? e.tunnel.url : null;
      if (url && !liveSeen.current.has(url)) {
        liveSeen.current.add(url);
        say(`:${e.port} is live`);
      }
    }
  }, [state.entries]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? state.entries.filter(
          (e) =>
            e.projectName.toLowerCase().includes(q) ||
            String(e.port).includes(q) ||
            e.branch.toLowerCase().includes(q) ||
            (e.container?.image.toLowerCase().includes(q) ?? false)
        )
      : state.entries;
    const by: Record<SortOption, (a: PortEntry, b: PortEntry) => number> = {
      port: (a, b) => a.port - b.port,
      name: (a, b) => a.projectName.localeCompare(b.projectName),
      uptime: (a, b) => (b.uptimeSeconds ?? -1) - (a.uptimeSeconds ?? -1),
    };
    return [...list].sort(by[settings.sortBy] ?? by.port);
  }, [state.entries, query, settings.sortBy]);
  const pinned = shown.filter((e) => e.pinned);
  const running = shown.filter((e) => !e.pinned);
  const ordered = [...pinned, ...running];

  const rename = (port: number, value: string) => {
    setEditing(null);
    const entry = state.entries.find((e) => e.port === port);
    const next = value.trim();
    if (!entry || next === entry.projectName) return;
    if (!next || next === entry.detectedProjectName) backend.resetName(port);
    else backend.rename(port, next);
  };

  const stateRef = useRef({ ordered, sel, editing, view });
  stateRef.current = { ordered, sel, editing, view };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { ordered: list, sel: cur, editing: ed, view: v } = stateRef.current;
      if (ed !== null) return;
      if (v === "settings") {
        if (e.key === "Escape") showView("list");
        return;
      }
      const idx = list.findIndex((s) => s.port === cur);
      const typing = document.activeElement === search.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
        viaKeys.current = true;
        if (list[next]) setSel(list[next].port);
      } else if (e.key === "Enter" && cur !== null) {
        e.preventDefault();
        backend.open(cur);
      } else if ((e.key === "Backspace" || e.key === "Delete") && cur !== null && !typing) {
        e.preventDefault();
        const entry = list.find((s) => s.port === cur);
        if (entry) kill(entry);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setSpin((n) => n + 1);
        backend.scan();
      } else if (e.key === "Escape") {
        setQuery("");
        setMenu(null);
        search.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backend]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  /* The selection highlight lives on the list, not inside a row, so nothing clips it while it
     glides. offsetTop ignores the reorder transform, and a ResizeObserver keeps it in step while a
     row's link line opens or closes. */
  const listRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());
  const [hl, setHl] = useState({ y: 0, h: 48, on: false, snap: true });
  const [settled, setSettled] = useState(0);
  const layoutKey = ordered.map((s) => `${s.port}:${s.tunnel?.status ?? ""}`).join(",");
  useLayoutEffect(() => {
    const el = sel !== null ? rowEls.current.get(sel) : undefined;
    const list = listRef.current;
    if (!el || !list) {
      setHl((h) => (h.on ? { ...h, on: false } : h));
      return;
    }
    const measure = () => {
      let y = 0;
      for (let n: HTMLElement | null = el; n && n !== list; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      const h = el.offsetHeight;
      setHl((prev) => (prev.on && prev.y === y && prev.h === h ? prev : { y, h, on: true, snap: !prev.on }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sel, layoutKey, settled]);

  const menuEntry = menu ? state.entries.find((e) => e.port === menu.port) : undefined;
  const openMenu = (entry: PortEntry, e: React.MouseEvent) => {
    e.preventDefault();
    viaKeys.current = false;
    setSel(entry.port);
    const r = panelRef.current!.getBoundingClientRect();
    const y = e.clientY - r.top + 4;
    /* The menu stays inside the panel, the way a native menu shifts to stay on screen: below the
       pointer if it fits, else above it, else shifted to fit (and scrolling only if the panel is
       shorter than the menu). The panel never grows for it, so nothing behind it moves. */
    const room = r.height - EDGE * 2;
    const h = Math.min(MENU_H, room);
    let top = y;
    let up = false;
    if (y + h > r.height - EDGE) {
      up = y - 8 - h >= EDGE;
      top = up ? y - 8 - h : Math.max(EDGE, r.height - EDGE - h);
    }
    setMenu({ port: entry.port, x: Math.max(EDGE, Math.min(e.clientX - r.left, r.width - 220)), y: top, up, maxHeight: h });
  };
  const pick = (a: MenuAction) => {
    const entry = menuEntry;
    setMenu(null);
    if (!entry) return;
    if (a === "pin") backend.pin(entry.port, !entry.pinned);
    if (a === "rename") setEditing(entry.port);
    if (a === "url") copy(`http://localhost:${entry.port}`);
    if (a === "port") copy(String(entry.port), `:${entry.port}`);
    if (a === "share") backend.startTunnel(entry.port);
    if (a === "unshare") backend.stopTunnel(entry.port);
    if (a === "public") copyLink(entry);
    if (a === "open") backend.open(entry.port);
    if (a === "kill") kill(entry);
  };

  /* Swapping between the list and the settings: the body's height eases from one view to the other
     (ease-in-out, since it's already on screen) and the window follows frame by frame. Outside a swap
     the body tracks its content instantly, so rows and link lines keep their own animations. */
  const bodyInner = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState<number | "auto">("auto");
  useLayoutEffect(() => {
    const el = bodyInner.current;
    if (!el) return;
    const measure = () => setBodyH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const switchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(switchTimer.current), []);
  /* Settings opens inside the space the list already takes, so the panel (and the window around it)
     keeps its size; the settings scroll if they need more room. Only a very short list grows to fit. */
  const [settingsH, setSettingsH] = useState(SETTINGS_MIN);
  function showView(next: "list" | "settings") {
    if (next === "settings") setSettingsH(Math.max(SETTINGS_MIN, bodyInner.current?.offsetHeight ?? 0));
    setMenu(null);
    setSel(null);
    setSwitching(true);
    setView(next);
    clearTimeout(switchTimer.current);
    switchTimer.current = setTimeout(() => setSwitching(false), 320);
  }

  const row = (entry: PortEntry) => (
    <Row
      key={entry.id}
      entry={entry}
      backend={backend}
      selected={sel === entry.port && editing !== entry.port}
      editing={editing === entry.port}
      copied={copiedPort === entry.port}
      rowRef={(el) => {
        if (el) rowEls.current.set(entry.port, el);
        else rowEls.current.delete(entry.port);
      }}
      onHover={() => {
        viaKeys.current = false;
        if (!menu) setSel(entry.port);
      }}
      onMenu={(e) => openMenu(entry, e)}
      onEdit={(on) => setEditing(on ? entry.port : null)}
      onRename={(v) => rename(entry.port, v)}
      onCopyLink={() => copyLink(entry)}
      onKill={() => kill(entry)}
    />
  );

  const missingCloudflared = state.entries.filter((e) => e.tunnel?.status === "error" && /not installed/i.test(e.tunnel.error ?? ""));
  const [sheetClosed, setSheetClosed] = useState(false);
  useEffect(() => {
    if (!missingCloudflared.length) setSheetClosed(false);
  }, [missingCloudflared.length]);
  const showInstall = missingCloudflared.length > 0 && !sheetClosed;
  const closeInstall = () => {
    setSheetClosed(true);
    // clears the red line on the row, so the next Share tries again
    missingCloudflared.forEach((e) => backend.stopTunnel(e.port));
  };

  const error = apiError ?? (state.lastError && state.entries.length === 0 ? state.lastError : null);
  const selected = ordered.find((e) => e.port === sel) ?? ordered[0] ?? null;
  const shared = state.entries.filter((e) => e.tunnel?.status === "live").length;
  const killable = state.entries.filter((e) => !isDocker(e)).length;
  const dockerRows = state.entries.length - killable;

  return (
    <div
      ref={panelRef}
      className={`sp-panel ${IS_MAC ? "is-mac" : ""}`}
      style={showInstall ? { minHeight: 290 } : undefined}
      onMouseLeave={() => !menu && setSel(null)}
    >
      <div className="sp-header">
        <div className="sp-brand">
          <Spark size={14} />
          <span className="sp-brand-text">
            <span className="sp-brand-name">{APP_NAME}</span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={note ?? (view === "settings" ? "settings" : "count")}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3, transition: exitT }}
                transition={{ duration: 0.18, ease }}
                className={`sp-brand-count ${note ? "is-note" : ""}`}
                role={note ? "status" : undefined}
              >
                {note ?? (view === "settings" ? "Settings" : `${state.entries.length} running`)}
              </motion.span>
            </AnimatePresence>
          </span>
        </div>
        <div className="sp-header-actions">
          <AnimatePresence initial={false}>
            {killable > 0 && view === "list" ? (
              <motion.button
                key="killall"
                type="button"
                onClick={() => backend.killAll()}
                className="sp-text-btn is-danger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: exitT }}
                transition={{ duration: 0.15, ease }}
                title={dockerRows ? `Kill all ${killable} running servers. Docker containers keep running.` : `Kill all ${killable} running servers`}
              >
                <I icon={CancelCircleIcon} size={13} />
                Kill all
              </motion.button>
            ) : null}
          </AnimatePresence>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh  Ctrl R"
            onClick={() => {
              setSpin((n) => n + 1);
              backend.scan();
            }}
            className="sp-tool"
          >
            <motion.span animate={{ rotate: spin * 360 }} transition={{ duration: 0.5, ease }} className="sp-tool-icon">
              <I icon={RefreshIcon} size={15} />
            </motion.span>
          </button>
          <Tool label={`Quit ${APP_NAME}`} onClick={() => backend.quit()} icon={ShutDownIcon} />
          <Tool
            label={view === "settings" ? "Close settings  esc" : "Settings"}
            onClick={() => showView(view === "settings" ? "list" : "settings")}
            icon={view === "settings" ? Cancel01Icon : MoreHorizontalIcon}
          />
        </div>
      </div>

      <motion.div
        className="sp-body"
        initial={false}
        animate={{ height: bodyH }}
        transition={switching ? { duration: 0.25, ease: easeInOut } : { duration: 0 }}
      >
        <div ref={bodyInner} className="sp-body-inner">
          <AnimatePresence mode="popLayout" initial={false}>
            {view === "settings" ? (
              <motion.div key="settings" className="sp-settings-frame" style={{ height: settingsH }} initial={viewIn(1)} animate={viewShown} exit={viewOut(1)} transition={{ duration: 0.2, ease }}>
                <SettingsView settings={settings} backend={backend} />
              </motion.div>
            ) : (
              <motion.div key="list" initial={viewIn(-1)} animate={viewShown} exit={viewOut(-1)} transition={{ duration: 0.2, ease }}>
      {update ? (
        <motion.div className="sp-update" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, ease }}>
          <I icon={RefreshIcon} size={13} />
          <span className="sp-truncate">
            {APP_NAME} {update.version} is available
          </span>
          <button type="button" className="sp-update-btn" disabled={update.installing} onClick={() => backend.installUpdate()}>
            {update.manual ? "Download" : update.installing ? "Updating…" : "Restart to update"}
          </button>
        </motion.div>
      ) : null}
      <div className="sp-search-wrap">
        <label className="sp-search">
          <I icon={Search01Icon} size={14} className="sp-ter" />
          <input
            ref={search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search servers"
            spellCheck={false}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear" className="sp-clear">
              ×
            </button>
          ) : (
            <Kbd>/</Kbd>
          )}
        </label>
      </div>

      <div ref={listRef} className="sp-list">
        <motion.span
          aria-hidden
          className="sp-highlight"
          initial={false}
          animate={{ y: hl.y, height: hl.h, opacity: hl.on ? 1 : 0 }}
          transition={
            hl.snap || viaKeys.current
              ? { y: { duration: 0 }, height: { duration: 0 }, opacity: { duration: viaKeys.current ? 0 : 0.08 } }
              : { y: hover, height: hover, opacity: { duration: 0.08 } }
          }
        />
        {error ? (
          <StateCard
            icon={<I icon={Alert02Icon} size={17} />}
            title="Scan failed"
            text={error}
            action={
              <button type="button" onClick={() => backend.scan()} className="sp-solid-btn">
                Try again
              </button>
            }
          />
        ) : state.entries.length === 0 && state.isScanning ? (
          <StateCard icon={<span className="sp-spinner" />} title="Looking for dev servers…" />
        ) : state.entries.length === 0 ? (
          <StateCard icon={<Spark size={17} />} title="No dev servers running" text="Start one in any terminal and it appears here." />
        ) : ordered.length === 0 ? (
          <div className="sp-nomatch">No server matches “{query}”.</div>
        ) : (
          <>
            {pinned.length ? <div className="sp-section">Pinned</div> : null}
            <AnimatePresence initial={false} onExitComplete={() => setSettled((n) => n + 1)}>
              {pinned.map(row)}
            </AnimatePresence>
            {running.length ? <div className="sp-section">{pinned.length ? "Running" : "All servers"}</div> : null}
            <AnimatePresence initial={false} onExitComplete={() => setSettled((n) => n + 1)}>
              {running.map(row)}
            </AnimatePresence>
          </>
        )}
      </div>

      <div className={`sp-expand ${settings.showDiagnostics ? "is-open" : ""}`} aria-hidden={!settings.showDiagnostics}>
        <div className="sp-expand-inner">
          <div className="sp-diag">
            <div className="sp-diag-line">
              <span>
                {state.diagnostics?.dataSource ?? "—"} · {state.entries.length} ports · {state.diagnostics?.durationMs ?? 0}ms
              </span>
              <span>
                {shared} shared · every {settings.refreshIntervalSeconds}s
              </span>
            </div>
            {selected ? (
              <>
                <div className="sp-diag-line">
                  <span>process</span>
                  <span className="sp-truncate">
                    {selected.container ? `container ${selected.container.id.slice(0, 12)} · ${selected.container.image}` : `${selected.processName} · pid ${selected.pid}`}
                  </span>
                </div>
                <div className="sp-diag-line">
                  <span>cwd</span>
                  <span className="sp-truncate" title={selected.cwd ?? ""}>
                    {selected.cwd ?? "—"}
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      <AnimatePresence>{showInstall ? <InstallSheet key="install" onCopy={(t) => backend.copy(t)} onClose={closeInstall} /> : null}</AnimatePresence>

      <AnimatePresence>
        {menu && menuEntry ? (
          <div key="menu" className="sp-menu-anchor" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            <Menu entry={menuEntry} up={menu.up} maxHeight={menu.maxHeight} onPick={pick} />
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
