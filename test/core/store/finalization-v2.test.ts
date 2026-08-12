import { describe, expect, it } from 'vitest';

import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
  parseArchiveV2,
  parseFinalizationOutcome,
  serializeArchiveV2,
  validateArchiveV2,
  validateFinalizationOutcome,
  verifyArchiveV2,
  type FinalizationScopeRecord,
} from '../../../src/core/store/planning-foundation.js';

const BOM = String.fromCharCode(0xfeff);

const STORE_UID = '9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0';
const PROJECT_ID = '8a0c76e8-faa9-49dc-b0d1-c35df3ad797f';
const OTHER_PROJECT_ID = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const OID = 'a'.repeat(40);
const BEFORE = 'b'.repeat(64);
const AFTER = 'c'.repeat(64);

function changeInstance(targetLineId = 'line-0.2', seed = '11'.repeat(16)) {
  return deriveChangeInstanceId({
    planningScopeId: derivePlanningScopeId({
      storeUid: STORE_UID,
      projectId: PROJECT_ID,
      targetLineId,
    }),
    instanceSeed: seed,
  });
}

const CHANGE_INSTANCE = changeInstance();
const SUCCESSOR_INSTANCE = changeInstance('line-0.3', '22'.repeat(16));
const PLANNING_WORKTREE = deriveWorktreeInstanceId({
  repositoryIdentity: 'repo:store',
  worktreeIdentity: 'worktree:planning',
});
const EXECUTION_WORKTREE = deriveWorktreeInstanceId({
  repositoryIdentity: 'repo:code',
  worktreeIdentity: 'worktree:execution',
});
const WORKSPACE_PAIR = deriveWorkspacePairId({
  changeInstanceId: CHANGE_INSTANCE,
  planningWorktreeInstanceId: PLANNING_WORKTREE,
  executionWorktreeInstanceId: EXECUTION_WORKTREE,
});

function scope(
  overrides: Partial<FinalizationScopeRecord> = {}
): FinalizationScopeRecord {
  return {
    storeUid: STORE_UID,
    projectId: PROJECT_ID,
    targetLineId: 'line-0.2',
    changeInstanceId: CHANGE_INSTANCE,
    ...overrides,
  };
}

function archiveBase() {
  return {
    schemaVersion: 2,
    implementation: 'code',
    storeUid: STORE_UID,
    projectId: PROJECT_ID,
    targetLineId: 'line-0.2',
    changeId: 'refresh-cache',
    changeInstanceId: CHANGE_INSTANCE,
    workspacePairId: WORKSPACE_PAIR,
    outcome: 'landed',
    reason: null,
    supersededBy: null,
    planning: {
      worktreeInstanceId: PLANNING_WORKTREE,
      sourceRef: 'refs/heads/change/refresh-cache',
      sourceHead: OID,
      targetRef: 'refs/heads/release/0.2',
    },
    codeMerge: {
      repoUid: 'repo:code',
      worktreeInstanceId: EXECUTION_WORKTREE,
      targetRef: 'refs/heads/release/0.2',
      commit: OID,
      reachable: true,
    },
    specSync: {
      applied: true,
      actions: [] as unknown[],
    },
    evidence: [
      {
        path: 'evidence/verification-report.md',
        sha256: AFTER,
      },
    ],
    missing: ['ship-log'],
    archivedAt: '2026-08-04T00:00:00.000Z',
  };
}

describe('finalization outcome v2', () => {
  it.each([
    { outcome: 'landed' },
    { outcome: 'superseded', reason: 'Replaced by the next line', supersededBy: SUCCESSOR_INSTANCE },
    { outcome: 'cancelled', reason: 'No longer needed' },
    { outcome: 'abandoned', reason: 'The implementation was discarded' },
  ])('accepts the valid $outcome shape', value => {
    expect(parseFinalizationOutcome(value)).toEqual(value);
  });

  it.each([
    { outcome: 'landed', reason: 'contradiction' },
    { outcome: 'superseded', reason: 'missing successor' },
    { outcome: 'superseded', reason: '', supersededBy: SUCCESSOR_INSTANCE },
    { outcome: 'cancelled', reason: 'no successor', supersededBy: SUCCESSOR_INSTANCE },
    { outcome: 'abandoned', reason: 'no successor', supersededBy: SUCCESSOR_INSTANCE },
    { outcome: 'unknown' },
  ])('rejects contradictory outcome shape %#', value => {
    expect(() => parseFinalizationOutcome(value)).toThrow(/outcome/u);
  });

  it('allows supersession across target lines in the same Store project', () => {
    const outcome = {
      outcome: 'superseded',
      reason: 'Ported to the next target line',
      supersededBy: SUCCESSOR_INSTANCE,
    };
    expect(
      validateFinalizationOutcome(
        outcome,
        scope(),
        scope({ targetLineId: 'line-0.3', changeInstanceId: SUCCESSOR_INSTANCE })
      )
    ).toEqual(outcome);
  });

  it('fails closed for missing, mismatched, or cross-project successor scope', () => {
    const outcome = {
      outcome: 'superseded',
      reason: 'Replaced',
      supersededBy: SUCCESSOR_INSTANCE,
    };
    expect(() => validateFinalizationOutcome(outcome, scope())).toThrow(/required/u);
    expect(() =>
      validateFinalizationOutcome(
        outcome,
        scope(),
        scope({ targetLineId: 'line-0.3', changeInstanceId: CHANGE_INSTANCE })
      )
    ).toThrow(/does not match/u);
    expect(() =>
      validateFinalizationOutcome(
        outcome,
        scope(),
        scope({
          projectId: OTHER_PROJECT_ID,
          targetLineId: 'line-0.3',
          changeInstanceId: SUCCESSOR_INSTANCE,
        })
      )
    ).toThrow(/same permanent Store and project/u);
  });
});

describe('Archive v2 contract', () => {
  it('accepts complete reachable code-backed landed accounting', () => {
    const archive = validateArchiveV2(archiveBase());
    expect(archive.outcome).toBe('landed');
    expect(archive.implementation).toBe('code');
    expect(archive.codeMerge).not.toBeNull();
  });

  it('rejects a correctly shaped workspace-pair digest that mismatches present preimages', () => {
    const value = {
      ...archiveBase(),
      workspacePairId: `wp_${'f'.repeat(64)}`,
    };
    expect(() => validateArchiveV2(value)).toThrow(/workspacePairId/u);
  });

  it('retains a shape-only workspace-pair wire id when execution preimages are absent', () => {
    const workspacePairId = `wp_${'f'.repeat(64)}`;
    const value = {
      ...archiveBase(),
      implementation: 'none',
      workspacePairId,
      codeMerge: null,
    };
    expect(validateArchiveV2(value).workspacePairId).toBe(workspacePairId);
  });

  it.each([
    () => ({ ...archiveBase(), codeMerge: null }),
    () => ({
      ...archiveBase(),
      codeMerge: { ...archiveBase().codeMerge, reachable: false },
    }),
    () => {
      const value = archiveBase();
      const { commit: _commit, ...withoutCommit } = value.codeMerge;
      return { ...value, codeMerge: withoutCommit };
    },
  ])('rejects missing or unreachable code-merge proof', createValue => {
    expect(() => validateArchiveV2(createValue())).toThrow(/archive/u);
  });

  it('accepts planning-only landed accounting without a fabricated code commit', () => {
    const value = {
      ...archiveBase(),
      implementation: 'none',
      codeMerge: null,
    };
    const parsed = validateArchiveV2(value);
    expect(parsed.implementation).toBe('none');
    expect(parsed.codeMerge).toBeNull();
  });

  it.each(['superseded', 'cancelled', 'abandoned'] as const)(
    'accepts passive %s history only with null merge and unapplied empty spec sync',
    outcome => {
      const value = {
        ...archiveBase(),
        outcome,
        reason: `${outcome} for a recorded reason`,
        supersededBy: outcome === 'superseded' ? SUCCESSOR_INSTANCE : null,
        codeMerge: null,
        specSync: { applied: false, actions: [] },
      };
      expect(validateArchiveV2(value).outcome).toBe(outcome);
    }
  );

  it('rejects passive-history spec mutations without changing the input bytes', () => {
    const value = {
      ...archiveBase(),
      outcome: 'abandoned',
      reason: 'Discarded',
      codeMerge: null,
      specSync: {
        applied: false,
        actions: [
          {
            action: 'create',
            capabilityId: 'auth',
            beforeSha256: null,
            afterSha256: AFTER,
          },
        ],
      },
    };
    const before = JSON.stringify(value);
    expect(() => serializeArchiveV2(value)).toThrow(/archive/u);
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each([
    { action: 'create', capabilityId: 'auth', beforeSha256: null, afterSha256: AFTER },
    { action: 'update', capabilityId: 'auth', beforeSha256: BEFORE, afterSha256: AFTER },
    { action: 'delete', capabilityId: 'auth', beforeSha256: BEFORE, afterSha256: null },
  ])('accepts the $action spec-action digest matrix', action => {
    const value = archiveBase();
    value.specSync.actions = [action];
    expect(validateArchiveV2(value).specSync.actions).toEqual([action]);
  });

  it.each([
    { action: 'create', capabilityId: 'auth', beforeSha256: BEFORE, afterSha256: AFTER },
    { action: 'create', capabilityId: 'auth', beforeSha256: null, afterSha256: null },
    { action: 'update', capabilityId: 'auth', beforeSha256: null, afterSha256: AFTER },
    { action: 'delete', capabilityId: 'auth', beforeSha256: BEFORE, afterSha256: AFTER },
  ])('rejects contradictory $action digest shape', action => {
    const value = archiveBase();
    value.specSync.actions = [action];
    expect(() => validateArchiveV2(value)).toThrow(/archive/u);
  });

  // A capability's canonical address is a slash-delimited PATH of kebab
  // segments, not a single kebab id (design Decision 7). Every other fixture
  // in this file uses the single-segment `auth`, which passes both the ported
  // contract and the single-kebab rule this child replaced, so only a real
  // nested address can tell them apart.
  it.each(['store/planning-layout-v2', 'store/planning/layout-v2', 'auth'])(
    'accepts capability address %s and preserves it verbatim',
    capabilityId => {
      const action = {
        action: 'create',
        capabilityId,
        beforeSha256: null,
        afterSha256: AFTER,
      };
      const value = archiveBase();
      value.specSync.actions = [action];
      expect(validateArchiveV2(value).specSync.actions).toEqual([action]);
      expect(parseArchiveV2(serializeArchiveV2(value)).specSync.actions).toEqual([action]);
    }
  );

  it.each([
    { label: 'empty', capabilityId: '' },
    { label: 'current directory', capabilityId: '.' },
    { label: 'parent directory', capabilityId: '..' },
    { label: 'traversal segment', capabilityId: 'store/../auth' },
    { label: 'empty inner segment', capabilityId: 'store//auth' },
    { label: 'leading separator', capabilityId: '/store' },
    { label: 'trailing separator', capabilityId: 'store/' },
    { label: 'backslash separator', capabilityId: String.raw`store\auth` },
    { label: 'non-canonical case', capabilityId: 'Store/Auth' },
  ])('rejects a $label capability address', ({ capabilityId }) => {
    const value = archiveBase();
    value.specSync.actions = [
      { action: 'create', capabilityId, beforeSha256: null, afterSha256: AFTER },
    ];
    expect(() => validateArchiveV2(value)).toThrow(/archive/u);
  });

  it.each([
    '/absolute/report.md',
    'C:/absolute/report.md',
    '../escape.md',
    'evidence/../escape.md',
    'evidence/report?.md',
    'evidence/report|name.md',
    'evidence/con.txt',
  ])('rejects non-portable evidence path %s', evidencePath => {
    const value = archiveBase();
    value.evidence = [{ path: evidencePath, sha256: AFTER }];
    expect(() => validateArchiveV2(value)).toThrow(/archive/u);
  });

  it('rejects case-alias evidence duplicates and duplicate missing names', () => {
    const evidenceDuplicate = archiveBase();
    evidenceDuplicate.evidence = [
      { path: 'evidence/Report.md', sha256: AFTER },
      { path: 'evidence/report.md', sha256: BEFORE },
    ];
    expect(() => validateArchiveV2(evidenceDuplicate)).toThrow(/duplicates/u);

    const missingDuplicate = archiveBase();
    missingDuplicate.missing = ['ship-log', 'Ship-Log'];
    expect(() => validateArchiveV2(missingDuplicate)).toThrow(/duplicates/u);
  });

  it('rejects unknown top-level and nested fields', () => {
    expect(() => validateArchiveV2({ ...archiveBase(), localPath: 'C:/repo' })).toThrow(
      /archive/u
    );
    const nested = archiveBase();
    nested.planning = { ...nested.planning, branchName: 'release/0.2' } as typeof nested.planning;
    expect(() => validateArchiveV2(nested)).toThrow(/archive/u);
  });

  it('serializes deterministically with two spaces, one newline, and no BOM', () => {
    const forward = archiveBase();
    const reverse = Object.fromEntries(Object.entries(forward).reverse());
    const first = serializeArchiveV2(forward);
    const second = serializeArchiveV2(reverse as typeof forward);
    expect(second).toBe(first);
    expect(first.startsWith(BOM)).toBe(false);
    expect(first.endsWith('\n')).toBe(true);
    expect(first.endsWith('\n\n')).toBe(false);
    expect(first).toContain('\n  "schemaVersion": 2');
    expect(parseArchiveV2(first)).toEqual(validateArchiveV2(forward));
    expect(verifyArchiveV2(first, forward)).toEqual(validateArchiveV2(forward));
  });

  it('rejects BOM-prefixed JSON and missing stable scope fields', () => {
    const serialized = serializeArchiveV2(archiveBase());
    expect(() => parseArchiveV2(`${BOM}${serialized}`)).toThrow(/BOM/u);
    const { projectId: _projectId, ...withoutProject } = archiveBase();
    expect(() => validateArchiveV2(withoutProject)).toThrow(/archive/u);
  });
});
