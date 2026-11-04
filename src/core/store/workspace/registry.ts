/**
 * The machine workspace index: `<dataDir>/planning-workspaces/index/<planningScopeId>.json`.
 *
 * It is a REBUILDABLE PROJECTION of the two per-worktree markers plus live Git,
 * and it is authority for nothing. Every field is re-verified before use
 * (`binding.ts`), a MISSING entry is repaired idempotently from what is already
 * true on disk, and a DISAGREEING entry fails closed. That asymmetry is
 * deliberate: an index that failed when it was merely incomplete would make a
 * hand-assembled pair unusable for no safety gain, while an index that could
 * overrule Git would be a second source of truth.
 *
 * One document per planning scope, holding one entry per Change alias — the
 * scope is the file name, so ambiguity between two entries claiming one
 * worktree is detectable by reading the whole index, which
 * `listAllWorkspaceIndexEntries` exists for.
 */
import { createHash } from 'node:crypto';

import { canonicalBytes } from '../../canonical-json.js';
import type { WorkspaceCoordination } from './dependencies.js';
import type { CleanupPhase, WorkspaceSide } from './types.js';

export const INDEX_DIR_NAME = 'index';
export const PLANS_DIR_NAME = 'plans';

export type WorkspacePhase =
  | 'planned'
  | 'planning-worktree-created'
  | 'execution-worktree-created'
  | 'markers-written'
  | 'prepared'
  | 'bound'
  | CleanupPhase;

export interface WorkspaceIndexSide {
  readonly root: string;
  readonly repositoryIdentity: string;
  readonly worktreeInstanceId: string;
  readonly ref: string;
  readonly headOid: string;
}

export interface WorkspaceIndexEntry {
  readonly version: 1;
  readonly planningScopeId: string;
  readonly storeUid: string;
  readonly storeId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  /** The Change alias the pair was prepared for. A locator, never identity. */
  readonly changeId: string;
  readonly changeInstanceId?: string;
  readonly workspacePairId?: string;
  readonly planning: WorkspaceIndexSide;
  readonly execution: WorkspaceIndexSide;
  readonly planId: string;
  readonly phase: WorkspacePhase;
  readonly recordedAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceIndexDocument {
  readonly version: 1;
  readonly planningScopeId: string;
  readonly entries: readonly WorkspaceIndexEntry[];
}

export function workspaceIndexRelativePath(planningScopeId: string): string {
  return `${INDEX_DIR_NAME}/${planningScopeId}.json`;
}

export function workspacePlanRelativePath(planId: string): string {
  return `${PLANS_DIR_NAME}/${planId}.json`;
}

export function workspaceCleanupPlanRelativePath(planId: string): string {
  return `${PLANS_DIR_NAME}/cleanup-${planId}.json`;
}

function emptyDocument(planningScopeId: string): WorkspaceIndexDocument {
  return { version: 1, planningScopeId, entries: [] };
}

function isEntry(value: unknown): value is WorkspaceIndexEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<WorkspaceIndexEntry>;
  return (
    entry.version === 1 &&
    typeof entry.planningScopeId === 'string' &&
    typeof entry.storeUid === 'string' &&
    typeof entry.projectId === 'string' &&
    typeof entry.targetLineId === 'string' &&
    typeof entry.changeId === 'string' &&
    typeof entry.planning === 'object' &&
    entry.planning !== null &&
    typeof entry.execution === 'object' &&
    entry.execution !== null
  );
}

export async function readWorkspaceIndexDocument(
  coordination: WorkspaceCoordination,
  planningScopeId: string
): Promise<WorkspaceIndexDocument> {
  const value = await coordination.readJson(workspaceIndexRelativePath(planningScopeId));
  if (value === null || typeof value !== 'object') return emptyDocument(planningScopeId);
  const document = value as Partial<WorkspaceIndexDocument>;
  const entries = Array.isArray(document.entries) ? document.entries.filter(isEntry) : [];
  return {
    version: 1,
    planningScopeId,
    entries: [...entries].sort((left, right) => left.changeId.localeCompare(right.changeId)),
  };
}

export async function readWorkspaceIndexEntry(
  coordination: WorkspaceCoordination,
  planningScopeId: string,
  changeId: string
): Promise<WorkspaceIndexEntry | null> {
  const document = await readWorkspaceIndexDocument(coordination, planningScopeId);
  return document.entries.find((entry) => entry.changeId === changeId) ?? null;
}

/**
 * Upserts one entry. Writing is idempotent for identical content: the document
 * is canonically ordered, so repairing a missing entry twice produces
 * byte-identical state.
 */
export async function writeWorkspaceIndexEntry(
  coordination: WorkspaceCoordination,
  entry: WorkspaceIndexEntry
): Promise<WorkspaceIndexDocument> {
  const document = await readWorkspaceIndexDocument(coordination, entry.planningScopeId);
  const others = document.entries.filter((candidate) => candidate.changeId !== entry.changeId);
  const next: WorkspaceIndexDocument = {
    version: 1,
    planningScopeId: entry.planningScopeId,
    entries: [...others, entry].sort((left, right) => left.changeId.localeCompare(right.changeId)),
  };
  await coordination.writeJson(workspaceIndexRelativePath(entry.planningScopeId), next);
  return next;
}

export async function removeWorkspaceIndexEntry(
  coordination: WorkspaceCoordination,
  planningScopeId: string,
  changeId: string
): Promise<boolean> {
  const document = await readWorkspaceIndexDocument(coordination, planningScopeId);
  const remaining = document.entries.filter((entry) => entry.changeId !== changeId);
  if (remaining.length === document.entries.length) return false;
  if (remaining.length === 0) {
    await coordination.remove(workspaceIndexRelativePath(planningScopeId));
    return true;
  }
  await coordination.writeJson(workspaceIndexRelativePath(planningScopeId), {
    version: 1,
    planningScopeId,
    entries: remaining,
  });
  return true;
}

/** Every entry on this machine, for ambiguity detection across scopes. */
export async function listAllWorkspaceIndexEntries(
  coordination: WorkspaceCoordination
): Promise<readonly WorkspaceIndexEntry[]> {
  const names = await coordination.listNames(INDEX_DIR_NAME);
  const entries: WorkspaceIndexEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const document = await readWorkspaceIndexDocument(coordination, name.slice(0, -'.json'.length));
    entries.push(...document.entries);
  }
  return entries.sort(
    (left, right) =>
      left.planningScopeId.localeCompare(right.planningScopeId) ||
      left.changeId.localeCompare(right.changeId)
  );
}

/**
 * The fingerprint a plan freezes and `apply` revalidates.
 *
 * It covers this scope's document with the plan's OWN Change entry removed, so
 * a concurrent preparation of a DIFFERENT Change in the same scope invalidates
 * the plan, while this plan's own phase transitions do not. Without that
 * exclusion, re-applying a token after a partial failure would fail the
 * fingerprint check on the entry the failed run itself wrote — and re-applying
 * a token is precisely how an interrupted apply is meant to complete.
 */
export function workspaceIndexFingerprint(
  document: WorkspaceIndexDocument,
  excludeChangeId?: string
): string {
  const entries =
    excludeChangeId === undefined
      ? document.entries
      : document.entries.filter((entry) => entry.changeId !== excludeChangeId);
  return createHash('sha256')
    .update(canonicalBytes({ ...document, entries }))
    .digest('hex');
}

export async function currentWorkspaceIndexFingerprint(
  coordination: WorkspaceCoordination,
  planningScopeId: string,
  excludeChangeId?: string
): Promise<string> {
  return workspaceIndexFingerprint(
    await readWorkspaceIndexDocument(coordination, planningScopeId),
    excludeChangeId
  );
}

export function indexSideFor(
  side: WorkspaceSide,
  entry: WorkspaceIndexEntry
): WorkspaceIndexSide {
  return side === 'planning' ? entry.planning : entry.execution;
}
