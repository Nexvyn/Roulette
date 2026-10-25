# Contributing to Roulette

Thank you for your interest in contributing to Roulette!

## Getting Started

Every app uses **pnpm**.

### Tauri app (requires the Rust toolchain)

This is the Roulette app that's released and maintained.

```bash
cd apps/tauri
pnpm install
pnpm tauri dev
```

### Electron app (first version, not maintained)

Kept for reference only. New features and fixes go into the Tauri app.

```bash
cd apps/electron
pnpm install
pnpm dev
```

### Website

```bash
cd apps/website
pnpm install
pnpm dev
```

Sharing a server needs Cloudflare's `cloudflared` on your machine (`brew install cloudflared`, `winget install --id Cloudflare.cloudflared`, or the Linux package).

## Development Guidelines

- New work goes into the Tauri app. The Electron app is no longer maintained, so it doesn't need matching changes.
- Keep `PortEntry`, `AppSettings` and `ScanState` field names identical between `apps/tauri/src/ui/types.ts` and the Rust serde structs.
- Before opening a PR:
  - `pnpm exec tsc --noEmit` in `apps/tauri/`
  - `cargo check` and `cargo test` in `apps/tauri/src-tauri/`
  - `pnpm exec tsc --noEmit` in `apps/website/` if you touched the site

## Pull Requests

- Keep PRs focused on a single change.
- Use conventional commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`.
- Describe what you changed and why in the PR body. Add a screenshot for UI changes.

## Reporting Issues

Open an issue on GitHub with steps to reproduce, your OS, and the app version.

## License

By contributing, you agree your contributions will be licensed under the MIT License.
