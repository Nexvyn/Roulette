# Changelog

All notable changes to Lyra will be documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [0.1.0] — 2026-04-29

### Added

**Core**
- Monorepo with Electron, Tauri, and website apps
- Tray icon with live port count badge
- Auto-detection of local dev servers on ports 1024–49151
- Supports Windows (`netstat`), macOS (`lsof`), and Linux (`ss`)
- Process info: name, project folder, git branch, uptime
- Filters out system processes (svchost, explorer, etc.)
- Docker process detection

**Actions**
- Open port in browser
- Kill a single process
- Kill all detected processes at once
- Copy URL or port number to clipboard
- Rename a port (double-click, persists across restarts)
- Pin a port (sorts to top, persists across restarts)

**UI**
- Search/filter bar (`/` to focus, `Esc` to clear)
- Sort by port, name, or uptime
- Configurable scan interval (2 / 5 / 10 / 30 seconds)
- Dark mode (follows system theme)
- Acrylic/vibrancy background on Windows and macOS
- Onboarding flow on first launch
- Diagnostics panel (scan duration, source, timestamp)

**Apps**
- **Electron** — full-featured build with Windows installer
- **Tauri** — lightweight alternative (~5–10 MB) built with Rust for users who care about bundle size
- **Website** — Next.js landing page (in progress)

**Other**
- Launch at login (Windows, macOS, Linux)
- Single-instance lock
- Settings persisted to disk
