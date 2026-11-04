import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ProcessAuthorityCoordinator,
  ProcessAuthoritySelection,
} from '../session-host/process-authority/index.js';
import {
  ProcessAuthorityProviderRegistry,
  createProcessAuthorityCoordinator,
  createProviderBackedProcessScope,
} from '../session-host/process-authority/index.js';
import {
  LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR,
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
  createLinuxBrokerProcessAuthorityProviderBundle,
  createLinuxPrimaryProcessAuthorityProviderBundle,
  createLinuxProcessAuthorityProviderManifest,
} from '../session-host/process-authority/linux/index.js';
import {
  WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
  createWindowsProcessAuthorityProviderBundle,
  createWindowsProcessAuthorityProviderManifest,
} from '../session-host/process-authority/windows/index.js';
import type { ProcessScope } from '../session-host/process-scope.js';

export type ExactTeacherHostPlatform = 'win32' | 'linux' | 'darwin' | string;

/**
 * Server-assembled internal lane. It is construction authority for the deep
 * Teacher-attempt module and is never accepted from an execution request.
 */
export interface ExactTeacherAuthorityLane {
  readonly selection: ProcessAuthoritySelection;
  readonly registry: ProcessAuthorityProviderRegistry;
  readonly coordinator: ProcessAuthorityCoordinator;
  readonly processScope: ProcessScope;
}

export type ExactTeacherAuthorityAvailability =
  | {
      readonly state: 'available';
      readonly platform: 'win32' | 'linux';
      readonly selection: ProcessAuthoritySelection;
      readonly lane: ExactTeacherAuthorityLane;
    }
  | {
      readonly state: 'authority-unavailable';
      readonly platform: string;
      readonly reason:
        | 'unsupported-platform'
        | 'provider-unavailable'
        | 'provider-assembly-invalid';
      readonly diagnostic: string;
    };

/** The sole policy surface consulted by exact Teacher execution. */
export interface ExactTeacherAuthorityPolicy {
  resolve(): ExactTeacherAuthorityAvailability;
}

function snapshotSelection(
  selection: ProcessAuthoritySelection
): ProcessAuthoritySelection {
  return Object.freeze({
    providerId: selection.providerId,
    capabilityId: selection.capabilityId,
    protocolVersion: selection.protocolVersion,
  });
}

function unavailableForPlatform(platform: string): ExactTeacherAuthorityAvailability {
  if (platform === 'darwin') {
    return Object.freeze({
      state: 'authority-unavailable',
      platform,
      reason: 'unsupported-platform',
      diagnostic: 'Exact Teacher process authority is unavailable on macOS.',
    });
  }
  return Object.freeze({
    state: 'authority-unavailable',
    platform,
    reason: 'unsupported-platform',
    diagnostic: `Exact Teacher process authority is unavailable on ${platform}.`,
  });
}

export interface ExactTeacherAuthorityPolicyFixture {
  readonly hostPlatform: ExactTeacherHostPlatform;
  readonly lane?: ExactTeacherAuthorityLane;
  readonly unavailableDiagnostic?: string;
}

/**
 * Deterministic construction seam used by provider conformance and deep-module
 * tests. The lane is injected by the trusted test host, never by a workload or
 * HTTP caller. Production assembly has its own closed constructor.
 */
export function createExactTeacherAuthorityPolicyForTesting(
  fixture: ExactTeacherAuthorityPolicyFixture
): ExactTeacherAuthorityPolicy {
  let resolution: ExactTeacherAuthorityAvailability;
  if (fixture.hostPlatform !== 'win32' && fixture.hostPlatform !== 'linux') {
    resolution = unavailableForPlatform(fixture.hostPlatform);
  } else if (fixture.lane === undefined) {
    resolution = Object.freeze({
      state: 'authority-unavailable',
      platform: fixture.hostPlatform,
      reason: 'provider-unavailable',
      diagnostic:
        fixture.unavailableDiagnostic ??
        'No authenticated exact Teacher process-authority provider is available.',
    });
  } else {
    const selection = snapshotSelection(fixture.lane.selection);
    const lane = Object.freeze({
      selection,
      registry: fixture.lane.registry,
      coordinator: fixture.lane.coordinator,
      processScope: fixture.lane.processScope,
    });
    resolution = Object.freeze({
      state: 'available',
      platform: fixture.hostPlatform,
      selection,
      lane,
    });
  }
  return Object.freeze({ resolve: () => resolution });
}

export interface ProductionExactTeacherAuthorityPolicyOptions {
  readonly hostPlatform: ExactTeacherHostPlatform;
  /** Existing management-host state root; callers never supply this per attempt. */
  readonly hostStateRoot: string;
  /** Server configuration only. Workload and HTTP inputs cannot select it. */
  readonly linuxProviderMode?: 'primary' | 'broker';
}

function exactChildDirectory(parent: string, name: string): string {
  const canonicalParent = fs.realpathSync.native(parent);
  const directory = path.join(canonicalParent, name);
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError('Exact Teacher authority state directory provenance is invalid.');
  }
  const canonical = fs.realpathSync.native(directory);
  if (path.dirname(canonical) !== canonicalParent) {
    throw new TypeError('Exact Teacher authority state directory escaped its parent.');
  }
  return canonical;
}

/**
 * Closed production assembly. It creates both Linux provider bundles (primary
 * and broker) or the single Windows bundle under a dedicated management-host
 * root, authenticates them against one manifest, and freezes one tuple by
 * server platform policy. No attempt/caller value participates in selection.
 */
export function createProductionExactTeacherAuthorityPolicy(
  options: ProductionExactTeacherAuthorityPolicyOptions
): ExactTeacherAuthorityPolicy {
  if (options.hostPlatform !== 'win32' && options.hostPlatform !== 'linux') {
    return createExactTeacherAuthorityPolicyForTesting({
      hostPlatform: options.hostPlatform,
    });
  }
  let root: string;
  try {
    root = exactChildDirectory(options.hostStateRoot, 'exact-teacher-authority');
  } catch (error) {
    return createExactTeacherAuthorityPolicyForTesting({
      hostPlatform: options.hostPlatform,
      unavailableDiagnostic:
        `Exact Teacher authority state root is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
    });
  }

  try {
    if (options.hostPlatform === 'win32') {
      const providerRoot = exactChildDirectory(root, 'windows');
      const bundle = createWindowsProcessAuthorityProviderBundle({
        stateRoot: providerRoot,
      });
      if (bundle.availability.state !== 'available') {
        return createExactTeacherAuthorityPolicyForTesting({
          hostPlatform: 'win32',
          unavailableDiagnostic:
            `Exact Teacher authority is unavailable: ${bundle.availability.diagnostic}`,
        });
      }
      const registry = new ProcessAuthorityProviderRegistry([bundle.provider], {
        manifest: createWindowsProcessAuthorityProviderManifest({
          artifactPath: 'artifacts/windows/rasen-windows-process-authority-helper.exe',
        }),
        manifestRoot: root,
      });
      const coordinator = createProcessAuthorityCoordinator({ registry });
      const selection = Object.freeze({
        providerId: WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR.providerId,
        capabilityId: WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR.capabilityId,
        protocolVersion: WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR.protocolVersion,
      });
      return createExactTeacherAuthorityPolicyForTesting({
        hostPlatform: 'win32',
        lane: Object.freeze({
          selection,
          registry,
          coordinator,
          processScope: createProviderBackedProcessScope({
            coordinator,
            selection,
            publishAuthority: bundle.publishAuthority,
            openRuntime: bundle.openRuntime,
          }),
        }),
      });
    }

    const primary = createLinuxPrimaryProcessAuthorityProviderBundle({
      stateRoot: exactChildDirectory(root, 'linux-primary'),
    });
    const broker = createLinuxBrokerProcessAuthorityProviderBundle({
      stateRoot: exactChildDirectory(root, 'linux-broker'),
    });
    const selected = options.linuxProviderMode === 'broker' ? broker : primary;
    const descriptor = options.linuxProviderMode === 'broker'
      ? LINUX_BROKER_PROCESS_AUTHORITY_DESCRIPTOR
      : LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR;
    if (selected.availability.state !== 'available') {
      return createExactTeacherAuthorityPolicyForTesting({
        hostPlatform: 'linux',
        unavailableDiagnostic:
          `Exact Teacher authority is unavailable: ${selected.availability.diagnostic}`,
      });
    }
    const registry = new ProcessAuthorityProviderRegistry(
      [primary.provider, broker.provider],
      {
        manifest: createLinuxProcessAuthorityProviderManifest({
          primaryArtifactPath: 'artifacts/linux/rasen-linux-process-authority-helper',
          brokerArtifactPath: 'artifacts/linux/rasen-linux-process-authority-broker',
        }),
        manifestRoot: root,
      }
    );
    const coordinator = createProcessAuthorityCoordinator({ registry });
    const selection = Object.freeze({
      providerId: descriptor.providerId,
      capabilityId: descriptor.capabilityId,
      protocolVersion: descriptor.protocolVersion,
    });
    return createExactTeacherAuthorityPolicyForTesting({
      hostPlatform: 'linux',
      lane: Object.freeze({
        selection,
        registry,
        coordinator,
        processScope: createProviderBackedProcessScope({
          coordinator,
          selection,
          publishAuthority: selected.publishAuthority,
          openRuntime: selected.openRuntime,
        }),
      }),
    });
  } catch (error) {
    return createExactTeacherAuthorityPolicyForTesting({
      hostPlatform: options.hostPlatform,
      unavailableDiagnostic:
        `Exact Teacher provider assembly is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
    });
  }
}
