import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { buildGenerationPrompt, CATALOG } from "./catalog";
import { parseSkillManifest } from "./skill-manifest";
import { renderGenome, validateGenome, skillAccent, densityForCategory, type LayoutGenome } from "./genome";
import { classify } from "./discovery";
import { provenPatterns } from "./telemetry";

// Slice 4.5: layout moves confirmed on past skills become generation priors —
// evolution improves generation. Empty until the loop confirms patterns.
function patternPriors(): string {
  const proven = provenPatterns();
  if (proven.length === 0) return "";
  const lines = proven
    .map((p) => `- ${p.move_class} (${(p.confidence * 100) | 0}% confirmed): ${p.last_rationale ?? ""}`)
    .join("\n");
  return `\n\n## Layout patterns proven on other skills (prefer these)\n${lines}`;
}

/*
 * Generation pipeline (Slice 2):
 *
 *   SKILL.md ──parse──► manifest ──prompt──► Pi session (no tools, no skills)
 *        │                                        │
 *        │                                  ```tsx fence
 *        │                                        │
 *        ▼                                        ▼
 *   ~/.recursiveui/components/apps/<id>.tsx ◄── extract
 *                                                 │
 *                                        prepend kit header,
 *                                        Bun.Transpiler tsx→js
 *                                                 │  (1 retry with error)
 *                                                 ▼
 *   ~/.recursiveui/compiled/<id>.js ◄──────── compiled ESM
 */

const REK_DIR = join(homedir(), ".recursiveui");
const APPS_DIR = join(REK_DIR, "components", "apps");
const COMPILED_DIR = join(REK_DIR, "compiled");

// Generated code has no imports; the host window provides everything.
const KIT_HEADER = `const React = window.__REK.React;
const { ${CATALOG.map((c) => c.name).join(", ")}, TabGroup, useSkill } = window.__REK.kit;
const { useState, useEffect, useMemo, useRef, useCallback } = React;
`;

const transpiler = new Bun.Transpiler({
  loader: "tsx",
  tsconfig: { compilerOptions: { jsx: "react" } },
});

export interface GenerateResult {
  ok: boolean;
  code?: string;
  tsx?: string;
  error?: string;
}

export interface GenerationProgress {
  phase: string;
  /** Cumulative thinking stream from the generation model */
  thinking?: string;
  /** Cumulative visible output (usually the code being written) */
  text?: string;
  /** One-line human-readable detail for the phase */
  detail?: string;
}

export type OnProgress = (update: GenerationProgress) => void;

// --- Git versioning: every generation/modification is a commit in ~/.recursiveui ---

const GIT = ["git", "-c", "user.name=recursiveui", "-c", "user.email=recursiveui@local"];

async function git(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const proc = Bun.spawn([...GIT, ...args], {
    cwd: REK_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout };
}

async function ensureRepo() {
  mkdirSync(REK_DIR, { recursive: true });
  if (!existsSync(join(REK_DIR, ".git"))) {
    await git(["init"]);
  }
}

async function commitUi(skillId: string, message: string) {
  await ensureRepo();
  await git(["add", "-A"]);
  // No-op when nothing changed; that's fine
  await git(["commit", "-m", `${skillId}: ${message}`]);
}

export interface UiVersion {
  hash: string;
  message: string;
}

export async function listUiVersions(skillId: string): Promise<UiVersion[]> {
  await ensureRepo();
  const rel = join("components", "apps", `${uiFileName(skillId)}.tsx`);
  const { ok, stdout } = await git(["log", "--format=%H%x09%s", "--", rel]);
  if (!ok) return [];
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash = "", ...rest] = line.split("\t");
      return { hash, message: rest.join("\t") };
    });
}

export async function revertUi(skillId: string, hash: string): Promise<GenerateResult> {
  const rel = join("components", "apps", `${uiFileName(skillId)}.tsx`);
  const { ok, stdout } = await git(["show", `${hash}:${rel}`]);
  if (!ok) return { ok: false, error: `version ${hash.slice(0, 8)} not found` };

  const { code, error } = compile(stdout);
  if (!code) return { ok: false, error: `reverted source no longer compiles: ${error}` };

  await Bun.write(tsxPathFor(skillId), stdout);
  await Bun.write(compiledPath(skillId), code);
  await commitUi(skillId, `revert to ${hash.slice(0, 8)}`);
  return { ok: true, code, tsx: stdout };
}

// Namespaced ids ("helion:tpu") must be filesystem- and git-path-safe
function uiFileName(skillId: string): string {
  return skillId.replace(/[^a-zA-Z0-9_.-]/g, "__");
}

export function compiledPath(skillId: string): string {
  return join(COMPILED_DIR, `${uiFileName(skillId)}.js`);
}

function tsxPathFor(skillId: string): string {
  return join(APPS_DIR, `${uiFileName(skillId)}.tsx`);
}

function genomePathFor(skillId: string): string {
  return join(APPS_DIR, `${uiFileName(skillId)}.genome.json`);
}

/** Load a skill's genome (the source of truth). Null for legacy raw-TSX skills. */
export function loadGenome(skillId: string): LayoutGenome | null {
  const p = genomePathFor(skillId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LayoutGenome;
  } catch {
    return null;
  }
}

function extractGenome(text: string): LayoutGenome | null {
  let raw =
    text.match(/```json\n([\s\S]*?)```/)?.[1] ?? text.match(/```\n([\s\S]*?)```/)?.[1];
  if (!raw) {
    // Bare object fallback
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) raw = text.slice(start, end + 1);
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim()) as LayoutGenome;
  } catch {
    return null;
  }
}

// Render a genome, compile it, and persist genome + tsx + js together.
export async function commitGenome(
  skillId: string,
  genome: LayoutGenome,
  message: string
): Promise<{ ok: boolean; code?: string; tsx?: string; error?: string }> {
  const { tsx } = renderGenome(genome);
  const { code, error } = compile(tsx);
  if (!code) return { ok: false, error: error || "render compiled to nothing" };
  await Bun.write(genomePathFor(skillId), JSON.stringify(genome, null, 2));
  await Bun.write(tsxPathFor(skillId), tsx);
  await Bun.write(compiledPath(skillId), code);
  await commitUi(skillId, message);
  return { ok: true, code, tsx };
}

export async function loadCompiledUi(skillId: string): Promise<string | null> {
  const path = compiledPath(skillId);
  if (!existsSync(path)) return null;
  return Bun.file(path).text();
}

function extractTsx(text: string): string | null {
  const fence = text.match(/```tsx\n([\s\S]*?)```/)?.[1];
  if (fence) return fence.trim();
  // Lenient: any code fence containing the required export
  const any = text.match(/```\w*\n([\s\S]*?)```/)?.[1];
  if (any?.includes("export default function SkillApp")) {
    return any.trim();
  }
  return null;
}

export function compile(tsx: string): { code?: string; error?: string } {
  try {
    const js = transpiler.transformSync(KIT_HEADER + tsx);
    if (!js.includes("export default")) {
      return { error: "compiled output has no default export" };
    }
    return { code: js };
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

async function runGenerationPrompt(
  prompt: string,
  onProgress: OnProgress
): Promise<string> {
  const loader = new DefaultResourceLoader({
    cwd: REK_DIR,
    agentDir: getAgentDir(),
    noSkills: true,
    noExtensions: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: REK_DIR,
    resourceLoader: loader,
    noTools: "all",
  });

  try {
    let lastText = "";
    let lastThinking = "";
    let lastEmit = 0;
    const done = new Promise<void>((resolve) => {
      session.subscribe((event: AgentSessionEvent) => {
        if (event.type === "message_update") {
          const content = (event as any).message?.content;
          if (Array.isArray(content)) {
            const text = content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("");
            const thinking = content
              .filter((b: any) => b.type === "thinking" && !b.redacted)
              .map((b: any) => b.thinking)
              .join("");
            if (text) lastText = text;
            if (thinking) lastThinking = thinking;
          } else if (typeof content === "string" && content) {
            lastText = content;
          }
          // Streams are cumulative; cap emission rate so stdout stays light
          const now = Date.now();
          if (now - lastEmit > 250) {
            lastEmit = now;
            onProgress({ phase: "generating", thinking: lastThinking, text: lastText });
          }
        }
        if (event.type === "agent_end") resolve();
      });
    });
    await session.prompt(prompt);
    await done;
    onProgress({ phase: "generating", thinking: lastThinking, text: lastText });
    return lastText;
  } finally {
    session.dispose();
  }
}

export async function generateUi(
  skillId: string,
  onProgress: OnProgress
): Promise<GenerateResult> {
  const manifest = await parseSkillManifest(skillId);
  if (!manifest) {
    return { ok: false, error: `no SKILL.md found for ${skillId}` };
  }

  mkdirSync(APPS_DIR, { recursive: true });
  mkdirSync(COMPILED_DIR, { recursive: true });

  const category = classify(skillId, manifest.name, manifest.description);
  const sectionCount = manifest.sections.filter((s) => s.summary).length;
  onProgress({
    phase: "planning",
    detail: `Read ${manifest.name} (${category}): ${sectionCount} sections; ${category}-archetype layout`,
  });
  onProgress({ phase: "prompting", detail: "asking the model for a layout genome" });
  const priors = patternPriors();
  let prompt = buildGenerationPrompt(manifest, category) + priors;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const responseText = await runGenerationPrompt(prompt, onProgress);
    const genome = extractGenome(responseText);
    if (!genome) {
      lastError = "no json genome in model output";
    } else {
      // Force provenance + deterministic per-skill identity tokens (so every
      // skill's window has its own accent, regardless of what the model emitted)
      genome.skill = skillId;
      genome.genomeVersion = "1";
      genome.source = "generated";
      genome.tokens = { accent: skillAccent(skillId), density: densityForCategory(category) };
      const verrs = validateGenome(genome);
      if (verrs.length) {
        lastError = "invalid genome: " + verrs.join("; ");
      } else {
        onProgress({ phase: "compiling", detail: "rendering genome → tsx" });
        const res = await commitGenome(skillId, genome, "generated UI (genome)");
        if (res.ok) {
          onProgress({ phase: "done" });
          return { ok: true, code: res.code, tsx: res.tsx };
        }
        lastError = res.error || "unknown compile error";
      }
    }
    onProgress({ phase: "retrying", detail: lastError });
    prompt =
      buildGenerationPrompt(manifest) +
      `\n\nYour previous attempt produced an invalid genome: ${lastError}\nFix it and output one corrected \`\`\`json genome fence.`;
  }

  onProgress({ phase: "error", detail: lastError });
  return { ok: false, error: lastError };
}

/**
 * Studio chat-to-modify loop. Genome-first: mutate the JSON genome and
 * re-render. Falls back to legacy TSX-rewrite for pre-genome skills.
 */
export async function modifyUi(
  skillId: string,
  instruction: string,
  onProgress: OnProgress
): Promise<GenerateResult> {
  const genome = loadGenome(skillId);
  if (genome) return modifyGenome(skillId, genome, instruction, onProgress);
  return modifyLegacyTsx(skillId, instruction, onProgress);
}

async function modifyGenome(
  skillId: string,
  current: LayoutGenome,
  instruction: string,
  onProgress: OnProgress
): Promise<GenerateResult> {
  const manifest = await parseSkillManifest(skillId);
  const basePrompt = `You are modifying an existing AI agent skill window, expressed as a layout genome.

## Current genome

\`\`\`json
${JSON.stringify(current, null, 2)}
\`\`\`

## User's modification request

${instruction}

## Requirements

1. Output the COMPLETE modified genome, nothing else, in one \`\`\`json fence.
2. Compose only from these components: ${CATALOG.map((c) => c.name).join(", ")}.
3. Keep the schema: tree (split-h/split-v/stack + slot refs), slots map, routing with a terminal fallback. Every slot in the tree must be defined and vice-versa.
4. Apply the request with the smallest sensible change; do not redesign unrelated parts. Prefer a slot param or defaultState change over restructuring when it satisfies the request.
${manifest ? `\nFor context, the skill is "${manifest.name}": ${manifest.description}` : ""}`;

  onProgress({ phase: "prompting", detail: `applying: ${instruction.slice(0, 60)}` });
  let prompt = basePrompt;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const responseText = await runGenerationPrompt(prompt, onProgress);
    const next = extractGenome(responseText);
    if (!next) {
      lastError = "no json genome in model output";
    } else {
      next.skill = skillId;
      next.genomeVersion = "1";
      next.source = "studio";
      const verrs = validateGenome(next);
      if (verrs.length) {
        lastError = "invalid genome: " + verrs.join("; ");
      } else {
        onProgress({ phase: "compiling", detail: "rendering genome → tsx" });
        const res = await commitGenome(skillId, next, instruction.slice(0, 72));
        if (res.ok) {
          onProgress({ phase: "done" });
          return { ok: true, code: res.code, tsx: res.tsx };
        }
        lastError = res.error || "unknown compile error";
      }
    }
    onProgress({ phase: "retrying", detail: lastError });
    prompt =
      basePrompt +
      `\n\nYour previous attempt produced an invalid genome: ${lastError}\nFix it and output one corrected \`\`\`json genome fence.`;
  }

  onProgress({ phase: "error", detail: lastError });
  return { ok: false, error: lastError };
}

// Legacy path for skills generated before genomes existed (raw TSX rewrite).
async function modifyLegacyTsx(
  skillId: string,
  instruction: string,
  onProgress: OnProgress
): Promise<GenerateResult> {
  const tsxPath = tsxPathFor(skillId);
  if (!existsSync(tsxPath)) {
    return { ok: false, error: "no generated UI to modify — generate one first" };
  }
  const currentTsx = await Bun.file(tsxPath).text();
  const manifest = await parseSkillManifest(skillId);

  const basePrompt = `You are modifying an existing React UI layout for an AI agent skill window.

## Current component source

\`\`\`tsx
${currentTsx}
\`\`\`

## User's modification request

${instruction}

## Hard requirements

1. Output the COMPLETE modified component, nothing else, in one \`\`\`tsx code fence.
2. NO import statements. React (React.useState etc.) and these components are in scope: ${CATALOG.map((c) => c.name).join(", ")}, plus useSkill(skillId).
3. Keep: export default function SkillApp({ skillId }: { skillId: string })
4. Apply the user's request with the smallest sensible change; do not redesign unrelated parts.
${manifest ? `\nFor context, the skill is "${manifest.name}": ${manifest.description}` : ""}`;

  onProgress({ phase: "prompting", detail: `applying: ${instruction.slice(0, 60)}` });
  let prompt = basePrompt;
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const responseText = await runGenerationPrompt(prompt, onProgress);
    const tsx = extractTsx(responseText);
    if (!tsx) {
      lastError = "no tsx code fence in model output";
    } else {
      onProgress({ phase: "compiling", detail: "transpiling tsx" });
      const { code, error } = compile(tsx);
      if (code) {
        await Bun.write(tsxPath, tsx);
        await Bun.write(compiledPath(skillId), code);
        await commitUi(skillId, instruction.slice(0, 72));
        onProgress({ phase: "done" });
        return { ok: true, code, tsx };
      }
      lastError = error || "unknown compile error";
    }
    onProgress({ phase: "retrying", detail: lastError });
    prompt =
      basePrompt +
      `\n\nYour previous attempt failed with: ${lastError}\nFix the issue and output the corrected component in a \`\`\`tsx fence.`;
  }

  onProgress({ phase: "error", detail: lastError });
  return { ok: false, error: lastError };
}

/**
 * Slice 4.4: ask the LLM to mutate a genome to catch a fallback payload class
 * (a missing-affordance brief). Returns candidate genomes; the caller scores
 * them by trace replay and ships only positive-delta winners.
 */
export async function llmMutateGenome(
  genome: LayoutGenome,
  brief: string
): Promise<LayoutGenome[]> {
  const prompt = `You are improving an AI agent skill window, expressed as a layout genome.

## Current genome
\`\`\`json
${JSON.stringify(genome, null, 2)}
\`\`\`

## Problem to fix (from usage telemetry)
${brief}

## Task
Propose the SMALLEST genome change that gives the unrouted output a home — either
add a slot for a catalog component that fits this payload, or re-route an existing
rule. Compose only from: ${CATALOG.map((c) => c.name).join(", ")}.
Keep the schema (tree of split-h/split-v/stack + slot refs; slots map; routing with
a terminal fallback). Every slot in the tree must be defined and vice-versa.
Output ONE \`\`\`json fence with the complete modified genome — no prose.`;

  const responseText = await runGenerationPrompt(prompt, () => {});
  const candidate = extractGenome(responseText);
  if (!candidate) return [];
  candidate.skill = genome.skill;
  candidate.genomeVersion = "1";
  candidate.source = "evolved";
  return validateGenome(candidate).length === 0 ? [candidate] : [];
}

/** Sequential batch generation; per-skill progress via onPhase(skillId, phase). */
export async function batchGenerate(
  skillIds: string[],
  onProgress: (skillId: string, update: GenerationProgress) => void
): Promise<{ generated: string[]; failed: { skillId: string; error: string }[] }> {
  const generated: string[] = [];
  const failed: { skillId: string; error: string }[] = [];
  for (const skillId of skillIds) {
    if (existsSync(compiledPath(skillId))) {
      onProgress(skillId, { phase: "skipped" });
      continue;
    }
    const result = await generateUi(skillId, (update) => onProgress(skillId, update));
    if (result.ok) generated.push(skillId);
    else failed.push({ skillId, error: result.error || "unknown" });
  }
  return { generated, failed };
}
