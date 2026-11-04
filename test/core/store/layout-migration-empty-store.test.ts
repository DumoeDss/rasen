/**
 * Guards for the two holes the real-store rehearsal found in the apply gate
 * (change `rehearse-legacy-store-layout-migration`, triage O1/O2/O4/O23/O24).
 *
 * Both are the same seam. `applicable` was computed from item blockers alone
 * while the apply token carried a SECOND, unreported precondition, and both
 * store-level blocks were implemented by stamping a reason onto items that may
 * not exist:
 *
 *   1. An empty legacy flat Store inventoried zero items, so the old
 *      `frozenItems.length > 0` conjunct made the plan inapplicable with ZERO
 *      blockers. Partition writes were refused for being legacy while the
 *      migration was refused for being empty — a closed loop with no supported
 *      way out. Rehearsal evidence: `evidence/rehearsal/01-pristine/`.
 *   2. A legacy flat Store with real content, no ACTIVE Changes, and no
 *      permanent identity reported `applicable: true` with a `null` token,
 *      because `store-identity-missing` was stamped onto items of kind
 *      `change` only. The preview printed "Ready to apply" and `--apply` then
 *      exited 1 with no diagnostic at all. Rehearsal evidence:
 *      `evidence/rehearsal/03-clone/09b`, `09c`, `09d`.
 *
 * These tests build real Git stores and drive the production Module, so each
 * carries an explicit timeout: the 30s default passes solo and fails under the
 * parallel full run, where a timeout then reads as a broken assertion.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAdopt } from '../../../src/commands/store-migration.js';
import { runStoreMigrateLayout } from '../../../src/commands/store-migrate-layout.js';
import { planGateError } from '../../../src/core/store/layout-migration/plan.js';
import { StoreError } from '../../../src/core/store/errors.js';
import {
  assertStoreLayoutForWrite,
  readStoreLayoutState,
} from '../../../src/core/store/layout-write-guard.js';
import { migrationItemStateLabel } from '../../../src/core/store/layout-migration/types.js';
import {
  createLayoutMigrationFixture,
  targetLineMapping,
  MIGRATION_FIXTURE_STORE_ID,
  type LayoutMigrationFixture,
} from '../../helpers/layout-migration-fixture.js';

/** Real Git + real filesystem; see the file header. */
const REAL_GIT_TIMEOUT_MS = 120_000;

const LINE = 'line-0.2';
const MAPPING = 'rasen/mapping.yaml';

async function partitionWriteRefusal(storeRoot: string): Promise<StoreError | null> {
  try {
    await assertStoreLayoutForWrite({
      storeRoot,
      storeId: MIGRATION_FIXTURE_STORE_ID,
      intent: 'store-adopt',
      writes: 'partition',
    });
    return null;
  } catch (error) {
    if (error instanceof StoreError) return error;
    throw error;
  }
}

describe('store layout v2 migration — an empty legacy flat Store is not a dead end', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-empty-');
  });

  afterEach(() => {
    f.cleanup();
  });

  it(
    'reproduces the dead end and then completes a trivial migration',
    async () => {
      f.commitAll();

      // The wedge, from the legacy side: a partition write is refused for being
      // a legacy flat Store, and the refusal names the migration command.
      const before = await partitionWriteRefusal(f.storeRoot);
      expect(before?.diagnostic.code).toBe('legacy_flat_store_requires_migration');
      expect(before?.diagnostic.fix).toContain('migrate-layout');

      const plan = await f.migration().plan(f.input());

      // Nothing to migrate, and nothing wrong: zero items AND zero blockers.
      // The old gate turned that into an inapplicable plan, so the command the
      // refusal above names could never complete.
      expect(plan.items).toHaveLength(0);
      expect(plan.blockers).toHaveLength(0);
      expect(plan.applicable).toBe(true);
      expect(plan.token).toBeDefined();

      const result = await f.migration().apply(plan.token as NonNullable<typeof plan.token>);
      expect(result.phase).toBe('published');
      expect(fs.existsSync(f.receiptAt(plan.planId))).toBe(true);

      // The layout declaration is the linearization point, and it is now v2.
      expect((await readStoreLayoutState(f.storeRoot)).declared).toBe(2);

      // The other side of the wedge: the same write is now accepted.
      expect(await partitionWriteRefusal(f.storeRoot)).toBeNull();
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'retires the empty flat tree once published, idempotently',
    async () => {
      f.commitAll();
      const plan = await f.migration().plan(f.input());
      await f.migration().apply(plan.token as NonNullable<typeof plan.token>);

      const retired = await f.migration().recover(f.input({ action: 'retire-flat' }));
      expect(retired.phase).toBe('retired');
      expect(fs.existsSync(f.at('rasen', 'specs'))).toBe(false);
      expect(fs.existsSync(f.at('rasen', 'changes'))).toBe(false);

      // Re-running retirement is how an interrupted retirement finishes, so it
      // completes rather than refusing a publication that did happen.
      const again = await f.migration().recover(f.input({ action: 'retire-flat' }));
      expect(again.phase).toBe('retired');
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'still refuses an empty-blocker gate it should refuse: one unresolved item blocks apply',
    async () => {
      await f.member('elftia', { specs: [], changes: [] });
      f.writeChange('orphan-change');
      f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
      f.commitAll();

      const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
      expect(plan.applicable).toBe(false);
      expect(plan.token).toBeUndefined();
      expect(labelsOf(plan.blockers)).toContain('unresolved:unknown-owner');
    },
    REAL_GIT_TIMEOUT_MS
  );
});

function labelsOf(items: readonly { state: Parameters<typeof migrationItemStateLabel>[0] }[]): string[] {
  return items.map((item) => migrationItemStateLabel(item.state));
}

describe('store layout v2 migration — a Store with no permanent identity says so', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-identity-', {
      storeIdentity: 'legacy-v1',
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it(
    'refuses and names the identity repair when nothing but Changes could carry the block',
    async () => {
      // The shape that hid the hole: real content, and NOT ONE active Change.
      await f.member('elftia', { specs: ['billing'], changes: [] });
      f.writeSpec('billing');
      f.writeArchiveEntry('2026-07-01-old-thing');
      f.write(
        MAPPING,
        targetLineMapping(LINE, ['elftia'], [
          'archive:',
          '  2026-07-01-old-thing:',
          '    project: elftia',
        ])
      );
      f.commitAll();

      const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));

      // Precondition of the defect: no item of kind `change` exists, so the
      // per-item stamp had nothing to attach to.
      expect(plan.items.some((item) => item.kind === 'change')).toBe(false);
      expect(plan.items.length).toBeGreaterThan(0);

      // The plan must NOT claim readiness it cannot deliver.
      expect(plan.applicable).toBe(false);
      expect(plan.token).toBeUndefined();

      // And it must say why, on an item a reader can see.
      const blocked = plan.blockers.filter(
        (item) => migrationItemStateLabel(item.state) === 'blocked:store-identity-missing'
      );
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked[0]?.repair).toContain('upgrade-identity');
      expect(blocked[0]?.reason).toContain('permanent identity');
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'does not offer the mapping file as the escape hatch for a blocked item',
    async () => {
      await f.member('elftia', { specs: ['billing'], changes: [] });
      f.writeSpec('billing');
      f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
      f.commitAll();

      const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
      const error = planGateError(plan);

      expect(error.diagnostic.code).toBe('migration_plan_blocked');
      expect(error.diagnostic.message).toContain('store-identity-missing');
      expect(error.diagnostic.message).toContain('upgrade-identity');
      // The mapping file resolves unresolved OWNERSHIP; it can do nothing about
      // a Store with no identity, so it must not be named as the way out.
      expect(error.diagnostic.fix).not.toContain('the mapping file is the only escape hatch');
      expect(error.diagnostic.fix).toContain('Follow the repair named for each listed item');
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'names the missing identity even when the Store is completely empty',
    async () => {
      f.commitAll();

      const plan = await f.migration().plan(f.input());

      // Zero content items, so only a store-level block can speak here.
      expect(plan.applicable).toBe(false);
      expect(plan.token).toBeUndefined();
      expect(labelsOf(plan.blockers)).toContain('blocked:store-identity-missing');
      expect(plan.blockers[0]?.repair).toContain('upgrade-identity');
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'keeps blocking every active Change when the Store has no identity',
    async () => {
      await f.member('elftia', { specs: [], changes: ['fix-a'] });
      f.writeChange('fix-a');
      f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
      f.commitAll();

      const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
      const change = plan.items.find((item) => item.kind === 'change');
      expect(migrationItemStateLabel(change?.state as never)).toBe(
        'blocked:store-identity-missing'
      );
      expect(plan.applicable).toBe(false);
    },
    REAL_GIT_TIMEOUT_MS
  );
});

/**
 * The seam no existing suite crosses (design D7 t2). Every other
 * `layout-migration-*` suite constructs `StoreLayoutMigration` itself with an
 * explicit `globalDataDir` and a pre-resolved Store root. This one goes through
 * the shipped command handler, which resolves the Store from the MACHINE
 * REGISTRY by id and takes its worktree from `process.cwd()` — the path the
 * rehearsal actually exercised, and the only one that can catch a resolution or
 * coordination-root regression.
 */
describe('store layout v2 migration — through the registered-store command handler', () => {
  let f: LayoutMigrationFixture;
  let cwd: string;
  let out: string[];

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-registered-');
    cwd = process.cwd();
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map((value) => String(value)).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      out.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    process.exitCode = undefined;
    f.cleanup();
  });

  async function run(options: Parameters<typeof runStoreMigrateLayout>[1]): Promise<number> {
    process.exitCode = undefined;
    out.length = 0;
    await runStoreMigrateLayout(MIGRATION_FIXTURE_STORE_ID, options);
    const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
    process.exitCode = undefined;
    return code;
  }

  it(
    'drives preview -> apply -> status -> retire against a registered empty Store',
    async () => {
      f.commitAll();
      process.chdir(f.storeRoot);

      // Preview: resolved by store id through the machine registry.
      expect(await run({})).toBe(0);
      expect(out.join('\n')).toContain('Ready to apply');

      expect(await run({ apply: true })).toBe(0);
      const published = out.join('\n');
      expect(published).toContain('migration published');
      expect(published).toContain('.rasen-store/store.yaml');

      expect(await run({ status: true })).toBe(0);
      expect(out.join('\n')).toContain('publication recorded: yes');

      expect(await run({ retireFlat: true })).toBe(0);
      expect(out.join('\n')).toContain('migration retired');
      expect(fs.existsSync(path.join(f.storeRoot, 'rasen', 'specs'))).toBe(false);

      expect((await readStoreLayoutState(f.storeRoot)).declared).toBe(2);
      expect(await partitionWriteRefusal(f.storeRoot)).toBeNull();
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'names the blocking precondition in the JSON payload, with no token',
    async () => {
      const legacy = await createLayoutMigrationFixture('rasen-layout-registered-json-', {
        storeIdentity: 'legacy-v1',
      });
      try {
        await legacy.member('elftia', { specs: ['billing'], changes: [] });
        legacy.writeSpec('billing');
        legacy.write(MAPPING, targetLineMapping(LINE, ['elftia']));
        legacy.commitAll();
        process.chdir(legacy.storeRoot);

        expect(await run({ mapping: MAPPING, json: true })).toBe(1);
        const payload = JSON.parse(out.join('\n')) as {
          applicable: boolean;
          token: unknown;
          blockers: Array<{ state: string; code?: string; repair: string }>;
        };
        // A consumer reading `applicable` alone must not conclude readiness.
        expect(payload.applicable).toBe(false);
        expect(payload.token).toBeUndefined();
        const identity = payload.blockers.find(
          (blocker) => blocker.state === 'blocked:store-identity-missing'
        );
        expect(identity?.repair).toContain('upgrade-identity');
      } finally {
        process.chdir(cwd);
        legacy.cleanup();
      }
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'reports a refusal instead of "Ready to apply" when the plan cannot be applied',
    async () => {
      const legacy = await createLayoutMigrationFixture('rasen-layout-registered-v1-', {
        storeIdentity: 'legacy-v1',
      });
      try {
        await legacy.member('elftia', { specs: ['billing'], changes: [] });
        legacy.writeSpec('billing');
        legacy.write(MAPPING, targetLineMapping(LINE, ['elftia']));
        legacy.commitAll();
        process.chdir(legacy.storeRoot);

        expect(await run({ mapping: MAPPING })).toBe(1);
        const preview = out.join('\n');
        expect(preview).not.toContain('Ready to apply');
        expect(preview).toContain('store-identity-missing');

        expect(await run({ mapping: MAPPING, apply: true })).toBe(1);
        expect(out.join('\n')).not.toContain('Ready to apply');
      } finally {
        process.chdir(cwd);
        legacy.cleanup();
      }
    },
    REAL_GIT_TIMEOUT_MS
  );
});

/**
 * Refusal legibility, as the rehearsal measured it (triage O8, O9, O21). Each of
 * these was a refusal that was CORRECT and whose text sent the reader somewhere
 * that does not work, which the capability spec treats as a defect of the
 * refusal itself.
 */
describe('store layout v2 migration — refusals name the real cause and a repair that works', () => {
  let f: LayoutMigrationFixture;

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-legible-');
  });

  afterEach(() => {
    f.cleanup();
  });

  it(
    'sends a non-member RECORDED owner to membership, not to the mapping file that refuses it',
    async () => {
      await f.member('elftia', { specs: [], changes: [] });
      f.writeChange('fix-a', {
        '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: stranger-project\n',
      });
      f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
      f.commitAll();

      const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
      const item = plan.items.find((entry) => entry.name === 'fix-a');

      expect(migrationItemStateLabel(item?.state as never)).toBe('unresolved:non-member-owner');
      // The mapping validator refuses an entry contradicting a recorded
      // identity, so the repair must not send the operator there.
      expect(item?.repair).not.toContain('changes.fix-a.project in the mapping file');
      expect(item?.repair).toContain('add-project');
      expect(item?.repair).toContain('stranger-project');
      expect(item?.reason).toContain('stranger-project');
    },
    REAL_GIT_TIMEOUT_MS
  );

  it(
    'blames the item name, not the project id, when the name cannot address a v2 destination',
    async () => {
      const zhName = String.fromCodePoint(0x53d8, 0x66f4);
      await f.member('elftia', { specs: [], changes: [] });
      f.writeChange(zhName, {
        '.openspec.yaml': 'schema: spec-driven\nidentity:\n  projectId: elftia\n',
      });
      f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
      f.commitAll();

      const plan = await f.migration().plan(f.input({ mappingPath: MAPPING }));
      const item = plan.items.find((entry) => entry.name === zhName);

      expect(migrationItemStateLabel(item?.state as never)).toBe(
        'unresolved:unrecordable-identity'
      );
      expect(item?.reason).toContain(zhName);
      expect(item?.reason).toContain('kebab');
      expect(item?.reason).not.toContain('project id');
      // Renaming is the only thing that works; the mapping file cannot rename.
      expect(item?.repair).toContain('Rename');
      expect(item?.repair).toContain('cannot rename an item');
    },
    REAL_GIT_TIMEOUT_MS
  );
});

describe('store layout v2 migration — every ref carrying the flat layout is reported', () => {
  let f: LayoutMigrationFixture;
  let cwd: string;
  let out: string[];

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-refs-');
    cwd = process.cwd();
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    process.exitCode = undefined;
    f.cleanup();
  });

  it(
    'lists a remote-tracking ref that still carries the flat layout, and says it is migrated elsewhere',
    async () => {
      await f.member('elftia', { specs: ['billing'], changes: [] });
      f.writeSpec('billing');
      f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
      f.commitAll();
      // A remote-tracking ref pointing at flat content, with no network: this is
      // exactly what a clone of a legacy flat Store carries.
      f.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      f.git('branch', 'legacy-feature');

      process.chdir(f.storeRoot);
      process.exitCode = undefined;
      await runStoreMigrateLayout(MIGRATION_FIXTURE_STORE_ID, { mapping: MAPPING });
      process.exitCode = undefined;
      const rendered = out.join('\n');

      // The local branch was always reported.
      expect(rendered).toContain('refs/heads/legacy-feature');
      // The remote-tracking ref was surveyed as flat and reported nowhere.
      expect(rendered).toContain('refs/remotes/origin/main');
      expect(rendered).toContain('Remote-tracking refs that still carry flat planning content');
      expect(rendered).toContain('where it lives');
    },
    REAL_GIT_TIMEOUT_MS
  );
});

/**
 * The two invariants that would have caught BOTH halves of the seam, asserted
 * directly rather than through any one store shape. `applicable` and "a token
 * can be minted" are now the same statement; these hold it that way.
 */
describe('store layout v2 migration — the apply gate and the apply token agree', () => {
  const shapes: Array<{
    readonly label: string;
    readonly identity: 'permanent' | 'legacy-v1';
    /**
     * True when the shape seeds member `elftia`. A target-line declaration
     * naming a non-member is a mapping-file error in its own right, so the
     * member-less shapes plan with NO mapping — otherwise they never reach the
     * invariant under test.
     */
    readonly member: boolean;
    readonly seed: (fixture: LayoutMigrationFixture) => Promise<void>;
  }> = [
    { label: 'empty Store', identity: 'permanent', member: false, seed: async () => {} },
    {
      label: 'Store with content and no active Changes',
      identity: 'permanent',
      member: true,
      seed: async (fixture) => {
        await fixture.member('elftia', { specs: ['billing'], changes: [] });
        fixture.writeSpec('billing');
      },
    },
    {
      label: 'empty Store with no permanent identity',
      identity: 'legacy-v1',
      member: false,
      seed: async () => {},
    },
    {
      label: 'Store with content, no active Changes, and no permanent identity',
      identity: 'legacy-v1',
      member: true,
      seed: async (fixture) => {
        await fixture.member('elftia', { specs: ['billing'], changes: [] });
        fixture.writeSpec('billing');
      },
    },
    {
      label: 'Store with an unresolvable Change',
      identity: 'permanent',
      member: true,
      seed: async (fixture) => {
        await fixture.member('elftia', { specs: [], changes: [] });
        fixture.writeChange('orphan-change');
      },
    },
  ];

  for (const shape of shapes) {
    it(
      `never reports readiness it cannot back — ${shape.label}`,
      async () => {
        const f = await createLayoutMigrationFixture('rasen-layout-invariant-', {
          storeIdentity: shape.identity,
        });
        const cwd = process.cwd();
        const out: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
          out.push(args.map((value) => String(value)).join(' '));
        });
        vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
          out.push(args.map((value) => String(value)).join(' '));
        });
        try {
          await shape.seed(f);
          if (shape.member) f.write(MAPPING, targetLineMapping(LINE, ['elftia']));
          f.commitAll();
          const planOptions = shape.member ? { mappingPath: MAPPING } : {};

          const plan = await f.migration().plan(f.input(planOptions));

          // Invariant 1: applicable and token-minted are the same statement.
          expect(plan.applicable).toBe(plan.token !== undefined);
          // Invariant 2: an inapplicable plan names at least one blocker.
          if (!plan.applicable) expect(plan.blockers.length).toBeGreaterThan(0);

          process.chdir(f.storeRoot);
          process.exitCode = undefined;
          out.length = 0;
          await runStoreMigrateLayout(
            MIGRATION_FIXTURE_STORE_ID,
            shape.member ? { mapping: MAPPING } : {}
          );
          const code = typeof process.exitCode === 'number' ? process.exitCode : 0;
          process.exitCode = undefined;
          const rendered = out.join('\n');

          // Invariant 3: no plan renders "Ready to apply" without a token.
          if (plan.token === undefined) expect(rendered).not.toContain('Ready to apply');
          // Invariant 4: exit code and rendered text agree about success, and a
          // failure names a reason rather than going silent.
          expect(code).toBe(plan.applicable ? 0 : 1);
          if (code !== 0) {
            expect(rendered.length).toBeGreaterThan(0);
            expect(
              /blocked:|unresolved:|Not applicable/u.test(rendered),
              `exit ${code} with no reason named in:\n${rendered}`
            ).toBe(true);
          }
        } finally {
          process.chdir(cwd);
          vi.restoreAllMocks();
          process.exitCode = undefined;
          f.cleanup();
        }
      },
      REAL_GIT_TIMEOUT_MS
    );
  }
});

/**
 * The wedge's first contact (triage O5). `store adopt` against a legacy flat
 * Store is how most operators meet this defect class, and its HUMAN path let the
 * StoreError escape `runAdopt` to `runCli()`, which has no top-level catch — so
 * the refusal arrived as a raw Node unhandled-rejection dump naming `dist/`
 * paths, with the diagnostic's own message and Fix line buried inside it. The
 * `--json` path was correct all along, which is what made it invisible.
 */
describe('store adopt — a refusal renders as a diagnostic on the human path too', () => {
  let f: LayoutMigrationFixture;
  let cwd: string;
  let out: string[];

  beforeEach(async () => {
    f = await createLayoutMigrationFixture('rasen-layout-adopt-human-');
    cwd = process.cwd();
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out.push(args.map((value) => String(value)).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      out.push(args.map((value) => String(value)).join(' '));
    });
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    process.exitCode = undefined;
    f.cleanup();
  });

  it(
    'names the legacy-layout refusal and its fix instead of throwing to the top level',
    async () => {
      f.commitAll();
      const project = path.join(f.tempDir, 'probe-project');
      fs.mkdirSync(path.join(project, 'rasen', 'specs'), { recursive: true });
      fs.mkdirSync(path.join(project, 'rasen', 'changes'), { recursive: true });
      fs.writeFileSync(path.join(project, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      process.chdir(f.storeRoot);
      process.exitCode = undefined;

      // Must not reject: a refusal is an outcome this adapter renders, not an
      // exception it lets escape.
      await expect(
        runAdopt(project, { to: MIGRATION_FIXTURE_STORE_ID, dryRun: true })
      ).resolves.toBeUndefined();

      const rendered = out.join('\n');
      expect(process.exitCode).toBe(1);
      expect(rendered).toContain('has not declared planning layout version 2');
      expect(rendered).toContain('Fix:');
      expect(rendered).toContain('migrate-layout');
      // No stack frames, and no built-file paths leaking into a user-facing message.
      expect(rendered).not.toContain('at assertStoreLayoutForWrite');
      expect(rendered).not.toContain('dist/core/store');
      expect(rendered).not.toContain('dist\core\store');
    },
    REAL_GIT_TIMEOUT_MS
  );
});
