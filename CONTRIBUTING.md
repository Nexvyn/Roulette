# Contributing to Roulette

Thank you for your interest in contributing to Roulette!

## Getting Started

### Electron app

```bash
cd apps/electron
npm install
npm run dev
```

### Tauri app (requires the Rust toolchain)

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

Sharing a server needs Cloudflare's `cloudflared` on your machine (`brew install cloudflared`, `winget install --id Cloudflare.cloudflared`, or the Linux package).

## Development Guidelines

- The Electron and Tauri apps must stay feature-identical. Change both together.
- `ui/Panel.tsx` and `ui/panel.css` are the same file in both apps (`apps/electron/src/renderer/src/ui/` and `apps/tauri/src/ui/`). Edit one, copy it over the other.
- Keep `PortEntry`, `AppSettings` and `ScanState` field names identical across `apps/electron/src/shared/contracts.ts`, `apps/tauri/src/ui/types.ts` and the Rust serde structs.
- Before opening a PR:
  - `npm run typecheck` in `apps/electron/`
  - `npx tsc --noEmit` in `apps/tauri/`
  - `cargo check` and `cargo test` in `apps/tauri/src-tauri/`
  - `npx tsc --noEmit` in `apps/website/` if you touched the site

## Pull Requests

- Keep PRs focused on a single change.
- Use conventional commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`.
- Describe what you changed and why in the PR body. Add a screenshot for UI changes.

## Reporting Issues

Open an issue on GitHub with steps to reproduce, your OS, and the app version.

## License

By contributing, you agree your contributions will be licensed under the MIT License.
