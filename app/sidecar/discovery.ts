import { homedir } from "node:os";
import { basename, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { parseSkillManifest, registerSkillPath } from "./skill-manifest";
import { compiledPath } from "./generator";

export type SkillCategory =
  | "coding"
  | "ops"
  | "design"
  | "content"
  | "research"
  | "testing"
  | "planning"
  | "other";

/** Design-doc tiers: personal skills rank first, community (gstack) UIs next. */
export type SkillTier = "personal" | "community" | "generic";

export interface DiscoveredSkill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  tier: SkillTier;
  /** Absolute dir containing SKILL.md */
  dir: string;
  hasUi: boolean;
}

// Build plan's priority 10 — the steel-thread skills that get UIs first
export const PRIORITY_SKILLS = [
  "gstack-review",
  "gstack-ship",
  "gstack-investigate",
  "gstack-office-hours",
  "gstack-qa",
  "gstack-browse",
  "gstack-design-consultation",
  "gstack-plan-ceo-review",
  "gstack-retro",
  "gstack-canary",
];

interface RecursiveUIConfig {
  projectRoots: string[];
}

function loadConfig(): RecursiveUIConfig {
  const configPath = join(homedir(), ".recursiveui", "config.json");
  try {
    if (existsSync(configPath)) {
      const parsed = JSON.parse(require("node:fs").readFileSync(configPath, "utf8"));
      if (Array.isArray(parsed.projectRoots)) {
        return { projectRoots: parsed.projectRoots.map(expandHome) };
      }
    }
  } catch (err) {
    process.stderr.write(`[sidecar] bad ~/.recursiveui/config.json: ${err}\n`);
  }
  return { projectRoots: [join(homedir(), "myproj")] };
}

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

const CATEGORY_RULES: [SkillCategory, RegExp][] = [
  ["testing", /\b(qa|test|verify|benchmark)\b/i],
  ["coding", /\b(review|code|refactor|tdd|debug|investigate|fix|issue|pre-commit|upgrade)\b/i],
  ["ops", /\b(ship|deploy|canary|release|freeze|unfreeze|land|incident|monitor|backup|guard)\b/i],
  ["design", /\b(design|brand|logo|ui|ux|visual|style)\b/i],
  ["content", /\b(seo|content|copy|email|marketing|ads|article|blog|editorial|landing)\b/i],
  ["research", /\b(research|browse|scrape|discovery|investigat|competitor|audit)\b/i],
  ["planning", /\b(plan|spec|roadmap|okr|retro|office.hours|strategy|prd)\b/i],
];

export function classify(skillId: string, name: string, description: string): SkillCategory {
  const haystack = `${skillId} ${name} ${description}`;
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(haystack)) return category;
  }
  return "other";
}

function skillDirsIn(root: string): string[] {
  if (!existsSync(root)) return [];
  const dirs: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = join(root, entry.name);
    if (existsSync(join(dir, "SKILL.md"))) dirs.push(dir);
  }
  return dirs;
}

interface SkillSource {
  skillId: string;
  dir: string;
  tier: SkillTier;
}

function collectSources(): SkillSource[] {
  const sources: SkillSource[] = [];

  // 1. Project skills (personal, design-doc tier 1): <root>/<project>/.claude/skills/*
  //    and <root>/<project>/.agents/skills/*
  for (const projectRoot of loadConfig().projectRoots) {
    if (!existsSync(projectRoot)) continue;
    for (const proj of readdirSync(projectRoot, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue;
      for (const skillsDir of [".claude/skills", ".agents/skills"]) {
        for (const dir of skillDirsIn(join(projectRoot, proj.name, skillsDir))) {
          sources.push({
            skillId: `${proj.name}:${basename(dir)}`,
            dir,
            tier: "personal",
          });
        }
      }
    }
  }

  // 2. Pi skills (personal): ~/.pi/agent/skills
  for (const dir of skillDirsIn(join(homedir(), ".pi", "agent", "skills"))) {
    sources.push({ skillId: `pi:${basename(dir)}`, dir, tier: "personal" });
  }

  // 3. Global Claude Code skills: gstack-* are community, rest generic
  for (const dir of skillDirsIn(join(homedir(), ".claude", "skills"))) {
    const skillId = basename(dir);
    sources.push({
      skillId,
      dir,
      tier: skillId.startsWith("gstack-") ? "community" : "generic",
    });
  }

  return sources;
}

export async function discoverSkills(): Promise<DiscoveredSkill[]> {
  const results: DiscoveredSkill[] = [];

  for (const source of collectSources()) {
    registerSkillPath(source.skillId, source.dir);
    const manifest = await parseSkillManifest(source.skillId, source.dir);
    if (!manifest) continue;

    results.push({
      skillId: source.skillId,
      name: manifest.name,
      description: manifest.description.slice(0, 140),
      category: classify(source.skillId, manifest.name, manifest.description),
      tier: source.tier,
      dir: source.dir,
      hasUi: existsSync(compiledPath(source.skillId)),
    });
  }

  // Personal first (design doc), then community in priority order, then generic
  const tierRank: Record<SkillTier, number> = { personal: 0, community: 1, generic: 2 };
  const priorityRank = (s: DiscoveredSkill) => {
    const i = PRIORITY_SKILLS.indexOf(s.skillId);
    return i === -1 ? PRIORITY_SKILLS.length : i;
  };
  results.sort(
    (a, b) =>
      tierRank[a.tier] - tierRank[b.tier] ||
      priorityRank(a) - priorityRank(b) ||
      a.skillId.localeCompare(b.skillId)
  );
  return results;
}
