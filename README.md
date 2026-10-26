# Roulette

> Every localhost, in one place.

Roulette lives in your menu bar (the system tray on Windows) and finds every
development server running on your machine. Each one shows its project, git
branch, port and uptime, and you can open it, kill it, rename it, pin it or
share it with a public link, without opening a terminal.

**Website:** [roulette.nexvyn.dev](https://roulette.nexvyn.dev)

## Apps

| App | Stack | Location | Status |
|-----|-------|----------|--------|
| **Tauri** | Tauri 2 + Rust + React + TypeScript | `apps/tauri/` | **The Roulette app.** Built, released and maintained. |
| Electron | Electron + React + TypeScript | `apps/electron/` | The first version. Kept for reference, not built or released. |
| Website | Next.js + React + Tailwind CSS | `apps/website/` | [roulette.nexvyn.dev](https://roulette.nexvyn.dev) |

### Why there are two apps

Roulette started as an Electron app, the first desktop app I built. Electron
bundles a whole copy of Chromium, so its installer came out at around 150 MB.
I rebuilt the app in Tauri, which uses the system's own webview and a Rust
backend, and the installer dropped to a few megabytes with the same features.

From here on, **only the Tauri app is built, released and maintained**.
Downloads on the website and on GitHub Releases are Tauri builds. The Electron
app stays in `apps/electron/` as it was, so you can see where Roulette started,
but it gets no new features or releases.

## Features

- Finds running dev servers on macOS (`lsof`), Windows (`netstat`) and Linux (`ss`)
- Shows the project folder, git branch, port, uptime and memory, with the framework's logo on each row
- Open in the browser, stop or restart a server, copy the URL or port. Stop ends the whole server, including the package manager that started it
- Warns when a server uses too much memory or keeps growing: amber memory, a dot on the tray icon and one notification (limit in Settings, snooze for an hour)
- Details for each server: folder, command, branch, processes, and 10 minutes of memory and CPU
- Clean up: tick the servers to stop, with idle ones and ones whose folder is gone ticked for you. Databases are never ticked for you. Forgotten servers can also be reported or stopped on their own (Settings)
- Links a server to the Claude Code or Codex session, Conductor workspace or Pane terminal that started it, and (optional) to the branch's pull request through the GitHub CLI
- Opens a server's folder in VS Code
- A memory bar splits the machine's RAM into servers, other apps and free
- `roulette list` and `roulette list --json` in a terminal, for scripts and coding agents (install it from Settings)
- Opens with a global shortcut: Ctrl Alt P, or ⌥⌘P on macOS
- Picks up Docker containers that publish a port, showing the container name, image and compose project. Stop runs `docker stop` on that container only
- Rename and pin servers; both are kept across restarts. A name belongs to its port and project, so another project on the same port starts with its own name
- Share any server through a Cloudflare Quick Tunnel: a public `trycloudflare.com` link, no account needed (uses your own `cloudflared`)
  - Links can expire on their own after 1 or 4 hours (Settings), and the row shows the time left
  - Stop Sharing ends the link at once and leaves the server running. Every share gets a new random address
- Search with `/`, move with the arrow keys, open with `Enter`, kill with `Backspace`
- Settings: launch at login, shortcut, notifications, sort order, rescan interval, memory limit, forgotten servers, link expiry, integrations, diagnostics
- Updates itself: when a new version is out, the panel offers **Restart to update** (on Linux this works for the AppImage; `.deb` and `.rpm` installs get a download link)
- Follows the system light or dark theme
- The panel opens next to the tray icon and closes when you click outside it
- On macOS it stays in the menu bar only, with no Dock icon

## Development

Every app uses **pnpm**.

### Tauri (requires the Rust toolchain)

```bash
cd apps/tauri
pnpm install
pnpm tauri dev
```

### Website

```bash
cd apps/website
pnpm install
pnpm dev
```

### Electron (first version, not maintained)

```bash
cd apps/electron
pnpm install
pnpm dev
```

## Building

Only the Tauri app is built for release:

```bash
cd apps/tauri
pnpm tauri build
```

Installers land in `apps/tauri/src-tauri/target/release/bundle/`. A macOS build has to be made on a Mac.

### Releases

The **Release** workflow (`.github/workflows/release.yml`) builds the Tauri app on GitHub for
macOS (one universal build for Apple Silicon and Intel), Windows and Linux, and attaches the
installers to a draft GitHub Release. It runs when you push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

You can also start it by hand from the repository's **Actions** tab. Check the draft release,
then publish it. Before tagging, bump the version in `apps/tauri/package.json`,
`apps/tauri/src-tauri/tauri.conf.json` and `apps/tauri/src-tauri/Cargo.toml`.

### Updates

Installed copies check `latest.json` on the newest published release, 20 seconds after launch
and then once a day. Updates are signed, so the workflow needs the signing key once:

```bash
cd apps/tauri
pnpm tauri signer generate -w ~/.tauri/roulette.key
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/roulette.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Put the public key (`~/.tauri/roulette.key.pub`) in `plugins.updater.pubkey` in `tauri.conf.json`,
and keep the private key safe: without it, installed copies can't be updated again. With the
secret set, the workflow signs every build and adds `latest.json` to the release; without it,
releases still build, just without updates. An update reaches people once its release is
published, not while it is a draft.

## License

[MIT](LICENSE)
