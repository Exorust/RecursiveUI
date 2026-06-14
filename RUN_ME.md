# Running RecursiveUI

## Prerequisites

| Dependency | Why | Install |
|---|---|---|
| macOS | Tauri v2 desktop app (macOS-only for now) | — |
| [Bun](https://bun.sh) | Runs the sidecar (Pi sessions, generation, evolution) | `curl -fsSL https://bun.sh/install \| bash` |
| [Rust](https://www.rust-lang.org/tools/install) + Xcode CLT | Builds the Tauri native shell | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` + `xcode-select --install` |
| Node.js + npm | Workspace tooling, Vite dev server | [nodejs.org](https://nodejs.org) or `brew install node` |
| Pi auth session | The sidecar uses your Pi / Claude login to generate and evolve UIs | Run `pi login` once — session saved at `~/.pi/agent/auth.json` |

## Quick start

```bash
# install dependencies (from repo root)
npm install

# launch the desktop app in dev mode
cd app
npm run tauri dev
```

The app installs into the macOS menu bar. Click the tray icon to browse discovered skills. Opening a skill generates (or loads) its UI in a dedicated window.

## Where things live at runtime

```
~/.recursiveui/
├── genomes/        Layout genome JSON per skill (git-versioned)
├── compiled/       Compiled ESM bundles (gitignored)
├── telemetry.db    SQLite — usage events for the evolution loop
├── config.toml     User preferences, model/provider settings
└── evolution.log   Evolution decisions + reasoning
```

## Common tasks

**Reset a skill's UI to freshly generated:**
```bash
cd ~/.recursiveui && git log --oneline -- genomes/<skill-id>.json
# find the first commit, then:
git checkout <hash> -- genomes/<skill-id>.json
```

**Regenerate all UIs:**
Click "Generate All" in the tray menu, or delete `~/.recursiveui/genomes/` and relaunch.

**Pause evolution:**
Click "Pause Evolution" in the tray menu, or set `evolution.enabled = false` in `~/.recursiveui/config.toml`.
