/**
 * `issue-plan-publication` task 2.3 — the publication orchestration end to
 * end: locate through the resume seam, strict-read, refuse each named way a
 * portfolio cannot become a revision, and publish through `publishPlan`.
 *
 * The working directory for every publication is the fixture's MEMBER PROJECT
 * root, because that is what makes the resume seam resolve the way a real
 * store-bound project does: the planning root's `changesDir` points into the
 * Store's project partition, and the execution root's ephemera directory
 * lives in the project checkout. Every expected path is `path.join`-built.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import { publishPlanFromPortfolio } from '../../../src/core/issue-publication/orchestration.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import { StoreError } from '../../../src/core/store/errors.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';

const NOW = '2026-08-20T00:00:00.000Z';
const PROJECT = 'elftia';
const LINE = 'line-0.2';
const PARENT = 'multi-child-parent';

function portfolioJson(
  parent: string,
  children: readonly { id: string; dependsOn?: readonly string[]; status?: string }[]
): string {
  return `${JSON.stringify(
    {
      parent,
      childPipeline: 'small-feature',
      children: children.map(child => ({
        id: child.id,
        pipeline: 'small-feature',
        ...(child.dependsOn === undefined ? {} : { dependsOn: [...child.dependsOn] }),
        status: child.status ?? 'pending',
      })),
      delivery: { status: 'pending' },
    },
    null,
    2
  )}\n`;
}

describe('publishPlanFromPortfolio (orchestration)', () => {
  let f: StoreWorkspaceFixture;
  let changeDir: string;
  let ephemera: string;
  let issueUids: Map<string, string>;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-plan-pub-orch-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      lines: [
        { id: 'main', storeRef: 'refs/heads/main' },
        { id: LINE, storeRef: 'refs/heads/release/0.2' },
      ],
    });
    changeDir = f.at('rasen', 'projects', PROJECT, 'changes', PARENT);
    ephemera = ephemeraDir(f.projectRoot(PROJECT), PARENT);
    issueUids = new Map();
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  async function createIssue(issueId: string): Promise<void> {
    const created = await issues().create({
      store: f.storeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      issueId,
      title: 'orchestration test',
    });
    issueUids.set(issueId, created.identity.uid);
  }

  const issueAt = (issueSelector: string, ...segments: string[]): string =>
    f.at('rasen', 'issues', issueUids.get(issueSelector)!, ...segments);

  async function publish(
    issueId: string,
    parent: string = PARENT
  ): Promise<ReturnType<typeof publishPlanFromPortfolio>> {
    return publishPlanFromPortfolio(
      {
        issueId,
        parent,
        store: f.storeId,
        startPath: f.projectRoot(PROJECT),
        globalDataDir: f.globalDataDir,
      },
      { issues: issues() }
    );
  }

  /** Seeds and COMMITS the two children the happy-path portfolios name. */
  function seedCommittedChildren(): void {
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'alpha-child',
    });
    f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'beta-child',
      instanceSeed: 'b'.repeat(32),
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'land both children']);
  }

  async function refusalCode(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
    let thrown: unknown;
    try {
      await run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreError);
    const error = thrown as StoreError;
    return { code: error.diagnostic.code, message: error.message };
  }

  it('refuses when the working directory resolves no planning root', async () => {
    await createIssue('rootless');
    const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-no-root-'));
    let thrown: unknown;
    try {
      await publishPlanFromPortfolio(
        {
          issueId: 'rootless',
          parent: PARENT,
          store: f.storeId,
          startPath: nowhere,
          globalDataDir: f.globalDataDir,
        },
        { issues: issues() }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreError);
    const refusal = thrown as StoreError;
    expect(refusal.diagnostic.code).toBe('issue_plan_portfolio_root_unresolvable');
    expect(refusal.message).toContain(PARENT);
    expect(refusal.message).toContain('resume');
  });

  it('refuses an absent run-state, listing every location searched', async () => {
    await createIssue('absent-portfolio');
    const refusal = await refusalCode(() => publish('absent-portfolio'));
    expect(refusal.code).toBe('issue_plan_portfolio_absent');
    expect(refusal.message).toContain(PARENT);
    // Every searched location, built with path.join: the execution root's
    // ephemera candidate first, then the change directory.
    expect(refusal.message).toContain(
      path.join(ephemera, 'portfolio-run.json')
    );
    expect(refusal.message).toContain(
      path.join(changeDir, 'portfolio-run.json')
    );
    expect(fs.existsSync(issueAt('absent-portfolio', 'plans', '0001.yaml'))).toBe(false);
  });

  it('refuses an unreadable run-state as invalid, never as absent', async () => {
    await createIssue('invalid-portfolio');
    f.write(path.join(changeDir, 'portfolio-run.json'), '{not json');
    const refusal = await refusalCode(() => publish('invalid-portfolio'));
    expect(refusal.code).toBe('issue_plan_portfolio_invalid');
    expect(refusal.message).toContain(path.join(changeDir, 'portfolio-run.json'));
    expect(refusal.message).toContain('does not read back');
    // The refusal does not present the portfolio as missing.
    expect(refusal.code).not.toBe('issue_plan_portfolio_absent');
    expect(fs.existsSync(issueAt('invalid-portfolio', 'plans', '0001.yaml'))).toBe(false);
  });

  it('refuses a record whose own parent disagrees with the requested parent', async () => {
    await createIssue('mismatched-portfolio');
    f.write(path.join(changeDir, 'portfolio-run.json'), portfolioJson('someone-else', [
      { id: 'alpha-child' },
    ]));
    const refusal = await refusalCode(() => publish('mismatched-portfolio'));
    expect(refusal.code).toBe('issue_plan_portfolio_parent_mismatch');
    expect(refusal.message).toContain(PARENT);
    expect(refusal.message).toContain('someone-else');
    expect(fs.existsSync(issueAt('mismatched-portfolio', 'plans', '0001.yaml'))).toBe(false);
  });

  it('refuses a portfolio with no children — no empty revision is created', async () => {
    await createIssue('empty-portfolio');
    f.write(path.join(changeDir, 'portfolio-run.json'), portfolioJson(PARENT, []));
    const refusal = await refusalCode(() => publish('empty-portfolio'));
    expect(refusal.code).toBe('issue_plan_portfolio_children_empty');
    expect(fs.existsSync(issueAt('empty-portfolio', 'plans', '0001.yaml'))).toBe(false);
  });

  it('locates the ephemera placement without any change directory existing', async () => {
    await createIssue('ephemera-only');
    seedCommittedChildren();
    fs.mkdirSync(ephemera, { recursive: true });
    const statePath = path.join(ephemera, 'portfolio-run.json');
    fs.writeFileSync(statePath, portfolioJson(PARENT, [
      { id: 'alpha-child' },
      { id: 'beta-child', dependsOn: ['alpha-child'] },
    ]), 'utf8');

    const result = await publish('ephemera-only');
    expect(result.revision.revisionId).toBe('0001');
    expect(result.source).toEqual({
      kind: 'portfolio',
      parent: PARENT,
      statePath,
      childCount: 2,
    });
  });

  it('prefers the ephemera record over a stale change-directory copy, like resume', async () => {
    await createIssue('precedence');
    seedCommittedChildren();
    // A stale one-child copy at the change directory...
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(
      path.join(changeDir, 'portfolio-run.json'),
      portfolioJson(PARENT, [{ id: 'alpha-child' }]),
      'utf8'
    );
    // ...and the live two-child record at the execution root's ephemera.
    fs.mkdirSync(ephemera, { recursive: true });
    const ephemeraState = path.join(ephemera, 'portfolio-run.json');
    fs.writeFileSync(ephemeraState, portfolioJson(PARENT, [
      { id: 'alpha-child' },
      { id: 'beta-child', dependsOn: ['alpha-child'] },
    ]), 'utf8');

    const result = await publish('precedence');
    expect(result.source.childCount).toBe(2);
    expect(result.source.statePath).toBe(ephemeraState);
    expect(result.revision.nodes).toHaveLength(2);
  });

  it('publishes revision 0001, leaves the run-state byte-identical, and stages nothing', async () => {
    await createIssue('happy');
    seedCommittedChildren();
    fs.mkdirSync(changeDir, { recursive: true });
    const statePath = path.join(changeDir, 'portfolio-run.json');
    const stateBytes = Buffer.from(
      portfolioJson(PARENT, [
        { id: 'alpha-child' },
        { id: 'beta-child', dependsOn: ['alpha-child'] },
      ]),
      'utf8'
    );
    fs.writeFileSync(statePath, stateBytes);

    const result = await publish('happy');

    expect(result.revision.revisionId).toBe('0001');
    expect(result.revision.supersedes).toBeNull();
    const nodes = [...result.revision.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    expect(nodes.map(node => node.kind)).toEqual(['change', 'change']);
    expect(nodes.map(node => node.kind === 'change' ? node.changeAlias : null)).toEqual([
      'alpha-child',
      'beta-child',
    ]);
    expect(nodes[1]?.dependsOn).toEqual(['alpha-child']);
    expect(result.source.childCount).toBe(2);
    expect(fs.existsSync(issueAt('happy', 'plans', '0001.yaml'))).toBe(true);

    // The run-state was read, never written: identical bytes.
    expect(fs.readFileSync(statePath)).toEqual(stateBytes);

    // Nothing staged: the Store's index has no add/modify entries — only
    // untracked content the write produced.
    const status = f.git(f.storeRoot, ['status', '--porcelain']);
    for (const line of status.split(/\r?\n/).filter(Boolean)) {
      expect(line.startsWith('??')).toBe(true);
    }
  });

  it('re-publishes after a child transition as revision 0002, with 0001 bytes unchanged', async () => {
    await createIssue('republish');
    seedCommittedChildren();
    fs.mkdirSync(changeDir, { recursive: true });
    const statePath = path.join(changeDir, 'portfolio-run.json');
    fs.writeFileSync(statePath, portfolioJson(PARENT, [
      { id: 'alpha-child' },
      { id: 'beta-child', dependsOn: ['alpha-child'] },
    ]), 'utf8');

    const first = await publish('republish');
    expect(first.revision.revisionId).toBe('0001');
    const firstBytes = fs.readFileSync(
      issueAt('republish', 'plans', '0001.yaml')
    );
    const firstStateBytes = fs.readFileSync(statePath);

    // The child completes; the run-state is the pipeline's own record of it.
    fs.writeFileSync(statePath, portfolioJson(PARENT, [
      { id: 'alpha-child', status: 'done' },
      { id: 'beta-child', dependsOn: ['alpha-child'] },
    ]), 'utf8');

    const second = await publish('republish');
    expect(second.revision.revisionId).toBe('0002');
    expect(second.revision.supersedes).toBe('0001');
    expect(fs.existsSync(issueAt('republish', 'plans', '0002.yaml'))).toBe(true);
    // The earlier revision's bytes are unchanged.
    expect(
      fs.readFileSync(issueAt('republish', 'plans', '0001.yaml'))
    ).toEqual(firstBytes);
    // And the run-state bytes changed ONLY by the transition the pipeline
    // itself wrote — publication did not touch them between reads.
    expect(fs.readFileSync(statePath)).not.toEqual(firstStateBytes);
  });
});
