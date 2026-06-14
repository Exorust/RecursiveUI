import { useMemo } from "react";
import { Flex, Box, Text, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

/**
 * Design surface: surfaces visual artifacts the agent emits — color swatches
 * (#rrggbb / hsl), and any image/preview URLs (data: or http) it produces.
 * For design/brand skills where the output is visual, not textual.
 */
export function DesignPreview({ skill, title = "Preview" }: Props) {
  const { colors, images } = useMemo(() => extract(skill.output), [skill.output]);

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Box px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
      </Box>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Box p="3">
          {colors.length === 0 && images.length === 0 && (
            <Text size="1" color="gray" align="center" as="div" mt="5">Colors and visual previews appear here</Text>
          )}
          {colors.length > 0 && (
            <>
              <Text size="1" weight="bold" color="gray" as="div" mb="2" style={{ textTransform: "uppercase" }}>Palette</Text>
              <Flex wrap="wrap" gap="3" mb="4">
                {colors.map((c, i) => (
                  <Flex key={i} direction="column" align="center" gap="1">
                    <Box style={{ width: 56, height: 56, borderRadius: "var(--radius-3)", background: c, border: "1px solid var(--gray-5)" }} />
                    <Text size="1" color="gray">{c}</Text>
                  </Flex>
                ))}
              </Flex>
            </>
          )}
          {images.length > 0 && (
            <>
              <Text size="1" weight="bold" color="gray" as="div" mb="2" style={{ textTransform: "uppercase" }}>Previews</Text>
              <Flex wrap="wrap" gap="3">
                {images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt="agent preview"
                    style={{ maxWidth: 200, maxHeight: 200, borderRadius: "var(--radius-3)", border: "1px solid var(--gray-5)", objectFit: "contain" }}
                  />
                ))}
              </Flex>
            </>
          )}
        </Box>
      </ScrollArea>
    </Flex>
  );
}

function extract(output: string): { colors: string[]; images: string[] } {
  if (!output) return { colors: [], images: [] };
  const colors = Array.from(
    new Set(output.match(/#[0-9a-fA-F]{6}\b|hsl\([^)]+\)|rgb\([^)]+\)/g) ?? [])
  ).slice(0, 24);
  const images = Array.from(
    new Set(output.match(/(?:data:image\/[^\s)"']+|https?:\/\/[^\s)"']+\.(?:png|jpe?g|svg|gif|webp))/g) ?? [])
  ).slice(0, 12);
  return { colors, images };
}
