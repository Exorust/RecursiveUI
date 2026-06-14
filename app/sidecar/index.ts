import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  loadSkillsFromDir,
  type AgentSession,
  type AgentSessionEvent,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  batchGenerate,
  generateUi,
  listUiVersions,
  loadCompiledUi,
  loadGenome,
  modifyUi,
  revertUi,
  type GenerationProgress,
} from "./generator";
import { randomUUID } from "node:crypto";
import { genomeHash, type LayoutGenome } from "./genome";
import {
  bumpPromptCount,
  classifyEvent,
  endSession,
  getAdaptation,
  logFunnel,
  logRouting,
  recordPreference,
  route,
  scorecard,
  setAdaptationStatus,
  startSession,
  updatePattern,
} from "./telemetry";
import { runEvolutionCycle } from "./evolution";
import { commitGenome } from "./generator";

function emitGenerationProgress(
  skillId: string,
  update: GenerationProgress,
  batch = false
) {
  const line = JSON.stringify({
    type: "skill-event",
    skillId,
    event: { type: "ui_generation", ...update, ...(batch ? { batch: true } : {}) },
  });
  process.stdout.write(line + "\n");
}

// Tell any open standalone window for this skill to hot-reload its compiled UI.
// The Studio edits; the separate window displays and live-updates.
function emitUiUpdated(skillId: string) {
  const line = JSON.stringify({
    type: "skill-event",
    skillId,
    event: { type: "ui_updated" },
  });
  process.stdout.write(line + "\n");
}
import { discoverSkills, PRIORITY_SKILLS } from "./discovery";
import { skillDirFor, parseSkillManifest } from "./skill-manifest";

// Warm the skillId→path registry so sessions created before the first
// explicit discover-skills call still resolve project/pi skills.
discoverSkills().catch(() => {});

interface SessionEntry {
  session: AgentSession;
  skill: Skill | null;
  skillPrimed: boolean;
  // Telemetry context for the routing ledger
  telemetrySessionId: string;
  genome: LayoutGenome | null;
  firstOutputLogged: boolean;
}

const sessions = new Map<string, SessionEntry>();

// AskUserQuestion shim: Claude Code skills hard-depend on this tool (gstack
// alone references it 184 times). The handler blocks the agent until the
// React window sends the user's selection back via "answer-question".
const pendingQuestions = new Map<string, (answerText: string) => void>();

interface QuestionAnswer {
  question: string;
  selected: string[];
}

function makeAskUserQuestionTool(skillId: string) {
  return defineTool({
    name: "AskUserQuestion",
    label: "Ask User Question",
    description:
      "Ask the user one or more multiple-choice questions and wait for their answer. " +
      "Use this whenever a skill or workflow requires a decision from the user.",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "The full question text" }),
          header: Type.Optional(
            Type.String({ description: "Short chip label, max 12 chars" })
          ),
          multiSelect: Type.Optional(Type.Boolean()),
          options: Type.Array(
            Type.Object({
              label: Type.String(),
              description: Type.Optional(Type.String()),
            }),
            { minItems: 2 }
          ),
        }),
        { minItems: 1 }
      ),
    }),
    async execute(toolCallId, params, signal) {
      const requestId = `${skillId}:${toolCallId}`;
      const answerText = await new Promise<string>((resolve, reject) => {
        pendingQuestions.set(requestId, resolve);
        signal?.addEventListener("abort", () => {
          pendingQuestions.delete(requestId);
          reject(new Error("Question cancelled"));
        });
        const line = JSON.stringify({
          type: "skill-event",
          skillId,
          event: { type: "ask_user_question", requestId, questions: params.questions },
        });
        process.stdout.write(line + "\n");
      });
      return { content: [{ type: "text" as const, text: answerText }], details: {} };
    },
  });
}

function formatAnswers(answers: QuestionAnswer[]): string {
  return answers
    .map((a) => `"${a.question}" → ${a.selected.join(", ")}`)
    .join("\n");
}

// Non-interactive compat stubs: Claude Code skills call these tools and have
// their own degradation paths for the strings we return (see
// .plans/claude-code-compat.md).
const exitPlanModeTool = defineTool({
  name: "ExitPlanMode",
  label: "Exit Plan Mode",
  description:
    "Signal that planning is complete and implementation may begin. " +
    "Returns approval to proceed.",
  parameters: Type.Object({
    plan: Type.Optional(Type.String({ description: "The plan that was made" })),
  }),
  async execute() {
    return {
      content: [
        { type: "text" as const, text: "Plan approved. Proceed with implementation." },
      ],
      details: {},
    };
  },
});

// TodoWrite shim: gstack/Claude Code skills track plans with it. Records the
// list and emits a todo_update event (the PlanTracker component can render it).
function makeTodoWriteTool(skillId: string) {
  return defineTool({
    name: "TodoWrite",
    label: "Todo Write",
    description: "Record/update the task list for the current workflow.",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String(),
          status: Type.Optional(Type.String()),
          activeForm: Type.Optional(Type.String()),
        })
      ),
    }),
    async execute(_id, params) {
      const line = JSON.stringify({
        type: "skill-event",
        skillId,
        event: { type: "todo_update", todos: params.todos },
      });
      process.stdout.write(line + "\n");
      return { content: [{ type: "text" as const, text: "Todos updated." }], details: {} };
    },
  });
}

// Agent/Task shim: Claude Code skills delegate to subagents. Here a delegated
// task spawns a fresh child Pi session, runs the prompt, returns its output.
function makeAgentTool(skillId: string, cwd: string) {
  return defineTool({
    name: "Agent",
    label: "Subagent",
    description:
      "Delegate a self-contained sub-task to a fresh agent that returns its result.",
    parameters: Type.Object({
      description: Type.Optional(Type.String()),
      prompt: Type.String({ description: "The task for the subagent" }),
    }),
    async execute(_id, params, signal) {
      const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
      await loader.reload();
      const { session: child } = await createAgentSession({ cwd, resourceLoader: loader });
      try {
        let result = "";
        const done = new Promise<void>((resolve) => {
          child.subscribe((e: AgentSessionEvent) => {
            if (e.type === "message_update") result = extractText((e as any).message);
            if (e.type === "agent_end") resolve();
          });
          signal?.addEventListener("abort", () => resolve());
        });
        // Surface subagent activity to the parent window's terminal.
        emitEvent(skillId, {
          type: "tool_execution_start",
          toolCallId: `agent-${_id}`,
          toolName: "Agent",
          args: { task: params.description ?? params.prompt.slice(0, 80) },
        } as any);
        await child.prompt(params.prompt);
        await done;
        return { content: [{ type: "text" as const, text: result || "(subagent returned nothing)" }], details: {} };
      } finally {
        child.dispose();
      }
    },
  });
}

const webSearchTool = defineTool({
  name: "WebSearch",
  label: "Web Search",
  description: "Search the web. Currently unavailable in this harness.",
  parameters: Type.Object({
    query: Type.String(),
  }),
  async execute() {
    return {
      content: [
        {
          type: "text" as const,
          text: "Search unavailable — proceeding with in-distribution knowledge only.",
        },
      ],
      details: {},
    };
  },
});

// Skill ids resolve through the discovery registry: global ids map to
// ~/.claude/skills/<id>, namespaced ids ("helion:tpu") to project dirs.
function resolveSkill(skillId: string): Skill | null {
  const dir = skillDirFor(skillId);
  if (!existsSync(join(dir, "SKILL.md"))) {
    process.stderr.write(`[sidecar] no SKILL.md for ${skillId} at ${dir}\n`);
    return null;
  }
  const { skills } = loadSkillsFromDir({ dir, source: "recursiveui" });
  return skills[0] ?? null;
}

function respond(reqId: unknown, data: Record<string, unknown>) {
  const line = JSON.stringify({ type: "response", reqId, ...data });
  process.stdout.write(line + "\n");
}

// Per-skill transcript so reopened windows can replay the conversation.
// Streaming text deltas are collapsed (message text is cumulative), so one
// agent turn costs one entry, not hundreds.
const transcripts = new Map<string, Record<string, unknown>[]>();
const MAX_TRANSCRIPT_EVENTS = 500;

function record(skillId: string, event: Record<string, unknown>) {
  const arr = transcripts.get(skillId) ?? [];
  const last = arr[arr.length - 1];
  if (event.type === "message_update" && last?.type === "message_update") {
    arr[arr.length - 1] = event;
  } else {
    arr.push(event);
    if (arr.length > MAX_TRANSCRIPT_EVENTS) arr.shift();
  }
  transcripts.set(skillId, arr);
}

function emitEvent(skillId: string, event: AgentSessionEvent) {
  const payload = buildEventPayload(event);
  record(skillId, payload);
  logToLedger(skillId, payload);
  const line = JSON.stringify({ type: "skill-event", skillId, event: payload });
  process.stdout.write(line + "\n");
}

// Tools the session actually provides (Pi builtins + our shims), normalized.
const PROVIDED_TOOLS = new Set([
  "read", "edit", "write", "bash", "grep", "glob", "find", "ls",
  "askuserquestion", "exitplanmode", "websearch", "todowrite", "agent",
]);

// Capability audit: surface which of a skill's allowed-tools have no home here,
// so breakage is visible before the agent hits a missing tool.
async function computeCapability(skillId: string) {
  const manifest = await parseSkillManifest(skillId);
  const allowed = manifest?.allowedTools ?? [];
  const missing = allowed.filter((t) => !PROVIDED_TOOLS.has(t.toLowerCase().replace(/\s+/g, "")));
  return { allowed: allowed.length, missing };
}

// Routing ledger: classify each agent event and record where the genome sent it.
function logToLedger(skillId: string, payload: Record<string, any>) {
  const entry = sessions.get(skillId);
  if (!entry) return;
  try {
    if (!entry.firstOutputLogged && payload.type === "message_update") {
      entry.firstOutputLogged = true;
      logFunnel(entry.telemetrySessionId, skillId, "first_agent_output");
    }
    const cls = classifyEvent(payload);
    if (!cls) return;
    const { slotId, outcome } = route(entry.genome, payload.type, cls.payloadClass, cls.tool);
    logRouting(
      entry.telemetrySessionId,
      skillId,
      payload.type,
      cls.payloadClass,
      cls.bytes,
      slotId,
      outcome,
      cls.tool
    );
  } catch (err) {
    process.stderr.write(`[sidecar] ledger write failed: ${err}\n`);
  }
}

function buildEventPayload(event: AgentSessionEvent): Record<string, unknown> {
  return {
    type: event.type,
      ...(event.type === "message_update"
        ? {
            text: extractText(event.message),
            thinking: extractThinking(event.message),
          }
        : {}),
      ...(event.type === "auto_retry_start"
        ? {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
          }
        : {}),
      ...(event.type === "compaction_start" || event.type === "compaction_end"
        ? { reason: event.reason }
        : {}),
      ...(event.type === "queue_update"
        ? {
            steering: event.steering?.length ?? 0,
            followUp: event.followUp?.length ?? 0,
          }
        : {}),
      ...(event.type === "tool_execution_start"
        ? {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
          }
        : {}),
      ...(event.type === "tool_execution_end"
        ? {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            result: truncateResult(event.result),
            isError: event.isError,
          }
        : {}),
      ...(event.type === "agent_end"
        ? {
            messages: event.messages?.map((m: any) => ({
              role: m.role,
              content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            })),
          }
        : {}),
  };
}

function extractThinking(message: any): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((block: any) => block.type === "thinking" && !block.redacted)
    .map((block: any) => block.thinking)
    .join("");
}

function extractText(message: any): string {
  if (!message?.content) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("");
  }
  return "";
}

function truncateResult(result: any): any {
  const str = typeof result === "string" ? result : JSON.stringify(result);
  if (str.length > 5000) return str.slice(0, 5000) + "\n...[truncated]";
  return result;
}

async function handleMessage(msg: Record<string, any>) {
  const reply = (data: Record<string, unknown>) => respond(msg.reqId, data);
  try {
    switch (msg.type) {
      case "create-session": {
        const { skillId, cwd } = msg;
        const workingDir = cwd || process.cwd();

        // Reuse a live session: windows close and reopen, the conversation
        // must survive. Overwriting here would orphan the old session.
        const existing = sessions.get(skillId);
        if (existing) {
          reply({
            ok: true,
            skillId,
            existing: true,
            skill: existing.skill?.name ?? null,
          });
          break;
        }

        const skill = resolveSkill(skillId);
        const loader = new DefaultResourceLoader({
          cwd: workingDir,
          agentDir: getAgentDir(),
          ...(skill ? { additionalSkillPaths: [skill.baseDir] } : {}),
        });
        await loader.reload();

        const { session } = await createAgentSession({
          cwd: workingDir,
          resourceLoader: loader,
          customTools: [
            makeAskUserQuestionTool(skillId),
            exitPlanModeTool,
            webSearchTool,
            makeTodoWriteTool(skillId),
            makeAgentTool(skillId, workingDir),
          ],
        });

        session.subscribe((event: AgentSessionEvent) => {
          emitEvent(skillId, event);
        });

        // Telemetry session: load the genome for routing, open a session row.
        const genome = loadGenome(skillId);
        const telemetrySessionId = randomUUID();
        startSession(telemetrySessionId, skillId, genome ? genomeHash(genome) : "legacy");
        logFunnel(telemetrySessionId, skillId, "window_open");

        sessions.set(skillId, {
          session,
          skill,
          skillPrimed: false,
          telemetrySessionId,
          genome,
          firstOutputLogged: false,
        });

        // Capability report: which tools the skill expects but we don't provide.
        const capability = await computeCapability(skillId);
        reply({ ok: true, skillId, skill: skill?.name ?? null, capability });
        break;
      }

      case "invoke": {
        const { skillId, prompt } = msg;
        const entry = sessions.get(skillId);
        if (!entry) {
          reply({ ok: false, error: `No session for ${skillId}` });
          break;
        }
        // Skills only put name+description in the system prompt; the model
        // must read SKILL.md itself. Force that on the first prompt.
        let fullPrompt = prompt;
        if (entry.skill && !entry.skillPrimed) {
          entry.skillPrimed = true;
          fullPrompt =
            `First read ${entry.skill.filePath} and follow that skill's ` +
            `workflow for this request.\n\n${prompt}`;
        }
        record(skillId, { type: "user_message", text: prompt });
        bumpPromptCount(entry.telemetrySessionId);
        logFunnel(entry.telemetrySessionId, skillId, "first_prompt");
        reply({ ok: true, skillId, status: "started" });
        await entry.session.prompt(fullPrompt);
        break;
      }

      case "steer": {
        const { skillId, text } = msg;
        const entry = sessions.get(skillId);
        if (!entry) {
          reply({ ok: false, error: `No session for ${skillId}` });
          break;
        }
        record(skillId, { type: "user_message", text });
        await entry.session.steer(text);
        reply({ ok: true, skillId });
        break;
      }

      case "get-history": {
        const { skillId } = msg;
        reply({
          ok: true,
          skillId,
          hasSession: sessions.has(skillId),
          events: transcripts.get(skillId) ?? [],
        });
        break;
      }

      case "generate-ui": {
        const { skillId } = msg;
        const result = await generateUi(skillId, (update) =>
          emitGenerationProgress(skillId, update)
        );
        reply({ ok: result.ok, skillId, code: result.code, error: result.error });
        break;
      }

      case "discover-skills": {
        const skills = await discoverSkills();
        reply({ ok: true, skills, priority: PRIORITY_SKILLS });
        break;
      }

      case "modify-ui": {
        const { skillId, instruction } = msg;
        const result = await modifyUi(skillId, instruction, (update) =>
          emitGenerationProgress(skillId, update)
        );
        if (result.ok) emitUiUpdated(skillId);
        reply({ ok: result.ok, skillId, code: result.code, tsx: result.tsx, error: result.error });
        break;
      }

      case "list-ui-versions": {
        const { skillId } = msg;
        const versions = await listUiVersions(skillId);
        reply({ ok: true, skillId, versions });
        break;
      }

      case "revert-ui": {
        const { skillId, hash } = msg;
        const result = await revertUi(skillId, hash);
        if (result.ok) emitUiUpdated(skillId);
        reply({ ok: result.ok, skillId, code: result.code, error: result.error });
        break;
      }

      case "batch-generate": {
        const skillIds: string[] = msg.skillIds?.length ? msg.skillIds : PRIORITY_SKILLS;
        const result = await batchGenerate(skillIds, (skillId, update) =>
          emitGenerationProgress(skillId, update, true)
        );
        reply({ ok: true, ...result });
        break;
      }

      case "load-ui": {
        const { skillId } = msg;
        const code = await loadCompiledUi(skillId);
        if (code === null) {
          reply({ ok: false, skillId, error: "not-generated" });
        } else {
          const genome = loadGenome(skillId);
          reply({ ok: true, skillId, code, tokens: genome?.tokens ?? null });
        }
        break;
      }

      case "answer-question": {
        const { requestId, answers } = msg;
        const resolve = pendingQuestions.get(requestId);
        if (!resolve) {
          reply({ ok: false, error: `No pending question ${requestId}` });
          break;
        }
        pendingQuestions.delete(requestId);
        resolve(formatAnswers(answers as QuestionAnswer[]));
        reply({ ok: true, requestId });
        break;
      }

      case "cancel": {
        const { skillId } = msg;
        const entry = sessions.get(skillId);
        if (entry) {
          endSession(entry.telemetrySessionId, "cancel");
          entry.session.dispose();
          sessions.delete(skillId);
        }
        transcripts.delete(skillId);
        reply({ ok: true, skillId });
        break;
      }

      case "scorecard": {
        const { skillId } = msg;
        reply({ ok: true, skillId, scorecard: scorecard(skillId) });
        break;
      }

      case "run-evolution": {
        const { skillId } = msg;
        const result = await runEvolutionCycle(skillId);
        if (result.adapted) {
          // Refresh the cached genome and hot-reload any open window.
          const entry = sessions.get(skillId);
          if (entry) entry.genome = loadGenome(skillId);
          emitUiUpdated(skillId);
          // Toast the user via the existing skill-event channel.
          const line = JSON.stringify({
            type: "skill-event",
            skillId,
            event: {
              type: "evolution",
              adaptationId: result.adaptationId,
              change: result.change,
              rationale: result.rationale,
            },
          });
          process.stdout.write(line + "\n");
        }
        reply({ ok: true, ...result });
        break;
      }

      case "evolution-keep": {
        const { skillId, adaptationId } = msg;
        setAdaptationStatus(adaptationId, "confirmed");
        recordPreference(skillId, "keep", adaptationId);
        const kept = getAdaptation(adaptationId);
        if (kept) updatePattern(kept.kind, "confirm", kept.rationale); // human keep = strong signal
        reply({ ok: true, skillId });
        break;
      }

      case "evolution-revert": {
        const { skillId, adaptationId } = msg;
        const a = getAdaptation(adaptationId);
        if (!a) {
          reply({ ok: false, error: `no adaptation ${adaptationId}` });
          break;
        }
        const parent = JSON.parse(a.parent_genome) as LayoutGenome;
        const res = await commitGenome(skillId, parent, `revert ${adaptationId.slice(0, 8)} (user)`);
        setAdaptationStatus(adaptationId, "reverted_user", Date.now() + 1000 * 60 * 60 * 24);
        recordPreference(skillId, "revert", adaptationId);
        updatePattern(a.kind, "refute", a.rationale); // human revert = strong negative
        const entry = sessions.get(skillId);
        if (entry) entry.genome = parent;
        if (res.ok) emitUiUpdated(skillId);
        reply({ ok: res.ok, skillId, code: res.code, error: res.error });
        break;
      }

      default:
        reply({ ok: false, error: `Unknown message type: ${msg.type}` });
    }
  } catch (err: any) {
    reply({ ok: false, error: err.message || String(err) });
  }
}

// Read JSON-line messages from stdin
const decoder = new TextDecoder();
let buffer = "";

process.stdin.on("data", (chunk: Buffer) => {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch (err) {
      console.error("[sidecar] failed to parse message:", line, err);
    }
  }
});

process.stderr.write("[sidecar] Pi sidecar ready\n");
