# Lyra

> See every local dev server running on your machine, instantly.

Lyra lives in your menu bar and automatically detects every development server
running on your machine. See what's on which port, kill processes, open them in
your browser, and stay organized — without ever opening a terminal.

## Apps

| App | Stack | Location |
|-----|-------|----------|
| Electron | Electron + React + TypeScript | `apps/electron/` |
| Tauri | Tauri 2 + Rust + React + TypeScript | `apps/tauri/` |
| Website | Next.js + Bun | `apps/website/` |

## Features

- Auto-detects running dev servers (Node, Python, Go, Vite, Next.js, and more)
- Shows process name, project folder, git branch, and uptime
- Kill, open in browser, copy URL or port — one click
- Rename and pin your most-used servers
- Search and filter across all running ports
- Lightweight tray icon with live port count badge
- Dark mode support

## Development

### Electron

```bash
cd apps/electron && npm install && npm run dev
```

### Tauri (requires Rust toolchain)

```bash
cd apps/tauri && npm install && npm run dev
```

### Website

```bash
cd apps/website && bun install && bun run dev
```

## License

MIT
