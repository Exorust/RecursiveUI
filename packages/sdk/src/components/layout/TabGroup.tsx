import { useState } from "react";
import { Flex, Box, Text } from "@radix-ui/themes";

interface Props {
  labels: string[];
  children: React.ReactNode[];
}

/**
 * Lightweight tabbed container for genome layouts: one child per tab, only the
 * active child mounted-visible. Used by renderGenome for `tabs` containers,
 * where panes are alternatives the user switches between (not watched at once).
 */
export function TabGroup({ labels, children }: Props) {
  const [active, setActive] = useState(0);
  const items = Array.isArray(children) ? children : [children];

  return (
    <Flex direction="column" style={{ height: "100%", width: "100%" }}>
      <Flex gap="1" px="2" py="1" style={{ flexShrink: 0, borderBottom: "1px solid var(--gray-4)" }}>
        {items.map((_, i) => (
          <Box
            key={i}
            onClick={() => setActive(i)}
            px="3"
            py="1"
            style={{
              cursor: "pointer",
              borderRadius: "var(--radius-2)",
              background: i === active ? "var(--accent-4)" : "transparent",
            }}
          >
            <Text size="1" weight={i === active ? "bold" : "regular"} color={i === active ? undefined : "gray"}>
              {labels[i] ?? `Tab ${i + 1}`}
            </Text>
          </Box>
        ))}
      </Flex>
      <Box style={{ flex: 1, minHeight: 0 }}>{items[active]}</Box>
    </Flex>
  );
}
