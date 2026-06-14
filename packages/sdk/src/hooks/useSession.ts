import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "./useSkill";

export interface SessionHandle {
  prompt: (text: string) => Promise<void>;
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  messages: ChatMessage[];
  isStreaming: boolean;
}

export function useSession(skillId: string): SessionHandle {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const prompt = useCallback(
    async (text: string) => {
      setIsStreaming(true);
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      await invoke("invoke_skill", { skillId, prompt: text });
    },
    [skillId]
  );

  const steer = useCallback(
    async (text: string) => {
      await invoke("steer_skill", { skillId, text });
    },
    [skillId]
  );

  const followUp = useCallback(
    async (text: string) => {
      await invoke("follow_up_skill", { skillId, text });
    },
    [skillId]
  );

  return { prompt, steer, followUp, messages, isStreaming };
}
