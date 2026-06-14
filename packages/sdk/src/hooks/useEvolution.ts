import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface VersionEntry {
  hash: string;
  message: string;
  timestamp: string;
  isEvolution: boolean;
}

export interface EvolutionHandle {
  version: string;
  history: VersionEntry[];
  revert: (hash: string) => Promise<void>;
  lock: () => Promise<void>;
  unlock: () => Promise<void>;
  isLocked: boolean;
}

export function useEvolution(skillId: string): EvolutionHandle {
  const [version, setVersion] = useState("");
  const [history, setHistory] = useState<VersionEntry[]>([]);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    invoke<{ version: string; history: VersionEntry[]; locked: boolean }>(
      "get_evolution_state",
      { skillId }
    )
      .then((state) => {
        setVersion(state.version);
        setHistory(state.history);
        setIsLocked(state.locked);
      })
      .catch(() => {});
  }, [skillId]);

  const revert = useCallback(
    async (hash: string) => {
      await invoke("revert_component", { skillId, hash });
      setVersion(hash);
    },
    [skillId]
  );

  const lock = useCallback(async () => {
    await invoke("lock_evolution", { skillId });
    setIsLocked(true);
  }, [skillId]);

  const unlock = useCallback(async () => {
    await invoke("unlock_evolution", { skillId });
    setIsLocked(false);
  }, [skillId]);

  return { version, history, revert, lock, unlock, isLocked };
}
