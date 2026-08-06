/**
 * The shipped context-window occupancy readers, one per probe-capable runtime.
 *
 * A sibling of `session-stores.ts`; see that module's header for why the four
 * implementation registries are separate modules and why every adapter member
 * is an arrow rather than a bare function reference.
 *
 * The map is checked against `ProbeRuntime`, the union derived from
 * `canProbeContext`. Declaring the capability without registering a reader
 * fails the build, and registering a reader for a runtime that does not
 * declare the capability fails it too (design D2).
 */
import {
  computeContextFromRollout,
  computeContextFromTranscript,
} from '../agent-context.js';
import type { ContextReader, ProbeRuntime } from '../runtime-adapters.js';

export const CONTEXT_READERS = {
  claude: {
    id: 'claude',
    read: (target, options) => computeContextFromTranscript(target, options),
  },
  codex: {
    id: 'codex',
    read: (target, options) => computeContextFromRollout(target, options),
  },
} satisfies { [Id in ProbeRuntime]: ContextReader<Id> };
