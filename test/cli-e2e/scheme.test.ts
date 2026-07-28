import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';

describe('scheme CLI e2e', () => {
  const homes: string[] = [];

  afterEach(async () => {
    await Promise.all(
      homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true }))
    );
  });

  it('lists an absent scheme library from a headless child process', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-scheme-e2e-'));
    homes.push(home);

    const result = await runCLI(['scheme', 'list', '--json'], {
      env: { RASEN_HOME: home },
    });

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ schemes: [] });
  });
});
