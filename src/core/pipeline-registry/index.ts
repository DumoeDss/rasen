// Types
export {
  StageSchema,
  StageRoleSchema,
  AgentRuntimeSchema,
  AgentRuntimeSessionReuseSchema,
  AgentRuntimeSandboxSchema,
  AgentRuntimeConfigSchema,
  AgentRuntimeConfigValueSchema,
  PipelineAgentRuntimeOverridesSchema,
  normalizeAgentRuntimeConfig,
  resolveStageRuntimeConfig,
  resolveStageHandoffConfig,
  resolvePipelineReuseConfig,
  StageLoopSchema,
  StageKindSchema,
  VerifyPolicySchema,
  PipelineYamlSchema,
  HandoffConfigSchema,
  ReuseConfigSchema,
  ReuseModeSchema,
  DEFAULT_CHILD_PIPELINE,
  DEFAULT_HANDOFF_CONFIG,
  DEFAULT_REUSE_CONFIG,
  type Stage,
  type StageRole,
  type AgentRuntime,
  type AgentRuntimeSessionReuse,
  type AgentRuntimeSandbox,
  type AgentRuntimeConfig,
  type PipelineAgentRuntimeOverrides,
  type ResolvedStageRuntimeConfig,
  type ResolvedStageHandoffConfig,
  type ResolvedReuseConfig,
  type HandoffConfig,
  type ReuseConfig,
  type ReuseMode,
  type StageLoop,
  type StageKind,
  type VerifyPolicy,
  type PipelineYaml,
  type CompletedSet,
  type BlockedStages,
} from './types.js';

// Pipeline loading and validation
export {
  loadPipeline,
  parsePipeline,
  validatePipelineSkills,
  PipelineValidationError,
} from './pipeline.js';

// Graph operations
export { PipelineGraph } from './graph.js';

// Completion-set state helpers
export {
  createCompletedSet,
  markCompleted,
  unmarkCompleted,
  isStageCompleted,
} from './state.js';

// Run-state (auto-run.json) — typed contract for resume/observability
export {
  RUN_STATE_FILENAME,
  RunStateSchema,
  RunStateStageSchema,
  RunStateWorkerSchema,
  StageStatusSchema,
  StageHandoffRecordSchema,
  SessionHandoffSchema,
  RunStateValidationError,
  runStatePath,
  parseRunState,
  readRunState,
  writeRunState,
  completedStages,
  normalizeWorker,
  stageWorkers,
  stagesWithStatus,
  latestStageHandoffs,
  sessionHandoffGeneration,
  type RunState,
  type RunStateStage,
  type RunStateWorker,
  type StageStatus,
  type StageHandoffRecord,
  type SessionHandoff,
} from './run-state.js';

// Pipeline resolution
export {
  loadPipelineByName,
  resolvePipelinePath,
  listPipelines,
  listPipelinesWithInfo,
  getPipelineDir,
  getPackagePipelinesDir,
  getUserPipelinesDir,
  getProjectPipelinesDir,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
  PipelineLoadError,
  type PipelineInfo,
} from './resolver.js';

// Legacy skill-ID recognition (resume old->new hinting)
export { mapLegacySkillId } from './legacy-skill.js';

// Portfolio run-state (portfolio-run.json) — multi-change observability + resume
export {
  PORTFOLIO_STATE_FILENAME,
  PortfolioStateSchema,
  PortfolioChildSchema,
  ChildExecutionModeSchema,
  PortfolioStateValidationError,
  portfolioStatePath,
  parsePortfolioState,
  readPortfolioState,
  writePortfolioState,
  runnableChildren,
  interruptedChildren,
  escalatedChildren,
  isPortfolioComplete,
  type PortfolioState,
  type PortfolioChild,
  type ChildExecutionMode,
} from './portfolio-state.js';
