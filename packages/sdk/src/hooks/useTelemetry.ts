import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TelemetryHandle {
  track: (event: string, data?: Record<string, unknown>) => void;
}

export function useTelemetry(skillId: string): TelemetryHandle {
  const track = useCallback(
    (event: string, data?: Record<string, unknown>) => {
      invoke("track_telemetry", { skillId, event, data }).catch(() => {});
    },
    [skillId]
  );

  return { track };
}
