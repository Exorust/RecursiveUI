/*
 * The layout genome — the unit of adaptation.
 *
 * A genome is a typed JSON spec describing WHICH catalog components go WHERE,
 * with what default params, fed by WHICH agent events. TSX is a *render* of
 * the genome (see renderGenome), not the source of truth. This is what makes
 * adaptation possible: mutations are discrete and diffable, telemetry attaches
 * to stable slot ids, and trace-replay can evaluate a genome against a session.
 *
 * Design rationale and the sources behind each primitive live in
 * .plans/design-doc.md § "Layout Genome". The schema is a LIVING vocabulary:
 * it may declare more than renderGenome v1 supports. Anything unsupported
 * degrades gracefully and is reported in RenderResult.warnings — never throws.
 */

export const GENOME_VERSION = "1";

// Mirror of the SDK's accentForSkill (packages/sdk/src/kit.ts) so a generated
// genome's token matches the per-skill identity color the window shows.
const IDENTITY_ACCENTS = [
  "jade", "indigo", "iris", "cyan", "crimson", "amber", "grass", "violet",
  "sky", "orange", "plum", "teal", "ruby", "gold", "tomato", "blue", "purple", "lime",
];

export function skillAccent(skillId: string): string {
  let h = 0;
  for (let i = 0; i < skillId.length; i++) h = (h * 31 + skillId.charCodeAt(i)) >>> 0;
  return IDENTITY_ACCENTS[h % IDENTITY_ACCENTS.length]!;
}

export function densityForCategory(category: string): "compact" | "comfortable" {
  return category === "ops" || category === "data" ? "compact" : "comfortable";
}

/** Stable short hash of a genome's structural content (for telemetry/versioning). */
export function genomeHash(genome: LayoutGenome): string {
  const canonical = JSON.stringify({ tree: genome.tree, slots: genome.slots, routing: genome.routing });
  return Bun.hash(canonical).toString(16).slice(0, 12);
}

// ── Structure: a recursive layout tree (i3 / tmux / Flutter) ──────────────

/** Container kinds. v1 renders split-h/split-v/stack; tabs/grid degrade. */
export type ContainerType = "split-h" | "split-v" | "stack" | "tabs" | "grid";

/**
 * Per-child sizing (CSS flex / Figma auto-layout). v1 honors `number` as a
 * flex weight; `fixed`/`hug` are reserved and degrade to a flex weight.
 */
export type SizeSpec = number | { fixed: number } | { hug: true };

export interface ContainerNode {
  type: ContainerType;
  /** One entry per child; flex weights in v1. Omit for equal split. */
  sizes?: SizeSpec[];
  children: LayoutNode[];
}

/** A leaf: references a slot by id (slots are defined once in LayoutGenome.slots). */
export interface SlotRef {
  slot: string;
}

export type LayoutNode = ContainerNode | SlotRef;

export function isSlotRef(node: LayoutNode): node is SlotRef {
  return (node as SlotRef).slot !== undefined;
}

// ── Slots: the leaves (component + params + state) ────────────────────────

/** WAI-ARIA-flavored semantic role; a stable routing/telemetry target. */
export type Role = "main" | "complementary" | "log" | "navigation" | "aside";

export type DefaultState = "expanded" | "collapsed";

export interface Slot {
  /** Catalog component name (see catalog.ts CATALOG) or "custom". */
  component: string;
  role?: Role;
  /** Typed-open per component; the knob-tuner's entire surface. */
  params?: Record<string, unknown>;
  /** Required when component === "custom": path to a hand-written .tsx. */
  source?: string;
  defaultState?: DefaultState;
  /** Conditional presentation (VS Code `when` / JSON Forms `rule`). */
  visibleWhen?: Condition;
  expandWhen?: Condition;
  /** false for custom/locked slots — off-limits to the auto-evolution loop. */
  evolvable?: boolean;
}

// ── Conditions: typed predicates over runtime state (not a string DSL) ────

export interface Condition {
  /** This slot has received >=1 routed event this session. */
  slotReceived?: boolean;
  /** A tool is currently executing. */
  toolRunning?: boolean;
  sessionStatus?: "idle" | "running" | "streaming" | "done" | "error";
  /** Named slot is currently empty. */
  isEmpty?: string;
}

// ── Routing: the data plane (Elm dispatch / pub-sub) ──────────────────────

/** Payload taxonomy — the vocabulary the fit-score is computed in. */
export type PayloadClass =
  | "diff"
  | "text"
  | "tool_output"
  | "plan"
  | "question"
  | "error"
  | "thinking";

export interface MatchSpec {
  /** Pi event type, glob allowed, e.g. "tool_execution_*". */
  event?: string;
  payloadClass?: PayloadClass;
  /** Glob over tool name, e.g. "Bash". */
  tool?: string;
}

/**
 * Ordered match→target rules, first match wins. Exactly one terminal rule
 * should set `fallback` (the default sink, usually the chat slot) so every
 * event resolves to a slot — that's what makes the routing ledger's
 * `fallback` vs `dropped` distinction meaningful.
 */
export interface RoutingRule {
  match?: MatchSpec;
  /** Slot id to route matched events to. */
  to?: string;
  /** Terminal fallback sink (slot id). Mutually exclusive with match/to. */
  fallback?: string;
}

// ── Theme tokens (Adaptive Cards host-config): no raw colors in the genome ─

export interface Tokens {
  accent?: string;
  density?: "compact" | "comfortable";
  surface?: string;
}

// ── Provenance + evolution control ────────────────────────────────────────

export type GenomeSource = "generated" | "evolved" | "studio" | "community";

export interface LayoutGenome {
  genomeVersion: string;
  skill: string;
  source: GenomeSource;
  /** git sha of the parent genome — the diff anchor for the adaptation register. */
  parentHash?: string;
  tokens?: Tokens;
  tree: LayoutNode;
  slots: Record<string, Slot>;
  routing: RoutingRule[];
  /** User overrides (guardrails): locked = no evolution; pinned = no auto-regen. */
  locked?: boolean;
  pinned?: boolean;
}

// ── Validation (structural; JSON Schema covers shape, this covers refs) ────

/** Returns a list of human-readable problems; empty means valid. */
export function validateGenome(genome: LayoutGenome): string[] {
  const errors: string[] = [];
  if (genome.genomeVersion !== GENOME_VERSION) {
    errors.push(`genomeVersion "${genome.genomeVersion}" != supported "${GENOME_VERSION}"`);
  }
  if (!genome.slots || Object.keys(genome.slots).length === 0) {
    errors.push("genome has no slots");
  }

  const slotIds = new Set(Object.keys(genome.slots ?? {}));

  // Every SlotRef in the tree must reference a defined slot; collect referenced ids.
  const referenced = new Set<string>();
  const walk = (node: LayoutNode) => {
    if (isSlotRef(node)) {
      referenced.add(node.slot);
      if (!slotIds.has(node.slot)) errors.push(`tree references unknown slot "${node.slot}"`);
      return;
    }
    if (!node.children?.length) errors.push(`container "${node.type}" has no children`);
    node.children?.forEach(walk);
  };
  if (genome.tree) walk(genome.tree);
  else errors.push("genome has no tree");

  // Custom slots need a source; defined slots should be placed in the tree.
  for (const [id, slot] of Object.entries(genome.slots ?? {})) {
    if (slot.component === "custom" && !slot.source) {
      errors.push(`custom slot "${id}" missing source path`);
    }
    if (!referenced.has(id)) errors.push(`slot "${id}" is defined but never placed in the tree`);
  }

  // Routing targets must be real slots; require at least one fallback.
  let hasFallback = false;
  for (const rule of genome.routing ?? []) {
    if (rule.fallback) {
      hasFallback = true;
      if (!slotIds.has(rule.fallback)) errors.push(`routing fallback "${rule.fallback}" is not a slot`);
    } else if (rule.to && !slotIds.has(rule.to)) {
      errors.push(`routing target "${rule.to}" is not a slot`);
    }
  }
  if ((genome.routing?.length ?? 0) > 0 && !hasFallback) {
    errors.push("routing has no fallback rule — events with no match would be dropped");
  }

  return errors;
}

// ── Genome transforms (evolution morphs operate on these) ─────────────────

/**
 * Remove a slot: drop its SlotRef from the tree (collapsing any container left
 * with a single child), delete its slot definition, and drop routing rules
 * that targeted it. Returns a new genome; leaves the original untouched.
 */
export function removeSlot(genome: LayoutGenome, slotId: string): LayoutGenome {
  const next: LayoutGenome = structuredClone(genome);
  next.tree = pruneNode(next.tree, slotId) ?? next.tree;
  delete next.slots[slotId];
  next.routing = (next.routing ?? []).filter((r) => r.to !== slotId);
  return next;
}

// Returns the rewritten node, or null if this node should be removed entirely.
function pruneNode(node: LayoutNode, slotId: string): LayoutNode | null {
  if (isSlotRef(node)) return node.slot === slotId ? null : node;
  const kept = node.children
    .map((c) => pruneNode(c, slotId))
    .filter((c): c is LayoutNode => c !== null);
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!; // collapse single-child container
  const sizes = node.sizes ? node.sizes.slice(0, kept.length) : undefined;
  return { ...node, children: kept, ...(sizes ? { sizes } : {}) };
}

// ── renderGenome: the deterministic genome → TSX contract ─────────────────

export interface RenderResult {
  /** TSX source: `export default function SkillApp(...)`, no imports. */
  tsx: string;
  /** Features the schema declared that renderer v1 degraded rather than dropped. */
  warnings: string[];
}

/**
 * Render a genome to TSX for the existing compile/load pipeline.
 *
 * Contract:
 *  - Output is a single component: `export default function SkillApp({ skillId }: { skillId: string })`.
 *  - NO imports. React (as `React.*`), the catalog components, `useSkill`, and
 *    hooks are bare identifiers provided by the window.__REK kit (KIT_HEADER).
 *  - `useSkill(skillId)` is called once; the handle is passed to every catalog
 *    component as `skill={skill}`, plus each slot's params spread in.
 *  - Layout tree: split-h/split-v → SplitPane (binary; N children right-folded
 *    into nested SplitPanes with summed weights). stack → flex column.
 *    tabs/grid → degraded to stack (recorded in warnings) until kit gains them.
 *  - Catalog components already render their own headers, so slots are emitted
 *    bare (no extra title chrome) to avoid double headers.
 *  - custom slots are NOT inlined by v1 (recorded in warnings); a placeholder
 *    renders so the layout still compiles.
 *  - routing + conditions are carried by the genome but NOT wired at render
 *    time in v1 — they're consumed by the telemetry/evolution layer (next
 *    build step). visibleWhen/expandWhen presence is reported in warnings.
 *  - Never throws: anything unsupported degrades and is reported.
 */
export function renderGenome(genome: LayoutGenome): RenderResult {
  const warnings: string[] = [];
  const slots = genome.slots ?? {};

  for (const [id, slot] of Object.entries(slots)) {
    if (slot.visibleWhen || slot.expandWhen) {
      warnings.push(`slot "${id}" has conditions — carried in genome, not wired by renderer v1`);
    }
  }

  const body = genome.tree ? renderNode(genome.tree, slots, warnings) : "<div />";
  const bg = "#0d0d1a";

  const tsx = `export default function SkillApp({ skillId }: { skillId: string }) {
  const skill = useSkill(skillId);
  return (
    <div style={{ height: "100vh", width: "100vw", background: "${bg}", color: "#e0e0e0", overflow: "hidden" }}>
      ${body}
    </div>
  );
}
`;

  return { tsx, warnings };
}

function renderNode(node: LayoutNode, slots: Record<string, Slot>, warnings: string[]): string {
  if (isSlotRef(node)) return renderSlot(node.slot, slots, warnings);

  switch (node.type) {
    case "split-h":
    case "split-v":
      return renderSplit(node, slots, warnings);
    case "stack":
      return renderStack(node, slots, warnings);
    case "tabs":
      return renderTabs(node, slots, warnings);
    case "grid":
      return renderGrid(node, slots, warnings);
    default:
      warnings.push(`unknown container type — rendered as stack`);
      return renderStack({ ...(node as ContainerNode), type: "stack" }, slots, warnings);
  }
}

// Tabbed container: one child per tab, switched via the kit's TabGroup.
function renderTabs(node: ContainerNode, slots: Record<string, Slot>, warnings: string[]): string {
  const children = node.children ?? [];
  const labels = children.map((c) => tabLabel(c, slots));
  const rendered = children.map((c) => renderNode(c, slots, warnings)).join("\n      ");
  return `<TabGroup labels={${JSON.stringify(labels)}}>
      ${rendered}
    </TabGroup>`;
}

// CSS grid container: children laid out in cells (2 columns past 2 children).
function renderGrid(node: ContainerNode, slots: Record<string, Slot>, warnings: string[]): string {
  const children = node.children ?? [];
  const cols = children.length <= 1 ? 1 : children.length <= 4 ? 2 : 3;
  const cells = children
    .map((c) => `<div style={{ minHeight: 0, overflow: "hidden" }}>${renderNode(c, slots, warnings)}</div>`)
    .join("\n      ");
  return `<div style={{ display: "grid", gridTemplateColumns: "repeat(${cols}, 1fr)", gap: 1, height: "100%", width: "100%", background: "var(--gray-4)" }}>
      ${cells}
    </div>`;
}

function tabLabel(node: LayoutNode, slots: Record<string, Slot>): string {
  if (isSlotRef(node)) {
    const slot = slots[node.slot];
    const params = slot?.params as { title?: string } | undefined;
    return params?.title || slot?.component || node.slot;
  }
  return node.type;
}

function renderStack(node: ContainerNode, slots: Record<string, Slot>, warnings: string[]): string {
  const children = (node.children ?? [])
    .map(
      (c) =>
        `<div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>${renderNode(c, slots, warnings)}</div>`
    )
    .join("\n      ");
  return `<div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      ${children}
    </div>`;
}

function renderSplit(node: ContainerNode, slots: Record<string, Slot>, warnings: string[]): string {
  const dir = node.type === "split-h" ? "horizontal" : "vertical";
  const children = node.children ?? [];
  const weights = children.map((_, i) => weightOf(node.sizes?.[i] ?? undefined, warnings));
  return foldSplit(children, weights, dir, slots, warnings);
}

// SplitPane is binary; right-fold N children into nested SplitPanes.
function foldSplit(
  children: LayoutNode[],
  weights: number[],
  dir: "horizontal" | "vertical",
  slots: Record<string, Slot>,
  warnings: string[]
): string {
  const head = children[0];
  if (!head) return "<div />";
  if (children.length === 1) return renderNode(head, slots, warnings);
  const first = renderNode(head, slots, warnings);
  const restWeight = weights.slice(1).reduce((a, b) => a + b, 0);
  const rest = foldSplit(children.slice(1), weights.slice(1), dir, slots, warnings);
  return `<SplitPane direction="${dir}" sizes={[${weights[0]}, ${restWeight}]}>
      ${first}
      ${rest}
    </SplitPane>`;
}

function weightOf(size: SizeSpec | undefined, warnings: string[]): number {
  if (typeof size === "number") return size;
  if (size && "fixed" in size) {
    warnings.push("fixed size degraded to flex weight in renderer v1");
    return size.fixed;
  }
  if (size && "hug" in size) {
    warnings.push("hug size degraded to flex weight in renderer v1");
    return 1;
  }
  return 1;
}

function renderSlot(id: string, slots: Record<string, Slot>, warnings: string[]): string {
  const slot = slots[id];
  if (!slot) {
    warnings.push(`tree references unknown slot "${id}"`);
    return "<div />";
  }
  if (slot.component === "custom") {
    warnings.push(`custom slot "${id}" not inlined by renderer v1`);
    return `<div style={{ padding: 16, color: "#666", height: "100%" }}>custom slot: ${id}</div>`;
  }
  const params = slot.params ?? {};
  const propStr = Object.entries(params)
    .map(([k, v]) => `${k}={${JSON.stringify(v)}}`)
    .join(" ");
  return `<${slot.component} skill={skill}${propStr ? " " + propStr : ""} />`;
}
