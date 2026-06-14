import { useMemo } from "react";
import { Flex, Box, Text } from "@radix-ui/themes";
import type { SkillHandle, ToolUse } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
}

type StageStatus = "pending" | "running" | "done" | "error";

interface Stage {
  id: string;
  label: string;
  status: StageStatus;
}

/*
 * Ship pipeline, derived heuristically from tool calls:
 *
 *   ◉ Review ──── ◉ Commit ──── ◌ Push ──── ◌ PR
 *   (any tool)    (git commit)  (git push)  (gh pr create)
 *
 * A stage is "done" when a matching call finished cleanly, "error" when a
 * matching call failed, "running" while one is in flight. The first
 * unmatched stage shows as "running" while the agent is working.
 */
const STAGE_DEFS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "review", label: "Review", pattern: /git (diff|status|log)/ },
  { id: "commit", label: "Commit", pattern: /git commit/ },
  { id: "push", label: "Push", pattern: /git push/ },
  { id: "pr", label: "PR", pattern: /gh pr (create|edit|view)/ },
];

export function DeploymentPipeline({ skill }: Props) {
  const stages = useMemo(() => deriveStages(skill), [skill.tools, skill.status]);

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Box px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Pipeline
        </Text>
      </Box>
      <Flex align="center" justify="center" style={{ flex: 1, padding: "0 16px" }}>
        {stages.map((stage, i) => (
          <Flex key={stage.id} align="center">
            {i > 0 && (
              <Box
                style={{
                  height: 2,
                  width: 48,
                  margin: "0 8px",
                  background: stages[i - 1].status === "done" ? "var(--green-9)" : "var(--gray-6)",
                }}
              />
            )}
            <Flex align="center" gap="2">
              <Flex
                align="center"
                justify="center"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  border: `2px solid ${STATUS_COLORS[stage.status]}`,
                  background: stage.status === "pending" ? "transparent" : STATUS_COLORS[stage.status],
                  color: stage.status === "pending" ? "var(--gray-8)" : "var(--gray-1)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {glyph(stage.status)}
              </Flex>
              <Text size="2" weight="medium" color={stage.status === "pending" ? "gray" : undefined}>
                {stage.label}
              </Text>
            </Flex>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}

function deriveStages(skill: SkillHandle): Stage[] {
  const stages: Stage[] = STAGE_DEFS.map((def) => {
    const matches = skill.tools.filter((t) => matchesStage(t, def.pattern));
    let status: StageStatus = "pending";
    if (matches.some((t) => t.status === "running")) status = "running";
    else if (matches.some((t) => t.status === "done" && t.isError)) status = "error";
    else if (matches.some((t) => t.status === "done" && !t.isError)) status = "done";
    return { id: def.id, label: def.label, status };
  });

  // While the agent works, light up the first stage that hasn't completed
  if (skill.status === "running" || skill.status === "streaming") {
    const firstPending = stages.find((s) => s.status === "pending");
    if (firstPending && !stages.some((s) => s.status === "running")) {
      firstPending.status = "running";
    }
  }
  return stages;
}

function matchesStage(tool: ToolUse, pattern: RegExp): boolean {
  const command =
    typeof tool.args === "string"
      ? tool.args
      : tool.args?.command || tool.args?.cmd || "";
  return pattern.test(command);
}

function glyph(status: StageStatus): string {
  if (status === "done") return "✓";
  if (status === "error") return "✗";
  if (status === "running") return "▶";
  return "";
}

const STATUS_COLORS: Record<StageStatus, string> = {
  pending: "var(--gray-6)",
  running: "var(--amber-9)",
  done: "var(--green-9)",
  error: "var(--red-9)",
};
