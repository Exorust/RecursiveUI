import React, { useEffect, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Flex,
  Box,
  Card,
  Button,
  IconButton,
  Text,
  Heading,
  Badge,
  ScrollArea,
  TextField,
  Progress,
} from "@radix-ui/themes";
import {
  CubeIcon,
  GearIcon,
  BackpackIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DotFilledIcon,
  DotIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import { SplitPane } from "@recursiveui/sdk";
import { GenerationProgress } from "../components/GenerationProgress";
import { useGenerationProgress } from "../sdk/useGenerationProgress";

interface DiscoveredSkill {
  skillId: string;
  name: string;
  description: string;
  category: string;
  tier: "personal" | "community" | "generic";
  hasUi: boolean;
}

interface UiVersion {
  hash: string;
  message: string;
}

type BatchItemState = "pending" | "generating" | "done" | "failed" | "skipped";

interface BatchItem {
  skillId: string;
  name: string;
  state: BatchItemState;
  error?: string;
}

type RailView = "skills" | "status" | "marketplace";

const TIER_SECTIONS: { tier: DiscoveredSkill["tier"]; label: string }[] = [
  { tier: "personal", label: "My Skills" },
  { tier: "community", label: "Community" },
  { tier: "generic", label: "External" },
];

const TIER_COLOR: Record<string, "green" | "indigo" | "gray"> = {
  personal: "green",
  community: "indigo",
  generic: "gray",
};

/*
 * Design Studio: a pure editor / remote control. It does NOT render skill UIs
 * — each skill's UI lives in its own standalone window. Clicking a skill opens
 * that window; editing here recompiles and the window hot-reloads (the sidecar
 * emits ui_updated). Layout: activity rail · sidebar · change console.
 */
export function StudioApp({ batchMode = false, initialSkill }: { batchMode?: boolean; initialSkill?: string }) {
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(initialSkill ?? null);
  const [versions, setVersions] = useState<UiVersion[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [generatingSkill, setGeneratingSkill] = useState<string | null>(null);
  const [view, setView] = useState<RailView>(batchMode ? "status" : "skills");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["tier:personal", "tier:community"])
  );

  const { progress } = useGenerationProgress(generatingSkill);

  const refreshSkills = useCallback(async () => {
    const res = await invoke<{ ok: boolean; skills: DiscoveredSkill[]; priority: string[] }>(
      "discover_skills"
    );
    if (res.ok) {
      setSkills(res.skills);
      setPriority(res.priority || []);
      return res;
    }
    return null;
  }, []);

  useEffect(() => {
    refreshSkills()
      .then((res) => {
        if (res && res.skills.length) {
          const first = res.skills.find((s) => s.hasUi) || res.skills[0];
          setSelected((cur) => cur ?? first.skillId);
        }
      })
      .catch((err) => setError(String(err)));
  }, [refreshSkills]);

  const refreshVersions = useCallback(async (skillId: string) => {
    try {
      const res = await invoke<{ ok: boolean; versions: UiVersion[] }>("list_ui_versions", {
        skillId,
      });
      setVersions(res.ok ? res.versions : []);
    } catch {
      setVersions([]);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    setError(null);
    refreshVersions(selected);
  }, [selected, refreshVersions]);

  const markHasUi = (skillId: string) => {
    setSkills((prev) => prev.map((s) => (s.skillId === skillId ? { ...s, hasUi: true } : s)));
  };

  const openWindow = (skillId: string) => {
    const name = skills.find((s) => s.skillId === skillId)?.name ?? skillId;
    invoke("open_skill_window", { skillId, skillName: name }).catch(() => {});
  };

  // Click a skill: it becomes the edit target AND its standalone window opens.
  const selectSkill = (skillId: string) => {
    setSelected(skillId);
    openWindow(skillId);
  };

  const handleGenerate = async (skillId?: string) => {
    const target = skillId ?? selected;
    if (!target) return;
    setBusy("Generating UI…");
    setGeneratingSkill(target);
    setError(null);
    try {
      const res = await invoke<{ ok: boolean; error?: string }>("generate_ui", { skillId: target });
      if (!res.ok) throw new Error(res.error || "generation failed");
      markHasUi(target);
      await refreshVersions(target);
      openWindow(target); // show the freshly-generated UI in its own window
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
      setGeneratingSkill(null);
    }
  };

  const handleModify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !instruction.trim()) return;
    const request = instruction.trim();
    setInstruction("");
    setBusy(`Applying: "${request}"…`);
    setGeneratingSkill(selected);
    setError(null);
    try {
      const res = await invoke<{ ok: boolean; error?: string }>("modify_ui", {
        skillId: selected,
        instruction: request,
      });
      if (!res.ok) throw new Error(res.error || "modify failed");
      // The sidecar emits ui_updated → the standalone window hot-reloads.
      await refreshVersions(selected);
      openWindow(selected); // ensure the window is visible to watch the change
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
      setGeneratingSkill(null);
    }
  };

  const handleRevert = async (hash: string) => {
    if (!selected) return;
    setBusy("Reverting…");
    setError(null);
    try {
      const res = await invoke<{ ok: boolean; error?: string }>("revert_ui", {
        skillId: selected,
        hash,
      });
      if (!res.ok) throw new Error(res.error || "revert failed");
      // ui_updated fires → the window hot-reloads to the reverted version.
      await refreshVersions(selected);
      openWindow(selected);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  // --- Batch flow ---
  const missingPriority = useMemo(
    () =>
      priority
        .map((id) => skills.find((s) => s.skillId === id))
        .filter((s): s is DiscoveredSkill => !!s && !s.hasUi),
    [skills, priority]
  );

  const prepareBatch = useCallback(() => {
    setBatch(missingPriority.map((s) => ({ skillId: s.skillId, name: s.name, state: "pending" as const })));
  }, [missingPriority]);

  useEffect(() => {
    if (batchMode && skills.length && batch.length === 0 && !batchRunning) prepareBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchMode, skills.length]);

  const setBatchItem = (skillId: string, patch: Partial<BatchItem>) => {
    setBatch((prev) => prev.map((b) => (b.skillId === skillId ? { ...b, ...patch } : b)));
  };

  const runBatch = async (items?: BatchItem[]) => {
    const queue = (items ?? batch).filter((b) => b.state === "pending" || b.state === "failed");
    if (!queue.length) return;
    setBatchRunning(true);
    for (const item of queue) {
      setBatchItem(item.skillId, { state: "generating", error: undefined });
      setSelected(item.skillId);
      setGeneratingSkill(item.skillId);
      try {
        const res = await invoke<{ ok: boolean; error?: string }>("generate_ui", { skillId: item.skillId });
        if (!res.ok) throw new Error(res.error || "generation failed");
        markHasUi(item.skillId);
        setBatchItem(item.skillId, { state: "done" });
      } catch (err) {
        setBatchItem(item.skillId, { state: "failed", error: String(err) });
      }
    }
    setGeneratingSkill(null);
    setBatchRunning(false);
    refreshSkills().catch(() => {});
  };

  // --- Tree ---
  const query = search.trim().toLowerCase();
  const matches = useCallback(
    (s: DiscoveredSkill) =>
      !query || `${s.skillId} ${s.name} ${s.category} ${s.description}`.toLowerCase().includes(query),
    [query]
  );

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const generatedCount = skills.filter((s) => s.hasUi).length;
  const priorityDone = priority.filter((id) => skills.find((s) => s.skillId === id)?.hasUi).length;
  const personal = skills.filter((s) => s.tier === "personal");
  const selectedSkill = skills.find((s) => s.skillId === selected);

  const skillRow = (s: DiscoveredSkill, indent: number) => (
    <Box
      key={s.skillId}
      onClick={() => selectSkill(s.skillId)}
      title={s.description}
      style={{
        cursor: "pointer",
        padding: "4px 10px",
        paddingLeft: 12 + indent * 14,
        borderRadius: 4,
        background: s.skillId === selected ? "var(--accent-4)" : undefined,
      }}
    >
      <Flex align="center" gap="1">
        {s.hasUi ? (
          <DotFilledIcon style={{ color: "var(--accent-9)", flexShrink: 0 }} />
        ) : (
          <DotIcon style={{ color: "var(--gray-7)", flexShrink: 0 }} />
        )}
        <Text size="2" color={s.skillId === selected ? undefined : "gray"} truncate>
          {s.name}
        </Text>
      </Flex>
    </Box>
  );

  const sectionHeader = (label: string, count: number, open: boolean, onClick: () => void, sub = false) => (
    <Flex
      align="center"
      gap="1"
      onClick={onClick}
      px="2"
      py="1"
      pl={sub ? "5" : "2"}
      style={{ cursor: "pointer" }}
    >
      {open ? (
        <ChevronDownIcon style={{ color: "var(--gray-9)" }} />
      ) : (
        <ChevronRightIcon style={{ color: "var(--gray-9)" }} />
      )}
      <Text size="1" weight={sub ? "regular" : "bold"} color={sub ? "iris" : "gray"} style={{ flex: 1, textTransform: sub ? "none" : "uppercase", letterSpacing: sub ? 0 : "0.5px" }}>
        {label}
      </Text>
      <Text size="1" color="gray">{count}</Text>
    </Flex>
  );

  const renderTierSection = (tier: DiscoveredSkill["tier"], label: string) => {
    const tierSkills = skills.filter((s) => s.tier === tier && matches(s));
    if (query && tierSkills.length === 0) return null;
    const key = `tier:${tier}`;
    const open = query ? true : expanded.has(key);
    const byCategory = tierSkills.length > 12;
    const categories = byCategory ? [...new Set(tierSkills.map((s) => s.category))].sort() : [];

    return (
      <Box key={key}>
        {sectionHeader(label, tierSkills.length, open, () => toggleExpanded(key))}
        {open &&
          (byCategory
            ? categories.map((cat) => {
                const catKey = `${key}/${cat}`;
                const catOpen = query ? true : expanded.has(catKey);
                const catSkills = tierSkills.filter((s) => s.category === cat);
                return (
                  <Box key={catKey}>
                    {sectionHeader(cat, catSkills.length, catOpen, () => toggleExpanded(catKey), true)}
                    {catOpen && catSkills.map((s) => skillRow(s, 2))}
                  </Box>
                );
              })
            : tierSkills.map((s) => skillRow(s, 1)))}
      </Box>
    );
  };

  const railBtn = (v: RailView, icon: React.ReactNode, label: string, dot = false) => (
    <Box style={{ position: "relative", borderLeft: view === v ? "2px solid var(--accent-9)" : "2px solid transparent" }}>
      <IconButton
        variant={view === v ? "soft" : "ghost"}
        color={view === v ? undefined : "gray"}
        size="3"
        title={label}
        onClick={() => setView(v)}
      >
        {icon}
      </IconButton>
      {dot && <Box style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: "50%", background: "var(--amber-9)" }} />}
    </Box>
  );

  return (
    <Flex style={{ height: "100vh", width: "100vw", overflow: "hidden" }}>
      {/* Activity rail */}
      <Flex direction="column" align="center" gap="1" pt="2" style={{ width: 48, flexShrink: 0, background: "var(--gray-1)", borderRight: "1px solid var(--gray-3)" }}>
        {railBtn("skills", <CubeIcon width="18" height="18" />, "Skills")}
        {railBtn("status", <GearIcon width="18" height="18" />, "Status & batch", batchRunning)}
        {railBtn("marketplace", <BackpackIcon width="18" height="18" />, "Marketplace (coming with the registry)")}
      </Flex>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <SplitPane direction="horizontal" sizes={[26, 74]} minSize={200}>
          {/* Sidebar */}
          {view === "skills" ? (
            <Flex direction="column" style={{ height: "100%", background: "var(--gray-2)" }}>
              <Box p="2" style={{ borderBottom: "1px solid var(--gray-3)" }}>
                <TextField.Root
                  size="1"
                  placeholder="Search skills…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                >
                  <TextField.Slot>
                    <MagnifyingGlassIcon />
                  </TextField.Slot>
                </TextField.Root>
              </Box>
              <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
                <Box py="1">{TIER_SECTIONS.map(({ tier, label }) => renderTierSection(tier, label))}</Box>
              </ScrollArea>
            </Flex>
          ) : view === "status" ? (
            <ScrollArea scrollbars="vertical" style={{ height: "100%", background: "var(--gray-2)" }}>
              <Flex direction="column" gap="3" p="3">
                <Heading size="2" color="gray">Status</Heading>
                <Card>
                  <Flex direction="column" gap="2">
                    <Text size="1" weight="bold" color="indigo">COVERAGE</Text>
                    <CoverageRow label="All skills" done={generatedCount} total={skills.length} />
                    <CoverageRow label="Priority 10" done={priorityDone} total={priority.length} />
                    <CoverageRow label="My skills" done={personal.filter((s) => s.hasUi).length} total={personal.length} />
                  </Flex>
                </Card>

                <Card>
                  <Flex direction="column" gap="2">
                    <Flex align="center" gap="2">
                      <Text size="1" weight="bold" color="indigo">BATCH GENERATION</Text>
                      {batchRunning && <Badge color="amber" variant="soft" radius="full">running</Badge>}
                    </Flex>
                    {batch.length === 0 ? (
                      <>
                        <Text size="1" color="gray">
                          {missingPriority.length === 0
                            ? "All priority skills have UIs ✓"
                            : `${missingPriority.length} priority skill${missingPriority.length === 1 ? "" : "s"} without a UI. Each generation is one LLM call (~30–60s).`}
                        </Text>
                        {missingPriority.length > 0 && (
                          <Button size="1" onClick={prepareBatch}>Review & generate ({missingPriority.length})</Button>
                        )}
                      </>
                    ) : (
                      <>
                        <Flex direction="column" gap="1" style={{ maxHeight: 220, overflowY: "auto" }}>
                          {batch.map((b) => (
                            <Flex key={b.skillId} align="center" gap="2">
                              <Text style={{ color: batchColor(b.state), width: 14 }}>{glyphFor(b.state)}</Text>
                              <Text size="1" truncate style={{ flex: 1 }}>{b.name}</Text>
                              {b.state === "failed" && !batchRunning && (
                                <Button size="1" variant="ghost" onClick={() => runBatch([{ ...b }])}>retry</Button>
                              )}
                            </Flex>
                          ))}
                        </Flex>
                        {!batchRunning && batch.some((b) => b.state === "pending") && (
                          <Button size="1" onClick={() => runBatch()}>
                            ⚡ Start ({batch.filter((b) => b.state === "pending").length} to generate)
                          </Button>
                        )}
                        {!batchRunning && !batch.some((b) => b.state === "pending" || b.state === "failed") && (
                          <Text size="1" color="gray">Batch complete ✓</Text>
                        )}
                      </>
                    )}
                  </Flex>
                </Card>

                {selectedSkill && (
                  <Card>
                    <Flex direction="column" gap="2">
                      <Text size="2" weight="bold">{selectedSkill.name}</Text>
                      <Text size="1" color="gray">{selectedSkill.description}</Text>
                      <Flex align="center" gap="2">
                        <Text size="1" color="gray" style={{ width: 64 }}>tier</Text>
                        <Badge variant="soft" color={TIER_COLOR[selectedSkill.tier]}>{selectedSkill.tier}</Badge>
                      </Flex>
                      <Flex align="center" gap="2">
                        <Text size="1" color="gray" style={{ width: 64 }}>category</Text>
                        <Text size="1">{selectedSkill.category}</Text>
                      </Flex>
                      <Flex align="center" gap="2">
                        <Text size="1" color="gray" style={{ width: 64 }}>UI</Text>
                        <Text size="1" color={selectedSkill.hasUi ? "green" : "gray"}>
                          {selectedSkill.hasUi
                            ? `generated · ${versions.length} version${versions.length === 1 ? "" : "s"}`
                            : "not generated"}
                        </Text>
                      </Flex>
                    </Flex>
                  </Card>
                )}
              </Flex>
            </ScrollArea>
          ) : (
            <Box p="3" style={{ height: "100%", background: "var(--gray-2)" }}>
              <Flex direction="column" gap="3">
                <Heading size="2" color="gray">Marketplace</Heading>
                <Card>
                  <Flex direction="column" gap="2">
                    <Text size="1" weight="bold" color="indigo">COMMUNITY UI REGISTRY</Text>
                    <Text size="1" color="gray">
                      Install polished community-built UIs for famous skills, publish your own.
                      Coming with the registry — see design doc, "Skill Tiers".
                    </Text>
                  </Flex>
                </Card>
              </Flex>
            </Box>
          )}

          {/* Main: change console — no embedded preview; UIs live in their own windows */}
          <Flex direction="column" style={{ height: "100%", background: "var(--gray-2)" }}>
            {!selected ? (
              <Flex align="center" justify="center" style={{ flex: 1 }} p="4">
                <Text color="gray" align="center">Select a skill to edit — its UI opens in its own window</Text>
              </Flex>
            ) : (
              <>
                <Flex align="center" justify="between" px="3" py="2" style={{ borderBottom: "1px solid var(--gray-4)" }}>
                  <Flex align="center" gap="2">
                    <Heading size="3">{selectedSkill?.name ?? selected}</Heading>
                    {selectedSkill && (
                      <Badge variant="soft" color={TIER_COLOR[selectedSkill.tier]}>{selectedSkill.tier}</Badge>
                    )}
                  </Flex>
                  <Flex gap="2">
                    <Button size="1" variant="soft" onClick={() => openWindow(selected)}>Open window</Button>
                    <Button size="1" variant="soft" onClick={() => handleGenerate()} disabled={!!busy}>
                      {selectedSkill?.hasUi ? "♻ Regenerate" : "⚡ Generate"}
                    </Button>
                  </Flex>
                </Flex>

                {generatingSkill === selected && progress ? (
                  <Box style={{ flex: 1, overflow: "hidden" }}>
                    <GenerationProgress progress={progress} />
                  </Box>
                ) : (
                  <ScrollArea scrollbars="vertical" style={{ flex: 1 }}>
                    <Flex direction="column" gap="3" p="3">
                      {selectedSkill && (
                        <Card>
                          <Flex direction="column" gap="1">
                            <Text size="1" color="gray">{selectedSkill.description}</Text>
                            <Text size="1" color={selectedSkill.hasUi ? "green" : "gray"}>
                              {selectedSkill.hasUi
                                ? `UI generated · ${versions.length} version${versions.length === 1 ? "" : "s"}`
                                : "No UI yet — Generate to create one"}
                            </Text>
                          </Flex>
                        </Card>
                      )}

                      <Card>
                        <Flex direction="column" gap="2">
                          <Text size="1" weight="bold" color="indigo">CHANGE THIS UI</Text>
                          <form onSubmit={handleModify}>
                            <Flex gap="2">
                              <Box style={{ flex: 1 }}>
                                <TextField.Root
                                  placeholder={selectedSkill?.hasUi ? 'e.g. "make the terminal collapsible"' : "Generate a UI first, then describe changes"}
                                  value={instruction}
                                  onChange={(e) => setInstruction(e.target.value)}
                                  disabled={!selectedSkill?.hasUi || !!busy}
                                />
                              </Box>
                              <Button type="submit" disabled={!selectedSkill?.hasUi || !!busy || !instruction.trim()}>
                                Apply
                              </Button>
                            </Flex>
                          </form>
                          <Text size="1" color="gray">Changes recompile and the skill's window updates live.</Text>
                          {busy && <Text size="1" color="amber" style={{ fontStyle: "italic" }}>{busy}</Text>}
                          {error && <Text size="1" color="red">{error}</Text>}
                        </Flex>
                      </Card>

                      <Card>
                        <Flex direction="column" gap="1">
                          <Flex gap="2" align="center" mb="1">
                            <Text size="1" weight="bold" color="gray">VERSIONS</Text>
                            <Text size="1" color="gray">{versions.length}</Text>
                          </Flex>
                          {versions.length === 0 && <Text size="1" color="gray">No versions yet</Text>}
                          {versions.map((v, i) => (
                            <Flex key={v.hash} align="center" gap="2" py="1">
                              <Text size="1" style={{ color: "var(--accent-9)" }}>{v.hash.slice(0, 8)}</Text>
                              <Text size="1" color="gray" truncate style={{ flex: 1 }}>{v.message}</Text>
                              {i > 0 ? (
                                <Button size="1" variant="ghost" color="gray" onClick={() => handleRevert(v.hash)} disabled={!!busy}>
                                  revert
                                </Button>
                              ) : (
                                <Badge size="1" color="green" variant="soft">current</Badge>
                              )}
                            </Flex>
                          ))}
                        </Flex>
                      </Card>
                    </Flex>
                  </ScrollArea>
                )}
              </>
            )}
          </Flex>
        </SplitPane>
      </Box>
    </Flex>
  );
}

function CoverageRow({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <Flex align="center" gap="2">
      <Text size="1" color="gray" style={{ width: 80, flexShrink: 0 }}>{label}</Text>
      <Box style={{ flex: 1 }}>
        <Progress value={pct} size="1" />
      </Box>
      <Text size="1" color="gray" style={{ width: 48, textAlign: "right", flexShrink: 0 }}>{done}/{total}</Text>
    </Flex>
  );
}

function glyphFor(state: BatchItemState): string {
  return state === "pending" ? "○" : state === "generating" ? "◐" : state === "done" ? "●" : state === "failed" ? "✗" : "—";
}
function batchColor(state: BatchItemState): string {
  return state === "done" ? "var(--green-9)" : state === "failed" ? "var(--red-9)" : state === "generating" ? "var(--amber-9)" : "var(--gray-7)";
}
