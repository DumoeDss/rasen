import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createManagementRouter,
  type ManagementApiContext,
} from '../../../src/core/management-api/router.js';
import type {
  ExactTeacherAuthorityAvailability,
  ExactTeacherAuthorityPolicy,
} from '../../../src/core/frozen-action-executor/index.js';
import {
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../../src/core/session-host/process-authority/linux/index.js';
import { createDeterministicProcessScope } from '../../../src/core/session-host/process-scope.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const roots: string[] = [];

function temporaryRoot(tag: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rasen-management-${tag}-`));
  roots.push(root);
  return root;
}

function context(root: string): ManagementApiContext {
  return {
    token: 'exact-teacher-lane-test-token',
    launchProjectRoot: root,
    launchProjectRef: {
      projectId: 'exact-teacher-lane-project',
      name: 'exact-teacher-lane-project',
      root,
    },
    version: '0.0.0-test',
    uiAssetsDir: null,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

describe('management exact Teacher SessionHost assembly', () => {
  it('keeps the ordinary host separate and constructs Teacher only from the exact policy scope', async () => {
    const root = temporaryRoot('exact-teacher-available');
    const processScope = createDeterministicProcessScope();
    let processScopeReads = 0;
    const selection = Object.freeze({
      providerId: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.providerId,
      capabilityId: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.capabilityId,
      protocolVersion: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.protocolVersion,
    });
    const lane = Object.freeze({
      selection,
      registry: {} as never,
      coordinator: {} as never,
      get processScope() {
        processScopeReads += 1;
        return processScope;
      },
    });
    const resolution = Object.freeze({
      state: 'available' as const,
      platform: 'linux' as const,
      selection,
      lane,
    });
    const policy: ExactTeacherAuthorityPolicy = Object.freeze({
      resolve: () => resolution,
    });

    const router = createManagementRouter(context(root), async () => null, {
      resolveAgentCliOverride: async () => fakeClaudeBin,
      sessionHostStateDir: path.join(root, 'ordinary-session-host'),
      exactTeacherSessionHostStateDir: path.join(root, 'exact-teacher-session-host'),
      exactTeacherAuthorityPolicy: policy,
    });

    expect(processScopeReads).toBe(1);
    expect(router.exactTeacherSessionHost).toBeDefined();
    expect(router.exactTeacherSessionHost).not.toBe(router.sessionHost);

    await Promise.all([
      router.sessionHost.shutdown('server-shutdown'),
      router.exactTeacherSessionHost!.shutdown('server-shutdown'),
      router.supervisor.shutdownAll('server-shutdown'),
      router.shutdownPathChooser(),
    ]);
  });

  it('keeps ordinary hosting only when exact Teacher authority is typed unavailable before activation', async () => {
    const root = temporaryRoot('exact-teacher-unavailable');
    const unavailable: ExactTeacherAuthorityAvailability = Object.freeze({
      state: 'authority-unavailable',
      platform: 'darwin',
      reason: 'unsupported-platform',
      diagnostic: 'Exact Teacher process authority is unavailable on macOS.',
    });
    const policy: ExactTeacherAuthorityPolicy = Object.freeze({ resolve: () => unavailable });

    const router = createManagementRouter(context(root), async () => null, {
      resolveAgentCliOverride: async () => fakeClaudeBin,
      sessionHostStateDir: path.join(root, 'ordinary-session-host'),
      exactTeacherSessionHostStateDir: path.join(root, 'must-not-exist'),
      exactTeacherAuthorityPolicy: policy,
    });

    expect(router.exactTeacherSessionHost).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'must-not-exist'))).toBe(false);

    await Promise.all([
      router.sessionHost.shutdown('server-shutdown'),
      router.supervisor.shutdownAll('server-shutdown'),
      router.shutdownPathChooser(),
    ]);
  });
});
