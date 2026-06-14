/*
 * Telemetry + the routing ledger (Slice 4.1).
 *
 * The highest-signal log nobody else can have: RecursiveUI knows exactly what
 * data arrived (every Pi event) AND exactly what the UI did with it (the
 * genome's routing). For each event we record whether it was routed to a
 * real slot, fell back to chat, or was dropped. The per-skill fit score and
 * starved-slot detection fall straight out of this table — mechanically, in
 * one session, with zero user interaction.
 *
 * Storage is sidecar-side (bun:sqlite) because Pi events originate here and
 * the genome is loaded here; no frontend round-trip is needed for routing.
 */

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { LayoutGenome, MatchSpec, PayloadClass } from "./genome";

const REK_DIR = join(homedir(), ".recursiveui");

let _db: Database | null = null;

export function db(): Database {
  if (_db) return _db;
  mkdirSync(REK_DIR, { recursive: true });
  const database = new Database(join(REK_DIR, "telemetry.db"), { create: true });
  database.exec("PRAGMA journal_mode = WAL;");
  database.run(`CREATE TABLE IF NOT EXISTS session (
    session_id TEXT PRIMARY KEY, skill_id TEXT, genome_hash TEXT,
    started_at INTEGER, ended_at INTEGER, end_reason TEXT, prompt_count INTEGER DEFAULT 0
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS funnel (
    session_id TEXT, skill_id TEXT, stage TEXT, ts INTEGER
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS routing (
    ts INTEGER, session_id TEXT, skill_id TEXT, pi_event_type TEXT,
    payload_class TEXT, bytes INTEGER, slot_id TEXT, outcome TEXT, tool TEXT
  )`);
  // Migration for DBs created before the tool column (replay fidelity).
  try {
    database.run(`ALTER TABLE routing ADD COLUMN tool TEXT`);
  } catch {
    // column already exists
  }
  database.run(`CREATE TABLE IF NOT EXISTS ui_event (
    ts INTEGER, session_id TEXT, skill_id TEXT, slot_id TEXT, action TEXT, detail TEXT
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS friction (
    ts INTEGER, session_id TEXT, skill_id TEXT, kind TEXT, slot_id TEXT, detail TEXT
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS adaptation (
    adaptation_id TEXT PRIMARY KEY, skill_id TEXT, kind TEXT, genome_diff TEXT,
    source TEXT, rationale TEXT, predicted_metric TEXT, predicted_direction TEXT,
    created_at INTEGER, status TEXT, parent_genome TEXT, cooldown_until INTEGER
  )`);
  database.run(`CREATE TABLE IF NOT EXISTS preference (
    ts INTEGER, skill_id TEXT, kind TEXT, adaptation_id TEXT, payload TEXT
  )`);
  // Pattern library (Slice 4.5): move templates with Beta(confirms, refutes)
  // confidence, shared across all skills. Wins compound; failures stop recurring.
  database.run(`CREATE TABLE IF NOT EXISTS pattern (
    move_class TEXT PRIMARY KEY, confirms INTEGER DEFAULT 0, refutes INTEGER DEFAULT 0,
    last_rationale TEXT, updated_at INTEGER
  )`);
  _db = database;
  return database;
}

export type RouteOutcome = "routed" | "fallback" | "dropped";

// ── Writers ────────────────────────────────────────────────────────────

export function startSession(sessionId: string, skillId: string, genomeHash: string) {
  db().run(
    `INSERT OR REPLACE INTO session (session_id, skill_id, genome_hash, started_at) VALUES (?, ?, ?, ?)`,
    [sessionId, skillId, genomeHash, Date.now()]
  );
}

export function endSession(sessionId: string, reason: string) {
  db().run(`UPDATE session SET ended_at = ?, end_reason = ? WHERE session_id = ?`, [
    Date.now(),
    reason,
    sessionId,
  ]);
}

export function logFunnel(sessionId: string, skillId: string, stage: string) {
  db().run(`INSERT INTO funnel (session_id, skill_id, stage, ts) VALUES (?, ?, ?, ?)`, [
    sessionId,
    skillId,
    stage,
    Date.now(),
  ]);
}

export function bumpPromptCount(sessionId: string) {
  db().run(`UPDATE session SET prompt_count = prompt_count + 1 WHERE session_id = ?`, [
    sessionId,
  ]);
}

export function logRouting(
  sessionId: string,
  skillId: string,
  piEventType: string,
  payloadClass: PayloadClass,
  bytes: number,
  slotId: string | null,
  outcome: RouteOutcome,
  tool?: string
) {
  db().run(
    `INSERT INTO routing (ts, session_id, skill_id, pi_event_type, payload_class, bytes, slot_id, outcome, tool)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Date.now(), sessionId, skillId, piEventType, payloadClass, bytes, slotId, outcome, tool ?? null]
  );
}

export function logUiEvent(
  sessionId: string,
  skillId: string,
  slotId: string,
  action: string,
  detail = ""
) {
  db().run(
    `INSERT INTO ui_event (ts, session_id, skill_id, slot_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)`,
    [Date.now(), sessionId, skillId, slotId, action, detail]
  );
}

// ── Event classification + routing (the ledger's core) ───────────────────

const DIFF_MARKERS = /^diff --git|\n@@ |\n--- a\//;

export interface ClassifiedEvent {
  payloadClass: PayloadClass;
  tool?: string;
  bytes: number;
}

/** Map a sidecar event payload to a payload class. null = control event, not logged. */
export function classifyEvent(payload: Record<string, any>): ClassifiedEvent | null {
  switch (payload.type) {
    case "tool_execution_start":
    case "tool_execution_end": {
      const result = payload.result;
      const bytes = typeof result === "string" ? result.length : 0;
      return { payloadClass: "tool_output", tool: payload.toolName, bytes };
    }
    case "message_update": {
      const text: string = payload.text || "";
      const thinking: string = payload.thinking || "";
      if (thinking && !text) return { payloadClass: "thinking", bytes: thinking.length };
      if (DIFF_MARKERS.test(text)) return { payloadClass: "diff", bytes: text.length };
      return { payloadClass: "text", bytes: text.length };
    }
    case "ask_user_question":
      return { payloadClass: "question", bytes: 0 };
    default:
      return null; // agent_start/end, ui_generation, etc. are control events
  }
}

function globToRegExp(glob: string): RegExp {
  return new RegExp("^" + glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
}

function matchOne(m: MatchSpec, eventType: string, cls: PayloadClass, tool?: string): boolean {
  if (m.event && !globToRegExp(m.event).test(eventType)) return false;
  if (m.payloadClass && m.payloadClass !== cls) return false;
  if (m.tool && !globToRegExp(m.tool).test(tool ?? "")) return false;
  return true;
}

/** Resolve an event against the genome's routing rules (first match wins). */
export function route(
  genome: LayoutGenome | null,
  eventType: string,
  cls: PayloadClass,
  tool?: string
): { slotId: string | null; outcome: RouteOutcome } {
  if (!genome) return { slotId: null, outcome: "dropped" };
  let fallback: string | undefined;
  for (const rule of genome.routing ?? []) {
    if (rule.fallback) {
      fallback = rule.fallback;
      continue;
    }
    if (rule.match && rule.to && matchOne(rule.match, eventType, cls, tool)) {
      return { slotId: rule.to, outcome: "routed" };
    }
  }
  if (fallback) return { slotId: fallback, outcome: "fallback" };
  return { slotId: null, outcome: "dropped" };
}

// ── Scorecard (Slice 4.2): derived metrics, pure SQL ─────────────────────

export interface Scorecard {
  skillId: string;
  sessions: number;
  routedBytes: number;
  fallbackBytes: number;
  droppedBytes: number;
  /** routedBytes / total — share of output that found a real home. */
  fitScore: number;
  /** payload classes most often hitting the fallback. */
  fallbackByClass: { payloadClass: string; bytes: number }[];
  /** per-slot routed event counts + sessions seen — for starved/busy detection. */
  slots: { slotId: string; events: number; bytes: number; sessions: number }[];
}

export function scorecard(skillId: string): Scorecard {
  const d = db();
  const sessions =
    (d.query(`SELECT COUNT(*) n FROM session WHERE skill_id = ?`).get(skillId) as any)?.n ?? 0;

  const sums = d
    .query(
      `SELECT outcome, COALESCE(SUM(bytes),0) bytes FROM routing WHERE skill_id = ? GROUP BY outcome`
    )
    .all(skillId) as { outcome: string; bytes: number }[];
  const byOutcome = Object.fromEntries(sums.map((r) => [r.outcome, r.bytes]));
  const routedBytes = byOutcome.routed ?? 0;
  const fallbackBytes = byOutcome.fallback ?? 0;
  const droppedBytes = byOutcome.dropped ?? 0;
  const total = routedBytes + fallbackBytes + droppedBytes;

  const fallbackByClass = d
    .query(
      `SELECT payload_class payloadClass, COALESCE(SUM(bytes),0) bytes FROM routing
       WHERE skill_id = ? AND outcome = 'fallback' GROUP BY payload_class ORDER BY bytes DESC`
    )
    .all(skillId) as { payloadClass: string; bytes: number }[];

  const slots = d
    .query(
      `SELECT slot_id slotId, COUNT(*) events, COALESCE(SUM(bytes),0) bytes,
              COUNT(DISTINCT session_id) sessions
       FROM routing WHERE skill_id = ? AND outcome = 'routed' AND slot_id IS NOT NULL
       GROUP BY slot_id ORDER BY bytes DESC`
    )
    .all(skillId) as { slotId: string; events: number; bytes: number; sessions: number }[];

  return {
    skillId,
    sessions,
    routedBytes,
    fallbackBytes,
    droppedBytes,
    fitScore: total === 0 ? 1 : routedBytes / total,
    fallbackByClass,
    slots,
  };
}

// ── Adaptation register (the hypothesis log) ─────────────────────────────

export interface AdaptationRow {
  adaptation_id: string;
  skill_id: string;
  kind: string;
  genome_diff: string;
  source: string;
  rationale: string;
  predicted_metric: string;
  predicted_direction: string;
  created_at: number;
  status: string;
  parent_genome: string;
  cooldown_until: number | null;
}

export function recordAdaptation(a: AdaptationRow) {
  db().run(
    `INSERT INTO adaptation (adaptation_id, skill_id, kind, genome_diff, source, rationale,
       predicted_metric, predicted_direction, created_at, status, parent_genome, cooldown_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      a.adaptation_id, a.skill_id, a.kind, a.genome_diff, a.source, a.rationale,
      a.predicted_metric, a.predicted_direction, a.created_at, a.status,
      a.parent_genome, a.cooldown_until,
    ]
  );
}

export function getAdaptation(adaptationId: string): AdaptationRow | null {
  return (db().query(`SELECT * FROM adaptation WHERE adaptation_id = ?`).get(adaptationId) as
    | AdaptationRow
    | null) ?? null;
}

export function liveAdaptation(skillId: string): AdaptationRow | null {
  return (db()
    .query(`SELECT * FROM adaptation WHERE skill_id = ? AND status = 'live' ORDER BY created_at DESC LIMIT 1`)
    .get(skillId) as AdaptationRow | null) ?? null;
}

export function setAdaptationStatus(adaptationId: string, status: string, cooldownUntil?: number) {
  db().run(`UPDATE adaptation SET status = ?, cooldown_until = ? WHERE adaptation_id = ?`, [
    status,
    cooldownUntil ?? null,
    adaptationId,
  ]);
}

export function recordPreference(skillId: string, kind: string, adaptationId: string | null, payload = "") {
  db().run(
    `INSERT INTO preference (ts, skill_id, kind, adaptation_id, payload) VALUES (?, ?, ?, ?, ?)`,
    [Date.now(), skillId, kind, adaptationId, payload]
  );
}

// ── Trace replay (Slice 4.4): score a candidate genome on recorded sessions ──

export interface RecordedEvent {
  pi_event_type: string;
  payload_class: PayloadClass;
  bytes: number;
  tool: string | null;
}

export function recentRoutingEvents(skillId: string, limit = 2000): RecordedEvent[] {
  return db()
    .query(
      `SELECT pi_event_type, payload_class, bytes, tool FROM routing
       WHERE skill_id = ? ORDER BY ts DESC LIMIT ?`
    )
    .all(skillId, limit) as RecordedEvent[];
}

/**
 * Replay recorded events against a genome's routing and return its fit score
 * (routed bytes / total). Lets us score a candidate offline — "would this
 * layout have given last week's output a home?" — before the user sees it.
 * Honest about its limit: replay scores ROUTING changes (which slot data goes
 * to); it cannot judge purely visual changes.
 */
export function replayFit(
  genome: LayoutGenome,
  events: RecordedEvent[]
): number {
  let routed = 0;
  let total = 0;
  for (const e of events) {
    const { outcome } = route(genome, e.pi_event_type, e.payload_class, e.tool ?? undefined);
    total += e.bytes;
    if (outcome === "routed") routed += e.bytes;
  }
  return total === 0 ? 1 : routed / total;
}

// ── Pattern library (Slice 4.5) ─────────────────────────────────────────

export interface Pattern {
  move_class: string;
  confirms: number;
  refutes: number;
  last_rationale: string | null;
  /** Beta posterior mean = (confirms+1)/(confirms+refutes+2). */
  confidence: number;
}

/** Record a verdict against a move class, updating its Beta counts. */
export function updatePattern(moveClass: string, outcome: "confirm" | "refute", rationale = "") {
  const d = db();
  d.run(
    `INSERT INTO pattern (move_class, confirms, refutes, last_rationale, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(move_class) DO UPDATE SET
       confirms = confirms + ?, refutes = refutes + ?, last_rationale = ?, updated_at = ?`,
    [
      moveClass,
      outcome === "confirm" ? 1 : 0,
      outcome === "refute" ? 1 : 0,
      rationale,
      Date.now(),
      outcome === "confirm" ? 1 : 0,
      outcome === "refute" ? 1 : 0,
      rationale,
      Date.now(),
    ]
  );
}

export function listPatterns(): Pattern[] {
  const rows = db().query(`SELECT * FROM pattern`).all() as Omit<Pattern, "confidence">[];
  return rows
    .map((r) => ({ ...r, confidence: (r.confirms + 1) / (r.confirms + r.refutes + 2) }))
    .sort((a, b) => b.confidence - a.confidence);
}

/** Move classes confirmed enough to seed new generations as priors. */
export function provenPatterns(minConfidence = 0.7, minConfirms = 2): Pattern[] {
  return listPatterns().filter((p) => p.confidence >= minConfidence && p.confirms >= minConfirms);
}

/** Sessions recorded since a timestamp — gates the evolution cycle. */
export function sessionsSince(skillId: string, ts: number): number {
  return (
    (db()
      .query(`SELECT COUNT(*) n FROM session WHERE skill_id = ? AND started_at > ?`)
      .get(skillId, ts) as any)?.n ?? 0
  );
}
