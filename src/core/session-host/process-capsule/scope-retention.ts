import type { ProcessRef } from '../process-scope.js';

/**
 * Shared retention-map lifecycle for the three ProcessScope tiers (closes
 * RC-005 / cutover finding F4). Every tier keeps a per-ref map so a control
 * verb can find the scope it prepared - legacy `clients`
 * (`native-process-scope.ts`), POSIX `scopes` (`posix-best-effort-scope.ts`),
 * and win32 `scopes` (`win32-best-effort-scope.ts`). Before this rule none of
 * the three ever deleted an entry, so a long-lived daemon accumulated one
 * object per Session for its whole lifetime.
 *
 * The one lifecycle rule, applied identically to all three maps:
 *
 *   - an entry that has reached a definite SETTLED TERMINAL is released once its
 *     terminal has been consumed. The terminal is delivered to the host through
 *     the scope's own `closed` promise (natural completion) or the control
 *     verb's return value (cancel / abort), never through a later map lookup, so
 *     the entry is released on the next `prepare()` - the successor Session - by
 *     which point the predecessor's terminal has already been consumed. This
 *     preserves the one legitimate in-Session replay window: a cancel followed
 *     by a re-inspect of the same ref still reads the retained terminal, because
 *     no successor `prepare()` has run between them.
 *   - an entry that is live, prepared, control-lost, or otherwise uncertain
 *     carries NO settled terminal and is retained for reconciliation. Sweeping
 *     it would be exactly the clean-detach the tiers forbid: a lost control
 *     channel must stay reconcilable, never be dropped as if it were done.
 *
 * `isSettledTerminal` is the per-tier predicate for "definite terminal": the
 * exact tier's `CapsuleClient.state === 'closed'`, the best-effort tiers'
 * `ScopeState.terminal !== undefined`. It is deliberately false for every
 * control-lost / uncertain state so those entries are never swept.
 */
export function sweepSettledTerminals<K, V>(
  map: Map<K, V>,
  isSettledTerminal: (value: V) => boolean
): void {
  for (const [key, value] of map) {
    // Deleting the current key while iterating a Map is well-defined; visited
    // and pending keys are unaffected.
    if (isSettledTerminal(value)) map.delete(key);
  }
}

/**
 * Test-only introspection of a tier's retention map. Production construction
 * never sets it; it exists so the retention lifecycle above can be discriminated
 * by mutation (a suite proves settled-terminal entries are released on the next
 * prepare while control-lost/uncertain entries are retained).
 */
export type RetentionProbe = (retainedRefs: () => readonly ProcessRef[]) => void;
