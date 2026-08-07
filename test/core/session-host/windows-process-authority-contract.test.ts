import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
  ProcessAuthorityProviderRegistry,
  RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
  RECURSIVE_PROCESS_SCOPE_SEMANTICS,
  validateProcessAuthorityProviderManifest,
  type ProcessAuthorityProvider,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
  WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
  WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION,
  createWindowsProcessAuthorityProviderManifest,
} from '../../../src/core/session-host/process-authority/windows/contracts.js';
import {
  WINDOWS_MAX_EXIT_STATUS,
  WINDOWS_STILL_ACTIVE_SENTINEL,
  mapWindowsNativeControlOutcome,
  mapWindowsNativeObservation,
} from '../../../src/core/session-host/process-authority/windows/outcomes.js';

const ARTIFACT_PATH = 'dist/native/win32-x64/rasen-windows-process-authority-helper.exe';
const WINDOWS_SOURCE_ROOT = 'src/core/session-host/process-authority/windows';

function windowsSourceFiles(): readonly string[] {
  const root = path.resolve(WINDOWS_SOURCE_ROOT);
  return fs.readdirSync(root)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(root, name));
}

function stubProvider(
  descriptor: ProcessAuthorityProvider['descriptor']
): ProcessAuthorityProvider {
  return {
    descriptor,
    async prepare() { throw new Error('unused'); },
    async inspect() { throw new Error('unused'); },
    async terminate() { throw new Error('unused'); },
    async abort() { throw new Error('unused'); },
  };
}

describe('Windows process-authority provider tuple', () => {
  it('declares the exact manifest-bound tuple and the complete semantic list', () => {
    expect(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR).toEqual({
      providerId: 'rasen.windows.job-object',
      capabilityId: RECURSIVE_PROCESS_SCOPE_CAPABILITY_ID,
      protocolVersion: 1,
      commonContractVersion: PROCESS_AUTHORITY_COMMON_CONTRACT_VERSION,
      providerReferenceVersion: 1,
      semantics: RECURSIVE_PROCESS_SCOPE_SEMANTICS,
    });
    expect(WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID).toBe('rasen.windows.job-object');
    expect(WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION).toBe(1);
    expect(WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION).toBe(1);
    expect([...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR.semantics]).toEqual([
      'workload-non-escape',
      'publish-before-activate',
      'root-exit-distinct',
      'natural-exact-empty',
      'recursive-terminate',
      'recursive-abort',
      'replacement-recovery',
      'bounded-controls',
      'identity-drift-detection',
      'event-completeness',
    ]);
  });

  it('publishes exactly one Windows provider entry, because Windows has no broker axis', () => {
    const manifest = createWindowsProcessAuthorityProviderManifest({
      artifactPath: ARTIFACT_PATH,
    });
    expect(manifest.providers).toHaveLength(1);
    expect(manifest.providers[0]).toMatchObject({
      ...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
      artifactPath: ARTIFACT_PATH,
    });
    const validated = validateProcessAuthorityProviderManifest(manifest, process.cwd());
    expect(validated.providers.map((entry) => entry.providerId)).toEqual([
      'rasen.windows.job-object',
    ]);
  });

  it('selects the exact tuple and nothing else when the tuple differs', () => {
    const manifest = createWindowsProcessAuthorityProviderManifest({
      artifactPath: ARTIFACT_PATH,
    });
    const registry = new ProcessAuthorityProviderRegistry(
      [stubProvider(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR)],
      { manifest, manifestRoot: process.cwd() }
    );
    expect(registry.select(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR)).toMatchObject({
      state: 'selected',
      descriptor: WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
    });
    for (const drift of [
      { ...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, protocolVersion: 2 },
      { ...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, providerId: 'rasen.windows.job-object-v2' },
      { ...WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, capabilityId: 'rasen-process-group/1' },
    ]) {
      const outcome = registry.select(drift);
      expect(outcome.state).toBe('authority-unavailable');
      expect(outcome).not.toHaveProperty('provider');
    }
  });

  it('rejects a second Windows tuple sharing the provider id', () => {
    const manifest = createWindowsProcessAuthorityProviderManifest({
      artifactPath: ARTIFACT_PATH,
    });
    expect(() => new ProcessAuthorityProviderRegistry(
      [
        stubProvider(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR),
        stubProvider(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR),
      ],
      { manifest, manifestRoot: process.cwd() }
    )).toThrow(/Duplicate process-authority provider id/u);
  });

  it('names no fallback mechanism anywhere in the Windows provider source', () => {
    // The forbidden set is exactly what the contract says authority must never
    // be inferred from. Matching is case-insensitive on the source text.
    const forbidden = [
      'taskkill',
      'CreateToolhelp32Snapshot',
      'Process32First',
      'EnumProcesses',
      'Win32_Process',
      'GenerateConsoleCtrlEvent',
      'process-capsule',
      'process-group',
      'rasen.linux.',
    ];
    const offenders: string[] = [];
    for (const file of windowsSourceFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        // The design prose in comments is allowed to name what is excluded, so
        // only non-comment lines are inspected.
        const code = text
          .split('\n')
          .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
          .join('\n');
        if (code.toLowerCase().includes(needle.toLowerCase())) {
          offenders.push(`${path.basename(file)}:${needle}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Windows process-authority lifecycle mapping', () => {
  it.each([
    ['prepared-inert', { state: 'inert' }, 'prepared-inert'],
    ['published-inert', { state: 'inert' }, 'published-inert'],
  ] as const)('maps native inert to %s under the ledger phase', (_name, native, phase) => {
    expect(mapWindowsNativeObservation(native, phase, 'inspect')).toEqual({ state: phase });
  });

  it('maps the live and exact-empty states without widening them', () => {
    expect(mapWindowsNativeObservation({ state: 'live' }, 'prepared-inert', 'inspect'))
      .toEqual({ state: 'live' });
    expect(mapWindowsNativeControlOutcome({ state: 'exact-scope-empty' }, 'terminate'))
      .toEqual({ state: 'exact-scope-empty' });
  });

  it.each([
    ['authority-unavailable', 'native-unavailable'],
    ['authority-uncertain', 'native-uncertain'],
    ['identity-drift', 'identity-drift'],
    ['event-gap', 'event-gap'],
  ] as const)('retains %s with a bounded diagnostic and no phase', (state, diagnosticCode) => {
    const mapped = mapWindowsNativeObservation(
      { state, diagnosticCode },
      'prepared-inert',
      'inspect'
    );
    expect(mapped).toEqual({
      state,
      diagnostic: `Windows process authority is retained (${diagnosticCode}).`,
    });
  });

  it.each(['timeout', 'control-loss'] as const)('carries the exact phase on %s', (state) => {
    expect(mapWindowsNativeControlOutcome(
      { state, diagnosticCode: 'native-operation-timeout' },
      'terminate'
    )).toEqual({
      state,
      phase: 'terminate',
      diagnostic: 'Windows process authority is retained (native-operation-timeout).',
    });
  });

  it('rejects a state outside the frozen common vocabulary', () => {
    for (const native of [
      { state: 'closed' },
      { state: 'scope-empty' },
      { state: 'live', extra: 1 },
      { state: 'authority-uncertain', diagnosticCode: 'invented-code' },
      { state: 'inert' },
    ]) {
      expect(mapWindowsNativeControlOutcome(native, 'inspect')).toMatchObject({
        state: 'control-loss',
        phase: 'inspect',
      });
    }
  });
});

describe('Windows root-exit status fidelity', () => {
  it('preserves a high-bit status as an exact unsigned value', () => {
    expect(mapWindowsNativeObservation(
      { state: 'root-exited', code: 0xc000_0005, signal: null },
      'published-inert',
      'inspect'
    )).toEqual({ state: 'root-exited', code: 3_221_225_477, signal: null });
    expect(mapWindowsNativeObservation(
      { state: 'root-exited', code: WINDOWS_MAX_EXIT_STATUS, signal: null },
      'published-inert',
      'inspect'
    )).toEqual({ state: 'root-exited', code: 4_294_967_295, signal: null });
  });

  it('reports the still-running sentinel as an exit status, never as live', () => {
    expect(WINDOWS_STILL_ACTIVE_SENTINEL).toBe(259);
    const mapped = mapWindowsNativeObservation(
      { state: 'root-exited', code: WINDOWS_STILL_ACTIVE_SENTINEL, signal: null },
      'published-inert',
      'inspect'
    );
    expect(mapped).toEqual({ state: 'root-exited', code: 259, signal: null });
    expect(mapped.state).not.toBe('live');
  });

  it('rejects a sign-extended status rather than repairing it', () => {
    expect(mapWindowsNativeObservation(
      { state: 'root-exited', code: -1_073_741_819, signal: null },
      'published-inert',
      'inspect'
    )).toMatchObject({ state: 'control-loss', phase: 'inspect' });
  });

  it('rejects a truncated or out-of-range status', () => {
    for (const code of [WINDOWS_MAX_EXIT_STATUS + 1, 1.5, Number.NaN]) {
      expect(mapWindowsNativeControlOutcome(
        { state: 'root-exited', code, signal: null },
        'terminate'
      )).toMatchObject({ state: 'control-loss', phase: 'terminate' });
    }
  });

  it('never accepts a synthesized signal name, because Windows has no signals', () => {
    for (const value of [
      { state: 'root-exited', code: null, signal: 'SIGKILL' },
      { state: 'root-exited', code: 1, signal: 'SIGTERM' },
      { state: 'root-exited', code: null, signal: null },
    ]) {
      expect(mapWindowsNativeObservation(value, 'published-inert', 'inspect')).toMatchObject({
        state: 'control-loss',
        phase: 'inspect',
      });
    }
  });
});
