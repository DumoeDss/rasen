import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';

import { PROBE_RUNTIMES } from '../../../src/core/runtime-adapters.js';

const MIRROR_FILE = 'packages/ui/src/api/types.ts';

/**
 * The server->mirror half of the `ThresholdBindingRow` drift guard.
 *
 * `thresholdSchemeCatalog()` sends `[...PROBE_RUNTIMES, 'default']`, so the
 * hand-maintained mirror in `packages/ui` widens the moment a runtime adapter
 * declares `canProbeContext`. Nothing else fails when it does not: both
 * typechecks pass (the mirror is a separate realm with no import edge to the
 * registry) and the workbench renders a row it cannot type. That is the exact
 * failure the project's `management-api-wire-mirror-field-relaxation` rule
 * exists to prevent, and FU-5 records the same one-directional gap for the
 * model-preset mirror.
 *
 * Read as text rather than imported: `packages/ui` sets `noUnusedLocals` while
 * the root realm does not, so an import edge in the other direction makes the
 * UI typecheck report four pre-existing root-side declarations as errors —
 * including the deliberate `_RecognitionOrderCoversEveryRuntime` guard. The
 * root suite already reads UI sources this way
 * (`test/core/theme-library.test.ts:33`). The mirror-side compile-time half of
 * the guard lives in `packages/ui/test/api/wire-mirror-parity.test.ts`.
 */
describe('ThresholdBindingRow UI mirror', () => {
  it('mirrors every probe-capable runtime plus the default row', () => {
    const source = fs.readFileSync(MIRROR_FILE, 'utf-8');
    const declaration = /export type ThresholdBindingRow =([^;]+);/.exec(source);
    expect(
      declaration,
      `${MIRROR_FILE} no longer declares ThresholdBindingRow on one statement — update this guard rather than deleting it`
    ).not.toBeNull();

    const mirrored = declaration![1]!
      .split('|')
      .map((member) => member.trim().replace(/^'|'$/g, ''))
      .filter((member) => member.length > 0);

    expect(mirrored).toEqual([...PROBE_RUNTIMES, 'default']);
  });
});
