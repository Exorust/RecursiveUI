import type {
  ChatMessage,
  PendingQuestion,
  SkillStatus,
  ToolUse,
} from "./useSkill";

/*
 * Pure reducer for a skill window's live state. Extracted from useSkill so the
 * subtle parts — assistant-message turn bubbling, history replay, the
 * thinking/activity signal, tool lifecycle — are unit-testable without React.
 *
 * `newTurn` lives in state (not a ref): it's true when the next assistant text
 * should open a fresh chat bubble rather than append to the last one.
 */
export interface SkillState {
  messages: ChatMessage[];
  output: string;
  status: SkillStatus;
  tools: ToolUse[];
  error: string | null;
  pendingQuestion: PendingQuestion | null;
  activity: string | null;
  newTurn: boolean;
}

export const initialSkillState: SkillState = {
  messages: [],
  output: "",
  status: "idle",
  tools: [],
  error: null,
  pendingQuestion: null,
  activity: null,
  newTurn: true,
};

export type SkillAction =
  | { kind: "event"; ev: any } // a skill-event payload (live or replayed)
  | { kind: "user"; text: string } // user prompt/steer appended locally
  | { kind: "invoke" } // start of an invoke: reset output/error, go running
  | { kind: "error"; error: string }
  | { kind: "idle" } // cancel
  | { kind: "clearQuestion" }
  | { kind: "replaySettle"; lastType?: string }; // fix trailing status after replay

export function skillReducer(state: SkillState, action: SkillAction): SkillState {
  switch (action.kind) {
    case "user":
      return {
        ...state,
        newTurn: true,
        messages: [...state.messages, { role: "user", content: action.text }],
      };

    case "invoke":
      return { ...state, output: "", error: null, status: "running", newTurn: true };

    case "error":
      return { ...state, error: action.error, status: "error" };

    case "idle":
      return { ...state, status: "idle", pendingQuestion: null };

    case "clearQuestion":
      return { ...state, pendingQuestion: null };

    case "replaySettle":
      return {
        ...state,
        status: action.lastType === "agent_end" ? "done" : "idle",
        activity: null,
      };

    case "event":
      return reduceEvent(state, action.ev);
  }
}

function reduceEvent(state: SkillState, ev: any): SkillState {
  switch (ev?.type) {
    case "user_message":
      // Replay only — live user messages come via the "user" action.
      if (!ev.text) return { ...state, newTurn: true };
      return {
        ...state,
        newTurn: true,
        messages: [...state.messages, { role: "user", content: ev.text }],
      };

    case "agent_start":
      return { ...state, status: "running", activity: "working…" };

    case "message_update": {
      if (!ev.text && !ev.thinking) return { ...state, status: "streaming" };
      const startNew = state.newTurn;
      const updated: ChatMessage = {
        role: "assistant",
        content: ev.text || "",
        ...(ev.thinking ? { thinking: ev.thinking } : {}),
      };
      const last = state.messages[state.messages.length - 1];
      const messages =
        last?.role === "assistant" && !startNew
          ? [...state.messages.slice(0, -1), { ...last, ...updated }]
          : [...state.messages, updated];
      return {
        ...state,
        status: "streaming",
        // Visible text supersedes the thinking signal.
        activity: ev.text ? null : "thinking…",
        output: ev.text ? ev.text : state.output,
        newTurn: false,
        messages,
      };
    }

    case "auto_retry_start":
      return {
        ...state,
        activity: `provider error — retrying ${ev.attempt}/${ev.maxAttempts} in ${Math.round(
          (ev.delayMs || 0) / 1000
        )}s…`,
      };

    case "compaction_start":
      return { ...state, activity: "compacting context…" };

    case "compaction_end":
      return { ...state, activity: null };

    case "tool_execution_start":
      return {
        ...state,
        activity: null,
        tools: [
          ...state.tools,
          {
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            args: ev.args,
            status: "running",
          },
        ],
      };

    case "tool_execution_end":
      return {
        ...state,
        tools: state.tools.map((t) =>
          t.toolCallId === ev.toolCallId
            ? { ...t, result: ev.result, isError: ev.isError, status: "done" as const }
            : t
        ),
      };

    case "ask_user_question":
      return {
        ...state,
        activity: "waiting for your answer…",
        pendingQuestion: { requestId: ev.requestId, questions: ev.questions || [] },
      };

    case "agent_end":
      return {
        ...state,
        status: "done",
        activity: null,
        pendingQuestion: null,
        newTurn: true,
      };

    default:
      return state;
  }
}
