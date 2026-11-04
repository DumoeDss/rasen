/**
 * v1 membership record → v2 project catalog (design D10).
 *
 * `.rasen-store/projects/<projectId>.yaml` is a v1 record in a flat Store and a
 * v2 catalog in a layout v2 Store. Readers dispatch on the Store's DECLARED
 * layout version rather than sniffing the file, so a half-written file can
 * never be read as the other schema, and migration is the only writer that
 * flips one.
 *
 * The planning binding is derived only from adoption evidence or a proven
 * pointer-without-local-planning binding. Membership alone never binds:
 * binding is a claim that planning truth MOVED, and only adoption evidence
 * proves that.
 */
import { classifyOpenSpecDir, readStorePointer, hasStoreDeclaration } from '../../project-config.js';
import {
  serializeStoreProjectCatalogV2,
  type StoreProjectCatalogV2,
} from '../planning-catalogs.js';
import { isCanonicalIsoTimestamp, parseProjectId } from '../planning-validation.js';
import type { StoreProjectRecord } from '../project-records.js';
import type { ProjectRegistrySnapshot } from './dependencies.js';

export interface CatalogUpgradeOutcome {
  readonly projectId: string;
  readonly catalog?: StoreProjectCatalogV2;
  readonly catalogYaml?: string;
  readonly binding: 'bound' | 'unbound';
  /** Set when the record cannot satisfy the stricter v2 contract. */
  readonly blockedField?: string;
  readonly blockedReason?: string;
  /** What the operator should DO about it, in their own record. */
  readonly blockedRepair?: string;
  readonly droppedAdoption?: {
    readonly specs: readonly string[];
    readonly changes: readonly string[];
    readonly adoptedAt: string;
  };
}

/** Canonical `YYYY-MM-DDTHH:mm:ss.sssZ`, or null when the value is not a real instant. */
export function canonicalizeTimestamp(value: string): string | null {
  if (isCanonicalIsoTimestamp(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString();
}

/**
 * A pointer-without-local-planning binding: the project's own checkout declares
 * this Store and holds no local planning tree, so its planning truth already
 * lives in the Store even though no adoption record survives. Discovered from
 * the machine project registry; a project with no live checkout on this machine
 * simply yields no proof and stays unbound.
 */
export function provesPointerBinding(
  projectId: string,
  checkouts: readonly ProjectRegistrySnapshot[]
): boolean {
  for (const checkout of checkouts) {
    if (checkout.entry.projectId !== projectId) continue;
    let pointerDeclared = false;
    try {
      pointerDeclared = hasStoreDeclaration(readStorePointer(checkout.root));
    } catch {
      continue;
    }
    if (!pointerDeclared) continue;
    try {
      if (!classifyOpenSpecDir(checkout.root).hasPlanningShape) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * What to DO about a field that cannot satisfy the v2 contract.
 *
 * A blocked migration is the operator's problem to solve in their own committed
 * record, so the plan has to say what to change it to. Naming the field and
 * quoting the validator ("must be a canonical lowercase kebab id") tells them
 * which check objected, which is not the same thing — and migration deliberately
 * never rewrites a value to make it fit, so the sentence is the whole remedy.
 */
function repairFor(field: string, record: StoreProjectRecord): string {
  switch (field) {
    case 'projectId':
      return `Set 'projectId' to a canonical lowercase kebab identifier (letters, digits, single hyphens) and rename the record file to match it.`;
    case 'roles.planning':
      return `Set 'roles.planning: true' — the record carries an adoption, which IS a planning binding — or delete the 'adoption:' block if ${record.projectId} no longer plans in this Store.`;
    case 'adoption.adoptedAt':
      return `Replace 'adoption.adoptedAt' with a real instant, e.g. '2026-01-02T03:04:05.000Z'.`;
    case 'planningBinding.boundAt':
      return `Add an 'adoption:' block recording when ${record.projectId} was adopted, or set 'roles.planning: false' to migrate it as an unbound member.`;
    case 'remote':
      return `Replace 'remote' with a credential-free clone URL (https:// or ssh://, no embedded username or token).`;
    case 'knowledgeBundle':
      return `Make 'knowledgeBundle' a Store-root-relative path with forward slashes and no '..' segments.`;
    default:
      return `Correct '${field}' in the record; migration never rewrites a value to make it fit.`;
  }
}

export function upgradeMembershipRecord(input: {
  readonly record: StoreProjectRecord;
  readonly checkouts: readonly ProjectRegistrySnapshot[];
}): CatalogUpgradeOutcome {
  const { record } = input;

  let projectId: string;
  try {
    projectId = parseProjectId(record.projectId);
  } catch (error) {
    return {
      projectId: record.projectId,
      binding: 'unbound',
      blockedField: 'projectId',
      blockedReason: error instanceof Error ? error.message : String(error),
      blockedRepair: repairFor('projectId', record),
    };
  }

  const adoption = record.adoption;
  if (adoption !== undefined && record.roles.planning !== true) {
    return {
      projectId,
      binding: 'unbound',
      blockedField: 'roles.planning',
      blockedReason:
        'the record carries adoption data but no planning role, and a v2 catalog may not declare a bound binding without one',
      blockedRepair: repairFor('roles.planning', record),
    };
  }

  let binding: 'bound' | 'unbound' = 'unbound';
  let boundAt: string | undefined;
  if (adoption !== undefined) {
    const canonical = canonicalizeTimestamp(adoption.adoptedAt);
    if (canonical === null) {
      return {
        projectId,
        binding: 'unbound',
        blockedField: 'adoption.adoptedAt',
        blockedReason: `'${adoption.adoptedAt}' is not a real instant, so it cannot become a canonical binding timestamp`,
        blockedRepair: repairFor('adoption.adoptedAt', record),
      };
    }
    binding = 'bound';
    boundAt = canonical;
  } else if (record.roles.planning && provesPointerBinding(projectId, input.checkouts)) {
    binding = 'bound';
    // No adoption timestamp survives, so the binding is timestamped from the
    // record's own proof rather than invented from the clock: the epoch of the
    // pointer is unknown and pretending otherwise would fabricate a fact.
    boundAt = undefined;
  }

  if (binding === 'bound' && boundAt === undefined) {
    return {
      projectId,
      binding: 'unbound',
      blockedField: 'planningBinding.boundAt',
      blockedReason:
        'a pointer-only binding carries no adoption timestamp, so the v2 catalog cannot record when it was bound',
      blockedRepair: repairFor('planningBinding.boundAt', record),
    };
  }

  const catalogValue = {
    version: 2 as const,
    projectId,
    ...(record.id !== undefined ? { id: record.id } : {}),
    ...(record.remote !== undefined ? { remote: record.remote } : {}),
    ...(record.knowledgeBundle !== undefined
      ? { knowledgeBundle: record.knowledgeBundle }
      : {}),
    roles: { planning: record.roles.planning, knowledge: record.roles.knowledge },
    planningBinding:
      binding === 'bound'
        ? { state: 'bound' as const, boundAt: boundAt as string }
        : { state: 'unbound' as const },
  };

  let catalogYaml: string;
  try {
    catalogYaml = serializeStoreProjectCatalogV2(catalogValue as StoreProjectCatalogV2);
  } catch (error) {
    const field =
      error !== null && typeof error === 'object' && 'field' in error
        ? String((error as { field: unknown }).field)
        : 'catalog';
    return {
      projectId,
      binding,
      blockedField: field,
      blockedReason: error instanceof Error ? error.message : String(error),
      blockedRepair: repairFor(field, record),
    };
  }

  return {
    projectId,
    catalog: catalogValue as StoreProjectCatalogV2,
    catalogYaml,
    binding,
    ...(adoption === undefined
      ? {}
      : {
          droppedAdoption: {
            specs: [...adoption.specs],
            changes: [...adoption.changes],
            adoptedAt: adoption.adoptedAt,
          },
        }),
  };
}
