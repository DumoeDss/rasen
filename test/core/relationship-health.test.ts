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
      membership: { stores: [], diagnostics: [] },
      machineHome: { registered: false, dangling: [], worktreeDuplicates: [], relocation: { lingering: [], pendingOrFailed: [] } },
      bootstrapReadiness: { state: 'complete', findings: [] },
      status: [],
    });
  });

  it('reports membership as roster facts, composed from the caller with no I/O', () => {
    const health = inspectRelationships({
      ...baseInput(),
      membership: {
        project_id: 'p1',
        stores: [
          {
            uid: '11111111-1111-4111-8111-111111111111',
            id: 'team-store',
            sources: ['hint', 'record'],
            roles: { planning: true, knowledge: true },
            provenance: 'v2-record',
          },
          {
            id: 'knowledge-store',
            sources: ['hint'],
            unavailable: { reason: 'not-registered', repair: ['rasen store register <path>'] },
          },
        ],
        diagnostics: [
          {
            severity: 'warning',
            code: 'project_membership_unverified',
            message: 'Store knowledge-store is declared by this project but is not registered here.',
            target: 'store.membership',
            fix: 'rasen store register <path>',
          },
        ],
      },
    });

    expect(health.membership.project_id).toBe('p1');
    expect(health.membership.stores).toHaveLength(2);
    // An unavailable store stays IN the answer: absent-from-the-list must never
    // be readable as "not a member".
    expect(health.membership.stores[1]?.unavailable?.reason).toBe('not-registered');
    // …and its finding reaches the report, with the repair that resolves it.
    expect(health.membership.diagnostics.map((entry) => entry.code)).toEqual([
      'project_membership_unverified',
    ]);
    expect(health.membership.diagnostics[0]?.fix).toBe('rasen store register <path>');
  });

  it('reports an empty membership section rather than omitting it', () => {
    // Including its findings list: a section that reports a roster and drops
    // its diagnostics is the shape that made the whole diagnostic requirement
    // unimplemented at the surface while the provider computed it correctly.
    expect(inspectRelationships(baseInput()).membership).toEqual({ stores: [], diagnostics: [] });
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

  it('surfaces the inert-pointer wrong turn at top level', () => {
    const health = inspectRelationships({
      ...baseInput(),
      inertPointerDeclarations: {
        filePath: '/app/rasen/config.yaml',
        fields: ['references'],
      },
    });

    expect(health.status.map((entry) => entry.code)).toEqual(['pointer_declarations_inert']);
    expect(health.status[0].message).toContain('references');
  });

  it('reports a declared store that cannot be used, never as absent', () => {
    const health = inspectRelationships({
      ...baseInput(),
      storeBinding: {
        shape: 'alias',
        filePath: '/repo/rasen/config.yaml',
        declaredId: 'team-context',
        reason: 'not-registered',
        repair: ['rasen store register <path>', 'rasen doctor'],
        diagnostics: [
          {
            severity: 'error',
            code: 'store_bootstrap_required',
            message: "Store team-context is declared by this project but is not registered on this machine.",
            target: 'store.registry',
            fix: 'rasen store register <path>',
          },
        ],
      },
    });

    expect(health.store).not.toBeNull();
    expect(health.store?.id).toBe('team-context');
    expect(health.store?.unavailable).toEqual({
      reason: 'not-registered',
      repair: ['rasen store register <path>', 'rasen doctor'],
    });
    expect(health.store?.pointer).toEqual({ shape: 'alias', declared_id: 'team-context' });
    expect(health.store?.status.map((entry) => entry.code)).toEqual([
      'store_bootstrap_required',
    ]);
  });

  it('carries the resolved identity and how it resolved', () => {
    const health = inspectRelationships({
      ...baseInput(),
      storeFacts: {
        id: 'team-context',
        uid: '9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7',
        metadataPresent: true,
        metadataValid: true,
      },
      storeBinding: {
        shape: 'durable',
        filePath: '/repo/rasen/config.yaml',
        declaredId: 'team-context',
        declaredUid: '9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7',
        resolvedBy: 'uid',
        resolvedId: 'team-context',
        resolvedUid: '9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7',
        diagnostics: [],
      },
    });

    expect(health.store?.uid).toBe('9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7');
    expect(health.store?.pointer?.resolved_by).toBe('uid');
    expect(health.store?.metadata.uid).toBe('9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7');
  });

  it('redacts a credential-bearing remote in the store section', () => {
    const health = inspectRelationships({
      ...baseInput(),
      storeFacts: {
        id: 'team-context',
        metadataPresent: true,
        metadataValid: true,
        canonicalRemote: 'https://user:secret@192.0.2.1/canon.git',
      },
    });

    expect(health.store?.metadata.remote).toBe('https://<redacted>@192.0.2.1/canon.git');
    expect(JSON.stringify(health)).not.toContain('secret');
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

  it('reports a skill-version-mismatch finding with a Fix hint (delivery-reliability-version-guard)', () => {
    const health = inspectRelationships({
      ...baseInput(),
      skillVersionMismatch: { stampVersion: '0.1.2', cliVersion: '0.1.5' },
    });

    expect(health.status).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'skill_version_mismatch',
        fix: 'rasen update',
      })
    );
    const entry = health.status.find((status) => status.code === 'skill_version_mismatch');
    expect(entry?.message).toContain('0.1.2');
    expect(entry?.message).toContain('0.1.5');
  });

  it('omits the skill-version-mismatch finding when versions match (absent input)', () => {
    const health = inspectRelationships(baseInput());
    expect(health.status.some((status) => status.code === 'skill_version_mismatch')).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Bootstrap readiness (store-bootstrap-repair-text, design D4/D5)
  // ---------------------------------------------------------------------

  describe('bootstrap readiness composition', () => {
    /** A readiness input with all three facts overridden. */
    function readinessInput(overrides: {
      resolved?: boolean;
      reason?: 'not-registered' | 'uid-mismatch' | 'metadata-missing' | 'root-unhealthy' | 'alias-ambiguous' | 'pointer-malformed';
      hasRemote?: boolean;
      membershipConfirmed?: boolean;
      machineHomeRegistered?: boolean;
    }) {
      return {
        storeBinding: {
          resolved: overrides.resolved ?? true,
          ...(overrides.reason !== undefined ? { reason: overrides.reason } : {}),
          ...(overrides.hasRemote ? { hasRemote: true } : {}),
        },
        membership: { confirmed: overrides.membershipConfirmed ?? true },
        machineHomeRegistered: overrides.machineHomeRegistered ?? true,
      };
    }

    it('reports complete when all three facts hold', () => {
      const health = inspectRelationships({
        ...baseInput(),
        bootstrapReadiness: readinessInput({}),
      });
      expect(health.bootstrapReadiness.state).toBe('complete');
      expect(health.bootstrapReadiness.findings).toEqual([]);
    });

    it('reports degraded when the Store is not-registered with a remote', () => {
      const health = inspectRelationships({
        ...baseInput(),
        bootstrapReadiness: readinessInput({
          resolved: false,
          reason: 'not-registered',
          hasRemote: true,
        }),
      });
      expect(health.bootstrapReadiness.state).toBe('degraded');
      const finding = health.bootstrapReadiness.findings[0];
      expect(finding?.code).toBe('bootstrap_store_missing');
      expect(finding?.repair).toBe('rasen bootstrap');
    });

    it('reports blocked when the Store is not-registered with no remote', () => {
      const health = inspectRelationships({
        ...baseInput(),
        bootstrapReadiness: readinessInput({
          resolved: false,
          reason: 'not-registered',
          hasRemote: false,
        }),
      });
      expect(health.bootstrapReadiness.state).toBe('blocked');
      const finding = health.bootstrapReadiness.findings[0];
      expect(finding?.code).toBe('bootstrap_store_missing_no_remote');
      expect(finding?.repair).toBe('rasen bootstrap');
    });

    it('does NOT produce a bootstrap finding for an identity-level reason', () => {
      // A uid-mismatch is NOT a gap bootstrap can close. The state is degraded
      // (the Store is not resolved), but NO bootstrap finding is produced —
      // doctor's existing Store-section finding covers it.
      const health = inspectRelationships({
        ...baseInput(),
        bootstrapReadiness: readinessInput({
          resolved: false,
          reason: 'uid-mismatch',
        }),
      });
      expect(health.bootstrapReadiness.state).toBe('degraded');
      expect(health.bootstrapReadiness.findings).toEqual([]);
    });

    it('reports degraded with a membership finding when membership is not confirmed', () => {
      const health = inspectRelationships({
        ...baseInput(),
        bootstrapReadiness: readinessInput({ membershipConfirmed: false }),
      });
      expect(health.bootstrapReadiness.state).toBe('degraded');
      const finding = health.bootstrapReadiness.findings.find(
        (f) => f.code === 'bootstrap_membership_not_confirmed'
      );
      expect(finding?.repair).toBe('rasen bootstrap');
    });

    it('reports degraded with a machine-home finding when not registered', () => {
      const health = inspectRelationships({
        ...baseInput(),
        bootstrapReadiness: readinessInput({ machineHomeRegistered: false }),
      });
      expect(health.bootstrapReadiness.state).toBe('degraded');
      const finding = health.bootstrapReadiness.findings.find(
        (f) => f.code === 'bootstrap_machine_home_not_registered'
      );
      expect(finding?.repair).toBe('rasen bootstrap');
    });

    it('every finding carries a pasteable repair', () => {
      const health = inspectRelationships({
        ...baseInput(),
        bootstrapReadiness: readinessInput({
          resolved: false,
          reason: 'not-registered',
          hasRemote: true,
          membershipConfirmed: false,
          machineHomeRegistered: false,
        }),
      });
      expect(health.bootstrapReadiness.findings.length).toBeGreaterThan(0);
      for (const finding of health.bootstrapReadiness.findings) {
        expect(finding.repair).toMatch(/^rasen\s/u);
        expect(finding.repair).not.toContain('<');
        expect(finding.repair).not.toContain('>');
      }
    });

    it('complete requires all three facts', () => {
      // Any one missing degrades from complete.
      for (const overrides of [
        { membershipConfirmed: false },
        { machineHomeRegistered: false },
        { resolved: false, reason: 'not-registered' as const, hasRemote: true },
      ]) {
        const health = inspectRelationships({
          ...baseInput(),
          bootstrapReadiness: readinessInput(overrides),
        });
        expect(health.bootstrapReadiness.state, JSON.stringify(overrides)).not.toBe('complete');
      }
    });

    it('defaults to complete when no readiness input is provided', () => {
      // A Store-rooted run or a project with no declaration has no bootstrap
      // gap to report.
      const health = inspectRelationships(baseInput());
      expect(health.bootstrapReadiness).toEqual({ state: 'complete', findings: [] });
    });
  });
});
