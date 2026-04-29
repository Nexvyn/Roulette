# Lyra — Tauri

The lightweight build of Lyra. Built with Tauri 2, Rust, React, and TypeScript.

**Why Tauri?** The Electron build works great but ships at ~150 MB. The Tauri build uses a native Rust backend and the OS webview instead of bundling Chromium, bringing the installer down to ~5–10 MB. Same features, fraction of the size.

## Run (requires Rust toolchain)

```bash
npm install
npm run dev          # frontend only (Vite)
cargo tauri dev      # full app with Rust backend
```

## Build

```bash
cargo tauri build    # produces installer in src-tauri/target/release/bundle/
```

## Typecheck (frontend)

```bash
npx tsc --noEmit
```

## Structure

```
src/              — React UI (App.tsx, styles.css, main.tsx)
src-tauri/
  src/            — Rust backend (main.rs, store.rs, port_scanner.rs, settings.rs)
  tauri.conf.json — window, tray, bundle config
  Cargo.toml      — Rust dependencies
```
