import { useMemo } from "react";
import { Flex, Box, Text, Badge, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
}

type ResultStatus = "pass" | "fail" | "running";

interface TestResult {
  status: ResultStatus;
  label: string;
}

/**
 * Scenario board: extracts pass/fail lines from the agent's output and tool
 * results (✓/✗ glyphs, PASS/FAIL markers, "N passed, M failed" summaries).
 */
export function TestResultsPanel({ skill }: Props) {
  const results = useMemo(
    () => extractResults(skill.output, skill.tools),
    [skill.output, skill.tools]
  );

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Test Results
        </Text>
        <Flex gap="2">
          {results.length === 0 ? (
            <Text size="1" color="gray">no results yet</Text>
          ) : (
            <>
              <Text size="1" color="green">{passed} passed</Text>
              <Text size="1" color={failed > 0 ? "red" : "gray"}>{failed} failed</Text>
            </>
          )}
        </Flex>
      </Flex>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="1" p="2">
          {results.length === 0 && (
            <Text size="1" color="gray" align="center" mt="5">
              {skill.status === "idle" ? "Run QA to see scenario results" : "Waiting for test results…"}
            </Text>
          )}
          {results.map((r, i) => (
            <Flex key={i} align="center" gap="2" p="2" style={{ background: "var(--gray-2)", borderRadius: "var(--radius-2)" }}>
              <Badge color={r.status === "pass" ? "green" : r.status === "fail" ? "red" : "amber"} variant="soft">
                {r.status === "pass" ? "✓ PASS" : r.status === "fail" ? "✗ FAIL" : "⟳ RUN"}
              </Badge>
              <Box style={{ flex: 1 }}>
                <Text size="2">{r.label}</Text>
              </Box>
            </Flex>
          ))}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function extractResults(output: string, tools: { result?: unknown }[]): TestResult[] {
  const sources = [output || ""];
  for (const tool of tools) {
    if (typeof tool.result === "string") sources.push(tool.result);
  }

  const results: TestResult[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const raw of source.split("\n")) {
      const line = raw.trim();
      const parsed = parseResultLine(line);
      if (parsed && !seen.has(parsed.label)) {
        seen.add(parsed.label);
        results.push(parsed);
      }
    }
  }
  return results;
}

function parseResultLine(line: string): TestResult | null {
  let m = line.match(/^(?:✓|✅|\[?PASS\]?:?)\s+(.{3,120})/i);
  if (m) return { status: "pass", label: stripMarkers(m[1]!) };

  m = line.match(/^(?:✗|✘|❌|\[?FAIL(?:ED)?\]?:?)\s+(.{3,120})/i);
  if (m) return { status: "fail", label: stripMarkers(m[1]!) };

  m = line.match(/^(.{3,120}?)\s*(?:\.{2,}|—|–)\s*(pass(?:ed)?|ok)$/i);
  if (m) return { status: "pass", label: stripMarkers(m[1]!) };

  m = line.match(/^(.{3,120}?)\s*(?:\.{2,}|—|–)\s*(fail(?:ed)?|error)$/i);
  if (m) return { status: "fail", label: stripMarkers(m[1]!) };

  return null;
}

function stripMarkers(text: string): string {
  return text.replace(/\*\*/g, "").trim();
}
