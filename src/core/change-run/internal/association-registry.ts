import type {
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
} from '../contracts.js';
import {
  deriveChangeInstanceId,
  digestPhysicalIdentity,
  domainDigest,
  type PhysicalIdentity,
} from './identity.js';

export type AssociationState = 'active' | 'archived' | 'missing';

export interface ChangeAssociation {
  readonly changeId: string;
  readonly instanceId: ChangeInstanceId;
  readonly physicalIdentityDigest: Digest;
  readonly state: AssociationState;
  readonly activeAlias?: string;
  readonly archiveAliases: readonly string[];
}

export interface AssociationLedgerRevision {
  readonly revision: number;
  readonly previousDigest: Digest | null;
  readonly digest: Digest;
  readonly associations: readonly ChangeAssociation[];
}

export interface AssociationLedger {
  readonly format: 'change-association-ledger/1';
  readonly planningSpaceId: PlanningSpaceId;
  readonly projectId: string;
  readonly revisions: readonly AssociationLedgerRevision[];
}

export class AssociationRegistryError extends Error {
  constructor(
    readonly code:
      | 'physical_identity_conflict'
      | 'active_instance_conflict'
      | 'association_not_found'
      | 'association_mismatch'
      | 'association_limit_exceeded',
    message: string
  ) {
    super(message);
    this.name = 'AssociationRegistryError';
  }
}

const MAX_ASSOCIATION_REVISIONS = 4096;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function latestAssociations(
  ledger: AssociationLedger
): readonly ChangeAssociation[] {
  return ledger.revisions.at(-1)?.associations ?? [];
}

function appendRevision(
  ledger: AssociationLedger,
  associations: readonly ChangeAssociation[]
): AssociationLedger {
  if (ledger.revisions.length >= MAX_ASSOCIATION_REVISIONS) {
    throw new AssociationRegistryError(
      'association_limit_exceeded',
      'The bounded Change association ledger has reached its revision limit.'
    );
  }
  const previous = ledger.revisions.at(-1);
  const revision = ledger.revisions.length;
  const normalized = associations
    .map((association) => ({
      ...association,
      archiveAliases: [...association.archiveAliases].sort(compareStrings),
    }))
    .sort((left, right) =>
      compareStrings(left.instanceId, right.instanceId)
    );
  const digest = domainDigest('change-association-revision/1', {
    planningSpaceId: ledger.planningSpaceId,
    projectId: ledger.projectId,
    revision,
    previousDigest: previous?.digest ?? null,
    associations: normalized,
  });
  const next: AssociationLedgerRevision = {
    revision,
    previousDigest: previous?.digest ?? null,
    digest,
    associations: normalized,
  };
  return deepFreeze({
    ...ledger,
    revisions: [...ledger.revisions, next],
  });
}

function assertAlias(alias: string): void {
  if (
    alias.length === 0 ||
    alias.length > 1024 ||
    alias.includes('\\') ||
    alias.startsWith('/') ||
    alias.split('/').includes('..')
  ) {
    throw new AssociationRegistryError(
      'association_mismatch',
      'Association aliases must be bounded workspace-relative POSIX paths.'
    );
  }
}

export function createAssociationLedger(
  planningSpaceId: PlanningSpaceId,
  projectId: string
): AssociationLedger {
  if (projectId.length === 0 || projectId.length > 256) {
    throw new AssociationRegistryError(
      'association_mismatch',
      'Project lineage/display ID must contain 1-256 characters.'
    );
  }
  return deepFreeze({
    format: 'change-association-ledger/1',
    planningSpaceId,
    projectId,
    revisions: [],
  });
}

export function bindActiveAssociation(
  ledger: AssociationLedger,
  request: Readonly<{
    changeId: string;
    alias: string;
    physicalIdentity: PhysicalIdentity;
  }>
): Readonly<{
  ledger: AssociationLedger;
  association: ChangeAssociation;
  disposition: 'bound' | 'reused';
}> {
  assertAlias(request.alias);
  const physicalIdentityDigest = digestPhysicalIdentity(
    request.physicalIdentity
  );
  const associations = latestAssociations(ledger);
  const physicalMatch = associations.find(
    (association) =>
      association.physicalIdentityDigest === physicalIdentityDigest
  );
  if (physicalMatch && physicalMatch.changeId !== request.changeId) {
    throw new AssociationRegistryError(
      'physical_identity_conflict',
      'One physical Change identity cannot be rebound to another Change name.'
    );
  }
  const active = associations.find(
    (association) =>
      association.changeId === request.changeId &&
      association.state === 'active'
  );
  if (active) {
    if (
      active.physicalIdentityDigest !== physicalIdentityDigest ||
      active.activeAlias !== request.alias
    ) {
      throw new AssociationRegistryError(
        'active_instance_conflict',
        'An active Change association already exists with different physical history.'
      );
    }
    return deepFreeze({
      ledger,
      association: active,
      disposition: 'reused',
    });
  }

  const association: ChangeAssociation = {
    changeId: request.changeId,
    instanceId: deriveChangeInstanceId(
      ledger.planningSpaceId,
      request.changeId,
      request.physicalIdentity
    ),
    physicalIdentityDigest,
    state: 'active',
    activeAlias: request.alias,
    archiveAliases: [],
  };
  return deepFreeze({
    ledger: appendRevision(ledger, [...associations, association]),
    association,
    disposition: 'bound',
  });
}

export function archiveAssociation(
  ledger: AssociationLedger,
  request: Readonly<{
    changeId: string;
    instanceId: ChangeInstanceId;
    activeAlias: string;
    archiveAlias: string;
    physicalIdentity: PhysicalIdentity;
  }>
): AssociationLedger {
  assertAlias(request.activeAlias);
  assertAlias(request.archiveAlias);
  const physicalIdentityDigest = digestPhysicalIdentity(
    request.physicalIdentity
  );
  const associations = latestAssociations(ledger);
  const index = associations.findIndex(
    (association) => association.instanceId === request.instanceId
  );
  if (index < 0) {
    throw new AssociationRegistryError(
      'association_not_found',
      'The exact Change instance is not present in the association ledger.'
    );
  }
  const current = associations[index]!;
  if (
    current.changeId !== request.changeId ||
    current.state !== 'active' ||
    current.activeAlias !== request.activeAlias ||
    current.physicalIdentityDigest !== physicalIdentityDigest
  ) {
    throw new AssociationRegistryError(
      'association_mismatch',
      'Archive migration did not prove the exact active physical Change instance.'
    );
  }
  const archived: ChangeAssociation = {
    ...current,
    state: 'archived',
    activeAlias: undefined,
    archiveAliases: [...current.archiveAliases, request.archiveAlias],
  };
  return appendRevision(ledger, [
    ...associations.slice(0, index),
    archived,
    ...associations.slice(index + 1),
  ]);
}

export function findAssociationByAlias(
  ledger: AssociationLedger,
  alias: string
): ChangeAssociation | undefined {
  assertAlias(alias);
  return latestAssociations(ledger).find(
    (association) =>
      association.activeAlias === alias ||
      association.archiveAliases.includes(alias)
  );
}
