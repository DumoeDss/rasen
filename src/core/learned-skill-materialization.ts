/**
 * Writing the resolved set into the checkout being worked on.
 *
 * Resolution is a read-only preflight (`resolveEffectiveLearnedSkillPlan`);
 * this module is the ONLY seam that touches a tool's skill home or an ownership
 * record. Everything it does is bounded by exact ownership:
 *
 *   a generated file is modified or removed only when the ownership record
 *   claims THAT EXACT PATH, the file on disk is still an ordinary file, its
 *   bytes still match what was recorded, and the source is still verifiable.
 *
 * Anything failing a check is left alone and reported. A file the user authored
 * at a generated path is never taken over, and a Store that could not be
 * reached defers every removal it would have implied rather than having its
 * contribution deleted.
 *
 * Two homes are supported and they are not symmetrical:
 *
 *   - a project-local tool home receives the project's resolved set and records
 *     ownership in that CHECKOUT's ledger;
 *   - a machine-wide tool home receives machine-wide knowledge ONLY, because
 *     the same directory is shared by every project on the machine.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  digestContent,
  managedBodyInputFor,
  renderManagedDocument,
  RESOLUTION_DIGEST_VERSION,
  resolutionDigestV2,
  type CanonicalKnowledgeIdentity,
  type CanonicalLearnedSkill,
  type EffectiveDescriptionBudgetFailure,
  type EffectiveLearnedSkill,
  type EffectiveLearnedSkillPlan,
  type EffectiveLearnedSkillScope,
  type EffectiveStoreUnavailableFact,
  type StoreSkillConflict,
} from './learned-skills/index.js';
import { quoteYamlValue } from './shared/yaml.js';
import {
  persistToolLearnedArtifacts,
  readToolLearnedArtifacts,
  resolveArtifactFile,
  sha256File,
  storedArtifactFile,
} from './workflow-artifact-ledger.js';
import {
  ProjectLearnedLedgerError,
  persistProjectLearnedArtifacts,
  readProjectLearnedLedger,
  type ProjectLearnedArtifactEntry,
  type ProjectLearnedStoreFact,
} from './project-learned-skill-ledger.js';
import {
  persistGlobalLearnedArtifacts,
  readGlobalLearnedArtifacts,
  sha256GlobalFile,
  type GlobalLearnedArtifactEntry,
} from './global-learned-skill-ledger.js';

export const LEARNED_SKILL_CONTENT_FILE = 'SKILL.md';

/** One materialized copy created, updated, migrated, or removed. */
export interface LearnedMaterializationOutcome {
  id: string;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: CanonicalKnowledgeIdentity[];
  resolutionDigest: string;
  targetPath: string;
}

export interface LearnedMaterializationSkip {
  id: string;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: CanonicalKnowledgeIdentity[];
  targetPath?: string;
  reason: 'collision' | 'global-only-home' | 'ledger-invalid' | 'missing';
  message: string;
}

/** One winner assembled from several byte-identical Store copies. */
export interface LearnedDeduplication {
  id: string;
  sources: CanonicalKnowledgeIdentity[];
}

/** A removal or replacement withheld because a relevant Store is unreachable. */
export interface LearnedDeferredAction {
  id: string;
  action: 'remove' | 'replace';
  stores: Array<{ type: 'store'; uid?: string; id?: string }>;
  message: string;
}

export interface LearnedReconcileResult {
  /** True only when reconciliation was COMPLETE and changed nothing. */
  noOp: boolean;
  created: LearnedMaterializationOutcome[];
  updated: LearnedMaterializationOutcome[];
  /**
   * Rewritten because the IDENTITY SCHEME changed, not because anything was
   * edited. Reported apart from `updated` so the first post-upgrade run does
   * not tell a user their whole catalog was modified.
   */
  migrated: LearnedMaterializationOutcome[];
  removed: LearnedMaterializationOutcome[];
  skipped: LearnedMaterializationSkip[];
  deduplicated: LearnedDeduplication[];
  conflicts: StoreSkillConflict[];
  unavailableStores: EffectiveStoreUnavailableFact[];
  deferred: LearnedDeferredAction[];
  errors: Array<{ code: string; message: string; repair?: string[] }>;
  budgetFailure?: EffectiveDescriptionBudgetFailure;
  planStatus?: EffectiveLearnedSkillPlan['status'];
}

export function emptyLearnedReconcileResult(): LearnedReconcileResult {
  return {
    noOp: false,
    created: [],
    updated: [],
    migrated: [],
    removed: [],
    skipped: [],
    deduplicated: [],
    conflicts: [],
    unavailableStores: [],
    deferred: [],
    errors: [],
  };
}

export function learnedReconcileHasActivity(result: LearnedReconcileResult): boolean {
  return (
    result.created.length > 0 ||
    result.updated.length > 0 ||
    result.migrated.length > 0 ||
    result.removed.length > 0 ||
    result.skipped.length > 0 ||
    result.deduplicated.length > 0 ||
    result.conflicts.length > 0 ||
    result.unavailableStores.length > 0 ||
    result.deferred.length > 0 ||
    result.errors.length > 0 ||
    result.budgetFailure !== undefined
  );
}

export function learnedReconcileHasChanges(result: LearnedReconcileResult): boolean {
  return (
    result.created.length > 0 ||
    result.updated.length > 0 ||
    result.migrated.length > 0 ||
    result.removed.length > 0
  );
}

/**
 * The durable key for one source. A Store's display alias never reaches it, so
 * merging and deduplication survive a rename and keep two namesakes apart.
 */
function sourceKey(identity: CanonicalKnowledgeIdentity): string {
  const owner = identity.owner;
  const ownerKey =
    owner.type === 'global'
      ? 'global'
      : owner.type === 'project'
        ? `project:${owner.projectId}`
        : `store:${owner.uid.trim().toLowerCase()}`;
  return `${ownerKey}/${identity.id}`;
}

function storeKey(store: { uid?: string; id?: string }): string {
  return store.uid !== undefined ? `uid:${store.uid.trim().toLowerCase()}` : `id:${store.id ?? ''}`;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

export function mergeLearnedReconcileResult(
  into: LearnedReconcileResult,
  from: LearnedReconcileResult
): void {
  into.created.push(...from.created);
  into.updated.push(...from.updated);
  into.migrated.push(...from.migrated);
  into.removed.push(...from.removed);
  into.skipped.push(...from.skipped);
  into.deduplicated = uniqueBy([...into.deduplicated, ...from.deduplicated], (item) => item.id);
  into.conflicts = uniqueBy(
    [...into.conflicts, ...from.conflicts],
    (item) => `${item.kind}:${item.id}`
  );
  into.unavailableStores = uniqueBy([...into.unavailableStores, ...from.unavailableStores], (item) =>
    storeKey(item.store)
  );
  into.deferred = mergeDeferredActions([...into.deferred, ...from.deferred]);
  into.errors = uniqueBy([...into.errors, ...from.errors], (item) => `${item.code}:${item.message}`);
  into.budgetFailure ??= from.budgetFailure;
  into.planStatus ??= from.planStatus;
  sortResult(into);
  finalizeNoOp(into);
}

function describeStore(store: { uid?: string; id?: string }): string {
  if (store.id === undefined) return `store:${store.uid ?? '<unknown>'}`;
  return store.uid === undefined ? `store:${store.id}` : `store:${store.id} (${store.uid})`;
}

function deferredMessage(
  action: LearnedDeferredAction['action'],
  id: string,
  stores: readonly { uid?: string; id?: string }[]
): string {
  return `Deferred ${action} for "${id}" because relevant unavailable sources ${stores
    .map(describeStore)
    .join(', ')} may still contribute.`;
}

function mergeDeferredActions(
  actions: readonly LearnedDeferredAction[]
): LearnedDeferredAction[] {
  const grouped = new Map<string, LearnedDeferredAction>();
  for (const action of actions) {
    const key = `${action.action}:${action.id}`;
    const current = grouped.get(key);
    const stores = uniqueBy([...(current?.stores ?? []), ...action.stores], storeKey).sort(
      (left, right) => storeKey(left).localeCompare(storeKey(right))
    );
    grouped.set(key, {
      id: action.id,
      action: action.action,
      stores,
      message: deferredMessage(action.action, action.id, stores),
    });
  }
  return [...grouped.values()];
}

function finalizeNoOp(result: LearnedReconcileResult): void {
  result.noOp = result.planStatus !== 'blocked' && !learnedReconcileHasActivity(result);
}

/**
 * The materialized `SKILL.md` for one resolved skill.
 *
 * Rendered through the same document renderer the identity digest covers, with
 * the digest line appended — so what lands on disk and what the identity was
 * computed over can never drift apart.
 */
export function renderMaterializedSkill(
  input: CanonicalLearnedSkill | EffectiveLearnedSkill
): string {
  const effective = 'canonicalRecord' in input ? input : effectiveFromCanonical(input);
  return renderManagedDocument(
    managedBodyInputFor({
      id: effective.id,
      effectiveScope: effective.effectiveScope,
      sources: effective.sources,
      record: effective.canonicalRecord,
    }),
    [`  resolutionDigest: ${quoteYamlValue(effective.resolutionDigest)}`]
  );
}

/** A single canonical record standing in for a resolved one (its own source). */
function effectiveFromCanonical(record: CanonicalLearnedSkill): EffectiveLearnedSkill {
  const effectiveScope = record.scope === 'store' ? 'store' : record.scope;
  const sources = [record.identity];
  return {
    id: record.manifest.id,
    effectiveScope,
    sources,
    knowledgeKey: record.manifest.knowledgeKey,
    canonicalContentDigest: record.manifest.contentDigest,
    resolutionDigest: resolutionDigestV2({
      id: record.manifest.id,
      knowledgeKey: record.manifest.knowledgeKey,
      effectiveScope,
      sources,
      canonicalContentDigests: [record.manifest.contentDigest],
      record,
    }),
    canonicalRecord: record,
  };
}

interface DesiredMaterialization {
  id: string;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: CanonicalKnowledgeIdentity[];
  canonicalContentDigest: string;
  resolutionDigest: string;
  content: string;
}

interface TrackedMaterialization {
  id: string;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: CanonicalKnowledgeIdentity[];
  canonicalContentDigest: string;
  resolutionDigest: string;
  /** Which identity scheme produced `resolutionDigest`. */
  resolutionSchemaVersion: 1 | 2;
  targetPath: string;
  sha256: string;
}

interface CoreReconcile {
  next: TrackedMaterialization[];
  result: LearnedReconcileResult;
}

function outcome(
  item: DesiredMaterialization | TrackedMaterialization,
  targetPath: string
): LearnedMaterializationOutcome {
  return {
    id: item.id,
    effectiveScope: item.effectiveScope,
    sources: item.sources,
    resolutionDigest: item.resolutionDigest,
    targetPath,
  };
}

function writeMaterialized(targetFile: string, content: string): void {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  const temporary = path.join(
    path.dirname(targetFile),
    `.${path.basename(targetFile)}.${process.pid}-${Date.now()}.tmp`
  );
  fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  const backup = `${temporary}.bak`;
  try {
    if (!fs.existsSync(targetFile)) {
      fs.renameSync(temporary, targetFile);
      return;
    }
    fs.renameSync(targetFile, backup);
    try {
      fs.renameSync(temporary, targetFile);
      fs.rmSync(backup, { force: true });
    } catch (error) {
      fs.rmSync(targetFile, { force: true });
      fs.renameSync(backup, targetFile);
      throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/**
 * Removes now-empty directories from `start` up to (but not past) `boundary`.
 * Stops at the first non-empty directory. Cross-platform via `path` primitives.
 */
function removeEmptyDirsUpTo(start: string, boundary: string): void {
  const stop = path.resolve(boundary);
  let current = path.resolve(start);
  while (current !== stop) {
    const relative = path.relative(stop, current);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return;
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** Canonical path equality — case-insensitive on Windows, exact elsewhere. */
function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

interface TargetInspection {
  expectedTarget: string;
  targetDir: string;
  targetDirExists: boolean;
  state: 'missing' | 'file' | 'unsafe';
}

/**
 * Validates the complete managed path below the trusted skills root WITHOUT
 * following a symlink, junction, or other reparse occupant. A write through one
 * of those would clobber whatever it points at — data loss and an escape from
 * the boundary the tool home is supposed to be.
 */
function inspectManagedTarget(
  skillsRoot: string,
  id: string,
  ledgerTarget?: string
): TargetInspection {
  const root = path.resolve(skillsRoot);
  const targetDir = path.resolve(root, id);
  const expectedTarget = path.join(targetDir, LEARNED_SKILL_CONTENT_FILE);
  const relative = path.relative(root, targetDir);
  if (
    !id ||
    relative !== id ||
    path.isAbsolute(relative) ||
    relative.startsWith('..') ||
    relative.includes(path.sep)
  ) {
    return { expectedTarget, targetDir, targetDirExists: false, state: 'unsafe' };
  }
  // The record must claim THIS EXACT path. A ledger entry pointing somewhere
  // else is not ownership of this file, whatever it says about the id.
  if (ledgerTarget !== undefined && !samePath(ledgerTarget, expectedTarget)) {
    return { expectedTarget, targetDir, targetDirExists: false, state: 'unsafe' };
  }
  try {
    const rootStats = fs.lstatSync(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return { expectedTarget, targetDir, targetDirExists: true, state: 'unsafe' };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { expectedTarget, targetDir, targetDirExists: false, state: 'unsafe' };
    }
  }
  let targetDirExists = false;
  try {
    const dirStats = fs.lstatSync(targetDir);
    targetDirExists = true;
    if (!dirStats.isDirectory() || dirStats.isSymbolicLink()) {
      return { expectedTarget, targetDir, targetDirExists, state: 'unsafe' };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { expectedTarget, targetDir, targetDirExists, state: 'unsafe' };
    }
    return { expectedTarget, targetDir, targetDirExists, state: 'missing' };
  }
  try {
    const fileStats = fs.lstatSync(expectedTarget);
    return {
      expectedTarget,
      targetDir,
      targetDirExists,
      state: fileStats.isFile() && !fileStats.isSymbolicLink() ? 'file' : 'unsafe',
    };
  } catch (error) {
    return {
      expectedTarget,
      targetDir,
      targetDirExists,
      state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unsafe',
    };
  }
}

function skippedCollision(
  item: DesiredMaterialization,
  targetFile: string,
  message: string
): LearnedMaterializationSkip {
  return {
    id: item.id,
    effectiveScope: item.effectiveScope,
    sources: item.sources,
    targetPath: targetFile,
    reason: 'collision',
    message,
  };
}

function skippedTracked(
  item: TrackedMaterialization,
  targetFile: string,
  reason: LearnedMaterializationSkip['reason'],
  message: string
): LearnedMaterializationSkip {
  return {
    id: item.id,
    effectiveScope: item.effectiveScope,
    sources: item.sources,
    targetPath: targetFile,
    reason,
    message,
  };
}

function reconcileCore(
  skillsRoot: string,
  desired: readonly DesiredMaterialization[],
  tracked: readonly TrackedMaterialization[],
  toolLabel: string,
  deferredIds: ReadonlySet<string> = new Set()
): CoreReconcile {
  const result = emptyLearnedReconcileResult();
  const next: TrackedMaterialization[] = [];
  const trackedById = new Map(tracked.map((entry) => [entry.id, entry]));
  const desiredIds = new Set(desired.map((entry) => entry.id));

  for (const item of desired) {
    const prior = trackedById.get(item.id);
    const inspected = inspectManagedTarget(skillsRoot, item.id, prior?.targetPath);
    const targetFile = inspected.expectedTarget;
    const desiredSha = digestContent(item.content);

    if (inspected.state === 'unsafe') {
      if (prior) {
        result.skipped.push(
          skippedTracked(
            prior,
            targetFile,
            'ledger-invalid',
            `Skipped learned skill "${item.id}" for ${toolLabel}: its ownership record does not claim the exact safe managed path; the record was preserved for repair.`
          )
        );
        next.push(prior);
        continue;
      }
      result.skipped.push(
        skippedCollision(
          item,
          targetFile,
          `Skipped learned skill "${item.id}" for ${toolLabel}: the target path contains a symlink/junction or non-regular occupant; left unchanged.`
        )
      );
      continue;
    }

    const onDisk = inspected.state === 'file' ? sha256File(targetFile) : null;

    // A relevant Store is unreachable and this record's answer depends on it:
    // keep exactly what is there, and keep claiming it.
    if (
      deferredIds.has(item.id) &&
      prior &&
      (prior.resolutionDigest !== item.resolutionDigest || onDisk !== desiredSha)
    ) {
      next.push(prior);
      continue;
    }

    if (inspected.state === 'missing') {
      if (prior) {
        result.skipped.push(
          skippedTracked(
            prior,
            targetFile,
            'missing',
            `Skipped learned skill "${item.id}" for ${toolLabel}: the previously tracked file is missing; its absence and ownership record were preserved for repair.`
          )
        );
        next.push(prior);
        continue;
      }
      if (inspected.targetDirExists) {
        result.skipped.push(
          skippedCollision(
            item,
            targetFile,
            `Skipped learned skill "${item.id}" for ${toolLabel}: an untracked same-name directory already exists; left unchanged.`
          )
        );
        continue;
      }
      // Re-inspected immediately before writing: the tree may have changed
      // since the inspection above, and creating over a new occupant would be
      // exactly the takeover this module exists to prevent.
      if (inspectManagedTarget(skillsRoot, item.id).state !== 'missing') {
        result.skipped.push(
          skippedCollision(
            item,
            targetFile,
            `Skipped learned skill "${item.id}" for ${toolLabel}: the target path changed during reconciliation; left unchanged.`
          )
        );
        continue;
      }
      writeMaterialized(targetFile, item.content);
      const entry: TrackedMaterialization = {
        id: item.id,
        effectiveScope: item.effectiveScope,
        sources: item.sources,
        canonicalContentDigest: item.canonicalContentDigest,
        resolutionDigest: item.resolutionDigest,
        resolutionSchemaVersion: RESOLUTION_DIGEST_VERSION,
        targetPath: targetFile,
        sha256: desiredSha,
      };
      next.push(entry);
      result.created.push(outcome(entry, targetFile));
      continue;
    }

    const owned =
      prior !== undefined && samePath(prior.targetPath, targetFile) && prior.sha256 === onDisk;
    if (!owned) {
      // A human-authored skill, or a generated copy the user has since edited.
      // Never overwritten, and ownership is never claimed over it.
      result.skipped.push(
        skippedCollision(
          item,
          targetFile,
          `Skipped learned skill "${item.id}" for ${toolLabel}: the target is not the exact copy Rasen generated (human-authored or locally modified); left unchanged.`
        )
      );
      continue;
    }

    if (onDisk === desiredSha && prior.resolutionDigest === item.resolutionDigest) {
      next.push({ ...prior, resolutionSchemaVersion: RESOLUTION_DIGEST_VERSION });
      continue;
    }
    if (inspectManagedTarget(skillsRoot, item.id, prior.targetPath).state !== 'file') {
      result.skipped.push(
        skippedCollision(
          item,
          targetFile,
          `Skipped refreshing learned skill "${item.id}" for ${toolLabel}: its target path changed or became unsafe; left unchanged.`
        )
      );
      next.push(prior);
      continue;
    }

    // The identity SCHEME changed, and the knowledge itself did not. Reported
    // as a migration: telling a user their whole catalog was edited on their
    // first run after an upgrade would be false, and would send them looking
    // for a change nobody made.
    const schemeMigration =
      prior.resolutionSchemaVersion !== RESOLUTION_DIGEST_VERSION &&
      prior.canonicalContentDigest === item.canonicalContentDigest;

    writeMaterialized(targetFile, item.content);
    const entry: TrackedMaterialization = {
      id: item.id,
      effectiveScope: item.effectiveScope,
      sources: item.sources,
      canonicalContentDigest: item.canonicalContentDigest,
      resolutionDigest: item.resolutionDigest,
      resolutionSchemaVersion: RESOLUTION_DIGEST_VERSION,
      targetPath: targetFile,
      sha256: desiredSha,
    };
    next.push(entry);
    (schemeMigration ? result.migrated : result.updated).push(outcome(entry, targetFile));
  }

  for (const entry of tracked) {
    if (desiredIds.has(entry.id)) continue;
    if (deferredIds.has(entry.id)) {
      next.push(entry);
      continue;
    }
    const inspected = inspectManagedTarget(skillsRoot, entry.id, entry.targetPath);
    if (inspected.state === 'unsafe') {
      result.skipped.push(
        skippedTracked(
          entry,
          inspected.expectedTarget,
          'ledger-invalid',
          `Skipped removing learned skill "${entry.id}" for ${toolLabel}: its ownership record does not claim the exact safe managed path; the record was preserved for repair.`
        )
      );
      next.push(entry);
      continue;
    }
    const onDisk = inspected.state === 'file' ? sha256File(inspected.expectedTarget) : null;
    if (onDisk !== null && onDisk === entry.sha256) {
      const rechecked = inspectManagedTarget(skillsRoot, entry.id, entry.targetPath);
      if (rechecked.state !== 'file' || sha256File(rechecked.expectedTarget) !== entry.sha256) {
        result.skipped.push(
          skippedTracked(
            entry,
            rechecked.expectedTarget,
            'collision',
            `Skipped removing learned skill "${entry.id}" for ${toolLabel}: its target changed during reconciliation; left unchanged.`
          )
        );
        next.push(entry);
        continue;
      }
      fs.rmSync(rechecked.expectedTarget, { force: true });
      removeEmptyDirsUpTo(path.dirname(rechecked.expectedTarget), skillsRoot);
      result.removed.push(outcome(entry, rechecked.expectedTarget));
    } else if (inspected.state === 'missing') {
      result.skipped.push(
        skippedTracked(
          entry,
          inspected.expectedTarget,
          'missing',
          `Stopped tracking obsolete learned skill "${entry.id}" for ${toolLabel}: its managed file was already missing.`
        )
      );
    } else {
      result.skipped.push(
        skippedTracked(
          entry,
          inspected.expectedTarget,
          'collision',
          `Stopped tracking obsolete learned skill "${entry.id}" for ${toolLabel}: its bytes no longer match the generated copy; left unchanged.`
        )
      );
    }
  }
  return { next, result };
}

function desiredFromPlan(plan: EffectiveLearnedSkillPlan): DesiredMaterialization[] {
  return plan.skills.map((skill) => ({
    id: skill.id,
    effectiveScope: skill.effectiveScope,
    sources: skill.sources,
    canonicalContentDigest: skill.canonicalContentDigest,
    resolutionDigest: skill.resolutionDigest,
    content: renderMaterializedSkill(skill),
  }));
}

/**
 * The Store snapshot, keyed on PERMANENT identity. A Store with no permanent
 * identity contributes no fact at all — a fact keyed on a display name is the
 * record this release exists to stop writing.
 */
function storeSnapshot(plan: EffectiveLearnedSkillPlan): Record<string, ProjectLearnedStoreFact> {
  const snapshot: Record<string, ProjectLearnedStoreFact> = {};
  for (const fact of plan.stores) {
    const uid = fact.store.uid;
    if (uid === undefined) continue;
    snapshot[uid] = {
      lastMembership: fact.status,
      ...(fact.status === 'unavailable' ? { relevant: fact.relevant } : {}),
      ...(fact.store.id !== undefined ? { id: fact.store.id } : {}),
    };
  }
  return snapshot;
}

function typedTracked(
  projectRoot: string,
  entries: Record<string, ProjectLearnedArtifactEntry>
): TrackedMaterialization[] {
  const tracked: TrackedMaterialization[] = [];
  for (const [id, entry] of Object.entries(entries)) {
    const targetPath = resolveArtifactFile(projectRoot, entry.file);
    if (targetPath === null) continue;
    tracked.push({
      id,
      effectiveScope: entry.effectiveScope,
      sources: entry.sources,
      canonicalContentDigest: entry.canonicalContentDigest,
      resolutionDigest: entry.resolutionDigest,
      resolutionSchemaVersion: entry.resolutionSchemaVersion,
      targetPath,
      sha256: entry.file.sha256,
    });
  }
  return tracked.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Adopts ownership recorded by the pre-effective ledger.
 *
 * Write-new-before-clear: the durable record is written first, and only the
 * duplicate legacy section is then cleared. A legacy entry whose file no longer
 * matches is NOT claimed — adopting a file whose bytes have changed would be
 * claiming ownership of something the user now owns.
 */
function migrateLegacyToolEntries(
  projectRoot: string,
  projectId: string,
  toolId: string,
  stores: Record<string, ProjectLearnedStoreFact>
): Record<string, ProjectLearnedArtifactEntry> {
  const existing = readProjectLearnedLedger(projectRoot)?.tools[toolId]?.learned;
  const legacy = readToolLearnedArtifacts(projectRoot, toolId);
  if (Object.keys(legacy).length === 0) return existing ?? {};
  if (existing !== undefined) {
    // The durable record is authoritative; only the duplicate legacy
    // representation is cleared, idempotently.
    persistToolLearnedArtifacts(projectRoot, toolId, {});
    return existing;
  }
  const migrated: Record<string, ProjectLearnedArtifactEntry> = {};
  for (const [id, entry] of Object.entries(legacy)) {
    const targetPath = resolveArtifactFile(projectRoot, entry.file);
    if (!targetPath || sha256File(targetPath) !== entry.file.sha256) continue;
    const owner =
      entry.skillScope === 'global'
        ? ({ type: 'global' } as const)
        : ({ type: 'project', projectId } as const);
    migrated[id] = {
      effectiveScope: entry.skillScope,
      sources: [{ owner, id }],
      canonicalContentDigest: entry.contentDigest,
      // The legacy ledger recorded no resolution identity at all; its content
      // digest is the only stable value it had. Marked as scheme 1 so the very
      // next reconciliation reports the rewrite as the migration it is.
      resolutionDigest: entry.contentDigest,
      resolutionSchemaVersion: 1,
      file: entry.file,
    };
  }
  persistProjectLearnedArtifacts(projectRoot, toolId, migrated, stores);
  persistToolLearnedArtifacts(projectRoot, toolId, {});
  return migrated;
}

function planDiagnostics(plan: EffectiveLearnedSkillPlan): LearnedReconcileResult {
  const result = emptyLearnedReconcileResult();
  result.planStatus = plan.status;
  result.conflicts = plan.conflicts;
  result.unavailableStores = plan.unavailableStores;
  result.budgetFailure = plan.budgetFailure;
  result.errors.push(...plan.planningErrors);
  result.deduplicated = plan.skills
    .filter((skill) => skill.effectiveScope === 'store' && skill.sources.length > 1)
    .map((skill) => ({ id: skill.id, sources: skill.sources }));
  return result;
}

/**
 * Which ids must not be touched because a RELEVANT Store is unreachable, and
 * the deferred action each one stands for.
 *
 * The rule is narrow on purpose. A project winner is authoritative without
 * consulting any Store, so it is never deferred; a record whose resolved answer
 * is unchanged needs no action to defer. What is left is exactly the case that
 * matters: an answer that would change, or a file that would be deleted,
 * because a Store that may still be contributing could not be read.
 */
function deferredForOutages(
  plan: EffectiveLearnedSkillPlan,
  tracked: readonly TrackedMaterialization[],
  desired: readonly DesiredMaterialization[]
): { ids: Set<string>; actions: LearnedDeferredAction[] } {
  const relevantUnavailable = plan.unavailableStores.filter((store) => store.relevant);
  const unavailableKeys = new Set(relevantUnavailable.map((store) => storeKey(store.store)));
  const desiredById = new Map(desired.map((item) => [item.id, item]));
  const ids = new Set<string>();
  const actions: LearnedDeferredAction[] = [];

  for (const prior of tracked) {
    const next = desiredById.get(prior.id);
    if (next?.effectiveScope === 'project') continue;
    if (next && next.resolutionDigest === prior.resolutionDigest) continue;
    const priorStores = prior.sources
      .filter((source) => source.owner.type === 'store')
      .map((source) => source.owner as { type: 'store'; uid: string; id?: string })
      .filter((owner) => unavailableKeys.has(storeKey(owner)));
    const stores = uniqueBy(
      [...priorStores, ...relevantUnavailable.map((store) => store.store)],
      storeKey
    ).sort((left, right) => storeKey(left).localeCompare(storeKey(right)));
    if (stores.length === 0) continue;
    ids.add(prior.id);
    const action = next ? 'replace' : 'remove';
    actions.push({
      id: prior.id,
      action,
      stores,
      message: deferredMessage(action, prior.id, stores),
    });
  }
  return { ids, actions };
}

/**
 * Reconciles the resolved set into one project-local tool home.
 *
 * Files land in the checkout the session is working in — `plan.evaluationRoot`
 * decided that, and the canonical stored copy under the project's knowledge
 * home is never touched here.
 */
export function reconcileProjectLearnedSkillsForTool(params: {
  toolId: string;
  toolLabel: string;
  skillsRoot: string;
  plan: EffectiveLearnedSkillPlan;
}): LearnedReconcileResult {
  const { toolId, toolLabel, skillsRoot, plan } = params;
  // The ownership record lives beside the files it claims, which is the
  // checkout being worked on — never the project's knowledge storage location.
  const projectRoot = plan.evaluationRoot;
  const aggregate = planDiagnostics(plan);
  // A blocking conflict or budget failure writes NOTHING: no file, no
  // ownership record, not even the legacy-ledger migration or a prune.
  if (plan.status === 'blocked') {
    sortResult(aggregate);
    finalizeNoOp(aggregate);
    return aggregate;
  }

  const stores = storeSnapshot(plan);
  let entries: Record<string, ProjectLearnedArtifactEntry>;
  try {
    entries = migrateLegacyToolEntries(projectRoot, plan.project.id, toolId, stores);
  } catch (error) {
    // Ownership that cannot be trusted is ownership that cannot be acted on.
    // An unreadable record, or one still naming its sources by a display name,
    // stops reconciliation here and REPORTS — writing over files whose owner
    // is in doubt is the damage the whole exact-ownership rule exists to
    // prevent, and the report carries the command that repairs it.
    aggregate.errors.push({
      code: error instanceof ProjectLearnedLedgerError ? error.code : 'learned_ledger_unusable',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof ProjectLearnedLedgerError && error.repair.length > 0
        ? { repair: error.repair }
        : {}),
    });
    sortResult(aggregate);
    finalizeNoOp(aggregate);
    return aggregate;
  }
  const tracked = typedTracked(projectRoot, entries);
  const desired = desiredFromPlan(plan);
  const deferred = deferredForOutages(plan, tracked, desired);
  aggregate.deferred.push(...deferred.actions);
  const { next, result } = reconcileCore(skillsRoot, desired, tracked, toolLabel, deferred.ids);
  mergeLearnedReconcileResult(aggregate, result);

  const learned: Record<string, ProjectLearnedArtifactEntry> = {};
  for (const entry of next) {
    learned[entry.id] = {
      effectiveScope: entry.effectiveScope,
      sources: entry.sources,
      canonicalContentDigest: entry.canonicalContentDigest,
      resolutionDigest: entry.resolutionDigest,
      resolutionSchemaVersion: entry.resolutionSchemaVersion,
      file: { ...storedArtifactFile(projectRoot, entry.targetPath), sha256: entry.sha256 },
    };
  }
  persistProjectLearnedArtifacts(projectRoot, toolId, learned, stores);
  sortResult(aggregate);
  finalizeNoOp(aggregate);
  return aggregate;
}

function globalDesired(records: readonly CanonicalLearnedSkill[]): DesiredMaterialization[] {
  return records
    .filter((record) => record.manifest.status === 'active')
    .map((record) => {
      const skill = effectiveFromCanonical(record);
      return {
        id: skill.id,
        effectiveScope: 'global' as const,
        sources: skill.sources,
        canonicalContentDigest: skill.canonicalContentDigest,
        resolutionDigest: skill.resolutionDigest,
        content: renderMaterializedSkill(skill),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Reconciles a MACHINE-WIDE tool home.
 *
 * It receives machine-wide knowledge only. The directory is shared by every
 * project on the machine, so a project's or a Store's record written here would
 * install one project's decision for all of them — and one project's
 * applicability result could then delete a copy another project relies on.
 * Every non-global record the project resolved is reported as skipped rather
 * than silently dropped.
 */
export function reconcileGlobalLearnedSkillsForTool(params: {
  toolId: string;
  toolLabel: string;
  skillsRoot: string;
  globalRecords: readonly CanonicalLearnedSkill[];
  localRecords?: readonly EffectiveLearnedSkill[];
  plan?: EffectiveLearnedSkillPlan;
  globalDataDir?: string;
}): LearnedReconcileResult {
  const {
    toolId,
    toolLabel,
    skillsRoot,
    globalRecords,
    localRecords = [],
    plan,
    globalDataDir,
  } = params;
  const aggregate = plan ? planDiagnostics(plan) : emptyLearnedReconcileResult();
  if (plan?.status === 'blocked') {
    sortResult(aggregate);
    finalizeNoOp(aggregate);
    return aggregate;
  }

  const desired = globalDesired(globalRecords);
  const tracked: TrackedMaterialization[] = [];
  for (const [id, entry] of Object.entries(readGlobalLearnedArtifacts(globalDataDir, toolId))) {
    tracked.push({
      id,
      effectiveScope: 'global',
      sources: entry.sources,
      canonicalContentDigest: entry.canonicalContentDigest,
      resolutionDigest: entry.resolutionDigest,
      resolutionSchemaVersion: entry.resolutionSchemaVersion,
      targetPath: entry.path,
      sha256: entry.sha256,
    });
  }
  const { next, result } = reconcileCore(skillsRoot, desired, tracked, toolLabel);
  mergeLearnedReconcileResult(aggregate, result);

  for (const record of localRecords.filter((item) => item.effectiveScope !== 'global')) {
    aggregate.skipped.push({
      id: record.id,
      effectiveScope: record.effectiveScope,
      sources: record.sources,
      reason: 'global-only-home',
      message: `Skipped ${record.effectiveScope}-scoped learned skill "${record.id}" for ${toolLabel}: a machine-wide skill home accepts machine-wide knowledge only.`,
    });
  }

  const learned: Record<string, GlobalLearnedArtifactEntry> = {};
  for (const entry of next) {
    if (
      entry.effectiveScope !== 'global' ||
      entry.sources.some((source) => source.owner.type !== 'global')
    ) {
      throw new Error('The machine-wide learned ledger refused a non-machine-wide source.');
    }
    learned[entry.id] = {
      effectiveScope: 'global',
      sources: entry.sources.map((source) => ({
        owner: { type: 'global' as const },
        id: source.id,
      })),
      canonicalContentDigest: entry.canonicalContentDigest,
      resolutionDigest: entry.resolutionDigest,
      resolutionSchemaVersion: entry.resolutionSchemaVersion,
      path: entry.targetPath,
      sha256: entry.sha256,
    };
  }
  persistGlobalLearnedArtifacts(globalDataDir, toolId, learned);
  sortResult(aggregate);
  finalizeNoOp(aggregate);
  return aggregate;
}

function sortResult(result: LearnedReconcileResult): void {
  const byId = <T extends { id: string; targetPath?: string }>(left: T, right: T): number => {
    const id = left.id.localeCompare(right.id);
    return id !== 0 ? id : (left.targetPath ?? '').localeCompare(right.targetPath ?? '');
  };
  result.created.sort(byId);
  result.updated.sort(byId);
  result.migrated.sort(byId);
  result.removed.sort(byId);
  result.skipped.sort(byId);
  result.deduplicated.sort(byId);
  result.conflicts.sort((left, right) => {
    const id = left.id.localeCompare(right.id);
    return id !== 0 ? id : left.kind.localeCompare(right.kind);
  });
  result.unavailableStores.sort((left, right) =>
    storeKey(left.store).localeCompare(storeKey(right.store))
  );
  result.deferred.sort((left, right) => {
    const id = left.id.localeCompare(right.id);
    return id !== 0 ? id : left.action.localeCompare(right.action);
  });
}

// Re-exported so tests can assert on-disk machine-wide copies.
export { sha256GlobalFile, sourceKey };
