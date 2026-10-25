# Roulette

> Every localhost, in one place.

Roulette lives in your menu bar (the system tray on Windows) and finds every
development server running on your machine. Each one shows its project, git
branch, port and uptime, and you can open it, kill it, rename it, pin it or
share it with a public link, without opening a terminal.

**Website:** [roulette.nexvyn.dev](https://roulette.nexvyn.dev)

## Apps

| App | Stack | Location | Status |
|-----|-------|----------|--------|
| **Tauri** | Tauri 2 + Rust + React + TypeScript | `apps/tauri/` | **The Roulette app.** Built, released and maintained. |
| Electron | Electron + React + TypeScript | `apps/electron/` | The first version. Kept for reference, not built or released. |
| Website | Next.js + React + Tailwind CSS | `apps/website/` | [roulette.nexvyn.dev](https://roulette.nexvyn.dev) |

### Why there are two apps

Roulette started as an Electron app, the first desktop app I built. Electron
bundles a whole copy of Chromium, so its installer came out at around 150 MB.
I rebuilt the app in Tauri, which uses the system's own webview and a Rust
backend, and the installer dropped to a few megabytes with the same features.

From here on, **only the Tauri app is built, released and maintained**.
Downloads on the website and on GitHub Releases are Tauri builds. The Electron
app stays in `apps/electron/` as it was, so you can see where Roulette started,
but it gets no new features or releases.

## Features

- Finds running dev servers on macOS (`lsof`), Windows (`netstat`) and Linux (`ss`)
- Shows the project folder, git branch, port and uptime, with the framework's logo on each row
- Open in the browser, kill one server or all of them, copy the URL or port
- Rename and pin servers; both are kept across restarts
- Share any server through a Cloudflare Quick Tunnel: a public `trycloudflare.com` link, no account needed (uses your own `cloudflared`)
- Search with `/`, move with the arrow keys, open with `Enter`, kill with `Backspace`
- Settings: launch at login, sort order, rescan interval, diagnostics
- Follows the system light or dark theme
- On macOS it stays in the menu bar only, with no Dock icon

## Development

Every app uses **pnpm**.

### Tauri (requires the Rust toolchain)

```bash
cd apps/tauri
pnpm install
pnpm tauri dev
```

### Website

```bash
cd apps/website
pnpm install
pnpm dev
```

### Electron (first version, not maintained)

```bash
cd apps/electron
pnpm install
pnpm dev
```

## Building

Only the Tauri app is built for release:

```bash
cd apps/tauri
pnpm tauri build
```

Installers land in `apps/tauri/src-tauri/target/release/bundle/`. A macOS build has to be made on a Mac.

## License

[MIT](LICENSE)
