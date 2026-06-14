import { useEffect, useState, useCallback, useRef, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { skillReducer, initialSkillState } from "./skillReducer";

export type SkillStatus = "idle" | "running" | "streaming" | "done" | "error";

export interface ToolUse {
  toolCallId: string;
  toolName: string;
  args: any;
  result?: any;
  isError?: boolean;
  status: "running" | "done";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface PendingQuestion {
  requestId: string;
  questions: UserQuestion[];
}

export interface QuestionAnswer {
  question: string;
  selected: string[];
}

export interface Capability {
  allowed: number;
  missing: string[];
}

export interface SkillHandle {
  invoke: (prompt: string) => Promise<void>;
  steer: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  answerQuestion: (requestId: string, answers: QuestionAnswer[]) => Promise<void>;
  capability: Capability | null;
  pendingQuestion: PendingQuestion | null;
  messages: ChatMessage[];
  output: string;
  status: SkillStatus;
  /** Transient signal line: "thinking…", "retrying 2/5 in 8s…", "compacting context…" */
  activity: string | null;
  tools: ToolUse[];
  error: string | null;
}

/*
 * Event flow — the same reducer consumes both paths:
 *
 *   live:    sidecar ──skill-event──► Rust emit ──listen()──► applyEvent
 *   replay:  sidecar transcript ──get_history──► for-each ──► applyEvent
 *
 * The sidecar keeps sessions and transcripts alive across window closes;
 * this hook rehydrates on mount so reopening a window restores the chat.
 */
export function useSkill(skillId: string, cwd?: string): SkillHandle {
  const [state, dispatch] = useReducer(skillReducer, initialSkillState);
  const { messages, output, status, tools, error, pendingQuestion, activity } = state;
  const [capability, setCapability] = useState<Capability | null>(null);
  const sessionCreated = useRef(false);
  const replayed = useRef(false);

  // Live events
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    const setup = async () => {
      unlisten = await listen<any>("skill-event", (event) => {
        const data = event.payload;
        if (data.skillId !== skillId) return;
        dispatch({ kind: "event", ev: data.event });
      });
    };
    setup();
    return () => {
      unlisten?.();
    };
  }, [skillId]);

  // History replay on mount (window reopen)
  useEffect(() => {
    if (replayed.current) return;
    replayed.current = true;
    (async () => {
      try {
        const res = await invoke<any>("get_history", { skillId });
        if (!res?.ok) return;
        if (res.hasSession) sessionCreated.current = true;
        const events = res.events || [];
        for (const ev of events) dispatch({ kind: "event", ev });
        // Don't leave a stale "streaming" badge from replayed history
        if (events.length > 0) {
          dispatch({ kind: "replaySettle", lastType: events[events.length - 1]?.type });
        }
      } catch (err) {
        console.warn("[recursiveui] history replay failed:", err);
      }
    })();
  }, [skillId]);

  const invokeSkill = useCallback(
    async (prompt: string) => {
      dispatch({ kind: "invoke" });
      dispatch({ kind: "user", text: prompt });

      try {
        if (!sessionCreated.current) {
          const res = await invoke<any>("create_session", {
            skillId,
            cwd: cwd || ".",
          });
          if (res?.capability) setCapability(res.capability);
          sessionCreated.current = true;
        }
        await invoke("invoke_skill", { skillId, prompt });
      } catch (err: any) {
        dispatch({ kind: "error", error: err.toString() });
      }
    },
    [skillId, cwd]
  );

  const steer = useCallback(
    async (text: string) => {
      dispatch({ kind: "user", text });
      try {
        await invoke("steer_skill", { skillId, text });
      } catch (err: any) {
        dispatch({ kind: "error", error: err.toString() });
      }
    },
    [skillId]
  );

  const cancel = useCallback(async () => {
    try {
      await invoke("cancel_skill", { skillId });
      dispatch({ kind: "idle" });
      sessionCreated.current = false;
    } catch (err: any) {
      dispatch({ kind: "error", error: err.toString() });
    }
  }, [skillId]);

  const answerQuestion = useCallback(
    async (requestId: string, answers: QuestionAnswer[]) => {
      try {
        await invoke("answer_question", { skillId, requestId, answers });
        dispatch({ kind: "clearQuestion" });
      } catch (err: any) {
        dispatch({ kind: "error", error: err.toString() });
      }
    },
    [skillId]
  );

  return {
    invoke: invokeSkill,
    steer,
    cancel,
    answerQuestion,
    capability,
    pendingQuestion,
    messages,
    output,
    status,
    activity,
    tools,
    error,
  };
}
