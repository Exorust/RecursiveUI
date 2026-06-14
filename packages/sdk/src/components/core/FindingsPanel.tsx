import { useMemo } from "react";
import { Flex, Box, Text, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
  emptyText?: string;
}

type FindingKind = "positive" | "negative" | "neutral";

interface Finding {
  kind: FindingKind;
  text: string;
}

/**
 * Live bullet panel: extracts markdown bullets and verdict glyphs from the
 * agent's streamed output. Used as "Findings" (Investigate) and
 * "Key Takeaways" (Office Hours).
 */
export function FindingsPanel({
  skill,
  title = "Findings",
  emptyText = "Findings appear here as the agent works",
}: Props) {
  const findings = useMemo(() => extractFindings(skill.output), [skill.output]);

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-2)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
        <Text size="1" color="gray">{findings.length}</Text>
      </Flex>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="1" p="2">
          {findings.length === 0 && (
            <Text size="1" color="gray" align="center" mt="5">{emptyText}</Text>
          )}
          {findings.map((f, i) => (
            <Box
              key={i}
              p="2"
              style={{
                background: "var(--gray-3)",
                borderRadius: "var(--radius-2)",
                borderLeft: `3px solid ${kindColor(f.kind)}`,
              }}
            >
              <Text size="2">
                <Text style={{ color: kindColor(f.kind), marginRight: 6 }}>{kindGlyph(f.kind)}</Text>
                {f.text}
              </Text>
            </Box>
          ))}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function extractFindings(output: string): Finding[] {
  if (!output) return [];
  const findings: Finding[] = [];

  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)/)?.[1];
    if (!bullet || bullet.length < 3) continue;

    let kind: FindingKind = "neutral";
    if (/^(✓|✅|☑)/.test(bullet) || /\b(confirmed|ruled out|passes|fixed)\b/i.test(bullet)) {
      kind = "positive";
    } else if (/^(✗|❌|⚠|❗)/.test(bullet) || /\b(suspect|fails?|error|broken|missing)\b/i.test(bullet)) {
      kind = "negative";
    }
    findings.push({ kind, text: bullet.replace(/^(✓|✅|☑|✗|❌|⚠|❗)\s*/, "") });
  }
  return findings;
}

function kindGlyph(kind: FindingKind): string {
  if (kind === "positive") return "☑";
  if (kind === "negative") return "⚠";
  return "•";
}

function kindColor(kind: FindingKind): string {
  if (kind === "positive") return "var(--green-9)";
  if (kind === "negative") return "var(--amber-9)";
  return "var(--gray-7)";
}
