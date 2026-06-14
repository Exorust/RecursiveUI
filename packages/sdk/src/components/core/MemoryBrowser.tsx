import { Flex, Text } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

/** MemoryBrowser — scaffolded in the catalog; not yet implemented. */
export function MemoryBrowser({ title = "Memory" }: Props) {
  return (
    <Flex direction="column" align="center" justify="center" gap="1" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Text size="2" color="gray">{title}</Text>
      <Text size="1" color="gray">component not yet implemented</Text>
    </Flex>
  );
}
