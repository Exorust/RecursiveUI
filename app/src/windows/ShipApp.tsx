import { useSkill, SplitPane, DeploymentPipeline, AgentChat, TerminalLog } from "@recursiveui/sdk";

interface Props {
  skillId: string;
}

/*
 * ┌────────────────────────────────┐
 * │        Pipeline Tracker        │
 * ├───────────────┬────────────────┤
 * │  Agent Chat   │  Terminal Log  │
 * └───────────────┴────────────────┘
 */
export function ShipApp({ skillId }: Props) {
  const skill = useSkill(skillId);

  return (
    <SplitPane direction="vertical" sizes={[18, 82]} minSize={70}>
      <DeploymentPipeline skill={skill} />
      <SplitPane direction="horizontal" sizes={[50, 50]}>
        <AgentChat skill={skill} />
        <TerminalLog skill={skill} />
      </SplitPane>
    </SplitPane>
  );
}
