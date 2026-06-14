import { useMemo } from "react";
import { Flex, Text, Badge, ScrollArea } from "@radix-ui/themes";
import type { SkillHandle, ToolUse } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
  title?: string;
}

type Op = "read" | "edit" | "write";

interface FileEntry {
  path: string;
  ops: Set<Op>;
}

/**
 * The files the agent has touched this session, derived from Read/Edit/Write
 * tool calls. Each file shows which operations hit it. For coding skills.
 */
export function FileBrowser({ skill, title = "Files" }: Props) {
  const files = useMemo(() => collectFiles(skill.tools), [skill.tools]);

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {title}
        </Text>
        <Text size="1" color="gray">{files.length}</Text>
      </Flex>
      <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
        <Flex direction="column" gap="1" p="2">
          {files.length === 0 && (
            <Text size="1" color="gray" align="center" mt="5">Files the agent touches show up here</Text>
          )}
          {files.map((f) => (
            <Flex key={f.path} align="center" gap="2" px="1" py="1">
              <Flex gap="1" style={{ flexShrink: 0 }}>
                {(["read", "edit", "write"] as Op[]).filter((o) => f.ops.has(o)).map((o) => (
                  <Badge key={o} size="1" variant="soft" color={OP_COLOR[o]}>{o[0]!.toUpperCase()}</Badge>
                ))}
              </Flex>
              <Text size="1" truncate title={f.path} style={{ fontFamily: "var(--code-font-family, monospace)" }}>
                {shorten(f.path)}
              </Text>
            </Flex>
          ))}
        </Flex>
      </ScrollArea>
    </Flex>
  );
}

const OP_COLOR: Record<Op, "blue" | "amber" | "green"> = { read: "blue", edit: "amber", write: "green" };

function collectFiles(tools: ToolUse[]): FileEntry[] {
  const map = new Map<string, Set<Op>>();
  const add = (path: string, op: Op) => {
    if (!path) return;
    if (!map.has(path)) map.set(path, new Set());
    map.get(path)!.add(op);
  };
  for (const t of tools) {
    const name = t.toolName.toLowerCase();
    const path = typeof t.args === "string" ? "" : t.args?.file_path || t.args?.path || "";
    if (name.includes("read")) add(path, "read");
    else if (name.includes("edit")) add(path, "edit");
    else if (name.includes("write")) add(path, "write");
  }
  return [...map.entries()].map(([path, ops]) => ({ path, ops }));
}

function shorten(path: string): string {
  const parts = path.split("/");
  return parts.length > 3 ? ".../" + parts.slice(-2).join("/") : path;
}
