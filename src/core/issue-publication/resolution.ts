/**
 * Child-name → committed-instance resolution (design D2).
 *
 * Manual publication names a Change INSTANCE and `resolveChangeReference`
 * verifies it. This channel starts one step earlier: a portfolio child names
 * a Change by its semantic NAME (the change directory name), so the channel
 * searches the same committed evidence the manual path verifies against —
 * `gatherReferenceEvidence` over the target-line refs — for committed Changes
 * whose `changeId` equals the child id, and mints the instance reference from
 * what it finds. Archived committed Changes count as evidence: re-publication
 * after children complete is the channel's core dogfood, and the projection
 * already reads archived+outcome as finalized.
 *
 * The discipline mirrors the instance-keyed verifier exactly:
 *
 *   - exactly one committed identity → the node carries it;
 *   - more than one → `issue_reference_ambiguous`, every claimant listed,
 *     none chosen by ref order, recency, or proximity;
 *   - none committed but a machine workspace-index entry carries the name →
 *     `issue_reference_uncommitted` (the index is a locator and authority for
 *     nothing);
 *   - none anywhere → `issue_reference_unresolved`;
 *   - committed identity carrying a foreign `storeUid` →
 *     `issue_reference_foreign_store`;
 *   - a Store ref that could not be read is never concluded as absence →
 *     `store_query_ref_unreadable`.
 */
import {
  issueRefusal,
  resolveIssueScope,
  type ResolvedIssueScope,
  type StoreIssueDependencies,
} from '../store/issues/index.js';
import type { StoreQueryDependencies } from '../store/query/dependencies.js';
import {
  RefReader,
  gatherReferenceEvidence,
  listProjectEntries,
  listTargetLineEntries,
  type CommittedChangeEvidence,
  type ReferenceEvidence,
} from '../store/query/index.js';
import { archiveDatePrefixedNameMatches } from '../archive-engine.js';
import type { ResolvedChildIdentity } from './types.js';

/** One claimant for a child name: the committed copy, with where it was found. */
export interface ChildNameClaimant {
  readonly changeId: string;
  readonly changeInstanceId: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly foundAtRef: string;
  readonly archived: boolean;
}

/**
 * One child name against one gathered evidence snapshot. Pure: the caller
 * gathers evidence once and resolves every child against the same base, so
 * two children in one portfolio can never disagree about what the Store
 * contained.
 */
export type ChildNameResolution =
  | { readonly status: 'resolved'; readonly identity: ResolvedChildIdentity }
  | {
      readonly status: 'foreign-store';
      readonly identity: ResolvedChildIdentity;
      readonly foundStoreUid: string;
    }
  | { readonly status: 'ambiguous'; readonly claimants: readonly ChildNameClaimant[] }
  | { readonly status: 'uncommitted'; readonly locators: readonly string[] }
  | { readonly status: 'unresolved' };

function claimantOf(evidence: CommittedChangeEvidence): ChildNameClaimant {
  return {
    changeId: evidence.changeId,
    changeInstanceId: evidence.changeInstanceId,
    projectId: evidence.projectId,
    targetLineId: evidence.targetLineId,
    foundAtRef: evidence.foundAtRef,
    archived: evidence.archived,
  };
}

/**
 * Resolves one child NAME against committed evidence.
 *
 * Candidates are the committed entries the name answers to: an ACTIVE entry
 * whose directory name equals it exactly, or an ARCHIVED entry whose
 * date-prefixed published name (`YYYY-MM-DD-<change>`, or the Store v2
 * `YYYY-MM-DD-<change>--<instanceShort>` form) matches it through the archive
 * engine's own splitter — the one contract that already states how a published
 * archive entry names its change. Archived entries count as evidence because
 * re-publication after children complete is this channel's core dogfood; an
 * active directory that merely LOOKS date-prefixed is never matched, so an
 * unrelated change named `2026-08-07-x` cannot claim the name `x`.
 *
 * The answer groups candidates by the full identity triple (instance, project,
 * line). One Change reachable from several refs is collapsed upstream on
 * identity + digest, and an active-plus-archived pair of ONE change shares one
 * triple, so both stay one identity — while two Changes that merely share a
 * name, in two projects or two lines or one line twice, are two claimants and
 * the name is genuinely underdetermined.
 */
export function resolveChildByName(
  evidence: ReferenceEvidence,
  childId: string
): ChildNameResolution {
  const committed = evidence.committed.filter(
    entry =>
      entry.changeId === childId ||
      (entry.archived && archiveDatePrefixedNameMatches(entry.changeId, childId))
  );

  const identities = new Map<string, CommittedChangeEvidence[]>();
  for (const entry of committed) {
    const key = `${entry.changeInstanceId}/${entry.projectId}/${entry.targetLineId}`;
    const bucket = identities.get(key) ?? [];
    bucket.push(entry);
    identities.set(key, bucket);
  }

  if (identities.size > 1) {
    return {
      status: 'ambiguous',
      claimants: committed.map(claimantOf),
    };
  }
  if (identities.size === 1) {
    const copies = [...(identities.values().next().value as CommittedChangeEvidence[])];
    // Same identity from an active and an archived copy: one Change. The
    // active copy is preferred as the representative, exactly as the
    // instance-keyed resolver prefers it.
    const preferred = copies.find(entry => !entry.archived) ?? copies[0] as CommittedChangeEvidence;
    const identity: ResolvedChildIdentity = {
      changeInstanceId: preferred.changeInstanceId,
      projectId: preferred.projectId,
      targetLineId: preferred.targetLineId,
    };
    if (preferred.storeUid !== evidence.storeUid) {
      return { status: 'foreign-store', identity, foundStoreUid: preferred.storeUid };
    }
    return { status: 'resolved', identity };
  }

  const local = evidence.localWorkspaces.filter(entry => entry.changeId === childId);
  if (local.length > 0) {
    const locators = [...new Set(local.map(entry => entry.planning.root))];
    return { status: 'uncommitted', locators };
  }
  return { status: 'unresolved' };
}

/**
 * The refusal a non-resolved child name refuses with, or null when it
 * resolved. The reader's completeness decides the absence-shaped conclusions:
 * "unresolved" and "uncommitted" both assert committed evidence for the name
 * is EMPTY, which an unsearched ref can always falsify, so either conclusion
 * on an incomplete search becomes `store_query_ref_unreadable` — the same rule
 * `verifyExecutionPlanReferences` applies to an instance-keyed miss. A
 * POSITIVE answer (one identity, or listed claimants) is not re-litigated on
 * ref completeness, also mirroring the instance-keyed verifier, so both
 * publication sources keep one discipline over one evidence family.
 */
export function childNameRefusal(
  childId: string,
  resolution: Exclude<ChildNameResolution, { status: 'resolved' }>,
  reader: RefReader
): ReturnType<typeof issueRefusal> | null {
  const refsSearched = reader.searchedRefs.join(', ') || '(none)';
  switch (resolution.status) {
    case 'foreign-store':
      return issueRefusal(
        'issue_reference_foreign_store',
        `Portfolio child '${childId}' resolved to Change instance '${resolution.identity.changeInstanceId}', which belongs to Store '${resolution.foundStoreUid}', not to this Store.`,
        {
          expected: 'a Change committed under this Store',
          actual: resolution.foundStoreUid,
          target: childId,
          fix: 'An Issue references Changes of its own Store only. Open the Issue in the Store that owns the Change, or land the Change under this Store.',
        }
      );
    case 'ambiguous':
      return issueRefusal(
        'issue_reference_ambiguous',
        `Portfolio child '${childId}' is claimed by ${resolution.claimants.length} committed Changes: ${resolution.claimants
          .map(
            claimant =>
              `${claimant.projectId}/${claimant.targetLineId}/${claimant.changeId}` +
              `${claimant.archived ? ' (archived)' : ''} at ${claimant.foundAtRef}` +
              ` (instance ${claimant.changeInstanceId})`
          )
          .join('; ')}.`,
        {
          expected: '1 committed Change with this name',
          actual: `${resolution.claimants.length} claimants`,
          target: childId,
          fix: 'Resolve the duplication in the Store; Rasen lists every claimant and selects none by ref order, recency, or proximity.',
        }
      );
    case 'uncommitted':
      if (!reader.complete) {
        return unsearchedRefusal(childId, reader);
      }
      return issueRefusal(
        'issue_reference_uncommitted',
        `Portfolio child '${childId}' exists only as a local planning worktree on this machine (${resolution.locators.join('; ')}); no committed Change under this Store's target-line refs carries that name. Refs searched: ${refsSearched}.`,
        {
          expected: "a Change committed under one of this Store's target-line refs",
          actual: 'a local planning worktree on this machine only',
          target: childId,
          fix: 'Land the Change on its target line so the Store carries it. A machine-local worktree is never evidence for a published plan.',
        }
      );
    case 'unresolved':
      if (!reader.complete) {
        return unsearchedRefusal(childId, reader);
      }
      return issueRefusal(
        'issue_reference_unresolved',
        `No committed Change under this Store's target-line refs carries the name portfolio child '${childId}' names, and no local planning worktree does either. Refs searched: ${refsSearched}.`,
        {
          expected: childId,
          actual: '(no match)',
          target: childId,
          fix: "The run-state names the child by its Change directory name; commit that Change under this Store's target-line refs, or correct the run-state.",
        }
      );
  }
}

function unsearchedRefusal(childId: string, reader: RefReader): ReturnType<typeof issueRefusal> {
  return issueRefusal(
    'store_query_ref_unreadable',
    `The child-name search could not read ${reader.unsearchedRefs.length} Store ref(s), so '${childId}' cannot be concluded absent: ${reader.unsearchedRefs
      .map(entry => `${entry.storeRef} (${entry.reason})`)
      .join('; ')}.`,
    {
      expected: 'every Store ref searched',
      actual: `${reader.searchedRefs.length} searched, ${reader.unsearchedRefs.length} unsearched`,
      target: childId,
      fix: 'Make the unreadable refs available in this checkout (they are read as Git objects; nothing is checked out), then retry.',
    }
  );
}

/** The evidence gather for one publication: scope, reader, and evidence snapshot. */
export interface ChildEvidenceSnapshot {
  readonly scope: ResolvedIssueScope;
  readonly reader: RefReader;
  readonly evidence: ReferenceEvidence;
}

/**
 * Gathers the child-resolution evidence: the same Store scope the Issue
 * mutations write through, the same catalogs `verifyExecutionPlanReferences`
 * reads (valid target lines and projects, invalid ones excluded — an invalid
 * catalog is the aggregate query's diagnostic to report, not a ref to search),
 * and one `gatherReferenceEvidence` snapshot over them.
 */
export async function gatherChildEvidence(
  dependencies: StoreIssueDependencies,
  input: {
    readonly store?: string;
    readonly startPath: string;
    readonly globalDataDir?: string;
  }
): Promise<ChildEvidenceSnapshot> {
  const scope = await resolveIssueScope(dependencies, input);
  const targetLines = await listTargetLineEntries(dependencies, scope.registeredRoot);
  const projects = await listProjectEntries(dependencies, scope.registeredRoot);
  // The Issue Module's dependency set is the query's read-only Git surface
  // already; `snapshotProjects` is the one aggregate-query member it does not
  // carry, and neither the reader nor the evidence gather uses it. Composed
  // the same way `verifyExecutionPlanReferences` composes its caller.
  const queryDependencies: StoreQueryDependencies = {
    ...dependencies,
    snapshotProjects: async () => [],
  };
  const reader = new RefReader(queryDependencies, scope.registeredRoot);
  const evidence = await gatherReferenceEvidence(queryDependencies, {
    reader,
    refs: targetLines
      .filter(entry => entry.catalog !== null)
      .map(entry => ({
        targetLineId: entry.targetLineId,
        storeRef: (entry.catalog as NonNullable<typeof entry.catalog>).storeRef,
      })),
    projectIds: projects
      .filter(entry => entry.catalog !== null)
      .map(entry => entry.projectId),
    storeUid: scope.storeUid,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
  });
  return { scope, reader, evidence };
}
