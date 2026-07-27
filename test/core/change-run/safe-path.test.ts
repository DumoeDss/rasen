import { describe, expect, it } from 'vitest';

import {
  SafePathError,
  assertSafeRunPath,
  assertSafeSameParentCreate,
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
