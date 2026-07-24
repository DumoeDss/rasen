import * as fs from 'node:fs';
import * as path from 'node:path';

import { Command } from 'commander';

import { getGlobalConfig } from '../core/global-config.js';
import { findRepoPlanningRootSync } from '../core/planning-home.js';
import { formatZodIssues } from '../core/zod-issues.js';
import {
  LearnedSkillCandidateSchema,
  commitLearnedSkillPlan,
  listCanonicalLearnedSkills,
  planLearnedSkillMutation,
  type CanonicalLearnedSkill,
  type LearnedSkillContext,
  type LearnedSkillMutationRequest,
  type LearnedSkillScope,
  type ParsedLearnedSkillCandidate,
} from '../core/learned-skills/index.js';
import { getKnowledgeMessages, type KnowledgeMessages } from './knowledge-messages.js';
import { resolveCurrentProfileState } from './profile-editor.js';
import { isPromptCancellationError, printJson } from './shared-output.js';

/** A candidate file larger than this is rejected before parsing (defense-in-depth). */
const MAX_CANDIDATE_FILE_BYTES = 256 * 1024;

function reportError(json: boolean | undefined, message: string, code: string): void {
  if (json) {
    printJson({ ok: false, error: { code, message } });
  } else {
    console.error(`Error: ${message}`);
  }
  process.exitCode = 1;
}

/** The nearest ancestor Rasen project root, or undefined when outside a project. */
function buildContext(): LearnedSkillContext {
  const projectRoot = findRepoPlanningRootSync(process.cwd());
  return projectRoot ? { projectRoot } : {};
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
  json?: boolean;
}): Promise<void> {
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

  const context = buildContext();
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

async function listCommand(options: { scope?: string; json?: boolean }): Promise<void> {
  const messages = getKnowledgeMessages();
  const context = buildContext();
  const explicit = scopeFromOption(options.scope);
  const scopes: LearnedSkillScope[] = explicit ? [explicit] : ['project', 'global'];

  const rows: Array<{ scope: LearnedSkillScope; record: CanonicalLearnedSkill }> = [];
  for (const scope of scopes) {
    for (const record of await listCanonicalLearnedSkills(scope, context)) {
      rows.push({ scope, record });
    }
  }

  if (options.json) {
    printJson({ learnedSkills: rows.map(({ record }) => toWireRecord(record)) });
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

async function showCommand(id: string, options: { scope?: string; json?: boolean }): Promise<void> {
  const messages = getKnowledgeMessages();
  const context = buildContext();
  const explicit = scopeFromOption(options.scope);
  const scopes: LearnedSkillScope[] = explicit ? [explicit] : ['project', 'global'];

  for (const scope of scopes) {
    const found = (await listCanonicalLearnedSkills(scope, context)).find(
      (record) => record.manifest.id === id
    );
    if (!found) continue;
    if (options.json) {
      printJson(toWireRecord(found));
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
  options: { scope?: string; yes?: boolean; json?: boolean }
): Promise<void> {
  const messages = getKnowledgeMessages();
  const scope: LearnedSkillScope = scopeFromOption(options.scope) ?? 'project';
  const context = buildContext();

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
    printJson({ ok: true, outcome: result.outcome, scope: result.scope, id: result.id, status: result.status });
    return;
  }
  if (result.outcome === 'retired') console.log(messages.retired(result.scope, result.id));
  else if (result.outcome === 'no-op') console.log(messages.noop(result.id));
}

async function runKnowledgeAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      console.log(getKnowledgeMessages().cancelled);
      process.exitCode = 130;
      return;
    }
    reportError(false, error instanceof Error ? error.message : String(error), 'knowledge_error');
  }
}

export function registerKnowledgeCommand(program: Command): void {
  const messages = getKnowledgeMessages();
  const knowledge = program.command('knowledge').description(messages.commandDescription);

  knowledge
    .command('apply')
    .description(messages.applyDescription)
    .requiredOption('--from <path>', 'Absolute path to a candidate JSON file')
    .option('--approve-global', 'Approve a global create or promotion non-interactively')
    .option('--json', 'Output as JSON')
    .action(async (options: { from?: string; approveGlobal?: boolean; json?: boolean }) => {
      await runKnowledgeAction(() => applyCommand(options));
    });

  knowledge
    .command('list')
    .description(messages.listDescription)
    .option('--scope <scope>', 'project or global')
    .option('--json', 'Output as JSON')
    .action(async (options: { scope?: string; json?: boolean }) => {
      await runKnowledgeAction(() => listCommand(options));
    });

  knowledge
    .command('show <id>')
    .description(messages.showDescription)
    .option('--scope <scope>', 'project or global')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { scope?: string; json?: boolean }) => {
      await runKnowledgeAction(() => showCommand(id, options));
    });

  knowledge
    .command('retire <id>')
    .description(messages.retireDescription)
    .option('--scope <scope>', 'project or global')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { scope?: string; yes?: boolean; json?: boolean }) => {
      await runKnowledgeAction(() => retireCommand(id, options));
    });
}
