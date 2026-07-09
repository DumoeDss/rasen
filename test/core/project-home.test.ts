import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveProjectHome, touchProjectRegistry } from '../../src/core/project-home.js';
import { readProjectConfig } from '../../src/core/project-config.js';
import {
  getProjectRegistryPath,
  readProjectRegistryState,
  writeProjectRegistryState,
} from '../../src/core/project-registry.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';

describe('project-home', () => {
  let projectRoot: string;
  let globalDataDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-home-'));
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-home-gdd-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  it('ensure mode mints identity, registers, and creates the home directory end-to-end', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir });

    expect(home).not.toBeNull();
    expect(home!.mode).toBe('in-repo');
    expect(path.isAbsolute(home!.homeDir)).toBe(true);
    expect(fs.existsSync(home!.homeDir)).toBe(true);

    // Config gained a projectId.
    const config = readProjectConfig(projectRoot);
    expect(config?.projectId).toBe(home!.projectId);

    // Registry entry exists.
    const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);
    const state = await readProjectRegistryState({ globalDataDir });
    expect(state?.projects[canonicalPath]?.projectId).toBe(home!.projectId);

    // workDir / archiveDir are absolute and platform-joined under homeDir.
    const workDir = home!.workDir('my-change');
    expect(workDir.startsWith(home!.homeDir)).toBe(true);
    expect(workDir.endsWith(path.join('changes', 'my-change', 'work'))).toBe(true);
    expect(home!.archiveDir).toBe(path.join(home!.homeDir, 'archive'));

    // changes/ and archive/ are NOT pre-created by the resolver.
    expect(fs.existsSync(path.join(home!.homeDir, 'changes'))).toBe(false);
    expect(fs.existsSync(home!.archiveDir)).toBe(false);
  });

  it('ensure mode is idempotent (re-init preserves projectId, entry, home)', async () => {
    const first = await resolveProjectHome(projectRoot, { globalDataDir });
    const second = await resolveProjectHome(projectRoot, { globalDataDir });

    expect(second!.projectId).toBe(first!.projectId);
    expect(second!.homeDir).toBe(first!.homeDir);
  });

  it('probe mode creates nothing for an unregistered project', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir, ensure: false });

    expect(home).toBeNull();
    const config = readProjectConfig(projectRoot);
    expect(config?.projectId).toBeUndefined();
    const state = await readProjectRegistryState({ globalDataDir });
    expect(state).toBeNull();
    expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
  });

  it('probe mode reports an already-registered project without mutating anything', async () => {
    const ensured = await resolveProjectHome(projectRoot, { globalDataDir });
    const probed = await resolveProjectHome(projectRoot, { globalDataDir, ensure: false });

    expect(probed).not.toBeNull();
    expect(probed!.projectId).toBe(ensured!.projectId);
    expect(probed!.homeDir).toBe(ensured!.homeDir);
  });

  it('fails with an actionable message when the config file cannot be written', async () => {
    const configPath = path.join(projectRoot, 'rasen', 'config.yaml');
    fs.chmodSync(configPath, 0o444);

    try {
      await expect(resolveProjectHome(projectRoot, { globalDataDir })).rejects.toThrow(
        /projectId|permission|EACCES|EPERM/iu
      );
    } finally {
      fs.chmodSync(configPath, 0o644);
    }
  });
});

describe('touchProjectRegistry (self-healing)', () => {
  let projectRoot: string;
  let globalDataDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-self-heal-'));
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-self-heal-gdd-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(globalDataDir, { recursive: true, force: true });
  });

  it('does nothing when the config has no projectId', async () => {
    await touchProjectRegistry(projectRoot, { globalDataDir });

    expect(fs.existsSync(path.join(globalDataDir, 'projects'))).toBe(false);
  });

  it('refreshes lastSeen when the entry is current but stale (> 24h)', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir });
    const canonicalPath = FileSystemUtils.canonicalizeExistingPath(projectRoot);

    // Backdate lastSeen by 25 hours.
    const staleState = await readProjectRegistryState({ globalDataDir });
    const staleTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeProjectRegistryState(
      {
        version: 1,
        projects: {
          ...staleState!.projects,
          [canonicalPath]: { ...staleState!.projects[canonicalPath], lastSeen: staleTimestamp },
        },
      },
      { globalDataDir }
    );

    await touchProjectRegistry(projectRoot, { globalDataDir });

    const refreshed = await readProjectRegistryState({ globalDataDir });
    const entry = refreshed!.projects[canonicalPath];
    expect(entry.lastSeen).not.toBe(staleTimestamp);
    expect(entry.home).toBe(path.basename(home!.homeDir)); // home never changes on refresh
    expect(Date.now() - Date.parse(entry.lastSeen)).toBeLessThan(60_000);
  });

  it('rebinds a moved project to its new path, reusing the home', async () => {
    const original = await resolveProjectHome(projectRoot, { globalDataDir });
    const movedRoot = path.join(path.dirname(projectRoot), `rasen-self-heal-moved-${Date.now()}`);
    fs.renameSync(projectRoot, movedRoot);

    await touchProjectRegistry(movedRoot, { globalDataDir });

    const state = await readProjectRegistryState({ globalDataDir });
    const movedCanonical = FileSystemUtils.canonicalizeExistingPath(movedRoot);
    expect(state?.projects[movedCanonical]?.home).toBe(path.basename(original!.homeDir));

    fs.rmSync(movedRoot, { recursive: true, force: true });
  });

  it('does not rewrite the registry when the entry is current and recently seen', async () => {
    await resolveProjectHome(projectRoot, { globalDataDir });
    const registryPath = getProjectRegistryPath({ globalDataDir });
    const beforeContent = fs.readFileSync(registryPath, 'utf-8');
    const beforeMtime = fs.statSync(registryPath).mtimeMs;

    await touchProjectRegistry(projectRoot, { globalDataDir });

    const afterContent = fs.readFileSync(registryPath, 'utf-8');
    const afterMtime = fs.statSync(registryPath).mtimeMs;
    expect(afterContent).toBe(beforeContent);
    expect(afterMtime).toBe(beforeMtime);
  });

  it('survives a corrupt registry without breaking the command', async () => {
    await resolveProjectHome(projectRoot, { globalDataDir });
    const registryPath = getProjectRegistryPath({ globalDataDir });
    fs.writeFileSync(registryPath, '{not valid json');

    await expect(touchProjectRegistry(projectRoot, { globalDataDir })).resolves.toBeUndefined();
  });
});
