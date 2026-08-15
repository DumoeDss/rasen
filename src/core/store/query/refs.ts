/**
 * Cross-ref reading: the Store's catalogs, its target-line refs, and the
 * committed blobs behind them.
 *
 * Committed Store content is read as Git BLOBS across the refs the target-line
 * catalogs name. Nothing is checked out, merged, fetched, or pushed, and the
 * search space is bounded by the number of target lines, which is small by
 * construction rather than by convention.
 *
 * Two rules the rest of the Module depends on:
 *
 *   - **One ref is read once per query.** `RefReader` memoizes per INVOCATION.
 *     The memo has no lifetime beyond the call and therefore no invalidation
 *     problem; there is deliberately no durable index (design decision 8).
 *   - **An unreadable ref is not absence.** It is recorded in `unsearchedRefs`,
 *     it sets `complete: false`, and it never lets a real reference be reported
 *     as unresolved.
 *   - **An unreadable ITEM is not absence either.** A blob that is there and
 *     does not parse is recorded in `problems`, sets `complete: false`, and is
 *     never dropped on the floor — the two failures are kept apart because
 *     "nobody could look" and "we looked and it is broken" call for different
 *     repairs.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { ChangeMetadataSchema } from '../../change-metadata/index.js';
import {
  listStoreRegistryEntries,
  parseStoreMetadataState,
  readStoreRegistryState,
  validateStoreSelector,
  type StoreMetadataState,
} from '../foundation.js';
import { getStoreRootForBackend, resolveRegisteredStore } from '../registry.js';
import { storeMetadataUid } from '../foundation.js';
import {
  parseStoreProjectCatalogV2,
  parseStoreTargetLineCatalogV1,
  resolveStorePlanningLayoutV2Path,
  type StoreProjectCatalogV2,
  type StoreTargetLineCatalogV1,
} from '../planning-foundation.js';
import { issueError } from '../issues/diagnostics.js';
import { formatZodIssues } from '../../zod-issues.js';
import type { StoreQueryDependencies } from './dependencies.js';
import type { AggregateProblem, CatalogDiagnostic, UnsearchedRef } from './types.js';

/**
 * Store resolution and catalog listing need only the read-only filesystem, so
 * they say so. A caller with a whole dependency set still satisfies this, and a
 * caller that has only a filesystem does not have to fabricate the rest.
 */
export type StoreQueryFileSystemOnly = Pick<StoreQueryDependencies, 'fs'>;

export interface ResolvedQueryStore {
  readonly storeId: string;
  readonly storeUid: string;
  readonly registeredRoot: string;
  readonly metadata: StoreMetadataState;
}

function diagnosticMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'invalid_catalog';
}

/**
 * Resolves the Store by DISPLAY NAME OR STABLE IDENTITY, the same selector
 * every other Store command accepts.
 */
export async function resolveQueryStore(
  dependencies: StoreQueryFileSystemOnly,
  input: { readonly store?: string; readonly globalDataDir?: string }
): Promise<ResolvedQueryStore> {
  if (input.store === undefined || input.store.length === 0) {
    throw issueError(
      'issue_scope_required',
      'No Store was selected. A Store aggregate query addresses exactly one Store.',
      { target: 'selection.store', fix: 'Add --store <store-id>.' }
    );
  }
  const selector = validateStoreSelector(input.store);
  const resolved = await resolveRegisteredStore({
    id: selector,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
  });
  return finishStoreResolution(dependencies, resolved.id, resolved.storeRoot);
}

/**
 * Resolves the Store by STABLE IDENTITY ONLY.
 *
 * The management API addresses a Store by UID, and a `store:<id>` space
 * selector carries the Store's LOCAL registry id, which is a different value
 * that would silently resolve to the same Store on a single-Store machine and
 * to the wrong one everywhere else. Accepting the display name here is
 * therefore not a convenience, it is the bug; this refuses it.
 */
export async function resolveQueryStoreByUid(
  dependencies: StoreQueryFileSystemOnly,
  input: { readonly storeUid: string; readonly globalDataDir?: string }
): Promise<ResolvedQueryStore> {
  const registry = await readStoreRegistryState(
    input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }
  );
  const entries = registry === null ? [] : listStoreRegistryEntries(registry);
  const matches = entries.filter(entry => entry.uid === input.storeUid);
  if (matches.length !== 1) {
    throw issueError(
      'issue_scope_required',
      `No registered Store carries the stable identity '${input.storeUid}'.`,
      {
        target: 'storeUid',
        fix: "Address the Store by its stable identity, which the spaces listing and every aggregate response report. A `store:<id>` space selector carries the Store's local registry id, which is not its identity.",
      }
    );
  }
  const entry = matches[0] as (typeof matches)[number];
  return finishStoreResolution(
    dependencies,
    entry.id,
    getStoreRootForBackend(entry.backend)
  );
}

async function finishStoreResolution(
  dependencies: StoreQueryFileSystemOnly,
  storeId: string,
  registeredRoot: string
): Promise<ResolvedQueryStore> {
  const metadataPath = resolveStorePlanningLayoutV2Path(registeredRoot, {
    kind: 'store-metadata',
  });
  const metadataText = await dependencies.fs.readText(metadataPath);
  if (metadataText === null) {
    throw issueError(
      'issue_scope_required',
      `Store '${storeId}' has no metadata at ${metadataPath}.`,
      { target: metadataPath, fix: 'Repair the Store checkout, then retry.' }
    );
  }
  const metadata = parseStoreMetadataState(metadataText);
  const storeUid = storeMetadataUid(metadata);
  if (metadata.layoutVersion !== 2 || storeUid === undefined) {
    throw issueError(
      'issue_scope_required',
      `Store '${storeId}' does not declare planning layout v2 with a permanent identity; Store-level Issues and aggregate grouping exist only in layout v2.`,
      {
        target: metadataPath,
        fix: `Run 'rasen store migrate-layout ${storeId}' first.`,
      }
    );
  }
  return { storeId, storeUid, registeredRoot, metadata };
}

// -----------------------------------------------------------------------------
// Catalogs
// -----------------------------------------------------------------------------

export interface TargetLineCatalogEntry {
  readonly targetLineId: string;
  readonly path: string;
  readonly catalog: StoreTargetLineCatalogV1 | null;
  readonly diagnostic: CatalogDiagnostic | null;
}

export interface ProjectCatalogEntry {
  readonly projectId: string;
  readonly path: string;
  readonly catalog: StoreProjectCatalogV2 | null;
  readonly diagnostic: CatalogDiagnostic | null;
}

/**
 * The directory holding a family of catalogs, obtained from the ONE contract
 * path of a probe member rather than joined by hand. The layout contract
 * addresses catalog FILES, so this is how a caller stays out of the business of
 * knowing that `.rasen-store` exists.
 */
function catalogDirectory(storeRoot: string, kind: 'projects' | 'target-lines'): string {
  const probe =
    kind === 'projects'
      ? resolveStorePlanningLayoutV2Path(storeRoot, {
          kind: 'project-catalog',
          projectId: 'probe',
        })
      : resolveStorePlanningLayoutV2Path(storeRoot, {
          kind: 'target-line-catalog',
          targetLineId: 'probe',
        });
  return path.dirname(probe);
}

/**
 * Every target-line catalog in the Store, INCLUDING ones that fail validation.
 * An invalid catalog is reported with its diagnostic rather than omitted; a
 * silently dropped line is a line whose Changes vanish from the board.
 */
export async function listTargetLineEntries(
  dependencies: StoreQueryFileSystemOnly,
  storeRoot: string
): Promise<readonly TargetLineCatalogEntry[]> {
  const directory = catalogDirectory(storeRoot, 'target-lines');
  const entries: TargetLineCatalogEntry[] = [];
  for (const name of await dependencies.fs.listNames(directory)) {
    if (!name.endsWith('.yaml')) continue;
    const filePath = path.join(directory, name);
    const text = await dependencies.fs.readText(filePath);
    const targetLineId = name.slice(0, -'.yaml'.length);
    if (text === null) continue;
    try {
      entries.push({
        targetLineId,
        path: filePath,
        catalog: parseStoreTargetLineCatalogV1(text, filePath),
        diagnostic: null,
      });
    } catch (error) {
      entries.push({
        targetLineId,
        path: filePath,
        catalog: null,
        diagnostic: {
          code: diagnosticCode(error),
          message: diagnosticMessage(error),
          path: filePath,
        },
      });
    }
  }
  return entries.sort((left, right) => left.targetLineId.localeCompare(right.targetLineId));
}

export async function listProjectEntries(
  dependencies: StoreQueryFileSystemOnly,
  storeRoot: string
): Promise<readonly ProjectCatalogEntry[]> {
  const directory = catalogDirectory(storeRoot, 'projects');
  const entries: ProjectCatalogEntry[] = [];
  for (const name of await dependencies.fs.listNames(directory)) {
    if (!name.endsWith('.yaml')) continue;
    const filePath = path.join(directory, name);
    const text = await dependencies.fs.readText(filePath);
    const projectId = name.slice(0, -'.yaml'.length);
    if (text === null) continue;
    try {
      entries.push({
        projectId,
        path: filePath,
        catalog: parseStoreProjectCatalogV2(text, filePath),
        diagnostic: null,
      });
    } catch (error) {
      entries.push({
        projectId,
        path: filePath,
        catalog: null,
        diagnostic: {
          code: diagnosticCode(error),
          message: diagnosticMessage(error),
          path: filePath,
        },
      });
    }
  }
  return entries.sort((left, right) => left.projectId.localeCompare(right.projectId));
}

// -----------------------------------------------------------------------------
// Per-invocation ref reading
// -----------------------------------------------------------------------------

export interface StoreRefTarget {
  readonly targetLineId: string;
  readonly storeRef: string;
}

export interface CommittedChangeEvidence {
  readonly changeInstanceId: string;
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeId: string;
  /** The Store ref this evidence was read from. */
  readonly foundAtRef: string;
  /** The target line whose catalog named that ref. */
  readonly refTargetLineId: string;
  readonly blobPath: string;
  readonly digest: string;
  readonly archived: boolean;
  /** For an archived entry, the directory name under `archive/<line>/`. */
  readonly archiveEntryName: string | null;
  readonly archiveLineId: string | null;
}

export function changesTreePath(projectId: string): string {
  return `rasen/projects/${projectId}/changes`;
}

export function archiveTreePath(projectId: string): string {
  return `rasen/projects/${projectId}/changes/archive`;
}

export function issuesTreePath(): string {
  return 'rasen/issues';
}

/**
 * Subtree names only. The adapter marks a subtree with a trailing `/` from
 * Git's own object type, so a Change alias containing a dot is still a
 * directory and a stray file beside the partitions is still not one.
 */
function directoryNames(entries: readonly string[]): string[] {
  return entries
    .filter(entry => entry.endsWith('/'))
    .map(entry => entry.slice(0, -1))
    .filter(entry => entry.length > 0);
}

/** Blob names only. */
function blobNames(entries: readonly string[]): string[] {
  return entries.filter(entry => !entry.endsWith('/') && entry.length > 0);
}

/**
 * One query's view of the Store's refs.
 *
 * Every blob and tree read is memoized on `(ref, path)` for the LIFETIME OF THE
 * INSTANCE, which is one query. Nothing survives the call: no file, no
 * process-wide map, no durable index.
 */
export class RefReader {
  private readonly blobs = new Map<string, string | null>();
  private readonly trees = new Map<string, readonly string[] | null>();
  private readonly resolved = new Map<string, string | null>();
  private readonly unsearched: UnsearchedRef[] = [];
  private readonly unread: AggregateProblem[] = [];
  private readonly searched = new Set<string>();

  constructor(
    private readonly dependencies: StoreQueryDependencies,
    private readonly repoRoot: string
  ) {}

  /**
   * Whether this ref can be read at all. A ref that resolves to no commit is
   * recorded as unsearched exactly once and is never treated as an empty Store.
   */
  async openRef(target: StoreRefTarget): Promise<boolean> {
    const cached = this.resolved.get(target.storeRef);
    if (cached !== undefined) return cached !== null;
    const oid = await this.dependencies.git.resolveCommit(this.repoRoot, target.storeRef);
    this.resolved.set(target.storeRef, oid);
    if (oid === null) {
      this.unsearched.push({
        targetLineId: target.targetLineId,
        storeRef: target.storeRef,
        reason: 'the Store ref does not resolve to a commit in this checkout',
      });
      return false;
    }
    this.searched.add(target.storeRef);
    return true;
  }

  /** Records a ref as unsearched for a reason other than an unresolvable OID. */
  markUnsearched(target: StoreRefTarget, reason: string): void {
    if (this.unsearched.some(entry => entry.storeRef === target.storeRef)) return;
    this.unsearched.push({
      targetLineId: target.targetLineId,
      storeRef: target.storeRef,
      reason,
    });
  }

  async blob(ref: string, portablePath: string): Promise<string | null> {
    const key = `${ref}:${portablePath}`;
    const cached = this.blobs.get(key);
    if (cached !== undefined) return cached;
    const text = await this.dependencies.git.showBlob(this.repoRoot, ref, portablePath);
    this.blobs.set(key, text);
    return text;
  }

  async tree(ref: string, portablePath: string): Promise<readonly string[] | null> {
    const key = `${ref}:${portablePath}`;
    const cached = this.trees.get(key);
    if (cached !== undefined) return cached;
    const entries = await this.dependencies.git.showTree(this.repoRoot, ref, portablePath);
    this.trees.set(key, entries);
    return entries;
  }

  async childDirectories(ref: string, portablePath: string): Promise<readonly string[]> {
    return directoryNames((await this.tree(ref, portablePath)) ?? []);
  }

  async childBlobs(ref: string, portablePath: string): Promise<readonly string[]> {
    return blobNames((await this.tree(ref, portablePath)) ?? []);
  }

  /**
   * Records an item that WAS read and does not parse.
   *
   * De-duplicated on (kind, ref, path), because the same blob is offered once
   * per ref that reaches it and reporting one file twice would read as two
   * broken items. Two refs carrying different broken copies of one path are
   * still two problems, which is the honest count.
   */
  recordProblem(problem: AggregateProblem): void {
    const duplicate = this.unread.some(
      entry =>
        entry.kind === problem.kind &&
        entry.storeRef === problem.storeRef &&
        entry.path === problem.path
    );
    if (duplicate) return;
    this.unread.push(problem);
  }

  get unsearchedRefs(): readonly UnsearchedRef[] {
    return [...this.unsearched].sort((left, right) =>
      left.storeRef.localeCompare(right.storeRef)
    );
  }

  get problems(): readonly AggregateProblem[] {
    return [...this.unread].sort((left, right) =>
      `${left.storeRef ?? ''}:${left.path}`.localeCompare(`${right.storeRef ?? ''}:${right.path}`)
    );
  }

  get searchedRefs(): readonly string[] {
    return [...this.searched].sort();
  }

  get complete(): boolean {
    return this.unsearched.length === 0 && this.unread.length === 0;
  }

  /**
   * Reports a Change whose committed metadata was read and does not read back,
   * and answers `null` so the caller can carry on with the rest of the Store.
   *
   * The null is what keeps one malformed Change from failing the whole answer;
   * the recorded problem is what keeps it from vanishing. Only ever called
   * when the BYTES ARE THERE and do not parse — an entry with no
   * `.openspec.yaml` at all is not a Change this query ever saw, and reporting
   * every legacy archive entry that predates the identity block as a broken
   * item would be a false alarm on real Stores.
   */
  private unreadableChange(
    input: { readonly ref: string; readonly blobPath: string; readonly changeId: string },
    reason: string
  ): null {
    this.recordProblem({
      kind: 'change',
      itemId: input.changeId,
      storeRef: input.ref,
      path: input.blobPath,
      reason,
    });
    return null;
  }

  /** Reads and re-derives one candidate Change's committed identity. */
  async changeEvidence(input: {
    readonly ref: string;
    readonly refTargetLineId: string;
    readonly blobPath: string;
    readonly changeId: string;
    readonly archived: boolean;
    readonly archiveEntryName?: string;
    readonly archiveLineId?: string;
  }): Promise<CommittedChangeEvidence | null> {
    const text = await this.blob(input.ref, input.blobPath);
    if (text === null) return null;
    let raw: unknown;
    try {
      raw = parseYaml(text);
    } catch (error) {
      return this.unreadableChange(
        input,
        `the committed Change metadata is not valid YAML: ${diagnosticMessage(error)}`
      );
    }
    const parsed = ChangeMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      return this.unreadableChange(
        input,
        `the committed Change metadata does not validate: ${formatZodIssues(parsed.error)}`
      );
    }
    const identity = parsed.data.identity;
    if (identity === undefined) {
      return this.unreadableChange(
        input,
        'the committed Change metadata carries no v2 identity block, so this Change has no ' +
          'project or target line to be grouped under'
      );
    }
    return {
      changeInstanceId: identity.instanceId,
      storeUid: identity.storeUid,
      projectId: identity.projectId,
      targetLineId: identity.targetLineId,
      changeId: input.changeId,
      foundAtRef: input.ref,
      refTargetLineId: input.refTargetLineId,
      blobPath: input.blobPath,
      digest: createHash('sha256').update(text, 'utf8').digest('hex'),
      archived: input.archived,
      archiveEntryName: input.archiveEntryName ?? null,
      archiveLineId: input.archiveLineId ?? null,
    };
  }
}

/**
 * Every committed Change in one Store, active and archived, across every
 * readable ref.
 *
 * De-duplication is on identity PLUS blob digest, so one Change reachable from
 * two refs is one Change rather than two claimants — a merged release line is
 * not a conflict, and treating it as one is how an aggregate starts lying.
 */
export async function collectCommittedChanges(
  reader: RefReader,
  refs: readonly StoreRefTarget[],
  projectIds: readonly string[]
): Promise<readonly CommittedChangeEvidence[]> {
  const found = new Map<string, CommittedChangeEvidence>();
  for (const target of refs) {
    if (!(await reader.openRef(target))) continue;
    for (const projectId of projectIds) {
      for (const changeId of await reader.childDirectories(
        target.storeRef,
        changesTreePath(projectId)
      )) {
        if (changeId === 'archive') continue;
        const evidence = await reader.changeEvidence({
          ref: target.storeRef,
          refTargetLineId: target.targetLineId,
          blobPath: `${changesTreePath(projectId)}/${changeId}/.openspec.yaml`,
          changeId,
          archived: false,
        });
        if (evidence !== null) record(found, evidence);
      }

      for (const lineId of await reader.childDirectories(
        target.storeRef,
        archiveTreePath(projectId)
      )) {
        for (const entryName of await reader.childDirectories(
          target.storeRef,
          `${archiveTreePath(projectId)}/${lineId}`
        )) {
          const evidence = await reader.changeEvidence({
            ref: target.storeRef,
            refTargetLineId: target.targetLineId,
            blobPath: `${archiveTreePath(projectId)}/${lineId}/${entryName}/.openspec.yaml`,
            changeId: entryName,
            archived: true,
            archiveEntryName: entryName,
            archiveLineId: lineId,
          });
          if (evidence !== null) record(found, evidence);
        }
      }
    }
  }
  return [...found.values()].sort((left, right) =>
    `${left.projectId}/${left.changeId}/${left.foundAtRef}`.localeCompare(
      `${right.projectId}/${right.changeId}/${right.foundAtRef}`
    )
  );
}

function record(
  found: Map<string, CommittedChangeEvidence>,
  evidence: CommittedChangeEvidence
): void {
  const key = `${evidence.changeInstanceId} ${evidence.projectId} ${evidence.changeId} ${evidence.digest}`;
  if (!found.has(key)) found.set(key, evidence);
}
