import { useSkill, SplitPane, FindingsPanel, AgentChat, TerminalLog } from "@recursiveui/sdk";

interface Props {
  skillId: string;
}

/*
 * ┌──────────────────┬─────────────┐
 * │   Terminal Log   │  Findings   │
 * │   (hero)         │             │
 * ├──────────────────┤             │
 * │   Agent Chat     │             │
 * └──────────────────┴─────────────┘
 */
export function InvestigateApp({ skillId }: Props) {
  const skill = useSkill(skillId);

  return (
    <SplitPane direction="horizontal" sizes={[68, 32]}>
      <SplitPane direction="vertical" sizes={[55, 45]}>
        <TerminalLog skill={skill} />
        <AgentChat skill={skill} />
      </SplitPane>
      <FindingsPanel
        skill={skill}
        title="Findings"
        emptyText="Hypotheses and evidence appear here as the agent investigates"
      />
    </SplitPane>
  );
}
