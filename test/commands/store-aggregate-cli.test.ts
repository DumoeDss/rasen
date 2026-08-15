/**
 * `store-scoped-issues-management` task 8.9 — the `rasen store changes` and
 * `rasen store projects` CLI.
 *
 * Grouped output, filter narrowing, refusal output, incomplete-result
 * reporting, and JSON/human parity. Every test runs the real CLI.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'line-0.2';
const LINE_MAIN = 'main';

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

describe('rasen store aggregate CLI', () => {
  let f: StoreWorkspaceFixture;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-aggregate-cli-',
      projects: [PROJECT_A, PROJECT_B],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT_A]: 'refs/heads/release/0.2', [PROJECT_B]: 'refs/heads/release/0.2' },
        },
        {
          id: LINE_MAIN,
          storeRef: 'refs/heads/main',
          codeRefs: { [PROJECT_A]: 'refs/heads/main' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function seedAndCommit(
    projectId: string,
    targetLineId: string,
    changeId: string,
    instanceSeed: string
  ): void {
    f.seedChange({ root: f.storeRoot, projectId, targetLineId, changeId, instanceSeed });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed ${changeId}`]);
  }

  it('prints grouped Changes in both human and JSON forms', async () => {
    seedAndCommit(PROJECT_A, LINE, 'change-a', 'a1'.repeat(16));
    seedAndCommit(PROJECT_B, LINE, 'change-b', 'b2'.repeat(16));

    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const humanResult = expectOk(
      await runCLI(
        ['store', 'changes', '--store', f.storeId],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    const jsonResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'changes', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );

    // The human form shows the group headers.
    expect(humanResult.stdout).toContain(`${PROJECT_A} / ${LINE}`);
    expect(humanResult.stdout).toContain(`${PROJECT_B} / ${LINE}`);
    expect(humanResult.stdout).toContain('change-a');
    expect(humanResult.stdout).toContain('change-b');

    // The JSON form has the same groups: the two that hold a Change, plus the
    // declared-but-empty `app-a`/`main` pair (`main` declares only app-a and
    // holds nothing), which is reported present and empty rather than hidden.
    expect(jsonResult.complete).toBe(true);
    const ids = jsonResult.groups.map((g: any) => `${g.projectId}/${g.targetLineId}`).sort();
    expect(ids).toEqual([
      `${PROJECT_A}/${LINE}`,
      `${PROJECT_A}/${LINE_MAIN}`,
      `${PROJECT_B}/${LINE}`,
    ]);
    const holders = jsonResult.groups.filter(
      (g: any) => g.active.length + g.archived.length > 0
    );
    expect(holders.map((g: any) => `${g.projectId}/${g.targetLineId}`).sort()).toEqual([
      `${PROJECT_A}/${LINE}`,
      `${PROJECT_B}/${LINE}`,
    ]);
    // The empty pair reaches a PERSON too, not only a program.
    expect(humanResult.stdout).toContain(`${PROJECT_A} / ${LINE_MAIN}`);
    expect(humanResult.stdout).toContain('(no Changes)');
  });

  it('narrows the result with --project and --target-line filters', async () => {
    seedAndCommit(PROJECT_A, LINE, 'narrow-a', 'a1'.repeat(16));
    seedAndCommit(PROJECT_B, LINE, 'narrow-b', 'b2'.repeat(16));
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    const byProject = parseJson(
      expectOk(
        await runCLI(
          ['store', 'changes', '--store', f.storeId, '--project', PROJECT_A, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    // The filter narrows to app-a — both of its declared pairs, and nothing
    // of app-b's, whose Change is the one this must not report.
    expect(byProject.groups.map((g: any) => g.projectId)).toEqual([PROJECT_A, PROJECT_A]);
    expect(
      byProject.groups.flatMap((g: any) => g.active.map((e: any) => e.changeId))
    ).toEqual(['narrow-a']);
  });

  it('prints a projects rollup in both human and JSON forms', async () => {
    const humanResult = expectOk(
      await runCLI(
        ['store', 'projects', '--store', f.storeId],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    const jsonResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'projects', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );

    expect(humanResult.stdout).toContain(f.storeId);
    expect(humanResult.stdout).toContain(PROJECT_A);
    expect(humanResult.stdout).toContain(PROJECT_B);

    expect(jsonResult.storeId).toBe(f.storeId);
    expect(jsonResult.projects.length).toBe(2);
  });

  it('reports an incomplete result with unsearched refs', async () => {
    seedAndCommit(PROJECT_A, LINE, 'incomplete-test', 'a1'.repeat(16));
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);

    // Re-point the main line at a missing ref so the result is incomplete.
    f.writeTargetLine({
      id: LINE_MAIN,
      storeRef: 'refs/heads/does-not-exist',
      codeRefs: { [PROJECT_A]: 'refs/heads/main' },
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'break main ref']);

    const humanResult = expectOk(
      await runCLI(
        ['store', 'changes', '--store', f.storeId],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    const jsonResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'changes', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );

    expect(jsonResult.complete).toBe(false);
    expect(jsonResult.unsearchedRefs.length).toBeGreaterThan(0);
    // The human form shows the INCOMPLETE banner.
    expect(humanResult.stdout).toContain('INCOMPLETE');
  });
});
