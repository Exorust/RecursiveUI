// ---------------------------------------------------------------------------
// @recursiveui/sdk — hooks, components, and types for building skill UIs
// ---------------------------------------------------------------------------

// Hooks — the primary interface between skill UIs and the RecursiveUI runtime
export { useSkill } from "./hooks/useSkill";
export type { SkillHandle, SkillStatus, ToolUse, ChatMessage, PendingQuestion, QuestionAnswer } from "./hooks/useSkill";
export { useSkillMeta } from "./hooks/useSkillMeta";
export type { SkillMeta } from "./hooks/useSkillMeta";
export { useSession } from "./hooks/useSession";
export type { SessionHandle } from "./hooks/useSession";
export { useTelemetry } from "./hooks/useTelemetry";
export type { TelemetryHandle } from "./hooks/useTelemetry";
export { useEvolution } from "./hooks/useEvolution";
export type { EvolutionHandle, VersionEntry } from "./hooks/useEvolution";
export { useModel } from "./hooks/useModel";
export type { ModelHandle } from "./hooks/useModel";

// Layout
export { SplitPane } from "./components/layout/SplitPane";
export { TabGroup } from "./components/layout/TabGroup";

// Core components — always available, every skill can use these
export { AgentChat } from "./components/core/AgentChat";
export { MemoryBrowser } from "./components/core/MemoryBrowser";
export { PlanTracker } from "./components/core/PlanTracker";
export { SessionCostDashboard } from "./components/core/SessionCostDashboard";
export { CommunityBrowser } from "./components/core/CommunityBrowser";
export { FindingsPanel } from "./components/core/FindingsPanel";

// Coding pack
export { DiffViewer } from "./components/coding/DiffViewer";
export { TerminalLog } from "./components/coding/TerminalLog";
export { TestResultsPanel } from "./components/coding/TestResultsPanel";
export { FileBrowser } from "./components/coding/FileBrowser";

// Communication pack
export { UnifiedInbox } from "./components/communication/UnifiedInbox";
export { ChannelMonitor } from "./components/communication/ChannelMonitor";

// Research pack
export { ResearchDashboard } from "./components/research/ResearchDashboard";
export { DocumentViewer } from "./components/research/DocumentViewer";

// Ops pack
export { AgentFleetDashboard } from "./components/ops/AgentFleetDashboard";
export { DeploymentPipeline } from "./components/ops/DeploymentPipeline";
export { HealthMonitor } from "./components/ops/HealthMonitor";

// Data pack
export { QueryExplorer } from "./components/data/QueryExplorer";
export { ChartVisualization } from "./components/data/ChartVisualization";

// Design pack
export { DesignPreview } from "./components/design/DesignPreview";
export { ComponentBrowserUI } from "./components/design/ComponentBrowserUI";

// Kit — runtime bridge for generated code (window.__REK)
export { installKit, importGeneratedApp, loadGeneratedApp, generateApp, radixAccent, accentForSkill, humanizeSkill } from "./kit";
export type { GeneratedApp, GenomeTokens } from "./kit";

// NOTE: the generation catalog (CATALOG + buildGenerationPrompt) is canonical in
// app/sidecar/catalog.ts (genome-aware, wired into the generator). The earlier
// scaffold copy here was removed to avoid two diverging catalogs.
