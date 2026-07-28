export type EngineOwner = 'legacy' | 'reconciler' | 'ambiguous' | 'unknown';

export type EngineOwnershipErrorCode =
  | 'engine_owner_conflict'
  | 'engine_owner_unknown';

/**
 * The association registry's view of a ChangeInstance's lifecycle state, used
 * by the engine-ownership guard to bind legacy artifacts to their proven
 * instance rather than silently assigning them to a same-name recreation.
 * - `'active'`: the Change directory is the canonical active instance.
 * - `'archived'`: the instance was archived via `archiveAssociation`; reads
 *   from a verified archive alias bind to that alias's proven instance.
 * - `'missing'`: the registry has no binding (unregistered, manually moved).
 */
export type InstanceState = 'active' | 'archived' | 'missing';

export class EngineOwnershipError extends Error {
  constructor(
    readonly code: EngineOwnershipErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'EngineOwnershipError';
  }
}

/**
 * Bilateral engine ownership (tasks 10.5/10.6). A Run freezes exactly one
 * engine owner at start; every mutation rechecks both the canonical RunStore
 * and the legacy run-state and invalid state is never absence. legacy-only ->
 * legacy resume; canonical-only -> reconciler; both -> ambiguous conflict;
 * neither -> unknown (never silently treated as free).
 *
 * `instanceState` (optional, from the association registry) binds a legacy
 * artifact read from a verified archive alias to that alias's proven instance
 * — it is NOT silently assigned to a same-name recreation. An older
 * machine-home legacy artifact with no provable instance binding remains
 * `legacy_owner_unknown` (existing behavior).
 */
export function classifyEngineOwnership(input: {
  readonly canonicalPresent: boolean;
  readonly legacyPresent: boolean;
  readonly instanceState?: InstanceState;
}): EngineOwner {
  if (input.canonicalPresent && !input.legacyPresent) return 'reconciler';
  if (input.legacyPresent && !input.canonicalPresent) return 'legacy';
  if (input.canonicalPresent && input.legacyPresent) return 'ambiguous';
  return 'unknown';
}

/**
 * Assert that a Run has exactly one engine owner. A bilateral conflict
 * (both legacy and canonical state present) or an unknown state (neither)
 * blocks every mutation; absence is never treated as a free slot.
 */
export function assertSingleEngineOwner(input: {
  readonly canonicalPresent: boolean;
  readonly legacyPresent: boolean;
  readonly instanceState?: InstanceState;
}): EngineOwner {
  const owner = classifyEngineOwnership(input);
  if (owner === 'ambiguous') {
    throw new EngineOwnershipError(
      'engine_owner_conflict',
      'A Run cannot be owned by both the legacy and reconciler engines.'
    );
  }
  if (owner === 'unknown') {
    throw new EngineOwnershipError(
      'engine_owner_unknown',
      'No engine owner found; invalid state is never absence.'
    );
  }
  return owner;
}
