import { describe, it, expect, vi, afterEach } from 'vitest';
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

  describe('save op (pipeline-definition-api): scratch-file handoff', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('writes the definition to a scratch file (never argv) and passes `--from <scratch>` — 201 on create', async () => {
      const submit = submitter();
      const definition = { name: 'saved-pipe', stages: [{ id: 'a', skill: 'rasen-apply-change' }] };
      const result = await submit({ op: 'save', name: 'saved-pipe', definition });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.status).toBe(201);
      // The definition never rides argv — only name/flags/the scratch path do.
      expect(result.response._argv).toEqual([
        'pipeline',
        'save',
        'saved-pipe',
        '--from',
        result.response.pipeline.path,
        '--json',
      ]);
      expect(JSON.parse(result.response._scratchContent as string)).toEqual(definition);
    });

    it('reports 200 (not 201) when the CLI reports an overwrite (created: false)', async () => {
      const submit = submitter();
      const definition = { name: 'saved-pipe', stages: [{ id: 'a', skill: 'rasen-apply-change' }] };
      const result = await submit({ op: 'save', name: 'saved-pipe', definition, force: true });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.status).toBe(200);
    });

    it('passes the CLI built-in refusal through verbatim as 422', async () => {
      const result = await submitter()({ op: 'save', name: 'fail-me', definition: { name: 'fail-me', stages: [] } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(422);
        expect(result.message).toContain('fake pipeline failure');
      }
    });

    it('non-object definition → 400, no spawn', async () => {
      const result = await submitter()({ op: 'save', name: 'x', definition: 'not-an-object' } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(400);
    });

    it('scratch-file deletion failure is tolerated: the response still succeeds (Windows lock simulation)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.resetModules();
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        const rmSync = vi.fn(() => {
          throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        });
        return { ...actual, default: { ...actual.default, rmSync }, rmSync };
      });
      try {
        const { createPipelineSubmitter: freshCreateSubmitter } = await import(
          '../../../src/core/management-api/pipeline-submit.js'
        );
        const mockedFs = await import('node:fs');
        const submit = freshCreateSubmitter(
          { launchProjectRoot: os.tmpdir() },
          { cliEntryOverride: fakeCliEntry }
        );
        const definition = { name: 'lock-sim', stages: [{ id: 'a', skill: 'rasen-apply-change' }] };
        const result = await submit({ op: 'save', name: 'lock-sim', definition });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.status).toBe(201);
        expect(mockedFs.rmSync).toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();
      } finally {
        vi.doUnmock('node:fs');
        vi.resetModules();
      }
    });
  });
});
