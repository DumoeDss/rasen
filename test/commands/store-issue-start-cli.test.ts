/**
 * `issue-execution-binding` task 3.4 — `rasen store issue start` through the
 * real CLI (built dist), over a real Store fixture.
 *
 * The workspace-pair route is fed by a REAL machine workspace index document
 * written into the fixture's isolated global data dir — the same bytes
 * `store workspace plan --existing-change` + `apply` produce — and the
 * member-project checkout route runs the real session-launch composition
 * against an empty isolated project registry (the honest degraded read). No
 * fake launch contexts exist at this layer: the CLI seam composes exactly
 * what production composes.
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
import { writeProjectRegistryState } from '../../src/core/project-registry.js';
import { writeRunState } from '../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../src/core/file-placement.js';

const PROJECT = 'app-a';
const LINE = 'main';
const ISSUE = 'layer-issue';
const NOW = '2026-08-17T00:00:00.000Z';

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

describe('rasen store issue start', () => {
  let f: StoreWorkspaceFixture;
  let execRoot: string;
  let nowhere: string;
  let instanceIds: string[];

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

  /** Writes the machine workspace index document `apply` would have written. */
  function writeIndexEntry(changeId: string, changeInstanceId: string, executionRoot: string): void {
    const scopeId = f.planningScopeId(PROJECT, LINE);
    const side = (root: string) => ({
      root,
      repositoryIdentity: 'repo',
      worktreeInstanceId: `wt-${path.basename(root)}`,
      ref: 'refs/heads/main',
      headOid: 'a'.repeat(40),
    });
    const document = {
      version: 1,
      planningScopeId: scopeId,
      entries: [
        {
          version: 1,
          planningScopeId: scopeId,
          storeUid: f.storeUid,
          storeId: f.storeId,
          projectId: PROJECT,
          targetLineId: LINE,
          changeId,
          changeInstanceId,
          planning: side(f.storeRoot),
          execution: side(executionRoot),
          planId: `plan-${changeId}`,
          phase: 'bound',
          recordedAt: NOW,
          updatedAt: NOW,
        },
      ],
    };
    const target = path.join(f.globalDataDir, 'planning-workspaces', 'index', `${scopeId}.json`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }

  /** Creates the Issue plus a three-child serial plan (g-001..g-003). */
  async function createSerialIssue(): Promise<void> {
    await run(['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Issue layer', '--json'], f.storeRoot);
    instanceIds = [
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
        `    changeInstanceId: ${JSON.stringify(instanceIds[0])}`,
        '    changeAlias: child-a',
        '    dependsOn: []',
        '  - nodeId: g-002',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(instanceIds[1])}`,
        '    changeAlias: child-b',
        '    dependsOn: [g-001]',
        '  - nodeId: g-003',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(instanceIds[2])}`,
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
      prefix: 'rasen-issue-start-cli-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execRoot = f.beside('exec-root');
    nowhere = f.beside('nowhere');
    fs.mkdirSync(nowhere, { recursive: true });
  });

  afterEach(() => {
    f.cleanup();
  });

  // spawn-heavy: 27933ms solo (phase-1 review) / >30000ms under 2026-08-20 ambient load
  // (C2-parity budget class — solo-measured, the established convention)
  it('emits the frontier launch contract from a workspace index entry, in parity across forms', { timeout: 60000 }, async () => {
    await createSerialIssue();
    writeIndexEntry('child-a', instanceIds[0], execRoot);

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--json'], nowhere)
      )
    );
    expect(json.issueId).toBe(ISSUE);
    expect(json.binding.mode).toBe('fresh');
    expect(json.binding.nodeId).toBe('g-001');
    expect(json.binding.alias).toBe('child-a');
    expect(json.binding.launch).toEqual({
      form: 'workspace-pair',
      cwd: execRoot,
      attachedRoots: [f.storeRoot],
    });
    expect(json.binding.pipeline).toBeNull();

    const human = expectOk(
      await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId], nowhere)
    );
    expect(human.stdout).toContain('g-001 — fresh launch');
    expect(human.stdout).toContain(`cwd: ${execRoot}`);
    expect(human.stdout).toContain(`attached: ${f.storeRoot}`);
    expect(human.stdout).toContain('binding: workspace-pair');
    expect(human.stdout).toContain('(chosen at launch)');

    // Unchanged evidence yields the same contract (no second mutable truth).
    const again = parseJson(
      expectOk(
        await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--json'], nowhere)
      )
    );
    expect(again).toEqual(json);
  });

  it('refuses an unprepared Change with the exact preparation, from a store-root cwd', async () => {
    await createSerialIssue();
    // A machine with NO registered checkout for the member project: empty the
    // isolated project registry (the fixture registers its projects by
    // default), so the L6 route answers `execution_not_found` — the honest
    // "neither binding exists" state the preparation line is for.
    await writeProjectRegistryState({ version: 1, projects: {} }, { globalDataDir: f.globalDataDir });
    const result = expectRefused(
      await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--json'], f.storeRoot),
      'issue_start_unprepared'
    );
    const json = parseJson(result);
    const refusal = json.status.find(
      (entry: { code: string }) => entry.code === 'issue_start_unprepared'
    );
    expect(refusal.message).toContain('neither a workspace index entry nor a resolvable member-project checkout');
    expect(refusal.fix).toBe(
      `rasen store workspace plan --existing-change --store ${f.storeId} `
        + `--project ${PROJECT} --target-line ${LINE} --change child-a`
    );
  });

  it('refuses an Issue with no plan toward planning', async () => {
    await run(['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'No plan yet', '--json'], f.storeRoot);
    const result = expectRefused(
      await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--json'], nowhere),
      'issue_start_requires_plan'
    );
    const json = parseJson(result);
    const refusal = json.status.find(
      (entry: { code: string }) => entry.code === 'issue_start_requires_plan'
    );
    expect(refusal.message).toContain('planning');
    expect(refusal.message).toContain('publish');
  });

  it('refuses naming every candidate when the frontier is ambiguous', async () => {
    await run(['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Parallel', '--json'], f.storeRoot);
    const ids = [seedAndCommit('child-a', 'a1'.repeat(16)), seedAndCommit('child-b', 'b2'.repeat(16))];
    const nodesFile = f.beside('nodes.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        '  - nodeId: p-001',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[0])}`,
        '    changeAlias: child-a',
        '    dependsOn: []',
        '  - nodeId: p-002',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[1])}`,
        '    changeAlias: child-b',
        '    dependsOn: []',
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

    const result = expectRefused(
      await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--json'], nowhere),
      'issue_start_frontier_ambiguous'
    );
    const json = parseJson(result);
    const refusal = json.status.find(
      (entry: { code: string }) => entry.code === 'issue_start_frontier_ambiguous'
    );
    expect(refusal.message).toContain('p-001');
    expect(refusal.message).toContain('p-002');
    expect(refusal.message).toContain('--node');
  });

  it('refuses a blocked --node naming its non-terminal dependency', async () => {
    await createSerialIssue();
    const result = expectRefused(
      await run(
        ['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--node', 'g-002', '--json'],
        nowhere
      ),
      'issue_start_node_not_runnable'
    );
    const json = parseJson(result);
    const refusal = json.status.find(
      (entry: { code: string }) => entry.code === 'issue_start_node_not_runnable'
    );
    expect(refusal.message).toContain('g-001');
    expect(refusal.message).toContain('not complete');
  });

  it('reports an in-flight node as already running with its recorded pipeline', async () => {
    await createSerialIssue();
    writeIndexEntry('child-a', instanceIds[0], execRoot);
    // The real run-state in the indexed execution root: g-001 is mid-run.
    writeRunState(ephemeraDir(execRoot, 'child-a'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });

    const json = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--node', 'g-001', '--json'],
          nowhere
        )
      )
    );
    expect(json.binding.mode).toBe('already-running');
    expect(json.binding.pipeline).toBe('small-feature');
    expect(json.binding.runStatePath).toBe(
      path.join(ephemeraDir(execRoot, 'child-a'), 'auto-run.json')
    );
    expect(json.binding.locatedBy).toBe('workspace-index');
    expect(json.binding.launch).toEqual({
      form: 'workspace-pair',
      cwd: execRoot,
      attachedRoots: [f.storeRoot],
    });

    const human = expectOk(
      await run(
        ['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--node', 'g-001'],
        nowhere
      )
    );
    expect(human.stdout).toContain('already running (resume-oriented)');
    expect(human.stdout).toContain('pipeline: small-feature');
    expect(human.stdout).toContain(`run-state: ${path.join(ephemeraDir(execRoot, 'child-a'), 'auto-run.json')}`);
  });

  it('refuses a --pipeline that disagrees with the running node\'s recorded pipeline', async () => {
    await createSerialIssue();
    writeIndexEntry('child-a', instanceIds[0], execRoot);
    writeRunState(ephemeraDir(execRoot, 'child-a'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });

    const result = expectRefused(
      await run(
        [
          'store', 'issue', 'start', ISSUE, '--store', f.storeId,
          '--node', 'g-001', '--pipeline', 'bug-fix', '--json',
        ],
        nowhere
      ),
      'issue_start_pipeline_conflict'
    );
    const json = parseJson(result);
    const refusal = json.status.find(
      (entry: { code: string }) => entry.code === 'issue_start_pipeline_conflict'
    );
    expect(refusal.message).toContain('bug-fix');
    expect(refusal.message).toContain('small-feature');
  });

  it('refuses an unknown --pipeline', async () => {
    await createSerialIssue();
    writeIndexEntry('child-a', instanceIds[0], execRoot);
    expectRefused(
      await run(
        [
          'store', 'issue', 'start', ISSUE, '--store', f.storeId,
          '--pipeline', 'no-such-pipeline', '--json',
        ],
        nowhere
      ),
      'issue_start_pipeline_unknown'
    );
  });

  it('attributes the running node on the show surface from an unrelated directory', async () => {
    await createSerialIssue();
    writeIndexEntry('child-a', instanceIds[0], execRoot);
    writeRunState(ephemeraDir(execRoot, 'child-a'), {
      pipeline: 'small-feature',
      stages: {
        propose: {
          status: 'done',
          worker: { runtime: 'claude', role: 'planner', agentId: 'agent-1', sessionId: 'sess-9', transcript: 'agent-sess-9.jsonl' },
        },
        apply: { status: 'in_progress' },
      },
    });

    const human = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], nowhere)
    );
    expect(human.stdout).toContain(`g-001 change ${PROJECT} child-a — in-flight`);
    expect(human.stdout).toContain('pipeline: small-feature (located by workspace-index)');
    expect(human.stdout).toContain('session propose (claude planner): sessionId=sess-9 transcript=agent-sess-9.jsonl');
    // The evidence directory of the Change's store-side planning address.
    expect(human.stdout).toContain(
      path.join('rasen', 'projects', PROJECT, 'changes', 'child-a', 'evidence')
    );
    // A live agent handle is never presented as durable.
    expect(human.stdout).not.toContain('agent-1');

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], nowhere))
    );
    const node = json.status.nodes[0];
    expect(node.observation).toBe('in-flight');
    expect(node.locatedBy).toBe('workspace-index');
    expect(node.attribution.pipeline).toBe('small-feature');
    expect(node.attribution.sessions).toEqual([
      {
        stageId: 'propose',
        role: 'planner',
        runtime: 'claude',
        sessionId: 'sess-9',
        transcript: 'agent-sess-9.jsonl',
      },
    ]);
    expect(node.attribution.evidenceLocator).toBe(
      path.join(f.storeRoot, 'rasen', 'projects', PROJECT, 'changes', 'child-a', 'evidence')
    );
    // Both forms carry the same facts.
    expect(JSON.stringify(node)).not.toContain('agentId');
  });

  it('writes nothing across a start invocation — the command seam, byte-identical', async () => {
    await createSerialIssue();
    writeIndexEntry('child-a', instanceIds[0], execRoot);
    writeRunState(ephemeraDir(execRoot, 'child-a'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });

    /** sha256 of every file under a root, keyed by the path relative to it. */
    const digestTree = (root: string): Map<string, string> => {
      const digests = new Map<string, string>();
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const target = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(target);
          else {
            digests.set(
              path.relative(root, target),
              createHash('sha256').update(fs.readFileSync(target)).digest('hex')
            );
          }
        }
      };
      walk(root);
      return digests;
    };
    const snapshot = () => ({
      // Issue records and plan revisions.
      store: digestTree(path.join(f.storeRoot, 'rasen')),
      // Run-state and the pair association file.
      exec: digestTree(path.join(execRoot, '.rasen')),
      // The machine workspace index the widening reads.
      index: digestTree(path.join(f.globalDataDir, 'planning-workspaces')),
    });
    const before = snapshot();

    // A successful already-running report through the pair route, then a
    // refusal — both must leave every byte where it was. The success's
    // output is asserted first so the guard is not vacuous.
    const human = expectOk(
      await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--node', 'g-001'], nowhere)
    );
    expect(human.stdout).toContain('already running (resume-oriented)');
    expect(human.stdout).toContain(`cwd: ${execRoot}`);
    expectRefused(
      await run(['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--node', 'g-002', '--json'], nowhere),
      'issue_start_node_not_runnable'
    );

    const after = snapshot();
    expect(after.store).toEqual(before.store);
    expect(after.exec).toEqual(before.exec);
    expect(after.index).toEqual(before.index);
  });
});
