import { useSkill, SplitPane, TestResultsPanel, AgentChat, TerminalLog } from "@recursiveui/sdk";

interface Props {
  skillId: string;
}

/*
 * ┌──────────────────┬─────────────┐
 * │  Test Results    │ Agent Chat  │
 * │  (hero)          ├─────────────┤
 * │                  │ Terminal    │
 * └──────────────────┴─────────────┘
 */
export function QAApp({ skillId }: Props) {
  const skill = useSkill(skillId);

  return (
    <SplitPane direction="horizontal" sizes={[55, 45]}>
      <TestResultsPanel skill={skill} />
      <SplitPane direction="vertical" sizes={[60, 40]}>
        <AgentChat skill={skill} />
        <TerminalLog skill={skill} />
      </SplitPane>
    </SplitPane>
  );
}
