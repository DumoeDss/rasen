import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveChangeWorkDir } from '../../src/core/change-work.js';
import { getProjectRegistryPath, readProjectRegistryState } from '../../src/core/project-registry.js';
import { resolveProjectHome } from '../../src/core/project-home.js';

describe('resolveChangeWorkDir', () => {
  let projectRoot: string;
  let globalDataDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-change-work-'));
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-change-work-gdd-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  it('probe mode (default) returns null for an unregistered project without any write', async () => {
    const result = await resolveChangeWorkDir(projectRoot, 'my-change', { globalDataDir });

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
  });

  it('ensure:true mints identity once on the first call and resolves the frozen work-dir layout', async () => {
    const workDir = await resolveChangeWorkDir(projectRoot, 'my-change', {
      globalDataDir,
      ensure: true,
    });

    expect(workDir).not.toBeNull();
    expect(path.isAbsolute(workDir!)).toBe(true);
    expect(workDir).toContain(path.join('changes', 'my-change', 'work'));

    // Directory is never pre-created by the resolver.
    expect(fs.existsSync(workDir!)).toBe(false);

    const state = await readProjectRegistryState({ globalDataDir });
    expect(state).not.toBeNull();
  });

  it('a second call (even with ensure:true) takes the probe path — no further registry write', async () => {
    await resolveChangeWorkDir(projectRoot, 'my-change', { globalDataDir, ensure: true });

    const registryPath = getProjectRegistryPath({ globalDataDir });
    const beforeContent = fs.readFileSync(registryPath, 'utf-8');
    const beforeMtime = fs.statSync(registryPath).mtimeMs;

    const workDir = await resolveChangeWorkDir(projectRoot, 'my-change', {
      globalDataDir,
      ensure: true,
    });

    expect(workDir).not.toBeNull();
    const afterContent = fs.readFileSync(registryPath, 'utf-8');
    const afterMtime = fs.statSync(registryPath).mtimeMs;
    expect(afterContent).toBe(beforeContent);
    expect(afterMtime).toBe(beforeMtime);
  });

  it('resolved path matches the frozen <home>/changes/<name>/work layout exactly', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir });
    const workDir = await resolveChangeWorkDir(projectRoot, 'my-change', {
      globalDataDir,
      ensure: true,
    });

    expect(workDir).toBe(home!.workDir('my-change'));
  });

  it('ensure:true degrades to null (never throws) when rasen/config.yaml does not exist at all', async () => {
    const bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-change-work-bare-'));
    fs.mkdirSync(path.join(bareRoot, 'rasen', 'changes'), { recursive: true });

    try {
      const workDir = await resolveChangeWorkDir(bareRoot, 'legacy-change', {
        globalDataDir,
        ensure: true,
      });

      expect(workDir).toBeNull();
      expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
    } finally {
      fs.rmSync(bareRoot, { recursive: true, force: true });
    }
  });

  it('probe mode degrades to null (never throws) when the machine-global registry.json is corrupt', async () => {
    // Register first so config.yaml carries a projectId and the probe path
    // actually reaches readProjectRegistryState (a config with no projectId
    // short-circuits before ever touching the registry file).
    await resolveChangeWorkDir(projectRoot, 'my-change', { globalDataDir, ensure: true });
    const registryPath = getProjectRegistryPath({ globalDataDir });
    fs.writeFileSync(registryPath, '{not valid json');

    const workDir = await resolveChangeWorkDir(projectRoot, 'my-change', {
      globalDataDir,
      ensure: false,
    });

    expect(workDir).toBeNull();
  });

  it('ensure:true also degrades to null (never throws) when the machine-global registry.json is corrupt', async () => {
    await resolveChangeWorkDir(projectRoot, 'my-change', { globalDataDir, ensure: true });
    const registryPath = getProjectRegistryPath({ globalDataDir });
    fs.writeFileSync(registryPath, '{not valid json');

    const workDir = await resolveChangeWorkDir(projectRoot, 'my-change', {
      globalDataDir,
      ensure: true,
    });

    expect(workDir).toBeNull();
  });

  it('works for a store-root projectRoot (config-only pointer directory)', async () => {
    const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-change-work-store-'));
    fs.mkdirSync(path.join(storeRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nstore: some-store\n'
    );

    try {
      const workDir = await resolveChangeWorkDir(storeRoot, 'store-change', {
        globalDataDir,
        ensure: true,
      });

      expect(workDir).not.toBeNull();
      expect(workDir).toContain(path.join('changes', 'store-change', 'work'));
    } finally {
      fs.rmSync(storeRoot, { recursive: true, force: true });
    }
  });
});
