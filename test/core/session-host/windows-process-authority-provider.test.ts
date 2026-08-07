import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_PUBLICATION_VERSION,
  createProcessAuthorityCoordinator,
  ProcessAuthorityProviderRegistry,
  type AuthorityOperationContext,
  type AuthorityPrepareInput,
  type ProviderAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import { encodeProcessAuthorityReference } from '../../../src/core/session-host/process-authority/reference-codec.js';
import {
  WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
  createWindowsProcessAuthorityProviderManifest,
} from '../../../src/core/session-host/process-authority/windows/contracts.js';
import {
  decodeWindowsPrivateAuthorityReference,
} from '../../../src/core/session-host/process-authority/windows/private-reference.js';
import {
  createWindowsAuthorityPublicationLedger,
} from '../../../src/core/session-host/process-authority/windows/publication-ledger.js';
import {
  createWindowsProcessAuthorityProviderBundle,
  createWindowsProcessAuthorityProviderBundleWithTransport,
  digestWindowsAuthorityLaunch,
  type WindowsAuthorityNativeTransport,
} from '../../../src/core/session-host/process-authority/windows/provider.js';
import {
  cleanupWindowsProcessAuthorityProviderFixtures,
  createWindowsProviderHarness,
  windowsPrepareAttestation,
  windowsPresentIdentityProbe,
  WINDOWS_FIXTURE_ARTIFACT_IDENTITY,
  type WindowsProviderHarness,
} from '../../helpers/windows-process-authority-provider-fixture.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const INPUT: AuthorityPrepareInput = Object.freeze({
  command: 'C:\\Windows\\System32\\cmd.exe',
  args: ['/c', 'exit', '0'],
  cwd: 'C:\\Windows\\Temp',
  env: { SystemRoot: 'C:\\Windows' },
});

const temporaryRoots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function context(
  phase: AuthorityOperationContext['phase'],
  operationId: string,
  signal: AbortSignal = new AbortController().signal
): AuthorityOperationContext {
  return { phase, operationId, deadline: Number.MAX_SAFE_INTEGER, signal };
}

async function prepared(harness: WindowsProviderHarness, operationId = 'prepare-1') {
  const result = await harness.bundle.provider.prepare(INPUT, context('prepare', operationId));
  if (!('reference' in result)) throw new Error('expected a prepared authority');
  return result;
}

async function publish(
  harness: WindowsProviderHarness,
  reference: ProviderAuthorityReference,
  operationId = 'publish-1'
): Promise<void> {
  const full = encodeProcessAuthorityReference(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, reference);
  const decoded = decodeWindowsPrivateAuthorityReference(reference);
  const { createHash } = await import('node:crypto');
  await harness.bundle.publishAuthority({
    reference: full,
    referenceDigest: createHash('sha256').update(String(full), 'utf8').digest('hex'),
    preparationOperationId: decoded.preparationOperationId,
    publicationVersion: PROCESS_AUTHORITY_PUBLICATION_VERSION,
  }, context('publish', operationId));
}

function ledgerSnapshot(root: string): Record<string, string> {
  const target = path.join(root, 'publication-ledger');
  if (!fs.existsSync(target)) return {};
  return Object.fromEntries(
    fs.readdirSync(target)
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(target, name), 'utf8')])
  );
}

afterEach(() => {
  cleanupWindowsProcessAuthorityProviderFixtures();
  for (const root of temporaryRoots.splice(0)) cleanupTempPath(root);
});

describe('Windows provider factory and prepared reference', () => {
  it('exposes the exact descriptor and refuses an incomplete transport', () => {
    const harness = createWindowsProviderHarness();
    expect(harness.bundle.provider.descriptor).toEqual(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR);
    expect(() => createWindowsProcessAuthorityProviderBundleWithTransport({
      transport: { async prepare() { return {}; } } as unknown as WindowsAuthorityNativeTransport,
      runtimeOpener: { open() { throw new Error('unused'); } },
      ledger: createWindowsAuthorityPublicationLedger({
        root: path.join(temporaryRoot('rasen-windows-incomplete-'), 'ledger'),
      }),
      artifactIdentity: WINDOWS_FIXTURE_ARTIFACT_IDENTITY,
    })).toThrow(/native transport is incomplete/u);
  });

  it('preserves the attested scope id, generation and capabilities without backfilling them', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    const attestation = harness.lastAttestation();
    const decoded = decodeWindowsPrivateAuthorityReference(authority.reference);
    expect(decoded.scopeId).toBe(attestation.scopeId);
    expect(decoded.generation).toBe(attestation.generation);
    expect(decoded.scopeCapability).toBe(attestation.scopeCapability);
    expect(decoded.controlCapability).toBe(attestation.controlCapability);
    expect(decoded.soleHandleAttestation).toBe(attestation.soleHandleAttestation);
    expect(decoded.launchDigest).toBe(digestWindowsAuthorityLaunch(INPUT));
  });

  it('refuses to invent an attested value the helper did not supply', async () => {
    for (const missing of [
      'scopeId',
      'generation',
      'scopeCapability',
      'controlCapability',
      'soleHandleAttestation',
      'bootIdentity',
    ] as const) {
      const root = temporaryRoot('rasen-windows-missing-');
      const bundle = createWindowsProcessAuthorityProviderBundleWithTransport({
        transport: {
          async prepare(request) {
            const attestation = windowsPrepareAttestation(request, 1);
            delete attestation[missing];
            return { state: 'inert', attestation };
          },
          async probeIdentity() { return { state: 'authority-absent' }; },
          async activate() { return { state: 'live' }; },
          async inspect() { return { state: 'inert' }; },
          async attemptGraceful() { return { state: 'not-observed' }; },
          async terminate() { return { state: 'exact-scope-empty' }; },
          async abort() { return { state: 'exact-scope-empty' }; },
        },
        runtimeOpener: { open() { throw new Error('unused'); } },
        ledger: createWindowsAuthorityPublicationLedger({ root: path.join(root, 'ledger') }),
        artifactIdentity: WINDOWS_FIXTURE_ARTIFACT_IDENTITY,
      });
      await expect(bundle.provider.prepare(INPUT, context('prepare', `missing-${missing}`)))
        .rejects.toThrow(/malformed|differs/u);
    }
  });

  it('rejects a prepare attestation bound to a different launch or artifact', async () => {
    const root = temporaryRoot('rasen-windows-binding-');
    const bundle = createWindowsProcessAuthorityProviderBundleWithTransport({
      transport: {
        async prepare(request) {
          return {
            state: 'inert',
            attestation: windowsPrepareAttestation(request, 1, {
              launchDigest: '0'.repeat(64),
            }),
          };
        },
        async probeIdentity() { return { state: 'authority-absent' }; },
        async activate() { return { state: 'live' }; },
        async inspect() { return { state: 'inert' }; },
        async attemptGraceful() { return { state: 'not-observed' }; },
        async terminate() { return { state: 'exact-scope-empty' }; },
        async abort() { return { state: 'exact-scope-empty' }; },
      },
      runtimeOpener: { open() { throw new Error('unused'); } },
      ledger: createWindowsAuthorityPublicationLedger({ root: path.join(root, 'ledger') }),
      artifactIdentity: WINDOWS_FIXTURE_ARTIFACT_IDENTITY,
    });
    await expect(bundle.provider.prepare(INPUT, context('prepare', 'binding-drift')))
      .rejects.toThrow(/identity binding differs/u);
  });

  it('bounds and closes the Windows launch snapshot', () => {
    expect(() => digestWindowsAuthorityLaunch({
      ...INPUT,
      command: 'cmd.exe',
    })).toThrow(/malformed/u);
    expect(() => digestWindowsAuthorityLaunch({
      ...INPUT,
      cwd: 'Temp',
    })).toThrow(/malformed/u);
    expect(() => digestWindowsAuthorityLaunch({
      ...INPUT,
      env: { Path: 'a', PATH: 'b' },
    })).toThrow(/environment is malformed/u);
    expect(() => digestWindowsAuthorityLaunch({
      ...INPUT,
      extra: 1,
    } as unknown as AuthorityPrepareInput)).toThrow(/not closed/u);
    // windowsVerbatimArguments is part of the immutable launch snapshot, so it
    // must change the digest rather than be silently dropped.
    expect(digestWindowsAuthorityLaunch({ ...INPUT, windowsVerbatimArguments: true }))
      .not.toBe(digestWindowsAuthorityLaunch({ ...INPUT, windowsVerbatimArguments: false }));
    expect(digestWindowsAuthorityLaunch({ ...INPUT, windowsVerbatimArguments: false }))
      .toBe(digestWindowsAuthorityLaunch(INPUT));
  });
});

describe('Windows replacement revalidation before observation or control', () => {
  it('reads the identity tuple before and after opening handles, in that order', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    expect(harness.calls.probePreOpen).toBe(0);
    await harness.bundle.provider.inspect(authority.reference, context('inspect', 'inspect-1'));
    expect(harness.calls.probePreOpen).toBe(1);
    expect(harness.calls.probePostOpen).toBe(1);
    expect(harness.calls.inspect).toBe(1);
  });

  it('issues no destructive control when the post-open reread differs', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    const attestation = harness.lastAttestation();
    harness.setProbeOverride('post-open', windowsPresentIdentityProbe(attestation, {
      guardianCreationTime: '133645512399999999',
    }));
    const outcome = await harness.bundle.provider.terminate(
      authority.reference,
      { reason: 'post-open-drift', graceMs: 0 },
      context('terminate', 'terminate-drift')
    );
    expect(outcome).toMatchObject({ state: 'identity-drift' });
    expect(harness.calls.force).toBe(0);
    expect(harness.calls.graceful).toBe(0);
  });

  it('issues no destructive control when the pre-open tuple already differs', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    harness.setScenario('identity-drift');
    await expect(harness.bundle.provider.abort(
      authority.reference,
      'drift-abort',
      context('abort', 'abort-drift')
    )).resolves.toMatchObject({ state: 'identity-drift' });
    expect(harness.calls.abort).toBe(0);
    expect(harness.destructiveControls()).toBe(0);
  });

  it('fails closed on a malformed reference before any native call', async () => {
    const harness = createWindowsProviderHarness();
    const bogus = 'rasen-provider-authority/1:aGVsbG8' as ProviderAuthorityReference;
    for (const call of [
      harness.bundle.provider.inspect(bogus, context('inspect', 'bogus-inspect')),
      harness.bundle.provider.terminate(
        bogus,
        { reason: 'bogus', graceMs: 0 },
        context('terminate', 'bogus-terminate')
      ),
      harness.bundle.provider.abort(bogus, 'bogus', context('abort', 'bogus-abort')),
    ]) {
      await expect(call).resolves.toMatchObject({ state: 'authority-unavailable' });
    }
    expect(harness.calls.probePreOpen).toBe(0);
    expect(harness.calls.probePostOpen).toBe(0);
    expect(harness.calls.force).toBe(0);
    expect(harness.calls.abort).toBe(0);
  });
});

describe('Windows abort and recursive termination', () => {
  it('returns an exact-empty receipt for prepared and published abort', async () => {
    const harness = createWindowsProviderHarness();
    const first = await prepared(harness, 'abort-prepared');
    await expect(harness.bundle.provider.abort(
      first.reference,
      'prepared-abort',
      context('abort', 'abort-prepared-op')
    )).resolves.toEqual({ state: 'exact-scope-empty' });

    const second = await prepared(harness, 'abort-published');
    await publish(harness, second.reference, 'abort-published-publish');
    await expect(harness.bundle.provider.abort(
      second.reference,
      'published-abort',
      context('abort', 'abort-published-op')
    )).resolves.toEqual({ state: 'exact-scope-empty' });
    expect(harness.calls.activate).toBe(0);
  });

  it('retains an abort that the authority did not report empty', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    harness.setControl({ state: 'authority-uncertain', diagnostic: 'not observed empty' });
    await expect(harness.bundle.provider.abort(
      authority.reference,
      'interrupted',
      context('abort', 'abort-uncertain')
    )).resolves.toMatchObject({ state: 'authority-uncertain' });
  });

  it('always issues force, so a graceful step alone can never close the authority', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    // The fixture's graceful step reports that the authority looked empty. That
    // is a hint, never a receipt: force must still be issued and the receipt
    // must come from the authority's own convergence.
    const outcome = await harness.bundle.provider.terminate(
      authority.reference,
      { reason: 'graceful-then-force', graceMs: 250 },
      context('terminate', 'terminate-graceful')
    );
    expect(harness.calls.graceful).toBe(1);
    expect(harness.calls.force).toBe(1);
    expect(outcome).toEqual({ state: 'exact-scope-empty' });
  });

  it('skips the graceful step entirely when no grace was requested', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    await harness.bundle.provider.terminate(
      authority.reference,
      { reason: 'force-only', graceMs: 0 },
      context('terminate', 'terminate-force-only')
    );
    expect(harness.calls.graceful).toBe(0);
    expect(harness.calls.force).toBe(1);
  });

  it('issues exactly one authority-wide force and lets the guardian converge', async () => {
    // The re-terminate loop belongs to the guardian, which holds the completion
    // port and is the only layer that can observe a NEW_PROCESS message at all.
    // A second loop here would put two deadline implementations in one path.
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    const outcome = await harness.bundle.provider.terminate(
      authority.reference,
      { reason: 'create-storm', graceMs: 0 },
      context('terminate', 'terminate-storm')
    );
    expect(outcome).toEqual({ state: 'exact-scope-empty' });
    expect(harness.calls.force).toBe(1);
  });

  it('classifies a re-terminate signal as a protocol violation rather than looping', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    harness.setReterminateSignal(true);
    const outcome = await harness.bundle.provider.terminate(
      authority.reference,
      { reason: 'protocol-violation', graceMs: 0 },
      context('terminate', 'terminate-reterminate')
    );
    expect(outcome).toMatchObject({ state: 'control-loss', phase: 'terminate' });
    expect(outcome).not.toMatchObject({ state: 'exact-scope-empty' });
    // Exactly one request: a regression that resurrected the second loop would
    // show up here as a count above one rather than as a silent behaviour change.
    expect(harness.calls.force).toBe(1);
  });

  it('issues no force at all once the phase deadline has expired', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    const controller = new AbortController();
    controller.abort();
    const outcome = await harness.bundle.provider.terminate(
      authority.reference,
      { reason: 'already-expired', graceMs: 0 },
      context('terminate', 'terminate-timeout', controller.signal)
    );
    expect(outcome).toMatchObject({ state: 'timeout', phase: 'terminate' });
    expect(outcome).not.toMatchObject({ state: 'exact-scope-empty' });
    expect(harness.calls.force).toBe(0);
  });

  it('passes only the closed termination intent, never a descendant identifier', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    await harness.bundle.provider.terminate(
      authority.reference,
      { reason: 'closed-intent', graceMs: 0 },
      context('terminate', 'terminate-intent')
    );
    expect(harness.forcedIntents).toEqual([{ reason: 'closed-intent', graceMs: 0 }]);
    expect(Object.keys(harness.forcedIntents[0]!).sort()).toEqual(['graceMs', 'reason']);
  });
});

describe('Windows inspect and durable publication phase', () => {
  it('reports prepared-inert and published-inert from the ledger, not from the helper', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    harness.setObservation({ state: 'prepared-inert' });
    await expect(harness.bundle.provider.inspect(
      authority.reference,
      context('inspect', 'inspect-prepared')
    )).resolves.toEqual({ state: 'prepared-inert' });

    await publish(harness, authority.reference);
    await expect(harness.bundle.provider.inspect(
      authority.reference,
      context('inspect', 'inspect-published')
    )).resolves.toEqual({ state: 'published-inert' });
  });

  it('reports live, root-exited and exact-empty from the authority itself', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    for (const observation of [
      { state: 'live' },
      { state: 'root-exited', code: 3_221_225_477, signal: null },
      { state: 'exact-scope-empty' },
    ] as const) {
      harness.setObservation(observation);
      await expect(harness.bundle.provider.inspect(
        authority.reference,
        context('inspect', `inspect-${observation.state}`)
      )).resolves.toEqual(observation);
    }
  });

  it('refuses activation until the exact durable record exists', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    await expect(authority.activate(context('activate', 'activate-early')))
      .resolves.toMatchObject({ state: 'authority-uncertain' });
    expect(harness.calls.activate).toBe(0);

    await publish(harness, authority.reference);
    await expect(authority.activate(context('activate', 'activate-ready')))
      .resolves.toEqual({ state: 'live' });
    expect(harness.calls.activate).toBe(1);
  });

  it('writes no publication state during activation and sends no publish frame', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    await publish(harness, authority.reference);
    const before = ledgerSnapshot(harness.fixtureRoot);
    const beforeCalls = { ...harness.calls };
    await authority.activate(context('activate', 'activate-no-write'));
    expect(ledgerSnapshot(harness.fixtureRoot)).toEqual(before);
    expect({ ...harness.calls, activate: beforeCalls.activate }).toEqual(beforeCalls);
  });

  it('retains uncertainty when the ledger is unreadable rather than activating', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    await publish(harness, authority.reference);
    const ledgerRoot = path.join(harness.fixtureRoot, 'publication-ledger');
    for (const name of fs.readdirSync(ledgerRoot)) {
      if (name.endsWith('.entry')) fs.writeFileSync(path.join(ledgerRoot, name), '{"forged":1}');
    }
    await expect(authority.activate(context('activate', 'activate-forged')))
      .resolves.toMatchObject({ state: 'authority-uncertain' });
    expect(harness.calls.activate).toBe(0);
  });
});

describe('Windows production provider entry point', () => {
  it('assembles from a trusted state root and stays fail-closed without a pinned artifact', async () => {
    const stateRoot = temporaryRoot('rasen-windows-production-');
    const bundle = createWindowsProcessAuthorityProviderBundle({ stateRoot });
    expect(bundle.provider.descriptor).toEqual(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR);
    expect(fs.existsSync(path.join(stateRoot, 'runtime', 'publication-ledger'))).toBe(true);

    const result = await bundle.provider.prepare(INPUT, context('prepare', 'production-prepare'));
    expect(result).toEqual({
      state: 'authority-unavailable',
      diagnostic: 'selected provider prerequisites unavailable',
    });
    expect('reference' in result).toBe(false);
  });

  it('retains rather than falls back on every control verb', async () => {
    const stateRoot = temporaryRoot('rasen-windows-production-control-');
    const bundle = createWindowsProcessAuthorityProviderBundle({ stateRoot });
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness, 'production-reference');
    for (const call of [
      bundle.provider.inspect(authority.reference, context('inspect', 'production-inspect')),
      bundle.provider.terminate(
        authority.reference,
        { reason: 'production', graceMs: 0 },
        context('terminate', 'production-terminate')
      ),
      bundle.provider.abort(authority.reference, 'production', context('abort', 'production-abort')),
    ]) {
      await expect(call).resolves.toMatchObject({ state: 'authority-unavailable' });
    }
    expect(() => bundle.openRuntime(
      encodeProcessAuthorityReference(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, authority.reference)
    )).toThrow(/native runtime is unavailable/u);
  });

  it('forbids dependency injection through the production options', () => {
    const stateRoot = temporaryRoot('rasen-windows-production-injection-');
    expect(() => createWindowsProcessAuthorityProviderBundle({
      stateRoot,
      transport: { async prepare() { return {}; } },
    } as unknown as { stateRoot: string })).toThrow(/forbid dependency injection/u);
    expect(() => createWindowsProcessAuthorityProviderBundle({ stateRoot: 'relative/path' }))
      .toThrow(/state root is malformed/u);
  });

  it('is selectable through the manifest-bound registry without becoming a default', () => {
    const stateRoot = temporaryRoot('rasen-windows-production-registry-');
    const bundle = createWindowsProcessAuthorityProviderBundle({ stateRoot });
    const registry = new ProcessAuthorityProviderRegistry([bundle.provider], {
      manifest: createWindowsProcessAuthorityProviderManifest({
        artifactPath: 'dist/native/win32-x64/rasen-windows-process-authority-helper.exe',
      }),
      manifestRoot: process.cwd(),
    });
    expect(registry.descriptors()).toEqual([WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR]);
    const coordinator = createProcessAuthorityCoordinator({ registry });
    expect(coordinator).toBeTruthy();
  });

  it('opens a runtime bridge that exposes only transport streams', async () => {
    const harness = createWindowsProviderHarness();
    const authority = await prepared(harness);
    const runtime = harness.bundle.openRuntime(
      encodeProcessAuthorityReference(WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR, authority.reference)
    );
    expect(Object.keys(runtime).sort()).toEqual([
      'exactScopeEmpty',
      'rootExited',
      'stderr',
      'stdin',
      'stdout',
    ]);
    expect(runtime.stdin).toBeInstanceOf(PassThrough);
  });
});

describe('the Windows availability transaction (task 4.8)', () => {
  // `design.md:202-204` enumerates the unavailability causes and promises each returns typed
  // `authority-unavailable`. Section 8's census measured that no probe produced that code
  // (`S8-F3`), and before this transaction existed every input below threw "prepare outcome is
  // malformed" instead. Each row is therefore a RED that was real, not a hypothetical one.
  const UNAVAILABLE_CAUSES = [
    ['ambient-job-refuses-nesting', /ambient Job that refuses nesting/u],
    ['job-limit-mask-differs', /exact expected value/u],
    ['completion-port-associated-late', /associated on an empty Job/u],
    ['boot-identity-unobtainable', /no exact boot identity source/u],
    ['endpoint-not-first-instance', /first instance/u],
    ['state-root-untrusted', /reparse point/u],
    ['artifact-unavailable', /manifest identity check/u],
    ['native-unavailable', /denied or unsupported/u],
  ] as const;

  function bundleWith(prepareResult: unknown, aborts: string[] = []) {
    const stateRoot = temporaryRoot('rasen-windows-availability-');
    const transport = {
      async prepare() { return prepareResult; },
      async probeIdentity() { return undefined; },
      async activate() { return { state: 'live' }; },
      async inspect() { return { state: 'live' }; },
      async attemptGraceful() { return { state: 'not-observed' }; },
      async terminate() { return { state: 'exact-scope-empty' }; },
      async abort(_reference: unknown, reason: string) {
        aborts.push(reason);
        return { state: 'exact-scope-empty' };
      },
    } as unknown as WindowsAuthorityNativeTransport;
    return createWindowsProcessAuthorityProviderBundleWithTransport({
      transport,
      runtimeOpener: { open() { throw new TypeError('not used'); } },
      ledger: createWindowsAuthorityPublicationLedger({ root: stateRoot }),
      artifactIdentity: WINDOWS_FIXTURE_ARTIFACT_IDENTITY,
    });
  }

  it.each(UNAVAILABLE_CAUSES)(
    'maps the enumerated cause %s to typed unavailable with a bounded diagnostic',
    async (code, expected) => {
      const bundle = bundleWith({ state: 'authority-unavailable', diagnosticCode: code });
      const result = await bundle.provider.prepare(INPUT, context('prepare', `unavailable-${code}`));
      expect(result).toEqual({
        state: 'authority-unavailable',
        diagnostic: expect.stringMatching(expected),
      });
      expect('reference' in result).toBe(false);
      // Bounded: one sentence, and nothing sensitive carried through from the native side.
      expect((result as { diagnostic: string }).diagnostic.length).toBeLessThan(160);
      expect((result as { diagnostic: string }).diagnostic).toContain(code);
    }
  );

  it('does NOT widen an unrecognised native code into unavailable', async () => {
    // The discriminating half. If the mapping were a blanket `state === 'authority-unavailable'`
    // check, a native failure mode nobody has enumerated would arrive as "prerequisites
    // unavailable" and be indistinguishable from a host that genuinely cannot host an authority.
    const bundle = bundleWith({
      state: 'authority-unavailable',
      diagnosticCode: 'something-nobody-enumerated',
    });
    await expect(bundle.provider.prepare(INPUT, context('prepare', 'unavailable-unknown')))
      .rejects.toThrow(/prepare outcome is malformed/u);
  });

  it('revalidates the attested limit mask before the codec, not after it', async () => {
    // The ordering is the whole point. The private-reference codec already rejects a wrong
    // mask -- but it rejects it by throwing "private reference is malformed", which is the
    // wrong verdict: a host whose Job would not take the exact mask has not sent a corrupt
    // message, it has failed a prerequisite. Revalidating after the codec is unreachable dead
    // code, which is exactly what the first version of this was.
    const request = {
      preparationOperationId: 'revalidate-mask',
      launchDigest: digestWindowsAuthorityLaunch(INPUT),
    };
    const bundle = bundleWith({
      state: 'inert',
      attestation: windowsPrepareAttestation(request, 7, { jobLimitMask: 0x2001 }),
    });
    const result = await bundle.provider.prepare(INPUT, context('prepare', 'revalidate-mask'));
    expect(result).toEqual({
      state: 'authority-unavailable',
      diagnostic: expect.stringMatching(/exact expected value/u),
    });
    expect((result as { diagnostic: string }).diagnostic).not.toMatch(/malformed/u);
  });

  it('revalidates that the completion port was associated on an empty Job', async () => {
    const request = {
      preparationOperationId: 'revalidate-port',
      launchDigest: digestWindowsAuthorityLaunch(INPUT),
    };
    const bundle = bundleWith({
      state: 'inert',
      attestation: windowsPrepareAttestation(request, 8, {
        activeProcessCountAtPortAssociation: 1,
      }),
    });
    const result = await bundle.provider.prepare(INPUT, context('prepare', 'revalidate-port'));
    expect(result).toEqual({
      state: 'authority-unavailable',
      diagnostic: expect.stringMatching(/associated on an empty Job/u),
    });
  });

  it('GREEN: an attestation whose facts all revalidate still prepares', async () => {
    // Without this the assertions above would not distinguish "revalidation rejects a bad fact"
    // from "revalidation rejects everything".
    const request = {
      preparationOperationId: 'revalidate-ok',
      launchDigest: digestWindowsAuthorityLaunch(INPUT),
    };
    const bundle = bundleWith({
      state: 'inert',
      attestation: windowsPrepareAttestation(request, 9),
    });
    const result = await bundle.provider.prepare(INPUT, context('prepare', 'revalidate-ok'));
    expect('reference' in result).toBe(true);
  });
});
