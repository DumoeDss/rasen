/**
 * `issue-status-projection` task 4.4 — the enriched `rasen store issue`
 * list/show surface, through the real CLI.
 *
 * Human/JSON parity for both commands, the status column, the degraded
 * visibility-`none` answer from an unrelated working directory, and a corrupt
 * run-state surfaced as a problem. Run-state lives in a real execution root
 * beside the fixture (a standalone project root), written with the frozen
 * `writeRunState`, so the CLI consumes exactly the bytes the LEAD produces.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';
import { writeRunState } from '../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../src/core/file-placement.js';

const PROJECT = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'main';
const ISSUE = 'layer-issue';

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

describe('rasen store issue status surface', () => {
  let f: StoreWorkspaceFixture;
  let execProject: string;
  let nowhere: string;
  const scope = () => ({ store: f.storeId, cwd: execProject, env: f.env });

  /** Seeds a Change into the store checkout and commits it on `main`. */
  function seedAndCommit(changeId: string, instanceSeed: string): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId,
      instanceSeed,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed ${changeId}`]);
    return seeded.instanceId;
  }

  async function run(args: readonly string[], cwd: string): Promise<RunCLIResult> {
    return runCLI([...args], { cwd, env: f.env });
  }

  async function createStoreIssue() {
    await run(['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Issue layer', '--json'], f.storeRoot);
    const ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-b', 'b2'.repeat(16)),
      seedAndCommit('child-c', 'c3'.repeat(16)),
    ];
    const nodesFile = f.beside('nodes.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        '  - nodeId: g-001',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[0])}`,
        '    changeAlias: child-a',
        '    dependsOn: []',
        '  - nodeId: g-002',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[1])}`,
        '    changeAlias: child-b',
        '    dependsOn: [g-001]',
        '  - nodeId: g-003',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[2])}`,
        '    changeAlias: child-c',
        '    dependsOn: [g-001, g-002]',
        '',
      ].join('\n')
    );
    expectOk(
      await run(
        ['store', 'issue', 'plan', ISSUE, '--store', f.storeId, '--from-file', nodesFile, '--json'],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-status-cli-',
      projects: [PROJECT, PROJECT_B],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    // A standalone project root: its `.rasen/changes/<alias>/ephemera` is the
    // execution-root landing the projection searches first.
    execProject = f.beside('exec-project');
    f.write(path.join(execProject, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    nowhere = f.beside('nowhere');
    fs.mkdirSync(nowhere, { recursive: true });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('carries the status column and node-by-node block, in parity across forms', async () => {
    await createStoreIssue();
    writeRunState(ephemeraDir(execProject, 'child-a'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });

    const listHuman = expectOk(await run(['store', 'issue', 'list', '--store', f.storeId], execProject));
    expect(listHuman.stdout).toContain(ISSUE);
    expect(listHuman.stdout).toContain('active/healthy 0/3');
    // The visibility label names the execution root it consulted.
    expect(listHuman.stdout).toContain(execProject);

    const listJson = parseJson(
      expectOk(await run(['store', 'issue', 'list', '--store', f.storeId, '--json'], execProject))
    );
    expect(listJson.issues).toHaveLength(1);
    const listStatus = listJson.issues[0].status;
    expect(listStatus.phase).toBe('active');
    expect(listStatus.health).toBe('healthy');
    expect(listStatus.progress).toEqual({ completed: 0, total: 3 });
    expect(listStatus.runStateVisibility).toEqual({
      kind: 'execution-root',
      executionRoot: execProject,
    });
    expect(listStatus.nodes.map((node: { observation: string }) => node.observation)).toEqual([
      'in-flight',
      'not-started',
      'not-started',
    ]);

    const showHuman = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    expect(showHuman.stdout).toContain('phase: active');
    expect(showHuman.stdout).toContain('health: healthy');
    expect(showHuman.stdout).toContain('progress: 0/3');
    expect(showHuman.stdout).toContain(`run-state: ${execProject}`);
    expect(showHuman.stdout).toContain(`g-001 change ${PROJECT} child-a — in-flight`);
    // The blocker segment names each dependency with its target project and
    // observed state on the work-complete basis — g-001 is the in-flight one
    // this scenario planted run-state for; g-002 has no local run-state at
    // all, which the refinement vocabulary distinguishes from a recorded
    // not-started.
    expect(showHuman.stdout).toContain(
      `g-002 change ${PROJECT} child-b — not-started (blockedBy g-001@${PROJECT}: in-flight)`
    );
    expect(showHuman.stdout).toContain(
      `g-003 change ${PROJECT} child-c — not-started ` +
        `(blockedBy g-001@${PROJECT}: in-flight, g-002@${PROJECT}: not-started, no local run-state)`
    );

    const showJson = parseJson(
      expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject))
    );
    // Both forms, and both commands, carry the SAME facts.
    expect(showJson.status.phase).toBe(listStatus.phase);
    expect(showJson.status.health).toBe(listStatus.health);
    expect(showJson.status.progress).toEqual(listStatus.progress);
    expect(showJson.status.nodes).toEqual(listStatus.nodes);
    expect(showJson.status.problems).toEqual(listStatus.problems);
    expect(showJson.status.runStateVisibility).toEqual(listStatus.runStateVisibility);
    // The structured dependency facts, per node, in the machine form.
    expect(showJson.status.nodes[1].blockedBy).toEqual([
      { nodeId: 'g-001', projectId: PROJECT, observation: 'in-flight' },
    ]);
    expect(showJson.status.nodes[2].blockedBy).toEqual([
      { nodeId: 'g-001', projectId: PROJECT, observation: 'in-flight' },
      { nodeId: 'g-002', projectId: PROJECT, observation: 'not-started' },
    ]);
    // Six CLI invocations that each grew ~1-2s when list/show began reading
    // acceptance content per Issue (issue-acceptance-close): the budget is
    // raised to keep this scenario whole rather than splitting the parity
    // story. Solo wall-clock sits near 27s of the default 30s.
  }, 60_000);

  it('degrades to a labelled visibility-none answer from an unrelated directory', async () => {
    await createStoreIssue();

    const human = expectOk(await run(['store', 'issue', 'list', '--store', f.storeId], nowhere));
    expect(human.stdout).toContain('No local run-state visible');
    expect(human.stdout).toContain('ready/healthy 0/3');

    const showHuman = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], nowhere)
    );
    // With no execution root at all, every dependency's wait says so in the
    // visibility vocabulary rather than asserting a recorded not-started.
    expect(showHuman.stdout).toContain(
      `g-002 change ${PROJECT} child-b — not-started ` +
        `(blockedBy g-001@${PROJECT}: not-started, no local run-state)`
    );

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], nowhere))
    );
    expect(json.status.runStateVisibility).toEqual({ kind: 'none' });
    // Committed evidence still derives without any execution root.
    expect(json.status.phase).toBe('ready');
    expect(json.status.progress).toEqual({ completed: 0, total: 3 });
    expect(json.status.nodes.map((node: { observation: string }) => node.observation)).toEqual([
      'not-started',
      'not-started',
      'not-started',
    ]);
  });

  it('surfaces a corrupt run-state as a status problem in both forms, exit unchanged', async () => {
    await createStoreIssue();
    const corruptPath = path.join(ephemeraDir(execProject, 'child-a'), 'auto-run.json');
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, '{corrupt', 'utf8');

    const human = expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject));
    expect(human.stdout).toContain('STATUS PROBLEMS');
    expect(human.stdout).toContain('invalid-run-state');
    expect(human.stdout).toContain(corruptPath);
    // The status segment pins the phase row for `unknown`: a located-but-
    // unreadable run-state is activity-adjacent trouble — active, not planning.
    expect(human.stdout).toContain('phase: active');

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject))
    );
    expect(json.status.phase).toBe('active');
    expect(json.status.nodes[0].observation).toBe('unknown');
    expect(json.status.problems[0].kind).toBe('invalid-run-state');
    expect(json.status.problems[0].ref).toBe(corruptPath);
    expect(json.status.complete).toBe(false);
  });

  it('names a cross-project blocker with the member project it waits on', { timeout: 60_000 }, async () => {
    // The Issue + a two-project plan: downstream in app-a waits on upstream
    // in app-b — the first fact the read surface must attribute across
    // member projects.
    await run(['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Cross wait', '--json'], f.storeRoot);
    const upId = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT_B,
      targetLineId: LINE,
      changeId: 'child-up',
      instanceSeed: 'e5'.repeat(16),
    }).instanceId;
    const downId = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-down',
      instanceSeed: 'f6'.repeat(16),
    }).instanceId;
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed cross children']);
    const nodesFile = f.beside('nodes.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        '  - nodeId: g-up',
        '    kind: change',
        `    projectId: ${PROJECT_B}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(upId)}`,
        '    changeAlias: child-up',
        '    dependsOn: []',
        '  - nodeId: g-down',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(downId)}`,
        '    changeAlias: child-down',
        '    dependsOn: [g-up]',
        '',
      ].join('\n')
    );
    expectOk(
      await run(
        ['store', 'issue', 'plan', ISSUE, '--store', f.storeId, '--from-file', nodesFile, '--json'],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + cross plan']);

    const before = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    expect(before.stdout).toContain(
      `g-down change ${PROJECT} child-down — not-started ` +
        `(blockedBy g-up@${PROJECT_B}: not-started, no local run-state)`
    );

    // The upstream's work begins in ITS execution root: the segment follows
    // the observation, still naming the member project the wait is on.
    writeRunState(ephemeraDir(execProject, 'child-up'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });
    const after = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    expect(after.stdout).toContain(
      `g-down change ${PROJECT} child-down — not-started (blockedBy g-up@${PROJECT_B}: in-flight)`
    );

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject))
    );
    const downstream = json.status.nodes.find((node: { nodeId: string }) => node.nodeId === 'g-down');
    expect(downstream.blockedBy).toEqual([
      { nodeId: 'g-up', projectId: PROJECT_B, observation: 'in-flight' },
    ]);
  });
});
