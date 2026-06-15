<div align="center">

<img src="recursiveui-header.png" alt="RecursiveUI" width="700">

**Every AI agent skill deserves its own UI. RecursiveUI generates one, then evolves it based on how you use it.**

[![GitHub stars](https://img.shields.io/github/stars/Exorust/RecursiveUI?style=social)](https://github.com/Exorust/RecursiveUI)
[![Status](https://img.shields.io/badge/status-early%20%26%20experimental-8b5cf6)](https://github.com/Exorust/RecursiveUI)
[![Built with Pi](https://img.shields.io/badge/built%20with-Pi-6366f1)](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

[Follow me on Twitter](https://twitter.com/charoori_ai) | [Design Doc](.plans/design-doc.md) | [Adaptation Design](.plans/adaptation-design.md) | [Send Feedback](mailto:chandrahas.aroori@gmail.com?subject=RecursiveUI%20Feedback)

</div>

---

Most "generative UI" systems generate **once**. Most adaptive UI research adapts **within a fixed design space**. Nobody lets the generator rewrite the design space itself from observed use. That's the gap.

RecursiveUI sits at the intersection of three fields that haven't been combined:

| Field | What it solved | What RecursiveUI borrows |
|---|---|---|
| Generative UI (v0, AI SDK) | Produce UI from a prompt | Generation pipeline: skill definition &rarr; layout genome &rarr; compiled window |
| Adaptive interfaces (SUPPLE, website morphing) | Reshape UI to fit a user | Counterfactual trace replay as an offline evaluator (no A/B traffic needed) |
| LLM-driven evolution (FunSearch, AlphaEvolve) | Improve programs via LLM mutation + automatic evaluation | Every evolution is a registered, falsifiable hypothesis &mdash; confirmed or reverted |

> **The critical constraint: N=1.** Every adaptive system that worked had millions of users. RecursiveUI has one user and ~60 skills. The mechanisms we chose &mdash; within-subject time series, pairwise preference prompts, trace replay, and treating skills as a population where validated patterns become priors &mdash; are specifically selected to survive that translation.

## How it works

```
SKILL.md ─▶ manifest ─▶ Layout Genome (JSON IR) ─▶ TSX ─▶ compiled ESM ─▶ window
                              │                                    │
                         validated                           git-versioned
                         + scored                          (~/.recursiveui)
```

1. **Discovery** scans your machine for skills (Claude Code, Pi, OpenClaw) and classifies each one.
2. **Generation** produces a Layout Genome &mdash; a typed JSON IR describing layout tree, component bindings, event routing, and design tokens. Validated before anything renders.
3. **Compilation** turns the genome into TSX, compiled import-free via Bun. Components bind through a runtime kit (`window.__REK`).
4. **Evolution** records how panels are used, scores the layout against replayed action traces, and mutates the genome &mdash; every version a git commit.

A **Studio** window lets you chat-modify any skill's UI with live preview. Edits sync into the open skill window in real time.

## Architecture

```
recursiveui/
├── app/                  Tauri v2 desktop app (macOS menu bar)
│   ├── src/              React 19 + Vite frontend
│   ├── src-tauri/        Rust backend (tray, windows, IPC)
│   └── sidecar/          Bun sidecar (Pi sessions, generation, evolution)
└── packages/
    └── sdk/              @recursiveui/sdk — components, hooks, runtime kit
```

The SDK (`@recursiveui/sdk`) ships 20 components across 7 packs plus 6 hooks. The generation engine composes from this catalog; community authors import from it directly.

<details>
<summary><strong>SDK components &amp; hooks</strong></summary>

| Pack | Components |
|---|---|
| Core | `AgentChat`, `MemoryBrowser`, `PlanTracker`, `SessionCostDashboard`, `CommunityBrowser`, `FindingsPanel` |
| Coding | `DiffViewer`, `TerminalLog`, `TestResultsPanel`, `FileBrowser` |
| Ops | `DeploymentPipeline`, `HealthMonitor`, `AgentFleetDashboard` |
| Data | `QueryExplorer`, `ChartVisualization` |
| Research | `ResearchDashboard`, `DocumentViewer` |
| Design | `DesignPreview`, `ComponentBrowserUI` |
| Layout | `SplitPane`, `TabGroup` |

**Hooks:** `useSkill` `useSession` `useTelemetry` `useEvolution` `useModel` `useSkillMeta`

</details>

## For researchers

RecursiveUI is an open platform for studying questions at the HCI &times; AI boundary:

- **Malleable interfaces at runtime.** What are the right primitives when the UI itself adapts to agent behavior? (cf. Xia's malleable software, Gajos's SUPPLE)
- **Single-user adaptation without A/B testing.** Can counterfactual trace replay + pairwise preference prompts replace population-scale experimentation?
- **Evolution guardrails.** How do you prevent reward hacking in self-modifying interfaces? (KL-penalty analog: edit-distance budget against last user-approved version)
- **Cross-skill transfer.** When a pattern validates on one skill ("user always expands terminal &rarr; auto-expand"), does it transfer to structurally similar skills?

The adaptation mechanisms are documented in [adaptation-design.md](.plans/adaptation-design.md). The component catalog and generation prompt are in [components-spec.md](.plans/components-spec.md). We're actively looking for collaborators in adaptive interfaces, end-user AI interaction, and interactive ML.

## For builders

Every AI agent skill is a potential UI:

- **3,600+ Pi packages** on npm, each one a candidate for a generated or community-built interface.
- **Community UIs** published to npm with the `recursiveui-ui` tag. Scaffold one with `npm create recursiveui-ui`.
- **Installed UIs evolve independently** &mdash; the community version is the starting point, not the final form.

## Getting started

See **[RUN_ME.md](./RUN_ME.md)** for prerequisites and running instructions.

## License

[MIT](./LICENSE) &copy; 2026 Chandrahas Aroori
