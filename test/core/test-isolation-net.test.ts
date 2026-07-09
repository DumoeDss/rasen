import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { getGlobalDataDir } from '../../src/core/global-config.js';
import { registerProject } from '../../src/core/project-registry.js';

/**
 * Guard test for the vitest global-setup machine-root safety net
 * (harden-adoption-and-test-isolation D4, vitest.setup.ts). Deliberately
 * makes NO explicit `globalDataDir`/`env` override — the exact shape of a
 * leaky suite — to prove the net (not per-test isolation) is what protects
 * the developer's real `~/.rasen` when a suite forgets one.
 */
describe('vitest global-setup machine-root safety net (ci-test-harness)', () => {
  it('resolves getGlobalDataDir() with no override into the per-run temp root, not the real machine home', () => {
    const resolved = getGlobalDataDir();
    const realDefault = path.join(os.homedir(), '.rasen');

    expect(resolved).not.toBe(realDefault);
    // The net's temp root lives under os.tmpdir() (mkdtempSync in
    // vitest.setup.ts); confirm the resolution actually landed there.
    expect(path.resolve(resolved).startsWith(path.resolve(os.tmpdir()))).toBe(true);
  });

  it('registers a project with no override under the per-run temp root, not the real machine home', async () => {
    const projectRoot = path.join(os.tmpdir(), `rasen-isolation-net-fixture-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(projectRoot, { recursive: true });

    try {
      const { entry } = await registerProject({
        projectRoot,
        projectId: randomUUID(),
        mode: 'in-repo',
      });

      const realDefault = path.join(os.homedir(), '.rasen');
      const resolvedDataDir = getGlobalDataDir();
      expect(resolvedDataDir).not.toBe(realDefault);
      expect(entry.home).toBeTruthy();
      // The home directory itself must have been created under the net's
      // temp root, never under the real machine home.
      expect(
        fs.existsSync(path.join(realDefault, 'projects', entry.home))
      ).toBe(false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
