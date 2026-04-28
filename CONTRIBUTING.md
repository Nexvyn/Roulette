# Contributing to Lyra

Thank you for your interest in contributing to Lyra!

## Getting Started

### Electron app

```bash
cd apps/electron
npm install
npm run dev
```

### Tauri app (requires Rust toolchain)

```bash
cd apps/tauri
npm install
npm run dev
```

### Website

```bash
cd apps/website
bun install
bun run dev
```

## Development Guidelines

- Keep `PortEntry`, `AppSettings`, and `ScanState` field names identical across `contracts.ts` and the Rust serde structs.
- Both Electron and Tauri apps must stay feature-identical. Change both together.
- Run `npm run typecheck` in `apps/electron/` before submitting a PR.
- Run `npx tsc --noEmit` in `apps/tauri/` before submitting a PR.

## Pull Requests

- Keep PRs focused on a single change.
- Use conventional commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`.
- Describe what you changed and why in the PR body.

## Reporting Issues

Open an issue on GitHub with steps to reproduce, your OS, and the app version.

## License

By contributing, you agree your contributions will be licensed under the MIT License.
