/**
 * Validate, plan, preview, and transactionally import one portable project
 * knowledge bundle.
 *
 * The bundle reader is the sole untrusted-input parser. This module adds only
 * target-dependent validation and an add-only catalog transaction. Preview
 * and apply share the same immutable plan; apply re-computes that plan under
 * the canonical project's existing owner lock before it creates staging.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ZodError } from 'zod';

import {
  resolveProjectSelector,
  type ResolvedProject,
} from '../config-api/project-addressing.js';
import {
  acquireOwnerAwareFileLock,
  releaseOwnerAwareFileLock,
  type FileLockErrorInfo,
  type FileLockErrorKind,
} from '../file-state.js';
import {
  digestContent,
  normalizeEvidence,
  readCanonicalRecord,
  serializeManifest,
  type CanonicalRecordRead,
} from '../learned-skills/catalog.js';
import {
  LEARNED_SKILL_CONTENT_FILE,
  LEARNED_SKILL_GENERATED_BY,
  LEARNED_SKILL_MANIFEST_FILE,
  LEARNED_SKILL_MANIFEST_VERSION,
} from '../learned-skills/constants.js';
import {
  checkLearnedSkillId,
  learnedSkillIdCollisionKey,
} from '../learned-skills/id.js';
import { LearnedSkillManifestSchema } from '../learned-skills/schema.js';
import {
  canonicalPathsEqual,
  learnedSkillDir,
  resolveCanonicalStore,
  type ResolvedStore,
} from '../learned-skills/stores.js';
import type {
  LearnedSkillContext,
  LearnedSkillManifestV2,
} from '../learned-skills/types.js';
import {
  KnowledgeBundleMachinePathError,
  UnsupportedKnowledgeBundleVersionError,
  readKnowledgeBundle,
  type KnowledgeBundle,
  type KnowledgeBundleRecord,
} from './schema.js';

export const KNOWLEDGE_BUNDLE_IMPORT_STAGING_PREFIX =
  '.rasen-knowledge-bundle-import-' as const;

export type KnowledgeBundleImportState = 'previewed' | 'imported';
export type KnowledgeBundleImportWarningCode =
  | 'base_project_commit_provenance'
  | 'base_project_commit_unavailable'
  | 'staging_cleanup_deferred';

export interface KnowledgeBundleImportWarning {
  code: KnowledgeBundleImportWarningCode;
  baseProjectCommit: string | null;
}

export interface KnowledgeBundleImportRecordSummary {
  id: string;
  knowledgeKey: string;
  status: 'active' | 'retired';
  contentDigest: string;
}

export interface KnowledgeBundleImportConflict {
  id: string;
  knowledgeKey: string;
  reason: 'content-differs' | 'lifecycle-differs' | 'target-occupied';
  bundle: {
    contentDigest: string;
    status: 'active' | 'retired';
  };
  local:
    | {
        kind: 'managed';
        contentDigest: string;
        status: 'active' | 'retired';
      }
    | {
        kind: 'occupied';
        description: string;
      };
}

export interface KnowledgeBundleImportPlan {
  projectId: string;
  projectRoot: string;
  bundleId: string;
  bundlePath: string;
  baseProjectCommit: string | null;
  added: readonly KnowledgeBundleImportRecordSummary[];
  alreadyPresent: readonly KnowledgeBundleImportRecordSummary[];
  conflicts: readonly KnowledgeBundleImportConflict[];
  warnings: readonly KnowledgeBundleImportWarning[];
}

interface PlannedRecord {
  source: KnowledgeBundleRecord;
  manifest: LearnedSkillManifestV2;
  summary: KnowledgeBundleImportRecordSummary;
}

interface InternalImportPlan {
  publicPlan: KnowledgeBundleImportPlan;
  newRecords: readonly PlannedRecord[];
}

export interface KnowledgeBundleImportResult extends KnowledgeBundleImportPlan {
  state: KnowledgeBundleImportState;
  changed: boolean;
  refused: boolean;
}

export type KnowledgeBundleImportChanged = boolean | 'unknown';

export type KnowledgeBundleImportErrorCode =
  | 'knowledge_bundle_import_bundle_invalid'
  | 'knowledge_bundle_import_project_not_found'
  | 'knowledge_bundle_import_project_unavailable'
  | 'knowledge_bundle_import_project_mismatch'
  | 'knowledge_bundle_import_record_id_invalid'
  | 'knowledge_bundle_import_record_id_collision'
  | 'knowledge_bundle_import_catalog_unavailable'
  | 'knowledge_bundle_import_catalog_drift'
  | 'knowledge_bundle_import_conflict'
  | 'knowledge_bundle_import_lock_failed'
  | 'knowledge_bundle_import_transaction_failed'
  | 'knowledge_bundle_import_rollback_failed';

export interface KnowledgeBundleImportIssue {
  recordId?: string;
  field?: string;
  reason: string;
}

export class KnowledgeBundleImportError extends Error {
  readonly code: KnowledgeBundleImportErrorCode;
  readonly details: Readonly<Record<string, string>>;
  readonly issues: readonly KnowledgeBundleImportIssue[];
  readonly plan?: KnowledgeBundleImportPlan;
  readonly changed: KnowledgeBundleImportChanged;
  readonly retainedPaths: readonly string[];

  constructor(
    code: KnowledgeBundleImportErrorCode,
    message: string,
    options: {
      details?: Record<string, string>;
      issues?: KnowledgeBundleImportIssue[];
      plan?: KnowledgeBundleImportPlan;
      changed?: KnowledgeBundleImportChanged;
      retainedPaths?: string[];
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'KnowledgeBundleImportError';
    this.code = code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.issues = Object.freeze([...(options.issues ?? [])]);
    this.plan = options.plan;
    this.changed = options.changed ?? false;
    this.retainedPaths = Object.freeze([...(options.retainedPaths ?? [])]);
  }
}

export interface KnowledgeBundleImportOwnedDirectory {
  path: string;
  identity: string;
}

export interface KnowledgeBundleImportIo {
  createPrivateStagingDirectory: (
    parent: string
  ) => KnowledgeBundleImportOwnedDirectory;
  createDirectoryExclusive: (directory: string) => string;
  writeFileExclusive: (filePath: string, content: string) => void;
  publishStagedFileExclusive: (stagedFile: string, targetFile: string) => void;
  removeOwnedDirectory: (directory: string) => void;
  removeEmptyOwnedDirectory: (directory: string) => void;
  pathIdentity: (target: string) => string | null;
  beforeStageWrite: (recordId: string, index: number) => void;
  beforeStageVerify: (recordId: string, index: number) => void;
  beforePublish: (recordId: string, index: number) => void;
  beforePublishedVerify: (recordId: string, index: number) => void;
}

export interface KnowledgeBundleImportDependencies {
  resolveProject: (selector: string) => Promise<ResolvedProject | null>;
  readBundle: (bundlePath: string) => KnowledgeBundle;
  resolveProjectStore: (
    project: ResolvedProject,
    context: LearnedSkillContext
  ) => Promise<{ ok: true; store: ResolvedStore } | { ok: false; code: string; message: string; repair?: string[] }>;
  readRecord: typeof readCanonicalRecord;
  acquireLock: typeof acquireOwnerAwareFileLock;
  releaseLock: typeof releaseOwnerAwareFileLock;
  io: KnowledgeBundleImportIo;
}

export interface ImportKnowledgeBundleOptions {
  bundle: string;
  project: string;
  dryRun?: boolean;
  context?: LearnedSkillContext;
  dependencies?: Partial<Omit<KnowledgeBundleImportDependencies, 'io'>> & {
    io?: Partial<KnowledgeBundleImportIo>;
  };
}

function pathIdentity(target: string): string | null {
  try {
    const stat = fs.lstatSync(target, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.mode}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function requiredPathIdentity(target: string): string {
  const identity = pathIdentity(target);
  if (identity === null) throw new Error(`Created directory disappeared: ${target}`);
  return identity;
}

const DEFAULT_IO: KnowledgeBundleImportIo = {
  createPrivateStagingDirectory: (parent) => {
    const staging = fs.mkdtempSync(path.join(parent, KNOWLEDGE_BUNDLE_IMPORT_STAGING_PREFIX));
    try {
      fs.chmodSync(staging, 0o700);
      return { path: staging, identity: requiredPathIdentity(staging) };
    } catch (error) {
      fs.rmdirSync(staging);
      throw error;
    }
  },
  createDirectoryExclusive: (directory) => {
    fs.mkdirSync(directory, { mode: 0o700 });
    try {
      return requiredPathIdentity(directory);
    } catch (error) {
      fs.rmdirSync(directory);
      throw error;
    }
  },
  writeFileExclusive: (filePath, content) =>
    fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }),
  // A hard link is one atomic, same-filesystem, no-replace publication. The
  // private staging directory is beside the catalog, so cross-device links
  // are impossible; unsupported filesystems fail before creating the name.
  publishStagedFileExclusive: (stagedFile, targetFile) =>
    fs.linkSync(stagedFile, targetFile),
  removeOwnedDirectory: (directory) => fs.rmSync(directory, { recursive: true, force: true }),
  removeEmptyOwnedDirectory: (directory) => fs.rmdirSync(directory),
  pathIdentity,
  beforeStageWrite: () => {},
  beforeStageVerify: () => {},
  beforePublish: () => {},
  beforePublishedVerify: () => {},
};

const DEFAULT_DEPENDENCIES: KnowledgeBundleImportDependencies = {
  resolveProject: resolveProjectSelector,
  readBundle: readKnowledgeBundle,
  resolveProjectStore: (project, context) =>
    resolveCanonicalStore('project', {
      ...context,
      projectRoot: project.root,
    }),
  readRecord: readCanonicalRecord,
  acquireLock: acquireOwnerAwareFileLock,
  releaseLock: releaseOwnerAwareFileLock,
  io: DEFAULT_IO,
};

function resolveDependencies(
  overrides: ImportKnowledgeBundleOptions['dependencies']
): KnowledgeBundleImportDependencies {
  return {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
    io: {
      ...DEFAULT_IO,
      ...overrides?.io,
    },
  };
}

function resolvedBundlePath(bundlePath: string): string {
  return path.resolve(bundlePath);
}

function bundleReadError(error: unknown, bundlePath: string): KnowledgeBundleImportError {
  const details: Record<string, string> = { bundlePath };
  const issues: KnowledgeBundleImportIssue[] = [];
  if (error instanceof UnsupportedKnowledgeBundleVersionError) {
    details.foundVersion = String(error.found);
    details.supportedVersion = String(error.supported);
    issues.push({ field: 'version', reason: error.message });
  } else if (error instanceof KnowledgeBundleMachinePathError) {
    details.recordId = error.recordId;
    details.field = error.field;
    issues.push({ recordId: error.recordId, field: error.field, reason: error.message });
  } else if (error instanceof ZodError) {
    for (const issue of error.issues) {
      const recordIndex = issue.path[0] === 'records' ? issue.path[1] : undefined;
      issues.push({
        ...(typeof recordIndex === 'number' ? { recordId: `records[${recordIndex}]` } : {}),
        field: issue.path.join('.'),
        reason: issue.message,
      });
    }
  } else {
    issues.push({ reason: error instanceof Error ? error.message : String(error) });
  }
  return new KnowledgeBundleImportError(
    'knowledge_bundle_import_bundle_invalid',
    `Knowledge bundle ${bundlePath} is invalid: ${issues[0]?.reason ?? 'unknown failure'}`,
    { details, issues, cause: error }
  );
}

function validateRecordIds(bundle: KnowledgeBundle): void {
  const issues: KnowledgeBundleImportIssue[] = [];
  const collisionOwners = new Map<string, string>();
  for (const record of bundle.records) {
    if (record.manifest.generatedBy !== LEARNED_SKILL_GENERATED_BY) {
      issues.push({
        recordId: record.id,
        field: 'manifest.generatedBy',
        reason: `managed record marker must be "${LEARNED_SKILL_GENERATED_BY}"`,
      });
    }
    const checked = checkLearnedSkillId(record.id);
    for (const violation of checked.violations) {
      issues.push({ recordId: record.id, field: 'id', reason: violation });
    }
    const collisionKey = learnedSkillIdCollisionKey(record.id);
    const prior = collisionOwners.get(collisionKey);
    if (prior !== undefined) {
      issues.push({
        recordId: record.id,
        field: 'id',
        reason: `identifier collides with bundle record "${prior}" on a portable filesystem`,
      });
    } else {
      collisionOwners.set(collisionKey, record.id);
    }
  }
  if (issues.length === 0) return;
  const hasCollision = issues.some((issue) => issue.reason.includes('collides with'));
  throw new KnowledgeBundleImportError(
    hasCollision
      ? 'knowledge_bundle_import_record_id_collision'
      : 'knowledge_bundle_import_record_id_invalid',
    `Knowledge bundle contains invalid or colliding record identifiers.`,
    { issues }
  );
}

function projectManifest(
  record: KnowledgeBundleRecord,
  projectId: string
): LearnedSkillManifestV2 {
  const source = record.manifest;
  const projected: LearnedSkillManifestV2 = {
    version: LEARNED_SKILL_MANIFEST_VERSION,
    id: record.id,
    knowledgeKey: record.knowledgeKey,
    scope: 'project',
    owner: { type: 'project', projectId },
    status: source.status,
    generatedBy: source.generatedBy,
    contentDigest: record.contentDigest,
    description: source.description,
    applicability: source.applicability,
    evidence: normalizeEvidence(source),
    // Transport is not publication. Even a project-typed source locator was
    // authored for the exporting catalog, not verified on this machine.
    sources: [],
    ...(source.evidenceOverflow === undefined
      ? {}
      : { evidenceOverflow: source.evidenceOverflow }),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    ...(source.retiredAt === undefined ? {} : { retiredAt: source.retiredAt }),
    ...(source.retirementReason === undefined
      ? {}
      : { retirementReason: source.retirementReason }),
  };
  return LearnedSkillManifestSchema.parse(projected) as LearnedSkillManifestV2;
}

function recordSummary(
  record: KnowledgeBundleRecord
): KnowledgeBundleImportRecordSummary {
  return Object.freeze({
    id: record.id,
    knowledgeKey: record.knowledgeKey,
    status: record.manifest.status,
    contentDigest: record.contentDigest,
  });
}

function classifyRecord(
  planned: PlannedRecord,
  current: CanonicalRecordRead
):
  | { kind: 'new' }
  | { kind: 'identical' }
  | { kind: 'conflicting'; conflict: KnowledgeBundleImportConflict } {
  if (current.kind === 'absent') return { kind: 'new' };
  if (current.kind === 'unmanaged') {
    return {
      kind: 'conflicting',
      conflict: Object.freeze({
        id: planned.source.id,
        knowledgeKey: planned.source.knowledgeKey,
        reason: 'target-occupied',
        bundle: Object.freeze({
          contentDigest: planned.source.contentDigest,
          status: planned.source.manifest.status,
        }),
        local: Object.freeze({
          kind: 'occupied',
          description: current.reason,
        }),
      }),
    };
  }
  const contentMatches =
    digestContent(current.record.content) === digestContent(planned.source.content);
  const lifecycleMatches =
    current.record.manifest.status === planned.source.manifest.status;
  if (contentMatches && lifecycleMatches) return { kind: 'identical' };
  return {
    kind: 'conflicting',
    conflict: Object.freeze({
      id: planned.source.id,
      knowledgeKey: planned.source.knowledgeKey,
      reason: contentMatches ? 'lifecycle-differs' : 'content-differs',
      bundle: Object.freeze({
        contentDigest: planned.source.contentDigest,
        status: planned.source.manifest.status,
      }),
      local: Object.freeze({
        kind: 'managed',
        contentDigest: current.record.manifest.contentDigest,
        status: current.record.manifest.status,
      }),
    }),
  };
}

function warningFor(bundle: KnowledgeBundle): KnowledgeBundleImportWarning {
  return Object.freeze({
    code:
      bundle.baseProjectCommit === null
        ? 'base_project_commit_unavailable'
        : 'base_project_commit_provenance',
    baseProjectCommit: bundle.baseProjectCommit,
  });
}

function buildPlan(
  project: ResolvedProject,
  bundlePath: string,
  bundle: KnowledgeBundle,
  store: ResolvedStore,
  dependencies: KnowledgeBundleImportDependencies
): InternalImportPlan {
  const projected = bundle.records
    .map((source) => ({
      source,
      manifest: projectManifest(source, project.ref.projectId),
      summary: recordSummary(source),
    }))
    .sort((left, right) =>
      left.source.id < right.source.id ? -1 : left.source.id > right.source.id ? 1 : 0
    );
  const newRecords: PlannedRecord[] = [];
  const alreadyPresent: KnowledgeBundleImportRecordSummary[] = [];
  const conflicts: KnowledgeBundleImportConflict[] = [];

  for (const planned of projected) {
    const target = learnedSkillDir(store, planned.source.id);
    let current: CanonicalRecordRead;
    try {
      current = dependencies.readRecord(target, 'project', store.owner);
    } catch (error) {
      current = {
        kind: 'unmanaged',
        reason: `${target} could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    const classification = classifyRecord(
      planned,
      current
    );
    if (classification.kind === 'new') newRecords.push(planned);
    else if (classification.kind === 'identical') alreadyPresent.push(planned.summary);
    else conflicts.push(classification.conflict);
  }

  const publicPlan: KnowledgeBundleImportPlan = Object.freeze({
    projectId: project.ref.projectId,
    projectRoot: project.root,
    bundleId: bundle.bundleId,
    bundlePath,
    baseProjectCommit: bundle.baseProjectCommit,
    added: Object.freeze(newRecords.map((record) => record.summary)),
    alreadyPresent: Object.freeze(alreadyPresent),
    conflicts: Object.freeze(conflicts),
    warnings: Object.freeze([warningFor(bundle)]),
  });
  return {
    publicPlan,
    newRecords: Object.freeze(newRecords),
  };
}

function catalogUnavailable(
  resolution: { ok: false; code: string; message: string; repair?: string[] }
): KnowledgeBundleImportError {
  return new KnowledgeBundleImportError(
    'knowledge_bundle_import_catalog_unavailable',
    resolution.message,
    {
      details: {
        reason: resolution.code,
        diagnostic: resolution.message,
        ...(resolution.repair === undefined
          ? {}
          : { repair: resolution.repair.join('\n') }),
      },
      changed: false,
    }
  );
}

function resolverDiagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectResolverUnavailable(
  error: unknown,
  selector: string
): KnowledgeBundleImportError {
  const diagnostic = resolverDiagnostic(error);
  return new KnowledgeBundleImportError(
    'knowledge_bundle_import_project_unavailable',
    `Project selector resolution failed for "${selector}": ${diagnostic}`,
    {
      details: {
        selector,
        reason: 'project_resolver_threw',
        diagnostic,
        repair:
          'Repair the machine project registry and project home, then resolve the project again.',
      },
      changed: false,
      cause: error,
    }
  );
}

async function resolveProjectStoreOrRefuse(
  project: ResolvedProject,
  context: LearnedSkillContext,
  dependencies: KnowledgeBundleImportDependencies
): Promise<
  { ok: true; store: ResolvedStore } | {
    ok: false;
    code: string;
    message: string;
    repair?: string[];
  }
> {
  try {
    return await dependencies.resolveProjectStore(project, context);
  } catch (error) {
    throw catalogUnavailable({
      ok: false,
      code: 'resolver_threw',
      message: resolverDiagnostic(error),
      repair: [
        'Repair the machine project registry and canonical project knowledge home, then preview the bundle again.',
      ],
    });
  }
}

function conflictError(plan: KnowledgeBundleImportPlan): KnowledgeBundleImportError {
  return new KnowledgeBundleImportError(
    'knowledge_bundle_import_conflict',
    `Knowledge bundle import has ${plan.conflicts.length} conflict(s); nothing was imported.`,
    {
      details: {
        conflictCount: String(plan.conflicts.length),
        repair: 'Resolve every named local conflict, then preview or import the same bundle again.',
      },
      issues: plan.conflicts.map((conflict) => ({
        recordId: conflict.id,
        reason: conflict.reason,
      })),
      plan,
    }
  );
}

function planDecisionFingerprint(plan: KnowledgeBundleImportPlan): string {
  return JSON.stringify({
    added: plan.added.map((record) => record.id),
    alreadyPresent: plan.alreadyPresent.map((record) => record.id),
    conflicts: plan.conflicts.map((conflict) => [conflict.id, conflict.reason]),
  });
}

function sameStore(left: ResolvedStore, right: ResolvedStore): boolean {
  return (
    canonicalPathsEqual(left.dir, right.dir) &&
    canonicalPathsEqual(left.root, right.root) &&
    canonicalPathsEqual(left.lockPath, right.lockPath) &&
    left.owner.type === 'project' &&
    right.owner.type === 'project' &&
    left.owner.projectId === right.owner.projectId
  );
}

interface OwnedDirectory {
  path: string;
  identity: string;
  expectedFiles?: Map<
    string,
    {
      identity: string;
      content: string;
    }
  >;
}

function ownedRecordStillMatches(owned: OwnedDirectory): boolean {
  if (owned.expectedFiles === undefined) return true;
  try {
    const entries = fs.readdirSync(owned.path, { withFileTypes: true });
    const names = entries
      .map((entry) => `${entry.isFile() ? 'file' : 'other'}:${entry.name}`)
      .sort();
    if (
      JSON.stringify(names) !==
      JSON.stringify(
        [...owned.expectedFiles.keys()].map((name) => `file:${name}`).sort()
      )
    ) {
      return false;
    }
    return [...owned.expectedFiles].every(([name, expected]) => {
      const filePath = path.join(owned.path, name);
      return (
        pathIdentity(filePath) === expected.identity &&
        fs.readFileSync(filePath, 'utf8') === expected.content
      );
    });
  } catch {
    return false;
  }
}

function ensureDirectoryChain(
  directory: string,
  dependencies: KnowledgeBundleImportDependencies,
  created: OwnedDirectory[]
): void {
  const missing: string[] = [];
  let current = path.resolve(directory);
  while (dependencies.io.pathIdentity(current) === null) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const candidate of missing.reverse()) {
    const identity = dependencies.io.createDirectoryExclusive(candidate);
    created.push({ path: candidate, identity });
    const confirmedIdentity = dependencies.io.pathIdentity(candidate);
    if (confirmedIdentity === null) {
      throw new Error(`Created directory disappeared: ${candidate}`);
    }
    if (confirmedIdentity !== identity) {
      throw new Error(`Created directory identity changed: ${candidate}`);
    }
  }
}

function removeOwnedDirectories(
  directories: readonly OwnedDirectory[],
  dependencies: KnowledgeBundleImportDependencies,
  recursive: boolean
): Array<{ path: string; reason: string }> {
  const failures: Array<{ path: string; reason: string }> = [];
  for (const owned of [...directories].reverse()) {
    try {
      const currentIdentity = dependencies.io.pathIdentity(owned.path);
      if (currentIdentity === null) continue;
      if (currentIdentity !== owned.identity) {
        failures.push({ path: owned.path, reason: 'ownership changed; retained' });
        continue;
      }
      if (!ownedRecordStillMatches(owned)) {
        failures.push({ path: owned.path, reason: 'contents changed; retained' });
        continue;
      }
      if (recursive) dependencies.io.removeOwnedDirectory(owned.path);
      else dependencies.io.removeEmptyOwnedDirectory(owned.path);
    } catch (error) {
      failures.push({
        path: owned.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return failures;
}

function writeAndVerifyStaging(
  staging: string,
  records: readonly PlannedRecord[],
  store: ResolvedStore,
  dependencies: KnowledgeBundleImportDependencies
): void {
  records.forEach((record, index) => {
    dependencies.io.beforeStageWrite(record.source.id, index);
    const directory = path.join(staging, record.source.id);
    dependencies.io.createDirectoryExclusive(directory);
    dependencies.io.writeFileExclusive(
      path.join(directory, LEARNED_SKILL_MANIFEST_FILE),
      serializeManifest(record.manifest)
    );
    dependencies.io.writeFileExclusive(
      path.join(directory, LEARNED_SKILL_CONTENT_FILE),
      record.source.content
    );
  });
  records.forEach((record, index) => {
    dependencies.io.beforeStageVerify(record.source.id, index);
    const read = dependencies.readRecord(
      path.join(staging, record.source.id),
      'project',
      store.owner
    );
    if (read.kind !== 'managed') {
      throw new Error(
        `Staged record "${record.source.id}" did not verify: ${
          read.kind === 'unmanaged' ? read.reason : 'record is absent'
        }`
      );
    }
    if (
      read.record.content !== record.source.content ||
      serializeManifest(read.record.manifest) !== serializeManifest(record.manifest)
    ) {
      throw new Error(
        `Staged record "${record.source.id}" does not match the complete import projection.`
      );
    }
  });
}

function publishStagedRecords(
  staging: string,
  records: readonly PlannedRecord[],
  store: ResolvedStore,
  dependencies: KnowledgeBundleImportDependencies,
  created: OwnedDirectory[]
): void {
  records.forEach((record, index) => {
    dependencies.io.beforePublish(record.source.id, index);
    const target = learnedSkillDir(store, record.source.id);
    const current = dependencies.readRecord(target, 'project', store.owner);
    if (current.kind !== 'absent') {
      throw new Error(
        `Target "${record.source.id}" changed before publication: ${
          current.kind === 'unmanaged' ? current.reason : 'managed record appeared'
        }`
      );
    }
    const stagedDirectory = path.join(staging, record.source.id);
    if (dependencies.io.pathIdentity(stagedDirectory) === null) {
      throw new Error(`Verified staged record disappeared: ${record.source.id}`);
    }
    // The exclusive mkdir is the no-replace publication boundary. It cannot
    // replace an empty directory on POSIX (unlike directory rename), and it
    // refuses an occupied target on Windows and POSIX alike.
    const targetIdentity = dependencies.io.createDirectoryExclusive(target);
    const ownedTarget: OwnedDirectory = {
      path: target,
      identity: targetIdentity,
      expectedFiles: new Map(),
    };
    created.push(ownedTarget);
    const confirmedIdentity = dependencies.io.pathIdentity(target);
    if (confirmedIdentity === null) {
      throw new Error(`Reserved target disappeared: ${target}`);
    }
    if (confirmedIdentity !== targetIdentity) {
      throw new Error(`Reserved target identity changed: ${target}`);
    }
    const publishFile = (name: string, expected: string): void => {
      const stagedFile = path.join(stagedDirectory, name);
      const targetFile = path.join(target, name);
      const stagedIdentity = pathIdentity(stagedFile);
      if (stagedIdentity === null) {
        throw new Error(`Verified staged file disappeared: ${stagedFile}`);
      }
      const claimLinkedTarget = (): boolean => {
        const targetIdentity = pathIdentity(targetFile);
        if (targetIdentity === null || targetIdentity !== stagedIdentity) {
          return false;
        }
        if (fs.readFileSync(targetFile, 'utf8') !== expected) return false;
        ownedTarget.expectedFiles?.set(name, {
          identity: targetIdentity,
          content: expected,
        });
        return true;
      };
      try {
        dependencies.io.publishStagedFileExclusive(stagedFile, targetFile);
      } catch (error) {
        try {
          claimLinkedTarget();
        } catch {
          // An unreadable or ambiguous file remains outside the expected set,
          // so rollback retains the target instead of claiming ownership.
        }
        throw error;
      }
      if (!claimLinkedTarget()) {
        throw new Error(
          `Published file did not retain the staged file identity: ${targetFile}`
        );
      }
    };
    publishFile(
      LEARNED_SKILL_MANIFEST_FILE,
      serializeManifest(record.manifest)
    );
    publishFile(LEARNED_SKILL_CONTENT_FILE, record.source.content);
    dependencies.io.beforePublishedVerify(record.source.id, index);
    const verified = dependencies.readRecord(target, 'project', store.owner);
    if (
      verified.kind !== 'managed' ||
      verified.record.manifest.version !== LEARNED_SKILL_MANIFEST_VERSION ||
      verified.record.manifest.owner.type !== 'project' ||
      verified.record.manifest.owner.projectId !== store.projectId ||
      verified.record.content !== record.source.content ||
      serializeManifest(verified.record.manifest) !== serializeManifest(record.manifest)
    ) {
      throw new Error(`Published record "${record.source.id}" did not verify.`);
    }
  });
}

function importLockError(
  kind: FileLockErrorKind,
  info: FileLockErrorInfo
): KnowledgeBundleImportError {
  return new KnowledgeBundleImportError(
    'knowledge_bundle_import_lock_failed',
    kind === 'timeout'
      ? 'The project knowledge catalog is busy.'
      : `Could not create the project knowledge lock ${info.lockPath}.`,
    {
      details: {
        lockPath: info.lockPath,
        reason: kind,
        repair:
          kind === 'timeout'
            ? `Retry shortly; if this persists, inspect the stale lock ${info.lockPath}.`
            : `Check permissions on ${path.dirname(info.lockPath)}.`,
      },
      cause: info.cause,
    }
  );
}

async function applyPlan(
  initial: InternalImportPlan,
  project: ResolvedProject,
  bundlePath: string,
  bundle: KnowledgeBundle,
  initialStore: ResolvedStore,
  context: LearnedSkillContext,
  dependencies: KnowledgeBundleImportDependencies
): Promise<KnowledgeBundleImportResult> {
  const lock = await dependencies.acquireLock({
    lockPath: initialStore.lockPath,
    errorFor: importLockError,
  });
  try {
    const storeResolution = await resolveProjectStoreOrRefuse(
      project,
      context,
      dependencies
    );
    if (!storeResolution.ok) throw catalogUnavailable(storeResolution);
    if (!sameStore(initialStore, storeResolution.store)) {
      throw new KnowledgeBundleImportError(
        'knowledge_bundle_import_catalog_drift',
        'The canonical project knowledge catalog changed while import was waiting for its lock.',
        {
          details: {
            before: initialStore.dir,
            after: storeResolution.store.dir,
            repair: 'Preview the bundle again against the newly resolved project catalog.',
          },
        }
      );
    }
    const locked = buildPlan(
      project,
      bundlePath,
      bundle,
      storeResolution.store,
      dependencies
    );
    if (locked.publicPlan.conflicts.length > 0) throw conflictError(locked.publicPlan);
    if (
      planDecisionFingerprint(initial.publicPlan) !==
      planDecisionFingerprint(locked.publicPlan)
    ) {
      throw new KnowledgeBundleImportError(
        'knowledge_bundle_import_catalog_drift',
        'The bundle classification changed while import was waiting for the project lock.',
        {
          details: {
            repair: 'Preview the bundle again against the current project catalog.',
          },
          plan: locked.publicPlan,
        }
      );
    }
    if (locked.newRecords.length === 0) {
      return {
        ...locked.publicPlan,
        state: 'imported',
        changed: false,
        refused: false,
      };
    }

    const parent = path.dirname(storeResolution.store.dir);
    const createdParents: OwnedDirectory[] = [];
    let staging: OwnedDirectory | undefined;
    const createdCatalog: OwnedDirectory[] = [];
    const published: OwnedDirectory[] = [];
    try {
      ensureDirectoryChain(parent, dependencies, createdParents);
      staging = dependencies.io.createPrivateStagingDirectory(parent);
      const stagingPath = staging.path;
      const confirmedStagingIdentity = dependencies.io.pathIdentity(stagingPath);
      if (confirmedStagingIdentity === null) {
        throw new Error(`Staging directory disappeared: ${stagingPath}`);
      }
      if (confirmedStagingIdentity !== staging.identity) {
        throw new Error(`Staging directory identity changed: ${stagingPath}`);
      }
      writeAndVerifyStaging(
        stagingPath,
        locked.newRecords,
        storeResolution.store,
        dependencies
      );
      ensureDirectoryChain(storeResolution.store.dir, dependencies, createdCatalog);
      publishStagedRecords(
        stagingPath,
        locked.newRecords,
        storeResolution.store,
        dependencies,
        published
      );
    } catch (error) {
      const rollbackFailures = [
        ...removeOwnedDirectories(published, dependencies, true),
        ...(staging === undefined
          ? []
          : removeOwnedDirectories([staging], dependencies, true)),
        ...removeOwnedDirectories(createdCatalog, dependencies, false),
        ...removeOwnedDirectories(createdParents, dependencies, false),
      ];
      if (rollbackFailures.length > 0) {
        const retainedPaths = [
          ...new Set(rollbackFailures.map((failure) => failure.path)),
        ];
        throw new KnowledgeBundleImportError(
          'knowledge_bundle_import_rollback_failed',
          'Knowledge bundle import failed and transaction-owned cleanup could not be verified.',
          {
            details: {
              reason: error instanceof Error ? error.message : String(error),
              rollback: rollbackFailures
                .map((failure) => `${failure.path}: ${failure.reason}`)
                .join('\n'),
              repair: 'Inspect the named transaction paths before retrying the import.',
            },
            changed: 'unknown',
            retainedPaths,
            cause: error,
          }
        );
      }
      throw new KnowledgeBundleImportError(
        'knowledge_bundle_import_transaction_failed',
        `Knowledge bundle import failed; nothing was imported: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          details: {
            reason: error instanceof Error ? error.message : String(error),
            repair: 'Correct the reported filesystem problem, then preview and retry the bundle.',
          },
          cause: error,
        }
      );
    }

    const stagingFailures =
      staging === undefined ? [] : removeOwnedDirectories([staging], dependencies, true);
    const resultWarnings =
      stagingFailures.length === 0
        ? locked.publicPlan.warnings
        : Object.freeze([
            ...locked.publicPlan.warnings,
            Object.freeze({
              code: 'staging_cleanup_deferred' as const,
              baseProjectCommit: bundle.baseProjectCommit,
            }),
          ]);
    return {
      ...locked.publicPlan,
      warnings: resultWarnings,
      state: 'imported',
      changed: locked.newRecords.length > 0,
      refused: false,
    };
  } finally {
    await dependencies.releaseLock(lock);
  }
}

/**
 * Reusable F3 seam. F4 calls this function directly after its own declaration
 * trust and confirmation policy has selected a bundle.
 */
export async function importKnowledgeBundle(
  options: ImportKnowledgeBundleOptions
): Promise<KnowledgeBundleImportResult> {
  const dependencies = resolveDependencies(options.dependencies);
  const bundlePath = resolvedBundlePath(options.bundle);
  let bundle: KnowledgeBundle;
  try {
    bundle = dependencies.readBundle(bundlePath);
  } catch (error) {
    throw bundleReadError(error, bundlePath);
  }
  validateRecordIds(bundle);

  let project: ResolvedProject | null;
  try {
    project = await dependencies.resolveProject(options.project);
  } catch (error) {
    throw projectResolverUnavailable(error, options.project);
  }
  if (project === null) {
    throw new KnowledgeBundleImportError(
      'knowledge_bundle_import_project_not_found',
      `Project selector did not resolve: ${options.project}`,
      {
        details: {
          selector: options.project,
          repair: 'Register the project on this machine or pass its registered project identity.',
        },
      }
    );
  }
  if (bundle.projectId !== project.ref.projectId) {
    throw new KnowledgeBundleImportError(
      'knowledge_bundle_import_project_mismatch',
      `Bundle project "${bundle.projectId}" does not match target project "${project.ref.projectId}".`,
      {
        details: {
          bundleProjectId: bundle.projectId,
          targetProjectId: project.ref.projectId,
          repair: 'Choose a bundle exported from this project identity.',
        },
      }
    );
  }
  const context: LearnedSkillContext = {
    ...(options.context ?? {}),
    projectRoot: project.root,
  };
  const storeResolution = await resolveProjectStoreOrRefuse(
    project,
    context,
    dependencies
  );
  if (!storeResolution.ok) throw catalogUnavailable(storeResolution);
  const canonicalProjectId =
    storeResolution.store.owner.type === 'project'
      ? storeResolution.store.owner.projectId
      : undefined;
  if (
    storeResolution.store.owner.type !== 'project' ||
    canonicalProjectId === undefined ||
    storeResolution.store.projectId !== canonicalProjectId ||
    canonicalProjectId !== project.ref.projectId
  ) {
    throw new KnowledgeBundleImportError(
      'knowledge_bundle_import_catalog_drift',
      'The resolved project catalog does not name one consistent permanent project identity.',
      {
        details: {
          targetProjectId: project.ref.projectId,
          catalogProjectId: storeResolution.store.projectId ?? '<missing>',
          repair: 'Repair the project registration before importing knowledge.',
        },
      }
    );
  }

  const plan = buildPlan(
    project,
    bundlePath,
    bundle,
    storeResolution.store,
    dependencies
  );
  if (options.dryRun === true) {
    return {
      ...plan.publicPlan,
      state: 'previewed',
      changed: false,
      refused: plan.publicPlan.conflicts.length > 0,
    };
  }
  if (plan.publicPlan.conflicts.length > 0) throw conflictError(plan.publicPlan);
  if (plan.newRecords.length === 0) {
    return {
      ...plan.publicPlan,
      state: 'imported',
      changed: false,
      refused: false,
    };
  }
  return applyPlan(
    plan,
    project,
    bundlePath,
    bundle,
    storeResolution.store,
    context,
    dependencies
  );
}
