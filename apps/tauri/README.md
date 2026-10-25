# Roulette - Tauri

The Roulette app. Built with Tauri 2, Rust, React, and TypeScript. This is the version that's built, released and maintained; the Electron app in `apps/electron` was the first version and is kept only for reference.

**Why Tauri?** The Electron build works great but ships at ~150 MB. The Tauri build uses a native Rust backend and the OS webview instead of bundling Chromium, bringing the installer down to ~5–10 MB. Same features, fraction of the size.

## Run (requires Rust toolchain)

```bash
pnpm install
pnpm dev          # frontend only (Vite)
pnpm tauri dev    # full app with the Rust backend
```

## Build

```bash
pnpm tauri build  # produces installers in src-tauri/target/release/bundle/
```

## Typecheck (frontend)

```bash
pnpm exec tsc --noEmit
```

## Structure

```
src/              - React UI (App.tsx, styles.css, main.tsx)
src-tauri/
  src/            - Rust backend (main.rs, store.rs, port_scanner.rs, settings.rs)
  tauri.conf.json - window, tray, bundle config
  Cargo.toml      - Rust dependencies
```
