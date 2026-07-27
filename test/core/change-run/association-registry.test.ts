import { describe, expect, it } from 'vitest';

import {
  AssociationRegistryError,
  archiveAssociation,
  bindActiveAssociation,
  createAssociationLedger,
  findAssociationByAlias,
} from '../../../src/core/change-run/internal/association-registry.js';
import {
  derivePlanningSpaceId,
  type PhysicalIdentity,
} from '../../../src/core/change-run/internal/identity.js';

const oldPhysical: PhysicalIdentity = {
  format: 'physical-identity/1',
  platform: 'posix',
  device: 1n,
  fileIndex: 2n,
  birthIdentity: 3n,
};
const newPhysical: PhysicalIdentity = {
  ...oldPhysical,
  fileIndex: 4n,
  birthIdentity: 5n,
};

describe('immutable Change association ledger', () => {
  it('binds, reuses, archives, and recreates without mutating older revisions', () => {
    const planningSpaceId = derivePlanningSpaceId('fixture-home');
    const initial = createAssociationLedger(planningSpaceId, 'project-fixture');
    const first = bindActiveAssociation(initial, {
      changeId: 'fixture-change',
      alias: 'rasen/changes/fixture-change',
      physicalIdentity: oldPhysical,
    });
    const reused = bindActiveAssociation(first.ledger, {
      changeId: 'fixture-change',
      alias: 'rasen/changes/fixture-change',
      physicalIdentity: oldPhysical,
    });
    const archived = archiveAssociation(reused.ledger, {
      changeId: 'fixture-change',
      instanceId: first.association.instanceId,
      activeAlias: 'rasen/changes/fixture-change',
      archiveAlias: 'rasen/changes/archive/2026-07-27-fixture-change',
      physicalIdentity: oldPhysical,
    });
    const recreated = bindActiveAssociation(archived, {
      changeId: 'fixture-change',
      alias: 'rasen/changes/fixture-change',
      physicalIdentity: newPhysical,
    });

    expect(first.disposition).toBe('bound');
    expect(reused.disposition).toBe('reused');
    expect(recreated.association.instanceId).not.toBe(
      first.association.instanceId
    );
    expect(initial.revisions).toHaveLength(0);
    expect(first.ledger.revisions).toHaveLength(1);
    expect(recreated.ledger.revisions).toHaveLength(3);
    expect(
      findAssociationByAlias(
        recreated.ledger,
        'rasen/changes/archive/2026-07-27-fixture-change'
      )?.instanceId
    ).toBe(first.association.instanceId);
    expect(Object.isFrozen(recreated.ledger)).toBe(true);
  });

  it('fails closed on conflicting identity history or an unprovable archive move', () => {
    const planningSpaceId = derivePlanningSpaceId('fixture-home');
    const initial = createAssociationLedger(planningSpaceId, 'project-fixture');
    const first = bindActiveAssociation(initial, {
      changeId: 'fixture-change',
      alias: 'rasen/changes/fixture-change',
      physicalIdentity: oldPhysical,
    });

    expect(() =>
      bindActiveAssociation(first.ledger, {
        changeId: 'other-change',
        alias: 'rasen/changes/other-change',
        physicalIdentity: oldPhysical,
      })
    ).toThrowError(
      expect.objectContaining({ code: 'physical_identity_conflict' })
    );
    expect(() =>
      archiveAssociation(first.ledger, {
        changeId: 'fixture-change',
        instanceId: first.association.instanceId,
        activeAlias: 'rasen/changes/fixture-change',
        archiveAlias: 'rasen/changes/archive/fixture-change',
        physicalIdentity: newPhysical,
      })
    ).toThrow(AssociationRegistryError);
  });
});
