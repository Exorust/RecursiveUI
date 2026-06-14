import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface SkillSection {
  heading: string;
  summary: string;
}

export interface SkillManifest {
  skillId: string;
  name: string;
  description: string;
  allowedTools: string[];
  sections: SkillSection[];
}

const MAX_SECTIONS = 15;
const MAX_SUMMARY_CHARS = 300;

// skillId → SKILL.md dir registry, populated by discovery. Project/pi skills
// live outside ~/.claude/skills, so everything that loads a SKILL.md by id
// resolves through here.
const skillPaths = new Map<string, string>();

export function registerSkillPath(skillId: string, dir: string) {
  skillPaths.set(skillId, dir);
}

export function skillDirFor(skillId: string): string {
  return skillPaths.get(skillId) ?? join(homedir(), ".claude", "skills", skillId);
}

/**
 * Parse a Claude Code SKILL.md into a compact manifest for the generation
 * prompt: frontmatter fields plus each section heading with its first
 * paragraph. Regex-based on purpose — skill frontmatter is shallow YAML.
 *
 * `dir` overrides the default ~/.claude/skills/<id> location (project and
 * pi skills live elsewhere; see discovery.ts skillDirFor).
 */
export async function parseSkillManifest(
  skillId: string,
  dir?: string
): Promise<SkillManifest | null> {
  const baseDir = dir ?? skillDirFor(skillId);
  const path = join(baseDir, "SKILL.md");
  if (!existsSync(path)) return null;
  const raw = await Bun.file(path).text();

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = fmMatch?.[1] ?? "";
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || skillId;
  const description =
    frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";

  const allowedTools: string[] = [];
  const toolsBlock = frontmatter.match(/^allowed-tools:\n((?:\s+-\s*.+\n?)+)/m)?.[1];
  if (toolsBlock) {
    for (const line of toolsBlock.split("\n")) {
      const tool = line.match(/^\s+-\s*(.+)$/)?.[1]?.trim();
      if (tool) allowedTools.push(tool);
    }
  }

  const sections: SkillSection[] = [];
  const sectionMatches = body.split(/^##\s+/m).slice(1);
  for (const block of sectionMatches.slice(0, MAX_SECTIONS)) {
    const lines = block.split("\n");
    const heading = lines[0]?.trim() || "";
    // First non-empty, non-code, non-heading paragraph
    let summary = "";
    let inCode = false;
    for (const line of lines.slice(1)) {
      if (line.trim().startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode || !line.trim() || line.startsWith("#")) {
        if (summary) break;
        continue;
      }
      summary += (summary ? " " : "") + line.trim();
      if (summary.length > MAX_SUMMARY_CHARS) break;
    }
    sections.push({ heading, summary: summary.slice(0, MAX_SUMMARY_CHARS) });
  }

  return { skillId, name, description, allowedTools, sections };
}
