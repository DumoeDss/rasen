import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type DefinitionSourceV2,
  createTrustedExecutionAdapterCatalog,
} from '../../../src/core/pipeline-registry/index.js';
import {
  resolveCapabilityBindings,
  resolveRuntimeExecutionProfile,
} from '../../../src/core/pipeline-registry/profile-resolver.js';
import type { AttestationAuthority, Digest } from '../../../src/core/change-run/contracts.js';
import { lowerRuntimePlan } from '../../../src/core/change-run/internal/lowerer.js';
import { buildAgentAction } from '../../../src/core/change-run/internal/actions.js';
import { canonicalJson, domainDigest } from '../../../src/core/change-run/internal/identity.js';
import { fixtureWorkspaceRevision } from '../change-run/reconciler-fixture.js';
import {
  TEST_ATTESTATION_AUTHORITY,
  trustedCatalogForBindings,
  trustedDescriptor,
} from '../../fixtures/trusted-completion.js';

const BUG_FIX = {
  version: 1,
  name: 'bug-fix',
  description: 'fixture',
  stages: [
    { id: 'propose', skill: 'rasen-propose', role: 'planner', requires: [], gate: true },
    { id: 'apply', skill: 'rasen-apply-change', role: 'implementer', requires: ['propose'], gate: true },
    { id: 'verify', skill: 'rasen-review', role: 'reviewer', requires: ['apply'] },
    { id: 'ship', skill: 'rasen-ship', role: 'shipper', requires: ['verify'], gate: true },
    { id: 'archive', skill: 'rasen-archive-change', role: 'shipper', requires: ['ship'] },
  ],
} as const;

function descriptor(skill: string, digest: string) {
  return {
    id: `skill:${skill}`,
    version: digest,
    availability: 'enabled' as const,
    inputs: [],
    artifacts: [],
    outcomes: ['completed'],
    limits: {},
  };
}

function nativeV2Atomic(
  execution: DefinitionSourceV2['root']['nodes'][number] extends never
    ? never
    : Record<string, unknown>,
  gated = false
): DefinitionSourceV2 {
  return {
    version: 2,
    id: 'pipeline:native-profile',
    sourceId: 'project:native-profile',
    name: 'native-profile',
    inputs: [],
    artifacts: [],
    outcomes: gated ? ['approved', 'rejected', 'completed'] : ['completed'],
    declarations: [],
    root: {
      nodes: [
        {
          id: 'inspect',
          kind: 'AtomicStage',
          capability: {
            id: 'skill:rasen-review',
            version: `sha256:${'3'.repeat(64)}`,
          },
          execution,
        },
        ...(gated
          ? [
              {
                id: 'inspect-gate',
                kind: 'Gate' as const,
                target: 'inspect',
                outcomes: ['approved', 'rejected'],
                dispositions: {
                  approved: 'proceed' as const,
                  rejected: 'escalate' as const,
                },
              },
            ]
          : []),
      ],
      connections: [],
    },
  } as DefinitionSourceV2;
}

const sourceRevision = {
  layer: 'project' as const,
  kind: 'pipeline-yaml',
  sourceId: 'project:native-profile',
  authoredContentDigest: `sha256:${'a'.repeat(64)}` as const,
  semanticDigest: `sha256:${'b'.repeat(64)}` as const,
};

function alternateAuthority(): AttestationAuthority {
  const { publicKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return {
    format: 'change-run-attestation-authority/1',
    algorithm: 'ed25519',
    keyId: 'alternate-test-host',
    keyVersion: '2',
    publicKey: {
      format: 'spki-der',
      encoding: 'base64',
      value: Buffer.from(der).toString('base64'),
      digest: `sha256:${createHash('sha256').update(der).digest('hex')}` as Digest,
    },
  };
}

describe('resolveCapabilityBindings (3.4 profile construction)', () => {
  it('does not let an authored Definition nominate or override an attestation authority', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
    ]);
    const authored = structuredClone(nativeV2Atomic({
      version: 1,
      role: 'reviewer',
      workspace: { access: 'read' },
    })) as any;
    authored.root.nodes[0].capability.attestationAuthority =
      alternateAuthority();
    const prepared = EcpDefinitionModule.prepare(authored, catalog);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw prepared.error;
    expect(
      (prepared.value.definition.root.nodes[0] as any).capability
        .attestationAuthority
    ).toEqual(expect.objectContaining({ keyId: 'alternate-test-host' }));
    const provisional = resolveCapabilityBindings(prepared.value, catalog);
    const resolved = resolveCapabilityBindings(
      prepared.value,
      catalog,
      trustedCatalogForBindings(provisional, TEST_ATTESTATION_AUTHORITY)
    );
    expect(resolved[0]!.adapter.attestationAuthority).toEqual(
      TEST_ATTESTATION_AUTHORITY
    );
  });

  it('fails closed for missing, mismatched, or ambiguous exact host authority', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
    ]);
    const prepared = EcpDefinitionModule.prepare(
      nativeV2Atomic({
        version: 1,
        role: 'reviewer',
        workspace: { access: 'read' },
      }),
      catalog
    );
    if (!prepared.ok) throw prepared.error;
    const provisional = resolveCapabilityBindings(prepared.value, catalog);
    const exact = provisional[0]!.adapter;

    expect(() =>
      resolveCapabilityBindings(
        prepared.value,
        catalog,
        createTrustedExecutionAdapterCatalog([])
      )
    ).toThrow(/No host-owned attestation authority exactly matches/);
    expect(() =>
      resolveCapabilityBindings(
        prepared.value,
        catalog,
        createTrustedExecutionAdapterCatalog([
          trustedDescriptor({
            id: exact.id,
            version: exact.version,
            contentDigest: `sha256:${'f'.repeat(64)}` as Digest,
          }),
        ])
      )
    ).toThrow(/exactly matches/);
    const duplicate = trustedDescriptor({
      id: exact.id,
      version: exact.version,
      contentDigest: exact.contentDigest as Digest,
    });
    expect(() =>
      resolveCapabilityBindings(
        prepared.value,
        catalog,
        createTrustedExecutionAdapterCatalog([duplicate, duplicate])
      )
    ).toThrow(/Multiple host-owned/);
  });

  it('rejects malformed, digest-mismatched, and non-Ed25519 host keys', () => {
    const adapter = {
      id: 'adapter:rasen-review',
      version: '1',
      contentDigest: `sha256:${'3'.repeat(64)}` as Digest,
    };
    expect(() =>
      createTrustedExecutionAdapterCatalog([
        trustedDescriptor(adapter, {
          ...TEST_ATTESTATION_AUTHORITY,
          publicKey: {
            ...TEST_ATTESTATION_AUTHORITY.publicKey,
            value: 'not-base64',
          },
        }),
      ])
    ).toThrow(/base64|contract/i);
    expect(() =>
      createTrustedExecutionAdapterCatalog([
        trustedDescriptor(adapter, {
          ...TEST_ATTESTATION_AUTHORITY,
          publicKey: {
            ...TEST_ATTESTATION_AUTHORITY.publicKey,
            digest: `sha256:${'0'.repeat(64)}` as Digest,
          },
        }),
      ])
    ).toThrow(/digest/);
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const der = publicKey.export({ format: 'der', type: 'spki' });
    expect(() =>
      createTrustedExecutionAdapterCatalog([
        trustedDescriptor(adapter, {
          format: 'change-run-attestation-authority/1',
          algorithm: 'ed25519',
          keyId: 'rsa-substitution',
          keyVersion: '1',
          publicKey: {
            format: 'spki-der',
            encoding: 'base64',
            value: Buffer.from(der).toString('base64'),
            digest: `sha256:${createHash('sha256').update(der).digest('hex')}` as Digest,
          },
        }),
      ])
    ).toThrow(/not Ed25519/);
  });

  it('freezes exact authority into capability/profile digests and new Actions', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
    ]);
    const prepared = EcpDefinitionModule.prepare(
      nativeV2Atomic({
        version: 1,
        role: 'reviewer',
        workspace: { access: 'read' },
      }),
      catalog
    );
    if (!prepared.ok) throw prepared.error;
    const provisional = resolveCapabilityBindings(prepared.value, catalog);
    const firstCatalog = trustedCatalogForBindings(
      provisional,
      TEST_ATTESTATION_AUTHORITY
    );
    const secondCatalog = trustedCatalogForBindings(
      provisional,
      alternateAuthority()
    );
    const first = resolveRuntimeExecutionProfile(
      prepared.value,
      catalog,
      [],
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      firstCatalog
    );
    const second = resolveRuntimeExecutionProfile(
      prepared.value,
      catalog,
      [],
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      undefined,
      secondCatalog
    );

    expect(first.capabilities[0]!.adapter.attestationAuthority).toEqual(
      TEST_ATTESTATION_AUTHORITY
    );
    expect(second.capabilityProfileDigest).not.toBe(first.capabilityProfileDigest);
    expect(second.profileDigest).not.toBe(first.profileDigest);

    const runId = `run:${'d'.repeat(64)}` as const;
    const firstPlan = lowerRuntimePlan(prepared.value, first, runId);
    const secondPlan = lowerRuntimePlan(prepared.value, second, runId);
    expect(domainDigest('change-run-sealed-runtime-plan/1', firstPlan)).not.toBe(
      domainDigest('change-run-sealed-runtime-plan/1', secondPlan)
    );
    const nodeId = firstPlan.nodes[0]!.nodeId;
    const build = (profile: typeof first) => buildAgentAction(
      {
        capability: profile.capabilities[0]!,
        stage: profile.policy.stages[0]!,
        executionProfileDigest: profile.profileDigest,
        policyDigest: profile.policyDigest,
      },
      {
        runId,
        nodeId,
        occurrence: 1,
        attemptOrdinal: 0,
        expectedBeforeWorkspace: fixtureWorkspaceRevision,
      },
      { input: {} }
    );
    const firstAction = build(first);
    const secondAction = build(second);
    expect(canonicalJson(firstAction)).not.toBe(canonicalJson(secondAction));
    expect(firstAction.completionAuthority?.attestationAuthority).toEqual(
      TEST_ATTESTATION_AUTHORITY
    );
  });

  it('binds each stage to the authoritative skill content digest', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-propose', `sha256:${'1'.repeat(64)}`),
      descriptor('rasen-apply-change', `sha256:${'2'.repeat(64)}`),
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
      descriptor('rasen-ship', `sha256:${'4'.repeat(64)}`),
      descriptor('rasen-archive-change', `sha256:${'5'.repeat(64)}`),
    ]);
    const prepared = EcpDefinitionModule.prepare(BUG_FIX, catalog);
    if (!prepared.ok) throw prepared.error;

    const bindings = resolveCapabilityBindings(prepared.value, catalog);
    expect(bindings).toHaveLength(5);
    const apply = bindings.find((b) => b.nodeId === 'stage:apply')!;
    // The skill content digest (descriptor.version) binds contract + adapter +
    // result/evidence — one canonical identity per installed skill.
    expect(apply.contract.digest).toBe(`sha256:${'2'.repeat(64)}`);
    expect(apply.adapter.contentDigest).toBe(`sha256:${'2'.repeat(64)}`);
    expect(apply.resultContract.digest).toBe(`sha256:${'2'.repeat(64)}`);
    expect(apply.evidenceContract.digest).toBe(`sha256:${'2'.repeat(64)}`);
    expect(apply.authoredCapability.version).toBe(`sha256:${'2'.repeat(64)}`);
    expect(apply.actionKind).toBe('agent');
    expect(apply.effects[0]!.slot).toBe('workspace');
  });

  it('derives workspace access from the stage role (reviewer/verifier read)', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-propose', `sha256:${'1'.repeat(64)}`),
      descriptor('rasen-apply-change', `sha256:${'2'.repeat(64)}`),
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
      descriptor('rasen-ship', `sha256:${'4'.repeat(64)}`),
      descriptor('rasen-archive-change', `sha256:${'5'.repeat(64)}`),
    ]);
    const prepared = EcpDefinitionModule.prepare(BUG_FIX, catalog);
    if (!prepared.ok) throw prepared.error;
    const bindings = resolveCapabilityBindings(prepared.value, catalog);
    const verify = bindings.find((b) => b.nodeId === 'stage:verify')!;
    expect(verify.workspace.access).toBe('read');
    const apply = bindings.find((b) => b.nodeId === 'stage:apply')!;
    expect(apply.workspace.access).toBe('write');
  });

  it('rejects a stage whose skill is absent from the catalog', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-propose', `sha256:${'1'.repeat(64)}`),
      descriptor('rasen-apply-change', `sha256:${'2'.repeat(64)}`),
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
      descriptor('rasen-ship', `sha256:${'4'.repeat(64)}`),
      // rasen-archive-change missing
    ]);
    const prepared = EcpDefinitionModule.prepare(BUG_FIX, catalog);
    if (!prepared.ok) throw prepared.error;
    expect(() => resolveCapabilityBindings(prepared.value, catalog)).toThrow();
  });

  it('resolves native v2 capability access and authored execution policy without review synthesis', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
    ]);
    const prepared = EcpDefinitionModule.prepare(
      nativeV2Atomic({
        version: 1,
        role: 'planner',
        workspace: { access: 'none' },
        leadReview: true,
        verifyPolicy: 'adaptive',
        runtime: 'codex',
        model: 'gpt-native',
        effort: 'high',
        sandbox: 'read-only',
        sessionReuse: 'run-planner',
        handoff: { threshold: 0.25, maxRelays: 4, stallLimit: 2 },
      }, true),
      catalog
    );
    if (!prepared.ok) throw prepared.error;

    const profile = resolveRuntimeExecutionProfile(
      prepared.value,
      catalog,
      [],
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 }
    );

    expect(profile.capabilities).toEqual([
      expect.objectContaining({
        nodeId: 'root:inspect',
        authoredCapability: {
          id: 'skill:rasen-review',
          version: `sha256:${'3'.repeat(64)}`,
        },
        workspace: { access: 'none', resources: [] },
        effects: [],
      }),
    ]);
    expect(profile.policy.stages).toEqual([
      expect.objectContaining({
        nodeId: 'root:inspect',
        role: 'planner',
        model: 'gpt-native',
        effort: 'high',
        runtime: 'codex',
        sandbox: 'read-only',
        gate: true,
        sessionReuse: 'same-invocation',
        sessionReuseAuthored: 'run-planner',
        provenance: expect.objectContaining({
          role: 'definition',
          model: 'stage',
          effort: 'stage',
          runtime: 'stage',
          sandbox: 'definition',
          gate: 'stage',
          sessionReuse: 'definition',
        }),
      }),
    ]);
  });

  it('applies native v2 stage config overrides by logical id with scope provenance', () => {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-review', `sha256:${'3'.repeat(64)}`),
    ]);
    const prepared = EcpDefinitionModule.prepare(
      nativeV2Atomic({
        version: 1,
        role: 'reviewer',
        workspace: { access: 'read' },
        runtime: 'claude',
        model: 'declared-model',
      }),
      catalog
    );
    if (!prepared.ok) throw prepared.error;

    const profile = resolveRuntimeExecutionProfile(
      prepared.value,
      catalog,
      [],
      sourceRevision,
      { maxAttempts: 3, maxActions: 64 },
      {
        overrides: {
          gates: new Map([['inspect', { value: 'on', scope: 'project' }]]),
          models: new Map([['inspect', { value: 'project-model', scope: 'project' }]]),
          handoff: new Map([['inspect', { value: 0.4, scope: 'store' }]]),
          runtimes: new Map([['reviewer', { value: 'codex', scope: 'global' }]]),
        },
        basePolicy: { effective: 'on', source: 'default' },
        host: { runtime: 'claude', source: 'process' },
      }
    );

    expect(profile.policy.stages[0]).toEqual(
      expect.objectContaining({
        nodeId: 'root:inspect',
        model: 'project-model',
        runtime: 'codex',
        gate: true,
        provenance: expect.objectContaining({
          model: 'stage-override-project',
          runtime: 'stage-override-global',
          gate: 'stage-override-project',
        }),
      })
    );
  });
});
