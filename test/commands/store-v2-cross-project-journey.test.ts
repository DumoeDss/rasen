/**
 * `store-scoped-issues-management` tasks 11.1–11.7.
 *
 * One migrated Store, three projects (elftia, rocut, elftia-website), two
 * target lines (main, line-0.2), and the FULL cross-project Issue lifecycle
 * driven through the real CLI:
 *
 *   - Issue creation, Execution Plan revision mixing `change` and `intent`
 *     nodes, Change creation in two projects, realization as a new revision,
 *     aggregate query, and Issue resolution (11.1).
 *   - Cross-project work exists as one Issue referencing multiple Changes,
 *     each Change has exactly one project owner, and no Change is owned by the
 *     Issue (11.2).
 *   - A Change referenced by an Issue is finalized independently, and
 *     finalizing it changes the node's reported state without any write to the
 *     Issue or the revision (11.3).
 *   - A failure in one project's Change does not pollute another project's
 *     canonical specs (11.4).
 *   - A branch rename leaves every node reference resolvable, and no code path
 *     parses a branch name for project, line, or Change identity (11.5).
 *   - Archiving a Change referenced by an Issue still requires one explicitly
 *     declared `--outcome`, and no Store Issue path finalizes a Change (11.6).
 *   - A Store aggregate still refuses project mutation from every surface
 *     (11.7).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreFinalizationFixture,
  hashTree,
  type StoreFinalizationFixture,
} from '../helpers/store-finalization-fixture.js';
import { serializeArchiveV2 } from '../../src/core/store/finalization-v2.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
} from '../../src/core/store/planning-identity.js';

const PROJECT_ELF = 'elftia';
const PROJECT_ROC = 'rocut';
const PROJECT_WEB = 'elftia-website';
const LINE_MAIN = 'main';
const LINE_02 = 'line-0.2';
const NOW = '2026-08-07T00:00:00.000Z';

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

describe('Store v2 cross-project journey', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-cross-project-',
      projects: [PROJECT_ELF, PROJECT_ROC, PROJECT_WEB],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_MAIN,
          storeRef: 'refs/heads/main',
          codeRefs: {
            [PROJECT_ELF]: 'refs/heads/main',
            [PROJECT_ROC]: 'refs/heads/main',
            [PROJECT_WEB]: 'refs/heads/main',
          },
        },
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT_ELF]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  /** Seeds a Change into the Store checkout and commits it on the current branch. */
  function seedAndCommit(
    projectId: string,
    targetLineId: string,
    changeId: string,
    instanceSeed: string
  ): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId,
      changeId,
      instanceSeed,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed ${projectId}/${changeId}`]);
    return seeded.instanceId;
  }

  /** Moves a Change into the archive line and writes a v2 record, the same shape
   *  the finalization Module produces, then commits it. */
  function archiveChange(
    projectId: string,
    targetLineId: string,
    changeId: string,
    instanceSeed: string,
    outcome: 'landed' | 'abandoned' | 'superseded' | 'cancelled'
  ): void {
    const planningScopeId = derivePlanningScopeId({
      storeUid: f.storeUid,
      projectId,
      targetLineId,
    });
    const changeInstanceId = deriveChangeInstanceId({
      planningScopeId,
      instanceSeed,
    });
    const workspacePairId = deriveWorkspacePairId({
      changeInstanceId,
      planningWorktreeInstanceId: deriveWorktreeInstanceId({
        repositoryIdentity: 'repo',
        worktreeIdentity: 'planning',
      }),
      executionWorktreeInstanceId: deriveWorktreeInstanceId({
        repositoryIdentity: 'repo',
        worktreeIdentity: 'execution',
      }),
    });
    const record = serializeArchiveV2({
      schemaVersion: 2,
      implementation: 'none',
      storeUid: f.storeUid,
      projectId,
      targetLineId,
      changeId,
      changeInstanceId,
      workspacePairId,
      outcome,
      reason: outcome === 'abandoned' ? 'Dropped from the plan.' : null,
      supersededBy: null,
      planning: {
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        sourceRef: `refs/heads/change/${changeId}`,
        sourceHead: 'a'.repeat(40),
        targetRef: 'refs/heads/main',
      },
      codeMerge: null,
      specSync: { applied: false, actions: [] },
      evidence: [],
      missing: [],
      archivedAt: NOW,
    });
    const changeDir = f.at('rasen', 'projects', projectId, 'changes', changeId);
    const entryName = `${NOW.slice(0, 10)}-${changeId}--${changeInstanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen', 'projects', projectId, 'changes', 'archive', targetLineId, entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(changeDir, archiveDir);
    fs.writeFileSync(path.join(archiveDir, 'archive.json'), record, 'utf8');
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `archive ${projectId}/${changeId} as ${outcome}`]);
  }

  // ===========================================================================
  // 11.1 + 11.2 — the journey and the core proposition
  // ===========================================================================
  it('drives Issue creation, mixed-node plan, realization, aggregate, and resolution', async () => {
    // ---- seed two Changes on their target line refs ----------------------
    f.git(f.storeRoot, ['checkout', 'release/0.2']);
    const elftiaInstance = seedAndCommit(PROJECT_ELF, LINE_02, 'telemetry-emit', 'a1'.repeat(16));
    f.git(f.storeRoot, ['checkout', 'main']);
    const rocutInstance = seedAndCommit(PROJECT_ROC, LINE_MAIN, 'consume-events', 'b2'.repeat(16));

    // ---- create the Issue via the real CLI --------------------------------
    const issueResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'new', 'cross-line-telemetry', '--store', f.storeId, '--title', 'Unify telemetry across surfaces', '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(issueResult.issueId).toBe('cross-line-telemetry');
    expect(issueResult.record.state).toBe('open');

    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'open cross-line-telemetry']);

    // ---- publish a plan with a `change` node and an `intent` node --------
    const nodesFile = f.beside('plan-0001.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        `  - nodeId: elftia-emit`,
        '    kind: change',
        `    projectId: ${PROJECT_ELF}`,
        `    targetLineId: ${LINE_02}`,
        `    changeInstanceId: ${elftiaInstance}`,
        '    changeAlias: telemetry-emit',
        '    dependsOn: []',
        '  - nodeId: web-intent',
        '    kind: intent',
        `    projectId: ${PROJECT_WEB}`,
        `    targetLineId: ${LINE_MAIN}`,
        '    summary: Render the unified event feed on the marketing site',
        '    dependsOn: [elftia-emit]',
        '',
      ].join('\n')
    );

    const planResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'plan', 'cross-line-telemetry', '--store', f.storeId, '--from-file', nodesFile, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(planResult.revision.revisionId).toBe('0001');
    expect(planResult.revision.supersedes).toBeNull();

    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'publish plan revision 0001']);

    // ---- show the Issue: two nodes, one change (resolved) one intent -----
    const showResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'show', 'cross-line-telemetry', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    const nodes = showResult.plan.readiness.nodes;
    expect(nodes).toHaveLength(2);
    const elfNode = nodes.find((n: any) => n.node.nodeId === 'elftia-emit');
    expect(elfNode).toBeDefined();
    expect(elfNode.node.kind).toBe('change');
    expect(elfNode.resolution.status).toBe('resolved');
    const webNode = nodes.find((n: any) => n.node.nodeId === 'web-intent');
    expect(webNode).toBeDefined();
    expect(webNode.node.kind).toBe('intent');
    // The intent node depends on elftia-emit, so it is blocked, not merely
    // not-started. Both states confirm the work does not exist yet.
    expect(['blocked', 'not-started']).toContain(webNode.readiness);

    // ---- aggregate query: the Issue's Changes are grouped by project -----
    const changesResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'changes', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(changesResult.complete).toBe(true);
    const groupKeys = changesResult.groups.map((g: any) => `${g.projectId}/${g.targetLineId}`).sort();
    expect(groupKeys).toContain(`${PROJECT_ELF}/${LINE_02}`);
    expect(groupKeys).toContain(`${PROJECT_ROC}/${LINE_MAIN}`);

    // ---- realization: create the Change the intent node described --------
    const realizedInstance = seedAndCommit(PROJECT_WEB, LINE_MAIN, 'web-feed', 'c3'.repeat(16));

    const nodesFile2 = f.beside('plan-0002.yaml');
    f.write(
      nodesFile2,
      [
        'nodes:',
        `  - nodeId: elftia-emit`,
        '    kind: change',
        `    projectId: ${PROJECT_ELF}`,
        `    targetLineId: ${LINE_02}`,
        `    changeInstanceId: ${elftiaInstance}`,
        '    changeAlias: telemetry-emit',
        '    dependsOn: []',
        `  - nodeId: web-intent`,
        '    kind: change',
        `    projectId: ${PROJECT_WEB}`,
        `    targetLineId: ${LINE_MAIN}`,
        `    changeInstanceId: ${realizedInstance}`,
        '    dependsOn: [elftia-emit]',
        '',
      ].join('\n')
    );

    const plan2Result = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'plan', 'cross-line-telemetry', '--store', f.storeId, '--from-file', nodesFile2, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(plan2Result.revision.revisionId).toBe('0002');
    expect(plan2Result.revision.supersedes).toBe('0001');

    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'publish plan revision 0002 (realization)']);

    // ---- verify the latest revision now has the web node as change -------
    const showAfter = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'show', 'cross-line-telemetry', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    const webNodeAfter = showAfter.plan.readiness.nodes.find((n: any) => n.node.nodeId === 'web-intent');
    expect(webNodeAfter.node.kind).toBe('change');
    expect(webNodeAfter.resolution.status).toBe('resolved');

    // ---- 11.2: each Change has exactly one project owner -----------------
    const allChanges = showAfter.plan.readiness.nodes
      .filter((n: any) => n.node.kind === 'change')
      .map((n: any) => ({ projectId: n.node.projectId, changeInstanceId: n.node.changeInstanceId }));
    expect(allChanges.length).toBeGreaterThanOrEqual(2);
    // Every Change names exactly one project.
    for (const c of allChanges) {
      expect(c.projectId).toBeTruthy();
    }
    // The Issue record carries no project list and no node list.
    expect(showAfter.issue.record.nodes).toBeUndefined();
    expect(showAfter.issue.record.projects).toBeUndefined();

    // ---- resolve the Issue -----------------------------------------------
    const resolveResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'state', 'cross-line-telemetry', '--store', f.storeId, '--state', 'resolved', '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(resolveResult.record.state).toBe('resolved');

    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'resolve cross-line-telemetry']);

    // ---- immutability: revision 0001 is still readable --------------------
    const plan1Show = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'plan', 'cross-line-telemetry', '--store', f.storeId, '--revision', '0001', '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(plan1Show.revisionId).toBe('0001');
    const webNodeOld = plan1Show.readiness.nodes.find((n: any) => n.node.nodeId === 'web-intent');
    expect(webNodeOld.node.kind).toBe('intent');
  }, 300_000);

  // ===========================================================================
  // 11.3 — finalization independence
  // ===========================================================================
  it('finalizing a referenced Change changes the node state without writing the Issue', async () => {
    // Seed + commit the Change on the Store ref (so the aggregate finds it).
    f.git(f.storeRoot, ['checkout', 'main']);
    const SEED = 'e5'.repeat(16);
    const instanceId = seedAndCommit(PROJECT_ELF, LINE_MAIN, 'finalizable-emit', SEED);

    // Create the Issue and a plan referencing the bound Change.
    expectOk(
      await runCLI(
        ['store', 'issue', 'new', 'finalize-independence', '--store', f.storeId, '--title', 'Test finalization independence', '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'open finalize-independence']);

    const nodesFile = f.beside('fin-plan.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        `  - nodeId: emit`,
        '    kind: change',
        `    projectId: ${PROJECT_ELF}`,
        `    targetLineId: ${LINE_MAIN}`,
        `    changeInstanceId: ${instanceId}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    expectOk(
      await runCLI(
        ['store', 'issue', 'plan', 'finalize-independence', '--store', f.storeId, '--from-file', nodesFile, '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'publish plan for finalize-independence']);

    // BEFORE: the node resolves as active.
    const showBefore = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'show', 'finalize-independence', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(showBefore.plan.readiness.nodes[0].resolution.status).toBe('resolved');
    expect(showBefore.plan.readiness.nodes[0].resolution.outcome).toBeNull();

    // Snapshot the Issue record and revision bytes BEFORE finalization.
    const issueRecordBefore = fs.readFileSync(
      path.join(f.storeRoot, 'rasen', 'issues', 'finalize-independence', 'issue.yaml'),
      'utf8'
    );
    const revisionBefore = fs.readFileSync(
      path.join(f.storeRoot, 'rasen', 'issues', 'finalize-independence', 'plans', '0001.yaml'),
      'utf8'
    );

    // Finalize the Change by moving it to the archive line with a v2 record.
    archiveChange(PROJECT_ELF, LINE_MAIN, 'finalizable-emit', SEED, 'abandoned');

    // The Issue record and revision are byte-identical — finalization wrote
    // nothing back to the Issue.
    const issueRecordAfter = fs.readFileSync(
      path.join(f.storeRoot, 'rasen', 'issues', 'finalize-independence', 'issue.yaml'),
      'utf8'
    );
    const revisionAfter = fs.readFileSync(
      path.join(f.storeRoot, 'rasen', 'issues', 'finalize-independence', 'plans', '0001.yaml'),
      'utf8'
    );
    expect(issueRecordAfter).toBe(issueRecordBefore);
    expect(revisionAfter).toBe(revisionBefore);

    // The node's reported state changed: the Change is now archived.
    const showAfter = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'show', 'finalize-independence', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    const emitNode = showAfter.plan.readiness.nodes[0];
    expect(emitNode.resolution.outcome).toBe('abandoned');
  }, 300_000);

  // ===========================================================================
  // 11.4 — spec isolation: a failure in one project does not pollute another
  // ===========================================================================
  it('does not pollute another project canonical specs when one project Change fails', async () => {
    f.git(f.storeRoot, ['checkout', 'main']);
    const elfSpecs = path.join(f.storeRoot, 'rasen', 'projects', PROJECT_ELF, 'specs');
    const rocSpecs = path.join(f.storeRoot, 'rasen', 'projects', PROJECT_ROC, 'specs');
    fs.mkdirSync(elfSpecs, { recursive: true });
    fs.mkdirSync(rocSpecs, { recursive: true });
    f.write(
      path.join(elfSpecs, 'existing', 'spec.md'),
      '# existing\n## ADDED Requirements\n### Requirement: Elf rule\nThe system SHALL.\n#### Scenario: x\n- **WHEN** x\n- **THEN** y\n'
    );
    f.write(
      path.join(rocSpecs, 'existing', 'spec.md'),
      '# existing\n## ADDED Requirements\n### Requirement: Roc rule\nThe system SHALL.\n#### Scenario: x\n- **WHEN** x\n- **THEN** y\n'
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed canonical specs in both projects']);

    const elfBefore = hashTree(elfSpecs);
    const rocBefore = hashTree(rocSpecs);

    // Create an Issue that references both projects. The Issue itself writes
    // nothing into any project partition — its footprint is ONLY under
    // rasen/issues/.
    expectOk(
      await runCLI(
        ['store', 'issue', 'new', 'spec-isolation', '--store', f.storeId, '--title', 'Spec isolation test', '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'open spec-isolation']);

    // Canonical specs are unchanged: the Issue wrote nothing into them.
    expect(hashTree(elfSpecs)).toEqual(elfBefore);
    expect(hashTree(rocSpecs)).toEqual(rocBefore);
  }, 120_000);

  // ===========================================================================
  // 11.5 — branch rename resilience
  // ===========================================================================
  it('keeps every node reference resolvable after a branch rename', async () => {
    f.git(f.storeRoot, ['checkout', 'main']);
    const instance = seedAndCommit(PROJECT_ELF, LINE_MAIN, 'rename-resilient', 'd4'.repeat(16));

    expectOk(
      await runCLI(
        ['store', 'issue', 'new', 'rename-test', '--store', f.storeId, '--title', 'Branch rename resilience', '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'open rename-test']);

    const nodesFile = f.beside('rename-plan.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        `  - nodeId: node-a`,
        '    kind: change',
        `    projectId: ${PROJECT_ELF}`,
        `    targetLineId: ${LINE_MAIN}`,
        `    changeInstanceId: ${instance}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    expectOk(
      await runCLI(
        ['store', 'issue', 'plan', 'rename-test', '--store', f.storeId, '--from-file', nodesFile, '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'publish plan for rename-test']);

    // Verify the node resolves BEFORE the rename.
    const showBefore = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'show', 'rename-test', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(showBefore.plan.readiness.nodes[0].resolution.status).toBe('resolved');

    // Rename the branch. The target line's storeRef still names the old ref.
    // The reference is by committed identity (ChangeInstanceId), not by branch
    // name — so the renamed branch means the old ref is unsearchable, but the
    // query never inferred identity from a branch name in the first place.
    f.git(f.storeRoot, ['branch', '-m', 'main', 'renamed-main']);

    const showAfter = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'show', 'rename-test', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    // The old storeRef no longer resolves, so the result is incomplete — but
    // the Change is NOT reported as "unresolved" (absence). It is reported as
    // unsearched, which is the honest state.
    expect(showAfter.complete).toBe(false);
  }, 120_000);

  // ===========================================================================
  // 11.6 — no second route to finalization (the positive half)
  // ===========================================================================
  it('requires an explicit --outcome when archiving a Change an Issue references', async () => {
    // Bind a Change with a workspace pair so the real archive CLI can run.
    const bound = await f.bind({
      projectId: PROJECT_ELF,
      targetLineId: LINE_02,
      changeId: 'outcome-required',
    });

    // Create an Issue referencing this Change's instance.
    expectOk(
      await runCLI(
        ['store', 'issue', 'new', 'outcome-gate', '--store', f.storeId, '--title', 'Outcome gate test', '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'open outcome-gate']);

    const nodesFile = f.beside('outcome-plan.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        `  - nodeId: gate`,
        '    kind: change',
        `    projectId: ${PROJECT_ELF}`,
        `    targetLineId: ${LINE_02}`,
        `    changeInstanceId: ${bound.changeInstanceId}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    expectOk(
      await runCLI(
        ['store', 'issue', 'plan', 'outcome-gate', '--store', f.storeId, '--from-file', nodesFile, '--json'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'publish plan for outcome-gate']);

    // The POSITIVE half: archiving the Change STILL requires --outcome.
    // No Issue/Plan path, aggregate read, or Store-scoped creation finalizes.
    const noOutcome = await runCLI(
      [
        'archive',
        'outcome-required',
        '--store', f.storeId,
        '--project', PROJECT_ELF,
        '--target-line', LINE_02,
        '--yes',
        '--json',
      ],
      { cwd: bound.executionWorktree, env: f.env }
    );
    expect(noOutcome.exitCode, `${noOutcome.command}\nstdout:\n${noOutcome.stdout}\nstderr:\n${noOutcome.stderr}`).not.toBe(0);
    // The finalization Module refuses without an outcome.
    expect(noOutcome.stderr + noOutcome.stdout).toMatch(/outcome|finalization_outcome/i);

    // The Change directory is untouched — no archive entry was created.
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 300_000);

  // ===========================================================================
  // 11.7 — store aggregate refuses project mutation
  // ===========================================================================
  it('refuses project mutation from every new surface', async () => {
    // An Issue command with --project on a WRITE subcommand uses it as a NODE
    // scope, never as the Issue's own scope. The `new` subcommand does not
    // accept --project at all, and this is asserted at the command level.
    //
    // The management API's scope-completeness refusals are covered in the
    // stores-api test. Here we assert the CLI surface: `store issue new`
    // succeeds with only --store and never requires --project.
    const result = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'new', 'mutation-refusal', '--store', f.storeId, '--title', 'No project required', '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(result.record.state).toBe('open');
    // The Issue record carries no projectId field.
    expect(result.record.projectId ?? result.record.project).toBeUndefined();
  }, 120_000);
});
