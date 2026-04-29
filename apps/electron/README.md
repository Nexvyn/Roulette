# Lyra — Electron

The primary desktop build of Lyra. Built with Electron, React, and TypeScript.

Electron was chosen first because it ships fast — no extra toolchain needed, and it produces a working Windows installer out of the box.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run dist:win   # Windows installer → dist/
npm run dist:mac   # macOS DMG
npm run dist:linux # Linux AppImage
```

## Typecheck

```bash
npm run typecheck
```

## Structure

```
src/
  main/           — Electron main process, tray, IPC
    services/     — portScanner, portStore, settings, autoLaunch
  preload/        — contextBridge (window.portMenu API)
  renderer/src/   — React UI (App.tsx, styles.css)
  shared/         — contracts.ts (shared TypeScript types)
```
