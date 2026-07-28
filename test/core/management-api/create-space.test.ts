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

  it('keeps cap-one concurrency and bounded timeout', async () => {
    const slow = path.join(dir, 'FAKESLEEP5000-project');
    const create = createSpaceCreator({
      cliEntryOverride: fakeCliEntry,
      listSpacesOverride: listingOf([]),
      timeoutMs: 100,
      killGraceMs: 50,
    });
    const first = create({ op: 'create-project', path: slow });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await create({ op: 'create-project', path: slow });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
    const timedOut = await first;
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) expect(timedOut.status).toBe(504);
  });
});
