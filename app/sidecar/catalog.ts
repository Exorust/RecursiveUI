import type { SkillManifest } from "./skill-manifest";

/**
 * Component catalog manifest. The generation LLM composes skill UIs from
 * exactly these building blocks — they are provided at runtime via
 * `window.__REK.kit`, so generated code must NOT write import statements.
 */
export const CATALOG = [
  {
    name: "AgentChat",
    props: "{ skill: SkillHandle }",
    purpose: "conversational interface with the agent: messages, input box, steer/cancel, question cards",
    bestFor: ["conversational", "workflow", "every skill needs one somewhere"],
  },
  {
    name: "TerminalLog",
    props: "{ skill: SkillHandle }",
    purpose: "streaming list of the agent's tool executions (commands, file reads/edits) with expandable input/output",
    bestFor: ["coding", "ops", "debugging"],
  },
  {
    name: "DiffViewer",
    props: "{ skill: SkillHandle }",
    purpose: "renders unified diffs found in agent output/tool results, with per-file tabs",
    bestFor: ["code review", "refactoring", "shipping"],
  },
  {
    name: "DeploymentPipeline",
    props: "{ skill: SkillHandle }",
    purpose: "horizontal stage tracker (Review → Commit → Push → PR) driven by the agent's git/gh commands",
    bestFor: ["shipping", "deployment", "multi-stage workflows"],
  },
  {
    name: "FindingsPanel",
    props: "{ skill: SkillHandle, title?: string, emptyText?: string }",
    purpose: "live bullet list extracted from agent output; verdict glyphs (☑/⚠) for confirmed/suspect items",
    bestFor: ["investigation", "advice capture", "summaries"],
  },
  {
    name: "TestResultsPanel",
    props: "{ skill: SkillHandle }",
    purpose: "pass/fail scenario board parsed from agent output with summary counts",
    bestFor: ["QA", "testing", "verification"],
  },
  {
    name: "DocumentViewer",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "reader-style rendering of the agent's prose/markdown output (headings, lists, code)",
    bestFor: ["content writing", "research", "documentation", "editorial"],
  },
  {
    name: "PlanTracker",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "checklist/plan with progress, parsed from markdown checkboxes and numbered steps",
    bestFor: ["planning", "strategy", "multi-step workflows", "roadmaps"],
  },
  {
    name: "DesignPreview",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "visual surface: color swatches and image/preview URLs the agent emits",
    bestFor: ["design", "brand", "visual", "logo work"],
  },
  {
    name: "ChartVisualization",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "bar chart over tabular numbers (markdown tables, label:value lines)",
    bestFor: ["data", "analytics", "metrics", "reporting"],
  },
  {
    name: "FileBrowser",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "list of files the agent touched (read/edit/write), derived from tool calls",
    bestFor: ["coding", "refactoring", "file-heavy work"],
  },
  {
    name: "QueryExplorer",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "the latest SQL-ish query plus a rendered result table from output",
    bestFor: ["data", "database", "analytics", "SQL"],
  },
  {
    name: "HealthMonitor",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "service health board (up/down/degraded) parsed from status output",
    bestFor: ["ops", "monitoring", "canary", "uptime", "incident"],
  },
  {
    name: "AgentFleetDashboard",
    props: "{ skill: SkillHandle, title?: string }",
    purpose: "delegated subagent tasks with status and result snippets",
    bestFor: ["orchestration", "multi-agent", "fan-out workflows"],
  },
  {
    name: "SplitPane",
    props: '{ direction: "horizontal" | "vertical", sizes: [number, number], children: [node, node], minSize?: number }',
    purpose: "draggable two-pane layout container; nest for 3+ panes",
    bestFor: ["all layouts"],
  },
] as const;

const EXAMPLE_GENOME = `{
  "genomeVersion": "1", "skill": "gstack-review", "source": "generated",
  "tokens": { "accent": "indigo", "density": "comfortable" },
  "tree": {
    "type": "split-h", "sizes": [32, 68],
    "children": [
      { "slot": "chat" },
      { "type": "split-v", "sizes": [66, 34],
        "children": [{ "slot": "diff" }, { "slot": "findings" }] }
    ]
  },
  "slots": {
    "chat":     { "component": "AgentChat",    "role": "main" },
    "diff":     { "component": "DiffViewer",   "role": "complementary", "params": { "mode": "unified" }, "defaultState": "expanded" },
    "findings": { "component": "FindingsPanel","role": "log", "params": { "title": "Findings & Gates" } }
  },
  "routing": [
    { "match": { "payloadClass": "diff" },      "to": "diff" },
    { "match": { "event": "tool_execution_*" }, "to": "findings" },
    { "match": { "payloadClass": "text" },      "to": "chat" },
    { "fallback": "chat" }
  ]
}`;

// A strong per-category archetype default, so different skill kinds get
// structurally different layouts instead of the LLM converging on "split".
const ARCHETYPE_BY_CATEGORY: Record<string, string> = {
  coding: "command — a hero DiffViewer/work surface on top, AgentChat + TerminalLog demoted below",
  testing: "command — a hero TestResultsPanel, with AgentChat + TerminalLog beside/below",
  content: "document-hero — a wide DocumentViewer as the focus, AgentChat as a narrow side column",
  research: "sidekick — DocumentViewer or FindingsPanel hero, AgentChat beside it",
  planning: "checklist — a hero PlanTracker, AgentChat as a side column",
  design: "sidekick — DesignPreview hero, AgentChat beside it",
  data: "command — a hero ChartVisualization/QueryExplorer, AgentChat below",
  ops: "dashboard — a grid or nested split of HealthMonitor/DeploymentPipeline/AgentFleetDashboard + chat",
  other: "solo or sidekick — AgentChat-led; add at most one support pane if the workflow needs it",
};

export function buildGenerationPrompt(manifest: SkillManifest, category = "other"): string {
  const catalogText = CATALOG.map(
    (c) => `- ${c.name}: ${c.purpose}; best for: ${c.bestFor.join(", ")}`
  ).join("\n");

  const sectionsText = manifest.sections
    .filter((s) => s.summary)
    .map((s) => `- ${s.heading}: ${s.summary}`)
    .join("\n");

  const archetypeDirective = ARCHETYPE_BY_CATEGORY[category] ?? ARCHETYPE_BY_CATEGORY.other;

  return `You are designing a UI layout for an AI agent skill window, expressed as a typed JSON "layout genome". TSX is rendered from your genome automatically — you only output the genome.

## The skill

id: ${manifest.skillId}
name: ${manifest.name}
description: ${manifest.description}
tools it uses: ${manifest.allowedTools.join(", ") || "unknown"}

What the skill's workflow covers:
${sectionsText || "(no section data)"}

## Available components (compose ONLY from these)

${catalogText}

useSkill is wired automatically — every component receives the skill handle; you don't reference it in the genome.

## Genome shape

\`\`\`
{
  "genomeVersion": "1",
  "skill": "${manifest.skillId}",
  "source": "generated",
  "tokens": { "accent": "indigo", "density": "comfortable" },
  "tree":  <node>,
  "slots": { "<id>": { "component", "role"?, "params"?, "defaultState"?, "visibleWhen"? } },
  "routing": [ { "match": {...}, "to": "<slotId>" }, ..., { "fallback": "<slotId>" } ]
}

node = { "type": "split-h" | "split-v" | "stack", "sizes": [<weights>], "children": [node, ...] }
     | { "slot": "<id>" }
\`\`\`

- Every slot id used in \`tree\` must be defined in \`slots\`, and every defined slot must appear in \`tree\`.
- role ∈ main | complementary | log | navigation | aside.
- routing \`match\` ∈ { "event"?: "tool_execution_*", "payloadClass"?: diff|text|tool_output|plan|question|error|thinking, "tool"?: "Bash" }. First match wins; you MUST end with one \`{ "fallback": "<slotId>" }\` rule (usually the AgentChat slot) so no event is dropped.

## Layout — REQUIRED archetype for this skill (category: ${category})

**Use this archetype: ${archetypeDirective}**

Deviate only if the workflow sections clearly demand a different shape. The archetype vocabulary:
- **solo**: tree is just \`{ "slot": "chat" }\`.
- **sidekick**: a hero slot ~70% + one narrow support slot. \`split-h\`, sizes [70,30].
- **command**: a hero work surface + chat/terminal demoted. \`split-v\`: [work, \`split-h\`:[chat,term]].
- **dashboard**: 3–4 slots via nested splits or a \`grid\` (\`{ "type": "grid", "children": [...] }\`) — for multi-signal ops skills.
- **tabs**: \`{ "type": "tabs", "children": [...] }\` — when panes are alternatives the user switches between, not watched at once.

Only include a slot if this skill's workflow actually produces content for it (no DiffViewer for a skill that never touches code). Match the layout to THIS skill — a writing skill and a deploy skill must not look alike.

## Worked example (gstack-review)

\`\`\`json
${EXAMPLE_GENOME}
\`\`\`

Decide the archetype from the workflow sections, then output ONE \`\`\`json fence containing only the genome — no prose.`;
}
