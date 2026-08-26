/**
 * `issue-node-lifecycle` task 5.2 — the lifecycle facts through the real CLI
 * (built dist), over a real Store fixture: show node lines naming lifecycles
 * and reasons, the gate render naming exclusions beside it, the stated 0/0,
 * the start refusals, and human/JSON parity for every new fact. No new CLI
 * options or subcommands exist — these tests run the unchanged surface.
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
const LINE = 'main';
const ISSUE = 'lc-issue';
const ZERO_ISSUE = 'lc-zero';

const CANCELLED_REASON = 'descoped after the portfolio re-scoped round 2';

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

function expectRefused(result: RunCLIResult, code: string): RunCLIResult {
  expect(
    result.exitCode,
    `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(1);
  const json = parseJson(result);
  const statuses = Array.isArray(json.status) ? json.status : [];
  expect(
    statuses.map((entry: { code: string }) => entry.code),
    `${result.command}\nstdout:\n${result.stdout}`
  ).toContain(code);
  return result;
}

describe('rasen store issue lifecycle surface', () => {
  let f: StoreWorkspaceFixture;
  let execProject: string;
  let ids: string[] = [];

  async function run(args: readonly string[], cwd: string): Promise<RunCLIResult> {
    return runCLI([...args], { cwd, env: f.env });
  }

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

  /** Publishes a plan file with lifecycle fields onto an existing Issue. */
  async function publishPlanFile(issueId: string, yaml: string): Promise<void> {
    const nodesFile = f.beside(`${issueId}-nodes.yaml`);
    f.write(nodesFile, yaml);
    expectOk(
      await run(
        ['store', 'issue', 'plan', issueId, '--store', f.storeId, '--from-file', nodesFile, '--json'],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `plan ${issueId}`]);
  }

  function nodeYaml(nodeId: string, instanceId: string, alias: string, extra: string[] = []): string[] {
    return [
      `  - nodeId: ${nodeId}`,
      '    kind: change',
      `    projectId: ${PROJECT}`,
      `    targetLineId: ${LINE}`,
      `    changeInstanceId: ${JSON.stringify(instanceId)}`,
      `    changeAlias: ${alias}`,
      '    dependsOn: []',
      ...extra,
    ];
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-lc-cli-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execProject = f.beside('exec-project');
    f.write(path.join(execProject, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    ids = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-opt', 'b2'.repeat(16)),
      seedAndCommit('child-cut', 'c3'.repeat(16)),
    ];
    for (const issueId of [ISSUE, ZERO_ISSUE]) {
      expectOk(
        await run(
          ['store', 'issue', 'new', issueId, '--store', f.storeId, '--title', `Lifecycle ${issueId}`, '--json'],
          f.storeRoot
        )
      );
    }
  });

  afterEach(() => {
    f.cleanup();
  });

  it('names lifecycles and reasons on node lines, and exclusions beside an eligible gate, in parity', async () => {
    await publishPlanFile(
      ISSUE,
      [
        'nodes:',
        ...nodeYaml('g-001', ids[0], 'child-a'),
        ...nodeYaml('g-opt', ids[1], 'child-opt', ['    lifecycle: optional']),
        ...nodeYaml('g-cut', ids[2], 'child-cut', [
          '    lifecycle: cancelled',
          `    reason: ${JSON.stringify(CANCELLED_REASON)}`,
        ]),
        '',
      ].join('\n')
    );
    // Acceptance conditions so the gate block renders beside the status.
    const conditionsFile = f.beside('conditions.yaml');
    f.write(
      conditionsFile,
      [
        'conditions:',
        "  - id: cond-1",
        '    requirement: The lifecycle semantics hold through the CLI',
        '',
      ].join('\n')
    );
    expectOk(
      await run(
        ['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId, '--from-file', conditionsFile, '--json'],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'conditions']);
    // The required child completes its run: the gate becomes eligible with
    // the exclusion explained beside it.
    writeRunState(ephemeraDir(execProject, 'child-a'), {
      pipeline: 'small-feature',
      stages: {
        propose: { status: 'done' },
        apply: { status: 'done' },
        verify: { status: 'done' },
        'review-loop': { status: 'done' },
        ship: { status: 'done' },
        archive: { status: 'done' },
      },
    });

    const showHuman = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    // Node lines name the lifecycle, and the cancelled node its reason.
    expect(showHuman.stdout).toContain(`g-opt change ${PROJECT} child-opt — not-started (optional)`);
    expect(showHuman.stdout).toContain(`g-cut change ${PROJECT} child-cut — not-started (cancelled: ${CANCELLED_REASON})`);
    // Required nodes carry no lifecycle annotation.
    expect(showHuman.stdout).toContain(`g-001 change ${PROJECT} child-a — run-terminal`);
    // The gate is eligible over the required node alone, the exclusion named
    // beside it with the recorded reason.
    expect(showHuman.stdout).toContain('gate: eligible');
    expect(showHuman.stdout).toContain(`excluded g-cut (cancelled): ${CANCELLED_REASON}`);
    expect(showHuman.stdout).toContain('progress: 1/1');

    const showJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    const byId = new Map(
      showJson.status.nodes.map((node: { nodeId: string }) => [node.nodeId, node])
    );
    expect(byId.get('g-001')).toMatchObject({ lifecycle: 'required', reason: null });
    expect(byId.get('g-opt')).toMatchObject({ lifecycle: 'optional', reason: null });
    expect(byId.get('g-cut')).toMatchObject({
      lifecycle: 'cancelled',
      reason: CANCELLED_REASON,
    });
    expect(showJson.status.progress).toEqual({ completed: 1, total: 1 });
    const gate = showJson.status.acceptance.gate;
    expect(gate.eligible).toBe(true);
    expect(gate.snapshot).toEqual({
      completed: 1,
      total: 1,
      health: 'waiting-human',
      problemsStanding: 0,
    });
    expect(gate.exclusions).toEqual([
      { nodeId: 'g-cut', lifecycle: 'cancelled', reason: CANCELLED_REASON },
    ]);
    expect(gate.optionalNodes).toEqual(['g-opt']);

    // The list's progress pair is the same required-scoped shape.
    const listJson = parseJson(
      expectOk(await run(['store', 'issue', 'list', '--store', f.storeId, '--json'], execProject))
    );
    const listed = listJson.issues.find((issue: { issueId: string }) => issue.issueId === ISSUE);
    expect(listed.status.progress).toEqual({ completed: 1, total: 1 });
  }, 90_000);

  it('states the zero-required answer rather than hiding it, in both forms', async () => {
    await publishPlanFile(
      ZERO_ISSUE,
      [
        'nodes:',
        ...nodeYaml('z-opt', ids[1], 'child-opt', ['    lifecycle: optional']),
        ...nodeYaml('z-cut', ids[2], 'child-cut', [
          '    lifecycle: cancelled',
          `    reason: ${JSON.stringify(CANCELLED_REASON)}`,
        ]),
        '',
      ].join('\n')
    );
    const conditionsFile = f.beside('conditions-zero.yaml');
    f.write(
      conditionsFile,
      ['conditions:', '  - id: cond-1', '    requirement: Nothing is demanded', ''].join('\n')
    );
    expectOk(
      await run(
        ['store', 'issue', 'acceptance', ZERO_ISSUE, '--store', f.storeId, '--from-file', conditionsFile, '--json'],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'conditions zero']);

    const human = expectOk(
      await run(['store', 'issue', 'show', ZERO_ISSUE, '--store', f.storeId], execProject)
    );
    expect(human.stdout).toContain('progress: 0/0');
    expect(human.stdout).toContain('no required nodes — no work is demanded');
    expect(human.stdout).toContain('optional nodes (named, not counted): z-opt');
    expect(human.stdout).toContain(`excluded z-cut (cancelled): ${CANCELLED_REASON}`);
    expect(human.stdout).toContain('gate: eligible');

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ZERO_ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(json.status.progress).toEqual({ completed: 0, total: 0 });
    expect(json.status.acceptance.gate.snapshot).toEqual({
      completed: 0,
      total: 0,
      health: 'waiting-human',
      problemsStanding: 0,
    });
  }, 60_000);

  it('refuses start on a cancelled node with its own refusal code and the reason', async () => {
    await publishPlanFile(
      ISSUE,
      [
        'nodes:',
        ...nodeYaml('g-001', ids[0], 'child-a'),
        ...nodeYaml('g-cut', ids[2], 'child-cut', [
          '    lifecycle: cancelled',
          `    reason: ${JSON.stringify(CANCELLED_REASON)}`,
        ]),
        '',
      ].join('\n')
    );
    const refused = await run(
      ['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--node', 'g-cut', '--json'],
      execProject
    );
    expectRefused(refused, 'issue_start_node_cancelled');
    const statuses = Array.isArray(parseJson(refused).status) ? parseJson(refused).status : [];
    const entry = statuses.find((item: { code: string }) => item.code === 'issue_start_node_cancelled');
    expect(entry.message).toContain('g-cut');
    expect(entry.message).toContain(CANCELLED_REASON);

    // A superseded node refuses under its own code too.
    await publishPlanFile(
      ZERO_ISSUE,
      [
        'nodes:',
        ...nodeYaml('s-sup', ids[1], 'child-opt', [
          '    lifecycle: superseded',
          '    reason: "folded into child-a, which carries the same work"',
        ]),
        '',
      ].join('\n')
    );
    const superseded = await run(
      ['store', 'issue', 'start', ZERO_ISSUE, '--store', f.storeId, '--node', 's-sup', '--json'],
      execProject
    );
    expectRefused(superseded, 'issue_start_node_superseded');
  }, 60_000);

  it('publishes a lifecycle plan from a file with no new CLI surface, and re-publish keeps revision bytes immutable', async () => {
    // 0001 all-required, then 0002 cancelling one node: the earlier revision's
    // bytes never change (the spec's "a lifecycle change is a new revision").
    await publishPlanFile(
      ISSUE,
      [
        'nodes:',
        ...nodeYaml('g-001', ids[0], 'child-a'),
        ...nodeYaml('g-002', ids[1], 'child-opt'),
        '',
      ].join('\n')
    );
    const revision1Path = f.at('rasen', 'issues', ISSUE, 'plans', '0001.yaml');
    const bytes1 = fs.readFileSync(revision1Path, 'utf8');
    await publishPlanFile(
      ISSUE,
      [
        'nodes:',
        ...nodeYaml('g-001', ids[0], 'child-a'),
        ...nodeYaml('g-002', ids[1], 'child-opt', [
          '    lifecycle: cancelled',
          `    reason: ${JSON.stringify(CANCELLED_REASON)}`,
        ]),
        '',
      ].join('\n')
    );
    expect(fs.readFileSync(revision1Path, 'utf8')).toBe(bytes1);
    const revision2 = fs.readFileSync(f.at('rasen', 'issues', ISSUE, 'plans', '0002.yaml'), 'utf8');
    expect(revision2).toContain('lifecycle: cancelled');
    expect(revision2).toContain(CANCELLED_REASON);
    // The stored canonical form omits lifecycle for required nodes.
    expect(revision2).not.toContain('lifecycle: required');
  }, 60_000);
});
