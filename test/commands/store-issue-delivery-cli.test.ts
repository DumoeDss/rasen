/**
 * `issue-delivery-evidence-rollup` task 4.2 — the show surface's delivery
 * evidence through the real CLI: human/JSON parity for the rollup and the
 * per-node facts, and the listing's compactness fence (no delivery facts on
 * the list surface; the rollup is the show surface's answer).
 *
 * The archived node is a real v1 ledger (the receipts shape), so the parity
 * assertions run against exactly the bytes `issue-registry`'s closed Issues
 * carry.
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
const ISSUE = 'delivery-cli-issue';
const CODE_COMMIT = '31d0b6440a453a128af29b900329c5389e52cf30';
const PLANNING_BRANCH = 'feat/issue-phase2';
const SHIP_LOG_SHA = 'b'.repeat(64);

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

describe('rasen store issue show — delivery evidence', () => {
  let f: StoreWorkspaceFixture;
  let execRoot: string;
  let instanceId: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-delivery-cli-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    // A standalone project root: its ephemera is where `child-b`'s run-state
    // lives, and the CLI reads with it as the working directory.
    execRoot = f.beside('exec');
    f.write(path.join(execRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
  });

  afterEach(() => {
    f.cleanup();
  });

  async function run(args: readonly string[], cwd: string): Promise<RunCLIResult> {
    return runCLI([...args], { cwd, env: f.env });
  }

  /**
   * The Issue plus a two-node plan: one Change archived under a real v1
   * ledger (the receipts shape, ship-log frozen in the inventory) and one
   * active Change whose run-state is terminal — the real store's two truths.
   */
  async function createIssueWithArchive(): Promise<void> {
    await run(
      ['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Delivery CLI', '--json'],
      f.storeRoot
    );
    const archived = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-a',
      instanceSeed: 'a1'.repeat(16),
    });
    instanceId = archived.instanceId;
    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-b',
      instanceSeed: 'b2'.repeat(16),
    });
    writeRunState(ephemeraDir(execRoot, 'child-b'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'done' } },
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed child-a + child-b']);

    const nodesFile = f.beside('nodes.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        '  - nodeId: g-archived',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(archived.instanceId)}`,
        '    changeAlias: child-a',
        '    dependsOn: []',
        '  - nodeId: g-active',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(active.instanceId)}`,
        '    changeAlias: child-b',
        '    dependsOn: [g-archived]',
        '',
      ].join('\n')
    );
    await run(
      ['store', 'issue', 'plan', ISSUE, '--store', f.storeId, '--from-file', nodesFile, '--json'],
      f.storeRoot
    );

    const entryName = `2026-08-22-child-a--${archived.instanceId.slice(3, 15)}`;
    const archiveDir = f.at('rasen', 'projects', PROJECT, 'changes', 'archive', LINE, entryName);
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(archived.directory, archiveDir);
    fs.writeFileSync(
      path.join(archiveDir, 'archive.json'),
      `${JSON.stringify(
        {
          change: 'child-a',
          archivedAt: '2026-08-20T05:56:26.013Z',
          codeCommit: CODE_COMMIT,
          planningBranch: PLANNING_BRANCH,
          planningTreeState: 'dirty',
          evidence: [
            { path: 'evidence/affected-set-gate.log', sha256: 'c'.repeat(64) },
            { path: 'evidence/ship-log.md', sha256: SHIP_LOG_SHA },
          ],
          probes: [],
          handoffAbsorbed: [],
          ephemeraDiscarded: [],
          missing: ['verification-report'],
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'archive child-a under a v1 ledger']);
  }

  it('renders the section in human form and the same facts in --json', async () => {
    await createIssueWithArchive();

    const human = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execRoot)
    );
    const out = human.stdout;
    // The section header, beside status and acceptance.
    expect(out).toContain('  delivery evidence:');
    // The archived row: identity, observation, named record state with basis.
    expect(out).toMatch(
      /g-archived \S+@app-a — finalized — record \(legacy\)/u
    );
    // The record facts, each verbatim from the ledger.
    expect(out).toContain(`      code commit: ${CODE_COMMIT}`);
    expect(out).toContain(`      planning branch: ${PLANNING_BRANCH}`);
    expect(out).toContain('      archived: 2026-08-20T05:56:26.013Z');
    expect(out).toContain('      outcome: (none recorded on this legacy record basis)');
    expect(out).toContain('      evidence: 2 file(s)');
    // The ship-log as an inventory fact — path plus digest, never parsed prose.
    expect(out).toContain(`      ship-log: evidence/ship-log.md (sha256 ${SHIP_LOG_SHA.slice(0, 12)})`);
    expect(out).toContain('      missing: verification-report');
    // The not-archived sibling names its absence as the named state.
    expect(out).toMatch(/g-active \S+@app-a — run-terminal — not-archived/u);
    expect(out).toContain('      delivery evidence will exist when the Change archives');
    // The closing counts line.
    expect(out).toContain(
      '    counts: 1 record, 0 no-record, 1 not-archived, 0 unreadable, 0 unattributed'
    );

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execRoot))
    );
    // The rollup rides beside status, carrying the revision and the counts.
    expect(json.delivery.revisionId).toBe('0001');
    expect(json.delivery.counts).toEqual({
      record: 1,
      'no-record': 0,
      'not-archived': 1,
      unreadable: 0,
      unattributed: 0,
    });
    expect(json.delivery.entries.map((entry: { nodeId: string }) => entry.nodeId)).toEqual([
      'g-active',
      'g-archived',
    ]);
    // Parity, fact by fact: everything the human section rendered is a fact
    // the machine form carries, under the rollup and the node's status entry.
    const nodeStatus = json.status.nodes.find(
      (node: { nodeId: string }) => node.nodeId === 'g-archived'
    );
    expect(nodeStatus.delivery).toMatchObject({
      state: 'record',
      basis: 'legacy',
      archivedAt: '2026-08-20T05:56:26.013Z',
      codeCommit: CODE_COMMIT,
      planningBranch: PLANNING_BRANCH,
      outcome: null,
      evidence: [
        { path: 'evidence/affected-set-gate.log', sha256: 'c'.repeat(64) },
        { path: 'evidence/ship-log.md', sha256: SHIP_LOG_SHA },
      ],
      missing: ['verification-report'],
    });
    const rollupEntry = json.delivery.entries.find(
      (entry: { nodeId: string }) => entry.nodeId === 'g-archived'
    );
    expect(rollupEntry.observation).toBe('finalized');
    expect(rollupEntry.delivery).toEqual(nodeStatus.delivery);
    const activeStatus = json.status.nodes.find(
      (node: { nodeId: string }) => node.nodeId === 'g-active'
    );
    expect(activeStatus.delivery).toEqual({ state: 'not-archived' });
  });

  it('keeps the listing compact — no delivery facts on the list surface', async () => {
    await createIssueWithArchive();

    const human = expectOk(
      await run(['store', 'issue', 'list', '--store', f.storeId], execRoot)
    );
    // No delivery section, no delivery fact on any listing line: the commit,
    // the branch, and the inventory are the show surface's answer.
    expect(human.stdout).not.toContain('delivery evidence:');
    expect(human.stdout).not.toContain(CODE_COMMIT);
    expect(human.stdout).not.toContain(PLANNING_BRANCH);
    expect(human.stdout).not.toContain('ship-log');
    // The listing's own line shape is untouched.
    expect(human.stdout).toMatch(new RegExp(`${ISSUE}  \\[open\\]`, 'u'));

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'list', '--store', f.storeId, '--json'], execRoot))
    );
    // No rollup key on any listed Issue — the rollup is show's answer. (The
    // embedded per-node facts ride the status the list already carries; the
    // LISTING adds nothing of its own.)
    for (const issue of json.issues) {
      expect(issue.delivery).toBeUndefined();
    }
  });
});
