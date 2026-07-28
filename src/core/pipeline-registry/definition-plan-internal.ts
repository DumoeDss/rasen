import { createHash } from 'node:crypto';

import type {
  CapabilityDescriptor,
  ChangeRunPlan,
  DefinitionSourceV2,
} from './definition.js';

const CHANGE_RUN_PLAN_VERSION_INTERNAL = 1 as const;
const NON_SEMANTIC_DEFINITION_KEYS = new Set([
  'canvas',
  'position',
  'provenance',
  'sourcePath',
]);

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

export function canonicalizePlanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizePlanValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, nested]) => [key, canonicalizePlanValue(nested)])
    );
  }
  return value;
}

export function semanticCanonicalizeDefinition(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticCanonicalizeDefinition);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, nested]) =>
            nested !== undefined && !NON_SEMANTIC_DEFINITION_KEYS.has(key)
        )
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, nested]) => [
          key,
          semanticCanonicalizeDefinition(nested),
        ])
    );
  }
  return value;
}

export function planValueDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizePlanValue(value)))
    .digest('hex');
}

export interface DefinitionPlanPayload {
  readonly definition: unknown;
  readonly catalogVersion: 1;
  readonly capabilities: readonly Readonly<CapabilityDescriptor>[];
}

export interface SealedDefinitionPlan {
  readonly plan: ChangeRunPlan;
  readonly semanticDefinition: unknown;
  readonly sourceDigest: string;
  readonly capabilityDigest: string;
  readonly planDigest: string;
}

export function sealDefinitionPlan(
  definition: Readonly<DefinitionSourceV2>,
  catalogVersion: 1,
  capabilities: readonly Readonly<CapabilityDescriptor>[]
): SealedDefinitionPlan {
  const semanticDefinition = semanticCanonicalizeDefinition(definition);
  const sourceDigest = planValueDigest(semanticDefinition);
  const capabilityDigest = planValueDigest({
    version: catalogVersion,
    descriptors: capabilities,
  });
  const payload: DefinitionPlanPayload = deepFreeze({
    definition: semanticDefinition,
    catalogVersion,
    capabilities: structuredClone(capabilities),
  });
  const planDigest = planValueDigest({
    version: CHANGE_RUN_PLAN_VERSION_INTERNAL,
    sourceDigest,
    capabilityDigest,
    payload,
  });
  const plan = deepFreeze({
    version: CHANGE_RUN_PLAN_VERSION_INTERNAL,
    digest: planDigest,
    payload,
  }) as ChangeRunPlan;
  return deepFreeze({
    plan,
    semanticDefinition,
    sourceDigest,
    capabilityDigest,
    planDigest,
  });
}
