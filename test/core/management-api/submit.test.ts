import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createChangeSubmitter } from '../../../src/core/management-api/submit.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const realCliEntry = path.resolve(__dirname, '..', '..', '..', 'dist', 'cli', 'index.js');
const fakeCliEntry = path.resolve(__dirname, '..', '..', 'fixtures', 'management-api', 'fake-cli.mjs');
const sigtermResistantCliEntry = path.resolve(
  __dirname,
  '..',
  '..',
  'fixtures',
  'management-api',
  'sigterm-resistant-cli.mjs'
);

describe('createChangeSubmitter (change-submission design D2/D3)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-submit-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes'), { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempPathAsync(projectRoot);
  });

  describe('against the real CLI (integration)', () => {
    function submitter(): (name: unknown, description: unknown) => Promise<any> {
      return createChangeSubmitter(
        { launchProjectRoot: projectRoot },
        { cliEntryOverride: realCliEntry }
      );
    }

    it('creates a real change on disk and returns 201 with id/path/schema', async () => {
      const submit = submitter();
      const result = await submit('real-submitted-change', 'A real description');

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      expect(result.response.change.id).toBe('real-submitted-change');
      expect(result.response.change.schema).toBe('spec-driven');

      const proposalPath = path.join(projectRoot, 'rasen', 'changes', 'real-submitted-change', 'proposal.md');
      expect(fs.existsSync(proposalPath)).toBe(true);
      expect(fs.readFileSync(proposalPath, 'utf-8')).toContain('A real description');
    });

    it('passes shell metacharacters through inert as a single argv token', async () => {
      const submit = submitter();
      const dangerous = 'safe; rm -rf /tmp/nope `id` $(whoami) && echo pwned';
      const result = await submit('shell-injection-change', dangerous);

      expect(result.ok).toBe(true);
      const proposalPath = path.join(projectRoot, 'rasen', 'changes', 'shell-injection-change', 'proposal.md');
      const content = fs.readFileSync(proposalPath, 'utf-8');
      expect(content).toContain(dangerous);
      // No shell interpretation occurred: no stray files from a real `rm`/`echo`.
      expect(fs.existsSync('/tmp/nope')).toBe(false);
    });

    it('rejects an option-like name with 400 and spawns nothing', async () => {
      const submit = submitter();
      const result = await submit('--store=evil', 'a description');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      const changeDir = path.join(projectRoot, 'rasen', 'changes', '--store=evil');
      expect(fs.existsSync(changeDir)).toBe(false);
    });

    it('binds an option-like description into the single --proposal= token without injecting a flag', async () => {
      const submit = submitter();
      const result = await submit('option-like-description', '--store evil --json');

      expect(result.ok).toBe(true);
      // The CLI's own --json flag on the argv still won: output was parsed
      // as JSON, meaning the description's "--json" text was never parsed
      // as a second, conflicting flag.
      expect(result.response.change.id).toBe('option-like-description');
    });

    it('rejects a name with uppercase, spaces, or a leading hyphen with 400', async () => {
      const submit = submitter();
      for (const bad of ['Has Spaces', 'UPPERCASE', '-leading-hyphen']) {
        const result = await submit(bad, 'a description');
        expect(result.ok, bad).toBe(false);
        expect(result.status, bad).toBe(400);
      }
    });

    it('responds 409 no_project and spawns nothing when there is no launch project', async () => {
      const submit = createChangeSubmitter({ launchProjectRoot: null }, { cliEntryOverride: realCliEntry });
      const result = await submit('no-project-change', 'a description');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(409);
      expect(result.code).toBe('no_project');
    });

    it('passes through the CLI error verbatim on a duplicate name, with exit code and stderr', async () => {
      fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes', 'dup-change'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'rasen', 'changes', 'dup-change', 'proposal.md'), '# dup\n');

      const submit = submitter();
      const result = await submit('dup-change', 'a description');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(422);
      expect(result.code).toBe('cli_error');
      expect(result.message).toContain('already exists');
      expect(typeof result.cliExitCode).toBe('number');
      expect(result.cliExitCode).not.toBe(0);
    });

    it('rejects an empty, oversized, or control-character description with 400', async () => {
      const submit = submitter();
      const empty = await submit('desc-empty', '');
      expect(empty.ok).toBe(false);
      expect(empty.status).toBe(400);

      const oversized = await submit('desc-oversized', 'x'.repeat(10_001));
      expect(oversized.ok).toBe(false);
      expect(oversized.status).toBe(400);

      const withControlChar = await submit('desc-control-char', 'bad\x00text');
      expect(withControlChar.ok).toBe(false);
      expect(withControlChar.status).toBe(400);

      // Carriage return is still a rejected control character — only \t and
      // \n are permitted (review M2).
      const withCarriageReturn = await submit('desc-carriage-return', 'bad\rtext');
      expect(withCarriageReturn.ok).toBe(false);
      expect(withCarriageReturn.status).toBe(400);
    });

    it('accepts a multi-line description (tab/newline permitted) and preserves it verbatim in proposal.md (review M2)', async () => {
      const submit = submitter();
      const multiline = 'Line one.\nLine two, indented:\n\tLine three.';
      const result = await submit('multiline-description-change', multiline);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      const proposalPath = path.join(
        projectRoot,
        'rasen',
        'changes',
        'multiline-description-change',
        'proposal.md'
      );
      const content = fs.readFileSync(proposalPath, 'utf-8');
      expect(content).toContain(multiline);
    });
  });

  describe('against a fake CLI (timeout, busy, protocol error)', () => {
    it('times out a hung subprocess with 504 cli_timeout', async () => {
      const submit = createChangeSubmitter(
        { launchProjectRoot: projectRoot },
        { cliEntryOverride: fakeCliEntry, timeoutMs: 200, killGraceMs: 100 }
      );
      const result = await submit('sleep-5000', 'a description');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(504);
      expect(result.code).toBe('cli_timeout');
    });

    it('rejects an overlapping submission immediately with 409 busy', async () => {
      const submit = createChangeSubmitter(
        { launchProjectRoot: projectRoot },
        { cliEntryOverride: fakeCliEntry, timeoutMs: 5000 }
      );

      const first = submit('sleep-300', 'a description');
      // Give the first call a tick to flip the in-flight flag before firing the second.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await submit('sleep-300', 'a description');

      expect(second.ok).toBe(false);
      expect(second.status).toBe(409);
      expect(second.code).toBe('busy');

      const firstResult = await first;
      expect(firstResult.ok).toBe(true);
    });

    it('reports 500 cli_protocol_error when a zero-exit subprocess produces unparseable output', async () => {
      const submit = createChangeSubmitter(
        { launchProjectRoot: projectRoot },
        { cliEntryOverride: path.resolve(__dirname, '..', '..', 'fixtures', 'management-api', 'garbage-output-cli.mjs') }
      );
      const result = await submit('garbage-change', 'a description');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.code).toBe('cli_protocol_error');
    });

    it('surfaces the fake CLI failure JSON as a 422 cli_error', async () => {
      const submit = createChangeSubmitter(
        { launchProjectRoot: projectRoot },
        { cliEntryOverride: fakeCliEntry }
      );
      const result = await submit('fail-me', 'a description');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(422);
      expect(result.message).toContain('fake failure');
      expect(result.cliExitCode).toBe(1);
    });

    it('escalates to SIGKILL a SIGTERM-resistant child, and releases the concurrency slot only once it actually closes, not at 504-response time (review M1)', async () => {
      const submit = createChangeSubmitter(
        { launchProjectRoot: projectRoot },
        { cliEntryOverride: sigtermResistantCliEntry, timeoutMs: 150, killGraceMs: 150 }
      );

      const first = submit('sigterm-resistant-change', 'a description');
      const firstResult = await first;

      // The 504 comes back promptly at the timeout, well before the
      // SIGKILL grace period has elapsed.
      expect(firstResult.ok).toBe(false);
      expect(firstResult.status).toBe(504);
      expect(firstResult.code).toBe('cli_timeout');

      // Immediately after the 504, the SIGTERM-resistant child is still
      // alive (it ignores SIGTERM; SIGKILL is not due for another
      // ~150ms) — a second submission must see busy, not spawn a second
      // subprocess. This is the concurrency-cap bug from M1: without the
      // fix, `inFlight` was already released at 504-response time.
      const second = await submit('should-be-rejected-busy', 'a description');
      expect(second.ok).toBe(false);
      expect(second.status).toBe(409);
      expect(second.code).toBe('busy');

      // Wait past the SIGKILL grace period so the uncatchable signal
      // actually terminates the child and the concurrency slot releases.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // The slot is now free: a third submission is admitted (spawned),
      // not rejected as busy. It uses the same slow fixture, so it will
      // itself eventually time out too — the only thing under test here
      // is that it was NOT rejected with 409 busy.
      const third = await submit('third-after-kill', 'a description');
      expect(third.status).not.toBe(409);
      expect(third.code).not.toBe('busy');

      // The third submission's own child is also SIGTERM-resistant and
      // needs its own SIGKILL escalation — wait past its grace period
      // before the test returns, so that process is confirmed reaped
      // rather than left to be killed later (or orphaned if the vitest
      // worker exits first): child processes are not killed on parent
      // exit (review n1).
      await new Promise((resolve) => setTimeout(resolve, 500));
    }, 10_000);
  });
});
