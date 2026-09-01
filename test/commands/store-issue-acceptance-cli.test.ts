/**
 * `issue-acceptance-close` task 4.4 — the `acceptance` and `accept`
 * subcommands and `show`'s acceptance section, through the real CLI (dist/).
 *
 * Human/JSON parity for the publish and the accept, every named-refusal path
 * (un-terminal, dropped, already-accepted, no-conditions, no-plan), the
 * success path that closes the Issue, the legacy-resolved upgrade, and the
 * acceptance block in both of `show`'s forms. Run-state lives in a real
 * execution root beside the fixture, written with the frozen `writeRunState`,
 * so the CLI consumes exactly the bytes the LEAD produces.
 *
 * The query prefers COMMITTED record copies, so after a state-moving command
 * the store is committed before a read asserts what it derives — the same
 * discipline the projection unit tests state in place.
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

function expectRefused(result: RunCLIResult, ...fragments: readonly string[]): RunCLIResult {
  expect(
    result.exitCode,
    `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(1);
  for (const fragment of fragments) {
    expect(result.stderr, `${result.command}\n${result.stderr}`).toContain(fragment);
  }
  return result;
}

/**
 * A refusal in `--json` form: exit 1, and the diagnostic envelope — taxonomy
 * code included — carried in the stdout payload rather than stderr.
 */
function expectJsonRefused(result: RunCLIResult, code: string): any {
  expect(
    result.exitCode,
    `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(1);
  const payload = parseJson(result);
  expect(payload.status[0].code).toBe(code);
  return payload;
}

describe('rasen store issue acceptance surface', () => {
  let f: StoreWorkspaceFixture;
  let execProject: string;
  let issueUid: string;
  let issueKey: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-accept-cli-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execProject = f.beside('exec-project');
    f.write(path.join(execProject, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
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

  /** Creates the Issue with a three-node plan; returns the conditions file path. */
  async function createStoreIssue(): Promise<string> {
    const created = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'new', ISSUE, '--store', f.storeId, '--title', 'Issue layer', '--json'],
          f.storeRoot
        )
      )
    );
    issueUid = created.identity.uid;
    issueKey = created.identity.key;
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
    const conditionsFile = f.beside('conditions.yaml');
    f.write(
      conditionsFile,
      [
        'conditions:',
        '  - id: cond-1',
        '    requirement: The tri-axis projection is shipped',
        '  - id: cond-2',
        '    requirement: The execution binding loop is proven',
        '    verification: dogfood receipts',
        '',
      ].join('\n')
    );
    return conditionsFile;
  }

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

  it('publishes conditions in parity across forms and refuses without --from-file', async () => {
    const conditionsFile = await createStoreIssue();

    const human = expectOk(
      await run(
        ['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId, '--from-file', conditionsFile],
        execProject
      )
    );
    expect(human.stdout).toContain(`Issue ${issueKey}: acceptance conditions revision 0001`);
    expect(human.stdout).toContain('conditions: 2');
    expect(human.stdout).toContain('git -C ');
    expect(human.stdout).toContain(`rasen/issues/${issueUid}/acceptance/0001.yaml`);

    // A second publish mints the next ordinal in both forms.
    const json = parseJson(
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
      )
    );
    expect(json.revision.revisionId).toBe('0002');
    expect(json.revision.supersedes).toBe('0001');
    expect(json.revision.conditions).toHaveLength(2);
    expect(fs.existsSync(f.at('rasen', 'issues', issueUid, 'acceptance', '0002.yaml'))).toBe(true);
    expect(json).not.toHaveProperty('written');
    expect(json).not.toHaveProperty('suggestedCommits');
    expect(json).not.toHaveProperty('checkoutRoot');

    expectRefused(
      await run(['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId], execProject),
      'requires --from-file'
    );
  }, 60_000);

  it('holds the accept while a required node is un-terminal, naming node and observation', async () => {
    const conditionsFile = await createStoreIssue();
    expectOk(
      await run(
        ['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId, '--from-file', conditionsFile],
        execProject
      )
    );
    // g-001 in flight; the rest not started.
    writeRunState(ephemeraDir(execProject, 'child-a'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });

    const refused = expectRefused(
      await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId], execProject),
      'refused',
      'node g-002 is not-started',
      'node g-003 is not-started',
      'node g-001 is in-flight'
    );
    // Human form names the fix; nothing was written.
    expect(refused.stderr).toContain('Fix:');
    expect(fs.existsSync(f.at('rasen', 'issues', ISSUE, 'accepted.yaml'))).toBe(false);
    const payload = expectJsonRefused(
      await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId, '--json'], execProject),
      'issue_accept_blocked'
    );
    // The blocker facts ride the message, not a lossy one-liner.
    expect(payload.status[0].message).toContain('node g-001 is in-flight');
  }, 60_000);

  it('refuses dropped, already-accepted, conditions-less, and plan-less accepts with distinct codes', async () => {
    await createStoreIssue();

    // Dropped. The state change is Store content: commit it so the query's
    // committed-copy preference presents the dropped record.
    expectOk(
      await run(
        [
          'store',
          'issue',
          'state',
          ISSUE,
          '--store',
          f.storeId,
          '--state',
          'dropped',
          '--reason',
          'Scenario twin',
          '--json',
        ],
        f.storeRoot
      )
    );
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'drop issue']);
    expectJsonRefused(
      await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId, '--json'], execProject),
      'issue_accept_dropped'
    );

    // No conditions revision yet (fresh Issue with a plan).
    await run(
      ['store', 'issue', 'new', 'plan-only', '--store', f.storeId, '--title', 'Plan only', '--json'],
      f.storeRoot
    );
    const id = seedAndCommit('child-solo', 'd4'.repeat(16));
    const soloFile = f.beside('solo.yaml');
    f.write(
      soloFile,
      [
        'nodes:',
        '  - nodeId: g-001',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(id)}`,
        '    changeAlias: child-solo',
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    expectOk(
      await run(
        ['store', 'issue', 'plan', 'plan-only', '--store', f.storeId, '--from-file', soloFile, '--json'],
        f.storeRoot
      )
    );
    expectJsonRefused(
      await run(
        ['store', 'issue', 'accept', 'plan-only', '--store', f.storeId, '--json'],
        execProject
      ),
      'issue_accept_conditions_required'
    );

    // No plan at all.
    await run(
      ['store', 'issue', 'new', 'bare', '--store', f.storeId, '--title', 'Bare', '--json'],
      f.storeRoot
    );
    expectJsonRefused(
      await run(['store', 'issue', 'accept', 'bare', '--store', f.storeId, '--json'], execProject),
      'issue_accept_requires_plan'
    );
    // Nine CLI invocations + three git operations: the budget is raised
    // rather than the scenario split (the four refusal codes are one story).
  }, 90_000);

  it('accepts a completed Issue, closes it, and refuses the second accept', async () => {
    const conditionsFile = await createStoreIssue();
    expectOk(
      await run(
        ['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId, '--from-file', conditionsFile],
        execProject
      )
    );
    writeRunState(ephemeraDir(execProject, 'child-a'), TERMINAL_STAGES);
    writeRunState(ephemeraDir(execProject, 'child-b'), TERMINAL_STAGES);
    writeRunState(ephemeraDir(execProject, 'child-c'), TERMINAL_STAGES);

    const human = expectOk(
      await run(
        ['store', 'issue', 'accept', ISSUE, '--store', f.storeId, '--note', 'All three shipped'],
        execProject
      )
    );
    expect(human.stdout).toContain(`Issue ${issueKey} accepted (resolved)`);
    expect(human.stdout).toContain('conditions: revision 0001');
    expect(human.stdout).toContain('3/3');
    expect(human.stdout).toContain('note: All three shipped');
    // The commit suggestion names BOTH files that moved.
    expect(human.stdout).toContain(`rasen/issues/${issueUid}/accepted.yaml`);
    expect(human.stdout).toContain(`rasen/issues/${issueUid}/issue.yaml`);

    // The second accept is refused, in the JSON form's taxonomy code.
    expectJsonRefused(
      await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId, '--json'], execProject),
      'issue_accept_already_accepted'
    );
  }, 60_000);

  it('upgrades a legacy-resolved close without re-transitioning the state', async () => {
    const conditionsFile = await createStoreIssue();
    expectOk(
      await run(
        [
          'store',
          'issue',
          'state',
          ISSUE,
          '--store',
          f.storeId,
          '--state',
          'resolved',
          '--json',
        ],
        f.storeRoot
      )
    );
    expectOk(
      await run(
        ['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId, '--from-file', conditionsFile],
        execProject
      )
    );
    writeRunState(ephemeraDir(execProject, 'child-a'), TERMINAL_STAGES);
    writeRunState(ephemeraDir(execProject, 'child-b'), TERMINAL_STAGES);
    writeRunState(ephemeraDir(execProject, 'child-c'), TERMINAL_STAGES);

    const json = parseJson(
      expectOk(
        await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(json.state).toBe('resolved');
    expect(json.record.conditionsRevisionId).toBe('0001');
    expect(fs.existsSync(f.at('rasen', 'issues', issueUid, 'accepted.yaml'))).toBe(true);
    expect(json).not.toHaveProperty('suggestedCommits');
  }, 60_000);

  // Thirteen CLI invocations in one scenario: the per-test budget is raised
  // rather than the scenario split, so the parity story stays whole.
  it('shows the acceptance section in both forms, and the second accept is refused', async () => {
    const conditionsFile = await createStoreIssue();
    // Before any conditions: the section still reports the gate honestly.
    const before = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    expect(before.stdout).toContain('acceptance:');
    expect(before.stdout).toContain('conditions: (none published)');
    expect(before.stdout).toContain('gate: not eligible');

    expectOk(
      await run(
        ['store', 'issue', 'acceptance', ISSUE, '--store', f.storeId, '--from-file', conditionsFile],
        execProject
      )
    );
    writeRunState(ephemeraDir(execProject, 'child-a'), TERMINAL_STAGES);
    writeRunState(ephemeraDir(execProject, 'child-b'), TERMINAL_STAGES);
    writeRunState(ephemeraDir(execProject, 'child-c'), TERMINAL_STAGES);

    // The gate line is visible BEFORE it is crossed.
    const eligible = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    expect(eligible.stdout).toContain('conditions: revision 0001 (2 condition(s))');
    expect(eligible.stdout).toContain('cond-1: The tri-axis projection is shipped');
    expect(eligible.stdout).toContain(
      'cond-2: The execution binding loop is proven (verification: dogfood receipts)'
    );
    expect(eligible.stdout).toContain('gate: eligible (would accept conditions revision 0001)');
    expect(eligible.stdout).toContain('record: (not accepted)');

    const eligibleJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(eligibleJson.status.acceptance.conditions.revision.revisionId).toBe('0001');
    expect(eligibleJson.status.acceptance.gate.eligible).toBe(true);
    expect(eligibleJson.status.acceptance.record).toBeNull();

    expectOk(await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId], execProject));
    // The query prefers committed copies: commit before asserting reads.
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'accept issue']);

    const accepted = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    expect(accepted.stdout).toContain('phase: done');
    expect(accepted.stdout).toContain('record: accepted ');
    expect(accepted.stdout).toContain('under revision 0001 (gate 3/3');

    const acceptedJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(acceptedJson.status.phase).toBe('done');
    expect(acceptedJson.status.acceptance.record.conditionsRevisionId).toBe('0001');
    expect(acceptedJson.status.acceptance.gate.eligible).toBe(false);

    const listHuman = expectOk(
      await run(['store', 'issue', 'list', '--store', f.storeId], execProject)
    );
    expect(listHuman.stdout).toContain(`${issueKey}  [resolved]  done/healthy 3/3`);

    const listJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'list', '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(listJson.issues[0].status.phase).toBe('done');
    expect(listJson.issues[0].status.acceptance.record.conditionsRevisionId).toBe('0001');

    expectJsonRefused(
      await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId, '--json'], execProject),
      'issue_accept_already_accepted'
    );
  }, 90_000);
});
