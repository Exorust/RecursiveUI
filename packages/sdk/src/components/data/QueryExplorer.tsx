import { useMemo } from "react";
import { Flex, Box, Text, Code, Table, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

/**
 * Query + results view: surfaces the latest SQL-ish query the agent ran and
 * any markdown result table in its output. For data/analytics skills.
 */
export function QueryExplorer({ skill, title = "Query" }: Props) {
  const query = useMemo(() => extractQuery(skill.output, skill.tools), [skill.output, skill.tools]);
  const table = useMemo(() => extractTable(skill.output), [skill.output]);

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Box px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
      </Box>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="3" p="3">
          {!query && !table && (
            <Text size="1" color="gray" align="center" mt="5">Queries and result tables appear here</Text>
          )}
          {query && (
            <Code variant="soft" style={{ display: "block", whiteSpace: "pre-wrap", padding: 12 }}>
              {query}
            </Code>
          )}
          {table && (
            <Table.Root size="1" variant="surface">
              <Table.Header>
                <Table.Row>
                  {table.headers.map((h, i) => (
                    <Table.ColumnHeaderCell key={i}>{h}</Table.ColumnHeaderCell>
                  ))}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {table.rows.map((row, ri) => (
                  <Table.Row key={ri}>
                    {row.map((cell, ci) => (
                      <Table.Cell key={ci}>{cell}</Table.Cell>
                    ))}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function extractQuery(output: string, tools: { args?: any; result?: unknown }[]): string | null {
  const sql = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH)\b[\s\S]{0,400}?;/i;
  for (let i = tools.length - 1; i >= 0; i--) {
    const cmd = typeof tools[i]!.args === "string" ? tools[i]!.args : tools[i]!.args?.command || tools[i]!.args?.query || "";
    const m = String(cmd).match(sql);
    if (m) return m[0].trim();
  }
  const m = output.match(sql);
  return m ? m[0].trim() : null;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function extractTable(output: string): ParsedTable | null {
  const lines = output.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i]!) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]!)) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const headers = cells(lines[i]!);
      const rows: string[][] = [];
      for (let j = i + 2; j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j]!); j++) {
        rows.push(cells(lines[j]!));
      }
      return { headers, rows: rows.slice(0, 50) };
    }
  }
  return null;
}
