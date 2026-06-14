import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ModelHandle {
  current: string;
  available: string[];
  setModel: (modelId: string) => Promise<void>;
}

export function useModel(skillId: string): ModelHandle {
  const [current, setCurrent] = useState("");
  const [available, setAvailable] = useState<string[]>([]);

  useEffect(() => {
    invoke<{ current: string; available: string[] }>("get_model_state", {
      skillId,
    })
      .then((state) => {
        setCurrent(state.current);
        setAvailable(state.available);
      })
      .catch(() => {});
  }, [skillId]);

  const setModel = useCallback(
    async (modelId: string) => {
      await invoke("set_model", { skillId, modelId });
      setCurrent(modelId);
    },
    [skillId]
  );

  return { current, available, setModel };
}
