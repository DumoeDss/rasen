/**
 * Resolving a superseding Change to verified scope evidence.
 *
 * The whole motivating case — "0.1.7 is abandoned, the work moved to 0.2.0" —
 * puts the successor on ANOTHER target line, i.e. on a Store ref that is not
 * checked out here. So the search reads committed metadata as Git BLOBS across
 * the Store refs the target-line catalogs name, including Archive entries,
 * because a Change may be superseded by one that is already finalized.
 *
 * Matching is on the re-derived Change-instance identity and nothing else — not
 * a Change alias, not a directory name, not a branch name, not adjacency.
 * Exactly one match is required. A ref that cannot be read is reported as
 * UNSEARCHED and prevents a "not found" conclusion, so an unreadable ref can
 * never turn a real successor into a missing one.
 */
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

import { ChangeMetadataSchema } from '../../change-metadata/index.js';
import { finalizationRefusal } from './diagnostics.js';
import type { FinalizationDependencies } from './dependencies.js';
import type { FinalizationSuccessorEvidence } from './types.js';

export interface SuccessorSearchRef {
  readonly targetLineId: string;
  readonly storeRef: string;
}

export interface SuccessorSearchInput {
  readonly storeRepositoryRoot: string;
  readonly supersededBy: string;
  readonly refs: readonly SuccessorSearchRef[];
  /** Project partitions to search, from the Store's project catalogs. */
  readonly projectIds: readonly string[];
  /** Narrows the ref set. A filter, never a substitute for verification. */
  readonly byTargetLine: string | null;
  /** The Change being finalized; it can never supersede itself. */
  readonly excludeChangeInstanceId: string;
}

export interface UnsearchedRef {
  readonly targetLineId: string;
  readonly storeRef: string;
  readonly reason: string;
}

/**
 * A Change whose committed metadata was found but could not be understood.
 *
 * It is reported separately from a match and from an absence because those are
 * three different facts, and collapsing the third into the second is fail-open
 * in the one direction this search exists to close: a `superseded` outcome
 * REQUIRES a successor to exist, so "zero matches" must never be allowed to
 * mean "the successor is there and I could not read it".
 */
export interface UnreadableCandidate {
  readonly storeRef: string;
  readonly blobPath: string;
  readonly reason: string;
}

export interface SuccessorSearchResult {
  readonly matches: readonly FinalizationSuccessorEvidence[];
  readonly unsearched: readonly UnsearchedRef[];
  /** Candidates found but not parseable. Never silently dropped. */
  readonly unreadable: readonly UnreadableCandidate[];
  readonly searchedRefs: readonly string[];
}

/**
 * What reading one candidate produced. `absent` and `unreadable` were the same
 * `null` before, which is what made a malformed Change indistinguishable from
 * one that is not there.
 */
type CandidateOutcome =
  | { readonly kind: 'match'; readonly evidence: FinalizationSuccessorEvidence }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string };

function changesTreePath(projectId: string): string {
  return `rasen/projects/${projectId}/changes`;
}

function archiveTreePath(projectId: string): string {
  return `rasen/projects/${projectId}/changes/archive`;
}

function directoryNames(entries: readonly string[]): string[] {
  return entries
    .filter(entry => entry.endsWith('/'))
    .map(entry => entry.slice(0, -1))
    .filter(entry => entry.length > 0);
}

/**
 * Reads one candidate's committed metadata as a blob and re-derives its
 * identity. A blob that is never coerced into a candidate — but the REASON it
 * is not one is carried out, because "there is no such file" and "the file is
 * there and I cannot understand it" are different answers and only the first
 * one supports concluding that a successor does not exist.
 *
 * The trigger that made this concrete: a Change whose `instanceSeed` was
 * written unquoted and all-numeric parses as a YAML *number*, so
 * `ChangeMetadataSchema` rejects it and the Change becomes invisible to every
 * blob-reading consumer. With the old `null`, a `superseded` finalization
 * naming that Change was refused as "no committed Change metadata derives this
 * instance" — which pointed at the wrong thing entirely.
 */
async function candidateFrom(
  dependencies: FinalizationDependencies,
  input: {
    readonly storeRepositoryRoot: string;
    readonly ref: string;
    readonly targetLineId: string;
    readonly blobPath: string;
    readonly changeId: string;
    readonly archived: boolean;
  }
): Promise<CandidateOutcome> {
  const text = await dependencies.git.showBlob(
    input.storeRepositoryRoot,
    input.ref,
    input.blobPath
  );
  // Nothing at that path. A directory under `changes/` that carries no Change
  // metadata at all is not a Change, and reporting it would make every
  // stray directory block a supersession.
  if (text === null) return { kind: 'absent' };
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    return {
      kind: 'unreadable',
      reason: `the Change metadata is not valid YAML (${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      })`,
    };
  }
  const parsed = ChangeMetadataSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: 'unreadable',
      reason: `the Change metadata does not satisfy the Change metadata schema (${parsed.error.issues
        .slice(0, 3)
        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')})`,
    };
  }
  const identity = parsed.data.identity;
  if (identity === undefined) {
    return {
      kind: 'unreadable',
      reason: 'the Change metadata carries no v2 identity block, so no Change instance can be derived from it',
    };
  }
  return {
    kind: 'match',
    evidence: {
      changeInstanceId: identity.instanceId,
      storeUid: identity.storeUid,
      projectId: identity.projectId,
      targetLineId: identity.targetLineId,
      changeId: input.changeId,
      foundAtRef: input.ref,
      blobPath: input.blobPath,
      digest: createHash('sha256').update(text, 'utf8').digest('hex'),
      archived: input.archived,
    },
  };
}

export async function searchSuccessor(
  dependencies: FinalizationDependencies,
  input: SuccessorSearchInput
): Promise<SuccessorSearchResult> {
  // A Change cannot supersede itself, and saying so is not the same as failing
  // to find it. The de-duplication below removes the Change being finalized
  // from its own candidate list, so without this the search completes with zero
  // matches and reports "no committed Change metadata derives the instance
  // 'ci_…'" — which is FALSE. It derives exactly one Change: the one being
  // finalized. Refused here, before any Git access, so the user is told the
  // real problem rather than sent looking for a Change that is not missing.
  if (input.supersededBy === input.excludeChangeInstanceId) {
    throw finalizationRefusal(
      'finalization_outcome_invalid',
      `Change instance '${input.supersededBy}' is the Change being finalized, and a Change cannot supersede itself.`,
      {
        expected: 'the Change instance that CONTINUES the work',
        actual: `${input.supersededBy} (the Change being finalized)`,
        target: input.supersededBy,
        fix: 'Pass the successor Change instance to --by. If the work was not continued anywhere, the outcome is --outcome abandoned or --outcome cancelled, not superseded.',
      }
    );
  }

  const refs =
    input.byTargetLine === null
      ? input.refs
      : input.refs.filter(entry => entry.targetLineId === input.byTargetLine);
  const matches: FinalizationSuccessorEvidence[] = [];
  const unsearched: UnsearchedRef[] = [];
  const unreadable: UnreadableCandidate[] = [];
  const searchedRefs: string[] = [];

  const collect = (outcome: CandidateOutcome, ref: string, blobPath: string): void => {
    if (outcome.kind === 'match') matches.push(outcome.evidence);
    else if (outcome.kind === 'unreadable') {
      unreadable.push({ storeRef: ref, blobPath, reason: outcome.reason });
    }
  };

  for (const entry of refs) {
    const reachable = await dependencies.git.resolveCommit(
      input.storeRepositoryRoot,
      entry.storeRef
    );
    if (reachable === null) {
      unsearched.push({
        targetLineId: entry.targetLineId,
        storeRef: entry.storeRef,
        reason: 'the Store ref does not resolve to a commit in this checkout',
      });
      continue;
    }
    searchedRefs.push(entry.storeRef);

    for (const projectId of input.projectIds) {
      const active = await dependencies.git.showTree(
        input.storeRepositoryRoot,
        entry.storeRef,
        changesTreePath(projectId)
      );
      for (const changeId of directoryNames(active ?? []).filter(
        name => name !== 'archive'
      )) {
        const blobPath = `${changesTreePath(projectId)}/${changeId}/.openspec.yaml`;
        const candidate = await candidateFrom(dependencies, {
          storeRepositoryRoot: input.storeRepositoryRoot,
          ref: entry.storeRef,
          targetLineId: entry.targetLineId,
          blobPath,
          changeId,
          archived: false,
        });
        collect(candidate, entry.storeRef, blobPath);
      }

      // Archive entries live one level deeper: `archive/<targetLineId>/<entry>`.
      const archiveLines = await dependencies.git.showTree(
        input.storeRepositoryRoot,
        entry.storeRef,
        archiveTreePath(projectId)
      );
      for (const lineId of directoryNames(archiveLines ?? [])) {
        const entries = await dependencies.git.showTree(
          input.storeRepositoryRoot,
          entry.storeRef,
          `${archiveTreePath(projectId)}/${lineId}`
        );
        for (const archiveEntry of directoryNames(entries ?? [])) {
          const blobPath = `${archiveTreePath(projectId)}/${lineId}/${archiveEntry}/.openspec.yaml`;
          const candidate = await candidateFrom(dependencies, {
            storeRepositoryRoot: input.storeRepositoryRoot,
            ref: entry.storeRef,
            targetLineId: entry.targetLineId,
            blobPath,
            changeId: archiveEntry,
            archived: true,
          });
          collect(candidate, entry.storeRef, blobPath);
        }
      }
    }
  }

  const byInstance = matches.filter(
    candidate =>
      candidate.changeInstanceId === input.supersededBy &&
      candidate.changeInstanceId !== input.excludeChangeInstanceId
  );
  // One Change reachable from two Store refs is the same Change, not two
  // claimants: de-duplicate on the identity plus the blob digest before
  // deciding ambiguity, so a merged line does not read as a conflict.
  const distinct = new Map<string, FinalizationSuccessorEvidence>();
  for (const candidate of byInstance) {
    const key = `${candidate.changeInstanceId}\u0000${candidate.projectId}\u0000${candidate.changeId}\u0000${candidate.digest}`;
    if (!distinct.has(key)) distinct.set(key, candidate);
  }

  return {
    matches: [...distinct.values()].sort((left, right) =>
      `${left.foundAtRef}${left.blobPath}`.localeCompare(`${right.foundAtRef}${right.blobPath}`)
    ),
    unreadable,
    unsearched,
    searchedRefs,
  };
}

/**
 * Requires exactly one match. Zero is unverified successor scope; several is
 * ambiguous, listing every claimant and choosing none. An unsearched ref
 * prevents the zero case from concluding "not found".
 */
export function requireSingleSuccessor(
  result: SuccessorSearchResult,
  supersededBy: string
): FinalizationSuccessorEvidence {
  if (result.unsearched.length > 0 && result.matches.length !== 1) {
    throw finalizationRefusal(
      'successor_scope_unverified',
      `The successor search could not read ${result.unsearched.length} Store ref(s), so '${supersededBy}' cannot be concluded absent: ${result.unsearched
        .map(entry => `${entry.storeRef} (${entry.reason})`)
        .join('; ')}.`,
      {
        expected: 'every Store ref searched',
        actual: `${result.searchedRefs.length} searched, ${result.unsearched.length} unsearched`,
        target: supersededBy,
        fix: 'Make the unreadable refs available in this checkout (they are read as Git objects; nothing is checked out), or narrow the search with --by-target-line, then retry.',
      }
    );
  }
  if (result.matches.length === 0) {
    // A zero-match result is unsafe when candidates were found but not
    // parseable: the named successor may be present but unreadable, which is
    // not the same as absent. Failing open here lets a `superseded`
    // finalization through on a false "no successor exists" conclusion —
    // the exact gap the `unreadable` field exists to close.
    if (result.unreadable.length > 0) {
      throw finalizationRefusal(
        'successor_scope_unverified',
        `No committed Change metadata under this Store's target-line refs derives the Change instance '${supersededBy}', but ${result.unreadable.length} candidate(s) could not be parsed, so the successor may be present but unreadable: ${result.unreadable
          .map(entry => `${entry.blobPath} at ${entry.storeRef} (${entry.reason})`)
          .join('; ')}.`,
        {
          expected: supersededBy,
          actual: `${result.matches.length} matchable, ${result.unreadable.length} unreadable`,
          target: supersededBy,
          fix: 'Repair or restore the unreadable Change metadata so the successor can be verified, then retry.',
        }
      );
    }
    throw finalizationRefusal(
      'successor_scope_unverified',
      `No committed Change metadata under this Store's target-line refs derives the Change instance '${supersededBy}'.`,
      {
        expected: supersededBy,
        actual: '(no match)',
        target: supersededBy,
        fix: "Pass the successor's real Change instance id — a Change alias, a directory name, or a branch name is never accepted — and make sure its metadata is committed on one of this Store's target-line refs.",
      }
    );
  }
  if (result.matches.length > 1) {
    throw finalizationRefusal(
      'successor_ambiguous',
      `Change instance '${supersededBy}' is claimed by ${result.matches.length} candidates: ${result.matches
        .map(match => `${match.projectId}/${match.changeId} at ${match.foundAtRef}`)
        .join('; ')}.`,
      {
        expected: '1 claimant',
        actual: `${result.matches.length} claimants`,
        target: supersededBy,
        fix: 'Resolve the duplication in the Store; Rasen lists every claimant and selects none by ref order, recency, or proximity.',
      }
    );
  }
  return result.matches[0] as FinalizationSuccessorEvidence;
}
