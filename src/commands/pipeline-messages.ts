import { getCliLocale } from '../core/cli-locale.js';
import {
  formatLocaleMessage,
  getLocaleCatalog,
  type LocaleCatalog,
} from '../locales/index.js';
import type { PipelineExecutionNotice } from '../core/pipeline-registry/execution-validation.js';
import type { RootSelectionNotice } from '../core/root-selection.js';
import type { CliLocale } from '../utils/locale.js';

export const BUILT_IN_PIPELINE_IDS = [
  'auto-decompose',
  'bug-fix',
  'full-feature',
  'goal-loop-evaluate',
  'goal-loop-measure',
  'goal-loop-research',
  'small-feature',
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
  ignoredStorePointerWarning: { path: string; store: string };
  selectedStoreRoot: { store: string; path: string };
  selectedProjectRoot: { project: string; path: string };
  staleProfileWorkflowsWarning: { workflows: string };
  noPipelinesFound: undefined;
  availablePipelinesHeading: undefined;
  pipelineTableEntry: { name: string; source: string };
  pipelineTableStages: { stages: string };
  pipelineLabel: { name: string };
  pipelineNotFound: { name: string; available: string };
  originLabel: { origin: string };
  buildOrderHeading: undefined;
  thresholdTokensRemaining: { tokens: number };
  stageMetaRole: { role: string };
  stageMetaRequires: { requires: string };
  stageMetaGateVet: undefined;
  stageMetaGate: undefined;
  stageMetaReviewLoop: { maximum: number };
  stageMetaGoalLoop: { gate: string; maximum: number; stall: number };
  stageMetaParallelGroup: { group: string };
  stageMetaCondition: { condition: string };
  stageMetaLeadReview: undefined;
  stageMetaVerifyPolicy: { policy: string };
  stageMetaRuntime: { runtime: string };
  stageMetaRuntimeSource: { runtime: string; source: string };
  stageMetaSessionReuse: { session: string };
  stageMetaSandbox: { sandbox: string };
  stageMetaHandoff: { threshold: string; source: string };
  stageActionDecompose: { pipeline: string };
  stageLine: { id: string; action: string; suffix: string };
  projectOverrideLabel: { path: string };
  roleRuntimesHeading: undefined;
  stagesHeading: undefined;
  agentRoleLine: { role: string; runtime: string };
  agentStageLine: { id: string; role: string; runtime: string; source: string };
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
  remaining: { stages: string };
  invalidRunStateNote: { path: string; reason: string };
  noRunStateNote: undefined;
  nextStage: { stage: string };
  openFindings: { count: number };
  legacySkillHeading: { pipeline: string };
  legacySkillEntry: { stage: string; from: string; to: string };
  workerHandleWarning: { stage: string; recorded: string };
  duplicateRunStateKey: { key: string; path: string };
  resumeHandles: { stages: string };
  sessionHandoff: { generation: number; path: string };
  gatePolicy: { effective: string; source: string };
  createdDraft: { path: string };
  pipelineValid: undefined;
  pipelineInvalid: undefined;
  validationDiagnostic: { severity: string; code: string; message: string };
  importedHeading: { path: string };
  importedEntry: { name: string; digest: string };
  replaceDestination: { path: string };
  exported: { name: string; path: string };
  deletePipeline: { name: string };
  deleted: { name: string };
  forcedDeleteWarning: { name: string; referrers: string };
  pipelineIdCollision: { name: string };
  destinationExists: undefined;
  exportCancelled: undefined;
  deletionRequiresYes: undefined;
  deletionCancelled: undefined;
}

export const PIPELINE_MESSAGE_KEYS = [
  'errorPrefix',
  'errorWithDetail',
  'rawDetailLabel',
  'none',
  'complete',
  'recorded',
  'bareWorkerLabel',
  'ignoredStorePointerWarning',
  'selectedStoreRoot',
  'selectedProjectRoot',
  'staleProfileWorkflowsWarning',
  'noPipelinesFound',
  'availablePipelinesHeading',
  'pipelineTableEntry',
  'pipelineTableStages',
  'pipelineLabel',
  'pipelineNotFound',
  'originLabel',
  'buildOrderHeading',
  'thresholdTokensRemaining',
  'stageMetaRole',
  'stageMetaRequires',
  'stageMetaGateVet',
  'stageMetaGate',
  'stageMetaReviewLoop',
  'stageMetaGoalLoop',
  'stageMetaParallelGroup',
  'stageMetaCondition',
  'stageMetaLeadReview',
  'stageMetaVerifyPolicy',
  'stageMetaRuntime',
  'stageMetaRuntimeSource',
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
  'remaining',
  'invalidRunStateNote',
  'noRunStateNote',
  'nextStage',
  'openFindings',
  'legacySkillHeading',
  'legacySkillEntry',
  'workerHandleWarning',
  'duplicateRunStateKey',
  'resumeHandles',
  'sessionHandoff',
  'gatePolicy',
  'createdDraft',
  'pipelineValid',
  'pipelineInvalid',
  'validationDiagnostic',
  'importedHeading',
  'importedEntry',
  'replaceDestination',
  'exported',
  'deletePipeline',
  'deleted',
  'forcedDeleteWarning',
  'pipelineIdCollision',
  'destinationExists',
  'exportCancelled',
  'deletionRequiresYes',
  'deletionCancelled',
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

export function formatPipelineRootSelectionNotice(
  notice: RootSelectionNotice,
  locale: CliLocale = getCliLocale()
): string {
  const messages = getPipelineMessages(locale);
  if (notice.kind === 'ignored-store-pointer') {
    return messages.format('ignoredStorePointerWarning', {
      path: notice.filePath,
      store: notice.storeId,
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
  return getPipelineMessages(locale).format('staleProfileWorkflowsWarning', {
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

export function formatPipelineErrorDetail(
  error: unknown,
  locale: CliLocale = getCliLocale()
): string {
  if (error instanceof PipelineMessageError) {
    return getPipelineMessages(locale).formatDescriptor(error.key, error.values);
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
  if (locale === 'en') {
    return messages.format('errorWithDetail', { detail });
  }

  return [
    messages.format('errorWithDetail', { detail: messages.errorSummary(errorCode(error)) }),
    `${messages.format('rawDetailLabel')} ${detail}`,
  ].join('\n');
}
