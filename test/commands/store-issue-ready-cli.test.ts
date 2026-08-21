/**
 * `issue-ready-set-scheduling` tasks 6.1/6.3/7.1 — `rasen store issue ready`
 * through the real CLI (built dist), over a real Store fixture.
 *
 * The writes-nothing row is the requirement's own fence, byte-identical by
 * receipt (task 6.3's CLI half): every file under the Store checkout and the
 * isolated global data dir is hashed before and after a ready that runs to
 * completion. Task 7.1's integration shape rides the same fixture family:
 * two member projects, a seeded-legacy archived dependency in one releasing a
 * downstream node in the other, with ZERO run-state anywhere — the ready
 * answer names the member, the exit reasons, and the legacy basis.
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

const PROJECT_A = 'app-a';
const PROJECT_B = 'app-b';
const LINE = 'main';
const ISSUE = 'ready-issue';

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

describe('rasen store issue ready', () => {
  let f: StoreWorkspaceFixture;
  let nowhere: string;

  async function run(args: readonly string[], cwd: string): Promise<RunCLIResult> {
    return runCLI([...args], { cwd, env: f.env });
  }

  function seedAndCommit(
    projectId: string,
    changeId: string,
    instanceSeed: string
  ): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId: LINE,
      changeId,
      instanceSeed,
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed ${changeId}`]);
    return seeded.instanceId;
  }

  /**
   * Seeds a Change and moves it, committed, into the archive line with NO
   * archive record — the Issue #3 shape: a derived v2 identity, delivered
   * before v2 outcome records existed.
   */
  function seedArchivedNoRecord(
    projectId: string,
    changeId: string,
    instanceSeed: string
  ): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId: LINE,
      changeId,
      instanceSeed,
    });
    const entryName = `2026-08-21-${changeId}--${seeded.instanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen',
      'projects',
      projectId,
      'changes',
      'archive',
      LINE,
      entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(seeded.directory, archiveDir);
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', `seed archived ${changeId}`]);
    return seeded.instanceId;
  }

  async function publishNodes(nodesFile: string, nodes: readonly string[]): Promise<void> {
    f.write(nodesFile, `${['nodes:', ...nodes, ''].join('\n')}`);
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
      prefix: 'rasen-issue-ready-cli-',
      projects: [PROJECT_A, PROJECT_B],
      lines: [{ id: LINE, storeRef: 'refs/heads/main' }],
    });
    nowhere = f.beside('nowhere');
    fs.mkdirSync(nowhere, { recursive: true });
    await run(
      ['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Ready CLI', '--json'],
      f.storeRoot
    );
  });

  afterEach(() => {
    f.cleanup();
  });

  it('reports members and every exit reason, in parity across forms, writing nothing', { timeout: 120000 }, async () => {
    const g1 = seedAndCommit(PROJECT_A, 'child-a', 'a1'.repeat(16));
    const g2 = seedAndCommit(PROJECT_A, 'child-b', 'b2'.repeat(16));
    await publishNodes(
      f.beside('nodes.yaml'),
      [
        '  - nodeId: g-001',
        '    kind: change',
        `    projectId: ${PROJECT_A}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(g1)}`,
        '    changeAlias: child-a',
        '    dependsOn: []',
        '    suggestedPipeline: small-feature',
        '  - nodeId: g-002',
        '    kind: change',
        `    projectId: ${PROJECT_A}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(g2)}`,
        '    changeAlias: child-b',
        '    dependsOn: [g-001]',
        '  - nodeId: i-001',
        '    kind: intent',
        `    projectId: ${PROJECT_B}`,
        `    targetLineId: ${LINE}`,
        '    summary: docs for the widget',
        '    dependsOn: []',
      ]
    );

    const beforeStore = treeFingerprint(f.storeRoot);
    const beforeData = treeFingerprint(f.globalDataDir);

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'ready', ISSUE, '--store', f.storeId, '--json'], nowhere))
    );

    // The members: the unblocked fresh node with its suggestion.
    expect(json.revisionId).toBe('0001');
    expect(json.ready.members).toEqual([
      {
        nodeId: 'g-001',
        projectId: PROJECT_A,
        targetLineId: LINE,
        alias: 'child-a',
        suggestedPipeline: 'small-feature',
        lifecycle: 'required',
      },
    ]);
    // Every non-member with its reason, from the closed vocabulary.
    expect(json.ready.exits).toEqual([
      {
        nodeId: 'g-002',
        reason: {
          kind: 'blocked',
          blockers: [
            { nodeId: 'g-001', projectId: PROJECT_A, state: 'not-started, no local run-state' },
          ],
        },
      },
      {
        nodeId: 'i-001',
        reason: { kind: 'pending-change-creation', projectId: PROJECT_B, targetLineId: LINE },
      },
    ]);
    // The visibility label: this read resolved no execution root.
    expect(json.runStateVisibility).toEqual({ kind: 'none' });
    expect(json.problems).toEqual([]);

    // The human form carries the same facts.
    const human = expectOk(
      await run(['store', 'issue', 'ready', ISSUE, '--store', f.storeId], nowhere)
    );
    expect(human.stdout).toContain('ready set (revision 0001)');
    expect(human.stdout).toContain('ready: 1');
    expect(human.stdout).toContain('g-001 change app-a child-a (suggest: small-feature)');
    expect(human.stdout).toContain('not ready: 2');
    expect(human.stdout).toContain('g-002: blocked (g-001@app-a: not-started, no local run-state)');
    expect(human.stdout).toContain(`i-001: pending Change creation (${PROJECT_B}/${LINE})`);
    expect(human.stdout).toContain('none visible from this directory');
    expect(human.stdout).toContain('wrote nothing');

    // WRITES NOTHING: the byte-identical receipt across BOTH invocations.
    expect([...treeFingerprint(f.storeRoot).entries()]).toEqual([...beforeStore.entries()]);
    expect([...treeFingerprint(f.globalDataDir).entries()]).toEqual([...beforeData.entries()]);
  });

  it('cross-project legacy release with zero mirrors — the member, the exit reasons, and the legacy basis (task 7.1)', { timeout: 120000 }, async () => {
    const legacyId = seedArchivedNoRecord(PROJECT_B, 'legacy-dep', 'c3'.repeat(16));
    const downId = seedAndCommit(PROJECT_A, 'fresh-down', 'd4'.repeat(16));
    await publishNodes(
      f.beside('nodes-legacy.yaml'),
      [
        '  - nodeId: g-legacy',
        '    kind: change',
        `    projectId: ${PROJECT_B}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(legacyId)}`,
        '    changeAlias: legacy-dep',
        '    dependsOn: []',
        '  - nodeId: g-down',
        '    kind: change',
        `    projectId: ${PROJECT_A}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(downId)}`,
        '    changeAlias: fresh-down',
        '    dependsOn: [g-legacy]',
      ]
    );

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'ready', ISSUE, '--store', f.storeId, '--json'], nowhere))
    );
    // The downstream in the OTHER member project is the ready member —
    // released on the archive fact alone, no run-state mirror anywhere.
    expect(json.ready.members.map((member: { nodeId: string }) => member.nodeId)).toEqual([
      'g-down',
    ]);
    expect(json.ready.members[0]).toMatchObject({ projectId: PROJECT_A, alias: 'fresh-down' });
    // The legacy dependency exits complete with the basis NAMED — never
    // presented as run-terminal, never guessed.
    expect(json.ready.exits).toEqual([
      {
        nodeId: 'g-legacy',
        reason: {
          kind: 'complete',
          basis: 'finalized on a legacy archive record (no v2 outcome was ever recorded)',
        },
      },
    ]);
    expect(json.runStateVisibility).toEqual({ kind: 'none' });
    expect(json.problems).toEqual([]);

    const human = expectOk(
      await run(['store', 'issue', 'ready', ISSUE, '--store', f.storeId], nowhere)
    );
    expect(human.stdout).toContain('g-down change app-a fresh-down');
    expect(human.stdout).toContain('g-legacy: complete — finalized on a legacy archive record');
    expect(human.stdout).toContain('none visible from this directory');
  });

  it('refuses an Issue with no readable plan toward planning', { timeout: 90000 }, async () => {
    const refused = expectRefused(
      await run(['store', 'issue', 'ready', ISSUE, '--store', f.storeId, '--json'], nowhere),
      'issue_ready_requires_plan'
    );
    const json = parseJson(refused);
    const refusal = json.status.find(
      (entry: { code: string }) => entry.code === 'issue_ready_requires_plan'
    );
    expect(refusal.message).toContain('planning');
    expect(refusal.message).toContain('publish');
  });
});
