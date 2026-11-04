/**
 * `issue-needs-attention` tasks 2.2/2.3/3.1/3.2 — `rasen store attention`
 * through the real CLI (built dist), over a real Store fixture.
 *
 * The unmasking receipt (3.1) is the suite's spine: one Issue with two running
 * siblings and one failed node (a portfolio record's escalated child — the
 * run-state writer's documented FAILURE signal) beside another Issue parked
 * waiting for a human. The failure item must LEAD the answer carrying
 * `active`+`failed`, with no scan line or grouping presenting the Issue as
 * merely busy. The same fixture carries the cross-issue ordering pin (3.2),
 * the human/`--json` parity and counts-summarize-without-replacing pins
 * (2.2), and the byte-identical write-nothing receipt (2.3). The staged
 * failure shape of task 4.4 is this fixture's twin — the receipt under
 * evidence/ cites this suite.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';
import { writeRunState } from '../../src/core/pipeline-registry/run-state.js';
import { writePortfolioState } from '../../src/core/pipeline-registry/portfolio-state.js';
import { ephemeraDir } from '../../src/core/file-placement.js';

const PROJECT = 'app-a';
const LINE = 'main';
const ISSUE_ALPHA = 'fleet-alpha';
const ISSUE_BETA = 'fleet-beta';

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

/** A deterministic fingerprint of every file under a root, path → sha256. */
function treeFingerprint(root: string): Map<string, string> {
  const fingerprints = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        walk(full);
        continue;
      }
      fingerprints.set(
        path.relative(root, full),
        createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      );
    }
  };
  walk(root);
  return fingerprints;
}

describe('rasen store attention', () => {
  let f: StoreWorkspaceFixture;
  let execProject: string;
  let nowhere: string;
  let issueIdentities: Map<string, { readonly uid: string; readonly key: string }>;

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

  async function publishNodes(issueId: string, nodesFile: string, nodes: readonly string[]): Promise<void> {
    f.write(nodesFile, `${['nodes:', ...nodes, ''].join('\n')}`);
    expectOk(
      await run(
        ['store', 'issue', 'plan', issueId, '--store', f.storeId, '--from-file', nodesFile, '--json'],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `${issueId} + plan`]);
  }

  function identityOf(issueId: string): { readonly uid: string; readonly key: string } {
    const identity = issueIdentities.get(issueId);
    if (identity === undefined) throw new Error(`Issue '${issueId}' has not been created.`);
    return identity;
  }

  async function openIssue(issueId: string, title: string): Promise<void> {
    const created = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'new', issueId, '--store', f.storeId, '--title', title, '--json'],
          f.storeRoot
        )
      )
    );
    issueIdentities.set(issueId, created.identity);
  }

  /**
   * The unmasking fixture: fleet-alpha carries two running siblings, one
   * failed node, and one not-started node blocked behind the failure;
   * fleet-beta is parked waiting for a human.
   */
  async function buildTroubleFixture(): Promise<void> {
    const run1 = seedAndCommit('run-1', 'a1'.repeat(16));
    const run2 = seedAndCommit('run-2', 'b2'.repeat(16));
    const boom = seedAndCommit('boom', 'c3'.repeat(16));
    const down = seedAndCommit('down', 'd4'.repeat(16));
    const park = seedAndCommit('park', 'e5'.repeat(16));
    await openIssue(ISSUE_ALPHA, 'Fleet alpha');
    await openIssue(ISSUE_BETA, 'Fleet beta');
    await publishNodes(
      ISSUE_ALPHA,
      f.beside('nodes-alpha.yaml'),
      [
        '  - nodeId: g-run-1',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(run1)}`,
        '    changeAlias: run-1',
        '    dependsOn: []',
        '  - nodeId: g-run-2',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(run2)}`,
        '    changeAlias: run-2',
        '    dependsOn: []',
        '  - nodeId: g-fail',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(boom)}`,
        '    changeAlias: boom',
        '    dependsOn: []',
        '  - nodeId: g-down',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(down)}`,
        '    changeAlias: down',
        '    dependsOn: [g-fail]',
      ]
    );
    await publishNodes(
      ISSUE_BETA,
      f.beside('nodes-beta.yaml'),
      [
        '  - nodeId: g-park',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(park)}`,
        '    changeAlias: park',
        '    dependsOn: []',
      ]
    );
    // Two healthy running siblings ...
    writeRunState(ephemeraDir(execProject, 'run-1'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });
    writeRunState(ephemeraDir(execProject, 'run-2'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });
    // ... the failure: a portfolio record whose child escalated — the
    // run-state writer's documented failure signal, which must surface over
    // the siblings still running.
    writePortfolioState(ephemeraDir(execProject, 'boom'), {
      parent: 'fleet-parent',
      children: [
        { id: 'c-001', pipeline: 'small-feature', dependsOn: [], status: 'escalated' },
      ],
    });
    // ... and the parked stage on the OTHER Issue.
    writeRunState(ephemeraDir(execProject, 'park'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'escalated' } },
    });
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-store-attention-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main' }],
    });
    issueIdentities = new Map();
    // A standalone project root: its `.rasen/changes/<alias>/ephemera` is the
    // execution-root landing the projection searches first, so the scan runs
    // from here and observes every run-state above.
    execProject = f.beside('exec-project');
    f.write(path.join(execProject, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    nowhere = f.beside('nowhere');
    fs.mkdirSync(nowhere, { recursive: true });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('the failed Issue leads unmasked, in parity across forms, writing nothing (tasks 2.2/2.3/3.1/3.2)', { timeout: 180000 }, async () => {
    await buildTroubleFixture();

    const beforeStore = treeFingerprint(f.storeRoot);
    const beforeData = treeFingerprint(f.globalDataDir);
    const beforeExec = treeFingerprint(path.join(execProject, '.rasen'));

    const json = parseJson(
      expectOk(await run(['store', 'attention', '--store', f.storeId, '--json'], execProject))
    );

    // The scan summary: every Issue scanned with phase/health/count — the
    // failed-but-active Issue is never presented as merely busy.
    expect(json.scannedCount).toBe(2);
    const scanByIssue = new Map(json.scanned.map((entry: any) => [entry.issueId, entry]));
    expect(scanByIssue.get(identityOf(ISSUE_ALPHA).uid)).toMatchObject({
      phase: 'active',
      health: 'failed',
      itemCount: 2,
    });
    expect(scanByIssue.get(identityOf(ISSUE_BETA).uid)).toMatchObject({
      phase: 'active',
      health: 'waiting-human',
      itemCount: 1,
    });

    // The items, fail-first across Issues, each in full — counts summarize,
    // they never replace. The failure carries active/failed beside the node.
    expect(json.items).toEqual([
      {
        kind: 'failure',
        issueId: identityOf(ISSUE_ALPHA).uid,
        phase: 'active',
        health: 'failed',
        nodeId: 'g-fail',
        alias: 'boom',
        diagnostic: null,
      },
      {
        kind: 'blocked-behind',
        issueId: identityOf(ISSUE_ALPHA).uid,
        phase: 'active',
        health: 'failed',
        nodeId: 'g-down',
        alias: 'down',
        blockers: [{ nodeId: 'g-fail', projectId: PROJECT, state: 'failed' }],
      },
      {
        kind: 'waiting-human',
        issueId: identityOf(ISSUE_BETA).uid,
        phase: 'active',
        health: 'waiting-human',
        nodeId: 'g-park',
        alias: 'park',
      },
    ]);
    expect(json.counts).toEqual({
      failure: 1,
      'blocked-behind': 1,
      'waiting-human': 1,
      'acceptance-awaiting': 0,
      problem: 0,
    });
    expect(json.total).toBe(3);
    expect(json.complete).toBe(true);

    // The human form carries the same facts: the scan line names the failed
    // health beside the active phase, the failure group leads the answer, and
    // every item is listed in full.
    const human = expectOk(
      await run(['store', 'attention', '--store', f.storeId], execProject)
    );
    expect(human.stdout).toContain(`Store attention scan — 2 Issue(s) scanned`);
    expect(human.stdout).toContain(`${identityOf(ISSUE_ALPHA).key}: active/failed — 2 item(s)`);
    expect(human.stdout).toContain(
      `${identityOf(ISSUE_BETA).key}: active/waiting-human — 1 item(s)`
    );
    expect(human.stdout).toContain(`run-state: ${execProject}`);
    expect(human.stdout).toContain('attention: 3 item(s)');
    expect(human.stdout).toContain('failure (1)');
    expect(human.stdout).toContain(
      `[${identityOf(ISSUE_ALPHA).key} active/failed] g-fail boom failed`
    );
    expect(human.stdout).toContain('blocked-behind (1)');
    expect(human.stdout).toContain(
      `[${identityOf(ISSUE_ALPHA).key} active/failed] g-down down blocked behind g-fail@${PROJECT}: failed`
    );
    expect(human.stdout).toContain('waiting-human (1)');
    expect(human.stdout).toContain(
      `[${identityOf(ISSUE_BETA).key} active/waiting-human] g-park park waiting for a human`
    );
    // The failure line leads the waiting-human line — fail-first is the
    // order the answer reads in, not just a JSON detail.
    expect(human.stdout.indexOf('g-fail boom failed')).toBeLessThan(
      human.stdout.indexOf('g-park park waiting for a human')
    );
    expect(human.stdout).toContain('wrote nothing');

    // WRITES NOTHING: the byte-identical receipt across BOTH invocations.
    expect([...treeFingerprint(f.storeRoot).entries()]).toEqual([...beforeStore.entries()]);
    expect([...treeFingerprint(f.globalDataDir).entries()]).toEqual([...beforeData.entries()]);
    expect([...treeFingerprint(path.join(execProject, '.rasen')).entries()]).toEqual([
      ...beforeExec.entries(),
    ]);
  });

  it('the same scan over unchanged evidence yields the same answer (determinism)', { timeout: 120000 }, async () => {
    await buildTroubleFixture();
    const first = parseJson(
      expectOk(await run(['store', 'attention', '--store', f.storeId, '--json'], execProject))
    );
    const second = parseJson(
      expectOk(await run(['store', 'attention', '--store', f.storeId, '--json'], execProject))
    );
    expect(second).toEqual(first);
  });

  it('narrows to one Issue and refuses an unknown id, never an empty scan', { timeout: 120000 }, async () => {
    await buildTroubleFixture();
    const narrowed = parseJson(
      expectOk(
        await run(['store', 'attention', '--store', f.storeId, '--issue', ISSUE_ALPHA, '--json'], execProject)
      )
    );
    expect(narrowed.narrowed).toBe(true);
    expect(narrowed.scannedCount).toBe(1);
    expect(narrowed.scanned[0].issueId).toBe(identityOf(ISSUE_ALPHA).uid);
    // Only alpha's items — beta's parked stage is out of the narrowed scan.
    expect(narrowed.items.map((item: any) => item.kind)).toEqual(['failure', 'blocked-behind']);

    const refused = expectRefused(
      await run(['store', 'attention', '--store', f.storeId, '--issue', 'no-such-issue', '--json'], execProject),
      'issue_attention_unknown_issue'
    );
    const message = parseJson(refused).status.find(
      (entry: { code: string }) => entry.code === 'issue_attention_unknown_issue'
    );
    expect(message.message).toContain('no-such-issue');
  });

  it('an all-healthy store reports the empty state as a stated fact', { timeout: 120000 }, async () => {
    // One Issue whose only node is fresh (not-started, nothing blocking) —
    // scanned, visible, honestly unlisted.
    const fresh = seedAndCommit('fresh', 'f6'.repeat(16));
    await openIssue('quiet-issue', 'Nothing needs a human');
    await publishNodes(
      'quiet-issue',
      f.beside('nodes-quiet.yaml'),
      [
        '  - nodeId: g-fresh',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(fresh)}`,
        '    changeAlias: fresh',
        '    dependsOn: []',
      ]
    );
    const json = parseJson(
      expectOk(await run(['store', 'attention', '--store', f.storeId, '--json'], nowhere))
    );
    expect(json.total).toBe(0);
    expect(json.items).toEqual([]);
    expect(json.scanned).toEqual([
      {
        issueId: identityOf('quiet-issue').uid,
        issueKey: identityOf('quiet-issue').key,
        phase: 'ready',
        health: 'healthy',
        itemCount: 0,
        runStateVisibility: { kind: 'none' },
      },
    ]);
    const human = expectOk(await run(['store', 'attention', '--store', f.storeId], nowhere));
    expect(human.stdout).toContain('1 Issue(s) scanned');
    expect(human.stdout).toContain(
      `${identityOf('quiet-issue').key}: ready/healthy — 0 item(s)`
    );
    expect(human.stdout).toContain('none need attention — 1 Issue(s) scanned');
    expect(human.stdout).toContain('none visible from this directory');
  });

  it('derives from committed evidence alone when run-state is not visible, without presenting absence as a state', { timeout: 120000 }, async () => {
    await buildTroubleFixture();
    // The SAME store from a directory that resolves no execution root: the
    // failed node reads not-started (absence is not a recorded failure), the
    // scan says what was visible, and no item presents absence as a state.
    const json = parseJson(
      expectOk(await run(['store', 'attention', '--store', f.storeId, '--json'], nowhere))
    );
    expect(json.total).toBe(0);
    expect(json.items).toEqual([]);
    expect(json.scannedCount).toBe(2);
    for (const entry of json.scanned) {
      expect(entry.runStateVisibility).toEqual({ kind: 'none' });
    }
    const human = expectOk(await run(['store', 'attention', '--store', f.storeId], nowhere));
    expect(human.stdout).toContain('none visible from this directory');
    expect(human.stdout).toContain('none need attention — 2 Issue(s) scanned');
  });

  it('a review-phase Issue surfaces acceptance-awaiting end-to-end with its gate carried', { timeout: 150000 }, async () => {
    // One Issue whose required node's work is terminal and whose acceptance
    // conditions are published but not accepted: the projection reads
    // review/waiting-human and the scan carries the gate evaluation.
    const done = seedAndCommit('done-child', 'a7'.repeat(16));
    await openIssue('review-issue', 'Work complete, acceptance pending');
    await publishNodes(
      'review-issue',
      f.beside('nodes-review.yaml'),
      [
        '  - nodeId: g-done',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(done)}`,
        '    changeAlias: done-child',
        '    dependsOn: []',
      ]
    );
    writeRunState(ephemeraDir(execProject, 'done-child'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'done' }, ship: { status: 'done' } },
    });
    const conditionsFile = f.beside('conditions.yaml');
    f.write(
      conditionsFile,
      `${['conditions:', '  - id: cond-1', '    requirement: All the work landed', ''].join('\n')}`
    );
    expectOk(
      await run(
        ['store', 'issue', 'acceptance', 'review-issue', '--store', f.storeId, '--from-file', conditionsFile, '--json'],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'conditions']);

    const json = parseJson(
      expectOk(await run(['store', 'attention', '--store', f.storeId, '--json'], execProject))
    );
    expect(json.total).toBe(1);
    expect(json.items).toHaveLength(1);
    const item = json.items[0];
    expect(item.kind).toBe('acceptance-awaiting');
    expect(item.issueId).toBe(identityOf('review-issue').uid);
    expect(item.phase).toBe('review');
    expect(item.health).toBe('waiting-human');
    expect(item.nodeId).toBeNull();
    // The gate evaluation rides the item: terminal node, no problems — the
    // acceptance is the human's next act and the gate says so.
    expect(item.gate.eligible).toBe(true);
    expect(item.gate.conditionsRevisionId).toBe('0001');
    const scan = json.scanned.find(
      (entry: any) => entry.issueId === identityOf('review-issue').uid
    );
    expect(scan).toMatchObject({ phase: 'review', health: 'waiting-human', itemCount: 1 });

    const human = expectOk(await run(['store', 'attention', '--store', f.storeId], execProject));
    expect(human.stdout).toContain(
      `${identityOf('review-issue').key}: review/waiting-human — 1 item(s)`
    );
    expect(human.stdout).toContain('acceptance-awaiting (1)');
    expect(human.stdout).toContain(
      `[${identityOf('review-issue').key} review/waiting-human] acceptance is the human's next act (gate holds, conditions revision 0001)`
    );
  });
});
