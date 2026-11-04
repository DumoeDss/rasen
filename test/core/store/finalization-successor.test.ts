/**
 * `store-finalization-outcomes-v2` task 5.7 — resolving a superseding Change.
 *
 * The motivating case puts the successor on ANOTHER target line, i.e. on a
 * Store ref that is not checked out here, so the search reads committed
 * metadata as Git BLOBS. Three properties are pinned:
 *
 * - matching is on the re-derived Change-instance identity and nothing else;
 * - exactly one match is required, and several are listed rather than picked;
 * - a ref that cannot be read is UNSEARCHED, which prevents a "not found"
 *   conclusion — so an unreadable ref can never turn a real successor into a
 *   missing one.
 */
import { describe, expect, it } from 'vitest';

import {
  requireSingleSuccessor,
  searchSuccessor,
  type ChangeFinalizationError,
} from '../../../src/core/store/finalization/index.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
} from '../../../src/core/store/planning-identity.js';
import {
  createMemoryFinalizationGit,
  memoryFinalizationDependencies,
  type MemoryGitSeed,
} from '../../helpers/finalization-memory-git.js';

const STORE_UID = '6f7d4d70-3d2c-4a37-9f8a-0f4c1b2e3d55';
const STORE_ROOT = '/store';
const LINE_02 = 'line-0.2';
const LINE_03 = 'line-0.3';
const REF_02 = 'refs/heads/release/0.2';
const REF_03 = 'refs/heads/release/0.3';
const REFS = [
  { targetLineId: LINE_02, storeRef: REF_02 },
  { targetLineId: LINE_03, storeRef: REF_03 },
];

function codeOf(error: unknown): string {
  return (error as ChangeFinalizationError).finalizationCode;
}

function instanceOf(projectId: string, targetLineId: string, seed: string): string {
  return deriveChangeInstanceId({
    planningScopeId: derivePlanningScopeId({ storeUid: STORE_UID, projectId, targetLineId }),
    instanceSeed: seed,
  });
}

function metadata(input: {
  projectId: string;
  targetLineId: string;
  instanceSeed: string;
}): string {
  return [
    'schema: spec-driven',
    'identity:',
    '  version: 2',
    `  instanceSeed: ${input.instanceSeed}`,
    `  instanceId: ${instanceOf(input.projectId, input.targetLineId, input.instanceSeed)}`,
    `  storeUid: ${STORE_UID}`,
    `  projectId: ${input.projectId}`,
    `  targetLineId: ${input.targetLineId}`,
    '',
  ].join('\n');
}

const CURRENT_INSTANCE = instanceOf('app-a', LINE_02, 'a'.repeat(32));
const SUCCESSOR_SEED = 'b'.repeat(32);
const SUCCESSOR_INSTANCE = instanceOf('app-a', LINE_03, SUCCESSOR_SEED);

/** Both refs resolve; the successor lives on line 0.3 as an ACTIVE Change. */
function seedWithSuccessorOnOtherLine(): MemoryGitSeed {
  return {
    commits: ['1'.repeat(40), '2'.repeat(40)],
    refs: {
      [REF_02]: [{ ref: REF_02, oid: '1'.repeat(40), objectType: 'commit' }],
      [REF_03]: [{ ref: REF_03, oid: '2'.repeat(40), objectType: 'commit' }],
    },
    trees: {
      [`${REF_02}:rasen/projects/app-a/changes`]: ['redesign-routing/', 'archive/'],
      [`${REF_03}:rasen/projects/app-a/changes`]: ['next-approach/'],
    },
    blobs: {
      [`${REF_02}:rasen/projects/app-a/changes/redesign-routing/.openspec.yaml`]: metadata({
        projectId: 'app-a',
        targetLineId: LINE_02,
        instanceSeed: 'a'.repeat(32),
      }),
      [`${REF_03}:rasen/projects/app-a/changes/next-approach/.openspec.yaml`]: metadata({
        projectId: 'app-a',
        targetLineId: LINE_03,
        instanceSeed: SUCCESSOR_SEED,
      }),
    },
  };
}

async function search(seed: MemoryGitSeed, overrides: Record<string, unknown> = {}) {
  const git = createMemoryFinalizationGit(seed);
  const result = await searchSuccessor(memoryFinalizationDependencies(git), {
    storeRepositoryRoot: STORE_ROOT,
    supersededBy: SUCCESSOR_INSTANCE,
    refs: REFS,
    projectIds: ['app-a', 'app-b'],
    byTargetLine: null,
    excludeChangeInstanceId: CURRENT_INSTANCE,
    ...overrides,
  } as Parameters<typeof searchSuccessor>[1]);
  return { result, git };
}

describe('a Change cannot supersede itself', () => {
  /**
   * The failure this replaces was a TRUE refusal with a FALSE reason. The
   * search excludes the Change being finalized from its own candidate list, so
   * naming yourself in `--by` produced zero matches and the message "No
   * committed Change metadata under this Store's target-line refs derives the
   * Change instance 'ci_…'". That sentence is wrong: the metadata is right
   * there and it derives exactly that instance. A user reading it goes looking
   * for a missing Change instead of fixing the argument.
   */
  it('names self-supersession as the problem instead of reporting the Change as missing', async () => {
    let thrown: unknown;
    try {
      await search(seedWithSuccessorOnOtherLine(), {
        supersededBy: CURRENT_INSTANCE,
      });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe('finalization_outcome_invalid');
    expect((thrown as Error).message).toContain('cannot supersede itself');
    // The specific sentence that used to be produced, asserted as ABSENT —
    // otherwise a future edit could restore the old wording alongside the new
    // code and this case would not notice.
    expect((thrown as Error).message).not.toContain('No committed Change metadata');
    expect((thrown as ChangeFinalizationError).diagnostic.fix).toContain('abandoned');
  });

  it('refuses before any Git access, so the answer costs no repository read', async () => {
    const git = createMemoryFinalizationGit(seedWithSuccessorOnOtherLine());
    await expect(
      searchSuccessor(memoryFinalizationDependencies(git), {
        storeRepositoryRoot: STORE_ROOT,
        supersededBy: CURRENT_INSTANCE,
        refs: REFS,
        projectIds: ['app-a', 'app-b'],
        byTargetLine: null,
        excludeChangeInstanceId: CURRENT_INSTANCE,
      } as Parameters<typeof searchSuccessor>[1])
    ).rejects.toThrow(/cannot supersede itself/u);
    // Nothing was resolved, listed, or read. This is the Module's stated shape
    // — refuse with no repository access whatsoever when the request is
    // self-contradictory — and it is also what proves the check runs FIRST
    // rather than after a fruitless search.
    expect(git.calls).toEqual([]);
  });

  it('still searches normally when --by names a DIFFERENT instance', async () => {
    // The negative control. Without it, a guard that refused every superseded
    // request would satisfy the two cases above.
    const { result } = await search(seedWithSuccessorOnOtherLine());
    expect(requireSingleSuccessor(result, SUCCESSOR_INSTANCE)).toMatchObject({
      changeInstanceId: SUCCESSOR_INSTANCE,
    });
  });
});

describe('the per-ref blob search', () => {
  it('finds a successor on another target line and records where it was read', async () => {
    const { result } = await search(seedWithSuccessorOnOtherLine());
    const match = requireSingleSuccessor(result, SUCCESSOR_INSTANCE);

    expect(match).toMatchObject({
      changeInstanceId: SUCCESSOR_INSTANCE,
      storeUid: STORE_UID,
      projectId: 'app-a',
      targetLineId: LINE_03,
      changeId: 'next-approach',
      foundAtRef: REF_03,
      blobPath: 'rasen/projects/app-a/changes/next-approach/.openspec.yaml',
      archived: false,
    });
    expect(match.digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('checks nothing out: every read is a blob or a tree at a named ref', async () => {
    const { git } = await search(seedWithSuccessorOnOtherLine());
    for (const call of git.calls) {
      expect(call.startsWith('showBlob ') || call.startsWith('showTree ') || call.startsWith('resolveCommit ')).toBe(
        true
      );
    }
  });

  it('finds a successor that has already been ARCHIVED', async () => {
    const seed = seedWithSuccessorOnOtherLine();
    const { result } = await search({
      ...seed,
      trees: {
        ...seed.trees,
        [`${REF_03}:rasen/projects/app-a/changes`]: ['archive/'],
        [`${REF_03}:rasen/projects/app-a/changes/archive`]: [`${LINE_03}/`],
        [`${REF_03}:rasen/projects/app-a/changes/archive/${LINE_03}`]: [
          '2026-08-01-next-approach--abcdef123456/',
        ],
      },
      blobs: {
        ...seed.blobs,
        [`${REF_03}:rasen/projects/app-a/changes/archive/${LINE_03}/2026-08-01-next-approach--abcdef123456/.openspec.yaml`]:
          metadata({
            projectId: 'app-a',
            targetLineId: LINE_03,
            instanceSeed: SUCCESSOR_SEED,
          }),
      },
    });

    const match = requireSingleSuccessor(result, SUCCESSOR_INSTANCE);
    expect(match.archived).toBe(true);
    expect(match.changeId).toBe('2026-08-01-next-approach--abcdef123456');
  });

  it('never matches on an alias, a directory name, or a branch name', async () => {
    const seed = seedWithSuccessorOnOtherLine();
    // A Change DIRECTORY literally named after the successor's instance id,
    // whose committed identity is a different instance entirely.
    const { result } = await search({
      ...seed,
      trees: {
        ...seed.trees,
        [`${REF_02}:rasen/projects/app-a/changes`]: [`${SUCCESSOR_INSTANCE}/`],
        [`${REF_03}:rasen/projects/app-a/changes`]: [],
      },
      blobs: {
        [`${REF_02}:rasen/projects/app-a/changes/${SUCCESSOR_INSTANCE}/.openspec.yaml`]:
          metadata({
            projectId: 'app-a',
            targetLineId: LINE_02,
            instanceSeed: 'c'.repeat(32),
          }),
      },
    });

    expect(result.matches).toEqual([]);
    // The CODE is pinned, not merely "it threw": the interesting distinction is
    // `successor_scope_unverified` (nothing derived that instance) versus
    // `successor_ambiguous` (several did), and a bare `.toThrow()` could not
    // tell those apart — nor an unrelated `TypeError` from either.
    let thrown: unknown;
    try {
      requireSingleSuccessor(result, SUCCESSOR_INSTANCE);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('successor_scope_unverified');
    expect((thrown as Error).message).toContain(SUCCESSOR_INSTANCE);
  });

  it('finds a cross-project successor so the canonical validator can refuse it', async () => {
    const crossProject = instanceOf('app-b', LINE_02, SUCCESSOR_SEED);
    const { result } = await search(
      {
        commits: ['1'.repeat(40), '2'.repeat(40)],
        refs: {
          [REF_02]: [{ ref: REF_02, oid: '1'.repeat(40), objectType: 'commit' }],
          [REF_03]: [{ ref: REF_03, oid: '2'.repeat(40), objectType: 'commit' }],
        },
        trees: {
          [`${REF_02}:rasen/projects/app-b/changes`]: ['other-project-change/'],
        },
        blobs: {
          [`${REF_02}:rasen/projects/app-b/changes/other-project-change/.openspec.yaml`]:
            metadata({
              projectId: 'app-b',
              targetLineId: LINE_02,
              instanceSeed: SUCCESSOR_SEED,
            }),
        },
      },
      { supersededBy: crossProject }
    );

    // The SEARCH finds it — refusing a cross-project supersession is child 1's
    // validator's job, and the search must hand it a real scope to refuse.
    const match = requireSingleSuccessor(result, crossProject);
    expect(match.projectId).toBe('app-b');
  });
});

describe('the exactly-one requirement', () => {
  it('refuses zero matches, naming what an id is never allowed to be', () => {
    let thrown: unknown;
    try {
      requireSingleSuccessor(
        { matches: [], unsearched: [], unreadable: [], searchedRefs: [REF_02, REF_03] },
        SUCCESSOR_INSTANCE
      );
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('successor_scope_unverified');
    expect((thrown as ChangeFinalizationError).diagnostic.fix).toContain(
      'a Change alias, a directory name, or a branch name is never accepted'
    );
  });

  /**
   * A blob that exists but cannot be parsed (here: no v2 identity block) must
   * not be indistinguishable from a blob that is absent. Before the
   * `unreadable` field, this scenario produced "No committed Change metadata
   * derives 'ci_…'" — false, because the metadata IS there, just unreadable.
   * That message sent the user looking for a missing Change instead of fixing
   * the one that exists, and in a `superseded` finalization it fail-opened: the
   * successor scope check passed on a false "no successor exists" conclusion.
   */
  it('refuses when the only candidate is unreadable, rather than concluding not found', async () => {
    const seed = seedWithSuccessorOnOtherLine();
    // Replace the successor's metadata with content that parses as YAML but
    // fails ChangeMetadataSchema (no identity block).
    seed.blobs[`${REF_03}:rasen/projects/app-a/changes/next-approach/.openspec.yaml`] =
      'schema: spec-driven\n';

    const { result } = await search(seed);
    expect(result.matches).toHaveLength(0);
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0].blobPath).toContain('next-approach');

    let thrown: unknown;
    try {
      requireSingleSuccessor(result, SUCCESSOR_INSTANCE);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('successor_scope_unverified');
    expect((thrown as Error).message).toContain('could not be parsed');
    expect((thrown as Error).message).toContain('next-approach');
    // The distinguishing signal: the generic zero-match message's fix says
    // "Pass the successor's real Change instance id"; the unreadable gate's
    // fix says "Repair". This is what separates "not found" from "found but
    // unreadable" at the level the operator acts on.
    expect((thrown as ChangeFinalizationError).diagnostic.fix).toContain('Repair');
  });

  it('refuses several matches, listing every claimant and choosing none', async () => {
    const seed = seedWithSuccessorOnOtherLine();
    const { result } = await search({
      ...seed,
      trees: {
        ...seed.trees,
        [`${REF_02}:rasen/projects/app-a/changes`]: ['duplicate-claimant/'],
      },
      blobs: {
        ...seed.blobs,
        // A DIFFERENT blob (different seed field ordering is not possible here,
        // so use a distinct trailing comment) that derives the same instance —
        // two real claimants, not one Change reachable from two refs.
        [`${REF_02}:rasen/projects/app-a/changes/duplicate-claimant/.openspec.yaml`]:
          `${metadata({
            projectId: 'app-a',
            targetLineId: LINE_03,
            instanceSeed: SUCCESSOR_SEED,
          })}# a second, distinct claimant\n`,
      },
    });

    let thrown: unknown;
    try {
      requireSingleSuccessor(result, SUCCESSOR_INSTANCE);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('successor_ambiguous');
    expect((thrown as Error).message).toContain('duplicate-claimant');
    expect((thrown as Error).message).toContain('next-approach');
    expect((thrown as ChangeFinalizationError).diagnostic.fix).toContain('selects none');
  });

  it('treats one Change reachable from two refs as one claimant, not two', async () => {
    const seed = seedWithSuccessorOnOtherLine();
    const body = metadata({
      projectId: 'app-a',
      targetLineId: LINE_03,
      instanceSeed: SUCCESSOR_SEED,
    });
    const { result } = await search({
      ...seed,
      trees: {
        ...seed.trees,
        [`${REF_02}:rasen/projects/app-a/changes`]: ['next-approach/'],
      },
      blobs: {
        // Byte-identical blob at the same path on a merged line.
        [`${REF_02}:rasen/projects/app-a/changes/next-approach/.openspec.yaml`]: body,
        [`${REF_03}:rasen/projects/app-a/changes/next-approach/.openspec.yaml`]: body,
      },
    });

    expect(result.matches).toHaveLength(1);
    expect(requireSingleSuccessor(result, SUCCESSOR_INSTANCE).changeInstanceId).toBe(
      SUCCESSOR_INSTANCE
    );
  });

  it('never lets a Change supersede itself, and REFUSES rather than returning empty', async () => {
    // This case used to assert `result.matches` was `[]` — which was true, and
    // was the defect. An empty result is indistinguishable from "the successor
    // does not exist", so the caller went on to report a missing Change. The
    // property is that self-supersession is REFUSED by name; see the dedicated
    // describe block at the top of this file for the diagnostic itself.
    await expect(
      search(seedWithSuccessorOnOtherLine(), { supersededBy: CURRENT_INSTANCE })
    ).rejects.toThrow(/cannot supersede itself/u);
  });
});

describe('unreadable refs', () => {
  it('reports an unreadable ref as UNSEARCHED rather than concluding "not found"', async () => {
    const seed = seedWithSuccessorOnOtherLine();
    const { result } = await search({
      ...seed,
      // line 0.3 does not exist in this checkout: exactly the case where the
      // successor really is there but cannot be seen.
      refs: { [REF_02]: [{ ref: REF_02, oid: '1'.repeat(40), objectType: 'commit' }] },
      commits: ['1'.repeat(40)],
    });

    expect(result.searchedRefs).toEqual([REF_02]);
    expect(result.unsearched).toEqual([
      {
        targetLineId: LINE_03,
        storeRef: REF_03,
        reason: 'the Store ref does not resolve to a commit in this checkout',
      },
    ]);

    let thrown: unknown;
    try {
      requireSingleSuccessor(result, SUCCESSOR_INSTANCE);
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('successor_scope_unverified');
    expect((thrown as Error).message).toContain(REF_03);
    expect((thrown as Error).message).toContain('cannot be concluded absent');
  });

  it('still resolves when exactly one match was found despite an unsearched ref', async () => {
    const seed = seedWithSuccessorOnOtherLine();
    const { result } = await search({
      ...seed,
      refs: { [REF_03]: [{ ref: REF_03, oid: '2'.repeat(40), objectType: 'commit' }] },
      commits: ['2'.repeat(40)],
    });

    expect(result.unsearched.map(entry => entry.storeRef)).toEqual([REF_02]);
    expect(requireSingleSuccessor(result, SUCCESSOR_INSTANCE).foundAtRef).toBe(REF_03);
  });
});

describe('--by-target-line', () => {
  it('narrows the ref set', async () => {
    const { git } = await search(seedWithSuccessorOnOtherLine(), {
      byTargetLine: LINE_03,
    });
    expect(git.calls.some(call => call.includes(REF_02))).toBe(false);
    expect(git.calls.some(call => call.includes(REF_03))).toBe(true);
  });

  it('can never substitute for identity verification', async () => {
    // The filter selects the line the successor is really on, and the candidate
    // there is a DIFFERENT instance. Narrowing does not make it a match.
    const seed = seedWithSuccessorOnOtherLine();
    const { result } = await search(
      {
        ...seed,
        blobs: {
          [`${REF_03}:rasen/projects/app-a/changes/next-approach/.openspec.yaml`]: metadata({
            projectId: 'app-a',
            targetLineId: LINE_03,
            instanceSeed: 'f'.repeat(32),
          }),
        },
      },
      { byTargetLine: LINE_03 }
    );

    expect(result.matches).toEqual([]);
    expect(() => requireSingleSuccessor(result, SUCCESSOR_INSTANCE)).toThrow(
      /successor|derives the Change instance/u
    );
  });
});
