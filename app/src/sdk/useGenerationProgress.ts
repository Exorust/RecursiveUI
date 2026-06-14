import { useState, useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface GenerationProgressState {
  phase: string;
  thinking?: string;
  text?: string;
  detail?: string;
  batch?: boolean;
}

const TERMINAL_PHASES = new Set(["done", "error", "skipped"]);

/**
 * Live view of a skill's UI generation: phases (planning → prompting →
 * generating → compiling → done) plus the generation model's cumulative
 * thinking/output streams. `active` is false once a terminal phase lands.
 */
export function useGenerationProgress(skillId: string | null) {
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);

  useEffect(() => {
    setProgress(null);
    if (!skillId) return;
    let unlisten: UnlistenFn | undefined;
    const setup = async () => {
      unlisten = await listen<any>("skill-event", (event) => {
        const data = event.payload;
        if (data.skillId !== skillId) return;
        if (data.event?.type !== "ui_generation") return;
        const { type: _type, ...update } = data.event;
        setProgress(update as GenerationProgressState);
      });
    };
    setup();
    return () => {
      unlisten?.();
    };
  }, [skillId]);

  const active = !!progress && !TERMINAL_PHASES.has(progress.phase);
  return { progress, active };
}
