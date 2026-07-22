import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createPipelineSubmitter } from '../../../src/core/management-api/pipeline-submit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeCliEntry = path.resolve(__dirname, '..', '..', 'fixtures', 'management-api', 'pipeline-fake-cli.mjs');

/** An absolute path native to this platform (path.join gives the native separator). */
function abs(...segments: string[]): string {
  return path.join(os.tmpdir(), ...segments);
}

describe('createPipelineSubmitter (pipeline-http-api design D6)', () => {
  function submitter(options: Parameters<typeof createPipelineSubmitter>[1] = {}) {
    return createPipelineSubmitter(
      { launchProjectRoot: os.tmpdir() },
      { cliEntryOverride: fakeCliEntry, ...options }
    );
  }

  describe('per-op argv construction (single tokens)', () => {
    it('import → `pipeline import <path> --json` (201), `--force` only when flagged', async () => {
      const submit = submitter();
      const p = abs('pkg.rasenpkg');
      const plain = await submit({ op: 'import', path: p });
      expect(plain.ok).toBe(true);
      if (plain.ok) {
        expect(plain.status).toBe(201);
        expect(plain.response._argv).toEqual(['pipeline', 'import', p, '--json']);
      }
      const forced = await submit({ op: 'import', path: p, force: true });
      if (forced.ok) expect(forced.response._argv).toEqual(['pipeline', 'import', p, '--json', '--force']);
    });

    it('init → `pipeline init <name> --output <output> --json` (201)', async () => {
      const submit = submitter();
      const output = abs('draft-dir');
      const result = await submit({ op: 'init', name: 'new-pipe', output });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.status).toBe(201);
        expect(result.response._argv).toEqual(['pipeline', 'init', 'new-pipe', '--output', output, '--json']);
      }
    });

    it('export → `pipeline export <name> <path> --json`, `--force` only when flagged (200)', async () => {
      const submit = submitter();
      const dest = abs('out.rasenpkg');
      const plain = await submit({ op: 'export', name: 'pipe', path: dest });
      if (plain.ok) {
        expect(plain.status).toBe(200);
        expect(plain.response._argv).toEqual(['pipeline', 'export', 'pipe', dest, '--json']);
      }
      const forced = await submit({ op: 'export', name: 'pipe', path: dest, force: true });
      if (forced.ok) expect(forced.response._argv).toEqual(['pipeline', 'export', 'pipe', dest, '--json', '--force']);
    });

    it('delete → `pipeline delete <name> --yes --json` always, `--force` only when flagged (200)', async () => {
      const submit = submitter();
      const plain = await submit({ op: 'delete', name: 'pipe' });
      if (plain.ok) {
        expect(plain.status).toBe(200);
        expect(plain.response._argv).toEqual(['pipeline', 'delete', 'pipe', '--yes', '--json']);
      }
      const forced = await submit({ op: 'delete', name: 'pipe', force: true });
      if (forced.ok) expect(forced.response._argv).toEqual(['pipeline', 'delete', 'pipe', '--yes', '--json', '--force']);
    });
  });

  describe('input guards (400, no spawn — the echoing fake would 2xx if reached)', () => {
    it('unknown op → 400', async () => {
      const result = await submitter()({ op: 'frobnicate', name: 'x' } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('relative import path → 400', async () => {
      const result = await submitter()({ op: 'import', path: 'relative/pkg.rasenpkg' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('option-shaped name → 400', async () => {
      const result = await submitter()({ op: 'delete', name: '--force' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });
  });

  it('passes the CLI built-in-deletion refusal through verbatim as 422', async () => {
    const result = await submitter()({ op: 'delete', name: 'builtin-locked' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.message).toContain('Built-in pipelines cannot be deleted');
    }
  });

  it('caps concurrency at one in-flight mutation (409 busy)', async () => {
    const submit = submitter();
    const slow = submit({ op: 'import', path: abs('sleep-300') });
    const second = await submit({ op: 'import', path: abs('pkg.rasenpkg') });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
    await slow;
  });
});
