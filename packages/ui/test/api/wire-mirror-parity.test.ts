import { describe, it, expect } from 'vitest';
import type { ThresholdBindingRow } from '../../src/api/types';

/**
 * Drift guards for the hand-maintained wire mirror in `src/api/types.ts`.
 *
 * `packages/ui` sits outside the root vitest include, so the root suite never
 * runs these files. Know which gate catches what, because the two halves of this
 * guard fire at different times:
 *
 * - The COMPILE-TIME half below is the `Record` annotation, and it binds only
 *   under `pnpm --dir packages/ui typecheck`, which `.github/workflows/ci.yml`
 *   does NOT run — only `release.yml:48` does. On a pull request this file
 *   executes with types erased, so the annotation contributes nothing there.
 * - The mirror -> server half runs in the ROOT suite on every PR (see below).
 *
 * So drift is caught pre-merge by the root half and at release time by this one.
 * That release-only asymmetry is how the `KNOWN_MODEL_IDS` drift reached a
 * release (FU-5); adding the UI typecheck to `ci.yml` is recorded as a
 * follow-up rather than done here.
 *
 * The complementary mirror -> server assertion lives in the ROOT suite
 * (`test/core/management-api/threshold-binding-row-mirror.test.ts`), which
 * reads this union out of `src/api/types.ts` and compares it with
 * `PROBE_RUNTIMES` directly. It cannot live here: importing the root package's
 * registry pulls its transitive module graph into this package's typecheck
 * realm, and this realm sets `noUnusedLocals` while the root realm does not —
 * so a value import of `PROBE_RUNTIMES` makes `pnpm typecheck` report four
 * pre-existing root-side declarations (including the deliberate
 * `_RecognitionOrderCoversEveryRuntime` guard) as errors. Each half therefore
 * runs in the realm that owns its source of truth.
 */
describe('ThresholdBindingRow mirror parity', () => {
  /**
   * An exhaustive `Record` keyed by the mirrored union is the compile-time
   * half, and it binds in both directions: a union member with no key here
   * fails to compile, and a key naming a non-member fails too. Widening the
   * union in `src/api/types.ts` without updating this literal is therefore a
   * typecheck failure, not a silent pass.
   */
  const MIRRORED_BINDING_ROWS: Record<ThresholdBindingRow, true> = {
    claude: true,
    codex: true,
    omp: true,
    default: true,
  };

  it('lists exactly the rows the server sends, in the order the rail renders', () => {
    // `thresholdSchemeCatalog()` builds `bindingRows` as
    // `[...PROBE_RUNTIMES, 'default']` (src/core/management-api/threshold-schemes.ts)
    // and `ThresholdPolicyWorkbench` maps them in the order received, so order
    // is part of the contract, not incidental.
    expect(Object.keys(MIRRORED_BINDING_ROWS)).toEqual(['claude', 'codex', 'omp', 'default']);
  });
});
