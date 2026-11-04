/**
 * `issue-revision-history-preservation` task 3.6 (read forms) and the 3.3
 * verification — the record's carried exclusions presented by every surface
 * that presents the record, in parity across forms, through the real CLI
 * (dist/): the `accept` write result (human and `--json`), and `show`'s
 * acceptance block reading the same facts back from the durable record
 * (human and `--json`).
 *
 * Run-state lives in a real execution root beside the fixture, written with
 * the frozen `writeRunState`, so the CLI consumes exactly the bytes the LEAD
 * produces; the query prefers committed record copies, so the store is
 * committed before a read asserts what it derives.
 */
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
const ISSUE = 'xcl-issue';
const ISSUE_JSON = 'xcl-issue-json';

const REASON = 'folded into g-002, which carries the same work';
const EXCLUSION_ROW = { nodeId: 'g-sup', lifecycle: 'superseded', reason: REASON };

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

describe('rasen store issue acceptance exclusions surface', () => {
  let f: StoreWorkspaceFixture;
  let execProject: string;
  let issueKeys: Map<string, string>;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-xcl-cli-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execProject = f.beside('exec-project');
    f.write(path.join(execProject, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    issueKeys = new Map();
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

  /**
   * Creates the Issue with a two-required-plus-one-superseded plan and one
   * conditions revision; terminal run-state for both required children. The
   * change ids carry the issue suffix — two issues share the fixture's Store,
   * and a re-seed of identical paths would have nothing to commit.
   */
  async function createSupersededIssue(issueId: string, suffix: string): Promise<void> {
    const created = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'new', issueId, '--store', f.storeId, '--title', 'Carry CLI', '--json'],
          f.storeRoot
        )
      )
    );
    issueKeys.set(issueId, created.identity.key);
    const aliasA = `child-a-${suffix}`;
    const aliasB = `child-b-${suffix}`;
    // 32 lowercase hex characters each, distinct per child and per issue.
    const ids = [
      seedAndCommit(aliasA, `a${suffix}`.repeat(16)),
      seedAndCommit(aliasB, `b${suffix}`.repeat(16)),
      seedAndCommit(`child-sup-${suffix}`, `d${suffix}`.repeat(16)),
    ];
    const nodesFile = f.beside(`nodes-${issueId}.yaml`);
    f.write(
      nodesFile,
      [
        'nodes:',
        '  - nodeId: g-001',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[0])}`,
        `    changeAlias: ${aliasA}`,
        '    dependsOn: []',
        '  - nodeId: g-002',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[1])}`,
        `    changeAlias: ${aliasB}`,
        '    dependsOn: []',
        '  - nodeId: g-sup',
        '    kind: change',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        `    changeInstanceId: ${JSON.stringify(ids[2])}`,
        `    changeAlias: child-sup-${suffix}`,
        '    lifecycle: superseded',
        `    reason: ${JSON.stringify(REASON)}`,
        '    dependsOn: []',
        '',
      ].join('\n')
    );
    expectOk(
      await run(
        ['store', 'issue', 'plan', issueId, '--store', f.storeId, '--from-file', nodesFile, '--json'],
        f.storeRoot
      )
    );
    const conditionsFile = f.beside(`conditions-${issueId}.yaml`);
    f.write(
      conditionsFile,
      ['conditions:', '  - id: cond-1', '    requirement: The carry is shipped', '', ''].join('\n')
    );
    expectOk(
      await run(
        [
          'store',
          'issue',
          'acceptance',
          issueId,
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
    f.git(f.storeRoot, ['commit', '-m', `issue + plan + conditions ${issueId}`]);
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
    writeRunState(ephemeraDir(execProject, aliasA), TERMINAL_STAGES);
    writeRunState(ephemeraDir(execProject, aliasB), TERMINAL_STAGES);
  }

  it('presents the carried exclusion beside the gate snapshot on every record surface, in parity', async () => {
    await createSupersededIssue(ISSUE, '1');
    await createSupersededIssue(ISSUE_JSON, '2');

    // The accept write result, human form: the exclusion beside the total it
    // explains — the record's own arithmetic, not a later evaluation's.
    const human = expectOk(
      await run(['store', 'issue', 'accept', ISSUE, '--store', f.storeId], execProject)
    );
    expect(human.stdout).toContain(`Issue ${issueKeys.get(ISSUE)} accepted (resolved)`);
    expect(human.stdout).toContain('gate: 2/2 waiting-human, 0 problems standing');
    expect(human.stdout).toContain(`excluded g-sup (superseded): ${REASON}`);

    // The same write result, JSON form: the record object carries the field.
    const json = parseJson(
      expectOk(
        await run(
          ['store', 'issue', 'accept', ISSUE_JSON, '--store', f.storeId, '--json'],
          execProject
        )
      )
    );
    expect(json.record.gate).toEqual({
      completed: 2,
      total: 2,
      health: 'waiting-human',
      problemsStanding: 0,
    });
    expect(json.record.exclusions).toEqual([EXCLUSION_ROW]);

    // The durable read, human form: show's acceptance section presents the
    // exclusion the RECORD froze, beside the live gate evaluation's own
    // exclusion line — same facts, two derivations agreeing (the gate line
    // bullets its exclusions, the record line does not).
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'accept issues']);
    const showHuman = expectOk(
      await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId], execProject)
    );
    expect(showHuman.stdout).toContain('record: accepted ');
    expect(showHuman.stdout).toContain('under revision 0001 (gate 2/2');
    const excludedLines = showHuman.stdout
      .split(/\r?\n/u)
      .filter(line => line.includes('excluded g-sup'));
    expect(excludedLines).toHaveLength(2);
    for (const line of excludedLines) {
      expect(line).toContain(`excluded g-sup (superseded): ${REASON}`);
    }

    // The durable read, JSON form: both the record's carried exclusions and
    // the live evaluation's, under `status.acceptance`.
    const showJson = parseJson(
      expectOk(
        await run(['store', 'issue', 'show', ISSUE, '--store', f.storeId, '--json'], execProject)
      )
    );
    expect(showJson.status.acceptance.record.exclusions).toEqual([EXCLUSION_ROW]);
    expect(showJson.status.acceptance.gate.exclusions).toEqual([EXCLUSION_ROW]);
    expect(showJson.status.phase).toBe('done');
  }, 180_000);
});
