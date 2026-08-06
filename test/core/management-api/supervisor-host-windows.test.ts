import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const mockSpawnCalls: Array<Parameters<typeof import('node:child_process').spawn>> = [];
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      mockSpawnCalls.push(args);
      return actual.spawn(...args);
    },
  };
});

import {
  createSessionSupervisor,
  type SessionSupervisor,
} from '../../../src/core/management-api/supervisor.js';
import { createSessionRegistry } from '../../../src/core/management-api/session-registry.js';
import { isProcessAlive } from '../../../src/core/management-api/kill-tree.js';
import { fakeClaudeBin } from '../../helpers/fake-claude-bin.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const IS_WINDOWS = process.platform === 'win32';
const EVENTS_FILE = 'host-fixture-events.ndjson';

interface FixtureEvent {
  type: 'spawn' | 'delivery';
  pid: number;
  cwd?: string;
  argv?: string[];
  message?: string;
}

describe.skipIf(!IS_WINDOWS)('reusable host Windows .cmd transport', () => {
  let tempRoot: string;
  let cwd: string;
  let supervisor: SessionSupervisor;

  beforeEach(() => {
    mockSpawnCalls.length = 0;
    tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-host-win-')));
    cwd = path.join(tempRoot, 'cwd & host (literal)');
    fs.mkdirSync(cwd);
    cwd = fs.realpathSync.native(cwd);
    supervisor = createSessionSupervisor({
      registry: createSessionRegistry(),
      resolveAgentCli: async () => fakeClaudeBin,
      maxConcurrent: 1,
      killGraceMs: 100,
    });
  });

  afterEach(async () => {
    await supervisor.shutdownAll('server-shutdown');
    await cleanupTempPathAsync(tempRoot);
  });

  function events(): FixtureEvent[] {
    return fs.readFileSync(path.join(cwd, EVENTS_FILE), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FixtureEvent);
  }

  async function waitFor(description: string, predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('keeps fixed argv shell-safe while delivering literal stdin and same-cwd recovery', async () => {
    const canary = path.join(cwd, 'HOST-PWNED.txt');
    const bootstrap = `first line\nsecond " & echo PWNED>HOST-PWNED.txt & | % ^ (literal) IDLE_LOSS`;
    const created = await supervisor.createHost({
      message: bootstrap,
      cwd,
      timeoutMs: 6000,
      noOutputTimeoutMs: 4000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok || created.host.pid === undefined) return;
    expect(fs.existsSync(canary)).toBe(false);

    const firstSpawnCall = mockSpawnCalls[0];
    expect(firstSpawnCall?.[2]).toMatchObject({
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const firstFixtureSpawn = events().find((event) => event.type === 'spawn')!;
    expect(firstFixtureSpawn.cwd).toBe(fs.realpathSync.native(cwd));
    expect(firstFixtureSpawn.argv).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]);
    expect(events().find((event) => event.type === 'delivery')?.message).toBe(bootstrap);

    await waitFor('idle loss', () => supervisor.getHost(created.host.id)?.state === 'lost');
    const recoveryMessage = `recover\n"& echo STILL-NOT-PWNED>${path.basename(canary)} &"`;
    const recovered = await supervisor.wakeHost(created.host.id, {
      message: recoveryMessage,
      timeoutMs: 6000,
      noOutputTimeoutMs: 4000,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok || recovered.host.pid === undefined) return;
    expect(recovered.host.id).toBe(created.host.id);
    expect(recovered.host.pid).not.toBe(created.host.pid);
    expect(fs.existsSync(canary)).toBe(false);

    const fixtureSpawns = events().filter((event) => event.type === 'spawn');
    expect(fixtureSpawns[1].cwd).toBe(fs.realpathSync.native(cwd));
    expect(fixtureSpawns[1].argv).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--resume',
      'fake-host-session',
    ]);
    expect(events().filter((event) => event.type === 'delivery').at(-1)?.message).toBe(recoveryMessage);

    const recoveredPid = recovered.host.pid;
    expect((await supervisor.retireHost(created.host.id)).ok).toBe(true);
    await waitFor('recovered process-tree cleanup', () => !isProcessAlive(recoveredPid));
  }, 20_000);
});
