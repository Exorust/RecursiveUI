import { test, expect } from "bun:test";
import { skillReducer, initialSkillState, type SkillAction, type SkillState } from "./skillReducer";

function fold(actions: SkillAction[], from: SkillState = initialSkillState): SkillState {
  return actions.reduce(skillReducer, from);
}
const ev = (e: any): SkillAction => ({ kind: "event", ev: e });

test("user action appends a user message and opens a new turn", () => {
  const s = fold([{ kind: "user", text: "review the branch" }]);
  expect(s.messages).toEqual([{ role: "user", content: "review the branch" }]);
  expect(s.newTurn).toBe(true);
});

test("invoke resets output/error and goes running", () => {
  const dirty = { ...initialSkillState, output: "old", error: "boom", status: "error" as const };
  const s = skillReducer(dirty, { kind: "invoke" });
  expect(s.output).toBe("");
  expect(s.error).toBeNull();
  expect(s.status).toBe("running");
});

test("streaming text in one turn merges into a single assistant bubble", () => {
  const s = fold([
    { kind: "user", text: "hi" },
    ev({ type: "agent_start" }),
    ev({ type: "message_update", text: "Hel" }),
    ev({ type: "message_update", text: "Hello there" }),
  ]);
  const assistant = s.messages.filter((m) => m.role === "assistant");
  expect(assistant).toHaveLength(1);
  expect(assistant[0]!.content).toBe("Hello there");
  expect(s.output).toBe("Hello there");
  expect(s.status).toBe("streaming");
});

// The central regression: a second turn must NOT merge into the first turn's
// assistant bubble. agent_end is the turn boundary.
test("a new turn after agent_end starts a fresh assistant bubble", () => {
  const s = fold([
    { kind: "user", text: "q1" },
    ev({ type: "message_update", text: "answer 1" }),
    ev({ type: "agent_end" }),
    { kind: "user", text: "q2" },
    ev({ type: "message_update", text: "answer 2" }),
  ]);
  expect(s.messages.map((m) => `${m.role}:${m.content}`)).toEqual([
    "user:q1",
    "assistant:answer 1",
    "user:q2",
    "assistant:answer 2",
  ]);
});

test("thinking-only update sets the thinking signal; text supersedes it", () => {
  let s = fold([ev({ type: "message_update", thinking: "let me consider…" })]);
  expect(s.activity).toBe("thinking…");
  expect(s.messages[0]!.thinking).toBe("let me consider…");
  expect(s.messages[0]!.content).toBe("");

  s = skillReducer(s, ev({ type: "message_update", text: "Here's the answer", thinking: "let me consider…" }));
  expect(s.activity).toBeNull();
  expect(s.messages).toHaveLength(1); // same turn, merged
  expect(s.messages[0]!.content).toBe("Here's the answer");
});

test("tool lifecycle: start appends a running tool and clears activity; end marks done", () => {
  let s = fold([
    ev({ type: "agent_start" }),
    ev({ type: "tool_execution_start", toolCallId: "t1", toolName: "Bash", args: { command: "ls" } }),
  ]);
  expect(s.activity).toBeNull();
  expect(s.tools).toHaveLength(1);
  expect(s.tools[0]!.status).toBe("running");

  s = skillReducer(s, ev({ type: "tool_execution_end", toolCallId: "t1", result: "file.txt", isError: false }));
  expect(s.tools[0]!.status).toBe("done");
  expect(s.tools[0]!.result).toBe("file.txt");
});

test("ask_user_question sets pendingQuestion; agent_end clears it", () => {
  let s = fold([
    ev({ type: "ask_user_question", requestId: "r1", questions: [{ question: "Mode?", options: [] }] }),
  ]);
  expect(s.pendingQuestion?.requestId).toBe("r1");
  expect(s.activity).toBe("waiting for your answer…");

  s = skillReducer(s, ev({ type: "agent_end" }));
  expect(s.pendingQuestion).toBeNull();
  expect(s.status).toBe("done");
});

test("retry and compaction surface as activity signals", () => {
  expect(fold([ev({ type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 8000 })]).activity)
    .toBe("provider error — retrying 2/5 in 8s…");
  expect(fold([ev({ type: "compaction_start" })]).activity).toBe("compacting context…");
  expect(fold([ev({ type: "compaction_start" }), ev({ type: "compaction_end" })]).activity).toBeNull();
});

test("history replay reconstructs the transcript and settles status", () => {
  const transcript = [
    { type: "user_message", text: "do it" },
    { type: "message_update", text: "working…" },
    { type: "tool_execution_start", toolCallId: "t1", toolName: "Read", args: {} },
    { type: "tool_execution_end", toolCallId: "t1", result: "ok", isError: false },
    { type: "message_update", text: "done" },
    { type: "agent_end" },
  ];
  let s = fold(transcript.map(ev));
  s = skillReducer(s, { kind: "replaySettle", lastType: "agent_end" });

  expect(s.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(s.messages[1]!.content).toBe("done");
  expect(s.tools).toHaveLength(1);
  expect(s.tools[0]!.status).toBe("done");
  expect(s.status).toBe("done");
  expect(s.activity).toBeNull();
});

test("clearQuestion and idle reset the right slices", () => {
  const withQ = fold([ev({ type: "ask_user_question", requestId: "r", questions: [] })]);
  expect(skillReducer(withQ, { kind: "clearQuestion" }).pendingQuestion).toBeNull();
  expect(skillReducer(withQ, { kind: "idle" }).status).toBe("idle");
  expect(skillReducer(withQ, { kind: "idle" }).pendingQuestion).toBeNull();
});
