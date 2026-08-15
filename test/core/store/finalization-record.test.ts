/**
 * `store-finalization-outcomes-v2` task 7.7 — the Archive v2 destination and
 * the record producer.
 *
 * Two properties this suite exists to pin, both of which a reviewer can only
 * take on faith otherwise:
 *
 * 1. The destination comes from the layout contract and from the FROZEN target
 *    line — so a same-day retry with a different Change instance addresses a
 *    different entry BY CONSTRUCTION, not because a caller remembered to add a
 *    suffix.
 * 2. Every identity in the record is obtained verified or the production
 *    refuses. A well-formed placeholder that makes the schema validate is
 *    precisely the failure the record contract exists to prevent, so the
 *    serializer refusals are asserted against deliberately inconsistent drafts.
 */
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateArchiveV2Draft } from '../../../src/core/archive-accounting-v2.js';
import { archiveV2EvidenceEntries } from '../../../src/core/archive-accounting-v2.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
  type VerifiedChangeInstanceId,
} from '../../../src/core/store/planning-identity.js';
import {
  archiveEntryAddress,
  assertFrozenTargetLine,
  buildArchiveV2RecordDraft,
  workspacePairUnavailable,
  type ChangeFinalizationError,
} from '../../../src/core/store/finalization/index.js';
import { serializeArchiveV2 } from '../../../src/core/store/finalization-v2.js';

const STORE_UID = '6f7d4d70-3d2c-4a37-9f8a-0f4c1b2e3d55';
const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';
const DATE = '2026-08-07';
const ROOT = process.platform === 'win32' ? 'C:\\store' : '/store';

function codeOf(error: unknown): string {
  return (error as ChangeFinalizationError).finalizationCode;
}

/**
 * The record schema's refusal, measured rather than assumed.
 *
 * The four record shapes are a discriminated UNION, so a draft that matches no
 * member fails at the union root and Zod cannot name the offending field — the
 * message really is `archive: root: Invalid input`. Pinning it anyway is what
 * distinguishes "the schema rejected this draft" from "some unrelated
 * `TypeError` was raised", which a bare `.toThrow()` cannot do. The paired
 * `expect(…).not.toThrow()` positive controls in this suite are what stop the
 * pattern from being satisfiable by a serializer that rejects everything.
 */
const SCHEMA_REFUSAL = /archive: root: Invalid input/u;

const scopeId = derivePlanningScopeId({
  storeUid: STORE_UID,
  projectId: PROJECT,
  targetLineId: LINE,
});
const instanceA = deriveChangeInstanceId({
  planningScopeId: scopeId,
  instanceSeed: 'a'.repeat(32),
}) as VerifiedChangeInstanceId;
const instanceB = deriveChangeInstanceId({
  planningScopeId: scopeId,
  instanceSeed: 'b'.repeat(32),
}) as VerifiedChangeInstanceId;
const planningWorktree = deriveWorktreeInstanceId({
  repositoryIdentity: 'repo-store',
  worktreeIdentity: '/planning',
});
const executionWorktree = deriveWorktreeInstanceId({
  repositoryIdentity: 'repo-code',
  worktreeIdentity: '/execution',
});
const pairA = deriveWorkspacePairId({
  changeInstanceId: instanceA,
  planningWorktreeInstanceId: planningWorktree,
  executionWorktreeInstanceId: executionWorktree,
});

const scope = {
  storeUid: STORE_UID,
  storeId: 'team-store',
  storeRoot: ROOT,
  projectId: PROJECT,
  targetLineId: LINE,
  planningScopeId: scopeId,
};

const planningFacts = {
  root: '/planning',
  worktreeInstanceId: planningWorktree,
  repositoryIdentity: 'repo-store',
  ref: 'refs/heads/change/line-0.2/app-a/redesign-routing',
  headOid: 'a'.repeat(40),
};
const executionFacts = {
  root: '/execution',
  worktreeInstanceId: executionWorktree,
  repositoryIdentity: 'repo-code',
  ref: 'refs/heads/feature',
  headOid: 'b'.repeat(40),
};

function draft(overrides: Record<string, unknown> = {}) {
  return buildArchiveV2RecordDraft({
    outcome: 'abandoned',
    reason: 'The approach was replaced.',
    supersededBy: null,
    implementation: 'code',
    scope,
    changeId: CHANGE,
    changeInstanceId: instanceA,
    workspacePairId: pairA,
    planning: planningFacts,
    execution: executionFacts,
    planningTargetRef: 'refs/heads/release/0.2',
    landedProof: null,
    specActions: [],
    archivedAt: '2026-08-07T00:00:00.000Z',
    ...overrides,
  } as Parameters<typeof buildArchiveV2RecordDraft>[0]);
}

describe('Archive v2 destination construction', () => {
  it('addresses the entry through the layout contract under the frozen line', () => {
    const address = archiveEntryAddress({
      storeRoot: ROOT,
      projectId: PROJECT,
      frozenTargetLineId: LINE,
      changeId: CHANGE,
      archiveDate: DATE,
      changeInstanceId: instanceA,
    });

    expect(address).toBe(
      path.join(ROOT, 'rasen', 'projects', PROJECT, 'changes', 'archive', LINE, path.basename(address))
    );
    expect(path.basename(address)).toMatch(
      new RegExp(`^${DATE}-${CHANGE}--[0-9a-f]{12}$`, 'u')
    );
  });

  it('gives a same-day retry with a different Change instance a different address', () => {
    const first = archiveEntryAddress({
      storeRoot: ROOT,
      projectId: PROJECT,
      frozenTargetLineId: LINE,
      changeId: CHANGE,
      archiveDate: DATE,
      changeInstanceId: instanceA,
    });
    const second = archiveEntryAddress({
      storeRoot: ROOT,
      projectId: PROJECT,
      frozenTargetLineId: LINE,
      changeId: CHANGE,
      archiveDate: DATE,
      changeInstanceId: instanceB,
    });

    expect(second).not.toBe(first);
    // Same directory, same date, same alias: only the instance suffix differs,
    // which is what makes the uniqueness structural.
    expect(path.dirname(second)).toBe(path.dirname(first));
  });

  it('files under the FROZEN line even when a different line is resolved', () => {
    const frozen = archiveEntryAddress({
      storeRoot: ROOT,
      projectId: PROJECT,
      frozenTargetLineId: LINE,
      changeId: CHANGE,
      archiveDate: DATE,
      changeInstanceId: instanceA,
    });
    const other = archiveEntryAddress({
      storeRoot: ROOT,
      projectId: PROJECT,
      frozenTargetLineId: 'line-0.3',
      changeId: CHANGE,
      archiveDate: DATE,
      changeInstanceId: instanceA,
    });

    expect(frozen).toContain(`${path.sep}${LINE}${path.sep}`);
    expect(other).toContain(`${path.sep}line-0.3${path.sep}`);
  });

  it('refuses a malformed Change instance rather than returning a path', () => {
    expect(() =>
      archiveEntryAddress({
        storeRoot: ROOT,
        projectId: PROJECT,
        frozenTargetLineId: LINE,
        changeId: CHANGE,
        archiveDate: DATE,
        changeInstanceId: 'ci_not-hex' as VerifiedChangeInstanceId,
      })
    ).toThrow(/ci_<64 lowercase hex>/u);
  });
});

describe('the frozen target-line gate', () => {
  it('passes silently when the resolved line is the frozen one', () => {
    expect(() =>
      assertFrozenTargetLine({
        changeId: CHANGE,
        frozenTargetLineId: LINE,
        resolvedTargetLineId: LINE,
      })
    ).not.toThrow();
  });

  it('refuses a mismatch naming both lines and stating nothing was computed', () => {
    let thrown: unknown;
    try {
      assertFrozenTargetLine({
        changeId: CHANGE,
        frozenTargetLineId: LINE,
        resolvedTargetLineId: 'line-0.3',
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('target_line_mismatch');
    expect((thrown as Error).message).toContain(LINE);
    expect((thrown as Error).message).toContain('line-0.3');
    expect((thrown as ChangeFinalizationError).diagnostic.fix).toContain(
      'no destination was computed'
    );
  });
});

describe('the two identity refusals', () => {
  it('refuses rather than minting a workspace pair, and names the repair', () => {
    const error = workspacePairUnavailable(CHANGE, 'no binding is recorded');
    expect(codeOf(error)).toBe('workspace_pair_unavailable');
    expect(error.message).toContain(CHANGE);
    expect(error.message).toContain('no binding is recorded');
    expect((error as ChangeFinalizationError).diagnostic.fix).toContain(
      'never derives a pair identifier from a path'
    );
  });

  it('refuses a record whose pair id does not derive from its own identities', () => {
    const wrongPair = deriveWorkspacePairId({
      changeInstanceId: instanceB,
      planningWorktreeInstanceId: planningWorktree,
      executionWorktreeInstanceId: executionWorktree,
    });
    let thrown: unknown;
    try {
      draft({ workspacePairId: wrongPair });
    } catch (error) {
      thrown = error;
    }
    // A passive record does not cross-check the pair — its schema has no
    // execution worktree to check against — so it ACCEPTS this draft, and that
    // acceptance is the fact worth pinning. Asserted directly rather than as
    // `thrown === undefined || codeOf(thrown) === '…'`, which was satisfied by
    // the `undefined` half alone and therefore asserted nothing at all here.
    expect(thrown).toBeUndefined();

    expect(() =>
      draft({
        outcome: 'landed',
        reason: null,
        workspacePairId: wrongPair,
        landedProof: {
          source: 'flag',
          commit: 'c'.repeat(40),
          codeRef: 'refs/heads/release/0.2',
          codeRefOid: 'd'.repeat(40),
          reachable: true,
          statedAgainst: 'local-ref',
          repositoryRoot: '/execution',
        },
      })
    ).toThrow(/finalization_record_invalid|does not validate/u);
  });
});

describe('the four record shapes', () => {
  it('builds a landed code-backed record carrying its proof', () => {
    const record = draft({
      outcome: 'landed',
      reason: null,
      landedProof: {
        source: 'ship-log',
        commit: 'c'.repeat(40),
        codeRef: 'refs/heads/release/0.2',
        codeRefOid: 'd'.repeat(40),
        reachable: true,
        statedAgainst: 'local-ref',
        repositoryRoot: '/execution',
      },
    }) as unknown as Record<string, unknown>;

    expect(record.outcome).toBe('landed');
    expect(record.reason).toBeNull();
    expect(record.codeMerge).toMatchObject({
      // The portable repository fact is the project id: no `repo_...` identity
      // is minted anywhere in this portfolio.
      repoUid: PROJECT,
      worktreeInstanceId: executionWorktree,
      targetRef: 'refs/heads/release/0.2',
      commit: 'c'.repeat(40),
      reachable: true,
    });
    expect(record.specSync).toEqual({ applied: true, actions: [] });
  });

  it('builds a landed planning-only record with no code merge at all', () => {
    const record = draft({
      outcome: 'landed',
      reason: null,
      implementation: 'none',
      landedProof: null,
    }) as unknown as Record<string, unknown>;

    expect(record.implementation).toBe('none');
    expect(record.codeMerge).toBeNull();
    expect(record.specSync).toEqual({ applied: true, actions: [] });
  });

  it('builds superseded, cancelled, and abandoned records as passive history', () => {
    const superseded = draft({
      outcome: 'superseded',
      reason: 'The work moved to the next line.',
      supersededBy: instanceB,
    }) as unknown as Record<string, unknown>;
    expect(superseded.supersededBy).toBe(instanceB);
    expect(superseded.codeMerge).toBeNull();
    expect(superseded.specSync).toEqual({ applied: false, actions: [] });

    for (const outcome of ['cancelled', 'abandoned'] as const) {
      const record = draft({ outcome, reason: 'Not pursued.' }) as unknown as Record<
        string,
        unknown
      >;
      expect(record.outcome).toBe(outcome);
      expect(record.supersededBy).toBeNull();
      expect(record.specSync).toEqual({ applied: false, actions: [] });
    }
  });

  it('refuses a code-backed landed record with no proven code merge', () => {
    let thrown: unknown;
    try {
      draft({ outcome: 'landed', reason: null, implementation: 'code', landedProof: null });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('landed_proof_unavailable');
  });

  it('refuses a passive record that carries any spec action', () => {
    let thrown: unknown;
    try {
      draft({
        specActions: [
          {
            action: 'create',
            capabilityId: 'some-capability',
            beforeSha256: null,
            afterSha256: 'e'.repeat(64),
          },
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('finalization_record_invalid');
    expect((thrown as Error).message).toContain('passive history');
  });
});

describe('evidence mapping and the serializer refusals', () => {
  it('maps evidence to portable relative paths with lowercase digests, sorted', () => {
    const entries = archiveV2EvidenceEntries([
      { path: 'evidence/ship-log.md', sha256: 'AB'.repeat(32) },
      { path: 'evidence/quality/review.md', sha256: 'cd'.repeat(32) },
    ]);

    expect(entries).toEqual([
      { path: 'evidence/quality/review.md', sha256: 'cd'.repeat(32) },
      { path: 'evidence/ship-log.md', sha256: 'ab'.repeat(32) },
    ]);
  });

  it('refuses a landed record whose reachability is not proven', () => {
    // `reachable` is typed `z.literal(true)`, so an unproven landed record
    // cannot even be constructed — the schema refuses the value, not a flag.
    expect(() =>
      validateArchiveV2Draft({
        schemaVersion: 2,
        implementation: 'code',
        storeUid: STORE_UID,
        projectId: PROJECT,
        targetLineId: LINE,
        changeId: CHANGE,
        changeInstanceId: instanceA,
        workspacePairId: pairA,
        outcome: 'landed',
        reason: null,
        supersededBy: null,
        planning: {
          worktreeInstanceId: planningWorktree,
          sourceRef: planningFacts.ref,
          sourceHead: planningFacts.headOid,
          targetRef: 'refs/heads/release/0.2',
        },
        codeMerge: {
          repoUid: PROJECT,
          worktreeInstanceId: executionWorktree,
          targetRef: 'refs/heads/release/0.2',
          commit: 'c'.repeat(40),
          reachable: false,
        },
        specSync: { applied: true, actions: [] },
        archivedAt: '2026-08-07T00:00:00.000Z',
      } as never)
    ).toThrow(SCHEMA_REFUSAL);
  });

  it('refuses to serialize a passive record carrying an action, producing no bytes', () => {
    const passive = draft() as unknown as Record<string, unknown>;
    expect(() =>
      serializeArchiveV2({
        ...passive,
        evidence: [],
        missing: [],
        specSync: {
          applied: false,
          actions: [
            {
              action: 'create',
              capabilityId: 'some-capability',
              beforeSha256: null,
              afterSha256: 'e'.repeat(64),
            },
          ],
        },
      } as never)
    ).toThrow(SCHEMA_REFUSAL);
  });

  it('serializes a valid record and round-trips it byte for byte', () => {
    const passive = draft() as unknown as Record<string, unknown>;
    const content = serializeArchiveV2({
      ...passive,
      evidence: [],
      missing: [],
    } as never);
    expect(JSON.parse(content)).toMatchObject({
      schemaVersion: 2,
      outcome: 'abandoned',
      changeInstanceId: instanceA,
      workspacePairId: pairA,
    });
  });
});
