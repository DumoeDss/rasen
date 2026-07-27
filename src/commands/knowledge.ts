import * as fs from 'node:fs';
import * as path from 'node:path';

import { Command } from 'commander';
import { ZodError } from 'zod';

import { getGlobalConfig } from '../core/global-config.js';
import { formatZodIssues } from '../core/zod-issues.js';
import {
  KNOWLEDGE_BUNDLE_EXPORT_STATE,
  KnowledgeBundleExportError,
  exportKnowledgeBundle,
  type KnowledgeBundleExportWarning,
} from '../core/knowledge-bundle/export.js';
import {
  KnowledgeBundleImportError,
  importKnowledgeBundle,
  type KnowledgeBundleImportConflict,
  type KnowledgeBundleImportPlan,
  type KnowledgeBundleImportWarning,
} from '../core/knowledge-bundle/import.js';
import { KnowledgeBundleMachinePathError } from '../core/knowledge-bundle/schema.js';
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
  resolveEffectiveLearnedSkillPlan,
  resolveLearnedSkillExecutionContext,
} from '../core/learned-skills/index.js';
import { migrateProjectKnowledgeHome } from '../core/project-knowledge-home.js';
import {
  collectProjectLearnedStores,
  migrateProjectLearnedLedger,
} from '../core/project-learned-skill-ledger.js';
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
  // M5: recoverable backup debris is reported as degraded, not empty. A scope
  // showing zero records MAY actually hold recoverable data (a killed
  // mutation renamed the records into `.rasen-learned-skill-backup-*`); the
  // user must see that the catalog is degraded rather than conclude the data
  // is permanently gone.
  const degraded: Array<{ scope: LearnedSkillScope; dirs: string[] }> = [];
  for (const scope of defaultReadScopes(explicit, context.execution!)) {
    const catalog = await readCanonicalLearnedSkillCatalog(scope, readContextForScope(scope, context));
    for (const record of catalog.records) rows.push({ scope, record });
    for (const entry of catalog.unreadable) unreadable.push({ scope, entry });
    if (catalog.recoverableBackups.length > 0) {
      degraded.push({ scope, dirs: [...catalog.recoverableBackups] });
    }
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
      degraded: degraded.map(({ scope, dirs }) => ({ scope, recoverableBackups: dirs })),
    });
    return;
  }
  if (rows.length === 0 && unreadable.length === 0 && degraded.length === 0) {
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
  if (degraded.length > 0) {
    // Inline (unlocalized) M5 reporting — matches the effective-materialization
    // path's "catalog degraded" diagnostic. The user-visible repair is the
    // same in either surface: run any learned-skill mutation to restore the
    // backup before reading/exporting.
    console.log('Catalog degraded — recoverable backup debris:');
    for (const { scope, dirs } of degraded) {
      console.log(`  [${scope}] ${dirs.join(', ')}`);
    }
    console.log('  Run a learned-skill mutation (e.g. rasen knowledge apply) to restore the backup.');
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
  // M5: track scopes whose catalog is degraded (recoverable backup debris).
  // When the requested id is neither in records nor in unreadable, a degraded
  // catalog explains WHY the id cannot be read — the backed-up record is real
  // data, not permanently lost. Surfacing this turns an unexplained "not
  // found" into a recoverable state with a clear repair.
  const degraded: Array<{ scope: LearnedSkillScope; dirs: string[] }> = [];
  for (const scope of defaultReadScopes(explicit, context.execution!)) {
    const catalog = await readCanonicalLearnedSkillCatalog(scope, readContextForScope(scope, context));
    for (const entry of catalog.unreadable) unreadable.push({ scope, entry });
    if (catalog.recoverableBackups.length > 0) {
      degraded.push({ scope, dirs: [...catalog.recoverableBackups] });
    }
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
  // M5: a degraded catalog explains an otherwise-unexplained "not found". The
  // requested id may be one of the records a killed mutation renamed into
  // `.rasen-learned-skill-backup-*`; surface the degraded state and the
  // repair instead of reporting permanent loss. The details carry the
  // recoverable dirs so a JSON consumer can act programmatically.
  if (degraded.length > 0) {
    const dirs = degraded.flatMap((entry) => entry.dirs);
    reportError(
      options.json,
      options.json
        ? messages.showNotFound(id, explicit ?? 'project')
        : `${messages.showNotFound(id, explicit ?? 'project')} The catalog is degraded with recoverable backup debris (${dirs.join(
            ', '
          )}); run a learned-skill mutation to restore it.`,
      'catalog_degraded',
      { recoverableBackups: dirs.join(';') }
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

/**
 * What this project actually receives, and why.
 *
 * Read-only in the strongest sense: it resolves, reports, and writes nothing —
 * not a file, not an ownership record, not a repaired registry. Sources are
 * named by permanent identity so two Stores that share a display name can be
 * told apart, and a conflict or an unreachable Store is stated as such rather
 * than quietly producing a shorter list.
 */
async function effectiveCommand(options: KnowledgeOwnerOptions): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const context = await buildContext(options, 'mixed');
  const execution = context.execution as LearnedSkillExecutionContext;
  const plan = await resolveEffectiveLearnedSkillPlan({
    execution,
    previousStores:
      execution.owner.type === 'project'
        ? collectProjectLearnedStores(execution.evaluationRoot ?? execution.owner.root)
        : [],
  });

  if (options.json) {
    printJson({
      ok: plan.status !== 'blocked',
      status: plan.status,
      project: plan.project,
      roots: {
        canonicalOwnerRoot: plan.canonicalOwnerRoot,
        evaluationRoot: plan.evaluationRoot,
      },
      skills: plan.skills.map((skill) => ({
        id: skill.id,
        effectiveScope: skill.effectiveScope,
        knowledgeKey: skill.knowledgeKey,
        sources: skill.sources,
        canonicalContentDigest: skill.canonicalContentDigest,
        resolutionDigest: skill.resolutionDigest,
      })),
      stores: plan.stores.map((fact) => ({
        store: fact.store,
        status: fact.status,
        relevance: fact.relevance,
        ...(fact.status === 'unavailable'
          ? { relevant: fact.relevant, diagnostic: fact.diagnostic, repair: fact.repair }
          : {}),
      })),
      conflicts: plan.conflicts,
      unavailableStores: plan.unavailableStores,
      errors: plan.planningErrors,
      ...(plan.budgetFailure ? { budgetFailure: plan.budgetFailure } : {}),
    });
    return;
  }

  console.log(messages.effectiveHeading(plan.project.id, plan.status));
  console.log(messages.effectiveRoots(plan.canonicalOwnerRoot, plan.evaluationRoot));
  if (plan.skills.length === 0) console.log(messages.effectiveEmpty);
  for (const skill of plan.skills) {
    console.log(
      messages.effectiveRow(
        skill.id,
        skill.effectiveScope,
        skill.sources.map((source) => `${describeDurableOwner(source.owner)}/${source.id}`).join(', ')
      )
    );
  }
  for (const fact of plan.stores) {
    console.log(
      messages.effectiveStoreRow(
        describeDurableOwner(
          fact.store.uid === undefined
            ? { type: 'project', projectId: fact.store.id ?? '<unknown>' }
            : { type: 'store', uid: fact.store.uid, ...(fact.store.id !== undefined ? { id: fact.store.id } : {}) }
        ),
        fact.status,
        fact.relevance.length > 0 ? ` [${fact.relevance.join(', ')}]` : ''
      )
    );
  }
  for (const conflict of plan.conflicts) {
    console.log(
      messages.effectiveConflict(
        conflict.id,
        conflict.kind,
        conflict.participants.map((item) => item.label).join(', ')
      )
    );
  }
  for (const store of plan.unavailableStores) {
    console.log(
      messages.effectiveUnavailable(store.store.id ?? store.store.uid ?? '<unknown>', store.diagnostic)
    );
  }
  for (const error of plan.planningErrors) {
    console.log(messages.blocked(error.message));
    if (error.repair?.[0]) console.log(messages.blockedNext(error.repair[0]));
  }
  if (plan.status === 'blocked') process.exitCode = 1;
}

/**
 * The two migrations this release needs, run together and reported separately.
 *
 * Both are explicit — nothing here happens during an ordinary command — and
 * both preview with `--dry-run`. They are independent: a blocked ownership
 * re-key does not stop the catalog move, and neither ever chooses between
 * things that disagree.
 */
async function migrateCommand(
  options: KnowledgeOwnerOptions & { dryRun?: boolean }
): Promise<void> {
  if (reportSelectorConflict(options)) return;
  const messages = getKnowledgeMessages();
  const context = await buildContext(options, 'project');
  const execution = context.execution as LearnedSkillExecutionContext;
  if (execution.owner.type !== 'project') {
    reportError(
      options.json,
      messages.projectRequired,
      'knowledge_owner_scope_mismatch'
    );
    return;
  }
  const dryRun = options.dryRun === true;
  const pathOptions =
    execution.globalDataDir !== undefined ? { globalDataDir: execution.globalDataDir } : {};

  const catalog = await migrateProjectKnowledgeHome(execution.owner.id, {
    ...pathOptions,
    dryRun,
  });
  const ledger = await migrateProjectLearnedLedger(
    execution.evaluationRoot ?? execution.owner.root,
    { ...pathOptions, dryRun }
  );

  if (options.json) {
    printJson({
      ok: catalog.status !== 'blocked' && ledger.status !== 'blocked',
      dryRun,
      catalog,
      ledger,
    });
    if (catalog.status === 'blocked' || ledger.status === 'blocked') process.exitCode = 1;
    return;
  }

  if (dryRun) console.log(messages.migrateDryRunNotice);
  console.log(messages.migrateCatalogHeading);
  if (catalog.status === 'nothing-to-do') {
    console.log(messages.migrateCatalogNothing);
  } else if (dryRun) {
    console.log(messages.migrateCatalogPlan(catalog.moves.length, catalog.target));
  } else {
    console.log(
      messages.migrateCatalogApplied(
        catalog.moved.length,
        catalog.target,
        catalog.deduplicated.length
      )
    );
  }
  for (const conflict of catalog.conflicts) {
    console.log(
      messages.migrateCatalogConflict(
        conflict.id,
        conflict.participants.map((item) => item.catalogDir).join(', ')
      )
    );
  }
  for (const failure of catalog.failed) {
    console.log(messages.migrateCatalogFailed(failure.id, failure.reason));
  }

  console.log(messages.migrateLedgerHeading);
  if (ledger.status === 'nothing-to-do') {
    console.log(messages.migrateLedgerNothing);
  } else if (ledger.status === 'blocked') {
    console.log(
      messages.migrateLedgerBlocked(
        ledger.diagnostics.map((diagnostic) => diagnostic.message).join(' ')
      )
    );
    for (const diagnostic of ledger.diagnostics) {
      if (diagnostic.repair?.[0]) console.log(messages.blockedNext(diagnostic.repair[0]));
    }
  } else if (dryRun) {
    console.log(messages.migrateLedgerPlan(ledger.entries.length));
  } else {
    console.log(messages.migrateLedgerApplied(ledger.entries.length));
  }

  if (catalog.status === 'blocked' || ledger.status === 'blocked') process.exitCode = 1;
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

export interface BundleExportOptions {
  project: string;
  to: string;
  toStore?: string;
  json?: boolean;
}

export interface BundleImportOptions {
  bundle: string;
  project: string;
  dryRun?: boolean;
  json?: boolean;
}

interface BundleFailure {
  code: string;
  message: string;
  repair: string;
  details?: Record<string, unknown>;
}

function describeBundleFailure(
  error: unknown,
  options: BundleExportOptions,
  messages: KnowledgeMessages
): BundleFailure {
  if (error instanceof KnowledgeBundleMachinePathError) {
    return {
      code: 'knowledge_bundle_non_portable_record',
      message: messages.bundleMachinePath(error.recordId, error.field),
      repair: messages.bundleMachinePathRepair(error.recordId),
      details: { record: error.recordId, field: error.field },
    };
  }
  if (error instanceof KnowledgeBundleExportError) {
    switch (error.code) {
      case 'knowledge_bundle_project_not_found':
        return {
          code: error.code,
          message: messages.bundleProjectNotFound(error.details.selector ?? options.project),
          repair: messages.bundleProjectRepair,
          details: { selector: error.details.selector ?? options.project },
        };
      case 'knowledge_bundle_destination_occupied':
        return {
          code: error.code,
          message: messages.bundleDestinationOccupied(error.details.destination ?? options.to),
          repair: messages.bundleDestinationRepair,
          details: { destination: error.details.destination ?? options.to },
        };
      case 'knowledge_bundle_record_unreadable': {
        const record = error.details.recordId ?? '';
        return {
          code: error.code,
          message: messages.bundleRecordUnreadable(record, error.details.reason ?? error.message),
          repair: messages.bundleRecordRepair(record, options.project),
          details: { record, reason: error.details.reason ?? error.message },
        };
      }
      case 'knowledge_bundle_store_unavailable':
        return {
          code: error.code,
          message: messages.bundleStoreUnavailable(
            error.details.selector ?? options.toStore ?? '',
            error.details.diagnostic ?? error.message
          ),
          repair: error.details.repair ?? messages.bundleStoreWriteRepair,
          details: {
            selector: error.details.selector ?? options.toStore ?? '',
            reason: error.details.reason ?? 'unavailable',
            diagnostic: error.details.diagnostic ?? error.message,
          },
        };
      case 'knowledge_bundle_store_overlap':
        return {
          code: error.code,
          message: messages.bundleStoreOverlap(
            error.details.destination ?? options.to,
            error.details.selector ?? options.toStore ?? ''
          ),
          repair: messages.bundleStoreOverlapRepair,
          details: {
            selector: error.details.selector ?? options.toStore ?? '',
            destination: error.details.destination ?? options.to,
            storeRoot: error.details.storeRoot ?? '',
          },
        };
      case 'knowledge_bundle_store_write_failed':
        {
          const userDestinationPublished =
            error.details.userDestinationPublished === 'true';
          const userDestination =
            error.details.userDestination ?? options.to;
        return {
          code: error.code,
          message: userDestinationPublished
            ? messages.bundleStoreWriteFailedAfterExport(
                error.details.destination ?? '',
                error.details.reason ?? error.message,
                userDestination
              )
            : messages.bundleStoreWriteFailed(
                error.details.destination ?? '',
                error.details.reason ?? error.message
              ),
          repair: userDestinationPublished
            ? messages.bundleStoreWritePartialRepair
            : messages.bundleStoreWriteRepair,
          details: {
            selector: error.details.selector ?? options.toStore ?? '',
            destination: error.details.destination ?? '',
            reason: error.details.reason ?? error.message,
            userDestination,
            userDestinationPublished,
          },
        };
        }
      case 'knowledge_bundle_write_failed':
        return {
          code: error.code,
          message: messages.bundleWriteFailed(
            error.details.destination ?? options.to,
            error.details.reason ?? error.message
          ),
          repair: messages.bundleWriteRepair,
          details: {
            destination: error.details.destination ?? options.to,
            reason: error.details.reason ?? error.message,
          },
        };
    }
  }
  if (error instanceof ZodError) {
    return {
      code: 'knowledge_bundle_schema_invalid',
      message: messages.bundleSchemaInvalid(formatZodIssues(error)),
      repair: messages.bundleSchemaRepair,
    };
  }
  return {
    code: 'knowledge_bundle_export_failed',
    message: messages.bundleWriteFailed(
      options.to,
      error instanceof Error ? error.message : String(error)
    ),
    repair: messages.bundleWriteRepair,
  };
}

function reportBundleFailure(
  failure: BundleFailure,
  json: boolean | undefined,
  messages: KnowledgeMessages
): void {
  if (json) {
    printJson({
      ok: false,
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.details ?? {}),
        repair: failure.repair,
      },
    });
  } else {
    console.error(messages.bundleError(failure.message));
    console.error(messages.bundleRepair(failure.repair));
  }
  process.exitCode = 1;
}

function bundleExportWarningMessage(
  code: KnowledgeBundleExportWarning,
  messages: KnowledgeMessages
): string {
  switch (code) {
    case 'base_project_commit_unavailable':
      return messages.bundleExportWarningBaseCommit;
    case 'staging_cleanup_deferred':
      return messages.bundleExportWarningStagingCleanup;
  }
}

export async function bundleExportCommand(
  options: BundleExportOptions,
  exporter: typeof exportKnowledgeBundle = exportKnowledgeBundle
): Promise<void> {
  const messages = getKnowledgeMessages();
  try {
    const result = await exporter({
      project: options.project,
      to: options.to,
      ...(options.toStore !== undefined ? { toStore: options.toStore } : {}),
    });
    const warnings = result.warnings.map((code) => ({
      code,
      message: bundleExportWarningMessage(code, messages),
    }));
    if (options.json) {
      printJson({
        ok: true,
        state: KNOWLEDGE_BUNDLE_EXPORT_STATE,
        project: result.projectId,
        recordCount: result.recordCount,
        destination: result.destination,
        ...(result.transport !== undefined ? { transport: result.transport } : {}),
        warnings,
      });
      return;
    }
    console.log(
      messages.bundleExportSucceeded(
        result.projectId,
        result.recordCount,
        result.destination
      )
    );
    if (result.transport !== undefined) {
      console.log(
        messages.bundleStoreExportSucceeded(
          result.transport.store.uid ?? result.transport.store.id,
          result.transport.destination
        )
      );
      for (const file of result.transport.filesToCommit) {
        console.log(messages.bundleStoreCommitFile(file));
      }
    }
    for (const warning of warnings) console.log(warning.message);
  } catch (error) {
    reportBundleFailure(describeBundleFailure(error, options, messages), options.json, messages);
  }
}

function bundleImportWarningMessage(
  warning: KnowledgeBundleImportWarning,
  messages: KnowledgeMessages
): string {
  switch (warning.code) {
    case 'base_project_commit_provenance':
      return messages.bundleImportWarningProvenance(warning.baseProjectCommit ?? '<unavailable>');
    case 'base_project_commit_unavailable':
      return messages.bundleImportWarningBaseUnavailable;
    case 'staging_cleanup_deferred':
      return messages.bundleImportWarningStagingCleanup;
  }
}

function bundleImportConflictFacts(
  conflict: KnowledgeBundleImportConflict,
  messages: KnowledgeMessages
): {
  id: string;
  knowledgeKey: string;
  reason: string;
  bundle: KnowledgeBundleImportConflict['bundle'];
  local: KnowledgeBundleImportConflict['local'];
  message: string;
} {
  const status = (value: 'active' | 'retired'): string =>
    value === 'active'
      ? messages.bundleImportStatusActive
      : messages.bundleImportStatusRetired;
  const reason =
    conflict.reason === 'content-differs'
      ? messages.bundleImportConflictReasonContent
      : conflict.reason === 'lifecycle-differs'
        ? messages.bundleImportConflictReasonLifecycle
        : messages.bundleImportConflictReasonOccupied;
  const bundle = messages.bundleImportBundleSide(
    conflict.bundle.contentDigest,
    status(conflict.bundle.status)
  );
  const local =
    conflict.local.kind === 'managed'
      ? messages.bundleImportLocalManaged(
          conflict.local.contentDigest,
          status(conflict.local.status)
        )
      : messages.bundleImportLocalOccupied;
  return {
    ...conflict,
    message: messages.bundleImportConflict(conflict.id, reason, bundle, local),
  };
}

function bundleImportPlanFacts(
  plan: KnowledgeBundleImportPlan,
  messages: KnowledgeMessages
): Record<string, unknown> {
  return {
    project: plan.projectId,
    bundle: {
      id: plan.bundleId,
      path: plan.bundlePath,
      baseProjectCommit: plan.baseProjectCommit,
    },
    added: plan.added,
    alreadyPresent: plan.alreadyPresent,
    conflicts: plan.conflicts.map((conflict) =>
      bundleImportConflictFacts(conflict, messages)
    ),
    warnings: plan.warnings.map((warning) => ({
      ...warning,
      message: bundleImportWarningMessage(warning, messages),
    })),
  };
}

function bundleImportCatalogReasonMessage(
  reason: string | undefined,
  messages: KnowledgeMessages
): string {
  switch (reason) {
    case 'unregistered_project':
      return messages.bundleImportCatalogReasonUnregisteredProject;
    case 'typed_owner_mismatch':
      return messages.bundleImportCatalogReasonTypedOwnerMismatch;
    case 'knowledge_owner_scope_mismatch':
      return messages.bundleImportCatalogReasonOwnerScopeMismatch;
    case 'resolver_threw':
      return messages.bundleImportCatalogReasonResolverThrew;
    default:
      return messages.bundleImportCatalogReasonUnknown;
  }
}

function bundleImportProjectReasonMessage(
  reason: string | undefined,
  messages: KnowledgeMessages
): string {
  return reason === 'project_resolver_threw'
    ? messages.bundleImportProjectReasonResolverThrew
    : messages.bundleImportProjectReasonUnknown;
}

function bundleImportLockReasonMessage(
  reason: string | undefined,
  messages: KnowledgeMessages
): string {
  switch (reason) {
    case 'timeout':
      return messages.bundleImportLockReasonTimeout;
    case 'create-failed':
      return messages.bundleImportLockReasonCreateFailed;
    default:
      return messages.bundleImportLockReasonUnknown;
  }
}

function describeBundleImportFailure(
  error: unknown,
  options: BundleImportOptions,
  messages: KnowledgeMessages
): BundleFailure {
  if (!(error instanceof KnowledgeBundleImportError)) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    return {
      code: 'knowledge_bundle_import_failed',
      message: [
        messages.bundleImportUnknownFailed(diagnostic),
        messages.bundleImportUnknownChange,
      ].join('\n'),
      repair: messages.bundleImportUnknownRepair,
      details: {
        bundle: path.resolve(options.bundle),
        project: options.project,
        changed: 'unknown',
        reason: 'unclassified_failure',
        diagnostic,
      },
    };
  }
  const reason =
    error.issues
      .map((issue) =>
        [issue.recordId, issue.field, issue.reason].filter(Boolean).join(': ')
      )
      .join('; ') ||
    error.details.reason ||
    error.message;
  let message: string;
  let repair: string;
  switch (error.code) {
    case 'knowledge_bundle_import_bundle_invalid':
      message = messages.bundleImportInvalid(reason);
      repair = messages.bundleImportInvalidRepair;
      break;
    case 'knowledge_bundle_import_project_not_found':
      message = messages.bundleProjectNotFound(error.details.selector ?? options.project);
      repair = messages.bundleProjectRepair;
      break;
    case 'knowledge_bundle_import_project_unavailable':
      message = messages.bundleImportProjectUnavailable(
        bundleImportProjectReasonMessage(error.details.reason, messages)
      );
      repair = messages.bundleImportProjectUnavailableRepair;
      break;
    case 'knowledge_bundle_import_project_mismatch':
      message = messages.bundleImportProjectMismatch(
        error.details.bundleProjectId ?? '<unknown>',
        error.details.targetProjectId ?? options.project
      );
      repair = messages.bundleImportProjectMismatchRepair;
      break;
    case 'knowledge_bundle_import_record_id_invalid':
    case 'knowledge_bundle_import_record_id_collision':
      message = messages.bundleImportIdentifierInvalid(reason);
      repair = messages.bundleImportIdentifierRepair;
      break;
    case 'knowledge_bundle_import_catalog_unavailable':
      message = messages.bundleImportCatalogUnavailable(
        bundleImportCatalogReasonMessage(error.details.reason, messages)
      );
      repair = messages.bundleImportCatalogRepair;
      break;
    case 'knowledge_bundle_import_catalog_drift':
      message = messages.bundleImportCatalogDrift;
      repair = messages.bundleImportCatalogRepair;
      break;
    case 'knowledge_bundle_import_conflict':
      message = messages.bundleImportConflictsRefused(
        error.details.conflictCount ?? String(error.plan?.conflicts.length ?? 0)
      );
      repair = messages.bundleImportConflictRepair;
      break;
    case 'knowledge_bundle_import_lock_failed':
      message = [
        messages.bundleImportLockFailed(
          bundleImportLockReasonMessage(error.details.reason, messages)
        ),
        ...(error.details.lockPath === undefined
          ? []
          : [messages.bundleImportLockPath(error.details.lockPath)]),
      ].join('\n');
      repair =
        error.details.reason === 'create-failed'
          ? messages.bundleImportLockCreateRepair
          : messages.bundleImportLockRepair;
      break;
    case 'knowledge_bundle_import_transaction_failed':
      message = messages.bundleImportTransactionFailed(reason);
      repair = messages.bundleImportTransactionRepair;
      break;
    case 'knowledge_bundle_import_rollback_failed':
      message = [
        messages.bundleImportRollbackFailed(reason),
        messages.bundleImportChangeUnknown,
        ...error.retainedPaths.map((retainedPath) =>
          messages.bundleImportRetainedPath(retainedPath)
        ),
      ].join('\n');
      repair = messages.bundleImportRollbackRepair;
      break;
  }
  return {
    code: error.code,
    message,
    repair,
    details: {
      bundle: path.resolve(options.bundle),
      project: options.project,
      changed: error.changed,
      issues: error.issues,
      reason,
      ...(error.details.diagnostic === undefined
        ? {}
        : { diagnostic: error.details.diagnostic }),
      ...(error.retainedPaths.length === 0
        ? {}
        : { retainedPaths: error.retainedPaths }),
      ...(error.details.lockPath === undefined
        ? {}
        : { lockPath: error.details.lockPath }),
      ...(error.plan === undefined
        ? {}
        : { plan: bundleImportPlanFacts(error.plan, messages) }),
    },
  };
}

export async function bundleImportCommand(
  options: BundleImportOptions,
  importer: typeof importKnowledgeBundle = importKnowledgeBundle
): Promise<void> {
  const messages = getKnowledgeMessages();
  try {
    const result = await importer({
      bundle: options.bundle,
      project: options.project,
      ...(options.dryRun === true ? { dryRun: true } : {}),
    });
    const facts = bundleImportPlanFacts(result, messages);
    if (options.json) {
      printJson({
        ok: true,
        state: result.state,
        refused: result.refused,
        changed: result.changed,
        ...facts,
      });
      return;
    }
    console.log(
      result.state === 'previewed'
        ? messages.bundleImportPreviewed(
            result.projectId,
            result.bundleId,
            result.bundlePath,
            result.added.length,
            result.alreadyPresent.length,
            result.conflicts.length
          )
        : messages.bundleImportSucceeded(
            result.projectId,
            result.bundleId,
            result.bundlePath,
            result.added.length,
            result.alreadyPresent.length
          )
    );
    for (const record of result.added) console.log(messages.bundleImportAdded(record.id));
    for (const record of result.alreadyPresent) {
      console.log(messages.bundleImportAlreadyPresent(record.id));
    }
    for (const conflict of result.conflicts) {
      console.log(bundleImportConflictFacts(conflict, messages).message);
    }
    for (const warning of result.warnings) {
      console.log(bundleImportWarningMessage(warning, messages));
    }
  } catch (error) {
    if (
      !options.json &&
      error instanceof KnowledgeBundleImportError &&
      error.plan !== undefined
    ) {
      for (const conflict of error.plan.conflicts) {
        console.error(bundleImportConflictFacts(conflict, messages).message);
      }
    }
    reportBundleFailure(
      describeBundleImportFailure(error, options, messages),
      options.json,
      messages
    );
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

  const bundle = knowledge
    .command('bundle')
    .description(messages.bundleDescription);

  bundle
    .command('export')
    .description(messages.bundleExportDescription)
    .requiredOption('--project <id-or-root>', messages.projectSelectorDescription)
    .requiredOption('--to <path>', messages.bundleDestinationDescription)
    .option('--to-store <store>', messages.bundleStoreDestinationDescription)
    .option('--json', messages.bundleJsonDescription)
    .action(async (options: BundleExportOptions) => {
      await bundleExportCommand(options);
    });

  bundle
    .command('import')
    .description(messages.bundleImportDescription)
    .argument('<bundle>', messages.bundleImportPathDescription)
    .requiredOption('--project <id-or-root>', messages.projectSelectorDescription)
    .option('--dry-run', messages.bundleImportDryRunDescription)
    .option('--json', messages.bundleJsonDescription)
    .action(async (bundlePath: string, options: Omit<BundleImportOptions, 'bundle'>) => {
      await bundleImportCommand({ ...options, bundle: bundlePath });
    });

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
    .command('effective')
    .description(messages.effectiveDescription)
    .option('--json', 'Output as JSON'), messages)
    .action(async (options: {
      project?: string;
      store?: string;
      runStateDir?: string;
      json?: boolean;
    }) => {
      await runKnowledgeAction(() => effectiveCommand(options), options.json);
    });

  addOwnerSelectorOptions(knowledge
    .command('migrate')
    .description(messages.migrateDescription)
    .option('--dry-run', messages.dryRunDescription)
    .option('--json', 'Output as JSON'), messages)
    .action(async (options: {
      dryRun?: boolean;
      project?: string;
      store?: string;
      runStateDir?: string;
      json?: boolean;
    }) => {
      await runKnowledgeAction(() => migrateCommand(options), options.json);
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
