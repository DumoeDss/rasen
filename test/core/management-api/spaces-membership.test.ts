import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import { handleSpaces } from '../../../src/core/management-api/spaces.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { updateProjectConfigKey } from '../../../src/core/project-config.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import { writeDurablePointer } from '../../../src/core/store/upgrade-identity.js';
import { readOptionalStoreMetadataState } from '../../../src/core/store/foundation.js';
import { upgradeStoreIdentity } from '../../../src/core/store/upgrade-identity.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import type { StoreSpaceEntry } from '../../../src/core/management-api/wire-types.js';

const PROJECT_A = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';
const PROJECT_REMOTE_ONLY = 'aa11bb22-cc33-4d44-8e55-ff6677889900';

function snapshot(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.set(path.relative(dir, full), fs.readFileSync(full, 'utf-8'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

describe('spaces listing: store members are the union of records and pointers', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-spaces-membership-'));
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });

    storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team-store', localPath: storeRoot, globalDataDir });
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeProject(name: string, projectId: string): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    updateProjectConfigKey(root, 'projectId', projectId);
    return root;
  }

  function storeSpace(spaces: Awaited<ReturnType<typeof handleSpaces>>): StoreSpaceEntry {
    const entry = spaces.spaces.find(
      (space): space is StoreSpaceEntry => space.type === 'store' && space.id === 'team-store'
    );
    expect(entry).toBeDefined();
    return entry as StoreSpaceEntry;
  }

  it('keeps pointer-derived members, so a store with no records lists them', async () => {
    const projectRoot = makeProject('pointer-repo', PROJECT_A);
    updateProjectConfigKey(projectRoot, 'store', 'team-store');
    await registerProject(
      { projectRoot, projectId: PROJECT_A, mode: 'store' },
      { globalDataDir }
    );

    const store = storeSpace(await handleSpaces());
    expect(store.members.map((member) => member.projectId)).toEqual([PROJECT_A]);
    expect(store.members[0]?.root).toBeTruthy();
  });

  it('finds a member whose declaration records only the permanent identity', async () => {
    // The bug this replaces: members were matched by the declared display
    // ALIAS, which a uid-only declaration does not carry — so the repo silently
    // vanished from its own store's member list.
    await upgradeStoreIdentity({ id: 'team-store', apply: true, globalDataDir });
    const uid = (await readOptionalStoreMetadataState(storeRoot).then((state) =>
      state && state.version === 2 ? state.uid : undefined
    )) as string;
    expect(uid).toBeTruthy();

    const projectRoot = makeProject('uid-only', PROJECT_A);
    await writeDurablePointer(path.join(projectRoot, 'rasen', 'config.yaml'), {
      uid,
      id: 'team-store',
    });
    // Strip the display alias, leaving the identity alone — the exact shape a
    // display-name comparison cannot see.
    updateProjectConfigKey(projectRoot, 'store.id', undefined);
    await registerProject(
      { projectRoot, projectId: PROJECT_A, mode: 'store' },
      { globalDataDir }
    );

    const store = storeSpace(await handleSpaces());
    expect(store.uid).toBe(uid);
    expect(store.members.map((member) => member.projectId)).toEqual([PROJECT_A]);
  });

  it('lists a recorded member that points at a different store, and keeps it a top-level space', async () => {
    const otherRoot = path.join(tempDir, 'other-store');
    createOpenSpecRoot(otherRoot);
    await registerStore({ id: 'other-store', localPath: otherRoot, globalDataDir });

    const projectRoot = makeProject('knowledge-member', PROJECT_A);
    updateProjectConfigKey(projectRoot, 'store', 'other-store');
    await registerProject(
      { projectRoot, projectId: PROJECT_A, mode: 'in-repo' },
      { globalDataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_A,
      id: 'knowledge-member',
      roles: { planning: false, knowledge: true },
    });

    const spaces = await handleSpaces();
    const store = storeSpace(spaces);
    expect(store.members.map((member) => member.projectId)).toEqual([PROJECT_A]);
    // Membership is not a planning binding: the project is still its own space.
    expect(
      spaces.spaces.some((space) => space.type === 'project' && space.id === PROJECT_A)
    ).toBe(true);
  });

  it('lists a recorded member with no live checkout, without a root and without omitting it', async () => {
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_REMOTE_ONLY,
      id: 'elsewhere',
      roles: { planning: false, knowledge: true },
    });

    const store = storeSpace(await handleSpaces());
    const member = store.members.find((entry) => entry.projectId === PROJECT_REMOTE_ONLY);
    expect(member).toBeDefined();
    expect(member?.name).toBe('elsewhere');
    // No root is reported rather than a fabricated one.
    expect(member?.root).toBeUndefined();
  });

  it('presents one entry per project identity when both sources name it', async () => {
    const projectRoot = makeProject('both-sources', PROJECT_A);
    updateProjectConfigKey(projectRoot, 'store', 'team-store');
    await registerProject(
      { projectRoot, projectId: PROJECT_A, mode: 'store' },
      { globalDataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_A,
      id: 'both-sources',
      roles: { planning: true, knowledge: true },
    });

    const store = storeSpace(await handleSpaces());
    expect(store.members).toHaveLength(1);
    expect(store.members[0]?.root).toBeTruthy();
  });

  it('answers the request without writing anything', async () => {
    const projectRoot = makeProject('reader', PROJECT_A);
    updateProjectConfigKey(projectRoot, 'store', 'team-store');
    await registerProject(
      { projectRoot, projectId: PROJECT_A, mode: 'store' },
      { globalDataDir }
    );
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: PROJECT_REMOTE_ONLY,
      roles: { planning: false, knowledge: true },
    });
    const before = snapshot(tempDir);

    await handleSpaces();

    expect(snapshot(tempDir)).toEqual(before);
  });
});
