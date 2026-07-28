import { describe, expect, it } from 'vitest';

import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import { resolveCapabilityBindings } from '../../../src/core/pipeline-registry/profile-resolver.js';

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

describe('resolveCapabilityBindings (3.4 profile construction)', () => {
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
});
