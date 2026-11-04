/**
 * `issue-unified-review-gate` tasks 3.2/4.1/4.2 — the show surface's review
 * view through the real CLI: the determination matrix over temp stores
 * (review-ready with threads standing, not-ready with mixed blockers,
 * conditions-missing, dropped), human/`--json` parity, the listing's
 * compactness fence, and the byte-identical write-nothing receipt.
 *
 * The fixture recipes extend the delivery suite's: a real archived v1 ledger
 * (the receipts shape), real run-state for the terminal and in-flight
 * siblings, and — for the not-ready row — a reference that breaks AFTER
 * publication, the honest way a standing problem appears.
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
const ISSUE_READY = 'review-cli-ready';
const ISSUE_BLOCKED = 'review-cli-blocked';
const ISSUE_CONDITIONS = 'review-cli-conditions';
const ISSUE_DROPPED = 'review-cli-dropped';
const CODE_COMMIT = '31d0b6440a453a128af29b900329c5389e52cf30';

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

describe('rasen store issue show — the review view', () => {
  let f: StoreWorkspaceFixture;
  let execRoot: string;
  let issueIdentities: Map<string, { readonly uid: string; readonly key: string }>;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-review-cli-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execRoot = f.beside('exec');
    f.write(path.join(execRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    issueIdentities = new Map();
  });

  afterEach(() => {
    f.cleanup();
  });

  async function run(args: readonly string[], cwd: string): Promise<RunCLIResult> {
    return runCLI([...args], { cwd, env: f.env });
  }

  /** One plan node row of a nodes.yaml file. */
  function nodeRow(
    nodeId: string,
    instanceId: string,
    alias: string,
    extras: readonly string[] = []
  ): readonly string[] {
    return [
      `  - nodeId: ${nodeId}`,
      '    kind: change',
      `    projectId: ${PROJECT}`,
      `    targetLineId: ${LINE}`,
      `    changeInstanceId: ${JSON.stringify(instanceId)}`,
      `    changeAlias: ${alias}`,
      ...extras,
      '    dependsOn: []',
    ];
  }

  /**
   * The review-ready fixture: one Change archived under a real v1 ledger
   * whose record froze `verification-report` missing, one run-terminal active
   * Change, one optional Change in flight, and a published conditions
   * revision — the gate holds while every node-scoped thread kind stands.
   */
  async function createReadyIssue(): Promise<void> {
    const created = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'new', ISSUE_READY, '--store', f.storeId, '--title', 'Review CLI ready', '--json'],
          f.storeRoot
        )
      )
    );
    issueIdentities.set(ISSUE_READY, created.identity);
    const archived = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-a',
      instanceSeed: 'a1'.repeat(16),
    });
    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-b',
      instanceSeed: 'b2'.repeat(16),
    });
    const optional = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-c',
      instanceSeed: 'c3'.repeat(16),
    });
    writeRunState(ephemeraDir(execRoot, 'child-b'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'done' } },
    });
    writeRunState(ephemeraDir(execRoot, 'child-c'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed child-a + child-b + child-c']);

    const nodesFile = f.beside('nodes-ready.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        ...nodeRow('g-archived', archived.instanceId, 'child-a'),
        ...nodeRow('g-active', active.instanceId, 'child-b'),
        ...nodeRow('g-optional', optional.instanceId, 'child-c', ['    lifecycle: optional']),
        '',
      ].join('\n')
    );
    await run(
      ['store', 'issue', 'plan', ISSUE_READY, '--store', f.storeId, '--from-file', nodesFile, '--json'],
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
          planningBranch: 'feat/review-cli',
          planningTreeState: 'dirty',
          evidence: [{ path: 'evidence/ship-log.md', sha256: 'b'.repeat(64) }],
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

    const conditionsFile = f.beside('conditions.yaml');
    f.write(
      conditionsFile,
      ['conditions:', '  - id: cond-1', '    requirement: The review CLI condition', ''].join('\n')
    );
    await run(
      ['store', 'issue', 'acceptance', ISSUE_READY, '--store', f.storeId, '--from-file', conditionsFile, '--json'],
      f.storeRoot
    );
  }

  it('concludes a review-ready Issue in human form and --json with the same facts', async () => {
    await createReadyIssue();

    const human = expectOk(
      await run(['store', 'issue', 'show', ISSUE_READY, '--store', f.storeId], execRoot)
    );
    const out = human.stdout;
    // The concluding section, after the delivery evidence.
    expect(out.indexOf('  delivery evidence:')).toBeLessThan(out.indexOf('  review:'));
    // The determination names the conditions revision it would accept.
    expect(out).toContain('    determination: review-ready (would accept conditions revision 0001)');
    // Every thread kind stands beside the holding gate — counted and listed.
    expect(out).toContain('    threads: 3');
    expect(out).toContain('      optional-open g-optional (in-flight)');
    expect(out).toContain(
      '      archive-pending g-active (run-terminal — evidence will exist when the Change archives)'
    );
    expect(out).toContain('      evidence-missing g-archived: verification-report');
    // The verification summary, by reference to the same read's facts. The
    // optional node's not-archived delivery counts too — counts summarize the
    // delivery states, threads name the reviewer-facing facts.
    expect(out).toContain(
      '    verification: required 2/2, delivery 1 record / 0 no-record / 2 not-archived / 0 unreadable / 0 unattributed'
    );
    // The closing statement.
    expect(out).toContain("    review derives; accepting remains the operator's act.");

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE_READY, '--store', f.storeId, '--json'], execRoot)
      )
    );
    // The review key rides beside status and delivery, same derivation.
    expect(json.review.issueId).toBe(issueIdentities.get(ISSUE_READY)?.uid);
    expect(json.review.revisionId).toBe('0001');
    expect(json.review.determination).toEqual({
      kind: 'review-ready',
      conditionsRevisionId: '0001',
    });
    expect(json.review.threads).toEqual([
      { kind: 'optional-open', nodeId: 'g-optional', observation: 'in-flight' },
      {
        kind: 'archive-pending',
        nodeId: 'g-active',
        observation: 'run-terminal',
      },
      { kind: 'evidence-missing', nodeId: 'g-archived', names: ['verification-report'] },
    ]);
    expect(json.review.verification).toEqual({
      progress: { completed: 2, total: 2 },
      delivery: {
        record: 1,
        'no-record': 0,
        'not-archived': 2,
        unreadable: 0,
        unattributed: 0,
      },
    });
  });

  it("renders not-ready over the gate's blockers without duplicating them", async () => {
    await run(
      ['store', 'issue', 'new', ISSUE_BLOCKED, '--store', f.storeId, '--title', 'Review CLI blocked', '--json'],
      f.storeRoot
    );
    const runner = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-r',
      instanceSeed: 'd4'.repeat(16),
    });
    const ghost = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-g',
      instanceSeed: 'e5'.repeat(16),
    });
    writeRunState(ephemeraDir(execRoot, 'child-r'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed child-r + child-g']);

    const nodesFile = f.beside('nodes-blocked.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        ...nodeRow('g-runner', runner.instanceId, 'child-r'),
        ...nodeRow('g-ghost', ghost.instanceId, 'child-g'),
        '',
      ].join('\n')
    );
    await run(
      ['store', 'issue', 'plan', ISSUE_BLOCKED, '--store', f.storeId, '--from-file', nodesFile, '--json'],
      f.storeRoot
    );
    // The reference breaks AFTER publication — the honest standing problem.
    f.git(f.storeRoot, ['rm', '-r', '-q', path.join('rasen', 'projects', PROJECT, 'changes', 'child-g')]);
    f.git(f.storeRoot, ['commit', '-m', 'remove child-g evidence']);
    // Conditions published, so the gate reaches its fact blockers — the
    // structural conditions_required refusal is a different determination.
    const conditionsFile = f.beside('conditions-blocked.yaml');
    f.write(
      conditionsFile,
      ['conditions:', '  - id: cond-1', '    requirement: The blocked condition', ''].join('\n')
    );
    await run(
      ['store', 'issue', 'acceptance', ISSUE_BLOCKED, '--store', f.storeId, '--from-file', conditionsFile, '--json'],
      f.storeRoot
    );

    const human = expectOk(
      await run(['store', 'issue', 'show', ISSUE_BLOCKED, '--store', f.storeId], execRoot)
    );
    // Three gate blockers together: the in-flight runner, the unknown ghost,
    // and the standing unresolved-reference problem.
    expect(human.stdout).toContain('    determination: not-ready (3 blocker(s) named above)');
    // The acceptance section above already listed them; the review section
    // invents and copies none.
    expect(human.stdout).not.toContain('un-terminal-node');
    // The ghost's unattributed delivery names no thread; the runner's
    // in-flight required work is a gate blocker, never a thread.
    expect(human.stdout).toContain('    threads: (none)');

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE_BLOCKED, '--store', f.storeId, '--json'], execRoot)
      )
    );
    expect(json.review.determination).toEqual({ kind: 'not-ready', blockerCount: 3 });
    expect(json.review.threads).toEqual([]);
  });

  it('renders conditions-missing naming the authoring act it awaits', async () => {
    await run(
      ['store', 'issue', 'new', ISSUE_CONDITIONS, '--store', f.storeId, '--title', 'Review CLI conditions', '--json'],
      f.storeRoot
    );
    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-s',
      instanceSeed: 'f6'.repeat(16),
    });
    writeRunState(ephemeraDir(execRoot, 'child-s'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'done' } },
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed child-s']);

    const nodesFile = f.beside('nodes-conditions.yaml');
    f.write(nodesFile, ['nodes:', ...nodeRow('g-done', active.instanceId, 'child-s'), ''].join('\n'));
    await run(
      ['store', 'issue', 'plan', ISSUE_CONDITIONS, '--store', f.storeId, '--from-file', nodesFile, '--json'],
      f.storeRoot
    );

    const human = expectOk(
      await run(['store', 'issue', 'show', ISSUE_CONDITIONS, '--store', f.storeId], execRoot)
    );
    expect(human.stdout).toContain(
      '    determination: conditions-missing (the Issue has no readable acceptance conditions — no acceptance conditions revision exists for it.)'
    );
    // The terminal-but-unarchived node still reads as expected progress.
    expect(human.stdout).toContain('    threads: 1');
    expect(human.stdout).toContain(
      '      archive-pending g-done (run-terminal — evidence will exist when the Change archives)'
    );

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE_CONDITIONS, '--store', f.storeId, '--json'], execRoot)
      )
    );
    expect(json.review.determination.kind).toBe('conditions-missing');
    expect(json.review.verification.progress).toEqual({ completed: 1, total: 1 });
  });

  it('maps a present-but-unverifiable record to accepted with the absence named', { timeout: 120_000 }, async () => {
    const ISSUE = 'review-cli-tampered';
    const created = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Review CLI tampered', '--json'],
          f.storeRoot
        )
      )
    );
    const active = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-t',
      instanceSeed: '97'.repeat(16),
    });
    writeRunState(ephemeraDir(execRoot, 'child-t'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'done' } },
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed child-t']);
    const nodesFile = f.beside('nodes-tampered.yaml');
    f.write(nodesFile, ['nodes:', ...nodeRow('g-done', active.instanceId, 'child-t'), ''].join('\n'));
    await run(
      ['store', 'issue', 'plan', ISSUE, '--store', f.storeId, '--from-file', nodesFile, '--json'],
      f.storeRoot
    );
    const conditionsFile = f.beside('conditions-tampered.yaml');
    f.write(
      conditionsFile,
      ['conditions:', '  - id: cond-1', '    requirement: The tampered corner condition', ''].join('\n')
    );
    await run(
      ['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId, '--from-file', conditionsFile, '--json'],
      f.storeRoot
    );
    // The accept runs from the execution root: from here the run-state the
    // gate's work-complete rule reads is visible and the gate holds.
    await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId, '--json'], execRoot);

    // The record's bytes are tampered AFTER acceptance: one field no longer
    // matches the digest the record froze, so the read finds the record
    // present but unverifiable — the standing unreadable-acceptance problem.
    const recordPath = f.at('rasen', 'issues', created.identity.uid, 'accepted.yaml');
    const tampered = fs
      .readFileSync(recordPath, 'utf8')
      .replace('acceptedAt: 2026-', 'acceptedAt: 1999-');
    fs.writeFileSync(recordPath, tampered, 'utf8');
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'tamper the accepted record']);

    const human = expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execRoot));
    // The gate's never-rewritable ruling still maps accepted; the record
    // facts it would carry are honestly null, named — never filled.
    expect(human.stdout).toContain(
      '    determination: accepted (record present but does not verify — the standing unreadable-acceptance problem is the answer)'
    );

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execRoot))
    );
    expect(json.review.determination).toEqual({
      kind: 'accepted',
      acceptedAt: null,
      conditionsRevisionId: null,
    });
  });

  it('renders dropped naming abandonment', async () => {    await run(
      ['store', 'issue', 'new', ISSUE_DROPPED, '--store', f.storeId, '--title', 'Review CLI dropped', '--json'],
      f.storeRoot
    );
    await run(
      ['store', 'issue', 'state', ISSUE_DROPPED, '--store', f.storeId, '--state', 'dropped', '--reason', 'superseded by another Issue', '--json'],
      f.storeRoot
    );

    const human = expectOk(
      await run(['store', 'issue', 'show', ISSUE_DROPPED, '--store', f.storeId], execRoot)
    );
    expect(human.stdout).toContain('    determination: dropped (abandoned, not acceptable)');

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE_DROPPED, '--store', f.storeId, '--json'], execRoot)
      )
    );
    expect(json.review.determination).toEqual({ kind: 'dropped' });
    // A planless dropped Issue still derives the full view, never null.
    expect(json.review.threads).toEqual([]);
    expect(json.review.verification).toEqual({ progress: null, delivery: null });
  });

  it('keeps the listing compact — no review facts on the list surface', async () => {
    await createReadyIssue();

    const human = expectOk(
      await run(['store', 'issue', 'list', '--store', f.storeId], execRoot)
    );
    expect(human.stdout).not.toContain('review:');
    expect(human.stdout).not.toContain('determination');
    expect(human.stdout).not.toContain('optional-open');
    expect(human.stdout).not.toContain('archive-pending');
    expect(human.stdout).not.toContain('evidence-missing');
    expect(human.stdout).toMatch(
      new RegExp(`${issueIdentities.get(ISSUE_READY)?.key}  \\[open\\]`, 'u')
    );

    const json = parseJson(
      expectOk(await run(['store', 'issue', 'list', '--store', f.storeId, '--json'], execRoot))
    );
    for (const issue of json.issues) {
      expect(issue.review).toBeUndefined();
    }
  });

  it('writes nothing: every byte identical before and after the show reads', async () => {
    await createReadyIssue();

    /** A deterministic fingerprint of every file under a root, path → sha256. */
    const treeFingerprint = (root: string): Map<string, string> => {
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
    };

    // Store content (Issue records, plan revisions, acceptance content,
    // archive records), the workspace index and registries under the global
    // data dir, and the run-state files the observation read.
    const beforeStore = treeFingerprint(f.storeRoot);
    const beforeData = treeFingerprint(f.globalDataDir);
    const beforeExec = treeFingerprint(path.join(execRoot, '.rasen'));
    const beforeMain = f.refOid(f.storeRoot, 'refs/heads/main');

    expectOk(await run(['store', 'issue', 'show', ISSUE_READY, '--store', f.storeId], execRoot));
    expectOk(
      await run(['store', 'issue', 'show', ISSUE_READY, '--store', f.storeId, '--json'], execRoot)
    );

    expect([...treeFingerprint(f.storeRoot).entries()]).toEqual([...beforeStore.entries()]);
    expect([...treeFingerprint(f.globalDataDir).entries()]).toEqual([...beforeData.entries()]);
    expect([...treeFingerprint(path.join(execRoot, '.rasen')).entries()]).toEqual([
      ...beforeExec.entries(),
    ]);
    expect(f.refOid(f.storeRoot, 'refs/heads/main')).toBe(beforeMain);
  });
});
