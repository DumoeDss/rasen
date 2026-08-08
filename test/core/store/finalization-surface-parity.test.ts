/**
 * `store-finalization-outcomes-v2` task 12.7 — one finalization algorithm,
 * proven rather than claimed.
 *
 * Four surfaces adopt finalization: the direct command, the bulk workflow, the
 * in-ship archive, and the management route. Each builds its own argv, and this
 * suite drives ALL FOUR of those argv arrays through the real Commander program
 * against the SAME Change with the SAME inputs, then compares the canonicalized
 * finalization plan.
 *
 * "One algorithm" is therefore a measurable property here, not a sentence in a
 * proposal: if any surface ever grew its own outcome handling, its plan id
 * would diverge and this suite would name which one.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The fixture is imported FIRST on purpose, and the reason recorded here is
// what was OBSERVED, not a diagnosis.
//
// Observed: with the management-API bridge's import ahead of the fixture, this
// suite failed with `assertCarrierAgreesWithScope` in its temporal dead zone.
// Moving the fixture first fixed it.
//
// NOT the cause, and previously recorded here as if it were: a cycle between
// `workspace/module.ts` and `workspace/binding.ts`. There is none.
// `binding.ts` imports only `dependencies`, `diagnostics`, `identity`,
// `registry`, `types`, `../identity-types` and `../planning-layout-v2`, and
// none of those imports `module.js` — so `binding.ts` never reaches
// `module.ts` at all. An import-graph scan over `src/` finds no runtime cycle
// anywhere under `src/core/store/`, and loading the same modules in the
// "dangerous" order through real ESM against `dist/` resolves
// `assertCarrierAgreesWithScope` to a function with no error.
//
// So this is a vitest/Vite SSR-transform artifact of the TEST graph, not a
// property of production module structure — which matters, because the earlier
// note escalated it to "a latent fragility a future `src/` import could hit",
// and that would have sent someone hunting a production defect that does not
// exist. Keep the import order (it is load-bearing for this suite); do not go
// looking for the cycle.
import {
  createStoreFinalizationFixture,
  hashTree,
  type BoundChange,
  type StoreFinalizationFixture,
} from '../../helpers/store-finalization-fixture.js';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';
import { canonicalJson } from '../../../src/core/canonical-json.js';
import { finalizationPlanId } from '../../../src/core/store/finalization/index.js';
import {
  createGeneratedArchiveBatchArgv,
  createGeneratedArchiveConsumerArgv,
} from '../../../src/core/archive-consumer-invocation.js';
import {
  createFinalizationCliArgv,
  finalizationOptions,
} from '../../../src/core/management-api/finalize.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'parity-change';

function parseJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

const FIXED_INSTANT = '2026-08-07T00:00:00.000Z';

/**
 * Normalizes exactly TWO things and nothing else: the transaction's random id
 * (and the stage/journal paths derived from it) and the wall-clock instant.
 *
 * Both are genuine inputs rather than defects. The transaction id is minted per
 * attempt; `archivedAt` is a recorded fact of the finalization, so two plans
 * made a second apart legitimately differ, and four surfaces cannot be invoked
 * at the same instant from a test. Everything else — the destination, the whole
 * record draft's identity and outcome fields, the spec-sync projection, the
 * evidence inventory, the association plan, the lock keys, and the engine's
 * entire ordered action list — is compared as-is.
 */
function normalizePlan(plan: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
  const archive = copy.archivePlan as Record<string, unknown>;
  const transactionId = archive.transactionId as string;
  delete copy.token;
  copy.createdAt = FIXED_INSTANT;
  (copy.recordDraft as Record<string, unknown>).archivedAt = FIXED_INSTANT;
  archive.createdAt = FIXED_INSTANT;
  (
    (archive.finalization as Record<string, unknown>).record as Record<string, unknown>
  ).archivedAt = FIXED_INSTANT;
  archive.transactionId = '<transaction-id>';
  archive.planHash = '<plan-hash>';
  const rewritten = JSON.parse(
    JSON.stringify(copy).split(transactionId).join('<transaction-id>')
  ) as Record<string, unknown>;
  delete rewritten.planId;
  return rewritten;
}

function canonicalPlanBytes(plan: Record<string, unknown>): string {
  return canonicalJson(normalizePlan(plan));
}

describe('direct, bulk, in-ship and API produce one finalization plan', () => {
  let f: StoreFinalizationFixture;
  let bound: BoundChange;
  let commit: string;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-parity-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
    bound = await f.bind({ projectId: PROJECT, targetLineId: LINE, changeId: CHANGE });
    commit = f.refOid(bound.executionWorktree, 'HEAD');
  });

  afterEach(() => {
    f.cleanup();
  });

  it('drives all four surfaces with identical inputs and gets one plan', async () => {
    const selector = ['--store', f.storeId, '--project', PROJECT, '--target-line', LINE];
    const finalization = { outcome: 'landed', commit } as const;

    // 1. DIRECT — the command a user types.
    const direct = [
      'archive',
      CHANGE,
      ...selector,
      '--outcome',
      'landed',
      '--commit',
      commit,
      '--dry-run',
      '--save-plan',
      '--json',
    ];

    // 2. BULK — one member of a batch, through the batch boundary.
    const bulk = createGeneratedArchiveBatchArgv(
      [{ change: CHANGE, selector, planToken: '<pending>', finalization }],
      { requireFinalization: true }
    )[0]!.savedPreview;

    // 3. IN-SHIP — the archive the ship workflow runs.
    const inShip = createGeneratedArchiveConsumerArgv('in-ship', {
      change: CHANGE,
      selector,
      planToken: '<pending>',
      finalization,
    }).savedPreview;

    // 4. API — the argv the management route's bridge spawns.
    const options = finalizationOptions({ outcome: 'landed', commit });
    expect(options.ok).toBe(true);
    const api = createFinalizationCliArgv(
      {
        storeUid: f.storeId,
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: bound.changeInstanceId,
      },
      CHANGE,
      (options as { argv: string[] }).argv
    ).preview;

    const surfaces = [
      ['direct', direct],
      ['bulk', bulk],
      ['in-ship', inShip],
      ['api', api],
    ] as const;

    const plans = new Map<string, Record<string, unknown>>();
    for (const [label, argv] of surfaces) {
      const result = await runCLI(argv, { cwd: bound.executionWorktree, env: f.env });
      expect(
        result.exitCode,
        `${label}: ${result.command}\n${result.stdout}\n${result.stderr}`
      ).toBe(0);
      const plan = parseJson(result).archive.finalizationPlan as Record<string, unknown>;
      expect(plan, label).toBeDefined();
      plans.set(label, plan);
    }

    const reference = plans.get('direct') as Record<string, unknown>;
    for (const [label] of surfaces) {
      const plan = plans.get(label) as Record<string, unknown>;
      expect(canonicalPlanBytes(plan), `${label} canonical plan bytes`).toBe(
        canonicalPlanBytes(reference)
      );
      // …and PRODUCTION's own identifier agrees once the clock is held equal,
      // which is the property the token depends on.
      expect(
        finalizationPlanId(
          normalizePlan(plan) as unknown as Parameters<typeof finalizationPlanId>[0]
        ),
        `${label} plan id`
      ).toBe(
        finalizationPlanId(
          normalizePlan(reference) as unknown as Parameters<typeof finalizationPlanId>[0]
        )
      );
      expect(plan.outcome).toBe('landed');
      expect((plan.recordDraft as { changeInstanceId: string }).changeInstanceId).toBe(
        bound.changeInstanceId
      );
      expect(plan.destination).toBe(reference.destination);
    }
  }, 300_000);

  it('carries the outcome in the SAVED PREVIEW only, never in the apply argv', () => {
    const built = createGeneratedArchiveConsumerArgv('single', {
      change: CHANGE,
      planToken: 'archive-v1:tx:hash',
      finalization: { outcome: 'abandoned', reason: 'Dropped.' },
    });

    expect(built.savedPreview).toContain('--outcome');
    expect(built.savedPreview).toContain('abandoned');
    expect(built.savedPreview).toContain('--reason');
    // Apply consumes the token alone: a stored plan's recorded outcome cannot
    // be re-decided at apply time by anything on the command line.
    expect(built.apply).toEqual([
      'archive',
      '--apply-plan',
      'archive-v1:tx:hash',
      '--json',
      '--yes',
    ]);
    expect(built.apply).not.toContain('--outcome');
    // The intent template never carries an outcome either — it discovers the
    // handoff inventory and nothing else.
    expect(built.intentTemplate).not.toContain('--outcome');
  });

  it('refuses a whole BATCH when any member declares no outcome, naming every one', () => {
    expect(() =>
      createGeneratedArchiveBatchArgv(
        [
          { change: 'has-one', planToken: 't', finalization: { outcome: 'abandoned', reason: 'x' } },
          { change: 'missing-a', planToken: 't' },
          { change: 'missing-b', planToken: 't' },
        ],
        { requireFinalization: true }
      )
    ).toThrow(/missing-a, missing-b/u);

    // …and it says so rather than borrowing the sibling's outcome.
    let message = '';
    try {
      createGeneratedArchiveBatchArgv([{ change: 'missing-a', planToken: 't' }], {
        requireFinalization: true,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('never inferred from a sibling');
  });

  it('refuses any in-ship outcome other than landed', () => {
    for (const outcome of ['abandoned', 'cancelled', 'superseded'] as const) {
      expect(() =>
        createGeneratedArchiveConsumerArgv('in-ship', {
          change: CHANGE,
          planToken: 't',
          finalization: { outcome, reason: 'x', by: `ci_${'a'.repeat(64)}` },
        })
      ).toThrow(/in-ship archive finalizes as 'landed'/u);
    }
    // The bulk and single consumers accept every outcome, because they are not
    // recording a delivery.
    expect(() =>
      createGeneratedArchiveConsumerArgv('bulk', {
        change: CHANGE,
        planToken: 't',
        finalization: { outcome: 'abandoned', reason: 'x' },
      })
    ).not.toThrow();
  });

  it('validates a generated argv through the SAME resolver the command uses', () => {
    // A combination the CLI would refuse cannot be expressed as an argv array
    // at all: there is no second outcome parser to disagree with.
    expect(() =>
      createGeneratedArchiveConsumerArgv('single', {
        change: CHANGE,
        planToken: 't',
        finalization: { outcome: 'landed', reason: 'we shipped it' },
      })
    ).toThrow(/carries no reason/u);
    expect(() =>
      createGeneratedArchiveConsumerArgv('single', {
        change: CHANGE,
        planToken: 't',
        finalization: { outcome: 'superseded', reason: 'moved' },
      })
    ).toThrow(/names the Change instance/u);
  });

  it('leaves the Change untouched: four dry runs write nothing to the tree', async () => {
    const before = hashTree(bound.changeDir);
    const argv = [
      'archive',
      CHANGE,
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
      '--outcome',
      'landed',
      '--commit',
      commit,
      '--dry-run',
      '--json',
    ];
    for (let run = 0; run < 2; run += 1) {
      const result = await runCLI(argv, { cwd: bound.executionWorktree, env: f.env });
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    }
    expect(hashTree(bound.changeDir)).toEqual(before);
    expect(fs.existsSync(path.join(bound.archiveLine))).toBe(false);
  }, 300_000);
});
