import { useRef, useEffect, useState } from "react";
import { Flex, Box, Text, Code } from "@radix-ui/themes";
import type { SkillHandle, ToolUse } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
}

export function TerminalLog({ skill }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (autoScroll) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [skill.tools, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  const toggleTool = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-3)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Terminal
        </Text>
        <Text size="1" color="gray">
          {skill.tools.length} tool call{skill.tools.length !== 1 ? "s" : ""}
        </Text>
      </Flex>

      <Box ref={scrollRef as any} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto" }}>
        {skill.tools.length === 0 && (
          <Text size="1" color="gray" align="center" as="div" mt="5">No tool executions yet</Text>
        )}
        {skill.tools.map((tool) => (
          <ToolEntry
            key={tool.toolCallId}
            tool={tool}
            expanded={expandedTools.has(tool.toolCallId)}
            onToggle={() => toggleTool(tool.toolCallId)}
          />
        ))}
      </Box>
    </Flex>
  );
}

function ToolEntry({ tool, expanded, onToggle }: { tool: ToolUse; expanded: boolean; onToggle: () => void }) {
  const icon = tool.status === "running" ? "▶" : tool.isError ? "✗" : "✓";
  const iconColor = tool.status === "running" ? "var(--amber-9)" : tool.isError ? "var(--red-9)" : "var(--green-9)";
  const displayArgs = formatArgs(tool.toolName, tool.args);

  return (
    <Box style={{ borderBottom: "1px solid var(--gray-3)" }}>
      <Flex align="center" gap="2" px="3" py="1" onClick={onToggle} style={{ cursor: "pointer" }}>
        <Text size="1" style={{ color: iconColor }}>{icon}</Text>
        <Text size="1" weight="bold" style={{ color: "var(--accent-10)" }}>{tool.toolName}</Text>
        <Text size="1" color="gray" truncate style={{ flex: 1 }}>{displayArgs}</Text>
        <Text size="1" color="gray">{expanded ? "▾" : "▸"}</Text>
      </Flex>
      {expanded && (
        <Flex direction="column" gap="2" px="3" pb="2" style={{ paddingLeft: 32 }}>
          {tool.args && (
            <Box>
              <Text size="1" color="gray" weight="bold" as="div" mb="1">INPUT</Text>
              <Code variant="soft" style={{ display: "block", whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>
                {typeof tool.args === "string" ? tool.args : JSON.stringify(tool.args, null, 2)}
              </Code>
            </Box>
          )}
          {tool.result !== undefined && (
            <Box>
              <Text size="1" color="gray" weight="bold" as="div" mb="1">OUTPUT</Text>
              <Code
                variant="soft"
                color={tool.isError ? "red" : undefined}
                style={{ display: "block", whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}
              >
                {typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result, null, 2)}
              </Code>
            </Box>
          )}
        </Flex>
      )}
    </Box>
  );
}

function formatArgs(toolName: string, args: any): string {
  if (!args) return "";
  if (toolName === "bash" || toolName === "Bash") return args.command || args.cmd || "";
  if (toolName === "read" || toolName === "Read") return args.file_path || args.path || "";
  if (toolName === "edit" || toolName === "Edit") return args.file_path || args.path || "";
  if (toolName === "write" || toolName === "Write") return args.file_path || args.path || "";
  if (typeof args === "string") return args;
  return "";
}
