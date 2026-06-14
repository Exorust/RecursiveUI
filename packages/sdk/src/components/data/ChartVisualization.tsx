import { useMemo } from "react";
import { Flex, Box, Text, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

interface Row {
  label: string;
  value: number;
}

/**
 * Lightweight bar chart over tabular numbers the agent emits — markdown
 * tables or "label: number" lines. For data/analytics skills. Pure CSS bars;
 * no chart lib dependency.
 */
export function ChartVisualization({ skill, title = "Data" }: Props) {
  const rows = useMemo(() => extractRows(skill.output), [skill.output]);
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
        {rows.length > 0 && <Text size="1" color="gray">{rows.length} rows</Text>}
      </Flex>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="2" p="3">
          {rows.length === 0 ? (
            <Text size="1" color="gray" align="center" mt="5">Numeric results render as bars here</Text>
          ) : (
            rows.map((r, i) => (
              <Flex key={i} align="center" gap="2">
                <Text size="1" color="gray" truncate style={{ width: 120, flexShrink: 0 }}>{r.label}</Text>
                <Box style={{ flex: 1, height: 16, background: "var(--gray-3)", borderRadius: "var(--radius-2)", overflow: "hidden" }}>
                  <Box
                    style={{
                      width: `${(r.value / max) * 100}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, var(--accent-9), var(--accent-10))",
                    }}
                  />
                </Box>
                <Text size="1" style={{ width: 64, textAlign: "right", flexShrink: 0, color: "var(--accent-11)" }}>
                  {formatNum(r.value)}
                </Text>
              </Flex>
            ))
          )}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function extractRows(output: string): Row[] {
  if (!output) return [];
  const rows: Row[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    let m = line.match(/^\|\s*([^|]+?)\s*\|\s*([\d,.]+)\s*\|/);
    if (m) {
      const v = parseNum(m[2]!);
      if (v !== null) rows.push({ label: m[1]!.trim(), value: v });
      continue;
    }
    m = line.match(/^([A-Za-z][\w \-/]{0,40}?)\s*[:=]\s*([\d,.]+)\s*$/);
    if (m) {
      const v = parseNum(m[2]!);
      if (v !== null) rows.push({ label: m[1]!.trim(), value: v });
    }
  }
  return rows.slice(0, 30);
}

function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatNum(n: number): string {
  return n >= 1000 ? n.toLocaleString() : String(n);
}
