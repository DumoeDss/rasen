import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalJson } from '../../../src/core/canonical-json.js';
import { ChangeMetadataSchema } from '../../../src/core/change-metadata/index.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
  isChangeInstanceId,
  isPlanningScopeId,
  isWorkspacePairId,
  isWorktreeInstanceId,
  mintChangeInstanceSeed,
  parseCanonicalLocalIdentity,
  parseChangeInstanceId,
  parseChangeInstanceSeed,
  parsePlanningScopeId,
  parseWorkspacePairId,
  parseWorktreeInstanceId,
  verifyChangeInstanceId,
  verifyPlanningScopeId,
  verifyWorktreeInstanceId,
  verifyWorkspacePairId,
  StorePlanningValidationError,
} from '../../../src/core/store/planning-foundation.js';
import {
  readChangeMetadata,
  writeChangeMetadata,
} from '../../../src/utils/change-metadata.js';

const STORE_UID = '9d1d9f4b-8fd8-45d8-b5ef-f0c7a28491d0';
const PROJECT_A = '8a0c76e8-faa9-49dc-b0d1-c35df3ad797f';
const PROJECT_B = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const SEED_A = '12'.repeat(16);
const SEED_B = '34'.repeat(16);

function identity(
  projectId = PROJECT_A,
  targetLineId = 'line-0.2',
  instanceSeed = SEED_A
) {
  const planningScopeId = derivePlanningScopeId({
    storeUid: STORE_UID,
    projectId,
    targetLineId,
  });
  return {
    planningScopeId,
    instanceId: deriveChangeInstanceId({ planningScopeId, instanceSeed }),
  };
}

describe('Store planning v2 identities', () => {
  it('derives canonical, typed, domain-separated ids', () => {
    const scope = identity().planningScopeId;
    const change = deriveChangeInstanceId({ planningScopeId: scope, instanceSeed: SEED_A });
    const worktree = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:store:1',
      worktreeIdentity: 'worktree:planning:1',
    });
    const execution = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:code:1',
      worktreeIdentity: 'worktree:execution:1',
    });
    const pair = deriveWorkspacePairId({
      changeInstanceId: change,
      planningWorktreeInstanceId: worktree,
      executionWorktreeInstanceId: execution,
    });

    expect(scope).toMatch(/^ps_[0-9a-f]{64}$/u);
    expect(change).toMatch(/^ci_[0-9a-f]{64}$/u);
    expect(worktree).toMatch(/^wt_[0-9a-f]{64}$/u);
    expect(pair).toMatch(/^wp_[0-9a-f]{64}$/u);
    expect(new Set([scope.slice(3), change.slice(3), worktree.slice(3), pair.slice(3)]).size).toBe(
      4
    );
  });

  it('is deterministic across input insertion order and Store UID spelling', () => {
    const forward = derivePlanningScopeId({
      storeUid: STORE_UID,
      projectId: PROJECT_A,
      targetLineId: 'line-0.2',
    });
    const reverseInput = {
      targetLineId: 'line-0.2',
      projectId: PROJECT_A,
      storeUid: ` ${STORE_UID.toUpperCase()} `,
    };
    expect(derivePlanningScopeId(reverseInput)).toBe(forward);
    expect(
      canonicalJson({ z: 1, a: { y: 2, x: 3 } })
    ).toBe(canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));
  });

  it('changes across projects, target lines, and attempt seeds', () => {
    const baseline = identity();
    expect(identity(PROJECT_B).planningScopeId).not.toBe(baseline.planningScopeId);
    expect(identity(PROJECT_A, 'line-0.1').planningScopeId).not.toBe(
      baseline.planningScopeId
    );
    expect(identity(PROJECT_A, 'line-0.2', SEED_B).instanceId).not.toBe(
      baseline.instanceId
    );
    expect(identity(PROJECT_A, 'line-0.1', SEED_A).instanceId).not.toBe(
      baseline.instanceId
    );
  });

  it('does not accept branch, ref, Change alias, or platform path inputs', () => {
    const windowsFacts = {
      storeUid: STORE_UID,
      projectId: PROJECT_A,
      targetLineId: 'line-0.2',
      storeRoot: 'C:\\stores\\example',
      branch: 'refs/heads/old-name',
      changeId: 'old-alias',
    };
    const posixFacts = {
      storeUid: STORE_UID,
      projectId: PROJECT_A,
      targetLineId: 'line-0.2',
      storeRoot: '/srv/stores/example',
      branch: 'refs/heads/renamed',
      changeId: 'renamed-alias',
    };
    const first = derivePlanningScopeId(windowsFacts);
    const moved = derivePlanningScopeId(posixFacts);
    expect(moved).toBe(first);
    expect(
      deriveChangeInstanceId({ planningScopeId: first, instanceSeed: SEED_A })
    ).toBe(deriveChangeInstanceId({ planningScopeId: moved, instanceSeed: SEED_A }));
  });

  it('mints exactly 16 random bytes and verifies derived ids', () => {
    const seed = mintChangeInstanceSeed();
    expect(seed).toMatch(/^[0-9a-f]{32}$/u);
    expect(parseChangeInstanceSeed(seed)).toBe(seed);
    const derived = identity(PROJECT_A, 'line-0.2', seed);
    expect(
      verifyPlanningScopeId(derived.planningScopeId, {
        storeUid: STORE_UID,
        projectId: PROJECT_A,
        targetLineId: 'line-0.2',
      })
    ).toBe(derived.planningScopeId);
    expect(
      verifyChangeInstanceId(derived.instanceId, {
        planningScopeId: derived.planningScopeId,
        instanceSeed: seed,
      })
    ).toBe(derived.instanceId);
  });

  it('tracks worktree replacement and preserves planning/execution role order', () => {
    const changeInstanceId = identity().instanceId;
    const planning = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:store',
      worktreeIdentity: 'physical:planning-a',
    });
    const replacement = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:store',
      worktreeIdentity: 'physical:planning-b',
    });
    const execution = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:code',
      worktreeIdentity: 'physical:execution',
    });
    const pair = deriveWorkspacePairId({
      changeInstanceId,
      planningWorktreeInstanceId: planning,
      executionWorktreeInstanceId: execution,
    });
    const replaced = deriveWorkspacePairId({
      changeInstanceId,
      planningWorktreeInstanceId: replacement,
      executionWorktreeInstanceId: execution,
    });
    const swapped = deriveWorkspacePairId({
      changeInstanceId,
      planningWorktreeInstanceId: execution,
      executionWorktreeInstanceId: planning,
    });
    expect(replaced).not.toBe(pair);
    expect(swapped).not.toBe(pair);
    expect(
      verifyWorktreeInstanceId(planning, {
        repositoryIdentity: 'repo:store',
        worktreeIdentity: 'physical:planning-a',
      })
    ).toBe(planning);
    expect(
      verifyWorkspacePairId(pair, {
        changeInstanceId,
        planningWorktreeInstanceId: planning,
        executionWorktreeInstanceId: execution,
      })
    ).toBe(pair);
  });

  it.each([
    { input: { storeUid: STORE_UID, projectId: 'Project-A', targetLineId: 'line-0.2' }, field: 'projectId' },
    { input: { storeUid: STORE_UID, projectId: PROJECT_A, targetLineId: 'Line-0.2' }, field: 'targetLineId' },
  ])('reclassifies invalid $field input into the identity error family', ({ input, field }) => {
    try {
      derivePlanningScopeId(input);
      throw new Error('expected identity validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(StorePlanningValidationError);
      expect(error).toMatchObject({
        code: 'invalid_planning_identity',
        field,
        cause: expect.objectContaining({ code: 'invalid_store_layout_v2', field }),
      });
    }
  });

  it.each([
    ['', 'repositoryIdentity'],
    [' repo:store', 'repositoryIdentity'],
    ['repo:store ', 'repositoryIdentity'],
    ['repo:\u0000store', 'repositoryIdentity'],
  ])('rejects non-canonical local identity input %j', (value, field) => {
    try {
      parseCanonicalLocalIdentity(value, field);
      throw new Error('expected local identity validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(StorePlanningValidationError);
      expect(error).toMatchObject({ code: 'invalid_planning_identity', field });
    }
  });

  it('rejects correctly shaped digest mismatches in every relationship verifier', () => {
    const scope = identity().planningScopeId;
    const change = identity().instanceId;
    const planning = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:store',
      worktreeIdentity: 'worktree:planning',
    });
    const execution = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:code',
      worktreeIdentity: 'worktree:execution',
    });
    const cases: Array<{ readonly field: string; readonly action: () => unknown }> = [
      {
        field: 'planningScopeId',
        action: () =>
          verifyPlanningScopeId(`ps_${'f'.repeat(64)}`, {
            storeUid: STORE_UID,
            projectId: PROJECT_A,
            targetLineId: 'line-0.2',
          }),
      },
      {
        field: 'changeInstanceId',
        action: () =>
          verifyChangeInstanceId(`ci_${'f'.repeat(64)}`, {
            planningScopeId: scope,
            instanceSeed: SEED_A,
          }),
      },
      {
        field: 'worktreeInstanceId',
        action: () =>
          verifyWorktreeInstanceId(`wt_${'f'.repeat(64)}`, {
            repositoryIdentity: 'repo:store',
            worktreeIdentity: 'worktree:planning',
          }),
      },
      {
        field: 'workspacePairId',
        action: () =>
          verifyWorkspacePairId(`wp_${'f'.repeat(64)}`, {
            changeInstanceId: change,
            planningWorktreeInstanceId: planning,
            executionWorktreeInstanceId: execution,
          }),
      },
    ];

    for (const { field, action } of cases) {
      try {
        action();
        throw new Error('expected relationship verification to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(StorePlanningValidationError);
        expect(error).toMatchObject({ code: 'invalid_planning_identity', field });
      }
    }
  });

  it.each([
    ['planning', () => parsePlanningScopeId(`ps_${'A'.repeat(64)}`)],
    ['change', () => parseChangeInstanceId(`wt_${'a'.repeat(64)}`)],
    ['worktree', () => parseWorktreeInstanceId(`wt_${'a'.repeat(63)}`)],
    ['pair', () => parseWorkspacePairId(`wp_${'g'.repeat(64)}`)],
    ['seed', () => parseChangeInstanceSeed('A'.repeat(32))],
  ])('rejects malformed %s identity values', (_label, action) => {
    expect(action).toThrow(/lowercase|exactly/u);
  });

  it('exposes non-throwing guards for downstream boundary checks', () => {
    const scope = identity().planningScopeId;
    const change = identity().instanceId;
    const worktree = deriveWorktreeInstanceId({
      repositoryIdentity: 'repo:1',
      worktreeIdentity: 'worktree:1',
    });
    const pair = deriveWorkspacePairId({
      changeInstanceId: change,
      planningWorktreeInstanceId: worktree,
      executionWorktreeInstanceId: worktree,
    });
    expect(isPlanningScopeId(scope)).toBe(true);
    expect(isChangeInstanceId(change)).toBe(true);
    expect(isWorktreeInstanceId(worktree)).toBe(true);
    expect(isWorkspacePairId(pair)).toBe(true);
  });
});

describe('Change metadata v2 identity compatibility', () => {
  let projectRoot: string;
  let changeDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-change-identity-v2-'));
    changeDir = path.join(projectRoot, 'rasen', 'changes', 'same-alias');
    fs.mkdirSync(changeDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reads and writes a verified portable identity and planning-only intent', () => {
    const { instanceId } = identity();
    const metadata = ChangeMetadataSchema.parse({
      schema: 'spec-driven',
      created: '2026-08-04',
      implementation: 'none',
      identity: {
        version: 2,
        instanceSeed: SEED_A,
        instanceId,
        storeUid: STORE_UID,
        projectId: PROJECT_A,
        targetLineId: 'line-0.2',
      },
    });
    writeChangeMetadata(changeDir, metadata, projectRoot);
    expect(readChangeMetadata(changeDir, projectRoot)).toEqual(metadata);
    expect(parseYaml(fs.readFileSync(path.join(changeDir, '.openspec.yaml'), 'utf8'))).toEqual({
      schema: 'spec-driven',
      created: '2026-08-04',
      implementation: 'none',
      identity: {
        version: 2,
        instanceSeed: SEED_A,
        instanceId,
        storeUid: STORE_UID,
        projectId: PROJECT_A,
        targetLineId: 'line-0.2',
      },
    });
  });

  it.each(['storeUid', 'projectId', 'targetLineId', 'instanceSeed'])(
    'rejects metadata tampering in %s without a matching instance id',
    field => {
      const { instanceId } = identity();
      const identityBlock: Record<string, unknown> = {
        version: 2,
        instanceSeed: SEED_A,
        instanceId,
        storeUid: STORE_UID,
        projectId: PROJECT_A,
        targetLineId: 'line-0.2',
      };
      identityBlock[field] =
        field === 'storeUid'
          ? '12345678-1234-1234-1234-123456789012'
          : field === 'projectId'
            ? PROJECT_B
            : field === 'targetLineId'
              ? 'line-0.1'
              : SEED_B;
      expect(
        ChangeMetadataSchema.safeParse({ schema: 'spec-driven', identity: identityBlock }).success
      ).toBe(false);
    }
  );

  it('keeps legacy metadata free of injected v2 fields', () => {
    const legacy = ChangeMetadataSchema.parse({
      schema: 'spec-driven',
      created: '2026-08-04',
    });
    writeChangeMetadata(changeDir, legacy, projectRoot);
    const read = readChangeMetadata(changeDir, projectRoot);
    expect(read).toEqual(legacy);
    const raw = fs.readFileSync(path.join(changeDir, '.openspec.yaml'), 'utf8');
    expect(raw).not.toContain('identity:');
    expect(raw).not.toContain('implementation:');
  });

  it('rejects unknown metadata fields instead of dropping them', () => {
    expect(
      ChangeMetadataSchema.safeParse({ schema: 'spec-driven', localPath: 'C:/repo' }).success
    ).toBe(false);
  });
});
