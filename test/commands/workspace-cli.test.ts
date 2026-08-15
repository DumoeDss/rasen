/**
 * `store-planning-worktree-bindings` task 11.7 — `rasen store workspace`.
 *
 * The group is a SUBCOMMAND of `store`, not a top-level one: `workspace` is a
 * retired top-level command name that `legacy-groups-removed.test.ts` keeps
 * dead, and a workspace pair is Store content in any case.
 *
 * What is asserted here is the adapter, not the rules: every flag reaches the
 * Module, the plan preview is the full action and precondition table with the
 * same content in both forms, plan-then-apply works through a stored plan id,
 * a preview writes nothing, and a refusal exits 1 with one JSON document.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';

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

describe('rasen store workspace CLI', () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-cli-',
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
    planningWorktree = f.beside('store-planning-redesign');
    executionWorktree = f.beside('app-a-redesign');
  });

  afterEach(() => {
    f.cleanup();
  });

  function run(argv: readonly string[]): Promise<RunCLIResult> {
    return runCLI([...argv], { cwd: f.storeRoot, env: f.env });
  }

  function planArgv(extra: readonly string[] = []): readonly string[] {
    return [
      'store',
      'workspace',
      'plan',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
      '--change',
      CHANGE,
      '--planning-worktree',
      planningWorktree,
      '--execution-worktree',
      executionWorktree,
      ...extra,
    ];
  }

  it('lives under `store`, and the retired top-level name stays retired', async () => {
    const help = expectOk(await run(['store', '--help']));
    expect(help.stdout).toMatch(/^\s*workspace\s/mu);

    const topLevel = await run(['workspace', 'plan']);
    expect(topLevel.exitCode).not.toBe(0);
    expect(`${topLevel.stdout}${topLevel.stderr}`).toContain("unknown command 'workspace'");
  });

  it('renders the full action and precondition table, with the same content as --json', async () => {
    const human = expectOk(await run(planArgv()));
    const json = parseJson(expectOk(await run(planArgv(['--json']))));

    expect(json.applicable).toBe(true);
    expect(human.stdout).toContain(`plan id: ${json.planId}`);
    expect(human.stdout).toContain(`intent:  ${json.intent}`);
    // Every action and every precondition the JSON carries is printed.
    for (const action of json.actions) {
      expect(human.stdout, action.kind).toContain(action.kind);
      expect(human.stdout, action.destination).toContain(action.destination);
    }
    for (const entry of json.preconditions) {
      expect(human.stdout, entry.id).toContain(entry.id);
    }
    expect(human.stdout).toContain(
      `rasen store workspace apply --apply-plan ${json.planId}`
    );
    expect(human.stdout).toContain('never moves a ref, a HEAD, or a working tree');
  });

  it('previews without creating a worktree, and stores the plan for the apply step', async () => {
    const json = parseJson(expectOk(await run(planArgv(['--json']))));

    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);
    expect(f.git(f.storeRoot, ['worktree', 'list']).trim().split('\n')).toHaveLength(1);
    expect(
      fs.existsSync(
        path.join(f.globalDataDir, 'planning-workspaces', 'plans', `${json.planId}.json`)
      )
    ).toBe(true);
    // The catalog is untouched and nothing is staged anywhere.
    expect(f.git(f.storeRoot, ['status', '--porcelain'])).toBe('');
  });

  it('applies a stored plan id and prepares both worktrees', async () => {
    const planned = parseJson(expectOk(await run(planArgv(['--json']))));

    const applied = parseJson(
      expectOk(
        await run(['store', 'workspace', 'apply', '--apply-plan', planned.planId, '--json'])
      )
    );

    expect(applied.bindingState).toBe('prepared');
    expect([...applied.created].sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(fs.existsSync(path.join(planningWorktree, '.rasen', 'planning-line.json'))).toBe(true);
    expect(fs.existsSync(path.join(executionWorktree, '.rasen', 'planning-binding.json'))).toBe(
      true
    );
    // Preparation writes nothing Git-tracked, so it suggests no commit.
    expect(applied.suggestedCommits).toEqual([]);
  });

  it('refuses an apply with no --apply-plan and names the flag', async () => {
    const result = await run(['store', 'workspace', 'apply', '--json']);
    expect(result.exitCode).toBe(1);
    const json = parseJson(result);
    expect(json.workspace).toBeNull();
    expect(json.status[0].code).toBe('workspace_plan_missing');
    expect(json.status[0].fix).toContain('rasen store workspace plan');
  });

  it('refuses a plan with no --change', async () => {
    const result = await run([
      'store',
      'workspace',
      'plan',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
      '--json',
    ]);
    expect(result.exitCode).toBe(1);
    expect(parseJson(result).status[0].code).toBe('workspace_plan_not_applicable');
  });

  it('exits 1 and prints every blocker when the plan is not applicable', async () => {
    fs.mkdirSync(planningWorktree, { recursive: true });
    fs.writeFileSync(path.join(planningWorktree, 'stray.txt'), 'occupied\n', 'utf8');

    const human = await run(planArgv());
    const json = parseJson(await run(planArgv(['--json'])));

    expect(human.exitCode).toBe(1);
    expect(json.applicable).toBe(false);
    expect(json.token).toBeUndefined();
    expect(json.blockers.length).toBeGreaterThan(0);
    for (const blocker of json.blockers) {
      expect(human.stdout, blocker.id).toContain(blocker.id);
      expect(human.stdout, blocker.id).toContain('[unsatisfied]');
    }
    expect(human.stdout).toContain('There is no --force');
  });

  it('reports a scope with no prepared workspace, in both forms', async () => {
    const argv = [
      'store',
      'workspace',
      'show',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
    ];
    const human = expectOk(await run(argv));
    const json = parseJson(expectOk(await run([...argv, '--json'])));

    expect(json.bindingState).toBe('unbound');
    expect(json.prepared).toBe(false);
    expect(human.stdout).toContain('Workspace — unbound');
    expect(human.stdout).toContain('No workspace is prepared for project');
  });

  it(
    'does not claim a scope with two prepared pairs has none, when --change names neither',
    async () => {
      // The sibling surface of the same contradiction `rasen context` had:
      // `prepared: false` here means "no pair was named", and printing "No
      // workspace is prepared" above a finding that names two of them states
      // the opposite of the answer.
      for (const [changeId, planningName, executionName] of [
        ['add-billing', 'store-planning-billing', 'app-a-billing'],
        ['zebra-fix', 'store-planning-zebra', 'app-a-zebra'],
      ] as const) {
        const planned = parseJson(
          expectOk(
            await run([
              'store',
              'workspace',
              'plan',
              '--store',
              f.storeId,
              '--project',
              PROJECT,
              '--target-line',
              LINE,
              '--change',
              changeId,
              '--planning-worktree',
              f.beside(planningName),
              '--execution-worktree',
              f.beside(executionName),
              '--json',
            ])
          )
        );
        expectOk(
          await run(['store', 'workspace', 'apply', '--apply-plan', planned.planId, '--json'])
        );
      }

      const argv = [
        'store',
        'workspace',
        'show',
        '--store',
        f.storeId,
        '--project',
        PROJECT,
        '--target-line',
        LINE,
      ];
      const human = expectOk(await run(argv));
      const json = parseJson(expectOk(await run([...argv, '--json'])));

      expect(json.prepared).toBe(false);
      expect(json.findings.map((entry: { code: string }) => entry.code)).toContain(
        'workspace_binding_ambiguous'
      );
      expect(human.stdout).not.toContain('No workspace is prepared');
      expect(human.stdout).toContain('has 2 prepared workspaces');
    },
    120_000
  );

  it('reports a prepared pair with both roots, refs, and instance ids', async () => {
    const planned = parseJson(expectOk(await run(planArgv(['--json']))));
    expectOk(await run(['store', 'workspace', 'apply', '--apply-plan', planned.planId, '--json']));

    const argv = [
      'store',
      'workspace',
      'show',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
      '--change',
      CHANGE,
    ];
    const human = expectOk(await run(argv));
    const json = parseJson(expectOk(await run([...argv, '--json'])));

    expect(json.bindingState).toBe('prepared');
    expect(json.planning.root).toBe(planningWorktree);
    expect(json.execution.root).toBe(executionWorktree);
    for (const fact of [
      json.planning.root,
      json.execution.root,
      json.planning.worktreeInstanceId,
      json.execution.worktreeInstanceId,
      json.planning.ref,
      json.planning.headOid,
    ]) {
      expect(human.stdout, String(fact)).toContain(String(fact));
    }
  });

  // Explicit budget, not the 30s default. This case drives three full cleanup
  // previews and one apply through real Git and four CLI subprocesses; measured
  // at 20.2s, then 25.1s in isolation on a busier host and 29.6s under batch
  // contention. Left on the default it is the first case in this change to fail
  // on a slower CI, where a budget overrun would read as a defect.
  it('previews a cleanup, refuses an unsafe one, and removes a safe one by plan id', async () => {
    const planned = parseJson(expectOk(await run(planArgv(['--json']))));
    expectOk(await run(['store', 'workspace', 'apply', '--apply-plan', planned.planId, '--json']));

    const cleanupArgv = [
      'store',
      'workspace',
      'cleanup',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
      '--change',
      CHANGE,
    ];

    // Unsafe: an untracked file the user would lose.
    fs.writeFileSync(path.join(executionWorktree, 'scratch.txt'), 'not in git\n', 'utf8');
    const refusedHuman = await run(cleanupArgv);
    const refused = parseJson(await run([...cleanupArgv, '--json']));
    expect(refusedHuman.exitCode).toBe(1);
    expect(refused.applicable).toBe(false);
    expect(refusedHuman.stdout).toContain('There is no --force and no partial removal.');
    expect(refusedHuman.stdout).toContain('untracked: scratch.txt');
    expect(fs.existsSync(executionWorktree)).toBe(true);

    // Accepted: the same plan with the untracked list explicitly accepted.
    const accepted = parseJson(
      expectOk(await run([...cleanupArgv, '--include-untracked', '--json']))
    );
    expect(accepted.applicable).toBe(true);
    const removed = parseJson(
      expectOk(
        await run([
          'store',
          'workspace',
          'cleanup',
          '--apply-plan',
          accepted.planId,
          '--json',
        ])
      )
    );
    expect(removed.phase).toBe('complete');
    expect([...removed.removed].sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);
  }, 120_000);

  it('refuses cleanup while a live session references a recorded worktree, with nothing threaded in', async () => {
    // The load-bearing half of this case is what it does NOT do: no
    // `globalDataDir` is supplied anywhere, because `src/commands/workspace.ts`
    // supplies none either — it constructs `new StoreWorkspace()` with no
    // options and calls `planCleanup` with no machine root. The unit fixture
    // always passes that argument, so a session scan that only runs when it is
    // present was invisible to every unit test while being inert in production,
    // and cleanup would have removed a worktree with a session live inside it.
    const planned = parseJson(expectOk(await run(planArgv(['--json']))));
    expectOk(await run(['store', 'workspace', 'apply', '--apply-plan', planned.planId, '--json']));

    const contextPath = path.join(f.globalDataDir, 'sessions', 'sess_live', 'context.json');
    fs.mkdirSync(path.dirname(contextPath), { recursive: true });
    fs.writeFileSync(
      contextPath,
      `${JSON.stringify(
        {
          version: 2,
          execution: { root: executionWorktree, worktree: { root: executionWorktree } },
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const cleanupArgv = [
      'store',
      'workspace',
      'cleanup',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
      '--change',
      CHANGE,
    ];
    const human = await run(cleanupArgv);
    const json = parseJson(await run([...cleanupArgv, '--json']));

    expect(human.exitCode).toBe(1);
    expect(json.applicable).toBe(false);
    expect(json.token).toBeUndefined();
    expect(json.blockers.map((blocker: { id: string }) => blocker.id)).toContain(
      'execution-7-no-live-session'
    );
    const blocker = json.blockers.find(
      (entry: { id: string }) => entry.id === 'execution-7-no-live-session'
    );
    expect(blocker.detail).toContain(executionWorktree);
    expect(human.stdout).toContain('execution-7-no-live-session');
    // Both worktrees survive, and there is no token to apply.
    expect(fs.existsSync(executionWorktree)).toBe(true);
    expect(fs.existsSync(planningWorktree)).toBe(true);
  });

  it('accepts --existing-change, which is the only way to reach that intent', async () => {
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: CHANGE,
    });
    const human = expectOk(await run(planArgv(['--existing-change'])));
    const json = parseJson(expectOk(await run(planArgv(['--existing-change', '--json']))));
    expect(json.intent).toBe('existing-change');
    // The VERIFIED instance is part of the preview in both forms; without it an
    // agent cannot see which Change the plan is about to bind.
    expect(json.changeInstanceId).toMatch(/^ci_/u);
    expect(human.stdout).toContain(json.changeInstanceId);
    expect(human.stdout).toContain('intent:  existing-change');
  });

  it('omits the Change instance from the preview when the plan mints one', async () => {
    const human = expectOk(await run(planArgv()));
    const json = parseJson(expectOk(await run(planArgv(['--json']))));
    // Absent facts are ABSENT, never null and never guessed.
    expect(json.intent).toBe('new-change');
    expect('changeInstanceId' in json).toBe(false);
    expect(human.stdout).not.toContain('instance:');
  });
});
