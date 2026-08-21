/**
 * `issue-autodecompose-review-flow` task 3.1 — `rasen store issue confirm`
 * through the real CLI (built dist), over a real Store fixture.
 *
 * The writes-nothing row is the requirement's own fence, byte-identical by
 * receipt: every file under the Store checkout and the isolated global data
 * dir is hashed before and after a confirm that runs to completion, and the
 * two trees must be byte-identical — the Issue record, every revision, every
 * run-state file, and the workspace index alike.
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

const PROJECT = 'app-a';
const LINE = 'main';
const ISSUE = 'confirm-issue';
const NOW = '2026-08-21T00:00:00.000Z';

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

describe('rasen store issue confirm', () => {
  let f: StoreWorkspaceFixture;
  let execRoot: string;
  let nowhere: string;
  let instanceId: string;

  async function run(args: readonly string[], cwd: string): Promise<RunCLIResult> {
    return runCLI([...args], { cwd, env: f.env });
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

  /**
   * The Issue plus a one-change-one-intent plan: the Change node carries a
   * suggestion (the suggestion-aware chain's subject), the intent node is the
   * pending-Change report's subject.
   */
  async function createIssueWithPlan(): Promise<void> {
    await run(['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Confirm CLI', '--json'], f.storeRoot);
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-a',
      instanceSeed: 'a1'.repeat(16),
    });
    instanceId = seeded.instanceId;
    // The plan publication verifies its references against COMMITTED Store
    // evidence, so the seed lands on the ref before the plan is authored.
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed child-a']);
    const nodesFile = f.beside('nodes.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        '  - nodeId: g-001',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(instanceId)}`,
        '    changeAlias: child-a',
        '    dependsOn: []',
        '    suggestedPipeline: small-feature',
        '  - nodeId: i-001',
        '    kind: intent',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        '    summary: docs for the widget',
        '    dependsOn: []',
        '    suggestedPipeline: small-feature',
        '    rationale: docs follow the code',
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
      prefix: 'rasen-issue-confirm-cli-',
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

  it('reports the launch contract set and the pending work, in parity across forms, writing nothing', { timeout: 90000 }, async () => {
    await createIssueWithPlan();
    writeIndexEntry('child-a', instanceId, execRoot);

    const beforeStore = treeFingerprint(f.storeRoot);
    const beforeData = treeFingerprint(f.globalDataDir);

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'confirm', ISSUE, '--store', f.storeId, '--json'], nowhere)
      )
    );

    // The launchable set: the Change node's contract, suggestion-sourced.
    expect(json.revisionId).toBe('0001');
    expect(json.report.contracts).toHaveLength(1);
    expect(json.report.contracts[0]).toMatchObject({
      nodeId: 'g-001',
      mode: 'fresh',
      pipeline: 'small-feature',
      pipelineSource: 'suggestion',
      launch: { form: 'workspace-pair', cwd: execRoot },
    });
    // The pending-Change report: the intent node, named with target, line,
    // and suggestion.
    expect(json.report.pendingChanges).toEqual([
      {
        nodeId: 'i-001',
        projectId: PROJECT,
        targetLineId: LINE,
        summary: 'docs for the widget',
        suggestedPipeline: 'small-feature',
        lifecycle: 'required',
      },
    ]);
    expect(json.report.waiting).toEqual([]);
    expect(json.report.unprepared).toEqual([]);

    // The human form carries the same facts.
    const human = expectOk(
      await run(['store', 'issue', 'confirm', ISSUE, '--store', f.storeId], nowhere)
    );
    expect(human.stdout).toContain('confirm report (revision 0001)');
    expect(human.stdout).toContain('g-001');
    expect(human.stdout).toContain('small-feature');
    expect(human.stdout).toContain('from the plan');
    expect(human.stdout).toContain('i-001');
    expect(human.stdout).toContain('pending Change creation');
    expect(human.stdout).toContain('wrote nothing');

    // WRITES NOTHING: the byte-identical receipt. Both trees hashed before
    // the JSON run; the human run sits between the two hashes, so this
    // proves both invocations left every byte alone.
    expect([...treeFingerprint(f.storeRoot).entries()]).toEqual([...beforeStore.entries()]);
    expect([...treeFingerprint(f.globalDataDir).entries()]).toEqual([...beforeData.entries()]);
  });

  it('confirms the named revision with --revision', { timeout: 90000 }, async () => {
    await createIssueWithPlan();
    const revisionFile = f.beside('nodes-2.yaml');
    f.write(
      revisionFile,
      [
        'nodes:',
        '  - nodeId: g-001',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(instanceId)}`,
        '    changeAlias: child-a',
        '    dependsOn: []',
        '    suggestedPipeline: small-feature',
        '  - nodeId: i-001',
        '    kind: intent',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        '    summary: docs for the widget',
        '    dependsOn: []',
        '    suggestedPipeline: small-feature',
        '    rationale: docs follow the code',
        '    lifecycle: optional',
        '',
      ].join('\n')
    );
    expectOk(
      await run(
        ['store', 'issue', 'plan', ISSUE, '--store', f.storeId, '--from-file', revisionFile, '--json'],
        f.storeRoot
      )
    );

    // Default confirms the LATEST (0002, the optional revision)...
    const latest = parseJson(
      expectOk(
        await run(['store', 'issue', 'confirm', ISSUE, '--store', f.storeId, '--json'], nowhere)
      )
    );
    expect(latest.revisionId).toBe('0002');
    expect(latest.report.pendingChanges[0]).toMatchObject({ lifecycle: 'optional' });
    // ...--revision pins the earlier one.
    const pinned = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'confirm', ISSUE, '--store', f.storeId, '--revision', '0001', '--json'],
          nowhere
        )
      )
    );
    expect(pinned.revisionId).toBe('0001');
    expect(pinned.report.pendingChanges[0]).toMatchObject({ lifecycle: 'required' });
  });

  it('refuses a typoed --revision with its own refusal, not publish advice (round-1 Minor-1)', { timeout: 90000 }, async () => {
    // The reviewer's live case: an Issue that HAS readable revisions, an
    // operator who names one that does not exist. The refusal names the
    // requested ordinal and the readable range, and the fix points at the
    // show command — never at publishing a new revision.
    await createIssueWithPlan();
    const result = expectRefused(
      await run(
        ['store', 'issue', 'confirm', ISSUE, '--store', f.storeId, '--revision', '9999', '--json'],
        nowhere
      ),
      'issue_confirm_revision_unreadable'
    );
    const json = parseJson(result);
    const refusal = json.status.find(
      (entry: { code: string }) => entry.code === 'issue_confirm_revision_unreadable'
    );
    expect(refusal.message).toContain("'9999'");
    expect(refusal.message).toContain('one published revision is 0001');
    expect(refusal.message).not.toContain('planning phase');
    expect(refusal.fix).toBe(
      `Read the Issue's revision ordinals first: \`rasen store issue show ${ISSUE} --store <store>\`, or omit --revision to confirm the latest.`
    );
  });

  it('refuses an Issue with no readable plan toward planning', { timeout: 60000 }, async () => {
    await run(['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'No plan', '--json'], f.storeRoot);
    const refused = expectRefused(
      await run(['store', 'issue', 'confirm', ISSUE, '--store', f.storeId, '--json'], nowhere),
      'issue_confirm_requires_plan'
    );
    expect(refused.stdout).toContain('planning');
  });

  it('refuses a revision whose Change reference stopped resolving, naming the node', { timeout: 90000 }, async () => {
    await createIssueWithPlan();
    // The plan's reference resolved at publication; remove the Change's
    // committed evidence afterwards, so the read-time verification confirm
    // performs finds nothing — the honest path to this refusal, since
    // publication itself would never have accepted the unresolvable node.
    f.git(f.storeRoot, ['rm', '-r', '-q', `rasen/projects/${PROJECT}/changes/child-a`]);
    f.git(f.storeRoot, ['commit', '-m', 'remove child-a']);

    const refused = expectRefused(
      await run(['store', 'issue', 'confirm', ISSUE, '--store', f.storeId, '--json'], nowhere),
      'issue_confirm_reference_unresolved'
    );
    expect(refused.stdout).toContain('g-001');
  });
});
