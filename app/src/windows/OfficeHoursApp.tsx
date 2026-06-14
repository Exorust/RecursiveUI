import { useSkill, SplitPane, FindingsPanel, AgentChat } from "@recursiveui/sdk";

interface Props {
  skillId: string;
}

/*
 * ┌──────────────────┬─────────────┐
 * │                  │ Key         │
 * │   Agent Chat     │ Takeaways   │
 * │   (hero, wide)   │             │
 * └──────────────────┴─────────────┘
 */
export function OfficeHoursApp({ skillId }: Props) {
  const skill = useSkill(skillId);

  return (
    <SplitPane direction="horizontal" sizes={[72, 28]}>
      <AgentChat skill={skill} />
      <FindingsPanel
        skill={skill}
        title="Key Takeaways"
        emptyText="Advice and decisions get pinned here during the conversation"
      />
    </SplitPane>
  );
}
