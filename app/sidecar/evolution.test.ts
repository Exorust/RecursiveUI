import { test, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the runtime dir at a temp location BEFORE importing modules that read it.
const TMP_HOME = mkdtempSync(join(tmpdir(), "rek-evo-"));
process.env.HOME = TMP_HOME;

let telemetry: typeof import("./telemetry");
let genomeMod: typeof import("./genome");

beforeAll(async () => {
  telemetry = await import("./telemetry");
  genomeMod = await import("./genome");
});

// A genome where chat is small (32) and diff is large (68) — but we'll feed
// telemetry where chat dominates the bytes, so the knob-tuner should want to
// grow chat. (We exercise scorecard + diagnosis without the LLM or compile.)
function reviewGenome() {
  return {
    genomeVersion: "1",
    skill: "test-skill",
    source: "generated",
    tree: {
      type: "split-h",
      sizes: [70, 30],
      children: [{ slot: "diff" }, { slot: "chat" }],
    },
    slots: {
      diff: { component: "DiffViewer", role: "main" },
      chat: { component: "AgentChat", role: "complementary" },
    },
    routing: [
      { match: { payloadClass: "diff" }, to: "diff" },
      { match: { payloadClass: "text" }, to: "chat" },
      { fallback: "chat" },
    ],
  } as any;
}

test("routing classifier maps events to payload classes", () => {
  expect(telemetry.classifyEvent({ type: "tool_execution_end", toolName: "Bash", result: "x".repeat(50) }))
    .toEqual({ payloadClass: "tool_output", tool: "Bash", bytes: 50 });
  expect(telemetry.classifyEvent({ type: "message_update", text: "diff --git a/x b/x\n@@ -1 +1 @@" })?.payloadClass)
    .toBe("diff");
  expect(telemetry.classifyEvent({ type: "message_update", text: "hello" })?.payloadClass).toBe("text");
  expect(telemetry.classifyEvent({ type: "agent_start" })).toBeNull();
});

test("route resolves against genome routing with fallback", () => {
  const g = reviewGenome();
  expect(telemetry.route(g, "message_update", "diff").outcome).toBe("routed");
  expect(telemetry.route(g, "message_update", "diff").slotId).toBe("diff");
  // 'question' has no rule → fallback to chat
  expect(telemetry.route(g, "ask_user_question", "question")).toEqual({ slotId: "chat", outcome: "fallback" });
});

test("scorecard + knob-tuner: dominant slot with little space gets grown", async () => {
  const { scorecard, startSession, logRouting } = telemetry;

  // Two sessions, chat carries ~85% of routed bytes but has only 30% of space.
  for (let s = 0; s < 2; s++) {
    const sid = `sess-${s}`;
    startSession(sid, "test-skill", "hash0");
    logRouting(sid, "test-skill", "message_update", "text", 8500, "chat", "routed");
    logRouting(sid, "test-skill", "message_update", "diff", 1500, "diff", "routed");
  }

  const card = scorecard("test-skill");
  expect(card.sessions).toBe(2);
  expect(card.slots[0]!.slotId).toBe("chat"); // busiest
  expect(card.fitScore).toBeGreaterThan(0.9);

  // Diagnosis is deterministic; verify it identifies chat as under-sized.
  // (proposeResize is internal; we assert via the public cycle's dry effect:
  //  the busiest slot share > 0.55 and its current space share < 0.5.)
  const totalBytes = card.slots.reduce((a, x) => a + x.bytes, 0);
  const chatShare = card.slots.find((s) => s.slotId === "chat")!.bytes / totalBytes;
  expect(chatShare).toBeGreaterThan(0.55);
});

test("full evolution cycle ships a resized genome (no LLM)", async () => {
  const { commitGenome, loadGenome } = await import("./generator");
  const { runEvolutionCycle } = await import("./evolution");
  const { startSession, logRouting } = telemetry;

  const g = reviewGenome();
  g.skill = "evo-skill";
  await commitGenome("evo-skill", g, "seed"); // renders + compiles + commits, offline

  // chat (index 1, 30% space) carries 85% of bytes across 2 sessions
  for (let s = 0; s < 2; s++) {
    const sid = `evo-${s}`;
    startSession(sid, "evo-skill", "hash0");
    logRouting(sid, "evo-skill", "message_update", "text", 8500, "chat", "routed");
    logRouting(sid, "evo-skill", "message_update", "diff", 1500, "diff", "routed");
  }

  const result = await runEvolutionCycle("evo-skill");
  expect(result.adapted).toBe(true);
  expect(result.change!.toLowerCase()).toContain("agentchat");

  const evolved = loadGenome("evo-skill")!;
  const sizes = (evolved.tree as any).sizes as number[];
  // chat (index 1) should now own more space than diff (index 0)
  expect(sizes[1]!).toBeGreaterThan(sizes[0]!);
  expect(evolved.source).toBe("evolved");
});

test("trace replay scores a candidate that catches a fallback class higher", async () => {
  const { replayFit } = telemetry;
  const events = [
    { pi_event_type: "message_update", payload_class: "diff" as const, bytes: 5000, tool: null },
    { pi_event_type: "message_update", payload_class: "text" as const, bytes: 1000, tool: null },
  ];

  // Active genome has no diff route → diff bytes fall back (not "routed").
  const noDiff = {
    routing: [{ match: { payloadClass: "text" }, to: "chat" }, { fallback: "chat" }],
  } as any;
  // Candidate routes diff to a real slot.
  const withDiff = {
    routing: [
      { match: { payloadClass: "diff" }, to: "diff" },
      { match: { payloadClass: "text" }, to: "chat" },
      { fallback: "chat" },
    ],
  } as any;

  const base = replayFit(noDiff, events); // only text routed = 1000/6000
  const better = replayFit(withDiff, events); // diff+text routed = 6000/6000
  expect(base).toBeCloseTo(1000 / 6000, 5);
  expect(better).toBe(1);
  expect(better).toBeGreaterThan(base);
});

test("pattern library: Beta confidence rises with confirms, proven gate works", () => {
  const { updatePattern, listPatterns, provenPatterns } = telemetry;
  // Unique keys so the assertions don't depend on other rows in the shared DB.
  const good = `__t_good_${Date.now()}`;
  const bad = `__t_bad_${Date.now()}`;

  updatePattern(good, "confirm", "grew busy pane");
  updatePattern(good, "confirm");
  updatePattern(good, "confirm"); // 3 confirms, 0 refutes
  updatePattern(bad, "confirm");
  updatePattern(bad, "refute");
  updatePattern(bad, "refute"); // 1 confirm, 2 refutes

  const all = Object.fromEntries(listPatterns().map((p) => [p.move_class, p]));
  expect(all[good]!.confirms).toBe(3);
  expect(all[good]!.confidence).toBeCloseTo(4 / 5, 5); // (3+1)/(3+0+2)
  expect(all[bad]!.confidence).toBeCloseTo(2 / 5, 5); // (1+1)/(1+2+2)

  const proven = provenPatterns().map((p) => p.move_class);
  expect(proven).toContain(good); // >=0.7 conf, >=2 confirms
  expect(proven).not.toContain(bad);
});

test("removeSlot prunes a starved slot and collapses the container", async () => {
  const g = reviewGenome();
  g.skill = "prune-skill";
  // tree: split-h [diff, chat]; remove diff → should collapse to just chat.
  const pruned = genomeMod.removeSlot(g, "diff");
  expect(pruned.slots.diff).toBeUndefined();
  expect((pruned.tree as any).slot).toBe("chat"); // container collapsed to the lone child
  expect(pruned.routing.some((r: any) => r.to === "diff")).toBe(false);
  expect(genomeMod.validateGenome(pruned)).toEqual([]);
});
