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
  src/
    main.rs         - tray, window placement, commands
    store.rs        - app state: scans, kills, names, pins, tunnels
    port_scanner.rs - finds listening ports and their projects and branches
    docker.rs       - matches ports to Docker containers, stops containers
    tunnel.rs       - Cloudflare Quick Tunnels, link expiry
    updater.rs      - checks for updates and installs them
    settings.rs     - settings file
  tauri.conf.json         - window, tray, bundle and updater config
  tauri.updater.conf.json - turns on signed update files for release builds (used by CI)
  Cargo.toml              - Rust dependencies
```

## Tests

```bash
cd src-tauri
cargo test
```
