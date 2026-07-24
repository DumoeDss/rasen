import * as fs from 'node:fs';
import * as path from 'node:path';

import { Command } from 'commander';

import { getGlobalConfig } from '../core/global-config.js';
import { formatZodIssues } from '../core/zod-issues.js';
import {
  KnowledgeContextError,
  LearnedSkillCandidateSchema,
  commitLearnedSkillPlan,
  listCanonicalLearnedSkills,
  planLearnedSkillMutation,
  type CanonicalKnowledgeIdentity,
  type CanonicalLearnedSkill,
  type FrozenKnowledgeContext,
  type KnowledgeOwnerRef,
  type LearnedSkillContext,
  type LearnedSkillExecutionContext,
  type LearnedSkillMutationRequest,
  type LearnedSkillScope,
  type ParsedLearnedSkillCandidate,
  isKnowledgeContextError,
  resolveLearnedSkillExecutionContext,
} from '../core/learned-skills/index.js';
import {
  RUN_STATE_FILENAME,
  frozenKnowledgeContext,
  readRunStateDetailed,
} from '../core/pipeline-registry/run-state.js';
import { getKnowledgeMessages, type KnowledgeMessages } from './knowledge-messages.js';
import { resolveCurrentProfileState } from './profile-editor.js';
import { isPromptCancellationError, printJson } from './shared-output.js';

const MAX_CANDIDATE_FILE_BYTES = 256 * 1024;

function reportError(
  json: boolean | undefined,
  message: string,
  code: string,
  details: Record<string, unknown> = {}
): void {
  if (json) printJson({ ok: false, error: { code, message, ...details } });
  else console.error(`Error: ${message}`);
  process.exitCode = 1;
}

interface KnowledgeOwnerOptions {
  project?: string;
  store?: string;
  runStateDir?: string;
  json?: boolean;
}

function reportSelectorConflict(options: KnowledgeOwnerOptions): boolean {
  if (options.project === undefined || options.store === undefined) return false;
  reportError(
    options.json,
    '--project and --store are mutually exclusive knowledge-owner selectors; pass only one.',
    'knowledge_selector_conflict',
    { selectorGuidance: ['--project <id>', '--store <id>'] }
  );
  return true;
}

function loadFrozenKnowledgeContext(
  runStateDir: string | undefined
): FrozenKnowledgeContext | undefined {
  if (runStateDir === undefined) return undefined;
  if (!path.isAbsolute(runStateDir)) {
    throw new KnowledgeContextError({
      code: 'knowledge_owner_stale',
      message: `--run-state-dir must be the absolute resolved directory containing ${RUN_STATE_FILENAME}.`,
      selectorGuidance: ['rasen pipeline resume <change> --json'],
    });
  }
  const result = readRunStateDetailed(runStateDir);
  if (result.kind === 'absent') {
    throw new KnowledgeContextError({
      code: 'knowledge_owner_stale',
      message: `No ${RUN_STATE_FILENAME} was found in the resolved run-state directory ${runStateDir}.`,
      selectorGuidance: ['rasen pipeline resume <change> --json'],
    });
  }
  if (result.kind === 'invalid') {
    throw new KnowledgeContextError({
      code: 'knowledge_owner_stale',
      message: `The resolved ${RUN_STATE_FILENAME} is invalid and its frozen knowledge identity cannot be trusted: ${result.reason}`,
      selectorGuidance: ['repair auto-run.json before resuming retain/codify'],
    });
  }
  return frozenKnowledgeContext(result.state);
}

async function buildContext(
  options: KnowledgeOwnerOptions,
  requestedScope: LearnedSkillScope | 'mixed'
): Promise<LearnedSkillContext> {
  const frozen = loadFrozenKnowledgeContext(options.runStateDir);
  const execution = await resolveLearnedSkillExecutionContext({
    launchDirectory: process.cwd(),
    selector: {
      ...(options.project !== undefined ? { project: options.project } : {}),
      ...(options.store !== undefined ? { store: options.store } : {}),
    },
    requestedScope,
    ...(frozen ? { frozen } : {}),
  });
  return { execution };
}

function ownerToWire(owner: KnowledgeOwnerRef): Record<string, unknown> {
  return owner.type === 'global'
    ? { type: 'global' }
    : { type: owner.type, id: owner.id };
}

function identityLabel(identity: CanonicalKnowledgeIdentity): string {
  const owner =
    identity.owner.type === 'global'
      ? 'global'
      : `${identity.owner.type}:${identity.owner.id}`;
  return `${owner}/${identity.id}`;
}

function contextToWire(context: LearnedSkillExecutionContext): Record<string, unknown> {
  return {
    owner: ownerToWire(
      context.owner.type === 'global'
        ? { type: 'global' }
        : { type: context.owner.type, id: context.owner.id }
    ),
    ...(context.planningRoot
      ? {
          planningRoot: {
            type: context.planningRoot.type,
            id: context.planningRoot.id,
          },
        }
      : {}),
    source: context.source,
  };
}

function reportHumanContext(
  context: LearnedSkillExecutionContext,
  messages: KnowledgeMessages
): void {
  const owner =
    context.owner.type === 'global'
      ? 'global'
      : `${context.owner.type}:${context.owner.id}`;
  const planning = context.planningRoot
    ? `${context.planningRoot.type}:${context.planningRoot.id}`
    : 'none';
  console.error(messages.contextSummary(owner, planning));
}

function scopeFromOption(scope: string | undefined): LearnedSkillScope | undefined {
  return scope === 'global' || scope === 'project' || scope === 'store'
    ? scope
    : undefined;
}

function candidateToRequest(
  candidate: ParsedLearnedSkillCandidate
): LearnedSkillMutationRequest {
  if (candidate.operation === 'upsert') {
    return {
      version: candidate.version,
      operation: 'upsert',
      scope: candidate.scope,
      ...(candidate.version === 2 ? { owner: candidate.owner, sources: candidate.sources } : {}),
      id: candidate.id,
      knowledgeKey: candidate.knowledgeKey,
      description: candidate.description,
      instructions: candidate.instructions,
      applicability: candidate.applicability,
      evidence: candidate.evidence,
    };
  }
  if (candidate.operation === 'promote') {
    return {
      version: candidate.version,
      operation: 'promote',
      ...(candidate.version === 2 ? { owner: candidate.owner, sources: candidate.sources } : {}),
      id: candidate.id,
      knowledgeKey: candidate.knowledgeKey,
      description: candidate.description,
      instructions: candidate.instructions,
      applicability: candidate.applicability,
      evidence: candidate.evidence,
    };
  }
  return {
    version: candidate.version,
    operation: 'retire',
    scope: candidate.scope,
    ...(candidate.version === 2 ? { owner: candidate.owner } : {}),
    id: candidate.id,
    ...(candidate.retirementReason ? { retirementReason: candidate.retirementReason } : {}),
  };
}

function readCandidate(
  from: string | undefined,
  json: boolean | undefined,
  messages: KnowledgeMessages
): ParsedLearnedSkillCandidate | undefined {
  if (!from) {
    reportError(json, messages.candidatePathRequired, 'candidate_path_required');
    return undefined;
  }
  if (!path.isAbsolute(from)) {
    reportError(json, messages.candidatePathMustBeAbsolute(from), 'candidate_path_not_absolute');
    return undefined;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(from);
  } catch {
    reportError(json, messages.candidateNotFound(from), 'candidate_not_found');
    return undefined;
  }
  if (!stat.isFile()) {
    reportError(json, messages.candidateNotFile(from), 'candidate_not_file');
    return undefined;
  }
  if (stat.size > MAX_CANDIDATE_FILE_BYTES) {
    reportError(
      json,
      messages.candidateTooLarge(stat.size, MAX_CANDIDATE_FILE_BYTES),
      'candidate_too_large'
    );
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(from, 'utf-8'));
  } catch (error) {
    reportError(
      json,
      messages.candidateInvalid(error instanceof Error ? error.message : String(error)),
      'candidate_invalid'
    );
    return undefined;
  }
  const parsed = LearnedSkillCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    reportError(
      json,
      messages.candidateInvalid(formatZodIssues(parsed.error)),
      'candidate_invalid'
    );
    return undefined;
  }
  return parsed.data;
}

function reportInformedPlan(
  plan: Awaited<ReturnType<typeof planLearnedSkillMutation>>,
  messages: KnowledgeMessages
): void {
  console.error(messages.plan(plan.summary));
  console.error(`  Target: ${identityLabel(plan.identity)}`);
  if (plan.knowledgeKey) console.error(`  Knowledge key: ${plan.knowledgeKey}`);
  if (plan.applicability) {
    console.error(
      `  ${messages.showApplicability(
        plan.applicability.mode,
        plan.applicability.markers.join(', ')
      )}`
    );
  }
  console.error(
    `  Sources: ${
      plan.sourceIdentities.length > 0
        ? plan.sourceIdentities.map(identityLabel).join(', ')
        : '(current project evidence)'
    }`
  );
}

function resultWire(
  result: Awaited<ReturnType<typeof commitLearnedSkillPlan>>,
  context: LearnedSkillExecutionContext
): Record<string, unknown> {
  return {
    ok: true,
    outcome: result.outcome,
    identity: {
      owner: ownerToWire(result.identity.owner),
      id: result.identity.id,
    },
    scope: result.scope,
    id: result.id,
    status: result.status,
    ...(result.storeRoot ? { storeRoot: result.storeRoot } : {}),
    ...(result.changedFiles ? { changedFiles: result.changedFiles } : {}),
    context: contextToWire(context),
  };
}

async function applyCommand(options: {
  from?: string;
  approveGlobal?: boolean;
  approveStore?: boolean;
  project?: string;
  store?: string;
  runStateDir?: string;
  json?: boolean;
}): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const candidate = readCandidate(options.from, options.json, messages);
  if (!candidate) return;
  const targetScope: LearnedSkillScope =
    candidate.operation === 'promote' ? 'global' : candidate.scope;
  if (
    (options.approveGlobal && targetScope !== 'global') ||
    (options.approveStore && targetScope !== 'store') ||
    (options.approveGlobal && options.approveStore)
  ) {
    reportError(
      options.json,
      messages.consentScopeMismatch,
      'consent_scope_mismatch'
    );
    return;
  }
  if (targetScope === 'project') {
    const retention = resolveCurrentProfileState(getGlobalConfig()).retention;
    if (retention !== 'codify') {
      reportError(options.json, messages.codifyRequired(retention), 'codify_required');
      return;
    }
  }

  const context = await buildContext(options, targetScope);
  if (!options.json) reportHumanContext(context.execution!, messages);
  const plan = await planLearnedSkillMutation(candidateToRequest(candidate), context);
  if (plan.block) {
    if (options.json) {
      printJson({
        ok: false,
        plan: {
          action: plan.action,
          identity: { owner: ownerToWire(plan.identity.owner), id: plan.identity.id },
          scope: plan.scope,
        },
        block: plan.block,
      });
    } else console.error(messages.blocked(plan.block.message));
    process.exitCode = 1;
    return;
  }
  if (!options.json) reportInformedPlan(plan, messages);

  let approveGlobal = options.approveGlobal === true;
  let approveStore = options.approveStore === true;
  if (
    (plan.requiresGlobalApproval && !approveGlobal) ||
    (plan.requiresStoreApproval && !approveStore)
  ) {
    if (process.stdout.isTTY && !options.json) {
      const { confirm } = await import('@inquirer/prompts');
      const approved = await confirm({
        message:
          plan.scope === 'store'
            ? messages.storeApprovalPrompt(plan.id)
            : messages.globalApprovalPrompt(plan.id),
        default: false,
      });
      if (!approved) {
        console.error(
          plan.scope === 'store'
            ? messages.storeApprovalDeclined
            : messages.globalApprovalDeclined
        );
        return;
      }
      if (plan.scope === 'store') approveStore = true;
      else approveGlobal = true;
    } else {
      reportError(
        options.json,
        plan.scope === 'store'
          ? messages.storeApprovalRequiredNonInteractive(plan.id)
          : messages.globalApprovalRequiredNonInteractive(plan.id),
        plan.scope === 'store'
          ? 'store_approval_required'
          : 'global_approval_required'
      );
      return;
    }
  }
  const result = await commitLearnedSkillPlan(plan, {
    ...context,
    approveGlobal,
    approveStore,
  });
  if (result.outcome === 'blocked') {
    if (options.json) printJson({ ok: false, block: result.block });
    else console.error(messages.blocked(result.block?.message ?? 'blocked'));
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    printJson(resultWire(result, context.execution!));
    return;
  }
  if (result.storeRoot) console.log(`Store root: ${result.storeRoot}`);
  if (result.changedFiles) {
    for (const changed of result.changedFiles) console.log(`Changed: ${changed}`);
  }
  switch (result.outcome) {
    case 'created':
      console.log(messages.created(result.scope, result.id));
      break;
    case 'rewritten':
      console.log(messages.rewritten(result.scope, result.id));
      break;
    case 'retired':
      console.log(messages.retired(result.scope, result.id));
      break;
    case 'renamed':
      console.log(messages.renamed(result.id));
      break;
    case 'no-op':
      console.log(messages.noop(result.id));
      break;
  }
}

function toWireRecord(record: CanonicalLearnedSkill): Record<string, unknown> {
  const manifest = record.manifest;
  const owners = new Set(
    record.evidence.map((entry) => `${entry.owner.type}:${entry.owner.id}`)
  );
  return {
    identity: {
      owner: ownerToWire(record.identity.owner),
      id: record.identity.id,
    },
    id: manifest.id,
    scope: manifest.scope,
    version: manifest.version,
    status: manifest.status,
    knowledgeKey: manifest.knowledgeKey,
    description: manifest.description,
    applicability: manifest.applicability,
    evidence: {
      count: record.evidence.length,
      owners: owners.size,
      ...(manifest.evidenceOverflow ? { overflow: manifest.evidenceOverflow } : {}),
    },
    ...(manifest.version === 2 ? { sources: manifest.sources } : {}),
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    ...(manifest.retiredAt ? { retiredAt: manifest.retiredAt } : {}),
    ...(manifest.retirementReason
      ? { retirementReason: manifest.retirementReason }
      : {}),
  };
}

function defaultReadScopes(
  explicit: LearnedSkillScope | undefined,
  context: LearnedSkillExecutionContext
): LearnedSkillScope[] {
  if (explicit) return [explicit];
  return context.owner.type === 'store' ? ['store'] : ['project', 'global'];
}

function readContextForScope(
  scope: LearnedSkillScope,
  context: LearnedSkillContext
): LearnedSkillContext {
  if (scope !== 'global' || context.execution?.owner.type === 'global') return context;
  const globalDataDir = context.execution?.globalDataDir ?? context.globalDataDir;
  return globalDataDir === undefined ? {} : { globalDataDir };
}

async function listCommand(
  options: { scope?: string } & KnowledgeOwnerOptions
): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const explicit = scopeFromOption(options.scope);
  const context = await buildContext(options, explicit ?? 'mixed');
  if (!options.json) reportHumanContext(context.execution!, messages);
  const scopes = defaultReadScopes(explicit, context.execution!);
  const records: CanonicalLearnedSkill[] = [];
  for (const scope of scopes) {
    records.push(
      ...(await listCanonicalLearnedSkills(scope, readContextForScope(scope, context)))
    );
  }
  if (options.json) {
    printJson({
      context: contextToWire(context.execution!),
      learnedSkills: records.map(toWireRecord),
    });
    return;
  }
  if (records.length === 0) {
    console.log(messages.listEmpty);
    return;
  }
  console.log(messages.listHeading);
  for (const record of records) {
    const marker = record.manifest.status === 'active' ? '*' : '-';
    console.log(
      messages.listRow(
        marker,
        identityLabel(record.identity),
        record.scope,
        record.manifest.status,
        record.manifest.description
      )
    );
  }
}

async function showCommand(
  id: string,
  options: { scope?: string } & KnowledgeOwnerOptions
): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const explicit = scopeFromOption(options.scope);
  const context = await buildContext(options, explicit ?? 'mixed');
  if (!options.json) reportHumanContext(context.execution!, messages);
  for (const scope of defaultReadScopes(explicit, context.execution!)) {
    const found = (
      await listCanonicalLearnedSkills(scope, readContextForScope(scope, context))
    ).find(
      (record) => record.identity.id === id
    );
    if (!found) continue;
    if (options.json) {
      printJson({ ...toWireRecord(found), context: contextToWire(context.execution!) });
      return;
    }
    console.log(`${identityLabel(found.identity)} [${found.scope}/${found.manifest.status}]`);
    console.log(`  ${found.manifest.description}`);
    console.log(
      `  ${messages.showApplicability(
        found.manifest.applicability.mode,
        found.manifest.applicability.markers.join(', ')
      )}`
    );
    console.log(
      `  ${messages.provenanceSummary(
        found.evidence.length,
        new Set(found.evidence.map((entry) => `${entry.owner.type}:${entry.owner.id}`)).size
      )}`
    );
    return;
  }
  reportError(options.json, messages.showNotFound(id, explicit ?? 'project'), 'not_found');
}

async function confirmExactMutation(
  message: string,
  yes: boolean | undefined,
  json: boolean | undefined,
  messages: KnowledgeMessages
): Promise<boolean> {
  if (yes) return true;
  if (!process.stdout.isTTY) {
    reportError(json, messages.retireRequiresConfirmation, 'confirmation_required');
    return false;
  }
  const { confirm } = await import('@inquirer/prompts');
  return confirm({ message, default: false });
}

async function retireCommand(
  id: string,
  options: { scope?: string; yes?: boolean } & KnowledgeOwnerOptions
): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const scope = scopeFromOption(options.scope) ?? (options.store ? 'store' : 'project');
  const context = await buildContext(options, scope);
  if (!options.json) reportHumanContext(context.execution!, messages);
  if (
    !(await confirmExactMutation(
      messages.retireConfirm(scope, id),
      options.yes,
      options.json,
      messages
    ))
  ) {
    if (process.stdout.isTTY) console.log(messages.retireCancelled);
    return;
  }
  await executeDirectMutation(
    { operation: 'retire', scope, id },
    context,
    options.json,
    messages
  );
}

async function renameCommand(
  fromId: string,
  toId: string,
  options: { scope?: string; yes?: boolean } & KnowledgeOwnerOptions
): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const scope = scopeFromOption(options.scope) ?? (options.store ? 'store' : 'project');
  if (scope === 'store') {
    reportError(
      options.json,
      'Store learned-skill rename is not supported; use an approved apply or retire operation.',
      'invalid_request'
    );
    return;
  }
  const context = await buildContext(options, scope);
  if (!options.json) reportHumanContext(context.execution!, messages);
  if (
    !(await confirmExactMutation(
      messages.renameConfirm(scope, fromId, toId),
      options.yes,
      options.json,
      messages
    ))
  ) return;
  await executeDirectMutation(
    { operation: 'rename', scope, fromId, toId },
    context,
    options.json,
    messages
  );
}

async function executeDirectMutation(
  request: LearnedSkillMutationRequest,
  context: LearnedSkillContext,
  json: boolean | undefined,
  messages: KnowledgeMessages
): Promise<void> {
  const plan = await planLearnedSkillMutation(request, context);
  if (plan.block) {
    if (json) printJson({ ok: false, block: plan.block });
    else console.error(messages.blocked(plan.block.message));
    process.exitCode = 1;
    return;
  }
  const result = await commitLearnedSkillPlan(plan, context);
  if (result.outcome === 'blocked') {
    if (json) printJson({ ok: false, block: result.block });
    else console.error(messages.blocked(result.block?.message ?? 'blocked'));
    process.exitCode = 1;
    return;
  }
  if (json) {
    printJson(resultWire(result, context.execution!));
    return;
  }
  if (result.outcome === 'retired') console.log(messages.retired(result.scope, result.id));
  else if (result.outcome === 'renamed') console.log(messages.renamed(result.id));
  else if (result.outcome === 'no-op') console.log(messages.noop(result.id));
}

async function runKnowledgeAction(action: () => Promise<void>, json?: boolean): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      console.log(getKnowledgeMessages().cancelled);
      process.exitCode = 130;
      return;
    }
    if (isKnowledgeContextError(error)) {
      const { code, message, ...details } = error.diagnostic;
      reportError(json, message, code, details);
      return;
    }
    reportError(json, error instanceof Error ? error.message : String(error), 'knowledge_error');
  }
}

function addOwnerSelectorOptions(command: Command, messages: KnowledgeMessages): Command {
  return command
    .option('--project <id>', messages.projectSelectorDescription)
    .option('--store <id>', messages.storeSelectorDescription)
    .option('--run-state-dir <path>', messages.runStateDirDescription);
}

export function registerKnowledgeCommand(program: Command): void {
  const messages = getKnowledgeMessages();
  const knowledge = program.command('knowledge').description(messages.commandDescription);

  addOwnerSelectorOptions(
    knowledge
      .command('apply')
      .description(messages.applyDescription)
      .requiredOption('--from <path>', 'Absolute path to a candidate JSON file')
      .option('--approve-store', 'Approve a store publication non-interactively')
      .option('--approve-global', 'Approve a global create or promotion non-interactively')
      .option('--json', 'Output as JSON'),
    messages
  ).action(async (options: {
    from?: string;
    approveGlobal?: boolean;
    approveStore?: boolean;
    project?: string;
    store?: string;
    runStateDir?: string;
    json?: boolean;
  }) => runKnowledgeAction(() => applyCommand(options), options.json));

  addOwnerSelectorOptions(
    knowledge
      .command('list')
      .description(messages.listDescription)
      .option('--scope <scope>', 'project, store, or global')
      .option('--json', 'Output as JSON'),
    messages
  ).action(async (options: KnowledgeOwnerOptions & { scope?: string }) =>
    runKnowledgeAction(() => listCommand(options), options.json)
  );

  addOwnerSelectorOptions(
    knowledge
      .command('show <id>')
      .description(messages.showDescription)
      .option('--scope <scope>', 'project, store, or global')
      .option('--json', 'Output as JSON'),
    messages
  ).action(async (id: string, options: KnowledgeOwnerOptions & { scope?: string }) =>
    runKnowledgeAction(() => showCommand(id, options), options.json)
  );

  addOwnerSelectorOptions(
    knowledge
      .command('retire <id>')
      .description(messages.retireDescription)
      .option('--scope <scope>', 'project, store, or global (default: project)')
      .option('--yes', 'Skip the confirmation prompt')
      .option('--json', 'Output as JSON'),
    messages
  ).action(
    async (
      id: string,
      options: KnowledgeOwnerOptions & { scope?: string; yes?: boolean }
    ) => runKnowledgeAction(() => retireCommand(id, options), options.json)
  );

  addOwnerSelectorOptions(
    knowledge
      .command('rename <from-id> <to-id>')
      .description(messages.renameDescription)
      .option('--scope <scope>', 'project, store, or global (default: project)')
      .option('--yes', 'Skip the confirmation prompt')
      .option('--json', 'Output as JSON'),
    messages
  ).action(
    async (
      fromId: string,
      toId: string,
      options: KnowledgeOwnerOptions & { scope?: string; yes?: boolean }
    ) => runKnowledgeAction(() => renameCommand(fromId, toId, options), options.json)
  );
}
