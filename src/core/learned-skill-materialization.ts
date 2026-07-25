/**
 * Effective learned-skill materialization. Planning is a read-only preflight;
 * this module is the sole target/ledger mutation seam.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { quoteYamlValue } from './shared/yaml.js';
import {
  digestContent,
  LEARNED_SKILL_GENERATED_BY,
  type CanonicalKnowledgeIdentity,
  type CanonicalLearnedSkill,
  type EffectiveDescriptionBudgetFailure,
  type EffectiveLearnedSkill,
  type EffectiveLearnedSkillPlan,
  type EffectiveLearnedSkillScope,
  type EffectiveStoreUnavailableFact,
  type StoreSkillConflict,
} from './learned-skills/index.js';
import {
  persistToolLearnedArtifacts,
  readToolLearnedArtifacts,
  resolveArtifactFile,
  sha256File,
  storedArtifactFile,
} from './workflow-artifact-ledger.js';
import {
  persistProjectLearnedArtifacts,
  readProjectLearnedArtifacts,
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

export interface LearnedMaterializationOutcome {
  id: string;
  /** Compatibility field retained in the public result wire shape. */
  skillScope: EffectiveLearnedSkillScope;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: CanonicalKnowledgeIdentity[];
  resolutionDigest: string;
  targetPath: string;
}

export interface LearnedMaterializationSkip {
  id: string;
  skillScope: EffectiveLearnedSkillScope;
  effectiveScope: EffectiveLearnedSkillScope;
  sources: CanonicalKnowledgeIdentity[];
  targetPath?: string;
  reason: 'collision' | 'global-only-home' | 'ledger-invalid' | 'missing';
  message: string;
}

export interface LearnedDeduplication {
  id: string;
  sources: CanonicalKnowledgeIdentity[];
}

export interface LearnedDeferredAction {
  id: string;
  action: 'remove' | 'replace';
  stores: Array<{ type: 'store'; id: string }>;
  message: string;
}

export interface LearnedReconcileResult {
  /** True only when learned reconciliation was complete and made no changes. */
  noOp: boolean;
  created: LearnedMaterializationOutcome[];
  updated: LearnedMaterializationOutcome[];
  removed: LearnedMaterializationOutcome[];
  skipped: LearnedMaterializationSkip[];
  deduplicated: LearnedDeduplication[];
  conflicts: StoreSkillConflict[];
  unavailableStores: EffectiveStoreUnavailableFact[];
  deferred: LearnedDeferredAction[];
  errors: Array<{ code: string; message: string }>;
  budgetFailure?: EffectiveDescriptionBudgetFailure;
  planStatus?: EffectiveLearnedSkillPlan['status'];
}

export function emptyLearnedReconcileResult(): LearnedReconcileResult {
  return {
    noOp: false,
    created: [],
    updated: [],
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
  return result.created.length > 0 || result.updated.length > 0 || result.removed.length > 0;
}

function identityKey(identity: CanonicalKnowledgeIdentity): string {
  return identity.owner.type === 'global'
    ? `global:/${identity.id}`
    : `${identity.owner.type}:${identity.owner.id}/${identity.id}`;
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
  into.removed.push(...from.removed);
  into.skipped.push(...from.skipped);
  into.deduplicated = uniqueBy(
    [...into.deduplicated, ...from.deduplicated],
    (item) => item.id
  );
  into.conflicts = uniqueBy(
    [...into.conflicts, ...from.conflicts],
    (item) => `${item.kind}:${item.id}`
  );
  into.unavailableStores = uniqueBy(
    [...into.unavailableStores, ...from.unavailableStores],
    (item) => item.store.id
  );
  into.deferred = mergeDeferredActions([...into.deferred, ...from.deferred]);
  into.errors = uniqueBy([...into.errors, ...from.errors], (item) => `${item.code}:${item.message}`);
  into.budgetFailure ??= from.budgetFailure;
  into.planStatus ??= from.planStatus;
  sortResult(into);
  finalizeNoOp(into);
}

function mergeDeferredActions(
  actions: readonly LearnedDeferredAction[]
): LearnedDeferredAction[] {
  const grouped = new Map<string, LearnedDeferredAction>();
  for (const action of actions) {
    const key = `${action.action}:${action.id}`;
    const current = grouped.get(key);
    const stores = uniqueBy(
      [...(current?.stores ?? []), ...action.stores],
      (store) => store.id
    ).sort((left, right) => left.id.localeCompare(right.id));
    grouped.set(key, {
      id: action.id,
      action: action.action,
      stores,
      message: `Deferred ${action.action} for "${action.id}" because relevant unavailable sources ${stores
        .map((store) => `store:${store.id}`)
        .join(', ')} may still contribute.`,
    });
  }
  return [...grouped.values()];
}

function finalizeNoOp(result: LearnedReconcileResult): void {
  result.noOp =
    result.planStatus !== 'blocked' &&
    !learnedReconcileHasActivity(result);
}

function stripFrontmatter(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(content);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

function quoteSources(sources: readonly CanonicalKnowledgeIdentity[]): string {
  return sources
    .map(identityKey)
    .sort()
    .join(',');
}

/** Render declarative managed output with stable typed effective provenance. */
export function renderMaterializedSkill(
  input: CanonicalLearnedSkill | EffectiveLearnedSkill
): string {
  const effective =
    'canonicalRecord' in input
      ? input
      : {
          id: input.manifest.id,
          effectiveScope: input.scope as EffectiveLearnedSkillScope,
          sources: [input.identity],
          knowledgeKey: input.manifest.knowledgeKey,
          canonicalContentDigest: input.manifest.contentDigest,
          resolutionDigest: digestContent(
            JSON.stringify({
              id: input.manifest.id,
              effectiveScope: input.scope,
              sources: [input.identity],
              knowledgeKey: input.manifest.knowledgeKey,
              canonicalContentDigest: input.manifest.contentDigest,
              content: input.content,
            })
          ),
          canonicalRecord: input,
        };
  const record = effective.canonicalRecord;
  const body = stripFrontmatter(record.content);
  return [
    '---',
    `name: ${quoteYamlValue(effective.id)}`,
    `description: ${quoteYamlValue(record.manifest.description)}`,
    'license: MIT',
    'compatibility: Requires rasen CLI.',
    'metadata:',
    '  author: rasen',
    `  generatedBy: ${quoteYamlValue(LEARNED_SKILL_GENERATED_BY)}`,
    `  learnedSkillScope: ${quoteYamlValue(effective.effectiveScope)}`,
    `  learnedSkillId: ${quoteYamlValue(effective.id)}`,
    `  learnedSkillSources: ${quoteYamlValue(quoteSources(effective.sources))}`,
    `  contentDigest: ${quoteYamlValue(effective.canonicalContentDigest)}`,
    `  resolutionDigest: ${quoteYamlValue(effective.resolutionDigest)}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
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
  targetPath: string;
  sha256: string;
}

interface CoreReconcile {
  next: TrackedMaterialization[];
  result: LearnedReconcileResult;
}

function outcome(item: DesiredMaterialization | TrackedMaterialization): LearnedMaterializationOutcome {
  return {
    id: item.id,
    skillScope: item.effectiveScope,
    effectiveScope: item.effectiveScope,
    sources: item.sources,
    resolutionDigest: item.resolutionDigest,
    targetPath: 'targetPath' in item ? item.targetPath : '',
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

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

interface TargetInspection {
  expectedTarget: string;
  targetDir: string;
  targetDirExists: boolean;
  state: 'missing' | 'file' | 'unsafe';
}

/**
 * Validate the complete managed path below the trusted skills root without
 * following a symlink/junction/reparse occupant.
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
      state:
        fileStats.isFile() && !fileStats.isSymbolicLink()
          ? 'file'
          : 'unsafe',
    };
  } catch (error) {
    return {
      expectedTarget,
      targetDir,
      targetDirExists,
      state:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'missing'
          : 'unsafe',
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
    skillScope: item.effectiveScope,
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
    skillScope: item.effectiveScope,
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
    const targetDir = inspected.targetDir;
    const targetFile = inspected.expectedTarget;
    const desiredSha = digestContent(item.content);
    if (prior && inspected.state === 'unsafe') {
      result.skipped.push(
        skippedTracked(
          prior,
          targetFile,
          'ledger-invalid',
          `Skipped learned skill "${item.id}" for ${toolLabel}: its ledger target is not the exact safe managed path; ownership was preserved for repair.`
        )
      );
      next.push(prior);
      continue;
    }
    if (!prior && inspected.state === 'unsafe') {
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
        targetPath: targetFile,
        sha256: desiredSha,
      };
      next.push(entry);
      result.created.push(outcome(entry));
      continue;
    }

    const owned =
      prior !== undefined &&
      samePath(prior.targetPath, targetFile) &&
      prior.sha256 === onDisk;
    if (!owned) {
      result.skipped.push(
        skippedCollision(
          item,
          targetFile,
          `Skipped learned skill "${item.id}" for ${toolLabel}: the target is not the exact copy Rasen generated; left unchanged.`
        )
      );
      continue;
    }
    if (onDisk === desiredSha && prior.resolutionDigest === item.resolutionDigest) {
      next.push(prior);
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
    writeMaterialized(targetFile, item.content);
    const entry: TrackedMaterialization = {
      id: item.id,
      effectiveScope: item.effectiveScope,
      sources: item.sources,
      canonicalContentDigest: item.canonicalContentDigest,
      resolutionDigest: item.resolutionDigest,
      targetPath: targetFile,
      sha256: desiredSha,
    };
    next.push(entry);
    result.updated.push(outcome(entry));
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
          `Skipped removing learned skill "${entry.id}" for ${toolLabel}: its ledger target is not the exact safe managed path; ownership was preserved for repair.`
        )
      );
      next.push(entry);
      continue;
    }
    const onDisk =
      inspected.state === 'file'
        ? sha256File(inspected.expectedTarget)
        : null;
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
      result.removed.push(outcome(entry));
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

function storeSnapshot(plan: EffectiveLearnedSkillPlan): Record<string, ProjectLearnedStoreFact> {
  return Object.fromEntries(
    plan.stores.map((fact) => [
      fact.store.id,
      fact.status === 'unavailable'
        ? { lastMembership: 'unavailable' as const, relevant: fact.relevant }
        : { lastMembership: fact.status },
    ])
  );
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
      targetPath,
      sha256: entry.file.sha256,
    });
  }
  return tracked.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Write-new-before-clear migration. Modified/unsafe legacy files are not
 * claimed. If both ledgers exist, the typed ledger is authoritative and the
 * duplicate legacy section is cleared idempotently.
 */
function migrateLegacyToolEntries(
  projectRoot: string,
  projectId: string,
  toolId: string,
  stores: Record<string, ProjectLearnedStoreFact>
): Record<string, ProjectLearnedArtifactEntry> {
  const existingLedger = readProjectLearnedLedger(projectRoot);
  const existing = existingLedger?.tools[toolId]?.learned;
  const legacy = readToolLearnedArtifacts(projectRoot, toolId);
  if (Object.keys(legacy).length === 0) return existing ?? {};
  if (existing !== undefined) {
    // New ledger is authoritative; only the duplicate legacy representation is cleared.
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
        : ({ type: 'project', id: projectId } as const);
    migrated[id] = {
      effectiveScope: entry.skillScope,
      sources: [{ owner, id }],
      canonicalContentDigest: entry.contentDigest,
      resolutionDigest: digestContent(
        JSON.stringify({
          legacy: true,
          id,
          effectiveScope: entry.skillScope,
          owner,
          canonicalContentDigest: entry.contentDigest,
        })
      ),
      file: entry.file,
    };
  }
  // Durable typed ownership first, then remove only the legacy learned section.
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

function unavailableSourceIds(
  plan: EffectiveLearnedSkillPlan,
  tracked: readonly TrackedMaterialization[],
  desired: readonly DesiredMaterialization[]
): { ids: Set<string>; actions: LearnedDeferredAction[] } {
  const unavailable = new Set(plan.unavailableStores.map((store) => store.store.id));
  const relevantUnavailable = plan.unavailableStores
    .filter((store) => store.relevant || store.relevance.length > 0)
    .map((store) => store.store.id);
  const desiredById = new Map(desired.map((item) => [item.id, item]));
  const ids = new Set<string>();
  const actions: LearnedDeferredAction[] = [];
  for (const prior of tracked) {
    const priorStores = prior.sources
      .filter(
        (source): source is CanonicalKnowledgeIdentity & { owner: { type: 'store'; id: string } } =>
          source.owner.type === 'store' && unavailable.has(source.owner.id)
      )
      .map((source) => source.owner.id);
    const next = desiredById.get(prior.id);
    // A project winner is authoritative without inspecting a lower store layer.
    if (next?.effectiveScope === 'project') continue;
    if (next && next.resolutionDigest === prior.resolutionDigest) continue;
    const stores = [...new Set([...priorStores, ...relevantUnavailable])]
      .sort()
      .map((id) => ({ type: 'store' as const, id }));
    if (stores.length === 0) continue;
    ids.add(prior.id);
    const action = next ? 'replace' : 'remove';
    actions.push({
      id: prior.id,
      action,
      stores,
      message: `Deferred ${action} for "${prior.id}" because relevant unavailable sources ${stores
        .map((store) => `store:${store.id}`)
        .join(', ')} may still contribute.`,
    });
  }
  return { ids, actions };
}

export function reconcileProjectLearnedSkillsForTool(params: {
  projectRoot: string;
  toolId: string;
  toolLabel: string;
  skillsRoot: string;
  plan: EffectiveLearnedSkillPlan;
}): LearnedReconcileResult {
  const { toolId, toolLabel, skillsRoot, plan } = params;
  // The typed execution owner is authoritative; a caller path is never allowed
  // to relocate learned ownership or its ledger.
  const projectRoot = plan.project.root;
  const aggregate = planDiagnostics(plan);
  // Known effective conflict/budget failure: no learned file or ledger write,
  // including migration and pruning.
  if (plan.status === 'blocked') return aggregate;

  const stores = storeSnapshot(plan);
  const entries = migrateLegacyToolEntries(projectRoot, plan.project.id, toolId, stores);
  const tracked = typedTracked(projectRoot, entries);
  const desired = desiredFromPlan(plan);
  const deferred = unavailableSourceIds(plan, tracked, desired);
  aggregate.deferred.push(...deferred.actions);
  const { next, result } = reconcileCore(
    skillsRoot,
    desired,
    tracked,
    toolLabel,
    deferred.ids
  );
  mergeLearnedReconcileResult(aggregate, result);

  const learned: Record<string, ProjectLearnedArtifactEntry> = {};
  for (const entry of next) {
    learned[entry.id] = {
      effectiveScope: entry.effectiveScope,
      sources: entry.sources,
      canonicalContentDigest: entry.canonicalContentDigest,
      resolutionDigest: entry.resolutionDigest,
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
      const sources = [{ owner: { type: 'global' as const }, id: record.manifest.id }];
      const resolutionDigest = digestContent(
        JSON.stringify({
          id: record.manifest.id,
          effectiveScope: 'global',
          sources,
          knowledgeKey: record.manifest.knowledgeKey,
          canonicalContentDigest: record.manifest.contentDigest,
          content: record.content,
        })
      );
      const skill: EffectiveLearnedSkill = {
        id: record.manifest.id,
        effectiveScope: 'global',
        sources,
        knowledgeKey: record.manifest.knowledgeKey,
        canonicalContentDigest: record.manifest.contentDigest,
        resolutionDigest,
        canonicalRecord: record,
      };
      return {
        id: skill.id,
        effectiveScope: 'global' as const,
        sources,
        canonicalContentDigest: skill.canonicalContentDigest,
        resolutionDigest,
        content: renderMaterializedSkill(skill),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Global-only reconciliation is independent from project applicability,
 * membership, degradation, and project-local conflicts.
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
  const desired = globalDesired(globalRecords);
  const tracked: TrackedMaterialization[] = [];
  for (const [id, entry] of Object.entries(readGlobalLearnedArtifacts(globalDataDir, toolId))) {
    tracked.push({
      id,
      effectiveScope: 'global',
      sources: entry.sources,
      canonicalContentDigest: entry.canonicalContentDigest,
      resolutionDigest: entry.resolutionDigest,
      targetPath: entry.path,
      sha256: entry.sha256,
    });
  }
  const { next, result } = reconcileCore(skillsRoot, desired, tracked, toolLabel);
  mergeLearnedReconcileResult(aggregate, result);
  for (const record of localRecords.filter((record) => record.effectiveScope !== 'global')) {
    aggregate.skipped.push({
      id: record.id,
      skillScope: record.effectiveScope,
      effectiveScope: record.effectiveScope,
      sources: record.sources,
      reason: 'global-only-home',
      message: `Skipped ${record.effectiveScope}-scoped learned skill "${record.id}" for ${toolLabel}: global-only homes accept global knowledge only.`,
    });
  }
  const learned: Record<string, GlobalLearnedArtifactEntry> = {};
  for (const entry of next) {
    if (entry.effectiveScope !== 'global' || entry.sources.some((source) => source.owner.type !== 'global')) {
      throw new Error('Machine-global learned ledger rejected a non-global source.');
    }
    learned[entry.id] = {
      effectiveScope: 'global',
      sources: entry.sources as Array<{ owner: { type: 'global' }; id: string }>,
      canonicalContentDigest: entry.canonicalContentDigest,
      resolutionDigest: entry.resolutionDigest,
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
  const byId = <T extends { id: string; targetPath?: string }>(
    left: T,
    right: T
  ): number => {
    const id = left.id.localeCompare(right.id);
    return id !== 0
      ? id
      : (left.targetPath ?? '').localeCompare(right.targetPath ?? '');
  };
  result.created.sort(byId);
  result.updated.sort(byId);
  result.removed.sort(byId);
  result.skipped.sort(byId);
  result.deduplicated.sort(byId);
  result.conflicts.sort((left, right) => {
    const id = left.id.localeCompare(right.id);
    return id !== 0 ? id : left.kind.localeCompare(right.kind);
  });
  result.unavailableStores.sort((left, right) => left.store.id.localeCompare(right.store.id));
  result.deferred.sort((left, right) => {
    const id = left.id.localeCompare(right.id);
    return id !== 0 ? id : left.action.localeCompare(right.action);
  });
}

export { sha256GlobalFile };
