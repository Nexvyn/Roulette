# Roulette - Electron

The first version of Roulette, and the first desktop app I built. Built with Electron, React, and TypeScript.

> **Not maintained.** This app is kept for reference and is no longer built or released. Electron bundles Chromium, so the installer came out at around 150 MB; Roulette was rebuilt in Tauri (`apps/tauri`), which is the app that's released and maintained now. See the main [README](../../README.md).

Electron was chosen first because it ships fast - no extra toolchain needed, and it produces a working Windows installer out of the box.

## Run

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm dist:win   # Windows installer → dist/
pnpm dist:mac   # macOS DMG
pnpm dist:linux # Linux AppImage
```

## Typecheck

```bash
pnpm typecheck
```

## Structure

```
src/
  main/           - Electron main process, tray, IPC
    services/     - portScanner, portStore, settings, autoLaunch
  preload/        - contextBridge (window.portMenu API)
  renderer/src/   - React UI (App.tsx, styles.css)
  shared/         - contracts.ts (shared TypeScript types)
```
