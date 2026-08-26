/**
 * `issue-deferral-record` tasks 3.3/5.1/5.2 — the deferral through the REAL
 * CLI (built dist/), over a real Store fixture: the whole ring an operator
 * walks, in both forms.
 *
 *   revision 1 (required + optional) -> revision 2 defers the optional node
 *   -> `show` (node line, revision delta, gate exclusion)
 *   -> `ready` (the deferred exit)
 *   -> `start --node` (the refusal, no launch contract)
 *   -> `accept` (the deferral frozen into the record)
 *
 * Three of those surfaces render GENERICALLY and were expected to need zero
 * edits — `renderStatusNode`, `renderGateLine`, and the record's exclusion
 * lines — so this suite is what proves the expectation instead of asserting
 * it in a comment; only `renderReadyExit` gained a case.
 *
 * The reads are also the writes-nothing receipt (task 5.2): every file under
 * the Store checkout and the isolated global data dir is hashed before and
 * after, and the refusal rows assert the same over a refused publication.
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
import { ephemeraDir } from '../../src/core/file-placement.js';

const PROJECT = 'app-a';
const LINE = 'main';
const ISSUE = 'defer-issue';

const REASON = 'postponed beyond this Issue to the next milestone';

const TERMINAL_STAGES = {
  pipeline: 'small-feature',
  stages: {
    propose: { status: 'done' },
    apply: { status: 'done' },
    verify: { status: 'done' },
    'review-loop': { status: 'done' },
    ship: { status: 'done' },
    archive: { status: 'done' },
  },
} as const;

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

/** A deterministic fingerprint of every file under a root, path -> sha256. */
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

describe('rasen store issue surfaces under a deferral', () => {
  let f: StoreWorkspaceFixture;
  let execProject: string;
  let instanceIds: string[];

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-defer-cli-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execProject = f.beside('exec-project');
    f.write(path.join(execProject, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    instanceIds = [];
  });

  afterEach(() => {
    f.cleanup();
  });

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

  function changeNodeLines(
    nodeId: string,
    instanceId: string,
    alias: string,
    extra: readonly string[] = []
  ): readonly string[] {
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

  async function publish(file: string, nodeLines: readonly string[]): Promise<RunCLIResult> {
    f.write(file, `${['nodes:', ...nodeLines, ''].join('\n')}`);
    return run(
      ['store', 'issue', 'plan', ISSUE, '--store', f.storeId, '--from-file', file, '--json'],
      f.storeRoot
    );
  }

  /** The Issue, its two seeded children, and revision 0001 (required + optional). */
  async function seedWantedRevision(): Promise<void> {
    expectOk(
      await run(
        ['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Deferral CLI', '--json'],
        f.storeRoot
      )
    );
    instanceIds = [
      seedAndCommit('child-a', 'a1'.repeat(16)),
      seedAndCommit('child-opt', 'b2'.repeat(16)),
    ];
    expectOk(
      await publish(f.beside('nodes-1.yaml'), [
        ...changeNodeLines('g-001', instanceIds[0] as string, 'child-a'),
        ...changeNodeLines('g-opt', instanceIds[1] as string, 'child-opt', [
          '    lifecycle: optional',
        ]),
      ])
    );
    const conditionsFile = f.beside('conditions.yaml');
    f.write(
      conditionsFile,
      ['conditions:', '  - id: cond-1', '    requirement: The deferral is recorded', '', ''].join('\n')
    );
    expectOk(
      await run(
        [
          'store',
          'issue',
          'acceptance',
          ISSUE,
          '--store',
          f.storeId,
          '--from-file',
          conditionsFile,
          '--json',
        ],
        execProject
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan 0001 + conditions']);
  }

  /** Revision 0002: the optional node deferred with its recorded reason. */
  async function publishDeferral(): Promise<void> {
    expectOk(
      await publish(f.beside('nodes-2.yaml'), [
        ...changeNodeLines('g-001', instanceIds[0] as string, 'child-a'),
        ...changeNodeLines('g-opt', instanceIds[1] as string, 'child-opt', [
          '    lifecycle: deferred',
          `    reason: ${JSON.stringify(REASON)}`,
        ]),
      ])
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'plan 0002 defers g-opt']);
  }

  it('renders the deferral on show, ready, start, and accept — in parity, reading writes nothing', async () => {
    await seedWantedRevision();
    await publishDeferral();

    const beforeStore = treeFingerprint(f.storeRoot);
    const beforeData = treeFingerprint(f.globalDataDir);

    // ---- show, human: the node line, the delta, the gate exclusion --------
    const showHuman = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    // renderStatusNode is generic — no edit, and this is the proof.
    expect(showHuman.stdout).toContain(`(deferred: ${REASON})`);
    // The revision delta reports the lifecycle crossing.
    expect(showHuman.stdout).toContain('~ lifecycle g-opt (optional -> deferred)');
    // renderGateLine is generic too: the exclusion prints with its reason.
    expect(showHuman.stdout).toContain(`excluded g-opt (deferred): ${REASON}`);

    // ---- show, --json: the same facts -----------------------------------
    const showJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    const deferredNode = showJson.status.nodes.find(
      (node: { nodeId: string }) => node.nodeId === 'g-opt'
    );
    expect(deferredNode.lifecycle).toBe('deferred');
    expect(deferredNode.reason).toBe(REASON);
    expect(showJson.status.delta.lifecycleChanges).toEqual([
      { nodeId: 'g-opt', from: 'optional', to: 'deferred' },
    ]);
    expect(showJson.status.acceptance.gate.exclusions).toEqual([
      { nodeId: 'g-opt', lifecycle: 'deferred', reason: REASON },
    ]);
    // The deferral held nothing: the gate is eligible over g-001 alone once
    // its work is complete — here it is not yet, so the ONLY blocker is g-001.
    expect(
      showJson.status.acceptance.gate.blockers.map((blocker: { nodeId?: string }) => blocker.nodeId)
    ).toEqual(['g-001']);

    // ---- ready: the named exit, never a zero-blocker "blocked" -----------
    const readyJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'ready', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(readyJson.ready.members.map((member: { nodeId: string }) => member.nodeId)).toEqual([
      'g-001',
    ]);
    expect(readyJson.ready.exits).toEqual([
      { nodeId: 'g-opt', reason: { kind: 'deferred', reason: REASON } },
    ]);
    const readyHuman = expectOk(
      await run(['store', 'issue', 'ready', ISSUE, '--store', f.storeId], execProject)
    );
    expect(readyHuman.stdout).toContain(`g-opt: deferred (${REASON})`);
    expect(readyHuman.stdout).toContain('wrote nothing');

    // ---- start --node: the refusal, and no launch contract ---------------
    const refused = expectRefused(
      await run(
        ['store', 'issue', 'start', ISSUE, '--store', f.storeId, '--node', 'g-opt', '--json'],
        execProject
      ),
      'issue_start_node_deferred'
    );
    const refusedJson = parseJson(refused);
    const refusal = refusedJson.status.find(
      (entry: { code: string }) => entry.code === 'issue_start_node_deferred'
    );
    expect(refusal.message).toContain('g-opt');
    expect(refusal.message).toContain('deferred');
    expect(refusal.message).toContain(REASON);
    expect(refusal.message).toContain('postponed beyond this Issue');
    expect(refusal.fix).toContain('re-publish a revision whose lifecycle wants it');
    // No contract of any kind rode the refusal.
    expect(refusedJson.binding ?? null).toBeNull();

    // WRITES NOTHING: every read above left the Store and the data dir byte
    // identical (the refusal included).
    expect([...treeFingerprint(f.storeRoot).entries()]).toEqual([...beforeStore.entries()]);
    expect([...treeFingerprint(f.globalDataDir).entries()]).toEqual([...beforeData.entries()]);

    // ---- accept: the deferral frozen into the record ---------------------
    writeRunState(ephemeraDir(execProject, 'child-a'), TERMINAL_STAGES);
    const acceptHuman = expectOk(
      await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId], execProject)
    );
    expect(acceptHuman.stdout).toContain(`Issue ${ISSUE} accepted (resolved)`);
    // The required total is 1 — the deferral explains why, beside it.
    expect(acceptHuman.stdout).toContain('gate: 1/1 waiting-human, 0 problems standing');
    expect(acceptHuman.stdout).toContain(`excluded g-opt (deferred): ${REASON}`);

    // The durable bytes carry it, and the read presents it in both forms.
    const acceptedPath = f.at('rasen', 'issues', ISSUE, 'accepted.yaml');
    const acceptedText = fs.readFileSync(acceptedPath, 'utf8');
    expect(acceptedText).toContain('lifecycle: deferred');
    expect(acceptedText).toContain(REASON);

    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'accept with a standing deferral']);
    const doneJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(doneJson.status.acceptance.record.exclusions).toEqual([
      { nodeId: 'g-opt', lifecycle: 'deferred', reason: REASON },
    ]);
    expect(doneJson.status.phase).toBe('done');
    const doneHuman = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    // Both derivations name it: the record's frozen row and the live gate's.
    const excludedLines = doneHuman.stdout
      .split(/\r?\n/u)
      .filter(line => line.includes('excluded g-opt'));
    expect(excludedLines.length).toBeGreaterThanOrEqual(1);
    for (const line of excludedLines) {
      expect(line).toContain(`excluded g-opt (deferred): ${REASON}`);
    }
  }, 240_000);

  it('refuses a reasonless deferral and a deferred intent node, writing nothing', async () => {
    await seedWantedRevision();
    const beforeStore = treeFingerprint(f.storeRoot);
    const beforeData = treeFingerprint(f.globalDataDir);

    // A deferral with no recorded reason: the whole point of the value is the
    // record, so the schema refuses rather than storing a bare postponement.
    const reasonless = await publish(f.beside('nodes-bad-1.yaml'), [
      ...changeNodeLines('g-001', instanceIds[0] as string, 'child-a'),
      ...changeNodeLines('g-opt', instanceIds[1] as string, 'child-opt', [
        '    lifecycle: deferred',
      ]),
    ]);
    expect(reasonless.exitCode).toBe(1);
    expect(`${reasonless.stdout}${reasonless.stderr}`).toContain('recorded reason');

    // A deferred INTENT node: postponement of work no Change ever backed is
    // spelled `optional` or by omission, and the refusal says so.
    const intentDeferred = await publish(f.beside('nodes-bad-2.yaml'), [
      ...changeNodeLines('g-001', instanceIds[0] as string, 'child-a'),
      '  - nodeId: i-001',
      '    kind: intent',
      `    projectId: ${PROJECT}`,
      `    targetLineId: ${LINE}`,
      '    summary: work declared, no Change yet',
      '    lifecycle: deferred',
      '    dependsOn: []',
    ]);
    expect(intentDeferred.exitCode).toBe(1);
    const intentText = `${intentDeferred.stdout}${intentDeferred.stderr}`;
    expect(intentText).toContain('i-001');
    expect(intentText).toContain('deferred');
    expect(intentText).toContain('omitting the node from the next revision');

    // Nothing was written by either refusal: no revision 0002 exists, and
    // every byte under both roots is unchanged.
    expect([...treeFingerprint(f.storeRoot).entries()]).toEqual([...beforeStore.entries()]);
    expect([...treeFingerprint(f.globalDataDir).entries()]).toEqual([...beforeData.entries()]);
    const showJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(showJson.plan.revision.revisionId).toBe('0001');
  }, 240_000);
});
