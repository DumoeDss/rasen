/**
 * `issue-target-project-binding` — both plan-publication sources through the
 * real dist CLI, against the planning-member gate.
 *
 * `--from-file` and `--from-portfolio` meet the gate through the one shared
 * verifier inside `publishPlan`; this suite proves that inheritance end to
 * end: a hand-authored node targeting a knowledge-only member is refused with
 * the role facts, a portfolio child that resolves into a knowledge-only
 * member's committed Change is refused naming the child, and a portfolio whose
 * children live in two different planning members publishes with each node
 * carrying its own target project.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PLANNING_A = 'elftia';
const PLANNING_B = 'app-b';
const KNOWLEDGE_ONLY = 'docs-side';
const LINE = 'line-0.2';
const PARENT = 'parent-cross-project';

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

function portfolioJson(children: readonly string[]): string {
  return `${JSON.stringify(
    {
      parent: PARENT,
      childPipeline: 'small-feature',
      children: children.map((id, index) => ({
        id,
        pipeline: 'small-feature',
        ...(index === 0 ? {} : { dependsOn: [children[index - 1] as string] }),
        status: 'pending',
      })),
    },
    null,
    2
  )}\n`;
}

describe('rasen store issue plan — the planning-member gate on both sources', () => {
  let f: StoreWorkspaceFixture;
  let runFromProject: (args: readonly string[]) => Promise<RunCLIResult>;
  /** Committed Change instance ids by member project, keyed by child id. */
  let children: ReadonlyMap<string, { readonly project: string; readonly instance: string }>;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-target-cli-',
      projects: [PLANNING_A, PLANNING_B, KNOWLEDGE_ONLY],
      knowledgeOnlyProjects: [KNOWLEDGE_ONLY],
      lines: [
        { id: 'main', storeRef: 'refs/heads/main' },
        { id: LINE, storeRef: 'refs/heads/release/0.2' },
      ],
    });
    const cwd = f.projectRoot(PLANNING_A);
    runFromProject = (args: readonly string[]) => runCLI(args, { cwd, env: f.env });

    // One committed child per member project — two planning members and the
    // knowledge-only one — so a portfolio can span projects or resolve into
    // the knowledge-only member, from real committed evidence.
    const seeded = new Map<
      string,
      { readonly project: string; readonly instance: string }
    >();
    for (const [projectId, changeId, seed] of [
      [PLANNING_A, 'alpha-child', 'a'.repeat(32)],
      [PLANNING_B, 'beta-child', 'b'.repeat(32)],
      [KNOWLEDGE_ONLY, 'gamma-child', 'd'.repeat(32)],
    ] as const) {
      const landed = f.seedChange({
        root: f.storeRoot,
        projectId,
        targetLineId: LINE,
        changeId,
        instanceSeed: seed,
      });
      seeded.set(changeId, { project: projectId, instance: landed.instanceId });
    }
    children = seeded;
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'land children in three members']);

    expectOk(
      await runFromProject([
        'store', 'issue', 'new', 'cli-issue', '--store', f.storeId,
        '--title', 'Cross-project publication', '--json',
      ])
    );
  });

  afterEach(() => {
    f.cleanup();
  });

  function planFile(ordinal: string): string {
    return f.at('rasen', 'issues', 'cli-issue', 'plans', `${ordinal}.yaml`);
  }

  function seedPortfolio(childIds: readonly string[]): string {
    const changeDir = f.at('rasen', 'projects', PLANNING_A, 'changes', PARENT);
    fs.mkdirSync(changeDir, { recursive: true });
    const statePath = path.join(changeDir, 'portfolio-run.json');
    fs.writeFileSync(statePath, portfolioJson(childIds), 'utf8');
    return statePath;
  }

  it('refuses --from-file with a knowledge-only target node, naming the repair', async () => {
    const nodesFile = f.beside('nodes.yaml');
    f.write(
      nodesFile,
      [
        'nodes:',
        '  - nodeId: hand-authored',
        '    kind: intent',
        `    projectId: ${KNOWLEDGE_ONLY}`,
        `    targetLineId: ${LINE}`,
        '    summary: work for the knowledge-only member',
        '    dependsOn: []',
        '',
      ].join('\n')
    );

    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
      '--from-file', nodesFile, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_reference_target_not_planning_member');
    const message: string = json.status[0].message;
    expect(message).toContain('hand-authored');
    expect(message).toContain(KNOWLEDGE_ONLY);
    expect(message).toContain('planning=false');
    expect(json.status[0].fix).toContain('rasen store add-project');
    expect(fs.existsSync(planFile('0001'))).toBe(false);
  });

  it('refuses a portfolio child resolving into the knowledge-only member, naming the child and roles', async () => {
    const statePath = seedPortfolio(['gamma-child']);

    const result = await runFromProject([
      'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
      '--from-portfolio', PARENT, '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result);
    expect(json.status[0].code).toBe('issue_reference_target_not_planning_member');
    const message: string = json.status[0].message;
    // The child is the node: named, with its derived project and that
    // project's recorded roles.
    expect(message).toContain('gamma-child');
    expect(message).toContain(KNOWLEDGE_ONLY);
    expect(message).toContain('planning=false');
    expect(message).toContain('knowledge=true');
    expect(json.status[0].fix).toContain('rasen store add-project');
    // No revision, and the run-state the derivation read is byte-identical.
    expect(fs.existsSync(planFile('0001'))).toBe(false);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(portfolioJson(['gamma-child']));
  });

  it('publishes a portfolio spanning two planning members, each node carrying its own project', async () => {
    seedPortfolio(['alpha-child', 'beta-child']);

    const result = parseJson(
      expectOk(
        await runFromProject([
          'store', 'issue', 'plan', 'cli-issue', '--store', f.storeId,
          '--from-portfolio', PARENT, '--json',
        ])
      )
    );
    expect(result.revision.revisionId).toBe('0001');
    const byNode = new Map<
      string,
      { projectId: string; changeInstanceId: string }
    >(result.revision.nodes.map((node: any) => [node.nodeId, node]));
    expect(byNode.get('alpha-child')).toMatchObject({
      projectId: PLANNING_A,
      changeInstanceId: children.get('alpha-child')?.instance,
    });
    expect(byNode.get('beta-child')).toMatchObject({
      projectId: PLANNING_B,
      changeInstanceId: children.get('beta-child')?.instance,
    });

    // And the per-node project is visible on the read surface the same CLI
    // prints — the projection carries it structurally in --json.
    const shown = parseJson(
      expectOk(
        await runFromProject([
          'store', 'issue', 'show', 'cli-issue', '--store', f.storeId, '--json',
        ])
      )
    );
    const shownProjects = shown.status.nodes.map((node: any) => node.projectId).sort();
    expect(shownProjects).toEqual([PLANNING_A, PLANNING_B].sort());
  });
});
