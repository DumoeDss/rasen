import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SafePathError,
  assertSafeRunPath,
  assertSafeSameParentCreate,
  createNodeSafePathPlumbing,
  type SafePathPlumbing,
  type SafePathStat,
} from '../../../src/core/change-run/internal/safe-path.js';

const dir = (extra: Partial<SafePathStat> = {}): SafePathStat => ({
  isSymbolicLink: false,
  isReparsePoint: false,
  isRegularFile: false,
  isDirectory: true,
  ...extra,
});
const file = (extra: Partial<SafePathStat> = {}): SafePathStat => ({
  isSymbolicLink: false,
  isReparsePoint: false,
  isRegularFile: true,
  isDirectory: false,
  ...extra,
});

function plumbing(opts: {
  readonly realpaths?: Readonly<Record<string, string>>;
  readonly stats?: Readonly<Record<string, SafePathStat>>;
}): SafePathPlumbing {
  return {
    realpath: (path) => opts.realpaths?.[path] ?? path,
    lstat: (path) => opts.stats?.[path] ?? null,
  };
}

const ROOT = '/home/u/.rasen/runs';

describe('SafeRunPath containment (9.3/9.4)', () => {
  it('accepts a target whose real path stays under the root', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [`${ROOT}/run-x/record.json`]: `${ROOT}/run-x/record.json` },
      stats: {
        [ROOT]: dir(),
        [`${ROOT}/run-x`]: dir(),
        [`${ROOT}/run-x/record.json`]: file(),
      },
    });
    expect(() => assertSafeRunPath(ROOT, `${ROOT}/run-x/record.json`, p)).not.toThrow();
  });

  it('rejects a target whose realpath escapes the root', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [`${ROOT}/escape`]: '/etc/passwd' },
      stats: { [ROOT]: dir(), [`${ROOT}/escape`]: file() },
    });
    expect(() => assertSafeRunPath(ROOT, `${ROOT}/escape`, p)).toThrowError(SafePathError);
  });

  it('rejects a symlink component inside the root', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [`${ROOT}/link`]: `${ROOT}/link` },
      stats: { [ROOT]: dir(), [`${ROOT}/link`]: dir({ isSymbolicLink: true }) },
    });
    expect(() => assertSafeRunPath(ROOT, `${ROOT}/link`, p)).toThrowError(SafePathError);
  });

  it('rejects a reparse-point (junction) component', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [`${ROOT}/junction`]: `${ROOT}/junction` },
      stats: { [ROOT]: dir(), [`${ROOT}/junction`]: dir({ isReparsePoint: true }) },
    });
    expect(() => assertSafeRunPath(ROOT, `${ROOT}/junction`, p)).toThrowError(SafePathError);
  });

  // One directory, two names: the root as the CLI canonicalized it, and the
  // spelling a caller's shell handed them. The alias sits ABOVE the root, as
  // it does on macOS (`/var` for `/private/var`) and on Windows (8.3 names).
  const ALIAS = '/alias/runs';

  it('accepts a target spelled through an alias of the root', () => {
    const p = plumbing({
      realpaths: {
        [ROOT]: ROOT,
        [ALIAS]: ROOT,
        [`${ROOT}/run-x`]: `${ROOT}/run-x`,
        [`${ROOT}/run-x/record.json`]: `${ROOT}/run-x/record.json`,
      },
      stats: {
        [ROOT]: dir(),
        [ALIAS]: dir(),
        [`${ROOT}/run-x`]: dir(),
        [`${ROOT}/run-x/record.json`]: file(),
      },
    });
    expect(() =>
      assertSafeRunPath(ROOT, `${ALIAS}/run-x/record.json`, p)
    ).not.toThrow();
  });

  it('walks the components below an alias-spelled root, so an inner symlink is still rejected', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [ALIAS]: ROOT, [`${ROOT}/link`]: `${ROOT}/link` },
      stats: {
        [ROOT]: dir(),
        [ALIAS]: dir(),
        [`${ROOT}/link`]: dir({ isSymbolicLink: true }),
      },
    });
    expect(() => assertSafeRunPath(ROOT, `${ALIAS}/link/record.json`, p)).toThrowError(
      expect.objectContaining({ code: 'unsafe_symlink_component' })
    );
  });

  it('refuses a symlinked stand-in for the root, so an outside path cannot enter', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [ALIAS]: ROOT },
      stats: { [ROOT]: dir(), [ALIAS]: dir({ isSymbolicLink: true }) },
    });
    expect(() => assertSafeRunPath(ROOT, `${ALIAS}/record.json`, p)).toThrowError(
      expect.objectContaining({ code: 'unsafe_path_escape' })
    );
  });

  it('refuses a reparse-point stand-in for the root', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [ALIAS]: ROOT },
      stats: { [ROOT]: dir(), [ALIAS]: dir({ isReparsePoint: true }) },
    });
    expect(() => assertSafeRunPath(ROOT, `${ALIAS}/record.json`, p)).toThrowError(
      expect.objectContaining({ code: 'unsafe_path_escape' })
    );
  });

  it('refuses an ancestor that resolves somewhere other than the root', () => {
    const p = plumbing({
      realpaths: { [ROOT]: ROOT, [ALIAS]: '/elsewhere/runs' },
      stats: { [ROOT]: dir(), [ALIAS]: dir() },
    });
    expect(() => assertSafeRunPath(ROOT, `${ALIAS}/record.json`, p)).toThrowError(
      expect.objectContaining({ code: 'unsafe_path_escape' })
    );
  });

  it('rejects same-parent create when the name already exists, and allows a fresh name', () => {
    const occupied = plumbing({
      realpaths: { [`${ROOT}/run-x`]: `${ROOT}/run-x` },
      stats: { [`${ROOT}/run-x`]: dir(), [`${ROOT}/run-x/record.json`]: file() },
    });
    expect(() =>
      assertSafeSameParentCreate(`${ROOT}/run-x`, 'record.json', occupied)
    ).toThrowError(SafePathError);
    const fresh = plumbing({
      realpaths: { [ROOT]: ROOT },
      stats: { [ROOT]: dir() },
    });
    expect(() => assertSafeSameParentCreate(ROOT, 'run-y', fresh)).not.toThrow();
  });

  it('rejects same-parent create when the parent realpath was replaced', () => {
    const replaced = plumbing({
      realpaths: { [ROOT]: '/somewhere/else' },
      stats: {},
    });
    expect(() => assertSafeSameParentCreate(ROOT, 'run-z', replaced)).toThrowError(
      SafePathError
    );
  });
});

/**
 * Alias-spelled roots on a real filesystem. An operating system may hand out
 * two names for one directory ABOVE the safe root — macOS spells
 * `/private/var` as `/var`, Windows hands out 8.3 names like `RUNNER~1` — so
 * the CLI-canonicalized root and a caller-supplied absolute path can denote
 * the same directory in different words. Containment is about the directory,
 * not the spelling; escaping is still about the physical walk BELOW the root,
 * which these cases must not relax.
 */
describe('SafeRunPath alias-spelled roots (real filesystem)', () => {
  let base: string;
  let physicalRoot: string;

  beforeEach(() => {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'rasen-safe-path-alias-')));
    physicalRoot = join(base, 'physical', 'change', 'ephemera');
    mkdirSync(physicalRoot, { recursive: true });
    writeFileSync(join(physicalRoot, 'turn-input.json'), '{}\n', 'utf8');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('accepts a target reached through an alias of an ancestor ABOVE the root', () => {
    symlinkSync(join(base, 'physical'), join(base, 'alias'), 'junction');
    const aliasTarget = join(base, 'alias', 'change', 'ephemera', 'turn-input.json');
    // Same file, two spellings — this is the CI failure shape exactly.
    expect(realpathSync.native(aliasTarget)).toBe(join(physicalRoot, 'turn-input.json'));
    expect(() =>
      assertSafeRunPath(physicalRoot, aliasTarget, createNodeSafePathPlumbing())
    ).not.toThrow();
  });

  it('accepts a physically-spelled target when the ROOT arrives alias-spelled', () => {
    symlinkSync(join(base, 'physical'), join(base, 'alias'), 'junction');
    const aliasRoot = join(base, 'alias', 'change', 'ephemera');
    expect(() =>
      assertSafeRunPath(
        aliasRoot,
        join(physicalRoot, 'turn-input.json'),
        createNodeSafePathPlumbing()
      )
    ).not.toThrow();
  });

  it('still rejects an outside path that links INTO the root', () => {
    // The whole point of not resolving the target: a link that reaches the
    // root from outside must not normalize itself into containment.
    const doorway = join(base, 'doorway');
    symlinkSync(physicalRoot, doorway, 'junction');
    expect(() =>
      assertSafeRunPath(
        physicalRoot,
        join(doorway, 'turn-input.json'),
        createNodeSafePathPlumbing()
      )
    ).toThrowError(
      expect.objectContaining({ code: 'unsafe_path_escape' })
    );
  });

  it('still rejects a link INSIDE the root that escapes it', () => {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.json'), '{}\n', 'utf8');
    symlinkSync(outside, join(physicalRoot, 'escape'), 'junction');
    expect(() =>
      assertSafeRunPath(
        physicalRoot,
        join(physicalRoot, 'escape', 'secret.json'),
        createNodeSafePathPlumbing()
      )
    ).toThrowError(
      expect.objectContaining({ code: 'unsafe_symlink_component' })
    );
  });

  it('still rejects a sibling directory whose name merely extends the root', () => {
    const sibling = join(base, 'physical', 'change', 'ephemera-elsewhere');
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'turn-input.json'), '{}\n', 'utf8');
    expect(() =>
      assertSafeRunPath(
        physicalRoot,
        join(sibling, 'turn-input.json'),
        createNodeSafePathPlumbing()
      )
    ).toThrowError(
      expect.objectContaining({ code: 'unsafe_path_escape' })
    );
  });
});
