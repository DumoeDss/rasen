import * as fs from 'node:fs';
import * as path from 'node:path';

import { Command } from 'commander';

import { getGlobalConfig } from '../core/global-config.js';
import { formatZodIssues } from '../core/zod-issues.js';
import {
  KnowledgeContextError,
  LearnedSkillCandidateSchema,
  commitLearnedSkillPlan,
  describeDurableOwner,
  planLearnedSkillMutation,
  readCanonicalLearnedSkillCatalog,
  type CanonicalKnowledgeIdentity,
  type CanonicalLearnedSkill,
  type DurableKnowledgeOwnerRef,
  type FrozenKnowledgeContext,
  type LearnedSkillContext,
  type LearnedSkillExecutionContext,
  type LearnedSkillMutationRequest,
  type LearnedSkillPlan,
  type LearnedSkillResult,
  type LearnedSkillScope,
  type ParsedLearnedSkillCandidate,
  type StoreApprovalGrant,
  type UnreadableCanonicalRecord,
  isKnowledgeContextError,
  resolveLearnedSkillExecutionContext,
} from '../core/learned-skills/index.js';
import { storeUidsMatch } from '../core/store/identity-types.js';
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

/**
 * A durable owner on the wire. A Store's permanent identity is what a JSON
 * consumer keys on; the display alias travels alongside so a human reading the
 * same document recognizes it.
 *
 * A blocked plan can carry an identity that never resolved — a legacy Store
 * with no permanent identity is exactly the case being refused — so an empty
 * identity is OMITTED rather than reported as an empty string a consumer might
 * key on.
 */
function ownerToWire(owner: DurableKnowledgeOwnerRef): Record<string, unknown> {
  switch (owner.type) {
    case 'global':
      return { type: 'global' };
    case 'project':
      return {
        type: 'project',
        ...(owner.projectId ? { projectId: owner.projectId } : {}),
        ...(owner.id ? { id: owner.id } : {}),
      };
    case 'store':
      return {
        type: 'store',
        ...(owner.uid ? { uid: owner.uid } : {}),
        ...(owner.id ? { id: owner.id } : {}),
      };
  }
}

function identityToWire(identity: CanonicalKnowledgeIdentity): Record<string, unknown> {
  return { owner: ownerToWire(identity.owner), id: identity.id };
}

/** `store:team (uid)/go-sql-transaction-locking` — what a human can act on. */
function identityLabel(identity: CanonicalKnowledgeIdentity): string {
  return `${describeDurableOwner(identity.owner)}/${identity.id}`;
}

function contextToWire(context: LearnedSkillExecutionContext): Record<string, unknown> {
  const owner =
    context.owner.type === 'global'
      ? { type: 'global' }
      : context.owner.type === 'store'
        ? {
            type: 'store',
            id: context.owner.id,
            ...(context.owner.uid !== undefined ? { uid: context.owner.uid } : {}),
          }
        : { type: context.owner.type, id: context.owner.id };
  return {
    owner,
    ...(context.planningRoot
      ? {
          planningRoot: {
            type: context.planningRoot.type,
            id: context.planningRoot.id,
            ...(context.planningRoot.type === 'store' && context.planningRoot.uid !== undefined
              ? { uid: context.planningRoot.uid }
              : {}),
          },
        }
      : {}),
    source: context.source,
  };
}

function describeContextOwner(context: LearnedSkillExecutionContext): string {
  if (context.owner.type === 'global') return 'global';
  if (context.owner.type === 'store') {
    return context.owner.uid === undefined
      ? `store:${context.owner.id}`
      : `store:${context.owner.id} (${context.owner.uid})`;
  }
  return `project:${context.owner.id}`;
}

function reportHumanContext(
  context: LearnedSkillExecutionContext,
  messages: KnowledgeMessages
): void {
  const planning = context.planningRoot
    ? `${context.planningRoot.type}:${context.planningRoot.id}`
    : 'none';
  console.error(messages.contextSummary(describeContextOwner(context), planning));
}

function scopeFromOption(scope: string | undefined): LearnedSkillScope | undefined {
  return scope === 'global' || scope === 'project' || scope === 'store' ? scope : undefined;
}

function candidateToRequest(candidate: ParsedLearnedSkillCandidate): LearnedSkillMutationRequest {
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

/**
 * What a user is being asked to approve, before they approve it: the exact
 * target, the knowledge key it is published under, its applicability, and the
 * source records it draws on. The deterministic gates are necessary but not
 * sufficient — an informed human is the backstop, and they cannot be informed
 * by an id alone.
 */
function reportInformedPlan(plan: LearnedSkillPlan, messages: KnowledgeMessages): void {
  console.error(messages.plan(plan.summary));
  console.error(`  ${messages.planTarget(identityLabel(plan.identity))}`);
  if (plan.knowledgeKey) console.error(`  ${messages.planKnowledgeKey(plan.knowledgeKey)}`);
  if (plan.applicability) {
    console.error(
      `  ${messages.showApplicability(plan.applicability.mode, plan.applicability.markers.join(', '))}`
    );
  }
  console.error(
    `  ${
      plan.sourceIdentities.length > 0
        ? messages.planSources(plan.sourceIdentities.map(identityLabel).join(', '))
        : messages.planSourcesNone
    }`
  );
}

/** Prints a refusal with its copy-pasteable next command, when one exists. */
function reportBlock(
  block: { code: string; message: string; repair?: string[] } | undefined,
  json: boolean | undefined,
  messages: KnowledgeMessages,
  extra: Record<string, unknown> = {}
): void {
  if (json) {
    printJson({ ok: false, ...extra, block });
  } else {
    console.error(messages.blocked(block?.message ?? 'blocked'));
    for (const command of block?.repair ?? []) {
      console.error(messages.blockedNext(command));
    }
  }
  process.exitCode = 1;
}

function resultWire(
  result: LearnedSkillResult,
  context: LearnedSkillExecutionContext
): Record<string, unknown> {
  return {
    ok: true,
    outcome: result.outcome,
    identity: identityToWire(result.identity),
    scope: result.scope,
    id: result.id,
    status: result.status,
    ...(result.storeRoot ? { storeRoot: result.storeRoot } : {}),
    ...(result.changedFiles ? { changedFiles: result.changedFiles } : {}),
    context: contextToWire(context),
  };
}

/**
 * Reports what a Store mutation wrote and what the user must now commit.
 * Rasen never stages, commits, or pushes in a Store's repository, and says so
 * where the user will see it.
 */
function reportStoreWrites(result: LearnedSkillResult, messages: KnowledgeMessages): void {
  if (!result.storeRoot) return;
  console.log(messages.storeRootNotice(result.storeRoot));
  console.log(messages.commitReminderHeading);
  for (const file of result.changedFiles ?? []) {
    console.log(messages.commitReminderFile(file));
  }
  console.log(messages.commitReminderNothingStaged);
}

/**
 * Resolves the approval for a Store publication.
 *
 * An approval names the Store it applies to and is verified against the Store
 * the plan actually resolved to — by permanent identity, so a display name
 * that now points at a namesake refuses instead of publishing into it. Nothing
 * here treats a previous approval, an existing narrower record, or the absence
 * of an objection as consent.
 *
 * The selector comparison accepts the resolved display name as well as the
 * permanent identity, and that arm is safe rather than a loophole: by the time
 * it runs the target Store is already PINNED — an ambiguous `--store` alias
 * failed at resolution, and the resolved plan has been printed — so the name
 * can only CONFIRM the Store the user was shown, never redirect to a namesake.
 * Do not widen it to accept a name resolved here, and do not delete it either;
 * it is what lets a user approve using the name they just read on screen.
 */
async function resolveStoreApproval(
  plan: LearnedSkillPlan,
  selector: string | undefined,
  json: boolean | undefined,
  messages: KnowledgeMessages
): Promise<StoreApprovalGrant | 'refused'> {
  const target = plan.identity.owner;
  if (target.type !== 'store') return 'refused';
  const label = describeDurableOwner(target);
  const grant: StoreApprovalGrant = {
    scope: 'store',
    uid: target.uid,
    ...(target.id ? { id: target.id } : {}),
  };

  if (selector !== undefined) {
    const names =
      storeUidsMatch(selector, target.uid) ||
      (target.id !== undefined && selector === target.id);
    if (!names) {
      reportError(
        json,
        messages.storeApprovalSelectorMismatch(selector, label),
        'store_approval_scope_mismatch'
      );
      return 'refused';
    }
    return grant;
  }

  if (process.stdout.isTTY && !json) {
    const { confirm } = await import('@inquirer/prompts');
    const approved = await confirm({
      message: messages.storeApprovalPrompt(plan.id, label),
      default: false,
    });
    if (!approved) {
      console.error(messages.storeApprovalDeclined);
      return 'refused';
    }
    return grant;
  }

  reportError(
    json,
    messages.storeApprovalRequiredNonInteractive(plan.id, target.id ?? target.uid),
    'store_approval_required'
  );
  return 'refused';
}

async function applyCommand(options: {
  from?: string;
  approveGlobal?: boolean;
  approveStore?: string;
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

  // Consent is scope-bound before anything is planned: a flag offered for the
  // wrong scope is a refusal, never a value that gets quietly ignored.
  if (options.approveGlobal !== undefined && options.approveStore !== undefined) {
    reportError(options.json, messages.consentScopeMismatch, 'consent_scope_mismatch');
    return;
  }
  if (options.approveGlobal && targetScope !== 'global') {
    reportError(options.json, messages.approveGlobalNotForProject, 'consent_scope_mismatch');
    return;
  }
  if (options.approveStore !== undefined && targetScope !== 'store') {
    reportError(options.json, messages.consentScopeMismatch, 'consent_scope_mismatch');
    return;
  }

  // Project mutations are authorized by an active codify profile (design D8);
  // store and global mutations are gated by explicit approval instead.
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
    reportBlock(plan.block, options.json, messages, {
      plan: { action: plan.action, identity: identityToWire(plan.identity), scope: plan.scope },
    });
    return;
  }

  if (!options.json) reportInformedPlan(plan, messages);

  let approveGlobal = options.approveGlobal === true;
  let approveStore: StoreApprovalGrant | undefined;

  if (plan.requiresStoreApproval) {
    const approval = await resolveStoreApproval(plan, options.approveStore, options.json, messages);
    if (approval === 'refused') return;
    approveStore = approval;
  }

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

  const result = await commitLearnedSkillPlan(plan, {
    ...context,
    approveGlobal,
    ...(approveStore ? { approveStore } : {}),
  });
  if (result.outcome === 'blocked') {
    reportBlock(result.block, options.json, messages);
    return;
  }

  if (options.json) {
    printJson(resultWire(result, context.execution!));
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
  reportStoreWrites(result, messages);
}

function toWireRecord(record: CanonicalLearnedSkill): Record<string, unknown> {
  const manifest = record.manifest;
  const owners = new Set(record.evidence.map((entry) => describeDurableOwner(entry.owner)));
  return {
    identity: identityToWire(record.identity),
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
    ...(manifest.retirementReason ? { retirementReason: manifest.retirementReason } : {}),
  };
}

/**
 * Which catalogs a read without an explicit `--scope` covers. A Store owner
 * reads its Store; anything else reads the project's own knowledge and the
 * machine-wide set. What a project RECEIVES from its Stores is the sibling
 * change's resolution and deliberately not decided here.
 */
function defaultReadScopes(
  explicit: LearnedSkillScope | undefined,
  context: LearnedSkillExecutionContext
): LearnedSkillScope[] {
  if (explicit) return [explicit];
  return context.owner.type === 'store' ? ['store'] : ['project', 'global'];
}

/**
 * The global catalog belongs to the machine, not to the resolved owner, so a
 * global read drops the owner context rather than failing its scope check.
 */
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

  const rows: Array<{ scope: LearnedSkillScope; record: CanonicalLearnedSkill }> = [];
  // Records Rasen wrote that no longer verify are collected alongside, never
  // dropped: a skill that vanishes from this list with no explanation is
  // indistinguishable from one that was deleted, and the check that removed it
  // is the last thing a user would guess at.
  const unreadable: Array<{ scope: LearnedSkillScope; entry: UnreadableCanonicalRecord }> = [];
  for (const scope of defaultReadScopes(explicit, context.execution!)) {
    const catalog = await readCanonicalLearnedSkillCatalog(scope, readContextForScope(scope, context));
    for (const record of catalog.records) rows.push({ scope, record });
    for (const entry of catalog.unreadable) unreadable.push({ scope, entry });
  }

  if (options.json) {
    printJson({
      context: contextToWire(context.execution!),
      learnedSkills: rows.map(({ record }) => toWireRecord(record)),
      unreadable: unreadable.map(({ scope, entry }) => ({
        id: entry.id,
        scope,
        directory: entry.directory,
        reason: entry.reason,
      })),
    });
    return;
  }
  if (rows.length === 0 && unreadable.length === 0) {
    console.log(messages.listEmpty);
    return;
  }
  if (rows.length === 0) console.log(messages.listEmpty);
  else {
    console.log(messages.listHeading);
    for (const { scope, record } of rows) {
      const marker = record.manifest.status === 'active' ? '*' : '-';
      console.log(
        messages.listRow(marker, record.manifest.id, scope, record.manifest.status, record.manifest.description)
      );
    }
  }
  if (unreadable.length > 0) {
    console.log(messages.unreadableHeading);
    for (const { scope, entry } of unreadable) {
      console.log(messages.unreadableRow(entry.id, scope, entry.reason));
    }
    console.log(messages.unreadableNext);
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

  const unreadable: Array<{ scope: LearnedSkillScope; entry: UnreadableCanonicalRecord }> = [];
  for (const scope of defaultReadScopes(explicit, context.execution!)) {
    const catalog = await readCanonicalLearnedSkillCatalog(scope, readContextForScope(scope, context));
    for (const entry of catalog.unreadable) unreadable.push({ scope, entry });
    const found = catalog.records.find((record) => record.manifest.id === id);
    if (!found) continue;
    if (options.json) {
      printJson({ ...toWireRecord(found), context: contextToWire(context.execution!) });
      return;
    }
    const manifest = found.manifest;
    const owners = new Set(found.evidence.map((entry) => describeDurableOwner(entry.owner)));
    console.log(`${identityLabel(found.identity)} [${manifest.scope}/${manifest.status}]`);
    console.log(`  ${manifest.description}`);
    console.log(
      `  ${messages.showApplicability(manifest.applicability.mode, manifest.applicability.markers.join(', '))}`
    );
    console.log(`  ${messages.provenanceSummary(found.evidence.length, owners.size)}`);
    return;
  }

  // "Not found" would be a lie for a record that IS on disk and was refused by
  // verification. Naming the reason and the repair is the difference between a
  // recoverable state and an unexplained disappearance.
  const refused = unreadable.find(({ entry }) => entry.id === id);
  if (refused) {
    reportError(
      options.json,
      messages.showUnreadable(id, refused.scope, refused.entry.reason),
      'unreadable_record',
      { directory: refused.entry.directory, next: messages.unreadableNext }
    );
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
  const scope: LearnedSkillScope =
    scopeFromOption(options.scope) ?? (options.store !== undefined ? 'store' : 'project');
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
    reportBlock(plan.block, options.json, messages);
    return;
  }
  const result = await commitLearnedSkillPlan(plan, context);
  if (result.outcome === 'blocked') {
    reportBlock(result.block, options.json, messages);
    return;
  }
  if (options.json) {
    printJson(resultWire(result, context.execution!));
    return;
  }
  if (result.outcome === 'retired') console.log(messages.retired(result.scope, result.id));
  else if (result.outcome === 'no-op') console.log(messages.noop(result.id));
  reportStoreWrites(result, messages);
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
    .option(
      '--approve-store <store>',
      'Approve a store publication non-interactively, naming the store it applies to'
    )
    .option('--approve-global', 'Approve a global create or promotion non-interactively')
    .option('--json', 'Output as JSON'), messages)
    .action(async (options: {
      from?: string;
      approveGlobal?: boolean;
      approveStore?: string;
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
    .option('--scope <scope>', 'project, store, or global')
    .option('--json', 'Output as JSON'), messages)
    .action(async (options: { scope?: string; project?: string; store?: string; runStateDir?: string; json?: boolean }) => {
      await runKnowledgeAction(() => listCommand(options), options.json);
    });

  addOwnerSelectorOptions(knowledge
    .command('show <id>')
    .description(messages.showDescription)
    .option('--scope <scope>', 'project, store, or global')
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
    .option('--scope <scope>', 'project, store, or global')
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
