import * as React from "react";
import type { ComponentType } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSkill } from "./hooks/useSkill";
import { AgentChat } from "./components/core/AgentChat";
import { PlanTracker } from "./components/core/PlanTracker";
import { FindingsPanel } from "./components/core/FindingsPanel";
import { SplitPane } from "./components/layout/SplitPane";
import { TabGroup } from "./components/layout/TabGroup";
import { DiffViewer } from "./components/coding/DiffViewer";
import { TerminalLog } from "./components/coding/TerminalLog";
import { TestResultsPanel } from "./components/coding/TestResultsPanel";
import { FileBrowser } from "./components/coding/FileBrowser";
import { DocumentViewer } from "./components/research/DocumentViewer";
import { AgentFleetDashboard } from "./components/ops/AgentFleetDashboard";
import { DeploymentPipeline } from "./components/ops/DeploymentPipeline";
import { HealthMonitor } from "./components/ops/HealthMonitor";
import { QueryExplorer } from "./components/data/QueryExplorer";
import { ChartVisualization } from "./components/data/ChartVisualization";
import { DesignPreview } from "./components/design/DesignPreview";

/**
 * Generated skill UIs are compiled without imports; they resolve React and
 * the component catalog through window.__REK (see app/sidecar/generator.ts
 * KIT_HEADER). The names here must match the sidecar's CATALOG.
 */
export function installKit() {
  (window as any).__REK = {
    React,
    kit: {
      AgentChat,
      PlanTracker,
      FindingsPanel,
      SplitPane,
      DiffViewer,
      TerminalLog,
      TestResultsPanel,
      FileBrowser,
      DocumentViewer,
      AgentFleetDashboard,
      DeploymentPipeline,
      HealthMonitor,
      QueryExplorer,
      ChartVisualization,
      DesignPreview,
      TabGroup,
      useSkill,
    },
  };
}

export type GeneratedApp = ComponentType<{ skillId: string }>;

export async function importGeneratedApp(code: string): Promise<GeneratedApp> {
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod.default !== "function") {
      throw new Error("generated module has no component default export");
    }
    return mod.default as GeneratedApp;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface GenomeTokens {
  accent?: string;
  density?: string;
  surface?: string;
}

// Valid Radix Themes accent colors; genome tokens.accent is clamped to these.
const RADIX_ACCENTS = new Set([
  "gray", "gold", "bronze", "brown", "yellow", "amber", "orange", "tomato", "red",
  "ruby", "crimson", "pink", "plum", "purple", "violet", "iris", "indigo", "blue",
  "cyan", "teal", "jade", "green", "grass", "lime", "mint", "sky",
]);

// Returns a valid Radix accent for a skill's token, or undefined so the
// window inherits the app's base accent (jade) rather than forcing one.
export function radixAccent(token?: string): string | undefined {
  return token && RADIX_ACCENTS.has(token) ? token : undefined;
}

// Distinct accents for per-skill identity (avoid gray; visually separable).
const IDENTITY_ACCENTS = [
  "jade", "indigo", "iris", "cyan", "crimson", "amber", "grass", "violet",
  "sky", "orange", "plum", "teal", "ruby", "gold", "tomato", "blue", "purple", "lime",
];

/**
 * Deterministic accent for a skill, so every skill window has its own color
 * even before/without a genome. Stable per skillId.
 */
export function accentForSkill(skillId: string): string {
  let h = 0;
  for (let i = 0; i < skillId.length; i++) h = (h * 31 + skillId.charCodeAt(i)) >>> 0;
  return IDENTITY_ACCENTS[h % IDENTITY_ACCENTS.length]!;
}

/** Human-readable skill name from an id ("gstack-review" → "Review", "helion:tpu" → "tpu"). */
export function humanizeSkill(skillId: string): string {
  const base = skillId.split(":").pop() ?? skillId;
  const stripped = base.replace(/^gstack-/, "");
  return stripped
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function loadGeneratedApp(
  skillId: string
): Promise<{ app: GeneratedApp; tokens: GenomeTokens | null } | null> {
  const res = await invoke<{ ok: boolean; code?: string; tokens?: GenomeTokens | null }>(
    "load_ui",
    { skillId }
  );
  if (!res.ok || !res.code) return null;
  return { app: await importGeneratedApp(res.code), tokens: res.tokens ?? null };
}

export async function generateApp(skillId: string): Promise<GeneratedApp> {
  const res = await invoke<{ ok: boolean; code?: string; error?: string }>(
    "generate_ui",
    { skillId }
  );
  if (!res.ok || !res.code) {
    throw new Error(res.error || "generation failed");
  }
  return importGeneratedApp(res.code);
}
