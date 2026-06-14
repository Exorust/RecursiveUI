import { useSkill, SplitPane, DiffViewer, AgentChat, TerminalLog } from "@recursiveui/sdk";

interface Props {
  skillId: string;
}

export function ReviewApp({ skillId }: Props) {
  const skill = useSkill(skillId);

  return (
    <SplitPane direction="vertical" sizes={[60, 40]}>
      <DiffViewer skill={skill} />
      <SplitPane direction="horizontal" sizes={[50, 50]}>
        <AgentChat skill={skill} />
        <TerminalLog skill={skill} />
      </SplitPane>
    </SplitPane>
  );
}
