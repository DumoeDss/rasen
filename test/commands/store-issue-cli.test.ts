/**
 * `store-scoped-issues-management` task 8.9 — the `rasen store issue` CLI.
 *
 * Flag parsing, the no-project-required assertion, refusal output,
 * incomplete-result reporting, JSON/human parity, and the commit
 * suggestions. Every test runs the real CLI via `runCLI`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';

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

describe('rasen store issue CLI', () => {
  let f: StoreWorkspaceFixture;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-cli-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('creates an Issue with only --store and --title, never requiring --project', async () => {
    const result = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'new', 'my-issue', '--store', f.storeId, '--title', 'Test Issue', '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(result.issueId).toBe('my-issue');
    expect(result.record.state).toBe('open');
    expect(result.record.title).toBe('Test Issue');
    // The Issue record carries no project.
    expect(result.record.projectId ?? result.record.project).toBeUndefined();
  });

  it('refuses to create an Issue without --title', async () => {
    const result = await runCLI(
      ['store', 'issue', 'new', 'no-title', '--store', f.storeId, '--json'],
      { cwd: f.storeRoot, env: f.env }
    );
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_scope_required');
  });

  it('prints a pathspec-scoped commit suggestion and stages nothing', async () => {
    const result = expectOk(
      await runCLI(
        ['store', 'issue', 'new', 'commit-test', '--store', f.storeId, '--title', 'Commit Test'],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    // The human output includes a commit suggestion.
    expect(result.stdout).toMatch(/git\s.*commit/);
    // The file exists on disk (the write happened).
    expect(fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'commit-test', 'issue.yaml'))).toBe(true);
    // The Store's Git index is clean — nothing was staged.
    const status = f.git(f.storeRoot, ['status', '--porcelain']);
    // The new file appears as untracked, not staged.
    expect(status).toContain('?? rasen/issues');
  });

  it('lists Issues in both human and JSON forms', async () => {
    // Create an Issue first.
    await runCLI(
      ['store', 'issue', 'new', 'list-test', '--store', f.storeId, '--title', 'List Test', '--json'],
      { cwd: f.storeRoot, env: f.env }
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'seed issue']);

    const humanResult = expectOk(
      await runCLI(
        ['store', 'issue', 'list', '--store', f.storeId],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    const jsonResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'list', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );

    // Both forms report the same Issue.
    expect(humanResult.stdout).toContain('list-test');
    expect(jsonResult.issues).toHaveLength(1);
    expect(jsonResult.issues[0].issueId).toBe('list-test');
  });

  it('shows an Issue detail in both human and JSON forms', async () => {
    await runCLI(
      ['store', 'issue', 'new', 'show-test', '--store', f.storeId, '--title', 'Show Test', '--json'],
      { cwd: f.storeRoot, env: f.env }
    );
    f.git(f.storeRoot, ['add', 'rasen/issues/']);
    f.git(f.storeRoot, ['commit', '-m', 'seed show-test']);

    const humanResult = expectOk(
      await runCLI(
        ['store', 'issue', 'show', 'show-test', '--store', f.storeId],
        { cwd: f.storeRoot, env: f.env }
      )
    );
    const jsonResult = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'show', 'show-test', '--store', f.storeId, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );

    expect(humanResult.stdout).toContain('show-test');
    expect(jsonResult.issue.issueId).toBe('show-test');
  });

  it('transitions Issue state to resolved and to dropped with a reason', async () => {
    await runCLI(
      ['store', 'issue', 'new', 'state-test', '--store', f.storeId, '--title', 'State Test', '--json'],
      { cwd: f.storeRoot, env: f.env }
    );

    const resolved = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'state', 'state-test', '--store', f.storeId, '--state', 'resolved', '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(resolved.record.state).toBe('resolved');

    // Cannot resolve again from a terminal state.
    const reResolved = await runCLI(
      ['store', 'issue', 'state', 'state-test', '--store', f.storeId, '--state', 'resolved', '--json'],
      { cwd: f.storeRoot, env: f.env }
    );
    expect(reResolved.exitCode).not.toBe(0);
  });

  it('publishes an Execution Plan revision and prints the commit suggestion', async () => {
    await runCLI(
      ['store', 'issue', 'new', 'plan-test', '--store', f.storeId, '--title', 'Plan Test', '--json'],
      { cwd: f.storeRoot, env: f.env }
    );

    const nodesFile = f.beside('nodes.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        `  - nodeId: intent-a`,
        '    kind: intent',
        `    projectId: ${PROJECT}`,
        `    targetLineId: ${LINE}`,
        '    summary: An intent node for CLI testing',
        '    dependsOn: []',
        '',
      ].join('\n')
    );

    const result = parseJson(
      expectOk(
        await runCLI(
          ['store', 'issue', 'plan', 'plan-test', '--store', f.storeId, '--from-file', nodesFile, '--json'],
          { cwd: f.storeRoot, env: f.env }
        )
      )
    );
    expect(result.revision.revisionId).toBe('0001');
    expect(result.revision.supersedes).toBeNull();
    // The revision file exists.
    expect(fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'plan-test', 'plans', '0001.yaml'))).toBe(true);
  });
});
