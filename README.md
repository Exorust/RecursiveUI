# RecursiveUI

**Purpose-built, self-evolving UIs for AI agent skills.**

RecursiveUI is a macOS menu-bar app that gives every AI agent skill its own
native window with a UI generated *for that skill* — and then improves that UI
over time based on how it actually gets used.

Most agent tools render the same generic chat panel no matter what the agent is
doing. A code review, a deployment, a research dig, and a design audit are very
different tasks, and they deserve different surfaces. RecursiveUI generates a
distinct layout per skill, renders it from real components, and evolves it.

> Status: early and experimental. Built as a research project on top of
> [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) and Radix
> Themes. Expect rough edges.

---

## How it works

Each skill's UI is produced through a typed pipeline rather than free-form code
generation:

```
SKILL.md ─▶ manifest ─▶ Layout Genome (JSON IR) ─▶ TSX ─▶ compiled ESM ─▶ window
                              │                                    │
                         validated                          git-versioned in
                         + scored                            ~/.recursiveui
```

1. **Discovery** classifies each skill (coding, ops, content, planning, …).
2. **Generation** asks the model for a **Layout Genome** — a small typed JSON IR
   describing a tree of `split` / `stack` / `tabs` / `grid` nodes, the
   components bound to each slot, routing rules for where agent events land, and
   design tokens (per-skill accent + density). The genome is *validated* before
   anything renders.
3. **Render + compile** turns the genome into TSX and compiles it with Bun's
   transpiler. Generated code is import-free; it binds to the SDK component
   catalog through a runtime kit (`window.__REK`).
4. **Evolution** records how panels are used in a routing/telemetry ledger
   (`bun:sqlite`), scores the layout, and mutates the genome — resizing, pruning
   dead panels, or asking the model for a targeted fix — keeping every version
   as a git commit in `~/.recursiveui`.

A **Studio** window acts as a remote control: pick a skill, RecursiveUI opens
that skill's UI in its own window, and edits you make in the Studio live-sync
into the open window.

## Architecture

```
recursiveui/
├── app/                  Tauri v2 desktop app
│   ├── src/              React 19 + Vite frontend (tray UI, Studio, skill windows)
│   ├── src-tauri/        Rust backend (tray, windows, IPC, sidecar supervision)
│   └── sidecar/          Bun sidecar: discovery, genome, generation, evolution, telemetry
└── packages/
    └── sdk/              @recursiveui/sdk — components, hooks, and the runtime kit
```

- **Frontend** — React 19 + Vite, themed with [Radix Themes](https://www.radix-ui.com/).
- **Backend** — Rust + Tauri v2: dynamic tray, one `WebviewWindow` per skill, IPC bridge.
- **Sidecar** — a Bun process running Pi, which does generation and evolution.

## The SDK

`@recursiveui/sdk` is the component layer skill UIs are built from — a catalog of
React components grouped into packs (core, coding, ops, data, research, design,
layout) plus hooks that bridge a UI to the running skill:

- `useSkill`, `useSkillMeta`, `useSession`, `useTelemetry`, `useEvolution`, `useModel`
- Components such as `AgentChat`, `DiffViewer`, `TerminalLog`, `TestResultsPanel`,
  `DeploymentPipeline`, `HealthMonitor`, `QueryExplorer`, `ChartVisualization`,
  `DocumentViewer`, and layout primitives (`SplitPane`, `TabGroup`).

It's consumed as source inside this workspace during development and is intended
to be published to npm so community skill UIs can install it.

## Getting started

**Prerequisites**

- macOS
- [Bun](https://bun.sh) (runs the sidecar)
- [Rust](https://www.rust-lang.org/tools/install) + Xcode CLT (builds the Tauri app)
- Node.js + npm (workspace tooling / Vite)
- A Pi auth session at `~/.pi/agent/auth.json` (the sidecar uses your existing
  Pi / Claude login to generate and evolve UIs)

**Run it**

```bash
# from the repo root
npm install

# launch the desktop app in dev mode
cd app
npm run tauri dev
```

The app installs into the macOS menu bar. Click the tray icon to browse skills;
opening one generates (or loads) its UI in a dedicated window. Generated genomes,
compiled bundles, and telemetry live under `~/.recursiveui`.

## License

[MIT](./LICENSE) © 2026 Chandrahas Aroori
