import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  atomicWorkspaceWriteText,
  isUnsupportedDirectoryDurabilityError,
  readAtomicWorkspaceSnapshot,
  type AtomicWorkspaceCarrierAuthority,
} from '../../../src/core/store/workspace/dependencies.js';

type OpenFile = (
  target: fs.PathLike,
  flags: string | number,
  mode?: fs.Mode
) => Promise<FileHandle>;
type LinkFile = (existingPath: fs.PathLike, newPath: fs.PathLike) => Promise<void>;
type UnlinkFile = (target: fs.PathLike) => Promise<void>;

const temporaryRoots: string[] = [];

function temporaryTarget(name = 'state.json'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workspace-atomic-'));
  temporaryRoots.push(root);
  return path.join(root, name);
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${code}`), { code });
}

function digest(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function carrierPaths(target: string, content: string) {
  const prefix = `.${path.basename(target)}.rasen-write-${digest(content)}`;
  const directory = path.dirname(target);
  return {
    intent: path.join(directory, `${prefix}.intent`),
    backup: path.join(directory, `${prefix}.backup`),
    claim: path.join(directory, `${prefix}.claim`),
  };
}

function transactionCarriers(target: string): string[] {
  const directory = path.dirname(target);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter(name => name.startsWith(`.${path.basename(target)}.rasen-write-`))
    .sort();
}

function carrierBytes(target: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    transactionCarriers(target).map(name => [
      name,
      fs.readFileSync(path.join(path.dirname(target), name), 'utf8'),
    ])
  );
}

function proxyHandle(
  handle: FileHandle,
  overrides: Partial<Pick<FileHandle, 'sync' | 'close'>>
): FileHandle {
  return new Proxy(handle, {
    get(current, property) {
      const override = overrides[property as keyof typeof overrides];
      if (override !== undefined) return override;
      const value = Reflect.get(current, property, current) as unknown;
      return typeof value === 'function' ? value.bind(current) : value;
    },
  });
}

function sameExistingPath(left: fs.PathLike, right: fs.PathLike): boolean {
  try {
    return (
      fs.realpathSync.native(String(left)) ===
      fs.realpathSync.native(String(right))
    );
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return false;
    }
    throw error;
  }
}

function failDirectorySyncOnce(directory: string, code = 'EIO'): () => boolean {
  const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
  let failed = false;
  vi.spyOn(fs.promises, 'open').mockImplementation(async (target, flags, mode) => {
    const handle = await realOpen(target, flags, mode);
    if (!sameExistingPath(target, directory)) return handle;
    return proxyHandle(handle, {
      sync: async () => {
        if (!failed) {
          failed = true;
          throw errno(code);
        }
      },
    });
  });
  return () => failed;
}

function failAfterLinkOnce(destination: string, code = 'EIO'): void {
  const realLink = fs.promises.link.bind(fs.promises) as LinkFile;
  let failed = false;
  vi.spyOn(fs.promises, 'link').mockImplementation(async (existingPath, newPath) => {
    await realLink(existingPath, newPath);
    if (!failed && path.resolve(String(newPath)) === path.resolve(destination)) {
      failed = true;
      throw errno(code);
    }
  });
}

function failAfterUnlinkOnce(target: string, code = 'EIO'): void {
  const realUnlink = fs.promises.unlink.bind(fs.promises) as UnlinkFile;
  let failed = false;
  vi.spyOn(fs.promises, 'unlink').mockImplementation(async candidate => {
    await realUnlink(candidate);
    if (!failed && path.resolve(String(candidate)) === path.resolve(target)) {
      failed = true;
      throw errno(code);
    }
  });
}

async function retainClaim(target: string, content: string): Promise<void> {
  failDirectorySyncOnce(path.dirname(target));
  await expect(atomicWorkspaceWriteText(target, content)).rejects.toMatchObject({
    code: 'EIO',
  });
  vi.restoreAllMocks();
  expect(fs.existsSync(carrierPaths(target, content).claim)).toBe(true);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('atomic workspace coordination recovery', () => {
  const previous = '{"state":"previous"}\n';
  const intended = '{"state":"intended"}\n';

  it('adopts an exact stable pre-claim intent for only the independently requested bytes', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const carriers = carrierPaths(target, intended);
    fs.writeFileSync(carriers.intent, intended);

    await atomicWorkspaceWriteText(target, intended);

    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(transactionCarriers(target)).toEqual([]);
  });

  it('retains and refuses a partial pre-claim intent', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const carriers = carrierPaths(target, intended);
    fs.writeFileSync(carriers.intent, '{"state":');
    const before = carrierBytes(target);

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });

  it.each([
    ['intent preparation', (_target: string, paths: ReturnType<typeof carrierPaths>) => {
      const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
      let failed = false;
      vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate, flags, mode) => {
        if (!failed && path.resolve(String(candidate)) === path.resolve(paths.claim)) {
          failed = true;
          throw errno('EIO');
        }
        return realOpen(candidate, flags, mode);
      });
    }],
    ['claim durability', (target: string) => failDirectorySyncOnce(path.dirname(target))],
    ['backup publication', (_target: string, paths: ReturnType<typeof carrierPaths>) =>
      failAfterLinkOnce(paths.backup)],
    ['target publication', (target: string) => failAfterLinkOnce(target)],
    ['intent cleanup', (_target: string, paths: ReturnType<typeof carrierPaths>) =>
      failAfterUnlinkOnce(paths.intent)],
    ['backup cleanup', (_target: string, paths: ReturnType<typeof carrierPaths>) =>
      failAfterUnlinkOnce(paths.backup)],
    ['claim cleanup', (_target: string, paths: ReturnType<typeof carrierPaths>) =>
      failAfterUnlinkOnce(paths.claim)],
  ] as const)(
    'resumes without duplicate carriers after interruption at %s',
    async (_checkpoint, inject) => {
      const target = temporaryTarget();
      fs.writeFileSync(target, previous);
      const paths = carrierPaths(target, intended);
      inject(target, paths);

      await expect(atomicWorkspaceWriteText(target, intended)).rejects.toBeDefined();
      vi.restoreAllMocks();
      await atomicWorkspaceWriteText(target, intended);

      expect(fs.readFileSync(target, 'utf8')).toBe(intended);
      expect(transactionCarriers(target)).toEqual([]);
    }
  );

  it('retains a claim when a retry asks for different bytes', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    await retainClaim(target, intended);
    const before = carrierBytes(target);

    await expect(
      atomicWorkspaceWriteText(target, '{"state":"different"}\n')
    ).rejects.toMatchObject({ code: 'workspace_atomic_write_conflict', target });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });

  it('retains every proven carrier when the target identity changed with the same bytes', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    await retainClaim(target, intended);
    fs.unlinkSync(target);
    fs.writeFileSync(target, previous);
    const before = carrierBytes(target);

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });

  it('retains a corrupt claim and its exact intent', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    await retainClaim(target, intended);
    const claimPath = carrierPaths(target, intended).claim;
    fs.writeFileSync(claimPath, '{"version":2');
    const before = carrierBytes(target);

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });

  it('refuses an exact-byte intent whose identity was replaced after the claim', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    await retainClaim(target, intended);
    const intentPath = carrierPaths(target, intended).intent;
    fs.unlinkSync(intentPath);
    fs.writeFileSync(intentPath, intended);
    const before = carrierBytes(target);

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });

  it('refuses an exact-byte backup whose identity was replaced after publication', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const paths = carrierPaths(target, intended);
    failAfterLinkOnce(paths.backup);
    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'EIO',
    });
    vi.restoreAllMocks();
    fs.unlinkSync(paths.backup);
    fs.writeFileSync(paths.backup, previous);
    const before = carrierBytes(target);

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });

  it('never falls back after journal authority mismatches a retained claim', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const snapshot = await readAtomicWorkspaceSnapshot(target);
    let authority: AtomicWorkspaceCarrierAuthority | undefined;
    await expect(
      atomicWorkspaceWriteText(target, intended, {
        ...snapshot,
        onPrepared: async prepared => {
          authority = prepared;
          throw errno('EIO');
        },
      })
    ).rejects.toMatchObject({ code: 'EIO' });
    expect(authority).toBeDefined();
    const before = carrierBytes(target);

    const exactAuthority = authority as AtomicWorkspaceCarrierAuthority;
    const changedIdentity = {
      ...exactAuthority.intent.identity,
      ino: (BigInt(exactAuthority.intent.identity.ino) + 1n).toString(10),
    };
    const mismatches: AtomicWorkspaceCarrierAuthority[] = [
      { ...exactAuthority, target: `${target}.other` },
      { ...exactAuthority, contentDigest: digest('{"state":"foreign"}\n') },
      {
        ...exactAuthority,
        directory: { ...exactAuthority.directory, path: `${exactAuthority.directory.path}.other` },
      },
      {
        ...exactAuthority,
        directory: { ...exactAuthority.directory, identity: changedIdentity },
      },
      {
        ...exactAuthority,
        intent: { ...exactAuthority.intent, path: `${exactAuthority.intent.path}.other` },
      },
      {
        ...exactAuthority,
        intent: { ...exactAuthority.intent, identity: changedIdentity },
      },
      {
        ...exactAuthority,
        claim: { ...exactAuthority.claim, path: `${exactAuthority.claim.path}.other` },
      },
      {
        ...exactAuthority,
        claim: { ...exactAuthority.claim, identity: changedIdentity },
      },
    ];
    for (const mismatch of mismatches) {
      await expect(
        atomicWorkspaceWriteText(target, intended, {
          ...snapshot,
          authority: mismatch,
        })
      ).rejects.toMatchObject({ code: 'workspace_atomic_write_conflict', target });
    }

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });

  it('records reconstructed journal authority before resuming a retained claim', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const snapshot = await readAtomicWorkspaceSnapshot(target);
    let authorityBeforeCrash: AtomicWorkspaceCarrierAuthority | undefined;
    await expect(
      atomicWorkspaceWriteText(target, intended, {
        ...snapshot,
        onPrepared: async prepared => {
          authorityBeforeCrash = prepared;
          throw errno('EIO');
        },
      })
    ).rejects.toMatchObject({ code: 'EIO' });
    expect(authorityBeforeCrash).toBeDefined();

    const mutations: string[] = [];
    const realLink = fs.promises.link.bind(fs.promises) as LinkFile;
    const realUnlink = fs.promises.unlink.bind(fs.promises) as UnlinkFile;
    vi.spyOn(fs.promises, 'link').mockImplementation(async (existingPath, newPath) => {
      mutations.push(`link:${String(newPath)}`);
      await realLink(existingPath, newPath);
    });
    vi.spyOn(fs.promises, 'unlink').mockImplementation(async candidate => {
      mutations.push(`unlink:${String(candidate)}`);
      await realUnlink(candidate);
    });
    let reconstructed: AtomicWorkspaceCarrierAuthority | undefined;

    await atomicWorkspaceWriteText(target, intended, {
      ...snapshot,
      onPrepared: async prepared => {
        mutations.push('prepared');
        reconstructed = prepared;
      },
    });

    expect(mutations[0]).toBe('prepared');
    expect(reconstructed).toEqual(authorityBeforeCrash);
    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(transactionCarriers(target)).toEqual([]);
  });

  it('fails closed when a journal-bound exact-content write has no carrier authority', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, intended);
    const snapshot = await readAtomicWorkspaceSnapshot(target);
    const onPrepared = vi.fn<
      (authority: AtomicWorkspaceCarrierAuthority) => Promise<void>
    >();

    await expect(
      atomicWorkspaceWriteText(target, intended, {
        ...snapshot,
        onPrepared,
      })
    ).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(onPrepared).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(transactionCarriers(target)).toEqual([]);
  });

  it('keeps canonical alias directories equivalent without weakening exact target authority', async context => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workspace-alias-'));
    temporaryRoots.push(root);
    const physicalDirectory = path.join(root, 'physical');
    const aliasDirectory = path.join(root, 'alias');
    fs.mkdirSync(physicalDirectory);
    try {
      fs.symlinkSync(
        physicalDirectory,
        aliasDirectory,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    } catch (error) {
      if (
        ['EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(
          (error as NodeJS.ErrnoException).code ?? ''
        )
      ) {
        context.skip();
        return;
      }
      throw error;
    }
    const aliasTarget = path.join(aliasDirectory, 'state.json');
    const physicalTarget = path.join(physicalDirectory, 'state.json');
    fs.writeFileSync(physicalTarget, previous);
    expect(fs.realpathSync.native(aliasDirectory)).toBe(
      fs.realpathSync.native(physicalDirectory)
    );
    expect(fs.realpathSync.native(aliasTarget)).toBe(
      fs.realpathSync.native(physicalTarget)
    );

    const aliasSnapshot = await readAtomicWorkspaceSnapshot(aliasTarget);
    let authority: AtomicWorkspaceCarrierAuthority | undefined;
    await expect(
      atomicWorkspaceWriteText(aliasTarget, intended, {
        ...aliasSnapshot,
        onPrepared: async prepared => {
          authority = prepared;
          throw errno('EIO');
        },
      })
    ).rejects.toMatchObject({ code: 'EIO' });
    const recorded = authority as AtomicWorkspaceCarrierAuthority;
    expect(fs.realpathSync.native(recorded.directory.path)).toBe(
      fs.realpathSync.native(physicalDirectory)
    );
    expect(recorded.target).toBe(aliasTarget);
    expect(recorded.target).not.toBe(physicalTarget);
    const retainedBeforeRefusal = carrierBytes(physicalTarget);

    await expect(
      atomicWorkspaceWriteText(
        physicalTarget,
        intended,
        {
          ...(await readAtomicWorkspaceSnapshot(physicalTarget)),
          authority: recorded,
        }
      )
    ).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target: physicalTarget,
    });

    expect(carrierBytes(physicalTarget)).toEqual(retainedBeforeRefusal);
    expect(fs.readFileSync(physicalTarget, 'utf8')).toBe(previous);

    await atomicWorkspaceWriteText(aliasTarget, intended, {
      ...aliasSnapshot,
      authority: recorded,
    });
    expect(fs.readFileSync(physicalTarget, 'utf8')).toBe(intended);
    expect(transactionCarriers(physicalTarget)).toEqual([]);
  });

  it('detects an unjournaled claim replaced after stable observation', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    await retainClaim(target, intended);
    const claimPath = carrierPaths(target, intended).claim;
    const directory = path.dirname(target);
    const realRealpath = fs.promises.realpath.bind(fs.promises);
    let directoryObservations = 0;
    vi.spyOn(fs.promises, 'realpath').mockImplementation(async candidate => {
      const canonical = await realRealpath(candidate);
      if (path.resolve(String(candidate)) === path.resolve(directory)) {
        directoryObservations += 1;
        if (directoryObservations === 2) {
          const claim = fs.readFileSync(claimPath, 'utf8');
          fs.unlinkSync(claimPath);
          fs.writeFileSync(claimPath, claim);
        }
      }
      return canonical;
    });

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(fs.existsSync(claimPath)).toBe(true);
  });

  it('revalidates the claim immediately before its own unlink', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const paths = carrierPaths(target, intended);
    const realUnlink = fs.promises.unlink.bind(fs.promises) as UnlinkFile;
    let replaced = false;
    vi.spyOn(fs.promises, 'unlink').mockImplementation(async candidate => {
      await realUnlink(candidate);
      if (!replaced && path.resolve(String(candidate)) === path.resolve(paths.backup)) {
        replaced = true;
        const claim = fs.readFileSync(paths.claim, 'utf8');
        fs.unlinkSync(paths.claim);
        fs.writeFileSync(paths.claim, claim);
      }
    });

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(fs.existsSync(paths.claim)).toBe(true);
  });

  it('revalidates equal-size backup bytes immediately before unlink', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const paths = carrierPaths(target, intended);
    const changed = previous.replace('previous', 'mutated!');
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(previous));
    const realLstat = fs.promises.lstat.bind(fs.promises);
    let cleanupBackupObservations = 0;
    let mutated = false;
    vi.spyOn(fs.promises, 'lstat').mockImplementation(
      (async (candidate, options) => {
        const stat = await realLstat(candidate, { bigint: true });
        if (
          !mutated &&
          path.resolve(String(candidate)) === path.resolve(paths.backup) &&
          !fs.existsSync(paths.intent)
        ) {
          cleanupBackupObservations += 1;
          if (cleanupBackupObservations === 2) {
            fs.writeFileSync(paths.backup, changed);
            mutated = true;
          }
        }
        return stat;
      }) as typeof fs.promises.lstat
    );

    await expect(atomicWorkspaceWriteText(target, intended)).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });

    expect(mutated).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(intended);
    expect(fs.readFileSync(paths.backup, 'utf8')).toBe(changed);
    expect(fs.existsSync(paths.claim)).toBe(true);
  });

  it('detects claim replacement against journal-bound identity authority', async () => {
    const target = temporaryTarget();
    fs.writeFileSync(target, previous);
    const snapshot = await readAtomicWorkspaceSnapshot(target);
    let authority: AtomicWorkspaceCarrierAuthority | undefined;
    await expect(
      atomicWorkspaceWriteText(target, intended, {
        ...snapshot,
        onPrepared: async prepared => {
          authority = prepared;
          throw errno('EIO');
        },
      })
    ).rejects.toMatchObject({ code: 'EIO' });
    const claimPath = carrierPaths(target, intended).claim;
    const claim = fs.readFileSync(claimPath, 'utf8');
    fs.unlinkSync(claimPath);
    fs.writeFileSync(claimPath, claim);
    const before = carrierBytes(target);

    await expect(
      atomicWorkspaceWriteText(target, intended, {
        ...snapshot,
        authority: authority as AtomicWorkspaceCarrierAuthority,
      })
    ).rejects.toMatchObject({ code: 'workspace_atomic_write_conflict', target });

    expect(fs.readFileSync(target, 'utf8')).toBe(previous);
    expect(carrierBytes(target)).toEqual(before);
  });
});

describe('atomic workspace exact identities', () => {
  it('captures distinct BigInt NTFS identities without Number rounding', async () => {
    const first = temporaryTarget('first.json');
    const second = path.join(path.dirname(first), 'second.json');
    fs.writeFileSync(first, '{}\n');
    fs.writeFileSync(second, '{}\n');
    const realLstat = fs.promises.lstat.bind(fs.promises);
    const identities = new Map([
      [path.resolve(first), 9_007_199_254_740_992n],
      [path.resolve(second), 9_007_199_254_740_993n],
    ]);
    vi.spyOn(fs.promises, 'lstat').mockImplementation(
      (async (target, options) => {
        expect(options).toEqual({ bigint: true });
        const stat = await realLstat(target, { bigint: true });
        const ino = identities.get(path.resolve(String(target)));
        return ino === undefined
          ? stat
          : new Proxy(stat, {
              get(current, property) {
                if (property === 'dev') return 9_007_199_254_740_992n;
                if (property === 'ino') return ino;
                return Reflect.get(current, property, current) as unknown;
              },
            });
      }) as typeof fs.promises.lstat
    );

    const firstIdentity = (await readAtomicWorkspaceSnapshot(first)).identity;
    const secondIdentity = (await readAtomicWorkspaceSnapshot(second)).identity;

    expect(Number(BigInt(firstIdentity?.ino ?? '0'))).toBe(
      Number(BigInt(secondIdentity?.ino ?? '1'))
    );
    expect(firstIdentity).toMatchObject({
      dev: '9007199254740992',
      ino: '9007199254740992',
    });
    expect(secondIdentity).toMatchObject({
      dev: '9007199254740992',
      ino: '9007199254740993',
    });
    expect(firstIdentity).not.toEqual(secondIdentity);
  });
});

describe('directory durability fault policy', () => {
  it.each([
    ['win32', 'open', 'EISDIR'],
    ['win32', 'sync', 'EINVAL'],
    ['win32', 'sync', 'EPERM'],
    ['win32', 'sync', 'ENOTSUP'],
    ['linux', 'sync', 'EINVAL'],
    ['linux', 'sync', 'ENOTSUP'],
    ['darwin', 'sync', 'EINVAL'],
    ['darwin', 'sync', 'ENOTSUP'],
  ] as const)('classifies only named %s/%s/%s tuples', (platform, stage, code) => {
    expect(isUnsupportedDirectoryDurabilityError(platform, stage, errno(code))).toBe(true);
  });

  it.each([
    ['win32', 'open', 'EACCES'],
    ['win32', 'open', 'EPERM'],
    ['win32', 'sync', 'EIO'],
    ['win32', 'sync', 'ENOSPC'],
    ['win32', 'sync', 'EBADF'],
    ['linux', 'open', 'EISDIR'],
    ['linux', 'sync', 'EPERM'],
    ['freebsd', 'sync', 'ENOTSUP'],
    ['win32', 'sync', 'UNKNOWN'],
  ] as const)('fails closed for unlisted %s/%s/%s tuples', (platform, stage, code) => {
    expect(isUnsupportedDirectoryDurabilityError(platform, stage, errno(code))).toBe(false);
  });

  it('tolerates a named directory-open fault on Windows and completes cleanup', async () => {
    const target = temporaryTarget();
    const directory = path.dirname(target);
    const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
    const platformMock = vi
      .spyOn(process, 'platform', 'get')
      .mockReturnValue('win32');
    const openMock = vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate, flags, mode) => {
      if (sameExistingPath(candidate, directory)) throw errno('EISDIR');
      return realOpen(candidate, flags, mode);
    });

    try {
      await atomicWorkspaceWriteText(target, '{}\n');

      expect(fs.readFileSync(target, 'utf8')).toBe('{}\n');
      expect(transactionCarriers(target)).toEqual([]);
    } finally {
      openMock.mockRestore();
      platformMock.mockRestore();
    }
  });

  it.each(['linux', 'darwin'] as const)(
    'propagates directory-open EISDIR on %s',
    async platform => {
      const target = temporaryTarget();
      const directory = path.dirname(target);
      const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
      const platformMock = vi
        .spyOn(process, 'platform', 'get')
        .mockReturnValue(platform);
      const openMock = vi
        .spyOn(fs.promises, 'open')
        .mockImplementation(async (candidate, flags, mode) => {
          if (sameExistingPath(candidate, directory)) throw errno('EISDIR');
          return realOpen(candidate, flags, mode);
        });

      try {
        await expect(atomicWorkspaceWriteText(target, '{}\n')).rejects.toMatchObject({
          code: 'EISDIR',
        });
        expect(fs.existsSync(carrierPaths(target, '{}\n').claim)).toBe(true);
        expect(fs.existsSync(target)).toBe(false);
      } finally {
        openMock.mockRestore();
        platformMock.mockRestore();
      }
    }
  );

  it.each([
    ['win32', 'EPERM'],
    ['linux', 'EINVAL'],
    ['linux', 'ENOTSUP'],
    ['darwin', 'EINVAL'],
    ['darwin', 'ENOTSUP'],
  ] as const)(
    'tolerates writer-level %s directory-sync/%s and completes cleanup',
    async (platform, code) => {
      const target = temporaryTarget();
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
      const wasTriggered = failDirectorySyncOnce(path.dirname(target), code);

      await atomicWorkspaceWriteText(target, '{}\n');

      expect(wasTriggered()).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toBe('{}\n');
      expect(transactionCarriers(target)).toEqual([]);
    }
  );

  it('keeps EACCES visible at directory open and leaves a resumable claim', async () => {
    const target = temporaryTarget();
    const directory = path.dirname(target);
    const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate, flags, mode) => {
      if (sameExistingPath(candidate, directory)) throw errno('EACCES');
      return realOpen(candidate, flags, mode);
    });

    await expect(atomicWorkspaceWriteText(target, '{}\n')).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(fs.existsSync(carrierPaths(target, '{}\n').claim)).toBe(true);
    vi.restoreAllMocks();
    await atomicWorkspaceWriteText(target, '{}\n');
    expect(transactionCarriers(target)).toEqual([]);
  });

  it('never treats file sync as directory portability', async () => {
    const target = temporaryTarget();
    const intentPath = carrierPaths(target, '{}\n').intent;
    const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate, flags, mode) => {
      const handle = await realOpen(candidate, flags, mode);
      if (path.resolve(String(candidate)) !== path.resolve(intentPath)) return handle;
      return proxyHandle(handle, {
        sync: async () => {
          throw errno('EPERM');
        },
      });
    });

    await expect(atomicWorkspaceWriteText(target, '{}\n')).rejects.toMatchObject({
      code: 'EPERM',
    });
    expect(fs.existsSync(intentPath)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    vi.restoreAllMocks();
    await atomicWorkspaceWriteText(target, '{}\n');
    expect(transactionCarriers(target)).toEqual([]);
  });

  it('never hides a directory-handle close failure', async () => {
    const target = temporaryTarget();
    const directory = path.dirname(target);
    const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
    let failed = false;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate, flags, mode) => {
      const handle = await realOpen(candidate, flags, mode);
      if (!sameExistingPath(candidate, directory) || failed) return handle;
      failed = true;
      return proxyHandle(handle, {
        close: async () => {
          await handle.close();
          throw errno('EBADF');
        },
      });
    });

    await expect(atomicWorkspaceWriteText(target, '{}\n')).rejects.toMatchObject({
      code: 'EBADF',
    });
    expect(fs.existsSync(carrierPaths(target, '{}\n').claim)).toBe(true);
    vi.restoreAllMocks();
    await atomicWorkspaceWriteText(target, '{}\n');
    expect(transactionCarriers(target)).toEqual([]);
  });

  it('lets ancestry conflict win over an otherwise tolerated open fault', async () => {
    const target = temporaryTarget();
    const directory = path.dirname(target);
    const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
    const realRealpath = fs.promises.realpath.bind(fs.promises);
    let toleratedFault = false;
    vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate, flags, mode) => {
      if (sameExistingPath(candidate, directory)) {
        toleratedFault = true;
        throw errno('EISDIR');
      }
      return realOpen(candidate, flags, mode);
    });
    vi.spyOn(fs.promises, 'realpath').mockImplementation(async candidate => {
      const canonical = await realRealpath(candidate);
      return toleratedFault && sameExistingPath(candidate, directory)
        ? `${canonical}-replaced`
        : canonical;
    });

    await expect(atomicWorkspaceWriteText(target, '{}\n')).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });
    expect(fs.existsSync(carrierPaths(target, '{}\n').claim)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('lets ancestry conflict win after an otherwise tolerated sync fault', async () => {
    const target = temporaryTarget();
    const directory = path.dirname(target);
    const realOpen = fs.promises.open.bind(fs.promises) as OpenFile;
    const realRealpath = fs.promises.realpath.bind(fs.promises);
    let toleratedFault = false;
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(fs.promises, 'open').mockImplementation(async (candidate, flags, mode) => {
      const handle = await realOpen(candidate, flags, mode);
      if (!sameExistingPath(candidate, directory)) return handle;
      return proxyHandle(handle, {
        sync: async () => {
          toleratedFault = true;
          throw errno('EPERM');
        },
      });
    });
    vi.spyOn(fs.promises, 'realpath').mockImplementation(async candidate => {
      const canonical = await realRealpath(candidate);
      return toleratedFault && sameExistingPath(candidate, directory)
        ? `${canonical}-replaced`
        : canonical;
    });

    await expect(atomicWorkspaceWriteText(target, '{}\n')).rejects.toMatchObject({
      code: 'workspace_atomic_write_conflict',
      target,
    });
    expect(toleratedFault).toBe(true);
    expect(fs.existsSync(carrierPaths(target, '{}\n').claim)).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });
});
