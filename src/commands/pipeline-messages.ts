import { getCliLocale } from '../core/cli-locale.js';
import {
  formatLocaleMessage,
  getLocaleCatalog,
  type LocaleCatalog,
} from '../locales/index.js';
import type { ReconcilerSupportAnalysis } from '../core/pipeline-registry/execution-plan-internal.js';
import type { PipelineExecutionNotice } from '../core/pipeline-registry/execution-validation.js';
import type { RootSelectionNotice } from '../core/root-selection.js';
import type { StoreUnavailableReason } from '../core/store/identity.js';
import type { CliLocale } from '../utils/locale.js';

export const BUILT_IN_PIPELINE_IDS = [
  'auto-decompose',
  'bug-fix',
  'full-feature',
  'goal-loop-evaluate',
  'goal-loop-measure',
  'goal-loop-research',
  'small-feature',
  'task-loop',
] as const;

export type BuiltInPipelineId = (typeof BUILT_IN_PIPELINE_IDS)[number];

export interface PipelineMessageValues {
  errorPrefix: undefined;
  errorWithDetail: { detail: string };
  rawDetailLabel: undefined;
  none: undefined;
  complete: undefined;
  recorded: undefined;
  bareWorkerLabel: undefined;
  inheritingStoreConfigByIdentityNotice: { path: string; store: string };
  inheritingStoreConfigByAliasNotice: { path: string; store: string };
  unavailableStoreDeclaration: { path: string; store: string; reason: string; repair: string };
  storeReasonNotRegistered: undefined;
  storeReasonMetadataMissing: undefined;
  storeReasonUidMismatch: undefined;
  storeReasonRootUnhealthy: undefined;
  storeReasonAliasAmbiguous: undefined;
  storeReasonPointerMalformed: undefined;
  selectedStoreRoot: { store: string; path: string };
  selectedProjectRoot: { project: string; path: string };
  staleProfileWorkflowsWarning: { workflows: string };
  unknownHostRuntimeWarning: { override: string };
  hostRuntimeWithoutDispatchAdapterWarning: { host: string; override: string };
  noPipelinesFound: undefined;
  availablePipelinesHeading: undefined;
  pipelineTableEntry: { name: string; source: string };
  pipelineTableStages: { stages: string };
  pipelineLabel: { name: string };
  definitionVersionLabel: { version: number };
  compatibilityBoundaryLabel: { boundary: string };
  hostRuntimeLabel: { runtime: string; source: string };
  pipelineNotFound: { name: string; available: string };
  originLabel: { origin: string };
  buildOrderHeading: undefined;
  boundedLoopPoliciesHeading: undefined;
  boundedLoopPolicyLine: { node: string; limits: string; policy: string };
  // ECP-5 (task 6.1): engine support rendered as PRODUCT LANGUAGE in the human
  // `pipeline show` output. Every reason the analyzer can emit has copy here;
  // the reason CODE stays beside the copy because the CLI, the management API
  // and the Canvas all print the same token.
  engineSupportHeading: undefined;
  engineSupportEngines: { engines: string };
  engineSupportSupported: { reason: string; copy: string };
  engineSupportUnsupported: { reason: string; copy: string };
  enginePolicyLine: { configured: string; source: string; effective: string };
  engineReasonSupportedRootDagBugFix: undefined;
  engineReasonSupportedV2ReviewCycle: undefined;
  engineReasonSupportedV2Executable: undefined;
  engineReasonSupportedV2Parallel: undefined;
  engineReasonUnsupportedDefinitionVersion: undefined;
  engineReasonUnsupportedPipelineShape: undefined;
  engineReasonUnsupportedPipelineSemantics: undefined;
  engineReasonExecutionProfileUnavailable: undefined;
  thresholdTokensRemaining: { tokens: number };
  stageMetaRole: { role: string };
  stageMetaRequires: { requires: string };
  stageMetaGate: undefined;
  stageMetaReviewLoop: { maximum: number };
  stageMetaGoalLoop: { gate: string; maximum: number; stall: number };
  stageMetaParallelGroup: { group: string };
  stageMetaCondition: { condition: string };
  stageMetaLeadReview: undefined;
  stageMetaVerifyPolicy: { policy: string };
  stageMetaRuntime: { runtime: string };
  stageMetaRuntimeSource: { runtime: string; source: string };
  stageMetaDispatch: { mode: string };
  stageMetaSessionReuse: { session: string };
  stageMetaSandbox: { sandbox: string };
  stageMetaHandoff: { threshold: string; source: string };
  stageActionDecompose: { pipeline: string };
  stageLine: { id: string; action: string; suffix: string };
  projectOverrideLabel: { path: string };
  roleRuntimesHeading: undefined;
  stagesHeading: undefined;
  agentRoleLine: { role: string; runtime: string; source: string; dispatch: string };
  agentStageLine: {
    id: string;
    role: string;
    runtime: string;
    source: string;
    dispatch: string;
  };
  invalidRuntime: { runtime: string; role: string };
  suggestedPipeline: { pipeline: string };
  matchedIndicators: { indicators: string };
  matchedIndicatorsDefault: undefined;
  classificationBasis: { basis: string };
  classificationAdvisory: undefined;
  availablePipelines: { pipelines: string };
  portfolioChange: { change: string; count: number };
  changeLabel: { change: string };
  runStateReadFrom: { path: string };
  completed: { stages: string };
  runnableNow: { children: string };
  interrupted: { stages: string };
  escalated: { stages: string };
  persistentPlanner: { planner: string };
  portfolioDelivery: { status: string };
  remaining: { stages: string };
  invalidPortfolioStateNote: { path: string; reason: string };
  invalidRunStateNote: { path: string; reason: string };
  noRunStateNote: undefined;
  nextStage: { stage: string };
  openFindings: { count: number };
  legacySkillHeading: { pipeline: string };
  legacySkillEntry: { stage: string; from: string; to: string };
  workerHandleWarning: { stage: string; recorded: string };
  duplicateRunStateKey: { key: string; path: string };
  resumeHandles: { stages: string };
  resumeClaudeSession: { stage: string; sessionId: string; cwd: string };
  sessionHandoff: { generation: number; path: string };
  gatePolicy: { effective: string; source: string };
  executionBinding: { project: string; path: string };
  executionBindingPlanningOnly: undefined;
  executionBindingMismatch: { frozen: string; found: string; checkout: string };
  executionBindingSelectorConflict: { frozen: string; selector: string };
  executionBindingAmbiguous: { frozen: string; candidates: string };
  executionBindingMissing: { frozen: string };
  sessionContextBroken: { path: string; detail: string };
  createdDraft: { path: string };
  pipelineValid: undefined;
  pipelineInvalid: undefined;
  validationDiagnostic: { severity: string; code: string; message: string };
  importedHeading: { path: string };
  importedEntry: { name: string; digest: string };
  replaceDestination: { path: string };
  exported: { name: string; path: string };
  savedPipeline: { name: string; path: string };
  deletePipeline: { name: string };
  deleted: { name: string };
  forcedDeleteWarning: { name: string; referrers: string };
  pipelineIdCollision: { name: string };
  destinationExists: undefined;
  exportCancelled: undefined;
  deletionRequiresYes: undefined;
  deletionCancelled: undefined;
  engineDisabledByConfig: { layer: string };
  engineUnsupportedForPipeline: { name: string; reason: string; source: string };
  engineOwnerConflict: { runState: string; run: string; reason: string };
  engineOwnedByLegacy: { runState: string; reason: string };
}

export const PIPELINE_MESSAGE_KEYS = [
  'errorPrefix',
  'errorWithDetail',
  'rawDetailLabel',
  'none',
  'complete',
  'recorded',
  'bareWorkerLabel',
  'inheritingStoreConfigByIdentityNotice',
  'inheritingStoreConfigByAliasNotice',
  'unavailableStoreDeclaration',
  'storeReasonNotRegistered',
  'storeReasonMetadataMissing',
  'storeReasonUidMismatch',
  'storeReasonRootUnhealthy',
  'storeReasonAliasAmbiguous',
  'storeReasonPointerMalformed',
  'selectedStoreRoot',
  'selectedProjectRoot',
  'staleProfileWorkflowsWarning',
  'unknownHostRuntimeWarning',
  'hostRuntimeWithoutDispatchAdapterWarning',
  'noPipelinesFound',
  'availablePipelinesHeading',
  'pipelineTableEntry',
  'pipelineTableStages',
  'pipelineLabel',
  'definitionVersionLabel',
  'compatibilityBoundaryLabel',
  'hostRuntimeLabel',
  'pipelineNotFound',
  'originLabel',
  'buildOrderHeading',
  'boundedLoopPoliciesHeading',
  'boundedLoopPolicyLine',
  'engineSupportHeading',
  'engineSupportEngines',
  'engineSupportSupported',
  'engineSupportUnsupported',
  'enginePolicyLine',
  'engineReasonSupportedRootDagBugFix',
  'engineReasonSupportedV2ReviewCycle',
  'engineReasonSupportedV2Executable',
  'engineReasonSupportedV2Parallel',
  'engineReasonUnsupportedDefinitionVersion',
  'engineReasonUnsupportedPipelineShape',
  'engineReasonUnsupportedPipelineSemantics',
  'engineReasonExecutionProfileUnavailable',
  'thresholdTokensRemaining',
  'stageMetaRole',
  'stageMetaRequires',
  'stageMetaGate',
  'stageMetaReviewLoop',
  'stageMetaGoalLoop',
  'stageMetaParallelGroup',
  'stageMetaCondition',
  'stageMetaLeadReview',
  'stageMetaVerifyPolicy',
  'stageMetaRuntime',
  'stageMetaRuntimeSource',
  'stageMetaDispatch',
  'stageMetaSessionReuse',
  'stageMetaSandbox',
  'stageMetaHandoff',
  'stageActionDecompose',
  'stageLine',
  'projectOverrideLabel',
  'roleRuntimesHeading',
  'stagesHeading',
  'agentRoleLine',
  'agentStageLine',
  'invalidRuntime',
  'suggestedPipeline',
  'matchedIndicators',
  'matchedIndicatorsDefault',
  'classificationBasis',
  'classificationAdvisory',
  'availablePipelines',
  'portfolioChange',
  'changeLabel',
  'runStateReadFrom',
  'completed',
  'runnableNow',
  'interrupted',
  'escalated',
  'persistentPlanner',
  'portfolioDelivery',
  'remaining',
  'invalidPortfolioStateNote',
  'invalidRunStateNote',
  'noRunStateNote',
  'nextStage',
  'openFindings',
  'legacySkillHeading',
  'legacySkillEntry',
  'workerHandleWarning',
  'duplicateRunStateKey',
  'resumeHandles',
  'resumeClaudeSession',
  'sessionHandoff',
  'gatePolicy',
  'executionBinding',
  'executionBindingPlanningOnly',
  'executionBindingMismatch',
  'executionBindingSelectorConflict',
  'executionBindingAmbiguous',
  'executionBindingMissing',
  'sessionContextBroken',
  'createdDraft',
  'pipelineValid',
  'pipelineInvalid',
  'validationDiagnostic',
  'importedHeading',
  'importedEntry',
  'replaceDestination',
  'exported',
  'savedPipeline',
  'deletePipeline',
  'deleted',
  'forcedDeleteWarning',
  'pipelineIdCollision',
  'destinationExists',
  'exportCancelled',
  'deletionRequiresYes',
  'deletionCancelled',
  'engineDisabledByConfig',
  'engineUnsupportedForPipeline',
  'engineOwnerConflict',
  'engineOwnedByLegacy',
] as const satisfies readonly (keyof PipelineMessageValues)[];

export type PipelineMessageKey = (typeof PIPELINE_MESSAGE_KEYS)[number];

export const PIPELINE_ERROR_KEYS = [
  'pipeline_not_found',
  'pipeline_id_collision',
  'pipeline_id_invalid',
  'output_id_mismatch',
  'output_not_directory',
  'output_not_empty',
  'pipeline_already_exists',
  'pipeline_builtin_protected',
  'definition_not_found',
  'pipeline_delete_forbidden',
  'pipeline_in_use',
  'destination_exists',
  'destination_not_file',
  'confirmation_required',
  'cancelled',
  'package_not_found',
  'package_not_file',
  'package_too_large',
  'package_changed',
  'staged_digest_mismatch',
  'pipeline_registry_busy',
  // ECP-5 engine selection policy: the reconciler off-switch's typed refusal
  // and the forced/auto unsupported failure.
  'engine_disabled_by_config',
  'engine_unsupported',
  'engine_owner_conflict',
  'launch_request_conflict',
  'task_loop_input_missing',
  'task_loop_input_invalid',
  'task_loop_bar_unprovable',
  'task_loop_critic_reused',
  'task_loop_bar_mismatch',
  'task_loop_evidence_missing',
  'task_loop_false_satisfaction',
  'task_loop_reconciler_required',
  'task_loop_blocked',
  'task_loop_exhausted',
  'task_loop_delivery_guard',
  'pipeline_command_error',
] as const;

export type PipelineErrorKey = (typeof PIPELINE_ERROR_KEYS)[number];

type PipelineMessageArguments<K extends PipelineMessageKey> =
  PipelineMessageValues[K] extends undefined ? [] : [values: PipelineMessageValues[K]];

export class PipelineMessages {
  constructor(
    readonly locale: CliLocale,
    private readonly catalog: LocaleCatalog
  ) {}

  format<K extends PipelineMessageKey>(
    key: K,
    ...args: PipelineMessageArguments<K>
  ): string {
    const template = this.catalog.pipeline.messages[key];
    const values = (args[0] ?? {}) as Record<string, string | number>;
    return formatLocaleMessage(template, values);
  }

  formatDescriptor(
    key: PipelineMessageKey,
    values?: Record<string, string | number>
  ): string {
    return formatLocaleMessage(this.catalog.pipeline.messages[key], values ?? {});
  }

  errorSummary(code: string): string {
    const errors = this.catalog.pipeline.errors as Record<string, string>;
    const template = errors[code] ?? errors.pipeline_command_error;
    return formatLocaleMessage(template, { code });
  }

  description(name: string, source: 'project' | 'user' | 'package', fallback: string): string {
    if (source !== 'package') return fallback;
    const builtIns = this.catalog.pipeline.builtIns as Record<
      string,
      { description: string }
    >;
    return builtIns[name]?.description ?? fallback;
  }
}

export function getPipelineMessages(
  locale: CliLocale = getCliLocale()
): PipelineMessages {
  return new PipelineMessages(locale, getLocaleCatalog(locale));
}

/**
 * ECP-5 (task 6.1): the reason-code -> product-copy table. EVERY reason
 * `resolveReconcilerSupport` can emit has an entry — the record is keyed by the
 * analyzer's own union, so adding a reason there without copy here is a type
 * error rather than a silently-raw code in the product surface.
 */
export const RECONCILER_SUPPORT_REASON_KEYS: Record<
  ReconcilerSupportAnalysis['reconcilerSupport']['reason'],
  PipelineMessageKey
> = {
  supported_root_dag_bug_fix: 'engineReasonSupportedRootDagBugFix',
  supported_v2_review_cycle: 'engineReasonSupportedV2ReviewCycle',
  supported_v2_executable: 'engineReasonSupportedV2Executable',
  supported_v2_parallel: 'engineReasonSupportedV2Parallel',
  unsupported_definition_version: 'engineReasonUnsupportedDefinitionVersion',
  unsupported_pipeline_shape: 'engineReasonUnsupportedPipelineShape',
  unsupported_pipeline_semantics: 'engineReasonUnsupportedPipelineSemantics',
  execution_profile_unavailable: 'engineReasonExecutionProfileUnavailable',
};

/** One localized phrase per unavailable reason (design D13's reason set). */
const STORE_UNAVAILABLE_REASON_KEYS: Record<StoreUnavailableReason, PipelineMessageKey> = {
  'not-registered': 'storeReasonNotRegistered',
  'metadata-missing': 'storeReasonMetadataMissing',
  'uid-mismatch': 'storeReasonUidMismatch',
  'root-unhealthy': 'storeReasonRootUnhealthy',
  'alias-ambiguous': 'storeReasonAliasAmbiguous',
  'pointer-malformed': 'storeReasonPointerMalformed',
};

export function formatPipelineRootSelectionNotice(
  notice: RootSelectionNotice,
  locale: CliLocale = getCliLocale()
): string {
  const messages = getPipelineMessages(locale);
  if (notice.kind === 'inheriting-store-config') {
    return messages.format(
      notice.resolvedBy === 'uid'
        ? 'inheritingStoreConfigByIdentityNotice'
        : 'inheritingStoreConfigByAliasNotice',
      { path: notice.filePath, store: notice.storeId }
    );
  }
  if (notice.kind === 'unavailable-store-declaration') {
    return messages.format('unavailableStoreDeclaration', {
      path: notice.filePath,
      store: notice.storeId,
      reason: messages.formatDescriptor(STORE_UNAVAILABLE_REASON_KEYS[notice.reason]),
      repair: notice.repair,
    });
  }
  if (notice.storeType === 'project') {
    return messages.format('selectedProjectRoot', {
      project: notice.storeId,
      path: notice.path,
    });
  }
  return messages.format('selectedStoreRoot', {
    store: notice.storeId,
    path: notice.path,
  });
}

export function formatPipelineExecutionNotice(
  notice: PipelineExecutionNotice,
  locale: CliLocale = getCliLocale()
): string {
  const messages = getPipelineMessages(locale);
  if (notice.kind === 'unknown-host-runtime') {
    return messages.format('unknownHostRuntimeWarning', { override: notice.override });
  }
  if (notice.kind === 'host-runtime-without-dispatch-adapter') {
    return messages.format('hostRuntimeWithoutDispatchAdapterWarning', {
      host: notice.host,
      override: notice.override,
    });
  }
  return messages.format('staleProfileWorkflowsWarning', {
    workflows: notice.workflowIds.join(', '),
  });
}

export class PipelineMessageError extends Error {
  constructor(
    readonly key: PipelineMessageKey,
    readonly values: Record<string, string | number>,
    readonly code = 'pipeline_command_error'
  ) {
    super(key);
    this.name = 'PipelineMessageError';
  }
}

export function pipelineMessageError<K extends PipelineMessageKey>(
  key: K,
  values: PipelineMessageValues[K],
  code = 'pipeline_command_error'
): PipelineMessageError {
  return new PipelineMessageError(
    key,
    (values ?? {}) as Record<string, string | number>,
    code
  );
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'pipeline_command_error';
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TASK_LOOP_ERROR_CODES = new Set<string>([
  'launch_request_conflict',
  'task_loop_input_missing',
  'task_loop_input_invalid',
  'task_loop_bar_unprovable',
  'task_loop_critic_reused',
  'task_loop_bar_mismatch',
  'task_loop_evidence_missing',
  'task_loop_false_satisfaction',
  'task_loop_reconciler_required',
  'task_loop_blocked',
  'task_loop_exhausted',
  'task_loop_delivery_guard',
]);

export function formatPipelineErrorDetail(
  error: unknown,
  locale: CliLocale = getCliLocale()
): string {
  if (error instanceof PipelineMessageError) {
    return getPipelineMessages(locale).formatDescriptor(error.key, error.values);
  }
  const code = errorCode(error);
  if (TASK_LOOP_ERROR_CODES.has(code)) {
    const messages = getPipelineMessages(locale);
    return `${code}: ${messages.errorSummary(code)} ${errorDetail(error)}`;
  }
  return errorDetail(error);
}

export function formatPipelineError(
  error: unknown,
  locale: CliLocale = getCliLocale()
): string {
  const messages = getPipelineMessages(locale);
  if (error instanceof PipelineMessageError) {
    return messages.format('errorWithDetail', {
      detail: messages.formatDescriptor(error.key, error.values),
    });
  }

  const detail = errorDetail(error);
  const code = errorCode(error);
  if (TASK_LOOP_ERROR_CODES.has(code)) {
    const localized = messages.errorSummary(code);
    return messages.format('errorWithDetail', {
      detail: `${code}: ${detail === localized ? localized : `${localized} ${detail}`}`,
    });
  }
  if (locale === 'en') {
    return messages.format('errorWithDetail', { detail });
  }

  return [
    messages.format('errorWithDetail', { detail: messages.errorSummary(errorCode(error)) }),
    `${messages.format('rawDetailLabel')} ${detail}`,
  ].join('\n');
}
