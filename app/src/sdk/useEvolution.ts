import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface EvolutionToast {
  adaptationId: string;
  change: string;
  rationale: string;
}

/**
 * Listens for evolution events on a skill: when the loop ships a change, a
 * toast surfaces with keep/revert. One tap is a gold preference label.
 */
export function useEvolution(skillId: string) {
  const [toast, setToast] = useState<EvolutionToast | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<any>("skill-event", (event) => {
      const data = event.payload;
      if (data.skillId !== skillId) return;
      if (data.event?.type !== "evolution") return;
      setToast({
        adaptationId: data.event.adaptationId,
        change: data.event.change,
        rationale: data.event.rationale,
      });
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [skillId]);

  const keep = useCallback(async () => {
    if (!toast) return;
    await invoke("evolution_keep", { skillId, adaptationId: toast.adaptationId });
    setToast(null);
  }, [skillId, toast]);

  const revert = useCallback(async () => {
    if (!toast) return;
    await invoke("evolution_revert", { skillId, adaptationId: toast.adaptationId });
    setToast(null);
    // The genome reverted on disk; reload the window to pick up the prior UI.
    window.location.reload();
  }, [skillId, toast]);

  const dismiss = useCallback(() => setToast(null), []);

  return { toast, keep, revert, dismiss };
}
