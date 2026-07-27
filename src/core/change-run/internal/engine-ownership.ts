export type EngineOwner = 'legacy' | 'reconciler' | 'ambiguous' | 'unknown';

export type EngineOwnershipErrorCode =
  | 'engine_owner_conflict'
  | 'engine_owner_unknown';

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
 */
export function classifyEngineOwnership(input: {
  readonly canonicalPresent: boolean;
  readonly legacyPresent: boolean;
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
