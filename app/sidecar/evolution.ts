/*
 * The evolution loop (Slice 4.3 — deterministic knob-tuner).
 *
 * This is the design-doc/adaptation-design algorithm with Phase 3 resolved by
 * a deterministic morph instead of an LLM (the "knob-tuner is not a separate
 * system" unification). v1 implements one morph: resize a split so the slot
 * carrying most of the output gets proportional space. It is computed entirely
 * from the routing ledger — no LLM, no user interaction.
 *
 *   VERDICT (did the last change help?) → DIAGNOSE (worth fixing?) →
 *   PROPOSE (resize morph) → SHIP (evolved genome + hypothesis + toast)
 *
 * LLM-proposed structural mutation (Phase 3 via LLM) and the pattern library
 * are Slice 4.4/4.5 — this is the foundation they plug into.
 */

import { randomUUID } from "node:crypto";
import {
  type ContainerNode,
  type LayoutGenome,
  type LayoutNode,
  type SizeSpec,
  genomeHash,
  isSlotRef,
  removeSlot,
  validateGenome,
} from "./genome";
import { commitGenome, llmMutateGenome, loadGenome } from "./generator";
import {
  liveAdaptation,
  recentRoutingEvents,
  recordAdaptation,
  replayFit,
  scorecard,
  sessionsSince,
  setAdaptationStatus,
  updatePattern,
  type Scorecard,
} from "./telemetry";

const MIN_SESSIONS = 2; // gate K — low for testability; raise for real use
const COOLDOWN_MS = 1000 * 60 * 60 * 24;

export interface EvolutionResult {
  adapted: boolean;
  skillId: string;
  adaptationId?: string;
  change?: string;
  rationale?: string;
  verdict?: string;
  reason?: string;
}

export async function runEvolutionCycle(skillId: string): Promise<EvolutionResult> {
  const genome = loadGenome(skillId);
  if (!genome) return { adapted: false, skillId, reason: "no genome (legacy or ungenerated skill)" };

  // ── Phase 1: VERDICT — judge the last shipped hypothesis ──────────────
  let verdict: string | undefined;
  const live = liveAdaptation(skillId);
  if (live) {
    const since = sessionsSince(skillId, live.created_at);
    if (since < MIN_SESSIONS) {
      return { adapted: false, skillId, reason: `evaluating prior change (${since}/${MIN_SESSIONS} sessions)` };
    }
    // Simple verdict: did fit hold or improve since the change shipped?
    const card = scorecard(skillId);
    if (card.fitScore >= 0.85) {
      setAdaptationStatus(live.adaptation_id, "confirmed");
      updatePattern(live.kind, "confirm", live.rationale);
      verdict = `confirmed prior change (fit ${(card.fitScore * 100) | 0}%)`;
    } else {
      // Refuted — revert to the parent genome and cool down.
      const parent = JSON.parse(live.parent_genome) as LayoutGenome;
      await commitGenome(skillId, parent, `revert ${live.adaptation_id.slice(0, 8)} (refuted)`);
      setAdaptationStatus(live.adaptation_id, "reverted_auto", Date.now() + COOLDOWN_MS);
      updatePattern(live.kind, "refute", live.rationale);
      return { adapted: false, skillId, verdict: `reverted prior change (fit ${(card.fitScore * 100) | 0}%)` };
    }
  }

  // ── Gate: enough sessions to act on? ──────────────────────────────────
  const card = scorecard(skillId);
  if (card.sessions < MIN_SESSIONS) {
    return { adapted: false, skillId, verdict, reason: `need ${MIN_SESSIONS} sessions, have ${card.sessions}` };
  }

  // ── Phase 2/3: DIAGNOSE + PROPOSE ─────────────────────────────────────
  // Deterministic morphs first (pattern lookup branch): resize, then prune.
  // LLM only for the novel brief (a fallback class with no home).
  let morph = proposeResize(genome, card);
  if (!morph) morph = proposeStarvedRemoval(genome, card);
  if (!morph) morph = await proposeFallbackFix(genome, card);
  if (!morph) {
    return { adapted: false, skillId, verdict, reason: "default outcome: do nothing (stability prior)" };
  }

  const next = morph.apply(structuredClone(genome));
  next.source = "evolved";
  next.parentHash = genomeHash(genome);
  if (validateGenome(next).length) {
    return { adapted: false, skillId, verdict, reason: "proposed morph failed validation" };
  }

  // ── Phase 5: SHIP under hypothesis ────────────────────────────────────
  const res = await commitGenome(skillId, next, `evolved: ${morph.change}`);
  if (!res.ok) return { adapted: false, skillId, verdict, reason: `compile failed: ${res.error}` };

  const adaptationId = randomUUID();
  recordAdaptation({
    adaptation_id: adaptationId,
    skill_id: skillId,
    kind: morph.moveClass,
    genome_diff: morph.change,
    source: "auto",
    rationale: morph.rationale,
    predicted_metric: "fit_score",
    predicted_direction: "up",
    created_at: Date.now(),
    status: "live",
    parent_genome: JSON.stringify(genome),
    cooldown_until: null,
  });

  return { adapted: true, skillId, adaptationId, change: morph.change, rationale: morph.rationale, verdict };
}

interface Morph {
  /** Stable move class for the pattern library (e.g. "resize", "prune"). */
  moveClass: string;
  change: string;
  rationale: string;
  apply: (g: LayoutGenome) => LayoutGenome;
}

/**
 * Find the busiest slot (most routed bytes) and, if its split gives it less
 * space than its share of output, grow it. Non-destructive; visible; reversible.
 */
function proposeResize(genome: LayoutGenome, card: Scorecard): Morph | null {
  const busiest = card.slots[0];
  if (!busiest || busiest.bytes === 0) return null;
  const totalSlotBytes = card.slots.reduce((a, s) => a + s.bytes, 0);
  const outputShare = busiest.bytes / totalSlotBytes;
  if (outputShare < 0.55) return null; // no dominant slot — leave it alone

  // Locate the busiest slot's parent container + index.
  const loc = findParent(genome.tree, busiest.slotId);
  if (!loc) return null;
  const { container, index } = loc;
  const weights = normalizeWeights(container, container.children.length);
  const currentShare = weights[index]! / weights.reduce((a, b) => a + b, 0);
  if (currentShare >= 0.5) return null; // already has its room

  const target = 0.6;
  const slotName = genome.slots[busiest.slotId]?.component ?? busiest.slotId;
  const change = `grew the ${slotName} pane`;
  const rationale = `${slotName} handled ${(outputShare * 100) | 0}% of output but had ${(currentShare * 100) | 0}% of the space across ${busiest.sessions} session${busiest.sessions === 1 ? "" : "s"}`;

  return {
    moveClass: "resize",
    change,
    rationale,
    apply: (g) => {
      const l = findParent(g.tree, busiest.slotId);
      if (!l) return g;
      const n = l.container.children.length;
      const others = (1 - target) / (n - 1);
      l.container.sizes = l.container.children.map((_, i) =>
        Math.round((i === l.index ? target : others) * 100)
      );
      return g;
    },
  };
}

/**
 * A slot mounted in the tree that received zero routed events across all
 * sessions is wasted real estate — remove it (deterministic, reversible).
 * Never removes the routing fallback sink.
 */
function proposeStarvedRemoval(genome: LayoutGenome, card: Scorecard): Morph | null {
  if (card.sessions < MIN_SESSIONS) return null;
  const fallbackSink = genome.routing?.find((r) => r.fallback)?.fallback;
  const received = new Set(card.slots.map((s) => s.slotId));
  // Slots present in the tree but absent from routed-data stats = starved.
  const placed = placedSlots(genome.tree);
  const starved = placed.find(
    (id) => id !== fallbackSink && !received.has(id) && Object.keys(genome.slots).length > 1
  );
  if (!starved) return null;
  const name = genome.slots[starved]?.component ?? starved;
  return {
    moveClass: "prune",
    change: `removed the ${name} pane`,
    rationale: `${name} received no agent output across ${card.sessions} sessions — reclaimed its space`,
    apply: (g) => removeSlot(g, starved),
  };
}

/**
 * The novel brief: a payload class chronically hitting the chat fallback means
 * there's no component receiving it. Ask the LLM to add/route one, then keep
 * the candidate only if trace replay shows it actually raises fit.
 */
async function proposeFallbackFix(genome: LayoutGenome, card: Scorecard): Promise<Morph | null> {
  const worst = card.fallbackByClass[0];
  if (!worst || worst.bytes < 500) return null; // not chronic enough

  const brief = `Payload class "${worst.payloadClass}" is falling back to the chat pane (${worst.bytes} bytes across ${card.sessions} sessions) — no component is receiving it. Add or re-route so it lands in a purpose-built pane.`;
  const candidates = await llmMutateGenome(genome, brief);
  if (candidates.length === 0) return null;

  const events = recentRoutingEvents(genome.skill);
  const baseFit = replayFit(genome, events);
  let best: { g: LayoutGenome; fit: number } | null = null;
  for (const c of candidates) {
    const fit = replayFit(c, events);
    if (!best || fit > best.fit) best = { g: c, fit };
  }
  // Selector overrules generator: ship only if replay shows real improvement.
  if (!best || best.fit <= baseFit + 0.02) return null;

  const chosen = best.g;
  return {
    moveClass: "fallback-fix",
    change: `added a pane for ${worst.payloadClass} output`,
    rationale: `${worst.payloadClass} output was falling back to chat; replay shows fit ${(baseFit * 100) | 0}% → ${(best.fit * 100) | 0}%`,
    apply: () => chosen,
  };
}

function placedSlots(node: LayoutNode): string[] {
  if (isSlotRef(node)) return [node.slot];
  return node.children.flatMap(placedSlots);
}

function findParent(
  node: LayoutNode,
  slotId: string,
  parent: ContainerNode | null = null
): { container: ContainerNode; index: number } | null {
  if (isSlotRef(node)) {
    return null;
  }
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    if (isSlotRef(child) && child.slot === slotId && parent !== null && node.children.length > 1) {
      return { container: node, index: i };
    }
    if (isSlotRef(child) && child.slot === slotId) {
      return { container: node, index: i };
    }
    const deeper = findParent(child, slotId, node);
    if (deeper) return deeper;
  }
  return null;
}

function normalizeWeights(container: ContainerNode, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s: SizeSpec | undefined = container.sizes?.[i];
    out.push(typeof s === "number" ? s : s && "fixed" in s ? s.fixed : 1);
  }
  return out;
}
