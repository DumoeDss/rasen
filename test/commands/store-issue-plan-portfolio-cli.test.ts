/**
 * `issue-plan-publication` task 3.4 — the `rasen store issue plan
 * --from-portfolio` CLI surface, through the real dist CLI.
 *
 * Source exclusivity, the portfolio-location refusals, the source facts in
 * both forms, and the commit-suggestion/no-staging contract. The command runs
 * from the fixture's MEMBER PROJECT root so the resume placement seam resolves
 * the way it does for a real store-bound project.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';
import { ephemeraDir } from '../../src/core/file-placement.js';

const PROJECT = 'elftia';
const LINE = 'line-0.2';
const PARENT = 'parent-of-three';

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

function portfolioJson(
  children: readonly { id: string; dependsOn?: readonly string[] }[]
): string {
  return `${JSON.stringify(
    {
      parent: PARENT,
      childPipeline: 'small-feature',
      children: children.map(child => ({
        id: child.id,
        pipeline: 'small-feature',
        ...(child.dependsOn === undefined ? {} : { dependsOn: [...child.dependsOn] }),
        status: 'pending',
      })),
    },
    null,
    2
  )}\n`;
}

describe('rasen store issue plan --from-portfolio (CLI)', () => {
  let f: StoreWorkspaceFixture;
  let runFromProject: (args: readonly string[]) => Promise<RunCLIResult>;
  let issueUid: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-plan-pub-cli-',
      projects: [PROJECT],
      lines: [
        { id: 'main', storeRef: 'refs/heads/main' },
        { id: LINE, storeRef: 'refs/heads/release/0.2' },
      ],
      storeBranches: ['release/0.2'],
    });
    const cwd = f.projectRoot(PROJECT);
    runFromProject = (args: readonly string[]) =>
      runCLI(args, { cwd, env: f.env });

    // Two committed children the portfolios name.
    for (const [changeId, seed] of [
      ['alpha-child', 'a'.repeat(32)],
      ['beta-child', 'b'.repeat(32)],
    ] as const) {
      f.seedChange({
        root: f.storeRoot,
        projectId: PROJECT,
        targetLineId: LINE,
        changeId,
        instanceSeed: seed,
      });
    }
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'land children']);

    const created = parseJson(
      expectOk(
        await runFromProject([
          'store', 'issue', 'new', 'cli-issue', '--store', f.storeId,
          '--title', 'CLI portfolio publication', '--json',
        ])
      )
    );
    issueUid = created.identity.uid;
  });

  afterEach(() => {
    f.cleanup();
  });

  function seedPortfolioAtChangeDir(
    children: readonly { id: string; dependsOn?: readonly string[] }[]
  ): string {
    const changeDir = f.at('rasen', 'projects', PROJECT, 'changes', PARENT);
    fs.mkdirSync(changeDir, { recursive: true });
    const statePath = path.join(changeDir, 'portfolio-run.json');
    fs.writeFileSync(statePath, portfolioJson(children), 'utf8');
    return statePath;
  }

  it('publishes a revision from the portfolio, in --json form', async () => {
    const statePath = seedPortfolioAtChangeDir([
      { id: 'alpha-child' },
      { id: 'beta-child', dependsOn: ['alpha-child'] },
    ]);

    const result = parseJson(
      expectOk(
        await runFromProject([
          'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
          '--from-portfolio', PARENT, '--json',
        ])
      )
    );
    expect(result.revision.revisionId).toBe('0001');
    expect(result.revision.nodes).toHaveLength(2);
    expect(result.source).toEqual({
      kind: 'portfolio',
      parent: PARENT,
      statePath,
      childCount: 2,
    });
    expect(result.suggestedCommits).toHaveLength(1);
    expect(fs.existsSync(f.at('rasen', 'issues', issueUid, 'plans', '0001.yaml'))).toBe(true);
  });

  it('carries the source facts in the human form too, beside the commit suggestion', async () => {
    const statePath = seedPortfolioAtChangeDir([
      { id: 'alpha-child' },
      { id: 'beta-child', dependsOn: ['alpha-child'] },
    ]);

    const human = expectOk(
      await runFromProject([
        'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
        '--from-portfolio', PARENT,
      ])
    );
    // The same facts the JSON form carries: parent, run-state path, ordinal,
    // child count — and the pathspec-scoped commit suggestion.
    expect(human.stdout).toContain(`Execution Plan revision 0001`);
    expect(human.stdout).toContain(PARENT);
    expect(human.stdout).toContain(statePath);
    expect(human.stdout).toContain('2 children');
    expect(human.stdout).toMatch(/git\s.*add/);
    expect(human.stdout).toMatch(/git\s.*commit/);
    // And the Store's Git index is untouched: nothing staged.
    const status = f.git(f.storeRoot, ['status', '--porcelain']);
    for (const line of status.split(/\r?\n/).filter(Boolean)) {
      expect(line.startsWith('??')).toBe(true);
    }
  });

  it('refuses both sources together, naming both and that one must be chosen', async () => {
    const statePath = seedPortfolioAtChangeDir([{ id: 'alpha-child' }]);
    const nodesFile = f.beside('nodes.yaml');
    f.write(nodesFile, 'nodes: []\n');

    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
      '--from-file', nodesFile, '--from-portfolio', PARENT, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_plan_source_conflict');
    const said = `${result.stdout}${result.stderr}`;
    expect(said).toContain('--from-file');
    expect(said).toContain('--from-portfolio');
    // Nothing was published and the run-state was never read as a source.
    expect(fs.existsSync(f.at('rasen', 'issues', 'cli-issue', 'plans', '0001.yaml'))).toBe(false);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(portfolioJson([{ id: 'alpha-child' }]));
  });

  it('refuses neither source, naming both the publication accepts', async () => {
    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_plan_source_required');
    const said = `${result.stdout}${result.stderr}`;
    expect(said).toContain('--from-file');
    expect(said).toContain('--from-portfolio');
    expect(fs.existsSync(f.at('rasen', 'issues', 'cli-issue', 'plans', '0001.yaml'))).toBe(false);
  });

  it('refuses an absent portfolio run-state, naming the parent and the locations searched', async () => {
    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
      '--from-portfolio', 'no-such-parent', '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_plan_portfolio_absent');
    const message: string = json.status[0].message;
    expect(message).toContain('no-such-parent');
    expect(message).toContain(
      path.join(f.at('rasen', 'projects', PROJECT, 'changes', 'no-such-parent'), 'portfolio-run.json')
    );
    expect(message).toContain(
      path.join(ephemeraDir(f.projectRoot(PROJECT), 'no-such-parent'), 'portfolio-run.json')
    );
  });

  it('refuses an unreadable portfolio run-state as invalid, not as absent', async () => {
    const changeDir = f.at('rasen', 'projects', PROJECT, 'changes', PARENT);
    fs.mkdirSync(changeDir, { recursive: true });
    const statePath = path.join(changeDir, 'portfolio-run.json');
    fs.writeFileSync(statePath, 'definitely not: json\n', 'utf8');

    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
      '--from-portfolio', PARENT, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_plan_portfolio_invalid');
    expect(json.status[0].message as string).toContain(statePath);
    expect(fs.existsSync(f.at('rasen', 'issues', 'cli-issue', 'plans', '0001.yaml'))).toBe(false);
  });
});
