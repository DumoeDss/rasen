import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createSessionSupervisor } from '../../../src/core/management-api/supervisor.js';
import { createSessionRegistry } from '../../../src/core/management-api/session-registry.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Adversarial regression for the Windows `.cmd`/`.bat` spawn path (design D1,
 * spec `windows-process-launch`). The vulnerability is specific to `cmd.exe`
 * re-parsing the trailing command line, so it only exists — and can only be
 * exercised — on win32; on POSIX the agent CLI is spawned directly with no
 * shell, so there is nothing to inject. The suite is skipped off-Windows.
 *
 * Each case drives the REAL `supervisor.launch()` -> `spawnAgentCli()` path
 * with an attacker-controlled `task` (the HTTP body field validated only for
 * length/control-chars). The resolved binary is an npm-shim-shaped `.cmd`
 * (`node "<readback>" %*`) — the exact double-`cmd.exe`-parse shape that makes
 * naive escaping insufficient. The readback records the argv the agent process
 * actually received, so we assert BOTH that no injected side-effect command ran
 * (no canary file) AND that the metacharacter-bearing prompt arrived as one
 * intact literal argument.
 */
describe.skipIf(!IS_WINDOWS)('spawnAgentCli command-injection hardening (Windows .cmd/.bat)', () => {
  let workDir: string;
  let shimDir: string;
  let shimBin: string;

  const ARGV_DUMP = 'argv-dump.json';
  const CANARY = 'PWNED.txt';

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-inj-cwd-'));
    shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-inj-shim-'));

    // A readback stand-in for the agent CLI: dumps the argv it actually
    // received (so we can assert intact delivery), then emits a valid
    // stream-json init + result line and exits 0 so the supervisor observes a
    // clean close. It writes the dump beside the shim, never into the session
    // cwd, so the only thing that can create a file in `workDir` is an
    // injected command.
    const readback = path.join(shimDir, 'readback.mjs');
    fs.writeFileSync(
      readback,
      [
        `import * as fs from 'node:fs';`,
        `fs.writeFileSync(${JSON.stringify(path.join(shimDir, ARGV_DUMP))}, JSON.stringify(process.argv.slice(2)));`,
        `process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'inj-fixture' }) + '\\n');`,
        `process.stdout.write(JSON.stringify({ type: 'result', result: 'ok' }) + '\\n');`,
        `process.exit(0);`,
      ].join('\n'),
      'utf-8'
    );

    // npm-generated `.cmd` shim shape: proxies every arg to node via `%*`,
    // which re-parses through cmd.exe a second time.
    shimBin = path.join(shimDir, 'claude.cmd');
    fs.writeFileSync(shimBin, `@echo off\r\nnode "%~dp0readback.mjs" %*\r\n`, 'utf-8');
  });

  afterEach(async () => {
    await cleanupTempPathAsync(workDir);
    await cleanupTempPathAsync(shimDir);
  });

  function makeSupervisor() {
    return createSessionSupervisor({
      registry: createSessionRegistry(),
      resolveAgentCli: async () => shimBin,
      killGraceMs: 200,
    });
  }

  // Each string, appended after the skill token, tries a different cmd.exe
  // break-out that would create the canary file if the arg were re-parsed.
  const ATTACKS: Array<{ name: string; task: string }> = [
    { name: 'embedded double-quote + &-chain', task: `foo" & echo INJECTED>${CANARY} & "bar` },
    { name: 'bare ampersand', task: `foo & echo INJECTED>${CANARY}` },
    { name: 'double ampersand', task: `x && echo INJECTED>${CANARY}` },
    { name: 'pipe', task: `x | echo INJECTED>${CANARY}` },
    { name: 'env-var expansion + &', task: `%USERPROFILE% & echo INJECTED>${CANARY}` },
    { name: 'caret', task: `x^ & echo INJECTED>${CANARY}` },
    { name: 'parens', task: `a") & echo INJECTED>${CANARY} & (echo "b` },
    { name: 'quote-metachar no spaces', task: `a"&echo INJECTED>${CANARY}&"b` },
    { name: 'benign metachars stay intact', task: `keep % & | > < ^ ( ) ! all of these literally` },
  ];

  for (const { name, task } of ATTACKS) {
    it(`does not execute injected commands and delivers the task intact: ${name}`, async () => {
      const supervisor = makeSupervisor();
      const skill = '/rasen-auto';
      const result = await supervisor.launch({
        kind: 'auto',
        skill,
        task,
        cwd: workDir,
        timeoutMs: 5000,
        noOutputTimeoutMs: 5000,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Wait for the child to run and close.
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(supervisor.getRecord(result.record.id)!.state).toBe('exited');

      // 1. No injected command ran — the canary never appeared in the session cwd.
      expect(fs.existsSync(path.join(workDir, CANARY))).toBe(false);

      // 2. The prompt reached the agent process as one intact literal argument.
      const dumped = JSON.parse(fs.readFileSync(path.join(shimDir, ARGV_DUMP), 'utf-8')) as string[];
      const promptIndex = dumped.indexOf('-p');
      expect(promptIndex).toBeGreaterThanOrEqual(0);
      expect(dumped[promptIndex + 1]).toBe(`${skill} ${task}`);

      // 3. The full fixed argv shape is preserved byte-for-byte around the prompt.
      expect(dumped).toEqual([
        '-p',
        `${skill} ${task}`,
        '--dangerously-skip-permissions',
        '--output-format',
        'stream-json',
        '--verbose',
      ]);
    }, 10_000);
  }

  // A raw newline cannot survive `cmd.exe /C`: cmd truncates the command line
  // at the first `\n`, silently dropping the rest of the prompt AND the trailing
  // --dangerously-skip-permissions/--output-format/--verbose flags. The Windows
  // shim path must REJECT it loudly, never truncate-and-launch.
  it('rejects a newline-bearing task loudly (503, nothing spawned) rather than silently truncating the command line', async () => {
    const supervisor = makeSupervisor();
    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen-auto',
      // Combines a newline with an injection break-out to prove the reject
      // fires before any spawn (neither truncation nor injection can occur).
      task: `first line\nsecond line" & echo INJECTED>${CANARY} & rem "`,
      cwd: workDir,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(503);
    expect(result.code).toBe('agent_cli_unavailable');
    expect(result.message).toMatch(/newline|multi-line|carriage/i);

    // Nothing was spawned: the readback never ran (no argv dump) and no injected
    // command executed (no canary) — this is a clean up-front reject.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fs.existsSync(path.join(shimDir, ARGV_DUMP))).toBe(false);
    expect(fs.existsSync(path.join(workDir, CANARY))).toBe(false);
  }, 10_000);
});

/**
 * Companion POSIX guarantee: the Windows-shim newline limitation must NOT leak
 * into a global validation change. On POSIX (and for a native `.exe`) a newline
 * in an argv element is passed literally, so a multi-line prompt is a valid,
 * supported feature. This runs only off-Windows, where `fakeClaudeBin` is the
 * directly-spawned `.mjs` and there is no `cmd.exe` transport in the path.
 */
describe.skipIf(IS_WINDOWS)('POSIX accepts multi-line task text (no Windows shim limitation)', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-posix-nl-'));
  });

  afterEach(async () => {
    await cleanupTempPathAsync(cwd);
  });

  it('launches a session whose task text spans multiple lines', async () => {
    const supervisor = createSessionSupervisor({
      registry: createSessionRegistry(),
      resolveAgentCli: async () => fakeClaudeBin,
      killGraceMs: 200,
    });

    const result = await supervisor.launch({
      kind: 'auto',
      skill: '/rasen-auto',
      // MODE token still parses (\S+ stops at the newline); the rest is a
      // legitimate multi-line prompt that POSIX carries literally.
      task: 'MODE=fast-exit first line\nsecond line with & | > metachars\nthird line',
      cwd,
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(supervisor.getRecord(result.record.id)!.state).toBe('exited');
    expect(supervisor.getRecord(result.record.id)!.terminationReason).toBe('exit');
  }, 10_000);
});
