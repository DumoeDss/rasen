/**
 * `store-finalization-outcomes-v2` task 4.8 — the landed reachability proof.
 *
 * A landed record asserts that the code the Change describes is reachable from
 * the code ref the Change's OWN target line declares. This suite pins that the
 * assertion is a PROOF: every commit source is recorded rather than assumed,
 * every uncertain answer refuses, and `reachable` is never defaulted in either
 * direction. The indeterminate case is the one that matters most and is the one
 * real Git will not produce on demand — hence the in-memory adapter.
 */
import { describe, expect, it } from 'vitest';

import {
  proveLandedReachability,
  resolveCodeCommitCandidate,
  undeclaredImplementationRefusal,
  type ChangeFinalizationError,
} from '../../../src/core/store/finalization/index.js';
import {
  createMemoryFinalizationGit,
  memoryFinalizationDependencies,
  type MemoryGitSeed,
} from '../../helpers/finalization-memory-git.js';

const REPO = '/execution';
const CODE_REF = 'refs/heads/release/0.2';
const LANDED = 'a'.repeat(40);
const REF_TIP = 'b'.repeat(40);
const UNRELATED = 'c'.repeat(40);

function codeOf(error: unknown): string {
  return (error as ChangeFinalizationError).finalizationCode;
}

function proveWith(seed: MemoryGitSeed, overrides: Record<string, unknown> = {}) {
  const git = createMemoryFinalizationGit(seed);
  return proveLandedReachability(memoryFinalizationDependencies(git), {
    repositoryRoot: REPO,
    candidate: { source: 'flag', value: LANDED },
    codeRef: CODE_REF,
    changeId: 'redesign-routing',
    targetLineId: 'line-0.2',
    projectId: 'app-a',
    ...overrides,
  } as Parameters<typeof proveLandedReachability>[1]);
}

const REACHABLE: MemoryGitSeed = {
  commits: [LANDED, REF_TIP, UNRELATED],
  refs: { [CODE_REF]: [{ ref: CODE_REF, oid: REF_TIP, objectType: 'commit' }] },
  ancestors: { [REF_TIP]: [LANDED] },
};

describe('commit source resolution, in fixed priority', () => {
  it('prefers an explicit --commit over every other source', () => {
    expect(
      resolveCodeCommitCandidate({
        flagCommit: LANDED,
        shipLogCommit: REF_TIP,
        executionHeadOid: UNRELATED,
      })
    ).toEqual({ source: 'flag', value: LANDED });
  });

  it("falls back to the ship log's recorded commit", () => {
    expect(
      resolveCodeCommitCandidate({
        flagCommit: null,
        shipLogCommit: REF_TIP,
        executionHeadOid: UNRELATED,
      })
    ).toEqual({ source: 'ship-log', value: REF_TIP });
  });

  it('falls back to the execution worktree HEAD last', () => {
    expect(
      resolveCodeCommitCandidate({
        flagCommit: null,
        shipLogCommit: null,
        executionHeadOid: UNRELATED,
      })
    ).toEqual({ source: 'execution-head', value: UNRELATED });
  });

  it('supplies no candidate at all rather than inventing one', () => {
    expect(
      resolveCodeCommitCandidate({
        flagCommit: null,
        shipLogCommit: null,
        executionHeadOid: null,
      })
    ).toBeNull();
    // An empty string is not a commit; it must not be promoted to one.
    expect(
      resolveCodeCommitCandidate({ flagCommit: '', shipLogCommit: '', executionHeadOid: '' })
    ).toBeNull();
  });
});

describe('the proof', () => {
  it('proves a reachable commit and records the source, the ref, and its frozen OID', async () => {
    const proof = await proveWith(REACHABLE, {
      candidate: { source: 'ship-log', value: LANDED },
    });

    expect(proof).toEqual({
      source: 'ship-log',
      commit: LANDED,
      codeRef: CODE_REF,
      codeRefOid: REF_TIP,
      reachable: true,
      // Stated honestly: Rasen fetches nothing, so the claim is against the ref
      // as it stands in this repository.
      statedAgainst: 'local-ref',
      repositoryRoot: REPO,
    });
  });

  it('refuses a commit that names no commit object, naming the source', async () => {
    let thrown: unknown;
    try {
      await proveWith({ ...REACHABLE, commits: [REF_TIP] });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('landed_commit_unresolved');
    expect((thrown as Error).message).toContain('--commit');
    expect((thrown as Error).message).toContain(REPO);
  });

  it('refuses an unresolvable target-line code ref and never falls back to HEAD', async () => {
    let thrown: unknown;
    try {
      await proveWith({ commits: [LANDED], refs: {} });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('target_line_ref_unresolved');
    expect((thrown as ChangeFinalizationError).diagnostic.fix).toContain(
      'never falls back to HEAD'
    );
  });

  it('refuses a target line carrying no code locator for this project', async () => {
    let thrown: unknown;
    try {
      await proveWith(REACHABLE, { codeRef: null });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('target_line_ref_unresolved');
    expect((thrown as ChangeFinalizationError).expected).toBe('projects.app-a.codeRef');
  });

  /**
   * SCOPE NOTE, so nobody mistakes this for a reachable production state.
   *
   * Refnames are unique in a repository, and `nodeFinalizationGit.resolveRef`
   * builds its list from `git for-each-ref … <ref>` and then keeps only
   * `parts[0] === ref` (`dependencies.ts`), so the filtered list has AT MOST
   * one element. This two-element seed therefore cannot arise through the
   * production adapter — the case pins the behaviour of the pure prover given
   * an ambiguous list, not a state real Git will hand it.
   *
   * It is still worth keeping: the prover is the component that must not pick
   * one OID and continue, and a future adapter (a bare repository, a
   * multi-remote listing, a substituted read-only Git) could supply a list this
   * one cannot. The ambiguity real Git DOES produce — a short name matching
   * both `refs/heads/x` and `refs/tags/x` — is excluded by construction,
   * because the target-line catalog stores full ref names.
   */
  it('refuses an ambiguous code ref listing every object it names', async () => {
    let thrown: unknown;
    try {
      await proveWith({
        commits: [LANDED],
        refs: {
          [CODE_REF]: [
            { ref: CODE_REF, oid: REF_TIP, objectType: 'commit' },
            { ref: CODE_REF, oid: UNRELATED, objectType: 'commit' },
          ],
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('target_line_ref_unresolved');
    expect((thrown as Error).message).toContain(REF_TIP);
    expect((thrown as Error).message).toContain(UNRELATED);
  });

  it('refuses an unreachable commit naming both OIDs and the ref', async () => {
    let thrown: unknown;
    try {
      await proveWith({ ...REACHABLE, ancestors: { [REF_TIP]: [] } });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('landed_commit_unreachable');
    expect((thrown as Error).message).toContain(LANDED);
    expect((thrown as ChangeFinalizationError).expected).toContain(REF_TIP);
    expect((thrown as Error).message).toContain(CODE_REF);
  });

  it('refuses an INDETERMINATE ancestry answer instead of defaulting either way', async () => {
    let thrown: unknown;
    try {
      await proveWith({
        ...REACHABLE,
        indeterminate: [`${LANDED}->${REF_TIP}`],
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('landed_proof_unavailable');
    expect((thrown as Error).message).toContain('reachability is never defaulted');
    // Specifically NOT collapsed into "not reachable": those are different
    // facts and only one of them is knowable here.
    expect(codeOf(thrown)).not.toBe('landed_commit_unreachable');
  });

  it('refuses a ref that resolves to something other than a commit', async () => {
    let thrown: unknown;
    try {
      await proveWith({
        commits: [LANDED],
        refs: { [CODE_REF]: [{ ref: CODE_REF, oid: REF_TIP, objectType: 'tree' }] },
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('target_line_ref_unresolved');
    expect((thrown as Error).message).toContain('tree');
  });

  it('freezes the ref OID at proof time, so a ref that moves makes the plan stale', async () => {
    const first = await proveWith(REACHABLE);
    const moved = 'd'.repeat(40);
    const second = await proveWith({
      commits: [LANDED, moved],
      refs: { [CODE_REF]: [{ ref: CODE_REF, oid: moved, objectType: 'commit' }] },
      ancestors: { [moved]: [LANDED] },
    });

    expect(first.codeRefOid).toBe(REF_TIP);
    expect(second.codeRefOid).toBe(moved);
    // The proof carries the OID, not just the ref name, which is what lets
    // revalidation notice the move rather than silently re-proving.
    expect(second.codeRefOid).not.toBe(first.codeRefOid);
  });
});

describe('the planning-only path', () => {
  it('refuses a code-backed Change with no declaration and no commit, naming both repairs', () => {
    const error = undeclaredImplementationRefusal('redesign-routing');
    expect(codeOf(error)).toBe('landed_implementation_undeclared');
    expect(error.message).toContain('redesign-routing');
    const fix = (error as ChangeFinalizationError).diagnostic.fix as string;
    expect(fix).toContain("'implementation: none'");
    expect(fix).toContain('--commit <oid>');
    // There is deliberately no archive-time flag that declares a Change
    // planning-only; the refusal says so rather than offering one.
    expect(fix).toContain('no archive-time flag');
  });
});
