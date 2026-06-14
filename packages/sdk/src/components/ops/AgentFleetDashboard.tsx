import { useMemo } from "react";
import { Flex, Text, Badge, ScrollArea, Card } from "@radix-ui/themes";
import type { SkillHandle, ToolUse } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

/**
 * Subagent fleet: each Agent (Task) tool call is a delegated sub-task. Shows
 * what was delegated, its status, and a result snippet. For orchestration
 * skills that fan work out to subagents.
 */
export function AgentFleetDashboard({ skill, title = "Subagents" }: Props) {
  const agents = useMemo(() => skill.tools.filter(isAgentCall), [skill.tools]);
  const running = agents.filter((a) => a.status === "running").length;

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
        {agents.length > 0 && (
          <Text size="1" color="gray">{agents.length} total{running ? ` · ${running} running` : ""}</Text>
        )}
      </Flex>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="2" p="2">
          {agents.length === 0 && (
            <Text size="1" color="gray" align="center" mt="5">Delegated subagent tasks appear here</Text>
          )}
          {agents.map((a) => (
            <Card key={a.toolCallId}>
              <Flex direction="column" gap="1">
                <Flex align="center" justify="between" gap="2">
                  <Text size="2" weight="medium" truncate>{taskOf(a)}</Text>
                  <Badge
                    size="1"
                    variant="soft"
                    color={a.status === "running" ? "amber" : a.isError ? "red" : "green"}
                  >
                    {a.status === "running" ? "running" : a.isError ? "failed" : "done"}
                  </Badge>
                </Flex>
                {a.result !== undefined && a.status === "done" && (
                  <Text size="1" color="gray" style={{ whiteSpace: "pre-wrap" }}>
                    {snippet(a.result)}
                  </Text>
                )}
              </Flex>
            </Card>
          ))}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

function isAgentCall(t: ToolUse): boolean {
  const n = t.toolName.toLowerCase();
  return n === "agent" || n === "task" || n === "subagent";
}

function taskOf(t: ToolUse): string {
  if (typeof t.args === "string") return t.args;
  return t.args?.description || t.args?.prompt || t.toolName;
}

function snippet(result: unknown): string {
  const s = typeof result === "string" ? result : JSON.stringify(result);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
