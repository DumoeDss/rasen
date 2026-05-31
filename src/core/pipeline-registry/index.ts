// Types
export {
  StageSchema,
  StageRoleSchema,
  StageLoopSchema,
  VerifyPolicySchema,
  PipelineYamlSchema,
  type Stage,
  type StageRole,
  type StageLoop,
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
  PipelineLoadError,
  type PipelineInfo,
} from './resolver.js';
