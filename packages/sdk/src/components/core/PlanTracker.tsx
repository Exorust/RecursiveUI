import { useMemo } from "react";
import { Flex, Box, Text, Progress, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

type TaskStatus = "done" | "active" | "todo";

interface PlanItem {
  status: TaskStatus;
  text: string;
}

/**
 * Checklist/plan view. Reads task lists from the agent's output — markdown
 * checkboxes (- [x] / - [ ]) and numbered steps — and shows progress. For
 * planning skills and as the surface for the TodoWrite compat tool.
 */
export function PlanTracker({ skill, title = "Plan" }: Props) {
  const items = useMemo(() => parsePlan(skill.output), [skill.output]);
  const done = items.filter((i) => i.status === "done").length;

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-2)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
        {items.length > 0 && <Text size="1" style={{ color: "var(--accent-10)" }}>{done}/{items.length}</Text>}
      </Flex>
      {items.length > 0 && (
        <Box px="3" pt="2">
          <Progress value={(done / items.length) * 100} size="1" />
        </Box>
      )}
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="1" p="2">
          {items.length === 0 ? (
            <Text size="1" color="gray" align="center" mt="5">Steps appear here as the agent plans</Text>
          ) : (
            items.map((item, i) => (
              <Flex key={i} gap="2" align="start" px="1" py="1">
                <Text size="2" style={{ color: glyphColor(item.status), width: 16, flexShrink: 0 }}>
                  {glyph(item.status)}
                </Text>
                <Text
                  size="2"
                  color={item.status === "done" ? "gray" : undefined}
                  style={item.status === "done" ? { textDecoration: "line-through" } : undefined}
                >
                  {item.text}
                </Text>
              </Flex>
            ))
          )}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function parsePlan(output: string): PlanItem[] {
  if (!output) return [];
  const items: PlanItem[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    let m = line.match(/^[-*]\s*\[([ xX~>])\]\s+(.*)/);
    if (m) {
      const mark = m[1]!.toLowerCase();
      items.push({
        status: mark === "x" ? "done" : mark === "~" || mark === ">" ? "active" : "todo",
        text: m[2]!,
      });
      continue;
    }
    m = line.match(/^\d+\.\s+(.*)/);
    if (m && m[1]!.length > 2) items.push({ status: "todo", text: m[1]! });
  }
  return items;
}

function glyph(status: TaskStatus): string {
  return status === "done" ? "✓" : status === "active" ? "▶" : "○";
}

function glyphColor(status: TaskStatus): string {
  return status === "done" ? "var(--green-9)" : status === "active" ? "var(--amber-9)" : "var(--gray-7)";
}
