/**
 * Per-test reset of the config-diagnostic dedup set. The dedup is
 * process-scoped in production (one CLI invocation = one process), but in
 * tests each case must be able to observe the warning independently.
 */
import { beforeEach } from 'vitest';
import { _resetConfigDiagnosticDedup } from '../src/core/config-diagnostics.js';

beforeEach(() => {
  _resetConfigDiagnosticDedup();
});
