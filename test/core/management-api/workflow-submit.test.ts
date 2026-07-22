import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createWorkflowSubmitter } from '../../../src/core/management-api/workflow-submit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeCliEntry = path.resolve(__dirname, '..', '..', 'fixtures', 'management-api', 'workflow-fake-cli.mjs');

/** An absolute path native to this platform (path.join gives the native separator). */
function abs(...segments: string[]): string {
  return path.join(os.tmpdir(), ...segments);
}

describe('createWorkflowSubmitter (workflow-http-api design D4)', () => {
  function submitter(options: Parameters<typeof createWorkflowSubmitter>[1] = {}) {
    return createWorkflowSubmitter(
      { launchProjectRoot: os.tmpdir() },
      { cliEntryOverride: fakeCliEntry, ...options }
    );
  }

  describe('per-op argv construction (single tokens)', () => {
    it('import → `workflow import <path> --json`, the path a single token', async () => {
      const submit = submitter();
      const p = abs('a b', 'pkg.rasenpkg'); // contains a space → proves single-token binding
      const result = await submit({ op: 'import', path: p });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.status).toBe(201);
      expect(result.response._argv).toEqual(['workflow', 'import', p, '--json']);
      // Success payload passes through verbatim.
      expect(result.response.imported).toEqual(['imported-id']);
      expect(result.response.reused).toEqual(['reused-id']);
    });

    it('init → `workflow init <id> --output <output> --json` (201)', async () => {
      const submit = submitter();
      const output = abs('drafts', 'new-flow');
      const result = await submit({ op: 'init', id: 'new-flow', output });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.status).toBe(201);
      expect(result.response._argv).toEqual(['workflow', 'init', 'new-flow', '--output', output, '--json']);
    });

    it('export → `workflow export <id> <path> --json`, `--force` only when flagged (200)', async () => {
      const submit = submitter();
      const dest = abs('out', 'flow.rasenpkg');

      const plain = await submit({ op: 'export', id: 'flow', path: dest });
      expect(plain.ok && plain.status).toBe(200);
      if (plain.ok) expect(plain.response._argv).toEqual(['workflow', 'export', 'flow', dest, '--json']);

      const forced = await submit({ op: 'export', id: 'flow', path: dest, force: true });
      if (forced.ok) {
        expect(forced.response._argv).toEqual(['workflow', 'export', 'flow', dest, '--json', '--force']);
      } else {
        throw new Error('expected forced export to succeed');
      }
    });

    it('delete → `workflow delete <id> --yes --json` always, `--force` only when flagged (200)', async () => {
      const submit = submitter();

      const plain = await submit({ op: 'delete', id: 'flow' });
      expect(plain.ok && plain.status).toBe(200);
      if (plain.ok) {
        // --yes is ALWAYS present (confirmation is the UI's job); --force is not.
        expect(plain.response._argv).toEqual(['workflow', 'delete', 'flow', '--yes', '--json']);
        expect(plain.response.deleted).toBe('flow');
      }

      const forced = await submit({ op: 'delete', id: 'flow', force: true });
      if (forced.ok) {
        expect(forced.response._argv).toEqual(['workflow', 'delete', 'flow', '--yes', '--json', '--force']);
      } else {
        throw new Error('expected forced delete to succeed');
      }
    });
  });

  describe('input guards (400, no spawn — the echoing fake would 200/201 if reached)', () => {
    it('unknown op → 400', async () => {
      const submit = submitter();
      const result = await submit({ op: 'frobnicate', id: 'x' } as any);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.code).toBe('invalid_input');
    });

    it('relative import path → 400', async () => {
      const submit = submitter();
      const result = await submit({ op: 'import', path: '../somewhere/pkg' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('relative init output → 400', async () => {
      const submit = submitter();
      const result = await submit({ op: 'init', id: 'ok-id', output: 'relative/dir' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });

    it('option-shaped id (leading hyphen) → 400 on every id-bearing op', async () => {
      const submit = submitter();
      for (const request of [
        { op: 'init', id: '-evil', output: abs('d') },
        { op: 'export', id: '--force', path: abs('o') },
        { op: 'delete', id: '-rf' },
      ] as const) {
        const result = await submit(request);
        expect(result.ok, request.op).toBe(false);
        if (result.ok) continue;
        expect(result.status, request.op).toBe(400);
      }
    });

    it('an id with characters outside the manifest identifier form → 400 (never refuses an id the CLI accepts)', async () => {
      const submit = submitter();
      // Uppercase / underscore are NOT part of `isPortableWorkflowId`.
      const result = await submit({ op: 'delete', id: 'Has_Underscore' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
    });
  });

  describe('subprocess outcomes', () => {
    it('passes a CLI failure message through verbatim as 422', async () => {
      const submit = submitter();
      const result = await submit({ op: 'delete', id: 'fail-me' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.code).toBe('cli_error');
      expect(result.message).toBe('fake workflow failure');
    });

    it('passes a built-in delete refusal through verbatim as 422', async () => {
      const submit = submitter();
      const result = await submit({ op: 'delete', id: 'builtin-locked', force: true });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.message).toContain('Built-in workflows cannot be deleted');
    });

    it('refuses an overlapping mutation with 409 busy (cap-1)', async () => {
      const submit = submitter({ timeoutMs: 5000 });
      const first = submit({ op: 'import', path: abs('sleep-300') });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await submit({ op: 'delete', id: 'flow' });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
      expect(second.code).toBe('busy');

      const firstResult = await first;
      expect(firstResult.ok).toBe(true);
    });

    it('an unknown op is rejected before it can occupy the cap-1 slot', async () => {
      const submit = submitter({ timeoutMs: 5000 });
      // A long-running valid mutation holds the slot…
      const held = submit({ op: 'import', path: abs('sleep-300') });
      await new Promise((resolve) => setTimeout(resolve, 20));
      // …an unknown op is still a 400 (guarded before the busy check), not 409.
      const bad = await submit({ op: 'nope' } as any);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.status).toBe(400);
      await held;
    });

    it('times out a hung subprocess with 504', async () => {
      const submit = submitter({ timeoutMs: 150, killGraceMs: 100 });
      const result = await submit({ op: 'import', path: abs('sleep-5000') });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(504);
      expect(result.code).toBe('cli_timeout');
      // Let the SIGKILL escalation reap the child before the test returns.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }, 10_000);
  });
});
