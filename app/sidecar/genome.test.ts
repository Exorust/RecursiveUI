import { test, expect } from "bun:test";
import { renderGenome, validateGenome, type LayoutGenome } from "./genome";
import { compile } from "./generator";

// The worked example from .plans/design-doc.md § Layout Genome
const reviewGenome: LayoutGenome = {
  genomeVersion: "1",
  skill: "gstack-review",
  source: "generated",
  tokens: { accent: "indigo", density: "comfortable" },
  tree: {
    type: "split-h",
    sizes: [32, 68],
    children: [
      { slot: "chat" },
      {
        type: "split-v",
        sizes: [66, 34],
        children: [{ slot: "diff" }, { slot: "findings" }],
      },
    ],
  },
  slots: {
    chat: { component: "AgentChat", role: "main", evolvable: true },
    diff: {
      component: "DiffViewer",
      role: "complementary",
      params: { mode: "unified" },
      defaultState: "expanded",
      visibleWhen: { slotReceived: true },
    },
    findings: {
      component: "FindingsPanel",
      role: "log",
      params: { title: "Findings & Gates" },
    },
  },
  routing: [
    { match: { payloadClass: "diff" }, to: "diff" },
    { match: { event: "tool_execution_*" }, to: "findings" },
    { match: { payloadClass: "text" }, to: "chat" },
    { fallback: "chat" },
  ],
};

test("worked-example genome validates", () => {
  expect(validateGenome(reviewGenome)).toEqual([]);
});

test("renderGenome produces compilable SkillApp TSX", () => {
  const { tsx, warnings } = renderGenome(reviewGenome);
  expect(tsx).toContain("export default function SkillApp");
  expect(tsx).toContain("useSkill(skillId)");
  expect(tsx).toContain("<AgentChat skill={skill}");
  expect(tsx).toContain("<DiffViewer skill={skill}");
  expect(tsx).toContain('mode={"unified"}');
  expect(tsx).toContain("<SplitPane");
  // conditions are carried, not wired — should warn
  expect(warnings.some((w) => w.includes("conditions"))).toBe(true);

  const { code, error } = compile(tsx);
  expect(error).toBeUndefined();
  expect(code).toContain("export default");
});

test("validateGenome catches dangling refs and missing fallback", () => {
  const broken: LayoutGenome = {
    genomeVersion: "1",
    skill: "x",
    source: "generated",
    tree: { type: "split-h", children: [{ slot: "a" }, { slot: "ghost" }] },
    slots: { a: { component: "AgentChat" } },
    routing: [{ match: { payloadClass: "text" }, to: "a" }],
  };
  const errors = validateGenome(broken);
  expect(errors.some((e) => e.includes("ghost"))).toBe(true);
  expect(errors.some((e) => e.includes("fallback"))).toBe(true);
});

test("tabs render via TabGroup and compile", () => {
  const tabbed: LayoutGenome = {
    genomeVersion: "1",
    skill: "x",
    source: "generated",
    tree: { type: "tabs", children: [{ slot: "a" }, { slot: "b" }] },
    slots: { a: { component: "AgentChat" }, b: { component: "TerminalLog" } },
    routing: [{ fallback: "a" }],
  };
  const { tsx } = renderGenome(tabbed);
  expect(tsx).toContain("<TabGroup");
  expect(tsx).toContain("labels=");
  expect(compile(tsx).error).toBeUndefined();
});

test("grid renders a CSS grid and compiles", () => {
  const grid: LayoutGenome = {
    genomeVersion: "1",
    skill: "x",
    source: "generated",
    tree: { type: "grid", children: [{ slot: "a" }, { slot: "b" }, { slot: "c" }] },
    slots: {
      a: { component: "HealthMonitor" },
      b: { component: "DeploymentPipeline" },
      c: { component: "AgentChat" },
    },
    routing: [{ fallback: "c" }],
  };
  const { tsx } = renderGenome(grid);
  expect(tsx).toContain('display: "grid"');
  expect(tsx).toContain("repeat(2, 1fr)");
  expect(compile(tsx).error).toBeUndefined();
});
