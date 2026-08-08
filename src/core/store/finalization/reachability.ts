/**
 * The landed proof.
 *
 * A landed record asserts that the code the Change describes is reachable from
 * the code ref the Change's OWN target line declares for its project. That is
 * proven, never assumed from the fact that a delivery happened and never
 * inferred from a branch name. Every uncertain answer refuses.
 *
 * Rasen fetches nothing. The proof is therefore stated as being against the ref
 * AS IT STANDS LOCALLY, and the ref's OID at proof time is frozen so a ref that
 * moves invalidates the plan rather than being silently re-proven against new
 * history. That direction is safe: an ancestor of an older ref is an ancestor
 * of its descendant, so a stale local ref can only fail closed.
 */
import { finalizationError, finalizationRefusal } from './diagnostics.js';
import type { FinalizationDependencies } from './dependencies.js';
import type { FinalizationLandedProof } from './types.js';

export interface CodeCommitCandidate {
  readonly source: 'flag' | 'ship-log' | 'execution-head';
  readonly value: string;
}

/**
 * Resolves the candidate commit in fixed priority and records which source
 * supplied it. An explicit `--commit` wins, then the ship log's recorded
 * commit, then the execution worktree's HEAD.
 */
export function resolveCodeCommitCandidate(input: {
  readonly flagCommit: string | null;
  readonly shipLogCommit: string | null;
  readonly executionHeadOid: string | null;
}): CodeCommitCandidate | null {
  if (input.flagCommit !== null && input.flagCommit.length > 0) {
    return { source: 'flag', value: input.flagCommit };
  }
  if (input.shipLogCommit !== null && input.shipLogCommit.length > 0) {
    return { source: 'ship-log', value: input.shipLogCommit };
  }
  if (input.executionHeadOid !== null && input.executionHeadOid.length > 0) {
    return { source: 'execution-head', value: input.executionHeadOid };
  }
  return null;
}

export interface ProveLandedInput {
  readonly repositoryRoot: string;
  readonly candidate: CodeCommitCandidate;
  readonly codeRef: string | null;
  readonly changeId: string;
  readonly targetLineId: string;
  readonly projectId: string;
}

/**
 * Proves the candidate. Order matters: the commit must name a commit object,
 * the target line's code ref must resolve to a commit, and only then is
 * ancestry asked. Each failure has its own diagnostic and names both object
 * identifiers and the ref.
 */
export async function proveLandedReachability(
  dependencies: FinalizationDependencies,
  input: ProveLandedInput
): Promise<FinalizationLandedProof> {
  if (input.codeRef === null) {
    throw finalizationRefusal(
      'target_line_ref_unresolved',
      `Target line '${input.targetLineId}' carries no code locator for project '${input.projectId}', so a landed outcome cannot be proven.`,
      {
        expected: `projects.${input.projectId}.codeRef`,
        actual: '(none)',
        target: input.targetLineId,
        fix: `Record one with 'rasen store target-line set-ref ${input.targetLineId} --project ${input.projectId} --code-ref refs/heads/<branch>', then retry. Resolution never falls back to HEAD or to a similarly named ref.`,
      }
    );
  }

  const commit = await dependencies.git.resolveCommit(
    input.repositoryRoot,
    input.candidate.value
  );
  if (commit === null) {
    throw finalizationRefusal(
      'landed_commit_unresolved',
      `Commit '${input.candidate.value}' (from ${describeSource(input.candidate.source)}) does not name a commit object in ${input.repositoryRoot}.`,
      {
        expected: 'a commit object',
        actual: input.candidate.value,
        target: input.repositoryRoot,
        fix: 'Supply a commit that exists in this repository with --commit <oid>, or land the code first. Rasen fetches nothing.',
      }
    );
  }

  const refTargets = await dependencies.git.resolveRef(input.repositoryRoot, input.codeRef);
  if (refTargets.length === 0) {
    throw finalizationRefusal(
      'target_line_ref_unresolved',
      `Target-line code ref '${input.codeRef}' names no ref in the project repository (${input.repositoryRoot}).`,
      {
        expected: input.codeRef,
        actual: '(no matching ref)',
        target: input.repositoryRoot,
        fix: `Create '${input.codeRef}' locally or re-point the locator with 'rasen store target-line set-ref'. Rasen fetches nothing and never falls back to HEAD.`,
      }
    );
  }
  if (refTargets.length > 1) {
    throw finalizationRefusal(
      'target_line_ref_unresolved',
      `Target-line code ref '${input.codeRef}' is ambiguous in ${input.repositoryRoot}: ${refTargets
        .map(target => `${target.ref}=${target.oid}`)
        .join(', ')}.`,
      {
        expected: 'exactly one ref',
        actual: `${refTargets.length} refs`,
        target: input.repositoryRoot,
        fix: 'Remove the duplicate ref so exactly one object is named.',
      }
    );
  }
  const refTarget = refTargets[0] as { oid: string; objectType: string };
  const codeRefOid =
    refTarget.objectType === 'commit'
      ? refTarget.oid
      : await dependencies.git.resolveCommit(input.repositoryRoot, input.codeRef);
  if (codeRefOid === null) {
    throw finalizationRefusal(
      'target_line_ref_unresolved',
      `Target-line code ref '${input.codeRef}' resolves to a ${refTarget.objectType}, not a commit, in ${input.repositoryRoot}.`,
      {
        expected: 'a commit',
        actual: refTarget.objectType,
        target: input.repositoryRoot,
        fix: 'Point the locator at a branch, or at a tag of a commit.',
      }
    );
  }

  const reachable = await dependencies.git.isAncestor(
    input.repositoryRoot,
    commit,
    codeRefOid
  );
  if (reachable === null) {
    throw finalizationError(
      'landed_proof_unavailable',
      `Git could not determine whether commit ${commit} is an ancestor of ${input.codeRef} (${codeRefOid}) in ${input.repositoryRoot}; reachability is never defaulted.`,
      {
        target: input.repositoryRoot,
        fix: 'Repair the repository so the ancestry query answers, then retry. Rasen records neither true nor false for an answer it does not have.',
      }
    );
  }
  if (!reachable) {
    throw finalizationRefusal(
      'landed_commit_unreachable',
      `Commit ${commit} is not an ancestor of target line '${input.targetLineId}' code ref ${input.codeRef} as it stands locally.`,
      {
        expected: `an ancestor of ${input.codeRef} (${codeRefOid})`,
        actual: commit,
        target: input.repositoryRoot,
        fix: `Merge the work into ${input.codeRef} and fetch it locally, then retry. Rasen fetches nothing, so the proof is against the ref as it stands in ${input.repositoryRoot}.`,
      }
    );
  }

  return {
    source: input.candidate.source,
    commit,
    codeRef: input.codeRef,
    codeRefOid,
    reachable: true,
    statedAgainst: 'local-ref',
    repositoryRoot: input.repositoryRoot,
  };
}

/**
 * The refusal for a code-backed Change that can supply no candidate at all. It
 * names BOTH repairs and offers no bypass: there is deliberately no
 * `--implementation` flag, because planning-only intent is declared in the
 * Change and committed, never asserted at the moment it would otherwise have to
 * prove something.
 */
export function undeclaredImplementationRefusal(changeId: string): Error {
  return finalizationRefusal(
    'landed_implementation_undeclared',
    `Change '${changeId}' has no committed 'implementation: none' declaration and no resolvable code commit, so a landed outcome cannot be proven.`,
    {
      expected: "either 'implementation: none' in the Change's committed metadata, or a reachable code commit",
      actual: '(neither)',
      target: changeId,
      fix: `Either declare it in the Change and commit that ('implementation: none' in .openspec.yaml), or land the code and retry with --commit <oid>. There is no archive-time flag that declares a Change planning-only.`,
    }
  );
}

function describeSource(source: CodeCommitCandidate['source']): string {
  if (source === 'flag') return '--commit';
  if (source === 'ship-log') return 'the ship log';
  return 'the execution worktree HEAD';
}
