/**
 * Resolving a plan node's `changeInstanceId` to real evidence.
 *
 * Two sources, in a stated authority order:
 *
 * | source                                            | portable | authority                                  |
 * | committed Store content, read as Git blobs        | yes      | existence, committed identity, archived outcome |
 * | local planning worktrees, via the machine index   | no       | locates an instance whose branch has not merged |
 *
 * Matching is on the RE-DERIVED Change instance identity and on nothing else —
 * not a directory name, not a `changeAlias`, not a branch name. The alias is
 * recorded for humans and is excluded from resolution by construction: it is
 * never read on this path, and a test plants a mismatching alias to prove it.
 *
 * Three failure states are kept distinct, because collapsing them is how an
 * aggregate lies:
 *
 *   - `unresolved` — no evidence in either source, naming the refs searched.
 *   - `ambiguous`  — several claimants; every one listed, none chosen.
 *   - unsearched ref — a ref that could not be READ. Not absence, ever.
 */
import {
  listAllWorkspaceIndexEntries,
  type WorkspaceIndexEntry,
} from '../workspace/registry.js';
import type { StoreQueryDependencies } from './dependencies.js';
import {
  collectCommittedChanges,
  type CommittedChangeEvidence,
  type RefReader,
  type StoreRefTarget,
} from './refs.js';
import type { InertLocalLocator, PlanNodeClaimant } from './types.js';

export interface ReferenceEvidenceInput {
  readonly reader: RefReader;
  readonly refs: readonly StoreRefTarget[];
  readonly projectIds: readonly string[];
  readonly storeUid: string;
  readonly globalDataDir?: string;
}

/**
 * The whole evidence base for one query, gathered once.
 *
 * Both sources are read a single time per invocation and every node is resolved
 * against the same snapshot, so two nodes in one plan can never disagree about
 * what the Store contained.
 */
export interface ReferenceEvidence {
  readonly committed: readonly CommittedChangeEvidence[];
  readonly localWorkspaces: readonly WorkspaceIndexEntry[];
  readonly storeUid: string;
}

export async function gatherReferenceEvidence(
  dependencies: StoreQueryDependencies,
  input: ReferenceEvidenceInput
): Promise<ReferenceEvidence> {
  const committed = await collectCommittedChanges(input.reader, input.refs, input.projectIds);
  const coordination = dependencies.coordination(input.globalDataDir);
  // The machine index is a LOCATOR and authority for nothing. Entries for other
  // Stores are dropped here rather than filtered at every call site.
  const localWorkspaces = (await listAllWorkspaceIndexEntries(coordination)).filter(
    entry => entry.storeUid === input.storeUid
  );
  return { committed, localWorkspaces, storeUid: input.storeUid };
}

export type ReferenceResolution =
  | {
      readonly status: 'resolved';
      readonly evidence: CommittedChangeEvidence | null;
      readonly localLocator: InertLocalLocator | null;
      readonly claimants: readonly PlanNodeClaimant[];
    }
  | {
      readonly status: 'unresolved';
      readonly claimants: readonly [];
    }
  | {
      readonly status: 'ambiguous';
      readonly claimants: readonly PlanNodeClaimant[];
    };

function claimantOf(evidence: CommittedChangeEvidence): PlanNodeClaimant {
  return {
    changeId: evidence.changeId,
    projectId: evidence.projectId,
    targetLineId: evidence.targetLineId,
    foundAtRef: evidence.foundAtRef,
    archived: evidence.archived,
  };
}

function localLocatorOf(entry: WorkspaceIndexEntry): InertLocalLocator {
  return { root: entry.planning.root, kind: 'planning-worktree', portable: false };
}

/**
 * Resolves ONE Change instance against the gathered evidence.
 *
 * Committed content wins on authority; a local planning worktree only ever adds
 * a locator or answers when committed content has nothing. Disagreement between
 * the two on SCOPE is ambiguity, not a preference for the stronger source: an
 * index entry that contradicts committed identity is a fact somebody must look
 * at, and silently preferring one would hide it.
 */
export function resolveChangeReference(
  evidence: ReferenceEvidence,
  changeInstanceId: string
): ReferenceResolution {
  const committed = evidence.committed.filter(
    candidate => candidate.changeInstanceId === changeInstanceId
  );
  const local = evidence.localWorkspaces.filter(
    entry => entry.changeInstanceId === changeInstanceId
  );

  const distinctScopes = new Set(
    committed.map(candidate => `${candidate.projectId}/${candidate.targetLineId}`)
  );
  for (const entry of local) {
    distinctScopes.add(`${entry.projectId}/${entry.targetLineId}`);
  }

  if (committed.length > 1 && distinctScopes.size > 1) {
    return { status: 'ambiguous', claimants: committed.map(claimantOf) };
  }
  if (committed.length > 0 && local.length > 0 && distinctScopes.size > 1) {
    return {
      status: 'ambiguous',
      claimants: [
        ...committed.map(claimantOf),
        ...local.map(entry => ({
          changeId: entry.changeId,
          projectId: entry.projectId,
          targetLineId: entry.targetLineId,
          foundAtRef: entry.planning.ref,
          archived: false,
        })),
      ],
    };
  }
  if (committed.length > 0) {
    // One Change reachable from two refs is one Change. The active copy is
    // preferred over an archived one for the reported evidence; both are still
    // listed as claimants so a caller can see everywhere it was found.
    const preferred =
      committed.find(candidate => !candidate.archived) ??
      (committed[0] as CommittedChangeEvidence);
    return {
      status: 'resolved',
      evidence: preferred,
      localLocator: local.length === 1 ? localLocatorOf(local[0] as WorkspaceIndexEntry) : null,
      claimants: committed.map(claimantOf),
    };
  }
  if (local.length === 1) {
    const entry = local[0] as WorkspaceIndexEntry;
    return {
      status: 'resolved',
      evidence: null,
      localLocator: localLocatorOf(entry),
      claimants: [
        {
          changeId: entry.changeId,
          projectId: entry.projectId,
          targetLineId: entry.targetLineId,
          foundAtRef: entry.planning.ref,
          archived: false,
        },
      ],
    };
  }
  if (local.length > 1) {
    return {
      status: 'ambiguous',
      claimants: local.map(entry => ({
        changeId: entry.changeId,
        projectId: entry.projectId,
        targetLineId: entry.targetLineId,
        foundAtRef: entry.planning.ref,
        archived: false,
      })),
    };
  }
  return { status: 'unresolved', claimants: [] };
}
