/**
 * `issue-autodecompose-graph` task 2.2 — the `rasen store issue plan
 * --from-decomposition` CLI surface, through the real dist CLI.
 *
 * The three-way source rule (any two together, none), the decomposition
 * source facts in both forms, the byte-identical document, and the
 * commit-suggestion/no-staging contract.
 */
import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PROJECT = 'elftia';
const LINE = 'line-0.2';

function decompositionYaml(): string {
  return `nodes:
  - nodeId: cli-surface
    kind: intent
    projectId: ${PROJECT}
    targetLineId: ${LINE}
    summary: Author the CLI surface
    dependsOn: []
    suggestedPipeline: small-feature
    rationale: the surface must exist first
  - nodeId: cli-consumer
    kind: intent
    projectId: ${PROJECT}
    targetLineId: ${LINE}
    summary: Consume the surface
    dependsOn: [cli-surface]
    suggestedPipeline: small-feature
    uncertainty: unsure whether one node suffices
`;
}

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

describe('rasen store issue plan --from-decomposition (CLI)', () => {
  let f: StoreWorkspaceFixture;
  let runFromProject: (args: readonly string[]) => Promise<RunCLIResult>;
  let documentPath: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-plan-decomp-cli-',
      projects: [PROJECT],
      lines: [
        { id: 'main', storeRef: 'refs/heads/main' },
        { id: LINE, storeRef: 'refs/heads/release/0.2' },
      ],
    });
    const cwd = f.projectRoot(PROJECT);
    runFromProject = (args: readonly string[]) => runCLI(args, { cwd, env: f.env });
    documentPath = f.beside('decomposition.yaml');
    f.write(documentPath, decompositionYaml());

    expectOk(
      await runFromProject([
        'store', 'issue', 'new', 'cli-issue', '--store', f.storeId,
        '--title', 'CLI decomposition publication', '--json',
      ])
    );
  });

  afterEach(() => {
    f.cleanup();
  });

  it('publishes from the decomposition in --json form, carrying the source facts', async () => {
    const before = fs.readFileSync(documentPath, 'utf8');
    const result = parseJson(
      expectOk(
        await runFromProject([
          'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
          '--from-decomposition', documentPath, '--json',
        ])
      )
    );
    expect(result.revision.revisionId).toBe('0001');
    expect(result.revision.nodes).toHaveLength(2);
    expect(result.revision.nodes[0]).toMatchObject({
      kind: 'intent',
      suggestedPipeline: 'small-feature',
    });
    expect(result.source).toEqual({
      kind: 'decomposition',
      documentPath,
      nodeCount: 2,
    });
    expect(result.suggestedCommits).toHaveLength(1);
    expect(fs.existsSync(f.at('rasen', 'issues', 'cli-issue', 'plans', '0001.yaml'))).toBe(true);
    // The document is read-only input: byte-identical after publication.
    expect(fs.readFileSync(documentPath, 'utf8')).toBe(before);
  });

  it('carries the source facts in the human form too, beside the commit suggestion', async () => {
    const human = expectOk(
      await runFromProject([
        'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
        '--from-decomposition', documentPath,
      ])
    );
    expect(human.stdout).toContain('Execution Plan revision 0001');
    expect(human.stdout).toContain('decomposition');
    expect(human.stdout).toContain(documentPath);
    expect(human.stdout).toContain('2 intent nodes');
    expect(human.stdout).toMatch(/git\s.*add/);
    expect(human.stdout).toMatch(/git\s.*commit/);
    // And the Store's Git index is untouched: nothing staged.
    const status = f.git(f.storeRoot, ['status', '--porcelain']);
    for (const line of status.split(/\r?\n/).filter(Boolean)) {
      expect(line.startsWith('??')).toBe(true);
    }
  });

  it('refuses a decomposition beside another source, naming both and not reading the document', async () => {
    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
      '--from-file', documentPath, '--from-decomposition', documentPath, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_plan_source_conflict');
    const said = `${result.stdout}${result.stderr}`;
    expect(said).toContain('--from-file');
    expect(said).toContain('--from-decomposition');
    // The refusal names the third source too, and nothing was published.
    expect(said).toContain('--from-portfolio');
    expect(fs.existsSync(f.at('rasen', 'issues', 'cli-issue', 'plans', '0001.yaml'))).toBe(false);
  });

  it('refuses no source, naming the three the publication accepts', async () => {
    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_plan_source_required');
    const said = `${result.stdout}${result.stderr}`;
    expect(said).toContain('--from-file');
    expect(said).toContain('--from-portfolio');
    expect(said).toContain('--from-decomposition');
  });

  it('refuses an unreadable document as unreadable, never as absent', async () => {
    const missing = f.beside('vanished-decomposition.yaml');
    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
      '--from-decomposition', missing, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_plan_decomposition_unreadable');
    expect(json.status[0].message as string).toContain(missing);
  });

  it('shows the published decomposition reviewable node by node, in both forms', async () => {
    expectOk(
      await runFromProject([
        'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
        '--from-decomposition', documentPath, '--json',
      ])
    );

    const human = expectOk(
      await runFromProject([
        'store', 'issue', 'show', 'cli-issue', '--store', f.storeId,
      ])
    );
    // Each intent node's line carries the recorded suggestion and its
    // rationale/uncertainty, and an all-intent revision keeps the Issue in
    // the planning phase — the review-ready signal.
    expect(human.stdout).toContain('phase: planning');
    expect(human.stdout).toContain('(suggest: small-feature)');
    expect(human.stdout).toContain('rationale: the surface must exist first');
    expect(human.stdout).toContain('uncertainty: unsure whether one node suffices');

    const json = parseJson(
      expectOk(
        await runFromProject([
          'store', 'issue', 'show', 'cli-issue', '--store', f.storeId, '--json',
        ])
      )
    );
    expect(json.status.phase).toBe('planning');
    const surface = json.status.nodes.find(
      (node: { nodeId: string }) => node.nodeId === 'cli-surface'
    );
    expect(surface).toMatchObject({
      kind: 'intent',
      suggestedPipeline: 'small-feature',
      rationale: 'the surface must exist first',
      uncertainty: null,
    });
    const consumer = json.status.nodes.find(
      (node: { nodeId: string }) => node.nodeId === 'cli-consumer'
    );
    expect(consumer).toMatchObject({
      suggestedPipeline: 'small-feature',
      uncertainty: 'unsure whether one node suffices',
    });
  });
});
