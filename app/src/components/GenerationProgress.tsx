import { useRef, useEffect } from "react";
import { Flex, Text, Box, Code } from "@radix-ui/themes";
import type { GenerationProgressState } from "../sdk/useGenerationProgress";

interface Props {
  progress: GenerationProgressState;
}

const PHASE_LABELS: Record<string, string> = {
  planning: "Reading the skill",
  prompting: "Briefing the model",
  generating: "Designing the layout",
  compiling: "Compiling",
  retrying: "First attempt failed — retrying",
  done: "Done",
  error: "Failed",
  skipped: "Skipped (already generated)",
};

const PHASE_ORDER = ["planning", "prompting", "generating", "compiling", "done"];

/** Live generation view: phase rail + the model's streaming thinking/output. */
export function GenerationProgress({ progress }: Props) {
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [progress.thinking, progress.text]);

  const currentIndex = PHASE_ORDER.indexOf(progress.phase);

  return (
    <Flex direction="column" gap="3" p="4" style={{ height: "100%", overflow: "hidden" }}>
      <Flex gap="4" wrap="wrap">
        {PHASE_ORDER.map((phase, i) => {
          const done = i < currentIndex || progress.phase === "done";
          const active = i === currentIndex;
          const err = progress.phase === "error" && active;
          return (
            <Flex key={phase} align="center" gap="2">
              <Box
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  backgroundColor: err
                    ? "var(--red-9)"
                    : done
                      ? "var(--green-9)"
                      : active
                        ? "var(--amber-9)"
                        : "var(--gray-6)",
                }}
              />
              <Text size="1" color={active ? undefined : "gray"} weight={active ? "bold" : "regular"}>
                {PHASE_LABELS[phase] || phase}
              </Text>
            </Flex>
          );
        })}
      </Flex>

      {progress.detail && (
        <Text size="1" color="indigo" style={{ fontStyle: "italic" }}>
          {progress.detail}
        </Text>
      )}

      {(progress.thinking || progress.text) && (
        <Box
          ref={streamRef as any}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 10,
            backgroundColor: "var(--gray-2)",
            borderRadius: "var(--radius-3)",
            border: "1px solid var(--gray-4)",
          }}
        >
          {progress.thinking && (
            <Text size="1" color="gray" style={{ fontStyle: "italic", whiteSpace: "pre-wrap", display: "block", marginBottom: 8 }}>
              ✦ {progress.thinking}
            </Text>
          )}
          {progress.text && (
            <Code variant="ghost" style={{ whiteSpace: "pre-wrap", color: "var(--grass-11)" }}>
              {progress.text}
            </Code>
          )}
        </Box>
      )}
    </Flex>
  );
}
