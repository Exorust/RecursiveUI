import { Card, Flex, Text, Button, Badge } from "@radix-ui/themes";
import type { EvolutionToast as ToastData } from "../sdk/useEvolution";

interface Props {
  toast: ToastData;
  onKeep: () => void;
  onRevert: () => void;
}

/** Mixed-initiative toast: the UI evolved, here's why, keep or revert. */
export function EvolutionToast({ toast, onKeep, onRevert }: Props) {
  return (
    <div style={styles.wrap}>
      <Card size="2" style={styles.card}>
        <Flex direction="column" gap="2">
          <Badge color="amber" variant="soft" radius="full" style={{ alignSelf: "flex-start" }}>
            ✦ UI evolved
          </Badge>
          <Text size="3" weight="bold">
            {toast.change}
          </Text>
          <Text size="2" color="gray">
            {toast.rationale}
          </Text>
          <Flex gap="2" justify="end" mt="1">
            <Button variant="soft" color="gray" onClick={onRevert}>
              Revert
            </Button>
            <Button onClick={onKeep}>Keep</Button>
          </Flex>
        </Flex>
      </Card>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: "absolute",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 200,
    minWidth: 340,
    maxWidth: 480,
  },
  card: {
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    border: "1px solid var(--accent-7)",
  },
};
