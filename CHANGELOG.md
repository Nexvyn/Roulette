# Changelog

All notable changes to Roulette will be documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [0.1.2] - 2026-10-27

### Added

- Memory and CPU for each server, added up over everything the server started, next to its uptime. On Windows this is private memory, since Windows trims the working set of idle processes
- A warning when a server uses more than your limit (4 GB by default; 1, 2, 4 or 8 GB, or off) or grows by more than 500 MB in 10 minutes: the memory turns amber, the tray icon gets an amber dot and you get one notification. Snooze it for an hour from the details or the right-click menu
- Details: click a server to see its folder, command, branch, 10 minutes of memory and CPU, and its processes, with Open, Restart and Stop
- Restart reruns the server's command in the same folder with the same environment. Its output goes to a log file in the Roulette settings folder. Docker containers restart with `docker restart`
- Clean up, in place of Kill all: tick the servers to stop, with ones that sit idle or whose folder is gone ticked for you. Databases (Postgres, Redis, MongoDB, MySQL) are never ticked for you
- Forgotten servers (Settings): Off, Ask (a notification) or Automatic (stops them). Automatic never stops databases, pinned, shared or growing servers
- A global shortcut opens the panel: Ctrl Alt P, or ⌥⌘P on macOS
- Servers started by Claude Code or Codex show the session that started them; click it to copy the command that resumes the session. Conductor workspaces and Pane terminals show too, and a Pane terminal opens with a click (both are macOS apps)
- Open in VS Code, from the details or the right-click menu
- Pull request for the branch, through the GitHub CLI you're signed in to (off by default)
- `roulette list` and `roulette list --json` in a terminal, so scripts and coding agents can see what's running. Install it from Settings
- A memory bar under the list that splits the machine's RAM into servers, other apps and free

### Changed

- Stop and Kill end the whole server, including the package manager that started it (`pnpm dev` over `next-server`), on every system. A runner that also started other servers is left alone
- Kill all skips databases

---

## [0.1.1] - 2026-10-25

### Added

- Docker containers that publish a port show their container name, image and compose project. Stop runs `docker stop` on that container only, and Kill all leaves containers running
- Shared links can expire on their own after 1 or 4 hours (Settings), and the row shows the time left
- Roulette updates itself: when a new version is out, the panel offers Restart to update. On Linux this works for the AppImage; `.deb` and `.rpm` installs get a download link
- Share a server through a Cloudflare Quick Tunnel: a public `trycloudflare.com` link on the row, no account needed. The link only shows once it resolves, and it closes when you stop sharing, kill the server or quit.
- A dialog with the install command for your system when `cloudflared` isn't installed
- The framework's logo on each row (Next.js, Vite, Django, Node.js, Storybook and more), from `runeicons-brands`
- Pinned and Running sections in the list
- Hover actions on each row: Pin, Share, Open, Kill
- Settings as a view inside the panel, with native-sized switches on macOS
- A new welcome screen on first launch
- The panel opens by itself on first launch on macOS, so you can see where it lives

### Changed

- A rename belongs to its port and project, so another project started on the same port gets its own name
- Smoother animations: no blur effects, and the list and Settings swap with a short fade
- Renamed from Ports to **Roulette**
- New panel design, shared by the Electron and Tauri apps
- New app icon: the six-petal mark in black on a white tile
- macOS: the app stays in the menu bar only, with no Dock icon
- The window follows the panel's height instead of resizing on every frame, and opening Settings no longer resizes it
- Faster hover highlight and shorter, eased animations throughout; every animation respects reduced motion

### Fixed

- Windows: the panel closes when you click outside it
- Windows: no accent-coloured border around the panel
- Windows: the panel opens above an auto-hidden taskbar instead of on top of it
- The panel opens once at its final size and place, without jumping at start
- Windows: opening Settings no longer makes the panel jump; the window only resizes while it is hidden
- Settings shows all its options without scrolling, and the header is never cut off
- Linux: containers whose port is held by a root-owned `docker-proxy` are found
- The window now grows back when more servers appear
- Tauri: the tray icon no longer shows twice, and left-click toggles the panel (the menu is on right-click)
- Tauri: the tray menu matches the Electron app
- Electron: the Launch at login switch updates when changed from the tray menu
- The search field's focus ring is no longer cut off
- The panel no longer jumps between the top and bottom of the screen on macOS

### Removed

- Unused styles and the unused shell plugin in the Tauri app
- The old panel stylesheet in the Electron app

---

## [0.1.0] - 2026-04-29

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
- **Electron** - full-featured build with Windows installer
- **Tauri** - lightweight alternative (~5–10 MB) built with Rust for users who care about bundle size
- **Website** - Next.js landing page (in progress)

**Other**
- Launch at login (Windows, macOS, Linux)
- Single-instance lock
- Settings persisted to disk
