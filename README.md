# Roulette

> Every localhost, in one place.

Roulette lives in your menu bar (the system tray on Windows) and finds every
development server running on your machine. Each one shows its project, git
branch, port and uptime, and you can open it, kill it, rename it, pin it or
share it with a public link, without opening a terminal.

## Apps

| App | Stack | Location |
|-----|-------|----------|
| Electron | Electron + React + TypeScript | `apps/electron/` |
| Tauri | Tauri 2 + Rust + React + TypeScript | `apps/tauri/` |
| Website | Next.js + React + Tailwind CSS | `apps/website/` |

The Electron and Tauri apps have the same features and share the same panel UI.

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

### Electron

```bash
cd apps/electron
npm install
npm run dev
```

### Tauri (requires the Rust toolchain)

```bash
cd apps/tauri
npm install
cargo tauri dev
```

### Website

```bash
cd apps/website
npm install
npm run dev
```

## Building

- **Electron:** `npm run dist:win`, `npm run dist:mac` or `npm run dist:linux` in `apps/electron`. Installers land in `apps/electron/dist/`.
- **Tauri:** `cargo tauri build` in `apps/tauri`. Installers land in `apps/tauri/src-tauri/target/release/bundle/`.

A macOS build has to be made on a Mac.

## License

[MIT](LICENSE)
