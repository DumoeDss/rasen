/**
 * Task 11.2 — destination construction under `path.win32` and `path.posix`.
 *
 * Migration computes every destination through the Foundation layout contract,
 * and the contract takes an explicit path flavor so a Windows destination can
 * be constructed and checked on a POSIX host and vice versa. Half of these
 * cases pin the contract directly — mixed-case drive letters, Windows reserved
 * device names, containment, and case folding, none of which a case-insensitive
 * filesystem can express in real files. The other half run the real planner and
 * `apply` over the path shapes that historically break: a Store root with
 * non-ASCII (Chinese) segments, a Store root long enough to cross the classic
 * MAX_PATH budget, and a capability id that is not a portable segment at all.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveStorePlanningLayoutV2Path,
  type StorePlanningPathFlavor,
} from '../../../src/core/store/planning-layout-v2.js';
import {
  migrationItemStateLabel,
  type ImmutableMigrationPlan,
} from '../../../src/core/store/layout-migration/types.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

const LINE = 'line-0.2';
const MAPPING = 'rasen/mapping.yaml';
const CHINESE = '结算规则';
/** The flavor this host's absolute paths are actually spelled in. */
const NATIVE_FLAVOR: StorePlanningPathFlavor = path.sep === path.win32.sep ? 'win32' : 'posix';
const FOREIGN_FLAVOR: StorePlanningPathFlavor = NATIVE_FLAVOR === 'win32' ? 'posix' : 'win32';

function fsExists(target: string): boolean {
  return nodeFs.existsSync(target);
}

describe('store layout v2 migration — Windows and POSIX destination construction', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-paths-');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('builds a partition address with the separators of the requested flavor', () => {
    const win = resolveStorePlanningLayoutV2Path(
      'C:\\stores\\team',
      { kind: 'active-change', projectId: 'elftia', changeId: 'fix-a' },
      'win32'
    );
    const posix = resolveStorePlanningLayoutV2Path(
      '/stores/team',
      { kind: 'active-change', projectId: 'elftia', changeId: 'fix-a' },
      'posix'
    );

    expect(win).toBe('C:\\stores\\team\\rasen\\projects\\elftia\\changes\\fix-a');
    expect(posix).toBe('/stores/team/rasen/projects/elftia/changes/fix-a');
    // Each flavor uses only its own separator, whatever host is running.
    expect(win).not.toContain('/');
    expect(posix).not.toContain('\\');
  });

  it('keeps a mixed-case drive letter exactly as the Store root spelled it', () => {
    for (const root of ['c:\\Stores\\Team', 'C:\\Stores\\Team']) {
      expect(
        resolveStorePlanningLayoutV2Path(root, { kind: 'project-specs', projectId: 'elftia' }, 'win32')
      ).toBe(`${root}\\rasen\\projects\\elftia\\specs`);
    }
  });

  it('rejects a relative or wrong-flavor Store root rather than resolving against cwd', () => {
    expect(() =>
      resolveStorePlanningLayoutV2Path('stores/team', { kind: 'store-metadata' }, 'posix')
    ).toThrow();
    // Neither explicit flavor accepts a root spelled for the other one.
    expect(() =>
      resolveStorePlanningLayoutV2Path('C:\\stores\\team', { kind: 'store-metadata' }, 'posix')
    ).toThrow();
    expect(() =>
      resolveStorePlanningLayoutV2Path('/stores/team', { kind: 'store-metadata' }, 'win32')
    ).toThrow();
  });

  async function planWithFlavor(flavor: StorePlanningPathFlavor): Promise<ImmutableMigrationPlan> {
    return f.migration().plan(f.input({ mappingPath: MAPPING, pathFlavor: flavor }));
  }

  it('relocates a non-ASCII capability name verbatim', async () => {
    // A capability directory name is NOT one of layout v2's portable ids —
    // only project, target-line, and Change ids are — so a Chinese capability
    // moves across unchanged rather than being refused or transliterated.
    await f.member('elftia', { specs: [CHINESE], changes: [] });
    f.writeSpec(CHINESE, `# ${CHINESE}\n`);
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await planWithFlavor(NATIVE_FLAVOR);
    const spec = plan.items.find((item) => item.kind === 'spec');
    expect(migrationItemStateLabel(spec!.state)).toBe('resolved');
    expect(spec?.name).toBe(CHINESE);
    // The Store-relative destination is POSIX whatever the host, and the name
    // survives byte-for-byte.
    expect(spec?.destinationRelative).toBe(`rasen/projects/elftia/specs/${CHINESE}`);
    expect((spec?.destination as string).endsWith(CHINESE)).toBe(true);
  });

  it('resolves no destination when the requested flavor disagrees with the Store root spelling', async () => {
    // A Store root is spelled in the host's flavor, so planning it as the other
    // one cannot produce a real path. It fails closed — every item unresolved
    // and the plan inapplicable — rather than emitting a path nothing can open.
    await f.member('elftia', { specs: ['billing'], changes: [] });
    f.writeSpec('billing');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await planWithFlavor(FOREIGN_FLAVOR);

    expect(plan.applicable).toBe(false);
    // Nothing that has to MOVE got a destination. (Retained design docs keep
    // their own path as their destination and are not addressed through the
    // layout at all, so they are not part of this claim.)
    expect(
      plan.items
        .filter((item) => item.kind === 'spec' || item.kind === 'change' || item.kind === 'archive-entry')
        .every((item) => item.destination === undefined)
    ).toBe(true);
  });

  it('refuses a Change id that is not a portable segment instead of sanitizing it', async () => {
    // A Change id DOES become a partition directory addressed through the
    // portable contract, so one the contract rejects must stop the migration —
    // `plan.ts` says so in as many words: migration never sanitizes an id.
    await f.member('elftia', { specs: [], changes: ['Fix A'] });
    f.writeChange('Fix A');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await planWithFlavor(NATIVE_FLAVOR);
    const change = plan.items.find((item) => item.kind === 'change');
    expect(migrationItemStateLabel(change!.state)).toBe('unresolved:unrecordable-identity');
    expect(change?.name).toBe('Fix A');
    expect(change?.destination).toBeUndefined();
    expect(change?.repair).toContain('never sanitizes');
    expect(plan.applicable).toBe(false);
  });

  it('plans and applies a Store whose own path is non-ASCII', async () => {
    f.cleanup();
    f = await createLayoutMigrationFixture('rasen-结算规则-');
    expect(f.storeRoot).toContain(CHINESE);

    await f.member('elftia', { specs: ['billing'], changes: ['fix-a'] });
    f.writeSpec('billing');
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    expect(plan.applicable).toBe(true);
    await f.migration().apply(plan.token!);

    expect(
      fsExists(f.at('rasen', 'projects', 'elftia', 'specs', 'billing', 'spec.md'))
    ).toBe(true);
    expect(
      fsExists(f.at('rasen', 'projects', 'elftia', 'changes', 'fix-a', 'proposal.md'))
    ).toBe(true);
  });

  it('plans and applies a Store whose path is long enough to cross the classic MAX_PATH budget', async () => {
    f.cleanup();
    // Keep mkdtemp's own path short: Windows rejects an over-budget mkdtemp
    // prefix before the fixture can exercise the Store migration. A nested
    // component pushes the Store and its partition destination past MAX_PATH.
    f = await createLayoutMigrationFixture('rasen-layout-long-', {
      storeRootPadding: 'd'.repeat(200),
    });

    await f.member('elftia', { specs: [], changes: ['fix-a'] });
    f.writeChange('fix-a');
    f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
    f.commitAll();

    const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
    const destination = plan.items.find((item) => item.name === 'fix-a')?.destination as string;
    expect(destination.length).toBeGreaterThan(260);
    expect(plan.applicable).toBe(true);

    await f.migration().apply(plan.token!);
    expect(fsExists(path.join(destination, 'proposal.md'))).toBe(true);
  });

  it('refuses a Windows reserved device name as a project or Change id', () => {
    for (const flavor of ['win32', 'posix'] as const) {
      const root = flavor === 'win32' ? 'C:\\stores\\team' : '/stores/team';
      expect(() =>
        resolveStorePlanningLayoutV2Path(root, { kind: 'project-home', projectId: 'con' }, flavor)
      ).toThrow();
      expect(() =>
        resolveStorePlanningLayoutV2Path(
          root,
          { kind: 'active-change', projectId: 'elftia', changeId: 'nul' },
          flavor
        )
      ).toThrow();
    }
  });

  it('never lets a destination escape the Store root, whichever flavor builds it', () => {
    for (const [root, flavor] of [
      ['C:\\stores\\team', 'win32'],
      ['/stores/team', 'posix'],
    ] as const) {
      expect(() =>
        resolveStorePlanningLayoutV2Path(
          root,
          { kind: 'project-home', projectId: '../escape' },
          flavor
        )
      ).toThrow();
      expect(() =>
        resolveStorePlanningLayoutV2Path(
          root,
          { kind: 'active-change', projectId: 'elftia', changeId: '../../escape' },
          flavor
        )
      ).toThrow();
      expect(() =>
        resolveStorePlanningLayoutV2Path(
          root,
          { kind: 'archive-line', projectId: 'elftia', targetLineId: '..' },
          flavor
        )
      ).toThrow();
    }
  });

  it('produces destinations that fold onto one path on a case-insensitive host', () => {
    // Two capabilities spelled differently in case are ONE directory on Windows
    // and macOS. The uniqueness check the planner runs is a case fold over
    // exactly these strings, and this is where that fold can be stated: the
    // collision cannot be created from real files on such a host.
    const first = path.win32.join(
      resolveStorePlanningLayoutV2Path(
        'C:\\stores\\team',
        { kind: 'project-specs', projectId: 'elftia' },
        'win32'
      ),
      'billing'
    );
    const second = path.win32.join(
      resolveStorePlanningLayoutV2Path(
        'C:\\stores\\team',
        { kind: 'project-specs', projectId: 'elftia' },
        'win32'
      ),
      'Billing'
    );
    expect(first).not.toBe(second);
    expect(first.toLowerCase()).toBe(second.toLowerCase());
  });
});
