import { useMemo } from "react";
import { Flex, Box, Text, Badge, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

type Health = "up" | "down" | "degraded";

interface Service {
  name: string;
  health: Health;
  detail?: string;
}

/**
 * Service health board: parses "name: up/down/degraded" and ✓/✗ status lines
 * from the agent's output. For ops/monitoring skills (canary, health checks).
 */
export function HealthMonitor({ skill, title = "Health" }: Props) {
  const services = useMemo(() => extractServices(skill.output, skill.tools), [skill.output, skill.tools]);
  const down = services.filter((s) => s.health !== "up").length;

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
        {services.length > 0 && (
          <Text size="1" color={down > 0 ? "red" : "green"}>
            {down > 0 ? `${down} unhealthy` : "all healthy"}
          </Text>
        )}
      </Flex>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="1" p="2">
          {services.length === 0 && (
            <Text size="1" color="gray" align="center" mt="5">Service status appears here</Text>
          )}
          {services.map((s, i) => (
            <Flex key={i} align="center" gap="2" p="2" style={{ background: "var(--gray-2)", borderRadius: "var(--radius-2)" }}>
              <Box style={{ width: 8, height: 8, borderRadius: "50%", background: HEALTH_COLOR[s.health], flexShrink: 0 }} />
              <Text size="2" style={{ flex: 1 }}>{s.name}</Text>
              <Badge size="1" variant="soft" color={s.health === "up" ? "green" : s.health === "degraded" ? "amber" : "red"}>
                {s.health}
              </Badge>
            </Flex>
          ))}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

const HEALTH_COLOR: Record<Health, string> = {
  up: "var(--green-9)",
  degraded: "var(--amber-9)",
  down: "var(--red-9)",
};

function extractServices(output: string, tools: { result?: unknown }[]): Service[] {
  const sources = [output || "", ...tools.map((t) => (typeof t.result === "string" ? t.result : ""))];
  const services: Service[] = [];
  const seen = new Set<string>();

  for (const src of sources) {
    for (const raw of src.split("\n")) {
      const line = raw.trim();
      // "name: up" / "name - healthy" / "name = down"
      let m = line.match(/^([A-Za-z][\w .\-/]{1,40}?)\s*[:=-]\s*(up|down|degraded|healthy|unhealthy|ok|online|offline|error|failing)\b/i);
      if (m) {
        const name = m[1]!.trim();
        if (!seen.has(name)) {
          seen.add(name);
          services.push({ name, health: normalize(m[2]!) });
        }
        continue;
      }
      // "✓ name" / "✗ name"
      m = line.match(/^([✓✅])\s+(.{2,40})/) || line.match(/^([✗✘❌])\s+(.{2,40})/);
      if (m) {
        const name = m[2]!.trim();
        if (!seen.has(name)) {
          seen.add(name);
          services.push({ name, health: /[✓✅]/.test(m[1]!) ? "up" : "down" });
        }
      }
    }
  }
  return services.slice(0, 40);
}

function normalize(s: string): Health {
  const v = s.toLowerCase();
  if (/(up|healthy|ok|online)/.test(v)) return "up";
  if (/degrad/.test(v)) return "degraded";
  return "down";
}
