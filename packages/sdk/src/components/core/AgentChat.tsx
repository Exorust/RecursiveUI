import { useState, useRef, useEffect } from "react";
import { Card, Flex, Box, Text, Button, Badge, TextField } from "@radix-ui/themes";
import type { PendingQuestion, SkillHandle, SkillStatus } from "../../hooks/useSkill";

interface Props {
  skill: SkillHandle;
}

export function AgentChat({ skill }: Props) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Transcript lives in useSkill so it survives window close/reopen
  const messages = skill.messages;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput("");

    if (skill.status === "streaming" || skill.status === "running") {
      await skill.steer(userMsg);
    } else {
      await skill.invoke(userMsg);
    }
  };

  return (
    <Flex direction="column" style={{ height: "100%", background: "var(--gray-2)" }}>
      <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Agent Chat
        </Text>
        <Flex gap="2" align="center">
          {skill.capability && skill.capability.missing.length > 0 && (
            <Badge
              color="amber"
              variant="soft"
              title={`This skill expects tools not available here: ${skill.capability.missing.join(", ")}`}
            >
              ⚠ {skill.capability.missing.length} tool{skill.capability.missing.length === 1 ? "" : "s"} stubbed
            </Badge>
          )}
          <StatusBadge status={skill.status} />
        </Flex>
      </Flex>

      <Box style={{ flex: 1, overflowY: "auto" }} p="3">
        {messages.length === 0 && (
          <Text size="1" color="gray" align="center" as="div" mt="6">Type a prompt to run this skill…</Text>
        )}
        {messages.map((msg, i) => (
          <Card
            key={i}
            mb="2"
            style={{
              borderLeft: `3px solid ${msg.role === "user" ? "var(--accent-9)" : "var(--green-9)"}`,
            }}
          >
            <Text size="1" weight="bold" color="gray" as="div" mb="1" style={{ textTransform: "uppercase" }}>
              {msg.role === "user" ? "You" : "Agent"}
            </Text>
            {msg.thinking && (
              <details open={!msg.content} style={{ marginBottom: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--iris-11)", fontStyle: "italic" }}>
                  ✦ thinking
                </summary>
                <Text size="1" color="gray" as="div" mt="1" style={{ whiteSpace: "pre-wrap", fontStyle: "italic" }}>
                  {msg.thinking}
                </Text>
              </details>
            )}
            {msg.content && (
              <Text size="2" as="div" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                {msg.content}
              </Text>
            )}
          </Card>
        ))}
        {skill.activity && (
          <Text size="1" color="amber" as="div" style={{ fontStyle: "italic", padding: "4px 0" }}>
            {skill.activity}
          </Text>
        )}
        {skill.pendingQuestion && (
          <QuestionCard
            pending={skill.pendingQuestion}
            onSubmit={(answers) => skill.answerQuestion(skill.pendingQuestion!.requestId, answers)}
          />
        )}
        <div ref={messagesEndRef} />
      </Box>

      <form onSubmit={handleSubmit}>
        <Flex gap="2" p="2" style={{ borderTop: "1px solid var(--gray-4)" }}>
          <Box style={{ flex: 1 }}>
            <TextField.Root
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={skill.status === "streaming" ? "Steer the agent…" : "Type a prompt…"}
              disabled={skill.status === "error"}
            />
          </Box>
          <Button type="submit" disabled={!input.trim() || skill.status === "error"}>
            {skill.status === "streaming" ? "Steer" : "Send"}
          </Button>
          {(skill.status === "running" || skill.status === "streaming") && (
            <Button type="button" color="red" variant="soft" onClick={() => skill.cancel()}>
              Cancel
            </Button>
          )}
        </Flex>
      </form>

      {skill.error && (
        <Box px="3" py="2" style={{ background: "var(--red-3)", borderTop: "1px solid var(--red-6)" }}>
          <Text size="1" color="red">{skill.error}</Text>
        </Box>
      )}
    </Flex>
  );
}

function QuestionCard({
  pending,
  onSubmit,
}: {
  pending: PendingQuestion;
  onSubmit: (answers: { question: string; selected: string[] }[]) => void;
}) {
  // selections[questionIndex] = set of chosen option labels
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});

  const toggle = (qi: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[qi] || []);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [qi]: current };
    });
  };

  const allAnswered = pending.questions.every(
    (_, qi) => (selections[qi]?.size || 0) > 0
  );

  const submit = () => {
    onSubmit(
      pending.questions.map((q, qi) => ({
        question: q.question,
        selected: Array.from(selections[qi] || []),
      }))
    );
  };

  return (
    <Card size="2" mb="3" style={{ border: "1px solid var(--accent-7)" }}>
      <Flex direction="column" gap="3">
        <Badge color="indigo" variant="soft" radius="full" style={{ alignSelf: "flex-start" }}>
          Agent needs your input
        </Badge>
        {pending.questions.map((q, qi) => (
          <Flex key={qi} direction="column" gap="2">
            {q.header && (
              <Badge variant="soft" color="gray" style={{ alignSelf: "flex-start" }}>
                {q.header}
              </Badge>
            )}
            <Text size="2" weight="medium">
              {q.question}
            </Text>
            <Flex direction="column" gap="1">
              {q.options.map((opt) => {
                const selected = selections[qi]?.has(opt.label);
                return (
                  <Card
                    key={opt.label}
                    asChild
                    variant={selected ? "classic" : "surface"}
                    style={{ cursor: "pointer", borderColor: selected ? "var(--accent-8)" : undefined }}
                  >
                    <button type="button" onClick={() => toggle(qi, opt.label, !!q.multiSelect)}>
                      <Text as="div" size="2" weight="bold">
                        {q.multiSelect ? (selected ? "☑ " : "☐ ") : ""}
                        {opt.label}
                      </Text>
                      {opt.description && (
                        <Text as="div" size="1" color="gray" mt="1">
                          {opt.description}
                        </Text>
                      )}
                    </button>
                  </Card>
                );
              })}
            </Flex>
          </Flex>
        ))}
        <Button onClick={submit} disabled={!allAnswered} style={{ alignSelf: "flex-end" }}>
          Answer
        </Button>
      </Flex>
    </Card>
  );
}

function StatusBadge({ status }: { status: SkillStatus }) {
  const color: Record<SkillStatus, "gray" | "amber" | "blue" | "green" | "red"> = {
    idle: "gray",
    running: "amber",
    streaming: "blue",
    done: "green",
    error: "red",
  };
  return (
    <Badge color={color[status]} variant="soft">
      {status}
    </Badge>
  );
}
