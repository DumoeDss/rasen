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
  type HandoffConfigLayers,
  type ModelConfigLayers,
  type ModelSource,
  type RuntimeSource,
  type StageOverride,
  type StageOverrideScope,
  type StageConfigOverrides,
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
  type ThresholdValue,
} from './types.js';

// Pipeline loading and validation
export {
  loadPipeline,
  parsePipeline,
  validatePipelineSkills,
  PipelineValidationError,
} from './pipeline.js';
export {
  resolvePipelineExecutionSkillSets,
  validatePipelineForExecution,
  type PipelineExecutionSkillSets,
  type PipelineExecutionOptions,
} from './execution-validation.js';

// Per-pipeline stage-override resolver + gate mask (config top layer)
export {
  bucketPipelineStageOverrides,
  resolvePipelineStageOverrides,
  resolveMaskedStageGate,
  resolveEffectiveStage,
  stageConfigOverridesFor,
  type PipelineStageOverrides,
  type MaskedStageGate,
  type MaskedGateSource,
  type EffectiveStageConfig,
  type EffectiveStageInputs,
} from './stage-overrides.js';

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
  readRunStateDetailed,
  writeRunState,
  resolveRunStateLocation,
  completedStages,
  normalizeWorker,
  normalizeRunStateWorkerRecord,
  stageWorkers,
  stagesWithStatus,
  stagesLackingDurableHandle,
  detectDuplicateKeys,
  latestStageHandoffs,
  sessionHandoffGeneration,
  type RunState,
  type RunStateStage,
  type RunStateWorker,
  type StageStatus,
  type StageHandoffRecord,
  type SessionHandoff,
  type RunStateLocation,
  type RunStateReadResult,
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
  resolvePortfolioStateLocation,
  runnableChildren,
  interruptedChildren,
  escalatedChildren,
  isPortfolioComplete,
  type PortfolioState,
  type PortfolioChild,
  type ChildExecutionMode,
  type PortfolioStateLocation,
} from './portfolio-state.js';
