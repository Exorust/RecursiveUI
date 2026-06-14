import { useState, useMemo } from "react";
import { Flex, Box, Text, Button } from "@radix-ui/themes";
import type { SkillHandle } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
}

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}
interface DiffHunk {
  header: string;
  lines: DiffLine[];
}
interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}

const headerBar = { borderBottom: "1px solid var(--gray-4)" };

export function DiffViewer({ skill }: Props) {
  const [selectedFile, setSelectedFile] = useState<number>(0);
  const files = useMemo(() => parseDiffFromOutput(skill.output, skill.tools), [skill.output, skill.tools]);

  if (files.length === 0) {
    return (
      <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
        <Box px="3" py="2" style={headerBar}>
          <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Diff Viewer
          </Text>
        </Box>
        <Flex align="center" justify="center" style={{ flex: 1 }}>
          <Text size="1" color="gray">
            {skill.status === "idle"
              ? "Run a review to see diffs"
              : skill.status === "done"
                ? "No diffs found in output"
                : "Waiting for diff output…"}
          </Text>
        </Flex>
      </Flex>
    );
  }

  const file = files[selectedFile] ?? files[0]!;

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-1)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={headerBar}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Diff Viewer
        </Text>
        <Text size="1" color="gray">{files.length} file{files.length !== 1 ? "s" : ""}</Text>
      </Flex>

      {files.length > 1 && (
        <Flex gap="1" px="2" py="1" style={{ overflowX: "auto", ...headerBar }}>
          {files.map((f, i) => (
            <Button
              key={i}
              size="1"
              variant={i === selectedFile ? "solid" : "soft"}
              color={i === selectedFile ? undefined : "gray"}
              onClick={() => setSelectedFile(i)}
            >
              {f.path.split("/").pop()}
            </Button>
          ))}
        </Flex>
      )}

      <Box px="3" py="1" style={headerBar}>
        <Text size="1" style={{ color: "var(--accent-10)" }}>{file.path}</Text>
      </Box>

      <Box style={{ flex: 1, overflow: "auto", fontFamily: "var(--code-font-family, monospace)", fontSize: 12, lineHeight: 1.6 }}>
        {file.hunks.map((hunk, hi) => (
          <Box key={hi}>
            <Box px="3" py="1" style={{ background: "var(--accent-3)", color: "var(--accent-11)", fontSize: 11 }}>
              {hunk.header}
            </Box>
            {hunk.lines.map((line, li) => (
              <Box
                key={li}
                style={{
                  padding: "1px 12px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  background:
                    line.type === "add" ? "var(--green-a3)" : line.type === "remove" ? "var(--red-a3)" : undefined,
                  color: line.type === "add" ? "var(--green-11)" : line.type === "remove" ? "var(--red-11)" : "var(--gray-11)",
                }}
              >
                <span style={{ display: "inline-block", width: 16, color: "var(--gray-8)" }}>
                  {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                </span>
                {line.content}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Flex>
  );
}

function parseDiffFromOutput(output: string, tools: any[]): DiffFile[] {
  const diffSources: string[] = [];
  for (const tool of tools) {
    if (tool.result && typeof tool.result === "string") {
      if (tool.result.includes("diff --git") || tool.result.includes("@@") || tool.result.includes("--- a/")) {
        diffSources.push(tool.result);
      }
    }
  }
  if (output && (output.includes("diff --git") || output.includes("--- a/"))) {
    diffSources.push(output);
  }
  if (diffSources.length === 0) return [];
  return parseUnifiedDiff(diffSources.join("\n"));
}

function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = text.split("\n");
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
      currentFile = { path: match?.[2] || "unknown", hunks: [] };
      files.push(currentFile);
      currentHunk = null;
    } else if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      // skip file headers
    } else if (line.startsWith("@@")) {
      currentHunk = { header: line, lines: [] };
      currentFile?.hunks.push(currentHunk);
    } else if (currentHunk) {
      if (line.startsWith("+")) currentHunk.lines.push({ type: "add", content: line.slice(1) });
      else if (line.startsWith("-")) currentHunk.lines.push({ type: "remove", content: line.slice(1) });
      else currentHunk.lines.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return files;
}
