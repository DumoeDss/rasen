import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { analyzeReconcilerSupport } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { freezeProductionPreparedPipelineRegistry } from '../../../src/core/pipeline-registry/prepared-registry.js';
import { resolveDiscoveryReconcilerSupportProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import { createReusableSessionService } from '../../../src/core/management-api/reusable-session-api.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';
import {
  ACCEPTANCE_PIPELINES,
  buildAcceptanceFileManifest,
  createAcceptanceSupervisor,
  createCanonicalAcceptanceRun,
} from './fixtures.js';

describe('session executor exact reconciler binding acceptance', () => {
  const temporaryPaths: string[] = [];

  afterEach(async () => {
    while (temporaryPaths.length > 0) {
      await cleanupTempPathAsync(temporaryPaths.pop()!);
    }
  });

  it.each(ACCEPTANCE_PIPELINES)(
    'accepts the exact real reducer-admitted action for %s',
    async (pipeline) => {
      const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), `rasen-${pipeline}-acceptance-`))
      );
      temporaryPaths.push(root);
      const fixture = await createCanonicalAcceptanceRun(root, pipeline);
      const host = createAcceptanceSupervisor();
      const service = createReusableSessionService({
        supervisor: host.supervisor,
        runsRoot: fixture.manifest.runsRoot,
        ownerInstanceId: `owner-${pipeline}`,
        clock: () => new Date('2026-07-30T09:00:00.000Z'),
      });

      const response = await service.wake({
        schema: 'rasen-reusable-session-api/1',
        op: 'wake',
        kind: 'interactive',
        runId: fixture.plan.runId,
        sessionKey: `pipeline-${pipeline}`,
        action: fixture.action,
        cwd: fixture.manifest.workspace,
        messageId: `accepted-${pipeline}`,
        touchPolicy: {
          mode: 'never',
          maxTouches: 0,
          deadlineAction: 'stop',
        },
      });
      expect(response).toMatchObject({
        ok: true,
        operation: 'wake',
        code: 'completed',
        runId: fixture.plan.runId,
        sessionKey: `pipeline-${pipeline}`,
        session: {
          role: fixture.action.agent.role,
          cwd: fixture.manifest.workspace,
        },
      });
      expect(host.calls.create).toHaveLength(1);
      const registry = JSON.parse(
        fs.readFileSync(
          path.join(fixture.manifest.runDirectory, 'sessions.json'),
          'utf8'
        )
      );
      expect(registry.sessions[0]).toMatchObject({
        sessionKey: `pipeline-${pipeline}`,
        actionId: fixture.action.actionId,
        nodeId: fixture.action.nodeId,
        invocationId: fixture.action.invocationId,
        space: {
          type: 'project',
          id: fixture.record.change.projectId,
          root: fixture.manifest.workspace,
        },
        execution: {
          kind: 'project',
          projectId: fixture.record.change.projectId,
          root: fixture.manifest.workspace,
        },
      });

      const modified = {
        ...fixture.action,
        agent: {
          ...fixture.action.agent,
          input: { changed: true },
        },
      };
      const rejected = await service.wake({
        schema: 'rasen-reusable-session-api/1',
        op: 'wake',
        kind: 'interactive',
        runId: fixture.plan.runId,
        sessionKey: `pipeline-${pipeline}`,
        action: modified,
        cwd: fixture.manifest.workspace,
        messageId: `rejected-${pipeline}`,
        touchPolicy: {
          mode: 'never',
          maxTouches: 0,
          deadlineAction: 'stop',
        },
      });
      expect(rejected).toMatchObject({ ok: false, code: 'invalid_action' });
      expect(host.calls.wake).toHaveLength(0);
      await service.ownerShutdown();
    }
  );

  it('keeps auto-decompose fail closed through production preparation before session dispatch', async () => {
    const host = createAcceptanceSupervisor();
    const registry = await freezeProductionPreparedPipelineRegistry(
      process.cwd(),
      { reporter: false }
    );
    const resolution = registry.load('auto-decompose');
    const preparedProfile = resolveDiscoveryReconcilerSupportProfile(
      resolution.prepared,
      registry.catalog
    );
    const support = analyzeReconcilerSupport(
      resolution.prepared,
      preparedProfile
    );
    expect(support.reconcilerSupport).toMatchObject({
      supported: false,
      reason: 'unsupported_pipeline_semantics',
    });
    // The discovery profile is still null (the synthetic decompose capability
    // binds nowhere) — the verdict names the semantics boundary rather than
    // reading that null as a profile availability.
    expect(preparedProfile).toBeNull();
    expect(host.calls.create).toHaveLength(0);
    expect(host.calls.wake).toHaveLength(0);
    expect(host.calls.recover).toHaveLength(0);
  });

  it('uses explicit cross-platform manifests without hard-coded separators', () => {
    const runId = `run:${'a'.repeat(64)}`;
    const windows = buildAcceptanceFileManifest(
      'C:\\work\\candidate',
      runId,
      'claude-session',
      path.win32
    );
    expect(windows.runDirectory).toBe(
      `C:\\work\\candidate\\runs\\run_${'a'.repeat(64)}`
    );
    expect(windows.files).toContain(
      `C:\\work\\candidate\\fixtures\\action.json`
    );

    const posix = buildAcceptanceFileManifest(
      '/work/candidate',
      runId,
      'claude-session',
      path.posix
    );
    expect(posix.runDirectory).toBe(
      `/work/candidate/runs/run_${'a'.repeat(64)}`
    );
    expect(posix.files).toContain('/work/candidate/fixtures/action.json');
    expect(posix.files.every((entry) => !entry.includes('\\'))).toBe(true);
  });
});
