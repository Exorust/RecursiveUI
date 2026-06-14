import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Flex, Box, Card, Text, Heading, Button, Badge, Grid } from "@radix-ui/themes";

interface DiscoveredSkill {
  skillId: string;
  name: string;
  category: string;
  tier: "personal" | "community" | "generic";
  hasUi: boolean;
}

type CardState = "discovered" | "generating" | "live";

const TIER_COLOR: Record<string, "green" | "indigo" | "gray"> = {
  personal: "green",
  community: "indigo",
  generic: "gray",
};

/*
 * The first-run spectacle. Full-screen canvas: scan → cards stream in →
 * "Generate" → cards pulse (generating) → pop (live). Reuses discover_skills +
 * batch generation + the ui_generation event stream.
 */
export function SpectacleApp() {
  const [phase, setPhase] = useState<"scanning" | "discovered" | "generating" | "done">("scanning");
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [phaseLabel, setPhaseLabel] = useState<Record<string, string>>({});
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    invoke<{ ok: boolean; skills: DiscoveredSkill[]; priority: string[] }>("discover_skills")
      .then((res) => {
        if (!res.ok) return;
        setSkills(res.skills);
        setPriority(res.priority || []);
        const init: Record<string, CardState> = {};
        for (const s of res.skills) init[s.skillId] = s.hasUi ? "live" : "discovered";
        setCardState(init);
        setTimeout(() => setPhase("discovered"), 600);
      })
      .catch(() => setPhase("discovered"));
  }, []);

  useEffect(() => {
    listen<any>("skill-event", (event) => {
      const data = event.payload;
      if (data.event?.type !== "ui_generation") return;
      const id = data.skillId;
      const p = data.event.phase as string;
      setPhaseLabel((prev) => ({ ...prev, [id]: p }));
      setCardState((prev) => ({
        ...prev,
        [id]: p === "done" ? "live" : p === "error" ? "discovered" : "generating",
      }));
    }).then((u) => (unlistenRef.current = u));
    return () => unlistenRef.current?.();
  }, []);

  const runGeneration = async () => {
    setPhase("generating");
    const missing = priority.filter((id) => cardState[id] !== "live");
    try {
      await invoke("batch_generate", { skillIds: missing });
    } catch {
      /* per-card errors reflected via events */
    }
    setPhase("done");
  };

  const liveCount = Object.values(cardState).filter((s) => s === "live").length;
  const personal = skills.filter((s) => s.tier === "personal");
  const community = skills.filter((s) => s.tier === "community");
  const generic = skills.filter((s) => s.tier === "generic");

  return (
    <Box
      style={{
        height: "100vh",
        width: "100vw",
        overflow: "auto",
        background: "radial-gradient(circle at 50% 0%, var(--accent-3) 0%, var(--gray-1) 60%)",
        padding: 32,
        boxSizing: "border-box",
      }}
    >
      <Flex direction="column" align="center" gap="2" mb="5">
        {phase === "scanning" && <Pulse text="Scanning your machine…" />}
        {phase === "discovered" && (
          <>
            <Heading size="8">Found {skills.length} skills</Heading>
            <Text size="2" color="gray">
              {personal.length} yours · {community.length} community · {generic.length} more
            </Text>
            <Button size="3" mt="2" onClick={runGeneration}>⚡ Generate priority UIs</Button>
          </>
        )}
        {phase === "generating" && <Pulse text={`Materializing UIs… ${liveCount} live`} />}
        {phase === "done" && (
          <>
            <Heading size="8">Ready</Heading>
            <Text size="2" color="gray">{liveCount} skill UIs built. Open any from the menu bar.</Text>
          </>
        )}
      </Flex>

      <Grid columns="repeat(auto-fill, minmax(180px, 1fr))" gap="3" style={{ maxWidth: 1100, margin: "0 auto" }}>
        {skills.slice(0, 60).map((s) => {
          const state = cardState[s.skillId] || "discovered";
          return (
            <Card
              key={s.skillId}
              style={{
                opacity: state === "discovered" && !priority.includes(s.skillId) ? 0.45 : 1,
                animation: state === "generating" ? "rekPulse 1s ease-in-out infinite" : undefined,
                boxShadow: state === "live" ? "0 0 16px var(--accent-a6)" : undefined,
                border: state === "live" ? "1px solid var(--accent-8)" : undefined,
                transition: "opacity 0.4s, box-shadow 0.4s",
              }}
            >
              <Flex direction="column" gap="1">
                <Text size="2" weight="bold">
                  <Text style={{ color: state === "live" ? "var(--accent-9)" : "var(--gray-8)" }}>
                    {state === "live" ? "◆ " : "◇ "}
                  </Text>
                  {s.name}
                </Text>
                {state === "generating" ? (
                  <Text size="1" color="amber">{phaseLabel[s.skillId] || "generating…"}</Text>
                ) : (
                  <Badge size="1" variant="soft" color={TIER_COLOR[s.tier]} style={{ alignSelf: "flex-start" }}>
                    {s.category}
                  </Badge>
                )}
              </Flex>
            </Card>
          );
        })}
      </Grid>
    </Box>
  );
}

function Pulse({ text }: { text: string }) {
  return (
    <Heading size="8" style={{ animation: "rekPulse 1.4s ease-in-out infinite" }}>
      {text}
    </Heading>
  );
}
