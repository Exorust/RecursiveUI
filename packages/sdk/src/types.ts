export interface SkillContext {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  type: SkillType;
  source: SkillSource;
}

export type SkillCategory =
  | "coding"
  | "research"
  | "communication"
  | "automation"
  | "data"
  | "ops"
  | "design";

export type SkillType =
  | "single-action"
  | "conversational"
  | "monitoring"
  | "workflow";

export type SkillSource =
  | "personal"
  | "community"
  | "generic";

export interface ComponentManifestEntry {
  name: string;
  props: string;
  purpose: string;
  bestFor: readonly string[];
  pack: "core" | "coding" | "communication" | "research" | "ops" | "data" | "design" | "layout";
}
