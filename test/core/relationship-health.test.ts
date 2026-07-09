import { describe, expect, it } from 'vitest';

import { inspectRelationships } from '../../src/core/relationship-health.js';
import type { ResolvedOpenSpecRoot } from '../../src/core/root-selection.js';

const root = {
  path: '/team/store',
  source: 'store',
  storeId: 'team-context',
  changesDir: '/team/store/rasen/changes',
  specsDir: '/team/store/rasen/specs',
  archiveDir: '/team/store/rasen/changes/archive',
  defaultSchema: 'spec-driven',
} as ResolvedOpenSpecRoot;

function baseInput() {
  return {
    root,
    rootHealthy: true,
    referenceEntries: [],
    registryUnreadable: false,
  };
}

describe('relationship health composition (3.6)', () => {
  it('reports a clean relationship shape', () => {
    const health = inspectRelationships(baseInput());

    expect(health).toEqual({
      root: {
        path: '/team/store',
        source: 'store',
        store_id: 'team-context',
        healthy: true,
        status: [],
      },
      store: null,
      references: [],
      machineHome: { registered: false, dangling: [], relocation: { lingering: [], pendingOrFailed: [] } },
      status: [],
    });
  });

  it('omits migratableEphemera when the total is zero', () => {
    const health = inspectRelationships({
      ...baseInput(),
      machineHomeEntry: { path: '/team/store', projectId: 'p1', home: 'store-a1b2', lastSeen: '2026-01-01T00:00:00.000Z' },
      migratableEphemera: { total: 0, untracked: 0, tracked: 0, splitUnavailable: false },
    });

    expect(health.machineHome.migratableEphemera).toBeUndefined();
  });

  it('surfaces migratableEphemera with the tracked/untracked split and the work-migrate hint (review m1)', () => {
    const health = inspectRelationships({
      ...baseInput(),
      machineHomeEntry: { path: '/team/store', projectId: 'p1', home: 'store-a1b2', lastSeen: '2026-01-01T00:00:00.000Z' },
      migratableEphemera: { total: 3, untracked: 2, tracked: 1, splitUnavailable: false },
    });

    expect(health.machineHome.migratableEphemera).toEqual({
      total: 3,
      untracked: 2,
      tracked: 1,
      splitUnavailable: false,
      hint: 'rasen work migrate',
    });
  });

  it('surfaces migratableEphemera with splitUnavailable when the git query could not classify', () => {
    const health = inspectRelationships({
      ...baseInput(),
      machineHomeEntry: { path: '/team/store', projectId: 'p1', home: 'store-a1b2', lastSeen: '2026-01-01T00:00:00.000Z' },
      migratableEphemera: { total: 5, untracked: 0, tracked: 0, splitUnavailable: true },
    });

    expect(health.machineHome.migratableEphemera).toEqual({
      total: 5,
      untracked: 0,
      tracked: 0,
      splitUnavailable: true,
      hint: 'rasen work migrate',
    });
  });

  it('reports registry unreadable without inventing relationship entries', () => {
    const health = inspectRelationships({
      ...baseInput(),
      registryUnreadable: true,
    });

    expect(health.status[0]).toEqual(
      expect.objectContaining({ code: 'relationship_registry_unreadable' })
    );
  });

  it('surfaces both-shapes and inert-pointer wrong turns at top level', () => {
    const health = inspectRelationships({
      ...baseInput(),
      bothShapesPointer: { value: 'team-context', filePath: '/repo/rasen/config.yaml' },
      inertPointerDeclarations: {
        filePath: '/app/rasen/config.yaml',
        fields: ['references'],
      },
    });

    expect(health.status.map((entry) => entry.code)).toEqual([
      'root_pointer_ignored',
      'pointer_declarations_inert',
    ]);
    expect(health.status[1].message).toContain('references');
  });

  it('notes remote divergence as info in the store section', () => {
    const facts = {
      id: 'team-context',
      metadataPresent: true,
      metadataValid: true,
      canonicalRemote: 'https://192.0.2.1/canon.git',
      originUrl: 'https://192.0.2.2/fork.git',
    };
    const diverged = inspectRelationships({ ...baseInput(), storeFacts: facts });
    expect(diverged.store?.status[0]).toEqual(
      expect.objectContaining({ severity: 'info', code: 'store_remote_divergence' })
    );
    expect(diverged.store?.metadata.remote).toBe('https://192.0.2.1/canon.git');
    expect(diverged.store?.origin_url).toBe('https://192.0.2.2/fork.git');

    const matching = inspectRelationships({
      ...baseInput(),
      storeFacts: { ...facts, originUrl: facts.canonicalRemote },
    });
    expect(matching.store?.status).toEqual([]);

    const absent = inspectRelationships({
      ...baseInput(),
      storeFacts: { id: 'team-context', metadataPresent: true, metadataValid: true },
    });
    expect(absent.store?.status).toEqual([]);
    expect(absent.store?.metadata.remote).toBeUndefined();
  });

  it('splits machine-root relocation checks into lingering vs. pending/failed (D4)', () => {
    const health = inspectRelationships({
      ...baseInput(),
      machineRootRelocation: [
        { path: '/old/data', target: '/home/.rasen', targetHasContent: true },
        { path: '/old/config', target: '/home/.rasen', targetHasContent: false },
      ],
    });

    expect(health.machineHome.relocation).toEqual({
      lingering: [{ path: '/old/data', target: '/home/.rasen' }],
      pendingOrFailed: [{ path: '/old/config', target: '/home/.rasen' }],
    });
  });

  it('reports empty relocation arrays in the clean state', () => {
    const health = inspectRelationships({
      ...baseInput(),
      machineRootRelocation: [],
    });

    expect(health.machineHome.relocation).toEqual({ lingering: [], pendingOrFailed: [] });
  });

  it('passes reference entries through untouched', () => {
    const entries = [
      { store_id: 'up', root: '/up', status: [] },
      {
        store_id: 'ghost',
        status: [
          {
            severity: 'warning' as const,
            code: 'reference_unresolved',
            message: 'x',
            target: 'references',
            fix: 'y',
          },
        ],
      },
    ];
    const health = inspectRelationships({ ...baseInput(), referenceEntries: entries });
    expect(health.references).toBe(entries);
  });
});
