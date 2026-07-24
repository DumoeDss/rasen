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
  type CanonicalLearnedSkill,
  type FrozenKnowledgeContext,
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

/** A candidate file larger than this is rejected before parsing (defense-in-depth). */
const MAX_CANDIDATE_FILE_BYTES = 256 * 1024;

function reportError(
  json: boolean | undefined,
  message: string,
  code: string,
  details: Record<string, unknown> = {}
): void {
  if (json) {
    printJson({ ok: false, error: { code, message, ...details } });
  } else {
    console.error(`Error: ${message}`);
  }
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

function contextToWire(context: LearnedSkillExecutionContext): Record<string, unknown> {
  const owner =
    context.owner.type === 'global'
      ? { type: 'global' }
      : { type: context.owner.type, id: context.owner.id };
  return {
    owner,
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
  return scope === 'global' ? 'global' : scope === 'project' ? 'project' : undefined;
}

function candidateToRequest(candidate: ParsedLearnedSkillCandidate): LearnedSkillMutationRequest {
  if (candidate.operation === 'upsert') {
    return {
      operation: 'upsert',
      scope: candidate.scope,
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
      operation: 'promote',
      id: candidate.id,
      knowledgeKey: candidate.knowledgeKey,
      description: candidate.description,
      instructions: candidate.instructions,
      applicability: candidate.applicability,
      evidence: candidate.evidence,
    };
  }
  return {
    operation: 'retire',
    scope: candidate.scope,
    id: candidate.id,
    ...(candidate.retirementReason ? { retirementReason: candidate.retirementReason } : {}),
  };
}

/** Reads and strictly validates the candidate file, or reports a localized error. */
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
    reportError(json, messages.candidateTooLarge(stat.size, MAX_CANDIDATE_FILE_BYTES), 'candidate_too_large');
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(from, 'utf-8'));
  } catch (error) {
    reportError(json, messages.candidateInvalid(error instanceof Error ? error.message : String(error)), 'candidate_invalid');
    return undefined;
  }
  const parsed = LearnedSkillCandidateSchema.safeParse(raw);
  if (!parsed.success) {
    reportError(json, messages.candidateInvalid(formatZodIssues(parsed.error)), 'candidate_invalid');
    return undefined;
  }
  return parsed.data;
}

async function applyCommand(options: {
  from?: string;
  approveGlobal?: boolean;
  project?: string;
  store?: string;
  runStateDir?: string;
  json?: boolean;
}): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const candidate = readCandidate(options.from, options.json, messages);
  if (!candidate) return;

  const targetScope: LearnedSkillScope = candidate.operation === 'promote' ? 'global' : candidate.scope;

  // Consent-scope validation: global consent cannot be reused for a project op.
  if (options.approveGlobal && targetScope !== 'global') {
    reportError(options.json, messages.approveGlobalNotForProject, 'consent_scope_mismatch');
    return;
  }

  // Project mutations are authorized by an active codify profile (design D8);
  // global mutations are gated by approval instead.
  if (targetScope === 'project') {
    const retention = resolveCurrentProfileState(getGlobalConfig()).retention;
    if (retention !== 'codify') {
      reportError(options.json, messages.codifyRequired(retention), 'codify_required');
      return;
    }
  }

  const context = await buildContext(options, targetScope);
  if (!options.json) reportHumanContext(context.execution!, messages);
  const request = candidateToRequest(candidate);
  const plan = await planLearnedSkillMutation(request, context);

  if (plan.block) {
    if (options.json) {
      printJson({ ok: false, plan: { action: plan.action, id: plan.id, scope: plan.scope }, block: plan.block });
    } else {
      console.error(messages.blocked(plan.block.message));
    }
    process.exitCode = 1;
    return;
  }

  if (!options.json) console.error(messages.plan(plan.summary));

  // Global create/promotion consent: interactive prompt, else the explicit flag.
  let approveGlobal = options.approveGlobal === true;
  if (plan.requiresGlobalApproval && !approveGlobal) {
    if (process.stdout.isTTY && !options.json) {
      // Show the human the actual plan before they approve a global write
      // (design D4/D8): description, applicability markers, and the distinct
      // contributing projects — not just the id. The deterministic global gates
      // (self-declared project ids; portability-only applicability checks) are
      // weak, so this informed approval is the primary backstop.
      const manifest = plan.commit?.manifest;
      if (manifest) {
        const projects = new Set(manifest.evidence.map((entry) => entry.projectId));
        console.error(`  ${manifest.description}`);
        console.error(
          `  ${messages.showApplicability(manifest.applicability.mode, manifest.applicability.markers.join(', '))}`
        );
        console.error(`  ${messages.provenanceSummary(manifest.evidence.length, projects.size)}`);
      }
      const { confirm } = await import('@inquirer/prompts');
      approveGlobal = await confirm({ message: messages.globalApprovalPrompt(plan.id), default: false });
      if (!approveGlobal) {
        console.error(messages.globalApprovalDeclined);
        return;
      }
    } else {
      reportError(options.json, messages.globalApprovalRequiredNonInteractive(plan.id), 'global_approval_required');
      return;
    }
  }

  const result = await commitLearnedSkillPlan(plan, { ...context, approveGlobal });
  if (result.outcome === 'blocked') {
    if (options.json) {
      printJson({ ok: false, block: result.block });
    } else {
      console.error(messages.blocked(result.block?.message ?? 'blocked'));
    }
    process.exitCode = 1;
    return;
  }

  if (options.json) {
    printJson({
      ok: true,
      outcome: result.outcome,
      scope: result.scope,
      id: result.id,
      status: result.status,
      context: contextToWire(context.execution!),
    });
    return;
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
  const projects = new Set(manifest.evidence.map((entry) => entry.projectId));
  return {
    id: manifest.id,
    scope: manifest.scope,
    status: manifest.status,
    knowledgeKey: manifest.knowledgeKey,
    description: manifest.description,
    applicability: manifest.applicability,
    evidence: {
      count: manifest.evidence.length,
      projects: projects.size,
      ...(manifest.evidenceOverflow ? { overflow: manifest.evidenceOverflow } : {}),
    },
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    ...(manifest.retiredAt ? { retiredAt: manifest.retiredAt } : {}),
    ...(manifest.retirementReason ? { retirementReason: manifest.retirementReason } : {}),
  };
}

async function listCommand(
  options: { scope?: string } & KnowledgeOwnerOptions
): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const explicit = scopeFromOption(options.scope);
  const context = await buildContext(options, explicit ?? 'mixed');
  if (!options.json) reportHumanContext(context.execution!, messages);
  const scopes: LearnedSkillScope[] = explicit ? [explicit] : ['project', 'global'];

  const rows: Array<{ scope: LearnedSkillScope; record: CanonicalLearnedSkill }> = [];
  for (const scope of scopes) {
    for (const record of await listCanonicalLearnedSkills(scope, context)) {
      rows.push({ scope, record });
    }
  }

  if (options.json) {
    printJson({
      context: contextToWire(context.execution!),
      learnedSkills: rows.map(({ record }) => toWireRecord(record)),
    });
    return;
  }
  if (rows.length === 0) {
    console.log(messages.listEmpty);
    return;
  }
  console.log(messages.listHeading);
  for (const { scope, record } of rows) {
    const marker = record.manifest.status === 'active' ? '*' : '-';
    console.log(
      messages.listRow(marker, record.manifest.id, scope, record.manifest.status, record.manifest.description)
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
  const scopes: LearnedSkillScope[] = explicit ? [explicit] : ['project', 'global'];

  for (const scope of scopes) {
    const found = (await listCanonicalLearnedSkills(scope, context)).find(
      (record) => record.manifest.id === id
    );
    if (!found) continue;
    if (options.json) {
      printJson({
        ...toWireRecord(found),
        context: contextToWire(context.execution!),
      });
      return;
    }
    const manifest = found.manifest;
    const projects = new Set(manifest.evidence.map((entry) => entry.projectId));
    console.log(`${manifest.id} [${manifest.scope}/${manifest.status}]`);
    console.log(`  ${manifest.description}`);
    console.log(
      `  ${messages.showApplicability(manifest.applicability.mode, manifest.applicability.markers.join(', '))}`
    );
    console.log(`  ${messages.provenanceSummary(manifest.evidence.length, projects.size)}`);
    return;
  }

  reportError(options.json, messages.showNotFound(id, explicit ?? 'project'), 'not_found');
}

async function retireCommand(
  id: string,
  options: { scope?: string; yes?: boolean } & KnowledgeOwnerOptions
): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const scope: LearnedSkillScope = scopeFromOption(options.scope) ?? 'project';
  const context = await buildContext(options, scope);
  if (!options.json) reportHumanContext(context.execution!, messages);

  if (!options.yes) {
    if (!process.stdout.isTTY) {
      reportError(options.json, messages.retireRequiresConfirmation, 'confirmation_required');
      return;
    }
    const { confirm } = await import('@inquirer/prompts');
    const confirmed = await confirm({ message: messages.retireConfirm(scope, id), default: false });
    if (!confirmed) {
      console.log(messages.retireCancelled);
      return;
    }
  }

  const plan = await planLearnedSkillMutation({ operation: 'retire', scope, id }, context);
  if (plan.block) {
    if (options.json) {
      printJson({ ok: false, block: plan.block });
    } else {
      console.error(messages.blocked(plan.block.message));
    }
    process.exitCode = 1;
    return;
  }
  const result = await commitLearnedSkillPlan(plan, context);
  if (options.json) {
    printJson({
      ok: true,
      outcome: result.outcome,
      scope: result.scope,
      id: result.id,
      status: result.status,
      context: contextToWire(context.execution!),
    });
    return;
  }
  if (result.outcome === 'retired') console.log(messages.retired(result.scope, result.id));
  else if (result.outcome === 'no-op') console.log(messages.noop(result.id));
}

async function runKnowledgeAction(
  action: () => Promise<void>,
  json?: boolean
): Promise<void> {
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

function addOwnerSelectorOptions(
  command: Command,
  messages: KnowledgeMessages
): Command {
  return command
    .option(
      '--project <id>',
      messages.projectSelectorDescription
    )
    .option(
      '--store <id>',
      messages.storeSelectorDescription
    )
    .option(
      '--run-state-dir <path>',
      messages.runStateDirDescription
    );
}

export function registerKnowledgeCommand(program: Command): void {
  const messages = getKnowledgeMessages();
  const knowledge = program.command('knowledge').description(messages.commandDescription);

  addOwnerSelectorOptions(knowledge
    .command('apply')
    .description(messages.applyDescription)
    .requiredOption('--from <path>', 'Absolute path to a candidate JSON file')
    .option('--approve-global', 'Approve a global create or promotion non-interactively')
    .option('--json', 'Output as JSON'), messages)
    .action(async (options: {
      from?: string;
      approveGlobal?: boolean;
      project?: string;
      store?: string;
      runStateDir?: string;
      json?: boolean;
    }) => {
      await runKnowledgeAction(() => applyCommand(options), options.json);
    });

  addOwnerSelectorOptions(knowledge
    .command('list')
    .description(messages.listDescription)
    .option('--scope <scope>', 'project or global')
    .option('--json', 'Output as JSON'), messages)
    .action(async (options: { scope?: string; project?: string; store?: string; runStateDir?: string; json?: boolean }) => {
      await runKnowledgeAction(() => listCommand(options), options.json);
    });

  addOwnerSelectorOptions(knowledge
    .command('show <id>')
    .description(messages.showDescription)
    .option('--scope <scope>', 'project or global')
    .option('--json', 'Output as JSON'), messages)
    .action(async (
      id: string,
      options: { scope?: string; project?: string; store?: string; runStateDir?: string; json?: boolean }
    ) => {
      await runKnowledgeAction(() => showCommand(id, options), options.json);
    });

  addOwnerSelectorOptions(knowledge
    .command('retire <id>')
    .description(messages.retireDescription)
    .option('--scope <scope>', 'project or global')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json', 'Output as JSON'), messages)
    .action(async (
      id: string,
      options: {
        scope?: string;
        yes?: boolean;
        project?: string;
        store?: string;
        runStateDir?: string;
        json?: boolean;
      }
    ) => {
      await runKnowledgeAction(() => retireCommand(id, options), options.json);
    });
}
