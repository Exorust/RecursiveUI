import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SkillCategory, SkillType, SkillSource } from "../types";

export interface SkillMeta {
  name: string;
  description: string;
  category: SkillCategory;
  type: SkillType;
  source: SkillSource;
  params: Record<string, string>;
}

export function useSkillMeta(skillId: string): SkillMeta | null {
  const [meta, setMeta] = useState<SkillMeta | null>(null);

  useEffect(() => {
    invoke<SkillMeta>("get_skill_meta", { skillId })
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [skillId]);

  return meta;
}
