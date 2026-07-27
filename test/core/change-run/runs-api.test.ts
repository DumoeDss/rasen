import { describe, expect, it } from 'vitest';
import { handleRuns } from '../../../src/core/management-api/runs.js';

describe('runs API discovers reconciler-engine runs (13.1/13.2)', () => {
  it('returns legacy runs plus an additive reconcilerRuns field', async () => {
    const tmpRoot = require('node:os').tmpdir() + '/rasen-runs-api-test-' + Date.now();
    require('node:fs').mkdirSync(tmpRoot + '/rasen/changes/dummy', { recursive: true });
    const result = await handleRuns(tmpRoot);
    expect(result).toHaveProperty('runs');
    expect(result).toHaveProperty('reconcilerRuns');
    expect(Array.isArray(result.reconcilerRuns)).toBe(true);
    require('node:fs').rmSync(tmpRoot, { recursive: true, force: true });
  });
});
