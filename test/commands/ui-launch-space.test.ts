import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveLaunchSpaceQuery } from '../../src/commands/ui-launch.js';
import { resolveSpaceSelector } from '../../src/core/config-api/project-addressing.js';
import { registerStore } from '../../src/core/store/registry.js';
import { findProjectRegistryEntry } from '../../src/core/project-registry.js';
import { createOpenSpecRoot } from '../helpers/rasen-fixtures.js';

describe('resolveLaunchSpaceQuery (management-ui-command spec / design D5)', () => {
  let tempDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-launch-space-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('emits a resolvable ?space=project:<id> for a project cwd', async () => {
    const projectRoot = path.join(tempDir, 'a-project');
    createOpenSpecRoot(projectRoot);
    fs.appendFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'projectId: a-project-id\n');

    const query = await resolveLaunchSpaceQuery(projectRoot);
    expect(query).toBe('?space=project:a-project-id');

    // The emitted selector resolves against the (now registered) project.
    const resolved = await resolveSpaceSelector('project:a-project-id');
    expect(resolved.ok).toBe(true);
  });

  it('registers an unregistered project during launch so its emitted selector resolves', async () => {
    const projectRoot = path.join(tempDir, 'fresh-project');
    createOpenSpecRoot(projectRoot); // no projectId in config yet, never registered

    // Precondition: not registered.
    expect(await findProjectRegistryEntry(projectRoot, { globalDataDir: dataDir })).toBeNull();

    const query = await resolveLaunchSpaceQuery(projectRoot);
    expect(query).toMatch(/^\?space=project:.+$/);

    // Launch registered it, so the emitted selector resolves.
    const entry = await findProjectRegistryEntry(projectRoot, { globalDataDir: dataDir });
    expect(entry).not.toBeNull();
    const selector = query.slice('?space='.length);
    const resolved = await resolveSpaceSelector(selector);
    expect(resolved.ok).toBe(true);
  });

  it('emits ?space=store:<id> for a pointer repo', async () => {
    const storeRoot = path.join(tempDir, 'the-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: dataDir });

    const pointerRepo = path.join(tempDir, 'pointer-repo');
    fs.mkdirSync(path.join(pointerRepo, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(pointerRepo, 'rasen', 'config.yaml'), 'store: team\n');

    const query = await resolveLaunchSpaceQuery(pointerRepo);
    expect(query).toBe('?space=store:team');
  });

  it('emits no parameter when the cwd is outside any Rasen root', async () => {
    const bare = path.join(tempDir, 'not-a-repo');
    fs.mkdirSync(bare, { recursive: true });
    const query = await resolveLaunchSpaceQuery(bare);
    expect(query).toBe('');
  });
});
