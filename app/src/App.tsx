import React, { useEffect, useState } from "react";
import { Theme, Button, Flex, Box, Text } from "@radix-ui/themes";
import { layoutFor } from "./windows/registry";
import { StudioApp } from "./windows/StudioApp";
import { SpectacleApp } from "./windows/SpectacleApp";
import { GenerationProgress } from "./components/GenerationProgress";
import { useGenerationProgress } from "./sdk/useGenerationProgress";
import { EvolutionToast } from "./components/EvolutionToast";
import { useEvolution } from "./sdk/useEvolution";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  generateApp,
  loadGeneratedApp,
  radixAccent,
  accentForSkill,
  humanizeSkill,
  type GeneratedApp,
  type GenomeTokens,
} from "@recursiveui/sdk";

function App() {
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get("window");
  const skillId = params.get("id") || "";
  const skillName = params.get("name") || "";

  if (windowType === "skill") {
    return <SkillWindow skillId={skillId} skillName={skillName} />;
  }

  if (windowType === "studio") {
    return <StudioApp batchMode={params.get("batch") === "1"} initialSkill={params.get("skill") || undefined} />;
  }

  if (windowType === "spectacle") {
    return <SpectacleApp />;
  }

  // Default: show a welcome screen (should not normally appear — app is tray-only)
  return (
    <div style={styles.welcome}>
      <h1 style={styles.heading}>RecursiveUI</h1>
      <p style={styles.sub}>Self-evolving UI for AI agents</p>
      <p style={styles.hint}>Use the menu bar icon to open skill windows</p>
    </div>
  );
}

function SkillWindow({ skillId, skillName: _skillName }: { skillId: string; skillName: string }) {
  // Generated UI when one exists (Slice 2); hand-written registry layout
  // as fallback (see windows/registry.ts).
  const [Generated, setGenerated] = useState<GeneratedApp | null>(null);
  const [tokens, setTokens] = useState<GenomeTokens | null>(null);
  const [genState, setGenState] = useState<"idle" | "generating" | "error">("idle");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    loadGeneratedApp(skillId)
      .then((res) => {
        if (res) {
          setGenerated(() => res.app);
          setTokens(res.tokens);
          setVersion((v) => v + 1);
        }
      })
      .catch((err) => console.warn("[recursiveui] generated UI load failed:", err));
  }, [skillId]);

  // Live-reload when the Studio (or evolution) recompiles this skill's UI.
  // The agent session lives in the sidecar keyed by skillId, so swapping the
  // rendered component preserves the running conversation.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<any>("skill-event", (event) => {
      const data = event.payload;
      if (data.skillId !== skillId || data.event?.type !== "ui_updated") return;
      loadGeneratedApp(skillId)
        .then((res) => {
          if (res) {
            setGenerated(() => res.app);
            setTokens(res.tokens);
            setVersion((v) => v + 1);
          }
        })
        .catch((err) => console.warn("[recursiveui] hot-reload failed:", err));
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [skillId]);

  const regenerate = async () => {
    setGenState("generating");
    try {
      const app = await generateApp(skillId);
      setGenerated(() => app);
      setVersion((v) => v + 1);
      setGenState("idle");
      // Refresh tokens from the new genome.
      loadGeneratedApp(skillId).then((res) => res && setTokens(res.tokens)).catch(() => {});
    } catch (err) {
      console.error("[recursiveui] generation failed:", err);
      setGenState("error");
    }
  };

  const { progress } = useGenerationProgress(genState === "generating" ? skillId : null);
  const { toast, keep, revert } = useEvolution(skillId);
  const [evolving, setEvolving] = useState(false);

  const evolveNow = async () => {
    setEvolving(true);
    try {
      await invoke("run_evolution", { skillId });
    } catch (err) {
      console.error("[recursiveui] evolution failed:", err);
    } finally {
      setEvolving(false);
    }
  };

  const Layout = Generated ?? layoutFor(skillId);
  // Per-skill accent: the genome's token if present, else a stable hash of the
  // skillId — so every window (even legacy/un-generated) has its own color.
  const accent = (radixAccent(tokens?.accent) ?? accentForSkill(skillId)) as any;
  return (
    <Theme accentColor={accent} style={styles.window}>
      <Flex direction="column" style={{ height: "100%", width: "100%" }}>
        {/* Per-skill identity band */}
        <Flex
          align="center"
          gap="2"
          px="3"
          style={{
            height: 34,
            flexShrink: 0,
            background: "var(--accent-2)",
            borderBottom: "2px solid var(--accent-9)",
          }}
        >
          <Box style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-9)" }} />
          <Text size="2" weight="bold" style={{ letterSpacing: 0.3 }}>{humanizeSkill(skillId)}</Text>
        </Flex>
        <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {/* key remounts the boundary so a fresh generation gets a clean slate */}
          <GeneratedErrorBoundary key={version} fallback={layoutFor(skillId)} skillId={skillId}>
            <Layout skillId={skillId} />
          </GeneratedErrorBoundary>
        </Box>
      </Flex>
      {genState === "generating" && (
        <div style={styles.generationOverlay}>
          {progress ? (
            <GenerationProgress progress={progress} />
          ) : (
            <div style={{ padding: 20, color: "#888" }}>Starting generation…</div>
          )}
        </div>
      )}
      {toast && <EvolutionToast toast={toast} onKeep={keep} onRevert={revert} />}
      <Flex gap="2" style={styles.actionRow}>
        {Generated ? (
          <>
            <Button
              size="1"
              variant="soft"
              onClick={evolveNow}
              disabled={evolving || genState === "generating"}
              title="Run one evolution cycle from usage data"
            >
              {evolving ? "✦ Evolving…" : "✦ Evolve now"}
            </Button>
            <Button
              size="1"
              variant="soft"
              onClick={() => invoke("open_studio_for_skill", { skillId })}
              title="Open this skill in the Design Studio to change its UI"
            >
              Change UI
            </Button>
          </>
        ) : (
          <Button
            size="1"
            variant="soft"
            color={genState === "error" ? "red" : undefined}
            onClick={regenerate}
            disabled={genState === "generating"}
            title="Generate a UI for this skill"
          >
            {genState === "generating"
              ? "⏳ Generating…"
              : genState === "error"
                ? "⚠ Retry generate"
                : "⚡ Generate UI"}
          </Button>
        )}
      </Flex>
    </Theme>
  );
}

// Generated code is untrusted output from an LLM: if it throws at render
// time, show the hand-written fallback instead of a blank window.
class GeneratedErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: GeneratedApp; skillId: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[recursiveui] generated UI crashed, using fallback:", err);
  }
  render() {
    if (this.state.failed) {
      const Fallback = this.props.fallback;
      return <Fallback skillId={this.props.skillId} />;
    }
    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  welcome: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    backgroundColor: "#0d0d1a",
    color: "#e0e0e0",
    fontFamily: "'SF Mono', 'Fira Code', monospace",
  },
  heading: {
    fontSize: 32,
    fontWeight: 700,
    color: "#6366f1",
    margin: 0,
  },
  sub: {
    fontSize: 14,
    color: "#888",
    marginTop: 8,
  },
  hint: {
    fontSize: 12,
    color: "#555",
    marginTop: 20,
  },
  window: {
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    position: "relative" as const,
  },
  generationOverlay: {
    position: "absolute" as const,
    inset: 0,
    zIndex: 90,
    backgroundColor: "#0d0d1aee",
    backdropFilter: "blur(2px)",
  },
  actionRow: {
    position: "absolute" as const,
    bottom: 12,
    right: 12,
    zIndex: 100,
    display: "flex",
    gap: 8,
  },
  generateButton: {
    padding: "6px 12px",
    backgroundColor: "#0d0d1acc",
    border: "1px solid #6366f1",
    borderRadius: 6,
    color: "#a5b4fc",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    backdropFilter: "blur(4px)",
  },
};

export default App;
