/**
 * `store-planning-worktree-bindings` task 12.1 — the end-to-end journey.
 *
 * One migrated Store with two target lines and two projects, driven through
 * target-line authoring, workspace plan/apply, Change creation, context
 * inspection, and cleanup, entirely through the real CLI. The Module's own
 * suites can prove a unit correct; only this proves the wiring, which is the
 * exact gap that shipped child 3's `apply` broken.
 *
 * Everything asserted here is asserted LITERALLY — destinations are rebuilt
 * with `path.join` from the fixture's own roots, never read back from the code
 * under test.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  getGlobalDataDir,
  parseProjectId,
  parseTargetLineId,
  writeStoreRegistryState,
} from '../../src/core/index.js';
import { writeProjectRegistryState } from '../../src/core/project-registry.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const STORE_ID = 'team-store';
const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE_02 = 'line-0.2';
const LINE_03 = 'line-0.3';

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

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

describe('Store v2 workspace CLI journey', () => {
  let tempDir: string;
  let storeRoot: string;
  let projectARoot: string;
  let projectBRoot: string;
  let storeUid: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;

  function runGit(cwd: string, args: readonly string[]): string {
    return execFileSync('git', ['-C', cwd, ...args], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    });
  }

  function seedRepository(root: string, branches: readonly string[]): void {
    fs.mkdirSync(root, { recursive: true });
    runGit(root, ['init', '--initial-branch=main']);
    write(path.join(root, 'README.md'), `# ${path.basename(root)}\n`);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-m', 'seed']);
    for (const branch of branches) runGit(root, ['branch', branch]);
  }

  function writeProjectCatalog(projectId: string): void {
    write(
      path.join(storeRoot, '.rasen-store', 'projects', `${projectId}.yaml`),
      [
        'version: 2',
        `projectId: ${projectId}`,
        `id: ${projectId}`,
        'roles:',
        '  planning: true',
        '  knowledge: false',
        'planningBinding:',
        '  state: bound',
        '  boundAt: 2026-08-07T00:00:00.000Z',
        '',
      ].join('\n')
    );
  }

  function writeTargetLineCatalog(lineId: string, storeRef: string): void {
    write(
      path.join(storeRoot, '.rasen-store', 'target-lines', `${lineId}.yaml`),
      [
        'version: 1',
        `id: ${lineId}`,
        `storeRef: ${storeRef}`,
        'projects:',
        `  ${PROJECT_A}:`,
        '    codeRef: refs/heads/release/0.2',
        `  ${PROJECT_B}:`,
        '    codeRef: refs/heads/release/0.2',
        '',
      ].join('\n')
    );
  }

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workspace-journey-'))
    );
    env = {
      ...isolatedGitEnv(tempDir),
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });
    storeUid = randomUUID();
    storeRoot = path.join(tempDir, 'store-integration');
    projectARoot = path.join(tempDir, PROJECT_A);
    projectBRoot = path.join(tempDir, PROJECT_B);

    seedRepository(storeRoot, []);
    write(
      path.join(storeRoot, '.rasen-store', 'store.yaml'),
      `version: 2\nuid: ${storeUid}\nid: ${STORE_ID}\nlayoutVersion: 2\n`
    );
    writeProjectCatalog(PROJECT_A);
    writeProjectCatalog(PROJECT_B);
    writeTargetLineCatalog(LINE_02, 'refs/heads/release/0.2');
    write(
      path.join(storeRoot, 'rasen', 'projects', PROJECT_A, 'config.yaml'),
      `schema: spec-driven\nprojectId: ${PROJECT_A}\n`
    );
    write(
      path.join(storeRoot, 'rasen', 'projects', PROJECT_B, 'config.yaml'),
      `schema: spec-driven\nprojectId: ${PROJECT_B}\n`
    );
    runGit(storeRoot, ['add', '.']);
    runGit(storeRoot, ['commit', '-m', 'seed Store v2 layout']);
    runGit(storeRoot, ['branch', 'release/0.2']);
    runGit(storeRoot, ['branch', 'release/0.3']);

    for (const [root, projectId] of [
      [projectARoot, PROJECT_A],
      [projectBRoot, PROJECT_B],
    ] as const) {
      fs.mkdirSync(root, { recursive: true });
      write(
        path.join(root, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\nstore:\n  uid: ${storeUid}\n  id: ${STORE_ID}\n`
      );
      // Committed as part of the seed so the main checkout starts CLEAN: the
      // cleanup case asserts the main checkouts are untouched, which only means
      // something if they were clean to begin with.
      seedRepository(root, ['release/0.2']);
    }

    await writeStoreRegistryState(
      {
        version: 2,
        stores: {
          [storeUid]: { id: STORE_ID, backend: { type: 'git', local_path: storeRoot } },
        },
      },
      { globalDataDir }
    );
    await writeProjectRegistryState(
      {
        version: 1,
        projects: {
          [projectARoot]: {
            projectId: PROJECT_A,
            name: PROJECT_A,
            mode: 'store',
            home: `${PROJECT_A}-home`,
            lastSeen: '2026-08-07T00:00:00.000Z',
          },
          [projectBRoot]: {
            projectId: PROJECT_B,
            name: PROJECT_B,
            mode: 'store',
            home: `${PROJECT_B}-home`,
            lastSeen: '2026-08-07T00:00:00.000Z',
          },
        },
      },
      { globalDataDir }
    );
  });

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  // DEFERRED (task 6.6): this journey's `archive ... --target-line ... --dry-run`
  // step (around line 356) calls a CLI surface that does not exist on this
  // branch — `archive` has no `--target-line` option here (confirmed by
  // reading src/cli/index.ts's archive command registration; it stops at
  // `--intent-file`). That flag ships in upstream commit 3b050663, which is
  // NOT an ancestor of dev/0.2.0 and belongs to the `store-planning-scope-routing`
  // slice (archive/finalization scope resolution), explicitly out of S2's
  // scope. Running it here reproducibly fails with `error: unknown option
  // '--target-line'` (confirmed by direct run, not inferred).
  //
  // Substitute mapping — what this test actually exercises, and where the
  // S2-owned parts of it are already proved without the missing flag:
  //   - `store workspace plan --existing-change` / `apply` binding an
  //     ALREADY-CREATED Change: covered by workspace-plan.test.ts and
  //     workspace-apply.test.ts's existing-change intent cases, and at the
  //     CLI layer by workspace-cli.test.ts (none of those need `archive`).
  //   - `store workspace show` reporting bound state + pair id formula:
  //     covered directly by workspace-pairing.test.ts ("completes the pair
  //     when the Change is created, and describes it as bound").
  //   - The one step with NO S2-scoped substitute: `archive --dry-run`
  //     finding the bound pair and NOT raising `workspace_pair_unavailable`.
  //     That is a cross-slice integration check between S2's workspace index
  //     (which this change owns) and finalization's blocker computation
  //     (owned by archive.ts, out of scope here, carved out explicitly).
  //     No function in S2's scope can stand in for it, because the missing
  //     half of the wiring is not S2's code. This is recorded as an INBOUND
  //     ACCEPTANCE ITEM for whichever slice ports `archive --target-line`:
  //     re-enable this test unmodified once that flag exists.
  it.skip('binds, previews finalization, retries, and cleans up an existing Change pair', async () => {
    const changeId = 'already-created';
    const planningScopeId = derivePlanningScopeId({
      storeUid,
      projectId: parseProjectId(PROJECT_A),
      targetLineId: parseTargetLineId(LINE_02),
    });
    const instanceSeed = 'e'.repeat(32);
    const changeInstanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed });
    const changeDir = path.join(
      storeRoot,
      'rasen',
      'projects',
      PROJECT_A,
      'changes',
      changeId
    );
    const changeMetadataPath = path.join(changeDir, '.openspec.yaml');
    write(
      changeMetadataPath,
      [
        'schema: spec-driven',
        'identity:',
        '  version: 2',
        `  instanceSeed: ${JSON.stringify(instanceSeed)}`,
        `  instanceId: ${JSON.stringify(changeInstanceId)}`,
        `  storeUid: ${JSON.stringify(storeUid)}`,
        `  projectId: ${JSON.stringify(PROJECT_A)}`,
        `  targetLineId: ${JSON.stringify(LINE_02)}`,
        '',
      ].join('\n')
    );
    write(path.join(changeDir, 'proposal.md'), '## Why\n\nAlready created before workspace apply.\n');
    runGit(storeRoot, ['add', '.']);
    runGit(storeRoot, ['commit', '-m', 'seed existing Change']);
    runGit(storeRoot, ['branch', '-f', 'release/0.2', 'HEAD']);
    const changeMetadataBefore = fs.readFileSync(changeMetadataPath);

    const planningWorktree = path.join(tempDir, 'store-planning-existing');
    const executionWorktree = path.join(tempDir, 'app-a-existing');
    const selectors = [
      '--store',
      STORE_ID,
      '--project',
      PROJECT_A,
      '--target-line',
      LINE_02,
    ];
    const plan = parseJson(
      expectOk(
        await runCLI(
          [
            'store',
            'workspace',
            'plan',
            ...selectors,
            '--change',
            changeId,
            '--planning-worktree',
            planningWorktree,
            '--execution-worktree',
            executionWorktree,
            '--existing-change',
            '--json',
          ],
          { cwd: storeRoot, env }
        )
      )
    );
    expect(plan).toMatchObject({
      applicable: true,
      intent: 'existing-change',
      changeInstanceId,
    });

    const applied = parseJson(
      expectOk(
        await runCLI(
          ['store', 'workspace', 'apply', '--apply-plan', plan.planId, '--json'],
          { cwd: storeRoot, env }
        )
      )
    );
    expect(applied).toMatchObject({ bindingState: 'bound', changeInstanceId });
    expect(applied.workspacePairId).toBe(
      deriveWorkspacePairId({
        changeInstanceId,
        planningWorktreeInstanceId: applied.planning.worktreeInstanceId,
        executionWorktreeInstanceId: applied.execution.worktreeInstanceId,
      })
    );

    const shown = parseJson(
      expectOk(
        await runCLI(
          [
            'store',
            'workspace',
            'show',
            ...selectors,
            '--change',
            changeId,
            '--json',
          ],
          { cwd: executionWorktree, env }
        )
      )
    );
    expect(shown).toMatchObject({
      bindingState: 'bound',
      changeInstanceId,
      workspacePairId: applied.workspacePairId,
    });
    expect(shown.workspacePairId).toBe(
      deriveWorkspacePairId({
        changeInstanceId,
        planningWorktreeInstanceId: shown.planning.worktreeInstanceId,
        executionWorktreeInstanceId: shown.execution.worktreeInstanceId,
      })
    );

    const retry = parseJson(
      expectOk(
        await runCLI(
          ['store', 'workspace', 'apply', '--apply-plan', plan.planId, '--json'],
          { cwd: storeRoot, env }
        )
      )
    );
    expect(retry).toMatchObject({
      bindingState: 'bound',
      changeInstanceId,
      workspacePairId: applied.workspacePairId,
      created: [],
    });
    expect(runGit(storeRoot, ['worktree', 'list']).trim().split('\n')).toHaveLength(2);
    expect(runGit(projectARoot, ['worktree', 'list']).trim().split('\n')).toHaveLength(2);

    const archivePreview = parseJson(
      expectOk(
        await runCLI(
          [
            'archive',
            changeId,
            ...selectors,
            '--outcome',
            'abandoned',
            '--reason',
            'Preview existing-change finalization eligibility.',
            '--dry-run',
            '--json',
          ],
          { cwd: executionWorktree, env }
        )
      )
    ).archive.finalizationPlan;
    expect(archivePreview.blockers.map((blocker: { code: string }) => blocker.code)).not.toContain(
      'workspace_pair_unavailable'
    );

    const unrelatedChange = 'unrelated-spike';
    const unrelatedPlanning = path.join(tempDir, 'store-planning-unrelated');
    const unrelatedExecution = path.join(tempDir, 'app-b-unrelated');
    const unrelatedSelectors = [
      '--store',
      STORE_ID,
      '--project',
      PROJECT_B,
      '--target-line',
      LINE_02,
    ];
    const unrelatedPlan = parseJson(
      expectOk(
        await runCLI(
          [
            'store',
            'workspace',
            'plan',
            ...unrelatedSelectors,
            '--change',
            unrelatedChange,
            '--planning-worktree',
            unrelatedPlanning,
            '--execution-worktree',
            unrelatedExecution,
            '--json',
          ],
          { cwd: storeRoot, env }
        )
      )
    );
    expectOk(
      await runCLI(
        ['store', 'workspace', 'apply', '--apply-plan', unrelatedPlan.planId, '--json'],
        { cwd: storeRoot, env }
      )
    );
    const unrelatedScopeId = derivePlanningScopeId({
      storeUid,
      projectId: parseProjectId(PROJECT_B),
      targetLineId: parseTargetLineId(LINE_02),
    });
    const unrelatedIndexPath = path.join(
      globalDataDir,
      'planning-workspaces',
      'index',
      `${unrelatedScopeId}.json`
    );
    const unrelatedIndexBefore = fs.readFileSync(unrelatedIndexPath);

    const cleanupPlan = parseJson(
      expectOk(
        await runCLI(
          [
            'store',
            'workspace',
            'cleanup',
            ...selectors,
            '--change',
            changeId,
            '--json',
          ],
          { cwd: storeRoot, env }
        )
      )
    );
    expect(cleanupPlan.applicable, JSON.stringify(cleanupPlan.blockers)).toBe(true);
    const cleaned = parseJson(
      expectOk(
        await runCLI(
          ['store', 'workspace', 'cleanup', '--apply-plan', cleanupPlan.planId, '--json'],
          { cwd: storeRoot, env }
        )
      )
    );
    expect(cleaned.phase).toBe('complete');
    expect([...cleaned.removed].sort()).toEqual(
      [executionWorktree, planningWorktree].sort()
    );
    expect(cleaned.indexEntryRemoved).toBe(true);
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);
    expect(fs.existsSync(unrelatedPlanning)).toBe(true);
    expect(fs.existsSync(unrelatedExecution)).toBe(true);
    expect(fs.readFileSync(unrelatedIndexPath).equals(unrelatedIndexBefore)).toBe(true);

    const cleanedIndexPath = path.join(
      globalDataDir,
      'planning-workspaces',
      'index',
      `${planningScopeId}.json`
    );
    const cleanedEntries = fs.existsSync(cleanedIndexPath)
      ? JSON.parse(fs.readFileSync(cleanedIndexPath, 'utf8')).entries
      : [];
    expect(
      cleanedEntries.some((entry: { changeId: string }) => entry.changeId === changeId)
    ).toBe(false);
    expect(fs.readFileSync(changeMetadataPath).equals(changeMetadataBefore)).toBe(true);
    expect(runGit(storeRoot, ['show-ref', '--verify', `refs/heads/change/${LINE_02}/${PROJECT_A}/${changeId}`])).not.toBe('');
    expect(runGit(projectARoot, ['show-ref', '--verify', `refs/heads/change/${LINE_02}/${PROJECT_A}/${changeId}`])).not.toBe('');
    expect(runGit(storeRoot, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe('refs/heads/main');
    expect(runGit(projectARoot, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      'refs/heads/main'
    );
    expect(runGit(storeRoot, ['status', '--porcelain'])).toBe('');
    expect(runGit(projectARoot, ['status', '--porcelain'])).toBe('');
  }, 240_000);

  // DEFERRED (task 6.6): this journey's "---- bind the Change ----" step
  // (around line 692) calls `new change ... --target-line LINE_02`, and `new
  // change` has no `--target-line` option on this branch (same upstream gap
  // as the sibling test above — commit 3b050663, store-planning-scope-routing
  // slice, out of S2's scope). Confirmed by direct run: `error: unknown
  // option '--target-line'`. Everything BEFORE the bind step (authoring
  // LINE_03 via `store target-line add`, `store target-line show`/`list`,
  // `store workspace plan`/`apply` preparing the pair) is pure S2 surface and
  // is not itself blocked; the test is skipped as a whole because binding is
  // its load-bearing middle step and every assertion after it depends on the
  // Change instance that step mints.
  //
  // Substitute mapping:
  //   - The bind step itself (`completeChangeBinding` completing a prepared
  //     pair into `bound`, with the derived `workspacePairId`): covered
  //     directly by workspace-pairing.test.ts ("completes the pair when the
  //     Change is created, and describes it as bound").
  //   - The "refuses a second Change" step later in this test
  //     (`assertPlanningWorktreeUnbound`): covered directly by
  //     workspace-pairing.test.ts ("refuses a second Change in a bound
  //     planning worktree, from the record and not a scan").
  //   - `store workspace show`/`describe` reporting the bound pair: covered
  //     by the same workspace-pairing.test.ts case plus
  //     workspace-baseline.test.ts's own passing cases.
  //   - The unsafe-cleanup refusal (`workspace_cleanup_unsafe`) after
  //     binding: covered independently by workspace-cleanup.test.ts, which
  //     does not depend on `new change --target-line` to reach that state.
  //   - `store target-line add`/`show`/`list` CLI plumbing exercised before
  //     the bind step: covered by workspace-cli.test.ts and
  //     target-lines.test.ts (unit level), neither gated on the missing flag.
  //   INBOUND ACCEPTANCE ITEM for the slice that ports `new change
  //   --target-line`: re-enable this test unmodified once that flag exists.
  it.skip('authors a line, prepares a pair, binds a Change, reports it, and refuses an unsafe cleanup', async () => {
    // ---- target lines ---------------------------------------------------
    const added = expectOk(
      await runCLI(
        [
          'store',
          'target-line',
          'add',
          LINE_03,
          '--store',
          STORE_ID,
          '--store-ref',
          'refs/heads/release/0.3',
          '--project',
          PROJECT_A,
          '--code-ref',
          'refs/heads/release/0.2',
          '--json',
        ],
        { cwd: storeRoot, env }
      )
    );
    const addedJson = parseJson(added);
    const line03Catalog = path.join(
      storeRoot,
      '.rasen-store',
      'target-lines',
      `${LINE_03}.yaml`
    );
    expect(addedJson.path).toBe(line03Catalog);
    expect(fs.existsSync(line03Catalog)).toBe(true);
    expect(addedJson.suggestedCommits[0].command).toContain('git -C');
    // The catalog is Git-tracked content, so the command writes the file and
    // stages NOTHING: the index must still be empty of it.
    expect(runGit(storeRoot, ['diff', '--cached', '--name-only'])).toBe('');

    const duplicate = await runCLI(
      [
        'store',
        'target-line',
        'add',
        LINE_03,
        '--store',
        STORE_ID,
        '--store-ref',
        'refs/heads/main',
        '--json',
      ],
      { cwd: storeRoot, env }
    );
    expect(duplicate.exitCode).toBe(1);
    expect(parseJson(duplicate).status[0].code).toBe('target_line_exists');
    // The refused authoring left the existing catalog byte-identical.
    expect(fs.readFileSync(line03Catalog, 'utf8')).toContain('refs/heads/release/0.3');

    // A branch that merely LOOKS like a line is never a line.
    runGit(storeRoot, ['branch', 'line-9.9']);
    const unknownLine = await runCLI(
      ['store', 'target-line', 'show', 'line-9.9', '--store', STORE_ID, '--json'],
      { cwd: storeRoot, env }
    );
    expect(unknownLine.exitCode).toBe(1);
    expect(parseJson(unknownLine).status[0].code).toBe('target_line_unknown');

    const listed = expectOk(
      await runCLI(['store', 'target-line', 'list', '--store', STORE_ID, '--json'], {
        cwd: storeRoot,
        env,
      })
    );
    expect(
      parseJson(listed).targetLines.map((entry: { targetLineId: string }) => entry.targetLineId)
    ).toEqual([LINE_02, LINE_03]);

    // ---- plan -------------------------------------------------------------
    const planningWorktree = path.join(tempDir, 'store-planning-redesign');
    const executionWorktree = path.join(tempDir, 'app-a-redesign');
    const planResult = expectOk(
      await runCLI(
        [
          'store',
          'workspace',
          'plan',
          '--store',
          STORE_ID,
          '--project',
          PROJECT_A,
          '--target-line',
          LINE_02,
          '--change',
          'redesign-routing',
          '--planning-worktree',
          planningWorktree,
          '--execution-worktree',
          executionWorktree,
          '--json',
        ],
        { cwd: storeRoot, env }
      )
    );
    const plan = parseJson(planResult);
    expect(plan.applicable).toBe(true);
    expect(plan.planning.root).toBe(planningWorktree);
    expect(plan.execution.root).toBe(executionWorktree);
    expect(plan.planning.ref).toBe(
      `refs/heads/change/${LINE_02}/${PROJECT_A}/redesign-routing`
    );
    // Both created worktrees are created FROM a commit OID, never from a ref
    // name that could move underneath the apply.
    expect(plan.planning.fromOid).toMatch(/^[0-9a-f]{40}$/u);
    expect(plan.execution.fromOid).toMatch(/^[0-9a-f]{40}$/u);
    expect(plan.execution.fromOid).not.toBe(plan.planning.fromOid);
    // Planning is read-only against both repositories.
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);

    // The same inputs produce the same plan id.
    const replanned = expectOk(
      await runCLI(
        [
          'store',
          'workspace',
          'plan',
          '--store',
          STORE_ID,
          '--project',
          PROJECT_A,
          '--target-line',
          LINE_02,
          '--change',
          'redesign-routing',
          '--planning-worktree',
          planningWorktree,
          '--execution-worktree',
          executionWorktree,
          '--json',
        ],
        { cwd: storeRoot, env }
      )
    );
    expect(parseJson(replanned).planId).toBe(plan.planId);

    // ---- apply ------------------------------------------------------------
    const applied = expectOk(
      await runCLI(['store', 'workspace', 'apply', '--apply-plan', plan.planId, '--json'], {
        cwd: storeRoot,
        env,
      })
    );
    const prepared = parseJson(applied);
    expect(prepared.bindingState).toBe('prepared');
    expect(prepared.created.sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(fs.existsSync(path.join(planningWorktree, '.rasen', 'planning-line.json'))).toBe(
      true
    );
    expect(
      fs.existsSync(path.join(executionWorktree, '.rasen', 'planning-binding.json'))
    ).toBe(true);
    expect(runGit(planningWorktree, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      `refs/heads/change/${LINE_02}/${PROJECT_A}/redesign-routing`
    );
    // Neither main checkout moved.
    expect(runGit(storeRoot, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      'refs/heads/main'
    );
    expect(runGit(projectARoot, ['symbolic-ref', '--quiet', 'HEAD']).trim()).toBe(
      'refs/heads/main'
    );

    // Re-applying the same token completes rather than duplicating.
    const reapplied = expectOk(
      await runCLI(['store', 'workspace', 'apply', '--apply-plan', plan.planId, '--json'], {
        cwd: storeRoot,
        env,
      })
    );
    expect(parseJson(reapplied).created).toEqual([]);

    // ---- bind the Change --------------------------------------------------
    const created = expectOk(
      await runCLI(
        [
          'new',
          'change',
          'redesign-routing',
          '--description',
          'Prepared through a bound workspace pair.',
          '--json',
          '--store',
          STORE_ID,
          '--project',
          PROJECT_A,
          '--target-line',
          LINE_02,
        ],
        { cwd: planningWorktree, env }
      )
    );
    const createdJson = parseJson(created);
    expect(createdJson.change.path).toBe(
      path.join(planningWorktree, 'rasen', 'projects', PROJECT_A, 'changes', 'redesign-routing')
    );

    const planningScopeId = derivePlanningScopeId({
      storeUid,
      projectId: parseProjectId(PROJECT_A),
      targetLineId: parseTargetLineId(LINE_02),
    });
    const indexPath = path.join(
      globalDataDir,
      'planning-workspaces',
      'index',
      `${planningScopeId}.json`
    );
    const indexDocument = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
      entries: Array<{
        changeId: string;
        changeInstanceId?: string;
        workspacePairId?: string;
        planning: { root: string };
        execution: { root: string };
      }>;
    };
    const entry = indexDocument.entries.find(
      (candidate) => candidate.changeId === 'redesign-routing'
    );
    expect(entry?.planning.root).toBe(planningWorktree);
    expect(entry?.execution.root).toBe(executionWorktree);
    expect(entry?.changeInstanceId).toMatch(/^ci_[0-9a-f]{64}$/u);
    expect(entry?.workspacePairId).toMatch(/^wp_[0-9a-f]{64}$/u);

    // A SECOND Change in the same planning worktree is refused.
    const second = await runCLI(
      [
        'new',
        'change',
        'second-change',
        '--json',
        '--store',
        STORE_ID,
        '--project',
        PROJECT_A,
        '--target-line',
        LINE_02,
      ],
      { cwd: planningWorktree, env }
    );
    expect(second.exitCode).toBe(1);
    expect(parseJson(second).status[0].code).toBe('workspace_already_bound');
    expect(
      fs.existsSync(
        path.join(planningWorktree, 'rasen', 'projects', PROJECT_A, 'changes', 'second-change')
      )
    ).toBe(false);

    // ---- report -----------------------------------------------------------
    const shown = expectOk(
      await runCLI(
        [
          'store',
          'workspace',
          'show',
          '--store',
          STORE_ID,
          '--project',
          PROJECT_A,
          '--target-line',
          LINE_02,
          '--change',
          'redesign-routing',
          '--json',
        ],
        { cwd: executionWorktree, env }
      )
    );
    const description = parseJson(shown);
    expect(description.bindingState).toBe('bound');
    expect(description.planning.root).toBe(planningWorktree);
    expect(description.execution.root).toBe(executionWorktree);
    expect(description.workspacePairId).toBe(entry?.workspacePairId);

    const context = expectOk(
      await runCLI(
        [
          'context',
          '--json',
          '--store',
          STORE_ID,
          '--project',
          PROJECT_A,
          '--target-line',
          LINE_02,
        ],
        { cwd: executionWorktree, env }
      )
    );
    const contextJson = parseJson(context);
    expect(contextJson.workspace).toMatchObject({
      bindingState: 'bound',
      prepared: true,
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      planning: { root: planningWorktree },
      execution: { root: executionWorktree },
    });
    const contextHuman = expectOk(
      await runCLI(
        ['context', '--store', STORE_ID, '--project', PROJECT_A, '--target-line', LINE_02],
        { cwd: executionWorktree, env }
      )
    );
    // Human/JSON content parity for the workspace projection.
    expect(contextHuman.stdout).toContain('Planning workspace');
    expect(contextHuman.stdout).toContain(planningWorktree);
    expect(contextHuman.stdout).toContain(executionWorktree);
    expect(contextHuman.stdout).toContain(entry?.workspacePairId as string);

    // ---- finalization is live, and declares its outcome --------------------
    // This block asserted `store_v2_finalization_unavailable` while
    // `store-finalization-outcomes-v2` was unimplemented. It has landed, so
    // the deferral is gone; what a bound pair gets instead is the real gate —
    // exactly one explicitly declared outcome, and an entry addressed under
    // the project partition's stable target-line Archive.
    const selectorsForArchive = [
      '--store',
      STORE_ID,
      '--project',
      PROJECT_A,
      '--target-line',
      LINE_02,
    ];
    const archivedWithoutOutcome = await runCLI(
      ['archive', 'redesign-routing', '--json', '--yes', ...selectorsForArchive],
      { cwd: executionWorktree, env }
    );
    expect(archivedWithoutOutcome.exitCode).toBe(1);
    expect(parseJson(archivedWithoutOutcome).status[0].code).toBe(
      'finalization_outcome_required'
    );

    const archived = await runCLI(
      [
        'archive',
        'redesign-routing',
        '--json',
        '--yes',
        '--outcome',
        'abandoned',
        '--reason',
        'Superseded by a different approach; recorded as passive history.',
        ...selectorsForArchive,
      ],
      { cwd: executionWorktree, env }
    );
    expect(archived.exitCode, `${archived.stdout}\n${archived.stderr}`).toBe(0);
    const archivedJson = parseJson(archived);
    const publishedEntry = archivedJson.archive.path as string;
    expect(publishedEntry).toContain(
      path.join('rasen', 'projects', PROJECT_A, 'changes', 'archive', LINE_02)
    );
    expect(path.basename(publishedEntry)).toMatch(
      /^\d{4}-\d{2}-\d{2}-redesign-routing--[0-9a-f]{12}$/
    );
    expect(archivedJson.archive.finalization).toMatchObject({
      outcome: 'abandoned',
      specSyncApplied: false,
      specSyncActionCount: 0,
      targetLineId: LINE_02,
      workspacePairId: entry?.workspacePairId,
      associationPhase: 'applied',
    });
    const publishedRecord = JSON.parse(
      fs.readFileSync(path.join(publishedEntry, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(publishedRecord).toMatchObject({
      schemaVersion: 2,
      outcome: 'abandoned',
      projectId: PROJECT_A,
      targetLineId: LINE_02,
      codeMerge: null,
      specSync: { applied: false, actions: [] },
    });
    expect(publishedRecord.workspacePairId).toBe(entry?.workspacePairId);
    // The binding's terminal state is part of the transaction, not an epilogue.
    const finalizedAssociation = JSON.parse(
      fs.readFileSync(
        path.join(executionWorktree, '.rasen', 'planning-binding.json'),
        'utf8'
      )
    ) as { finalizedChange?: { changeId: string; outcome: string } };
    expect(finalizedAssociation.finalizedChange).toMatchObject({
      changeId: 'redesign-routing',
      outcome: 'abandoned',
    });

    // ---- cleanup refuses what it cannot prove ------------------------------
    const cleanup = await runCLI(
      [
        'store',
        'workspace',
        'cleanup',
        '--store',
        STORE_ID,
        '--project',
        PROJECT_A,
        '--target-line',
        LINE_02,
        '--change',
        'redesign-routing',
        '--json',
      ],
      { cwd: storeRoot, env }
    );
    expect(cleanup.exitCode).toBe(1);
    const cleanupPlan = parseJson(cleanup);
    expect(cleanupPlan.applicable).toBe(false);
    // The new Change directory is untracked in the planning worktree, so
    // removal would lose it; every failed precondition is listed with values.
    expect(
      cleanupPlan.blockers.map((blocker: { id: string }) => blocker.id)
    ).toContain('planning-5-untracked-accepted');
    for (const blocker of cleanupPlan.blockers) {
      expect(blocker.code).toBe('workspace_cleanup_unsafe');
      expect(blocker.detail.length).toBeGreaterThan(0);
    }
    // Nothing was removed by the refusal.
    expect(fs.existsSync(planningWorktree)).toBe(true);
    expect(fs.existsSync(executionWorktree)).toBe(true);
  }, 240_000);

  it('removes a prepared-but-unbound pair and leaves everything else byte-identical', async () => {
    const planningWorktree = path.join(tempDir, 'store-planning-spike');
    const executionWorktree = path.join(tempDir, 'app-b-spike');
    const plan = parseJson(
      expectOk(
        await runCLI(
          [
            'store',
            'workspace',
            'plan',
            '--store',
            STORE_ID,
            '--project',
            PROJECT_B,
            '--target-line',
            LINE_02,
            '--change',
            'spike-only',
            '--planning-worktree',
            planningWorktree,
            '--execution-worktree',
            executionWorktree,
            '--json',
          ],
          { cwd: storeRoot, env }
        )
      )
    );
    expectOk(
      await runCLI(['store', 'workspace', 'apply', '--apply-plan', plan.planId, '--json'], {
        cwd: storeRoot,
        env,
      })
    );
    expect(fs.existsSync(planningWorktree)).toBe(true);

    const cleanupPlan = parseJson(
      expectOk(
        await runCLI(
          [
            'store',
            'workspace',
            'cleanup',
            '--store',
            STORE_ID,
            '--project',
            PROJECT_B,
            '--target-line',
            LINE_02,
            '--change',
            'spike-only',
            '--json',
          ],
          { cwd: storeRoot, env }
        )
      )
    );
    expect(cleanupPlan.applicable).toBe(true);

    const removed = parseJson(
      expectOk(
        await runCLI(
          ['store', 'workspace', 'cleanup', '--apply-plan', cleanupPlan.planId, '--json'],
          { cwd: storeRoot, env }
        )
      )
    );
    expect(removed.phase).toBe('complete');
    expect(removed.removed.sort()).toEqual([executionWorktree, planningWorktree].sort());
    expect(removed.indexEntryRemoved).toBe(true);
    expect(fs.existsSync(planningWorktree)).toBe(false);
    expect(fs.existsSync(executionWorktree)).toBe(false);

    // Cleanup never deletes a branch or any ref, and never touches either main
    // checkout. The branch the removed worktree was on is still there.
    const branches = runGit(storeRoot, ['for-each-ref', '--format=%(refname)', 'refs/heads']);
    expect(branches).toContain(`refs/heads/change/${LINE_02}/${PROJECT_B}/spike-only`);
    expect(branches).toContain('refs/heads/release/0.2');
    expect(runGit(storeRoot, ['status', '--porcelain'])).toBe('');
    expect(runGit(projectBRoot, ['status', '--porcelain'])).toBe('');
  }, 240_000);
});
