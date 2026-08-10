import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_ATTESTATION_AUTHORITY } from '../../fixtures/trusted-completion.js';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import {
  createRuntimeExecutionProfile,
  sealRuntimeExecutionPlan,
} from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { prepareRuntimeContext } from '../../../src/core/change-run/internal/runtime-context.js';
import {
  deriveChangeInstanceId,
  derivePlanningSpaceId,
  deriveRunId,
  deriveWorkspaceInstanceId,
  type PhysicalIdentity,
} from '../../../src/core/change-run/internal/identity.js';
import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunId,
  WorkspaceInstanceId,
} from '../../../src/core/change-run/index.js';

const branded = <T>(value: string): T => value as T;

const BUG_FIX = {
  version: 1,
  name: 'bug-fix',
  description: 'fixture',
  stages: [
    { id: 'propose', skill: 'rasen-propose', role: 'planner', requires: [], gate: true },
    { id: 'apply', skill: 'rasen-apply-change', role: 'implementer', requires: ['propose'], gate: true },
    { id: 'verify', skill: 'rasen-review', role: 'reviewer', requires: ['apply'], verifyPolicy: 'adaptive' },
    { id: 'ship', skill: 'rasen-ship', role: 'shipper', requires: ['verify'], gate: true, model: 'sonnet' },
    { id: 'archive', skill: 'rasen-archive-change', role: 'shipper', requires: ['ship'], model: 'sonnet' },
  ],
} as const;

const WRITE_ONLY = {
  version: 1,
  name: 'write-only-fixture',
  description: 'single ungated writer fixture',
  stages: [
    {
      id: 'apply',
      skill: 'rasen-apply-change',
      role: 'implementer',
      requires: [],
      gate: false,
    },
  ],
} as const;

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/**
 * v2-compatible profile entries. The normalized bug-fix definition has:
 *  - 4 root AtomicStage nodes (propose, apply, ship, archive) at `root:stage:<id>`
 *  - 4 ReviewCycle body phases (review, triage, fix, re-review) at
 *    `declaration:review-cycle-body:verify/node:verify:<phase>`
 */
const V2_NODES = [
  { path: 'root:stage:propose', skill: 'rasen-propose', role: 'planner', gate: true, access: 'read' as const, model: 'default' as const },
  { path: 'root:stage:apply', skill: 'rasen-apply-change', role: 'implementer', gate: true, access: 'write' as const, model: 'default' as const },
  { path: 'root:stage:ship', skill: 'rasen-ship', role: 'shipper', gate: true, access: 'write' as const, model: 'sonnet' as const },
  { path: 'root:stage:archive', skill: 'rasen-archive-change', role: 'shipper', gate: false, access: 'write' as const, model: 'sonnet' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:review', skill: 'rasen-review', role: 'reviewer', gate: false, access: 'read' as const, model: 'default' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:triage', skill: 'rasen-review', role: 'reviewer', gate: false, access: 'read' as const, model: 'default' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:fix', skill: 'rasen-review', role: 'implementer', gate: false, access: 'write' as const, model: 'default' as const },
  { path: 'declaration:review-cycle-body:verify/node:verify:re-review', skill: 'rasen-review', role: 'reviewer', gate: false, access: 'read' as const, model: 'default' as const },
] as const;

function profileFor(
  prepared: { authoredSource: { stages: { id: string; skill: string }[] } },
  authority = TEST_ATTESTATION_AUTHORITY
) {
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:bug-fix',
      authoredContentDigest: `sha256:${'1'.repeat(64)}`,
      semanticDigest: `sha256:${'2'.repeat(64)}`,
    },
    capabilities: V2_NODES.map((node) => ({
      nodeId: node.path,
      authoredCapability: { id: `skill:${node.skill}`, version: 'legacy' },
      contract: { id: node.skill, version: '1', digest: `sha256:${'3'.repeat(64)}` },
      actionKind: 'agent' as const,
      resultContract: { id: `${node.skill}-result`, version: '1', digest: `sha256:${'4'.repeat(64)}` },
      evidenceContract: { id: `${node.skill}-evidence`, version: '1', digest: `sha256:${'5'.repeat(64)}` },
      recovery: 'suspend-if-ambiguous' as const,
      workspace: {
        access: node.access,
        resources: ['worktree'],
      },
      effects: [
        { slot: 'workspace', kind: 'workspace' as const, resource: 'worktree', recovery: 'suspend-if-ambiguous' as const },
      ],
      adapter: {
        id: `adapter:${node.skill}`,
        version: '1',
        contentDigest: `sha256:${'6'.repeat(64)}`,
        attestationAuthority: authority,
      },
    })),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: V2_NODES.map((node) => ({
        nodeId: node.path,
        role: node.role,
        model: node.model,
        effort: 'default',
        runtime: 'codex',
        sandbox: node.access === 'read' ? ('read-only' as const) : ('workspace-write' as const),
        gate: node.gate,
        sessionReuse: 'never' as const,
        handoffTokenLimit: 10_000,
        reuseRoundLimit: 1,
        provenance: {
          role: 'stage', model: 'default', effort: 'default', runtime: 'stage',
          sandbox: 'stage', gate: 'stage', sessionReuse: 'default',
          handoffTokenLimit: 'default', reuseRoundLimit: 'default',
        },
      })),
    },
  });
}

function writeOnlyProfile() {
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:write-only-fixture',
      authoredContentDigest: `sha256:${'1'.repeat(64)}`,
      semanticDigest: `sha256:${'2'.repeat(64)}`,
    },
    capabilities: [
      {
        nodeId: 'stage:apply',
        authoredCapability: {
          id: 'skill:rasen-apply-change',
          version: 'legacy',
        },
        contract: {
          id: 'rasen-apply-change',
          version: '1',
          digest: `sha256:${'3'.repeat(64)}`,
        },
        actionKind: 'agent',
        resultContract: {
          id: 'rasen-apply-change-result',
          version: '1',
          digest: `sha256:${'4'.repeat(64)}`,
        },
        evidenceContract: {
          id: 'rasen-apply-change-evidence',
          version: '1',
          digest: `sha256:${'5'.repeat(64)}`,
        },
        recovery: 'suspend-if-ambiguous',
        workspace: { access: 'write', resources: ['worktree'] },
        effects: [
          {
            slot: 'workspace',
            kind: 'workspace',
            resource: 'worktree',
            recovery: 'suspend-if-ambiguous',
          },
        ],
        adapter: {
          id: 'adapter:rasen-apply-change',
          version: '1',
          contentDigest: `sha256:${'6'.repeat(64)}`,
          attestationAuthority: TEST_ATTESTATION_AUTHORITY,
        },
      },
    ],
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 8,
      stages: [
        {
          nodeId: 'stage:apply',
          role: 'implementer',
          model: 'default',
          effort: 'default',
          runtime: 'codex',
          sandbox: 'workspace-write',
          gate: false,
          sessionReuse: 'never',
          handoffTokenLimit: 10_000,
          reuseRoundLimit: 1,
          provenance: {
            role: 'stage',
            model: 'default',
            effort: 'default',
            runtime: 'stage',
            sandbox: 'stage',
            gate: 'stage',
            sessionReuse: 'default',
            handoffTokenLimit: 'default',
            reuseRoundLimit: 'default',
          },
        },
      ],
    },
  });
}

describe('prepareRuntimeContext (launch wiring, real fs + git)', () => {
  let repo: string;
  let storeRoot: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'rasen-ctx-repo-'));
    storeRoot = mkdtempSync(join(tmpdir(), 'rasen-ctx-store-'));
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 't@t']);
    git(repo, ['config', 'user.name', 't']);
    writeFileSync(join(repo, 'README.md'), '# repo');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-q', '-m', 'init']);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it('assembles a facade that starts a reconciler Run on a real repo', async () => {
    const prepared = EcpDefinitionModule.prepare(
      BUG_FIX,
      createCapabilityCatalogSnapshot([])
    );
    if (!prepared.ok) throw prepared.error;
    const profile = profileFor(prepared.value);

    const physical: PhysicalIdentity = {
      format: 'physical-identity/1',
      platform: 'posix',
      device: 1n,
      fileIndex: 2n,
      birthIdentity: 3n,
    };
    const planningSpaceId = derivePlanningSpaceId('fixture-home') as PlanningSpaceId;
    const changeInstanceId = deriveChangeInstanceId(
      planningSpaceId,
      'fixture-change',
      physical
    ) as ChangeInstanceId;
    const workspaceInstanceId = deriveWorkspaceInstanceId(
      planningSpaceId,
      physical
    ) as WorkspaceInstanceId;
    const runId = deriveRunId(
      planningSpaceId,
      changeInstanceId,
      'fixture-change',
      'launch-fixture'
    ) as RunId;

    const ctx = prepareRuntimeContext({
      projectRoot: repo,
      prepared: prepared.value,
      profile,
      runId,
      planningSpaceId,
      workspaceInstanceId,
      changeInstanceId,
      changeId: 'fixture-change',
      projectId: 'project-fixture',
      launchRequestDigest: branded(`sha256:${'9'.repeat(64)}`) as Digest,
      storeRoot,
    });

    const receipt = await ctx.facade.start(
      {
        change: { projectRoot: repo, changeId: 'fixture-change' },
        pipeline: 'bug-fix',
        launchRequestId: branded('launch-fixture') as never,
      },
      { deliveryMode: 'grant' }
    );
    expect(receipt.disposition).toBe('created');
    expect(ctx.store.has(runId)).toBe(true);
    // The Run persists on the real filesystem store.
    // The Run persists on the real filesystem store. With the gate wait
    // committed by the facade's settle and no active actions, the status is
    // 'waiting' (design §5.6: settle to quiescence commits durable waits).
    expect(ctx.store.load(runId).status).toBe('waiting');
    const sealed = sealRuntimeExecutionPlan(prepared.value.plan, profile);
    expect(ctx.plan.planDigest).toBe(`sha256:${sealed.digest}`);
    expect(ctx.plan.planDigest).not.toBe(`sha256:${prepared.value.digests.plan}`);
    expect(ctx.plan.executionProfile).toEqual(profile);
    expect(ctx.store.loadPlan?.(runId)).toEqual(ctx.plan);
  });

  it('shares the default production reservation registry across RuntimeContexts', async () => {
    const prepared = EcpDefinitionModule.prepare(
      WRITE_ONLY,
      createCapabilityCatalogSnapshot([])
    );
    if (!prepared.ok) throw prepared.error;
    const profile = writeOnlyProfile();
    const planningSpaceId = derivePlanningSpaceId(
      'shared-registry-fixture-home'
    ) as PlanningSpaceId;
    const physical: PhysicalIdentity = {
      format: 'physical-identity/1',
      platform: 'posix',
      device: 11n,
      fileIndex: 12n,
      birthIdentity: 13n,
    };
    const workspaceInstanceId = deriveWorkspaceInstanceId(
      planningSpaceId,
      physical
    ) as WorkspaceInstanceId;
    const firstChangeInstanceId = deriveChangeInstanceId(
      planningSpaceId,
      'first-change',
      physical
    ) as ChangeInstanceId;
    const secondChangeInstanceId = deriveChangeInstanceId(
      planningSpaceId,
      'second-change',
      physical
    ) as ChangeInstanceId;
    const firstRunId = deriveRunId(
      planningSpaceId,
      firstChangeInstanceId,
      'first-change',
      'first-launch'
    ) as RunId;
    const secondRunId = deriveRunId(
      planningSpaceId,
      secondChangeInstanceId,
      'second-change',
      'second-launch'
    ) as RunId;
    const contextFor = (
      runId: RunId,
      changeId: string,
      changeInstanceId: ChangeInstanceId,
      launch: string
    ) =>
      prepareRuntimeContext({
        projectRoot: repo,
        prepared: prepared.value,
        profile,
        runId,
        planningSpaceId,
        workspaceInstanceId,
        changeInstanceId,
        changeId,
        projectId: 'project-fixture',
        launchRequestDigest: branded(
          `sha256:${launch.repeat(64).slice(0, 64)}`
        ) as Digest,
        storeRoot,
      });
    const first = contextFor(
      firstRunId,
      'first-change',
      firstChangeInstanceId,
      'a'
    );
    const second = contextFor(
      secondRunId,
      'second-change',
      secondChangeInstanceId,
      'b'
    );

    const firstReceipt = await first.facade.start(
      {
        change: { projectRoot: repo, changeId: 'first-change' },
        pipeline: WRITE_ONLY.name,
        launchRequestId: branded('first-launch') as never,
      },
      { deliveryMode: 'grant' }
    );
    expect(firstReceipt.actions).toHaveLength(1);
    const secondReceipt = await second.facade.start(
      {
        change: { projectRoot: repo, changeId: 'second-change' },
        pipeline: WRITE_ONLY.name,
        launchRequestId: branded('second-launch') as never,
      },
      { deliveryMode: 'grant' }
    );
    expect(secondReceipt.actions).toEqual([]);
    expect(secondReceipt.view.status).toBe('waiting');
    expect(secondReceipt.view.sections[0]).toMatchObject({
      waits: [
        {
          kind: 'workspace-reservation',
          workspaceInstanceId,
        },
      ],
    });

    const firstRecord = first.store.load(firstRunId);
    await first.facade.control(
      {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: repo, changeId: 'first-change' },
          runId: firstRunId,
        },
        expectedRecordVersion: firstRecord.recordVersion,
        command: { kind: 'cancel', reason: 'fixture cleanup' },
      },
      { deliveryMode: 'grant' }
    );
  });

  it('uses the persisted public execution profile when the host catalog rotates', async () => {
    const prepared = EcpDefinitionModule.prepare(
      BUG_FIX,
      createCapabilityCatalogSnapshot([])
    );
    if (!prepared.ok) throw prepared.error;
    const frozenProfile = profileFor(prepared.value);

    const physical: PhysicalIdentity = {
      format: 'physical-identity/1',
      platform: 'posix',
      device: 1n,
      fileIndex: 2n,
      birthIdentity: 3n,
    };
    const planningSpaceId = derivePlanningSpaceId('fixture-home') as PlanningSpaceId;
    const changeInstanceId = deriveChangeInstanceId(
      planningSpaceId,
      'fixture-change',
      physical
    ) as ChangeInstanceId;
    const workspaceInstanceId = deriveWorkspaceInstanceId(
      planningSpaceId,
      physical
    ) as WorkspaceInstanceId;
    const runId = deriveRunId(
      planningSpaceId,
      changeInstanceId,
      'fixture-change',
      'launch-fixture'
    ) as RunId;
    const baseInput = {
      projectRoot: repo,
      prepared: prepared.value,
      runId,
      planningSpaceId,
      workspaceInstanceId,
      changeInstanceId,
      changeId: 'fixture-change',
      projectId: 'project-fixture',
      launchRequestDigest: branded(`sha256:${'9'.repeat(64)}`) as Digest,
      storeRoot,
    };
    const launched = prepareRuntimeContext({ ...baseInput, profile: frozenProfile });
    await launched.facade.start(
      {
        change: { projectRoot: repo, changeId: 'fixture-change' },
        pipeline: 'bug-fix',
        launchRequestId: branded('launch-fixture') as never,
      },
      { deliveryMode: 'grant' }
    );

    const { publicKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ format: 'der', type: 'spki' });
    const rotatedProfile = profileFor(prepared.value, {
      ...TEST_ATTESTATION_AUTHORITY,
      keyVersion: 'rotated',
      publicKey: {
        ...TEST_ATTESTATION_AUTHORITY.publicKey,
        value: Buffer.from(der).toString('base64'),
        digest: `sha256:${createHash('sha256').update(der).digest('hex')}` as Digest,
      },
    });
    const resumed = prepareRuntimeContext({
      ...baseInput,
      profile: rotatedProfile,
      frozenPlan: launched.store.loadPlan?.(runId),
    });

    expect(resumed.plan).toEqual(launched.plan);
    expect(resumed.plan.executionProfile).toEqual(frozenProfile);
    expect(resumed.plan.profileDigest).not.toBe(rotatedProfile.profileDigest);
  });
});
