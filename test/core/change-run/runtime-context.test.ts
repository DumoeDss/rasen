import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import { createRuntimeExecutionProfile } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
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

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function profileFor(prepared: { authoredSource: { stages: { id: string; skill: string }[] } }) {
  return createRuntimeExecutionProfile({
    sourceRevision: {
      layer: 'package',
      kind: 'pipeline-yaml',
      sourceId: 'package:bug-fix',
      authoredContentDigest: `sha256:${'1'.repeat(64)}`,
      semanticDigest: `sha256:${'2'.repeat(64)}`,
    },
    capabilities: prepared.authoredSource.stages.map((stage) => ({
      nodeId: `stage:${stage.id}`,
      authoredCapability: { id: `skill:${stage.skill}`, version: 'legacy' },
      contract: { id: stage.skill, version: '1', digest: `sha256:${'3'.repeat(64)}` },
      actionKind: 'agent' as const,
      resultContract: { id: `${stage.skill}-result`, version: '1', digest: `sha256:${'4'.repeat(64)}` },
      evidenceContract: { id: `${stage.skill}-evidence`, version: '1', digest: `sha256:${'5'.repeat(64)}` },
      recovery: 'suspend-if-ambiguous' as const,
      workspace: {
        access: (stage.id === 'propose' || stage.id === 'verify' ? 'read' : 'write') as 'read' | 'write',
        resources: ['worktree'],
      },
      effects: [
        { slot: 'workspace', kind: 'workspace' as const, resource: 'worktree', recovery: 'suspend-if-ambiguous' as const },
      ],
      adapter: { id: `adapter:${stage.skill}`, version: '1', contentDigest: `sha256:${'6'.repeat(64)}` },
    })),
    policy: {
      format: 'effective-run-policy/1',
      maxAttempts: 3,
      maxActions: 64,
      stages: prepared.authoredSource.stages.map((stage) => ({
        nodeId: `stage:${stage.id}`,
        role: BUG_FIX.stages.find((s) => s.id === stage.id)!.role,
        model: BUG_FIX.stages.find((s) => s.id === stage.id)!.model ?? 'default',
        effort: 'default',
        runtime: 'codex',
        sandbox: stage.id === 'propose' || stage.id === 'verify' ? ('read-only' as const) : ('workspace-write' as const),
        gate: BUG_FIX.stages.find((s) => s.id === stage.id)!.gate ?? false,
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
  });
});
