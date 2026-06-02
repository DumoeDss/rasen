// Types
export {
  StageSchema,
  StageRoleSchema,
  StageLoopSchema,
  StageKindSchema,
  VerifyPolicySchema,
  PipelineYamlSchema,
  DEFAULT_CHILD_PIPELINE,
  type Stage,
  type StageRole,
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
  StageStatusSchema,
  RunStateValidationError,
  runStatePath,
  parseRunState,
  readRunState,
  writeRunState,
  completedStages,
  type RunState,
  type RunStateStage,
  type StageStatus,
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
  isPortfolioComplete,
  type PortfolioState,
  type PortfolioChild,
  type ChildExecutionMode,
} from './portfolio-state.js';
