/**
 * `store-planning-worktree-bindings` tasks 12.2 and 12.3 — the two properties
 * the accepted design names as this slice's completion criteria.
 *
 * 12.2 Two target lines of one Store are independent: they do not serialize
 *      against each other, and neither sees the other's unmerged planning
 *      content. Independence is proven deterministically by holding one line's
 *      scope lock with a live owner and showing the other line still proceeds —
 *      a wall-clock race would only ever be suggestive.
 *
 * 12.3 A branch is a LOCATOR. Renaming one with plain Git leaves the Change
 *      instance resolvable through committed metadata and the machine index,
 *      and no code path parses the branch name for a project or a line.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  scopeLockKey,
  workspaceLockPath,
} from '../../src/core/store/workspace/locks.js';
import { completeChangeBinding } from '../../src/core/store/workspace/module.js';
import { readWorkspaceIndexEntry } from '../../src/core/store/workspace/registry.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE_02 = 'line-0.2';
const LINE_03 = 'line-0.3';
const TIMEOUT_MS = 120_000;

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

describe('Store v2 workspace: two lines, and a renamed branch', () => {
  let f: StoreWorkspaceFixture;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-concurrency-',
      projects: [PROJECT],
      storeBranches: ['release/0.2', 'release/0.3'],
      projectBranches: ['release/0.2', 'release/0.3'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
        {
          id: LINE_03,
          storeRef: 'refs/heads/release/0.3',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.3' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function run(argv: readonly string[]): Promise<RunCLIResult> {
    return runCLI([...argv], { cwd: f.storeRoot, env: f.env });
  }

  function planArgv(line: string, changeId: string): readonly string[] {
    return [
      'store',
      'workspace',
      'plan',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      line,
      '--change',
      changeId,
      '--planning-worktree',
      f.beside(`store-planning-${changeId}`),
      '--execution-worktree',
      f.beside(`app-a-${changeId}`),
      '--json',
    ];
  }

  it(
    'prepares two lines concurrently, and neither sees the other planning content',
    async () => {
      // Both plans are produced in flight at the same time...
      const [planA, planB] = await Promise.all([
        run(planArgv(LINE_02, 'alpha')),
        run(planArgv(LINE_03, 'beta')),
      ]);
      const alpha = parseJson(expectOk(planA));
      const beta = parseJson(expectOk(planB));
      expect(alpha.scope.targetLineId).toBe(LINE_02);
      expect(beta.scope.targetLineId).toBe(LINE_03);
      // Different lines are different planning scopes, which is what makes them
      // different lock keys.
      expect(alpha.scope.planningScopeId).not.toBe(beta.scope.planningScopeId);

      // ...and so are both applies.
      const [applyA, applyB] = await Promise.all([
        run(['store', 'workspace', 'apply', '--apply-plan', alpha.planId, '--json']),
        run(['store', 'workspace', 'apply', '--apply-plan', beta.planId, '--json']),
      ]);
      expectOk(applyA);
      expectOk(applyB);

      const planningAlpha = f.beside('store-planning-alpha');
      const planningBeta = f.beside('store-planning-beta');
      expect(fs.existsSync(planningAlpha)).toBe(true);
      expect(fs.existsSync(planningBeta)).toBe(true);
      expect(f.git(planningAlpha, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
        `refs/heads/change/${LINE_02}/${PROJECT}/alpha`
      );
      expect(f.git(planningBeta, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
        `refs/heads/change/${LINE_03}/${PROJECT}/beta`
      );

      // Unmerged planning content in one line's worktree is invisible in the
      // other's, and in the integration checkout.
      const alphaChange = path.join(
        planningAlpha,
        'rasen',
        'projects',
        PROJECT,
        'changes',
        'alpha'
      );
      f.write(path.join(alphaChange, 'proposal.md'), '## Why\n\nalpha\n');
      expect(
        fs.existsSync(path.join(planningBeta, 'rasen', 'projects', PROJECT, 'changes', 'alpha'))
      ).toBe(false);
      expect(
        fs.existsSync(path.join(f.storeRoot, 'rasen', 'projects', PROJECT, 'changes', 'alpha'))
      ).toBe(false);

      // Each pair has its own index entry, in its own per-scope document.
      const coordination = f.dependencies.coordination(f.globalDataDir);
      const entryA = await readWorkspaceIndexEntry(
        coordination,
        f.planningScopeId(PROJECT, LINE_02),
        'alpha'
      );
      const entryB = await readWorkspaceIndexEntry(
        coordination,
        f.planningScopeId(PROJECT, LINE_03),
        'beta'
      );
      expect(entryA?.planning.root).toBe(planningAlpha);
      expect(entryB?.planning.root).toBe(planningBeta);
      expect(entryA?.targetLineId).toBe(LINE_02);
      expect(entryB?.targetLineId).toBe(LINE_03);
    },
    TIMEOUT_MS
  );

  it(
    'does not serialize one line behind another line held lock',
    async () => {
      const alpha = parseJson(expectOk(await run(planArgv(LINE_02, 'alpha'))));
      const beta = parseJson(expectOk(await run(planArgv(LINE_03, 'beta'))));

      // A live holder on line 0.2's scope lock. This process is provably alive,
      // so the lock is never stolen and never expires within the deadline.
      const held = workspaceLockPath(
        f.dependencies.coordination(f.globalDataDir),
        scopeLockKey({ storeUid: f.storeUid, projectId: PROJECT, targetLineId: LINE_02 })
      );
      fs.mkdirSync(path.dirname(held), { recursive: true });
      fs.writeFileSync(held, `holder: another rasen command\npid: ${process.pid}\n`, 'utf8');

      // Line 0.3 proceeds to completion while line 0.2's lock is held. If the
      // two shared a lock, this would block until the deadline and then fail.
      expectOk(await run(['store', 'workspace', 'apply', '--apply-plan', beta.planId, '--json']));
      expect(fs.existsSync(f.beside('store-planning-beta'))).toBe(true);

      // ...and line 0.2 itself waits and then reports the holder by name.
      const blocked = await run([
        'store',
        'workspace',
        'apply',
        '--apply-plan',
        alpha.planId,
        '--json',
      ]);
      expect(blocked.exitCode).toBe(1);
      const diagnostic = parseJson(blocked).status[0];
      expect(diagnostic.code).toBe('workspace_lock_unavailable');
      expect(diagnostic.message).toContain('another rasen command');
      expect(fs.existsSync(f.beside('store-planning-alpha'))).toBe(false);
      // The lock was reported, never stolen.
      expect(fs.readFileSync(held, 'utf8')).toContain(`pid: ${process.pid}`);
    },
    TIMEOUT_MS
  );

  it(
    'keeps a Change resolvable after its planning branch is renamed, and parses no branch name',
    async () => {
      const alpha = parseJson(expectOk(await run(planArgv(LINE_02, 'alpha'))));
      expectOk(await run(['store', 'workspace', 'apply', '--apply-plan', alpha.planId, '--json']));
      const planningRoot = f.beside('store-planning-alpha');

      const seeded = f.seedChange({
        root: planningRoot,
        projectId: PROJECT,
        targetLineId: LINE_02,
        changeId: 'alpha',
      });
      const bound = await completeChangeBinding(
        {
          storeUid: f.storeUid,
          storeId: f.storeId,
          projectId: PROJECT,
          targetLineId: LINE_02,
          planningScopeId: f.planningScopeId(PROJECT, LINE_02),
          changeId: 'alpha',
          changeInstanceId: seeded.instanceId,
          planningRoot,
          globalDataDir: f.globalDataDir,
        },
        f.dependencies
      );
      expect(bound.bindingState).toBe('bound');

      // Rename the branch with plain Git — and rename it to something that
      // embeds a DIFFERENT line and project, which is the only way to prove
      // nothing reads it.
      f.git(planningRoot, [
        'branch',
        '-m',
        `change/${LINE_03}/some-other-project/some-other-change`,
      ]);
      expect(f.git(planningRoot, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
        `refs/heads/change/${LINE_03}/some-other-project/some-other-change`
      );

      // The committed identity is untouched: it derives from the scope and the
      // seed, and a branch name is not an input to either.
      const metadata = fs.readFileSync(
        path.join(planningRoot, 'rasen', 'projects', PROJECT, 'changes', 'alpha', '.openspec.yaml'),
        'utf8'
      );
      expect(metadata).toContain(`instanceId: ${JSON.stringify(seeded.instanceId)}`);
      expect(metadata).toContain(`targetLineId: ${JSON.stringify(LINE_02)}`);
      expect(metadata).toContain(`projectId: ${JSON.stringify(PROJECT)}`);

      // The machine index still resolves the same Change instance and pair, in
      // the scope it was always in.
      const entry = await readWorkspaceIndexEntry(
        f.dependencies.coordination(f.globalDataDir),
        f.planningScopeId(PROJECT, LINE_02),
        'alpha'
      );
      expect(entry?.changeInstanceId).toBe(seeded.instanceId);
      expect(entry?.workspacePairId).toBe(bound.workspacePairId);
      expect(entry?.targetLineId).toBe(LINE_02);
      expect(entry?.projectId).toBe(PROJECT);

      // `show` reports the same instance and pair, and reports the rename as
      // ref DRIFT rather than losing or re-pointing the Change.
      const shown = parseJson(
        expectOk(
          await run([
            'store',
            'workspace',
            'show',
            '--store',
            f.storeId,
            '--project',
            PROJECT,
            '--target-line',
            LINE_02,
            '--change',
            'alpha',
            '--json',
          ])
        )
      );
      expect(shown.changeInstanceId).toBe(seeded.instanceId);
      expect(shown.workspacePairId).toBe(bound.workspacePairId);
      expect(shown.bindingState).toBe('drifted');
      const drift = shown.findings.find(
        (finding: { code: string }) => finding.code === 'workspace_ref_drift'
      );
      expect(drift.expected).toBe(`refs/heads/change/${LINE_02}/${PROJECT}/alpha`);
      expect(drift.actual).toBe(
        `refs/heads/change/${LINE_03}/some-other-project/some-other-change`
      );

      // And the line the branch name now advertises was NOT adopted: line 0.3
      // still has no workspace at all.
      const other = parseJson(
        expectOk(
          await run([
            'store',
            'workspace',
            'show',
            '--store',
            f.storeId,
            '--project',
            PROJECT,
            '--target-line',
            LINE_03,
            '--json',
          ])
        )
      );
      expect(other.prepared).toBe(false);
      expect(other.bindingState).toBe('unbound');
    },
    TIMEOUT_MS
  );
});
