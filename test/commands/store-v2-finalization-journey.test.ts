/**
 * `store-finalization-outcomes-v2` tasks 13.1, 13.4 and 13.5 — the dedicated
 * finalization journey.
 *
 * One migrated Store, two projects, two target lines, and the FOUR outcomes
 * finalized through the real CLI in one run:
 *
 *   | Change            | project | line     | outcome                        |
 *   | landed-code       | app-a   | line-0.2 | landed, with a real code commit |
 *   | abandoned-work    | app-a   | line-0.2 | abandoned                       |
 *   | superseded-work   | app-b   | line-0.2 | superseded by a Change on 0.3   |
 *   | planning-only     | app-b   | line-0.3 | landed, `implementation: none`  |
 *
 * Every one of them carries real delta specs, so "only the landed ones changed
 * canonical specs" is a claim with something to lose. The specs directories are
 * content-hashed before and after the whole run, and the three passive/
 * planning-only finalizations must leave them byte-identical.
 *
 * The journey also pins two portfolio-level invariants: a relocated LEGACY
 * archive entry is never read, rewritten, or given fabricated v2 facts (13.4),
 * and READING an Archive — listing it, inspecting the scope — replays no spec
 * (13.5).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreFinalizationFixture,
  hashTree,
  type BoundChange,
  type StoreFinalizationFixture,
} from '../helpers/store-finalization-fixture.js';

const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE_02 = 'line-0.2';
const LINE_03 = 'line-0.3';

function parseJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

function expectOk(result: RunCLIResult): RunCLIResult {
  expect(
    result.exitCode,
    `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(0);
  return result;
}

describe('Store v2 finalization journey: four outcomes, two projects, two lines', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-finalization-journey-',
      projects: [PROJECT_A, PROJECT_B],
      storeBranches: ['release/0.2', 'release/0.3'],
      projectBranches: ['release/0.2', 'release/0.3'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: {
            [PROJECT_A]: 'refs/heads/release/0.2',
            [PROJECT_B]: 'refs/heads/release/0.2',
          },
        },
        {
          id: LINE_03,
          storeRef: 'refs/heads/release/0.3',
          codeRefs: {
            [PROJECT_A]: 'refs/heads/release/0.3',
            [PROJECT_B]: 'refs/heads/release/0.3',
          },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function specsDir(planningWorktree: string, projectId: string): string {
    return path.join(planningWorktree, 'rasen', 'projects', projectId, 'specs');
  }

  /** One capability delta that CREATES a canonical spec when it lands. */
  function seedDelta(bound: BoundChange, capability: string): void {
    f.write(
      path.join(bound.changeDir, 'specs', capability, 'spec.md'),
      [
        `# ${capability} - Changes`,
        '',
        '## ADDED Requirements',
        '',
        `### Requirement: ${capability} rule`,
        'The system SHALL do the thing.',
        '',
        '#### Scenario: Happens',
        '- **WHEN** the thing is requested',
        '- **THEN** it happens',
        '',
      ].join('\n')
    );
  }

  function selectors(projectId: string, targetLineId: string): string[] {
    return ['--store', f.storeId, '--project', projectId, '--target-line', targetLineId];
  }

  it('finalizes all four outcomes and changes canonical specs only for the landed ones', async () => {
    // ---- the four Changes, each with a real bound pair and real deltas ----
    const landed = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'landed-code',
    });
    seedDelta(landed, 'landed-capability');

    const abandoned = await f.bind({
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      changeId: 'abandoned-work',
      instanceSeed: 'b'.repeat(32),
    });
    seedDelta(abandoned, 'abandoned-capability');

    const superseded = await f.bind({
      projectId: PROJECT_B,
      targetLineId: LINE_02,
      changeId: 'superseded-work',
      instanceSeed: 'c'.repeat(32),
    });
    seedDelta(superseded, 'superseded-capability');

    const planningOnly = await f.bind({
      projectId: PROJECT_B,
      targetLineId: LINE_03,
      changeId: 'planning-only',
      instanceSeed: 'd'.repeat(32),
    });
    seedDelta(planningOnly, 'planning-only-capability');
    // Planning-only intent is DECLARED in the Change and committed; there is
    // deliberately no archive-time flag that can assert it.
    const planningMetadata = path.join(planningOnly.changeDir, '.openspec.yaml');
    f.write(
      planningMetadata,
      `${fs.readFileSync(planningMetadata, 'utf8').trimEnd()}\nimplementation: none\n`
    );

    // The successor lives on the OTHER target line and is read as a committed
    // Git blob — the motivating case for the whole successor search.
    const successor = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT_B,
      targetLineId: LINE_03,
      changeId: 'the-successor',
      instanceSeed: 'e'.repeat(32),
    });
    f.git(f.storeRoot, ['add', '.']);
    f.git(f.storeRoot, ['commit', '-m', 'seed the successor Change']);
    f.git(f.storeRoot, ['branch', '-f', 'release/0.3', 'HEAD']);

    // ---- a relocated LEGACY archive entry, which must stay untouched -------
    const legacyEntry = path.join(landed.archiveLine, '2025-01-01-relocated-legacy');
    f.write(
      path.join(legacyEntry, 'archive.json'),
      `${JSON.stringify(
        {
          change: 'relocated-legacy',
          archivedAt: '2025-01-01T00:00:00.000Z',
          codeCommit: null,
          planningBranch: null,
          planningTreeState: 'clean',
          evidence: [],
          probes: [],
          handoffAbsorbed: [],
          ephemeraDiscarded: [],
          missing: [],
        },
        null,
        2
      )}\n`
    );
    f.write(path.join(legacyEntry, 'proposal.md'), '# Legacy\n');
    const legacyBefore = hashTree(legacyEntry);

    const specsA = specsDir(landed.planningWorktree, PROJECT_A);
    const specsAbandoned = specsDir(abandoned.planningWorktree, PROJECT_A);
    const specsSuperseded = specsDir(superseded.planningWorktree, PROJECT_B);
    const specsPlanningOnly = specsDir(planningOnly.planningWorktree, PROJECT_B);
    const before = {
      abandoned: hashTree(specsAbandoned),
      superseded: hashTree(specsSuperseded),
      planningOnly: hashTree(specsPlanningOnly),
    };
    // STATED PLAINLY, because `{} === {}` would satisfy the comparison at the
    // end of this test without proving anything: the shared workspace fixture
    // seeds NO canonical specs, so these three baselines are empty maps. The
    // passive assertions below are therefore "no capability directory was
    // created", which is exactly what a leaked passive spec-sync would do —
    // and each is paired with an explicit `existsSync` so the claim does not
    // rest on comparing two empty objects. `finalization-spec-sync.test.ts`
    // makes the stronger byte-identity claim against a NON-empty baseline; the
    // positive control that the pipeline can write here at all is the landed
    // case, whose baseline changes.
    expect(before.abandoned).toEqual({});
    expect(before.superseded).toEqual({});
    expect(before.planningOnly).toEqual({});

    // ---- 1. landed, with a real code commit -------------------------------
    const commit = f.refOid(landed.executionWorktree, 'HEAD');
    const landedJson = parseJson(
      expectOk(
        await runCLI(
          [
            'archive',
            landed.changeId,
            ...selectors(PROJECT_A, LINE_02),
            '--outcome',
            'landed',
            '--commit',
            commit,
            '--json',
            '--yes',
          ],
          { cwd: landed.executionWorktree, env: f.env }
        )
      )
    ).archive;

    expect(landedJson.path).toBe(
      path.join(landed.archiveLine, path.basename(landedJson.path as string))
    );
    expect(landedJson.finalization).toMatchObject({
      outcome: 'landed',
      targetLineId: LINE_02,
      changeInstanceId: landed.changeInstanceId,
      specSyncApplied: true,
      specSyncActionCount: 1,
      provenCommit: commit,
      codeRef: 'refs/heads/release/0.2',
    });
    // The ONE canonical spec this landed Change carried now exists.
    expect(
      fs.existsSync(path.join(specsA, 'landed-capability', 'spec.md'))
    ).toBe(true);

    // ---- 2. abandoned ------------------------------------------------------
    const abandonedJson = parseJson(
      expectOk(
        await runCLI(
          [
            'archive',
            abandoned.changeId,
            ...selectors(PROJECT_A, LINE_02),
            '--outcome',
            'abandoned',
            '--reason',
            'The approach was dropped.',
            '--json',
            '--yes',
          ],
          { cwd: abandoned.executionWorktree, env: f.env }
        )
      )
    ).archive;
    expect(abandonedJson.finalization).toMatchObject({
      outcome: 'abandoned',
      specSyncApplied: false,
      specSyncActionCount: 0,
      provenCommit: null,
    });

    // ---- 3. superseded by a Change on the OTHER line ----------------------
    const supersededJson = parseJson(
      expectOk(
        await runCLI(
          [
            'archive',
            superseded.changeId,
            ...selectors(PROJECT_B, LINE_02),
            '--outcome',
            'superseded',
            '--reason',
            'The work moved to the 0.3 line.',
            '--by',
            successor.instanceId,
            '--by-target-line',
            LINE_03,
            '--json',
            '--yes',
          ],
          { cwd: superseded.executionWorktree, env: f.env }
        )
      )
    ).archive;
    expect(supersededJson.finalization).toMatchObject({
      outcome: 'superseded',
      targetLineId: LINE_02,
      specSyncApplied: false,
    });

    // ---- 4. planning-only landed ------------------------------------------
    const planningOnlyJson = parseJson(
      expectOk(
        await runCLI(
          [
            'archive',
            planningOnly.changeId,
            ...selectors(PROJECT_B, LINE_03),
            '--outcome',
            'landed',
            '--json',
            '--yes',
          ],
          { cwd: planningOnly.executionWorktree, env: f.env }
        )
      )
    ).archive;
    expect(planningOnlyJson.finalization).toMatchObject({
      outcome: 'landed',
      targetLineId: LINE_03,
      specSyncApplied: true,
      specSyncActionCount: 1,
      // No commit was resolved, fabricated, or required.
      provenCommit: null,
    });

    // ---- the four entry addresses -----------------------------------------
    const entries = {
      landed: landedJson.path as string,
      abandoned: abandonedJson.path as string,
      superseded: supersededJson.path as string,
      planningOnly: planningOnlyJson.path as string,
    };
    expect(entries.landed).toBe(
      path.join(
        landed.planningWorktree,
        'rasen',
        'projects',
        PROJECT_A,
        'changes',
        'archive',
        LINE_02,
        path.basename(entries.landed)
      )
    );
    expect(entries.superseded).toContain(
      path.join('projects', PROJECT_B, 'changes', 'archive', LINE_02)
    );
    expect(entries.planningOnly).toContain(
      path.join('projects', PROJECT_B, 'changes', 'archive', LINE_03)
    );
    for (const [label, entry] of Object.entries(entries)) {
      expect(path.basename(entry), label).toMatch(
        /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+--[0-9a-f]{12}$/u
      );
    }

    // ---- the four records --------------------------------------------------
    const records = Object.fromEntries(
      Object.entries(entries).map(([label, entry]) => [
        label,
        JSON.parse(fs.readFileSync(path.join(entry, 'archive.json'), 'utf8')) as Record<
          string,
          unknown
        >,
      ])
    );
    expect(records.landed).toMatchObject({
      schemaVersion: 2,
      implementation: 'code',
      outcome: 'landed',
      reason: null,
      supersededBy: null,
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      codeMerge: { repoUid: PROJECT_A, commit, reachable: true },
      specSync: { applied: true },
    });
    expect((records.landed!.specSync as { actions: unknown[] }).actions).toHaveLength(1);
    expect(records.abandoned).toMatchObject({
      schemaVersion: 2,
      outcome: 'abandoned',
      reason: 'The approach was dropped.',
      supersededBy: null,
      codeMerge: null,
      specSync: { applied: false, actions: [] },
    });
    expect(records.superseded).toMatchObject({
      schemaVersion: 2,
      outcome: 'superseded',
      reason: 'The work moved to the 0.3 line.',
      supersededBy: successor.instanceId,
      projectId: PROJECT_B,
      codeMerge: null,
      specSync: { applied: false, actions: [] },
    });
    expect(records.planningOnly).toMatchObject({
      schemaVersion: 2,
      implementation: 'none',
      outcome: 'landed',
      // A planning-only Change carries no code merge and no invented one.
      codeMerge: null,
      specSync: { applied: true },
    });

    // ---- only the LANDED ones changed canonical specs ----------------------
    expect(hashTree(specsAbandoned)).toEqual(before.abandoned);
    expect(
      fs.existsSync(path.join(specsAbandoned, 'abandoned-capability'))
    ).toBe(false);
    expect(hashTree(specsSuperseded)).toEqual(before.superseded);
    expect(
      fs.existsSync(path.join(specsSuperseded, 'superseded-capability'))
    ).toBe(false);
    // The planning-only Change IS landed, so its deltas apply — landed is the
    // axis, not whether code exists.
    expect(hashTree(specsPlanningOnly)).not.toEqual(before.planningOnly);
    expect(
      fs.existsSync(path.join(specsPlanningOnly, 'planning-only-capability', 'spec.md'))
    ).toBe(true);

    // ---- 13.4: the relocated legacy entry is byte-identical ---------------
    expect(hashTree(legacyEntry)).toEqual(legacyBefore);
    const legacyRecord = JSON.parse(
      fs.readFileSync(path.join(legacyEntry, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;
    // No outcome, target line, or workspace pair was fabricated for it, and it
    // was not upgraded to schema 2.
    expect(legacyRecord).not.toHaveProperty('schemaVersion');
    expect(legacyRecord).not.toHaveProperty('outcome');
    expect(legacyRecord).not.toHaveProperty('targetLineId');
    expect(legacyRecord).not.toHaveProperty('workspacePairId');

    // ---- 13.5: reading an Archive replays no spec -------------------------
    const specsAfterFinalization = {
      a: hashTree(specsA),
      abandoned: hashTree(specsAbandoned),
      superseded: hashTree(specsSuperseded),
      planningOnly: hashTree(specsPlanningOnly),
    };
    for (const [projectId, targetLineId, cwd] of [
      [PROJECT_A, LINE_02, landed.planningWorktree],
      [PROJECT_B, LINE_03, planningOnly.planningWorktree],
    ] as const) {
      expectOk(
        await runCLI(['list', '--json', ...selectors(projectId, targetLineId)], {
          cwd,
          env: f.env,
        })
      );
      expectOk(
        await runCLI(['context', '--json', ...selectors(projectId, targetLineId)], {
          cwd,
          env: f.env,
        })
      );
    }
    expect(hashTree(specsA)).toEqual(specsAfterFinalization.a);
    expect(hashTree(specsAbandoned)).toEqual(specsAfterFinalization.abandoned);
    expect(hashTree(specsSuperseded)).toEqual(specsAfterFinalization.superseded);
    expect(hashTree(specsPlanningOnly)).toEqual(specsAfterFinalization.planningOnly);
    expect(hashTree(legacyEntry)).toEqual(legacyBefore);
  }, 900_000);
});
