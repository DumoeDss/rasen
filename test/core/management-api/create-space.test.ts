import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSpaceCreator } from '../../../src/core/management-api/create-space.js';
import type { SpaceEntry } from '../../../src/core/management-api/wire-types.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeCliEntry = path.resolve(
  here,
  '..',
  '..',
  'fixtures',
  'management-api',
  'create-space-fake-cli.mjs'
);

function readArgvLog(logPath: string): string[][] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function listingOf(spaces: SpaceEntry[]) {
  return async () => ({ spaces });
}

function projectSpace(id: string, root: string): SpaceEntry {
  return { type: 'project', id, name: id, root };
}

function storeSpace(
  id: string,
  root: string,
  members: Array<{ projectId: string; name: string; root?: string }> = []
): SpaceEntry {
  return { type: 'store', id, name: id, root, members };
}

function scriptedListings(...snapshots: SpaceEntry[][]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    list: async () => {
      const snapshot = snapshots[Math.min(calls, snapshots.length - 1)] ?? [];
      calls += 1;
      return { spaces: snapshot };
    },
  };
}

describe('createSpaceCreator explicit operations', () => {
  let dir: string;
  let argvLog: string;

  beforeEach(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rasen-create-space-'))
    );
    argvLog = path.join(dir, 'argv.log');
    process.env.RASEN_FAKE_ARGV_LOG = argvLog;
  });

  afterEach(async () => {
    delete process.env.RASEN_FAKE_ARGV_LOG;
    delete process.env.RASEN_FAKE_PROJECT_ID;
    delete process.env.RASEN_FAKE_STORE_ROOT;
    await cleanupTempPathAsync(dir);
  });

  function creator(spaces: SpaceEntry[] = []) {
    return createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: listingOf(spaces),
    });
  }

  it.each([
    [{ kind: 'project', path: dir }, 'legacy body'],
    [{ op: 'banana', path: dir }, 'unknown op'],
    [{ op: 'create-project', path: 'relative' }, 'relative path'],
    [{ op: 'create-project', path: `${dir}\tchild` }, 'tab in path'],
    [{ op: 'create-project', path: `${dir}\nchild` }, 'newline in path'],
    [{ op: 'register-store', path: `${dir}\u007fchild` }, 'DEL in path'],
    [{ op: 'create-store', parent: `${dir}\tparent`, id: 'team' }, 'tab in parent'],
    [{ op: 'create-store', parent: `${dir}\nparent`, id: 'team' }, 'newline in parent'],
    [{ op: 'create-project', path: dir, id: 'extra' }, 'cross-operation field'],
    [{ op: 'create-store', parent: dir }, 'missing id'],
    [{ op: 'create-store', parent: dir, id: '--evil Id' }, 'invalid id'],
    [{ op: 'register-store', path: dir, parent: dir }, 'ambiguous fields'],
    [{ op: 'add-project-to-store', storeId: 'team' }, 'missing project id'],
    [{ op: 'add-project-to-store', projectId: 'project-id' }, 'missing store id'],
    [{ op: 'add-project-to-store', projectId: 'project-id', storeId: 'team', path: dir }, 'client path'],
    [{ op: 'add-project-to-store', projectId: 'project\nid', storeId: 'team' }, 'control character'],
    [{ op: 'add-project-to-store', projectId: 'p'.repeat(513), storeId: 'team' }, 'oversize id'],
  ])('rejects %s before spawning (%s)', async (body) => {
    const result = await creator()(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(readArgvLog(argvLog)).toEqual([]);
  });

  it('spawns exact project argv', async () => {
    const result = await creator([
      { type: 'project', id: 'proj', name: 'Proj', root: dir },
    ])({ op: 'create-project', path: dir });
    expect(result.ok).toBe(true);
    expect(readArgvLog(argvLog)).toEqual([['init', dir]]);
  });

  it('joins parent plus validated id and locates setup success by child root', async () => {
    const child = path.join(dir, 'team-store');
    const result = await creator([
      {
        type: 'store',
        id: 'team-store',
        name: 'team-store',
        root: child,
        members: [],
      },
    ])({ op: 'create-store', parent: dir, id: 'team-store' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.operation).toBe('store-setup');
    expect(result.response.space.root).toBe(child);
    expect(readArgvLog(argvLog)).toEqual([
      ['store', 'setup', 'team-store', '--path', child, '--json'],
    ]);
  });

  it('create never infers registration from Store-like child state', async () => {
    const child = path.join(dir, 'existing-child');
    fs.mkdirSync(path.join(child, 'rasen'), { recursive: true });
    await creator([
      {
        type: 'store',
        id: 'existing-child',
        name: 'existing-child',
        root: child,
        members: [],
      },
    ])({ op: 'create-store', parent: dir, id: 'existing-child' });
    expect(readArgvLog(argvLog)[0]?.slice(0, 2)).toEqual(['store', 'setup']);
  });

  it('register always invokes register, with optional id as one argv token', async () => {
    const existing = path.join(dir, 'existing;store');
    const result = await creator([
      {
        type: 'store',
        id: 'team-store',
        name: 'team-store',
        root: existing,
        members: [],
      },
    ])({ op: 'register-store', path: existing, id: 'team-store' });
    expect(result.ok).toBe(true);
    expect(readArgvLog(argvLog)).toEqual([
      ['store', 'register', existing, '--yes', '--id', 'team-store', '--json'],
    ]);
  });

  it('registration never invokes setup when the CLI refuses it', async () => {
    const missing = path.join(dir, 'FAKEFAIL-missing-store');
    const result = await creator()({ op: 'register-store', path: missing });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.message).toContain('fake store failure');
    expect(readArgvLog(argvLog)[0]?.slice(0, 2)).toEqual(['store', 'register']);
  });

  it('passes project CLI errors through with exit code and stderr', async () => {
    const target = path.join(dir, 'FAKEFAIL-project');
    const result = await creator()({ op: 'create-project', path: target });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.cliExitCode).toBe(1);
    expect(result.message).toContain('fake init failure');
  });

  it('reports protocol error when success is absent from the listing', async () => {
    const result = await creator()({ op: 'create-project', path: dir });
    expect(result.ok).toBe(false);
    if (result.ok) expect.unreachable();
    expect(result.status).toBe(500);
    expect(result.code).toBe('cli_protocol_error');
  });

  it.each([
    {
      name: 'missing Project',
      spaces: [] as SpaceEntry[],
      body: { op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' },
      status: 404,
      code: 'space_not_found',
    },
    {
      name: 'wrong-type Project id',
      spaces: [storeSpace('project-id', path.resolve('wrong-type-store'))] as SpaceEntry[],
      body: { op: 'add-project-to-store', projectId: 'project-id', storeId: 'project-id' },
      status: 404,
      code: 'space_not_found',
    },
    {
      name: 'ambiguous Project',
      spaces: [
        projectSpace('project-id', path.resolve('project-clone-a')),
        projectSpace('project-id', path.resolve('project-clone-b')),
      ] as SpaceEntry[],
      body: { op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' },
      status: 409,
      code: 'space_ambiguous',
    },
    {
      name: 'missing Store',
      spaces: [projectSpace('project-id', path.resolve('project-without-store'))] as SpaceEntry[],
      body: { op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' },
      status: 404,
      code: 'space_not_found',
    },
    {
      name: 'wrong-type Store id',
      spaces: [
        projectSpace('project-id', path.resolve('project-for-wrong-store')),
        projectSpace('team', path.resolve('project-named-team')),
      ] as SpaceEntry[],
      body: { op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' },
      status: 404,
      code: 'space_not_found',
    },
    {
      name: 'ambiguous Store',
      spaces: [
        projectSpace('project-id', path.resolve('project-one')),
        storeSpace('team', path.resolve('store-a')),
        storeSpace('team', path.resolve('store-b')),
      ] as SpaceEntry[],
      body: { op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' },
      status: 409,
      code: 'space_ambiguous',
    },
  ])('rejects typed catalog resolution before spawning: $name', async ({ spaces, body, status, code }) => {
    const result = await creator(spaces)(body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(status);
    expect(result.code).toBe(code);
    expect(readArgvLog(argvLog)).toEqual([]);
  });

  it('uses exact inert argv, fresh pre/post reads, normalized Project identity, and a typed 200 Store result', async () => {
    const projectRoot = path.join(dir, 'Project & [one]');
    const storeRoot = path.join(dir, 'Store (team)');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(storeRoot, { recursive: true });
    const requestedProjectId = 'AABBCCDD-EEFF-4011-8223-445566778899';
    const canonicalProjectId = requestedProjectId.toLowerCase();
    process.env.RASEN_FAKE_PROJECT_ID = canonicalProjectId;
    process.env.RASEN_FAKE_STORE_ROOT = storeRoot;
    const pre = [projectSpace(requestedProjectId, projectRoot), storeSpace('team-store', storeRoot)];
    const post = [
      projectSpace(requestedProjectId, projectRoot),
      storeSpace('team-store', storeRoot, [
        { projectId: canonicalProjectId, name: 'Project one', root: projectRoot },
      ]),
    ];
    const catalog = scriptedListings(pre, post);
    const create = createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: catalog.list,
    });

    const result = await create({
      op: 'add-project-to-store',
      projectId: requestedProjectId,
      storeId: 'team-store',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.response.operation).toBe('store-add-project');
    expect(result.response.space).toEqual(post[1]);
    expect(catalog.calls).toBe(2);
    const argv = readArgvLog(argvLog);
    expect(argv).toEqual([
      ['store', 'add-project', projectRoot, '--to', 'team-store', '--json'],
    ]);
    expect(argv.flat()).not.toContain('--set-primary');
    expect(argv.flat()).not.toContain('--as');
    expect(argv.flat()).not.toContain('--dry-run');
    expect(argv.flat()).not.toContain('adopt');
  });

  it('replays an established membership without duplicate members', async () => {
    const projectRoot = path.join(dir, 'replay-project');
    const storeRoot = path.join(dir, 'replay-store');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(storeRoot, { recursive: true });
    process.env.RASEN_FAKE_PROJECT_ID = 'project-id';
    process.env.RASEN_FAKE_STORE_ROOT = storeRoot;
    const established = [
      projectSpace('project-id', projectRoot),
      storeSpace('team', storeRoot, [{ projectId: 'project-id', name: 'project-id', root: projectRoot }]),
    ];
    const catalog = scriptedListings(established, established, established, established);
    const create = createSpaceCreator({ cliEntryOverride: fakeCliEntry, listSpacesOverride: catalog.list });
    const body = { op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' };

    const first = await create(body);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await create(body);

    expect(first.ok && first.status).toBe(200);
    expect(second.ok && second.status).toBe(200);
    expect(catalog.calls).toBe(4);
    expect(readArgvLog(argvLog)).toHaveLength(2);
  });

  it('fails closed when exit-zero output cannot be correlated', async () => {
    const projectRoot = path.join(dir, 'protocol-project');
    const storeRoot = path.join(dir, 'protocol-store');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(storeRoot, { recursive: true });
    const pre = [projectSpace('project-id', projectRoot), storeSpace('team', storeRoot)];
    process.env.RASEN_FAKE_STORE_ROOT = storeRoot;

    process.env.RASEN_FAKE_PROJECT_ID = 'different-project';
    const mismatchedCatalog = scriptedListings(pre, pre);
    const mismatch = await createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: mismatchedCatalog.list,
    })({ op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe('cli_protocol_error');
    expect(mismatchedCatalog.calls).toBe(1);

  });

  it('fails closed when the fresh post-read shows zero or multiple normalized member identities', async () => {
    const projectRoot = path.join(dir, 'postcondition-project');
    const storeRoot = path.join(dir, 'postcondition-store');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(storeRoot, { recursive: true });
    const pre = [projectSpace('project-id', projectRoot), storeSpace('team', storeRoot)];
    process.env.RASEN_FAKE_PROJECT_ID = 'project-id';
    process.env.RASEN_FAKE_STORE_ROOT = storeRoot;

    const absentCatalog = scriptedListings(pre, pre);
    const absent = await createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: absentCatalog.list,
    })({ op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' });
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.status).toBe(500);
      expect(absent.code).toBe('cli_protocol_error');
    }
    expect(absentCatalog.calls).toBe(2);

    const duplicated = [
      projectSpace('project-id', projectRoot),
      storeSpace('team', storeRoot, [
        { projectId: 'project-id', name: 'one' },
        { projectId: 'PROJECT-ID', name: 'duplicate' },
      ]),
    ];
    const duplicatedCatalog = scriptedListings(pre, duplicated);
    const duplicate = await createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: duplicatedCatalog.list,
    })({ op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.status).toBe(500);
      expect(duplicate.code).toBe('cli_protocol_error');
    }
    expect(duplicatedCatalog.calls).toBe(2);
  });

  it('passes membership CLI refusals through and does not perform a post-read', async () => {
    const projectRoot = path.join(dir, 'FAKEFAIL-project');
    const storeRoot = path.join(dir, 'failure-store');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(storeRoot, { recursive: true });
    const catalog = scriptedListings([
      projectSpace('project-id', projectRoot),
      storeSpace('team', storeRoot),
    ]);
    const result = await createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: catalog.list,
    })({ op: 'add-project-to-store', projectId: 'project-id', storeId: 'team' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.code).toBe('cli_error');
    expect(result.cliExitCode).toBe(1);
    expect(result.message).toContain('fake store failure');
    expect(catalog.calls).toBe(1);
  });

  it('keeps cap-one concurrency and bounded timeout', async () => {
    const slow = path.join(dir, 'FAKESLEEP5000-project');
    const storeRoot = path.join(dir, 'timeout-store');
    fs.mkdirSync(slow, { recursive: true });
    fs.mkdirSync(storeRoot, { recursive: true });
    process.env.RASEN_FAKE_PROJECT_ID = 'slow-project';
    process.env.RASEN_FAKE_STORE_ROOT = storeRoot;
    const create = createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: listingOf([
        projectSpace('slow-project', slow),
        storeSpace('team', storeRoot),
      ]),
      timeoutMs: 100,
      killGraceMs: 50,
    });
    const first = create({ op: 'add-project-to-store', projectId: 'slow-project', storeId: 'team' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await create({ op: 'create-project', path: path.join(dir, 'other') });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
    const timedOut = await first;
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.status).toBe(504);
  });
});
