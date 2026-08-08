/**
 * `store-finalization-outcomes-v2` task 13.2 — Archive v2 destination
 * construction under `path.win32` and `path.posix`.
 *
 * `archiveEntryAddress` takes an explicit flavor, so a Windows destination can
 * be constructed and checked on a POSIX host and vice versa. That matters for
 * the cases a real filesystem cannot express on demand: a mixed-case drive
 * letter, a case-folded collision on a case-insensitive volume, a reserved
 * Windows device name, and a path long enough to cross the classic MAX_PATH
 * budget.
 *
 * The Chinese-alias case has a finding attached, and it is a refusal rather
 * than a success: a Change alias is a portable kebab id, so `结算规则` never
 * becomes an entry name. The address boundary refuses it BEFORE returning a
 * path, which is the behavior worth pinning — an entry name that differs by
 * normalization form across two machines would make the address unstable.
 */
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  changeInstanceDigestPrefix,
  deriveChangeInstanceId,
  derivePlanningScopeId,
  type VerifiedChangeInstanceId,
} from '../../../src/core/store/planning-identity.js';
import { archiveEntryAddress } from '../../../src/core/store/finalization/index.js';
import type { StorePlanningPathFlavor } from '../../../src/core/store/planning-layout-v2.js';

const STORE_UID = '6f7d4d70-3d2c-4a37-9f8a-0f4c1b2e3d55';
const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';
const DATE = '2026-08-07';
const CHINESE = '结算规则';

const scopeId = derivePlanningScopeId({
  storeUid: STORE_UID,
  projectId: PROJECT,
  targetLineId: LINE,
});
const INSTANCE = deriveChangeInstanceId({
  planningScopeId: scopeId,
  instanceSeed: 'a'.repeat(32),
}) as VerifiedChangeInstanceId;
const SECOND_INSTANCE = deriveChangeInstanceId({
  planningScopeId: scopeId,
  instanceSeed: 'b'.repeat(32),
}) as VerifiedChangeInstanceId;

function addressAt(
  storeRoot: string,
  flavor: StorePlanningPathFlavor,
  overrides: Record<string, unknown> = {}
): string {
  return archiveEntryAddress({
    storeRoot,
    projectId: PROJECT,
    frozenTargetLineId: LINE,
    changeId: CHANGE,
    archiveDate: DATE,
    changeInstanceId: INSTANCE,
    flavor,
    ...overrides,
  } as Parameters<typeof archiveEntryAddress>[0]);
}

describe('both path flavors, from one contract', () => {
  it('builds the entry with the separators of the requested flavor', () => {
    const suffix = changeInstanceDigestPrefix(INSTANCE);
    const win = addressAt('C:\\stores\\team', 'win32');
    const posix = addressAt('/stores/team', 'posix');

    expect(win).toBe(
      `C:\\stores\\team\\rasen\\projects\\${PROJECT}\\changes\\archive\\${LINE}\\${DATE}-${CHANGE}--${suffix}`
    );
    expect(posix).toBe(
      `/stores/team/rasen/projects/${PROJECT}/changes/archive/${LINE}/${DATE}-${CHANGE}--${suffix}`
    );
    // Each flavor uses only its own separator, whatever host is running.
    expect(win).not.toContain('/');
    expect(posix).not.toContain('\\');
  });

  it('always lands inside the archive-line directory it belongs to, on both flavors', () => {
    for (const [root, flavor, api] of [
      ['C:\\stores\\team', 'win32', path.win32],
      ['/stores/team', 'posix', path.posix],
    ] as const) {
      const entry = addressAt(root, flavor);
      const line = api.join(
        root,
        'rasen',
        'projects',
        PROJECT,
        'changes',
        'archive',
        LINE
      );
      expect(api.dirname(entry)).toBe(line);
      expect(api.relative(line, entry).includes('..')).toBe(false);
    }
  });

  it('keeps a mixed-case drive letter exactly as the Store root spelled it', () => {
    for (const root of ['c:\\Stores\\Team', 'C:\\Stores\\Team']) {
      expect(addressAt(root, 'win32').startsWith(`${root}\\rasen\\`)).toBe(true);
    }
  });

  it('rejects a relative or wrong-flavor Store root rather than resolving against cwd', () => {
    // The reason is pinned, because the reason IS the claim: resolution must
    // never depend on `cwd`. A bare `.toThrow()` would be satisfied by any
    // error, including one raised for an entirely different field.
    const cwdIndependent = /storeRoot: must be an absolute posix path so resolution never depends on cwd/u;
    expect(() => addressAt('stores/team', 'posix')).toThrow(cwdIndependent);
    expect(() => addressAt('C:\\stores\\team', 'posix')).toThrow(cwdIndependent);
  });
});

describe('case folding and collisions on a case-insensitive volume', () => {
  it('gives two Change instances entry names that differ in more than case', () => {
    const first = path.win32.basename(addressAt('C:\\stores\\team', 'win32'));
    const second = path.win32.basename(
      addressAt('C:\\stores\\team', 'win32', { changeInstanceId: SECOND_INSTANCE })
    );

    expect(first).not.toBe(second);
    // The suffix is a lowercase hex digest prefix, so case folding cannot
    // collapse two distinct instances onto one directory name.
    expect(first.toLowerCase()).not.toBe(second.toLowerCase());
    expect(first).toBe(first.toLowerCase());
    expect(second).toBe(second.toLowerCase());
  });

  it('produces an entry name that is already case-folded, so a retry cannot alias', () => {
    const name = path.posix.basename(addressAt('/stores/team', 'posix'));
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+--[0-9a-f]{12}$/u);
  });
});

describe('names a Windows filesystem cannot hold', () => {
  it.each(['con', 'nul', 'aux', 'com1'])(
    'refuses the reserved device name %s as a Change alias',
    reserved => {
      expect(() => addressAt('C:\\stores\\team', 'win32', { changeId: reserved })).toThrow(
        /reserved as a Windows device name/u
      );
    }
  );

  it('refuses a target line that is not a portable segment, each for its OWN reason', () => {
    // Paired with the reason rather than looped through a bare `.toThrow()`.
    // That form could not distinguish four independent checks from one blanket
    // rejection — and "traversal", "separator" and "trailing dot" are genuinely
    // three different Windows hazards, so collapsing them would hide the loss
    // of two of them.
    const cases: ReadonlyArray<readonly [string, RegExp]> = [
      ['..', /targetLineId: must not be a traversal segment/u],
      ['line/0.2', /targetLineId: must not contain path separators/u],
      ['line\\0.2', /targetLineId: must not contain path separators/u],
      ['line-0.2.', /targetLineId: must not end with a dot or space/u],
    ];
    for (const [line, reason] of cases) {
      expect(() =>
        addressAt('C:\\stores\\team', 'win32', { frozenTargetLineId: line })
      ).toThrow(reason);
    }
  });

  it(`refuses a non-ASCII Change alias (${CHINESE}) before returning any path`, () => {
    // The finding, stated rather than worked around: a Change alias is a
    // portable kebab id, so a Chinese alias never becomes an entry name. A
    // Store whose Change is titled in Chinese carries that title in its
    // proposal, not in its directory name — an entry name that differed by
    // Unicode normalization form between two machines would make the address
    // itself unstable.
    expect(() => addressAt('/stores/team', 'posix', { changeId: CHINESE })).toThrow(
      /canonical lowercase kebab id/u
    );
    // The MIXED alias refuses for the same stated reason as the pure one, which
    // is the part worth pinning: a partly-ASCII alias is not a partial pass.
    expect(() =>
      addressAt('/stores/team', 'posix', { changeId: `${CHANGE}-${CHINESE}` })
    ).toThrow(/canonical lowercase kebab id/u);
  });

  it('carries a Chinese Store ROOT through unchanged, because the root is the user’s', () => {
    const root = `/stores/${CHINESE}`;
    const entry = addressAt(root, 'posix');
    expect(entry.startsWith(`${root}/rasen/`)).toBe(true);
    expect(entry.normalize('NFC')).toBe(entry);
  });
});

describe('long paths', () => {
  it('composes a destination past the classic MAX_PATH budget without truncating', () => {
    const deep = `C:\\${Array.from({ length: 12 }, (_, index) => `segment-${index}-${'x'.repeat(18)}`).join('\\')}`;
    const entry = addressAt(deep, 'win32');

    expect(entry.length).toBeGreaterThan(260);
    expect(entry.startsWith(`${deep}\\rasen\\`)).toBe(true);
    // Nothing is shortened, hashed, or elided to fit: the address is the
    // address, and a filesystem that cannot hold it fails at write time with
    // its own error rather than being silently renamed here.
    expect(path.win32.basename(entry)).toBe(
      `${DATE}-${CHANGE}--${changeInstanceDigestPrefix(INSTANCE)}`
    );
  });
});
