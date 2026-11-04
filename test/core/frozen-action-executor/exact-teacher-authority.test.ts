import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createProductionExactTeacherAuthorityPolicy,
  createExactTeacherAuthorityPolicyForTesting,
  type ExactTeacherAuthorityLane,
} from '../../../src/core/frozen-action-executor/exact-teacher-authority.js';
import {
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../../src/core/session-host/process-authority/linux/index.js';
import type {
  ProcessAuthorityCoordinator,
  ProcessAuthorityProviderRegistry,
} from '../../../src/core/session-host/process-authority/index.js';
import type { ProcessScope } from '../../../src/core/session-host/process-scope.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const temporaryRoots: string[] = [];

function productionStateRoot(tag: string): string {
  const parent = process.platform === 'win32' ? os.tmpdir() : os.homedir();
  const root = fs.mkdtempSync(path.join(parent, `rasen-exact-teacher-${tag}-`));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) cleanupTempPath(root);
});

function lane(): ExactTeacherAuthorityLane {
  return Object.freeze({
    selection: Object.freeze({
      providerId: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.providerId,
      capabilityId: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.capabilityId,
      protocolVersion: LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR.protocolVersion,
    }),
    registry: {} as ProcessAuthorityProviderRegistry,
    coordinator: {} as ProcessAuthorityCoordinator,
    processScope: {} as ProcessScope,
  });
}

describe('server-owned exact Teacher authority policy', () => {
  it('resolves one frozen provider tuple without accepting caller authority fields', () => {
    const policy = createExactTeacherAuthorityPolicyForTesting({
      hostPlatform: 'linux',
      lane: lane(),
    });

    expect(policy.resolve.length).toBe(0);
    expect(policy.resolve()).toMatchObject({
      state: 'available',
      platform: 'linux',
      selection: {
        providerId: 'rasen.linux.user-pidns',
        capabilityId: 'rasen-recursive-process-scope/1',
        protocolVersion: 1,
      },
    });
    expect(policy.resolve()).toBe(policy.resolve());
  });

  it('fails macOS closed before any exact lane can be acquired', () => {
    const policy = createExactTeacherAuthorityPolicyForTesting({
      hostPlatform: 'darwin',
      lane: lane(),
    });

    expect(policy.resolve()).toEqual({
      state: 'authority-unavailable',
      platform: 'darwin',
      reason: 'unsupported-platform',
      diagnostic: 'Exact Teacher process authority is unavailable on macOS.',
    });
  });

  it('assembles both Linux production bundles and their durable ledgers under management state', () => {
    const hostStateRoot = productionStateRoot('linux-assembly');
    const policy = createProductionExactTeacherAuthorityPolicy({
      hostPlatform: 'linux',
      hostStateRoot,
      linuxProviderMode: 'primary',
    });

    const authorityRoot = path.join(hostStateRoot, 'exact-teacher-authority');
    for (const provider of ['linux-primary', 'linux-broker']) {
      expect(fs.statSync(path.join(authorityRoot, provider, 'runtime')).isDirectory()).toBe(true);
      expect(fs.statSync(
        path.join(authorityRoot, provider, 'runtime', 'publication-ledger')
      ).isDirectory()).toBe(true);
    }
    expect(fs.statSync(path.join(
      authorityRoot,
      'linux-broker',
      'runtime',
      'preparation-delivery-ledger'
    )).isDirectory()).toBe(true);

    const resolution = policy.resolve();
    expect(policy.resolve()).toBe(resolution);
    if (resolution.state === 'available') {
      expect(resolution.selection.providerId).toBe('rasen.linux.user-pidns');
      expect(resolution.lane.registry.descriptors().map(({ providerId }) => providerId))
        .toEqual(['rasen.linux.broker', 'rasen.linux.user-pidns']);
    } else {
      expect(resolution).toMatchObject({
        platform: 'linux',
        reason: 'provider-unavailable',
      });
    }
  });

  it('reports a stable typed verdict for the current host without a weaker fallback', () => {
    const policy = createProductionExactTeacherAuthorityPolicy({
      hostPlatform: process.platform,
      hostStateRoot: productionStateRoot('current-host'),
    });

    const resolution = policy.resolve();
    expect(policy.resolve()).toBe(resolution);
    if (resolution.state === 'available') {
      expect(['win32', 'linux']).toContain(resolution.platform);
      expect(resolution.lane.processScope).toBeTruthy();
    } else {
      expect(resolution.state).toBe('authority-unavailable');
      expect(resolution).not.toHaveProperty('lane');
      expect(resolution.diagnostic).toMatch(/exact Teacher/i);
    }
  });
});
