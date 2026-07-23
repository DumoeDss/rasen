/**
 * Codex dispatch primitives — public surface.
 *
 * Siblings of this change (codex-runtime-lifecycle, codex-runtime-context-probe,
 * codex-runtime-playbook-integration) import from this module root only
 * (design D10) — never reach into individual files under `src/core/codex/`.
 */
export { resolveCodexHome, CODEX_CLI_VERSION_PREMISE } from './codex-home.js';
export { probeCodexAvailability } from './availability.js';
export {
  buildCodexExecInvocation,
  formatShellInvocation,
  CODEX_FLAT_HIERARCHY_GUARD,
  type CodexSandboxMode,
  type CodexReasoningEffort,
  type ModelProviderOverride,
  type CodexTemplateOptions,
  type CodexResumeOptions,
  type BuildCodexExecInvocationOptions,
  type CodexExecInvocation,
  type FormatShellInvocationOptions,
} from './invocation.js';
export { inlineCommandTemplate, type TemplateInliner } from './template-inline.js';
export {
  LEAF_RETURN_SCHEMA,
  EVALUATE_GATE_SCHEMA,
  parseLeafReturn,
  parseEvaluateGate,
  type LeafReturn,
  type EvaluateGateResult,
} from './contracts.js';
export {
  parseExecEventStream,
  extractThreadId,
  type CodexExecEvent,
  type ThreadStartedEvent,
  type TurnStartedEvent,
  type TurnCompletedEvent,
  type TurnFailedEvent,
  type ItemEvent,
  type UnknownExecEvent,
} from './exec-events.js';
export {
  findRolloutPath,
  readRolloutOccupancy,
  readRolloutConversation,
  readRolloutSessionMeta,
  listRolloutFiles,
  type FindRolloutPathOptions,
  type RolloutOccupancy,
  type RolloutConversation,
  type RolloutConversationTurn,
  type RolloutFinalAnswerRecord,
  type RolloutFileEntry,
} from './rollout.js';
export { buildCodexWorkerRecord, type BuildCodexWorkerRecordOptions } from './identity.js';
export {
  detectThreadDeath,
  detectDeathInRows,
  CODEX_REVIVAL_NOTICE,
  classifyTurnFailure,
  backoffDelayMs,
  claimThreadWriter,
  isThreadWriterClaimed,
  distillWarmSeed,
  type ThreadDeathResult,
  type TurnFailureKind,
  type TurnFailureClassification,
  type BackoffOptions,
  type DistilledWarmSeed,
} from './lifecycle.js';
