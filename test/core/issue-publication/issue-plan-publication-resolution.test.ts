/**
 * `issue-plan-publication` tasks 1.2–1.4 — the pure compile and the
 * child-name resolution, against real-Git fixtures.
 *
 * The resolution cases are the six the spec's second requirement names:
 * resolved (happy), missing, worktree-only, ambiguous across projects, foreign
 * Store, and an unsearched ref reported rather than concluded as absence.
 * Every store is `createStoreWorkspaceFixture` and every expected path is
 * built with `path.join`, never a hardcoded separator.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import { parsePortfolioState } from '../../../src/core/pipeline-registry/portfolio-state.js';
import {
  compilePortfolioChildren,
  planNodeForChild,
} from '../../../src/core/issue-publication/compiler.js';
import {
  gatherChildEvidence,
  resolveChildByName,
  childNameRefusal,
} from '../../../src/core/issue-publication/resolution.js';
import { publishPlanFromPortfolio } from '../../../src/core/issue-publication/orchestration.js';
import {
  productionStoreIssueDependencies,
  StoreIssueError,
  StoreIssuesModule,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorktreeInstanceId,
} from '../../../src/core/store/planning-identity.js';
import type { WorkspaceIndexEntry } from '../../../src/core/store/workspace/registry.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE = 'line-0.2';

/** A minimal portfolio state as the strict reader returns it. */
function portfolioOf(
  parent: string,
  children: readonly { id: string; dependsOn?: readonly string[] }[]
): ReturnType<typeof parsePortfolioState> {
  return parsePortfolioState(
    JSON.stringify({
      parent,
      children: children.map(child => ({
        id: child.id,
        pipeline: 'small-feature',
        ...(child.dependsOn === undefined ? {} : { dependsOn: [...child.dependsOn] }),
        status: 'pending',
      })),
    })
  );
}

describe('compilePortfolioChildren (pure)', () => {
  it('carries every child id and edge verbatim, and nothing else', () => {
    const state = portfolioOf('parent-x', [
      { id: 'alpha' },
      { id: 'beta', dependsOn: ['alpha'] },
      { id: 'gamma', dependsOn: ['alpha', 'beta'] },
    ]);
    expect(compilePortfolioChildren(state)).toEqual([
      { childId: 'alpha', dependsOn: [] },
      { childId: 'beta', dependsOn: ['alpha'] },
      { childId: 'gamma', dependsOn: ['alpha', 'beta'] },
    ]);
  });

  it('compiles no status, pipeline, cohort, mode, or delivery fact into a node', () => {
    const state = parsePortfolioState(
      JSON.stringify({
        parent: 'parent-x',
        childPipeline: 'small-feature',
        tier: 'A',
        delivery: { status: 'pending' },
        children: [
          { id: 'alpha', pipeline: 'bug-fix', status: 'in_progress', cohort: 'q3', mode: 'serial' },
        ],
      })
    );
    const [child] = compilePortfolioChildren(state);
    const node = planNodeForChild(child as never, {
      changeInstanceId: 'ci_' + 'ab'.repeat(32),
      projectId: 'app-a',
      targetLineId: LINE,
    });
    // The node names exactly the seven fields a change node declares; every
    // run-state lifecycle fact (status/pipeline/cohort/mode) and every
    // parent-level fact (childPipeline/tier/delivery) is absent.
    expect(Object.keys(node).sort()).toEqual(
      ['changeAlias', 'changeInstanceId', 'dependsOn', 'kind', 'nodeId', 'projectId', 'targetLineId'].sort()
    );
    expect(node.changeAlias).toBe('alpha');
    expect(node.nodeId).toBe('alpha');
  });
});

describe('resolveChildByName (real-Git evidence)', () => {
  let f: StoreWorkspaceFixture;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-plan-pub-res-',
      projects: ['elftia', 'morbidia'],
      storeBranches: ['release/0.2'],
      lines: [
        // `main` is where fixture commits land, so its catalog names it; the
        // release line exercises a second searched ref.
        { id: 'main', storeRef: 'refs/heads/main' },
        { id: LINE, storeRef: 'refs/heads/release/0.2' },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  async function evidenceFor() {
    const snapshot = await gatherChildEvidence(productionStoreIssueDependencies, {
      store: f.storeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
    });
    return snapshot;
  }

  it('resolves a committed child name to its committed instance, project, and line', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: 'add-gauntlet-loop',
    });
    commitStore('land child on release/0.2');

    const { evidence } = await evidenceFor();
    const resolution = resolveChildByName(evidence, 'add-gauntlet-loop');
    expect(resolution).toEqual({
      status: 'resolved',
      identity: {
        changeInstanceId: seeded.instanceId,
        projectId: 'elftia',
        targetLineId: LINE,
      },
    });
  });

  it('resolves an ARCHIVED committed child — re-publication after completion still resolves', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: 'add-task-loop-pipeline',
    });
    // Archive it: move the directory under the archive partition with the
    // published entry name the flat archive shape writes,
    // `YYYY-MM-DD-<change>`.
    const active = path.join('rasen', 'projects', 'elftia', 'changes', 'add-task-loop-pipeline');
    const archived = path.join(
      'rasen',
      'projects',
      'elftia',
      'changes',
      'archive',
      LINE,
      '2026-08-07-add-task-loop-pipeline'
    );
    fs.mkdirSync(path.dirname(f.at(archived)), { recursive: true });
    fs.renameSync(f.at(active), f.at(archived));
    commitStore('archive the completed child');

    const { evidence } = await evidenceFor();
    expect(resolveChildByName(evidence, 'add-task-loop-pipeline')).toEqual({
      status: 'resolved',
      identity: {
        changeInstanceId: seeded.instanceId,
        projectId: 'elftia',
        targetLineId: LINE,
      },
    });
  });

  it('resolves the Store v2 instance-suffixed archive entry shape too', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: 'add-gauntlet-loop',
      instanceSeed: '7'.repeat(32),
    });
    const active = path.join('rasen', 'projects', 'elftia', 'changes', 'add-gauntlet-loop');
    const archived = path.join(
      'rasen',
      'projects',
      'elftia',
      'changes',
      'archive',
      LINE,
      // The Store v2 finalization shape: `YYYY-MM-DD-<change>--<instanceShort>`.
      `2026-08-09-add-gauntlet-loop--${seeded.instanceId.slice(-8)}`
    );
    fs.mkdirSync(path.dirname(f.at(archived)), { recursive: true });
    fs.renameSync(f.at(active), f.at(archived));
    commitStore('archive with instance suffix');

    const { evidence } = await evidenceFor();
    expect(resolveChildByName(evidence, 'add-gauntlet-loop')).toMatchObject({
      status: 'resolved',
      identity: { changeInstanceId: seeded.instanceId },
    });
  });

  it('does not let an active change merely NAMED like a date-prefixed archive entry claim a name', async () => {
    f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: '2026-08-07-unrelated-work',
    });
    commitStore('a change whose own name looks date-prefixed');

    const { evidence } = await evidenceFor();
    // The directory is an ACTIVE change named `2026-08-07-unrelated-work`; it
    // is evidence for exactly that name and for nothing shorter.
    expect(resolveChildByName(evidence, 'unrelated-work').status).toBe('unresolved');
    expect(resolveChildByName(evidence, '2026-08-07-unrelated-work').status).toBe('resolved');
  });

  it('refuses a child naming no committed Change, naming the child and the search', async () => {
    const { evidence, reader } = await evidenceFor();
    const resolution = resolveChildByName(evidence, 'never-committed');
    expect(resolution.status).toBe('unresolved');
    const refusal = childNameRefusal('never-committed', resolution as never, reader);
    expect(refusal).toBeInstanceOf(StoreIssueError);
    expect(refusal?.issueCode).toBe('issue_reference_unresolved');
    expect(refusal?.message).toContain('never-committed');
    expect(refusal?.message).toContain('refs/heads/release/0.2');
  });

  it('refuses a child that exists only in a local planning worktree, naming the locator', async () => {
    const childId = 'local-only-child';
    const planningRoot = f.beside(`planning-${childId}`);
    const seeded = f.seedChange({
      root: planningRoot,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: childId,
    });
    const planningScopeId = f.planningScopeId('elftia', LINE);
    const entry: WorkspaceIndexEntry = {
      version: 1,
      planningScopeId,
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: childId,
      changeInstanceId: seeded.instanceId,
      planning: {
        root: planningRoot,
        repositoryIdentity: 'store-repo',
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'store-repo',
          worktreeIdentity: `planning-${childId}`,
        }),
        ref: `refs/heads/change/${childId}`,
        headOid: 'a'.repeat(40),
      },
      execution: {
        root: f.beside(`execution-${childId}`),
        repositoryIdentity: 'code-repo',
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'code-repo',
          worktreeIdentity: `execution-${childId}`,
        }),
        ref: `refs/heads/change/${childId}`,
        headOid: 'b'.repeat(40),
      },
      planId: `plan-${childId}`,
      phase: 'prepared',
      recordedAt: NOW,
      updatedAt: NOW,
    };
    const indexPath = path.join(
      f.globalDataDir,
      'planning-workspaces',
      'index',
      `${planningScopeId}.json`
    );
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(
      indexPath,
      `${JSON.stringify({ version: 1, planningScopeId, entries: [entry] }, null, 2)}\n`,
      'utf8'
    );

    const { evidence, reader } = await evidenceFor();
    const resolution = resolveChildByName(evidence, childId);
    expect(resolution.status).toBe('uncommitted');
    const refusal = childNameRefusal(childId, resolution as never, reader);
    expect(refusal?.issueCode).toBe('issue_reference_uncommitted');
    expect(refusal?.message).toContain(childId);
    // The machine-local locator, so the operator can see WHAT was found.
    expect(refusal?.message).toContain(planningRoot);
  });

  it('refuses one child name claimed by two committed Changes, listing every claimant with project and line', async () => {
    f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: 'shared-name',
    });
    f.seedChange({
      root: f.storeRoot,
      projectId: 'morbidia',
      targetLineId: LINE,
      changeId: 'shared-name',
      instanceSeed: 'b'.repeat(32),
    });
    commitStore('two projects claim one name');

    const { evidence, reader } = await evidenceFor();
    const resolution = resolveChildByName(evidence, 'shared-name');
    expect(resolution.status).toBe('ambiguous');
    if (resolution.status !== 'ambiguous') return;
    expect(resolution.claimants).toHaveLength(2);
    const refusal = childNameRefusal('shared-name', resolution, reader);
    expect(refusal?.issueCode).toBe('issue_reference_ambiguous');
    expect(refusal?.message).toContain('elftia');
    expect(refusal?.message).toContain('morbidia');
    expect(refusal?.message).toContain(LINE);
    expect(refusal?.message).toContain('2 claimants');
  });

  it('refuses a committed identity that belongs to another Store', async () => {
    const foreignUid = '11111111-2222-4333-8444-555555555555';
    // The instance id must derive from the FOREIGN scope (its planningScopeId
    // embeds the foreign storeUid) or the committed metadata does not validate
    // and the entry is invisible to the evidence reader.
    const foreignScopeId = derivePlanningScopeId({
      storeUid: foreignUid,
      projectId: 'elftia',
      targetLineId: LINE,
    });
    const foreignInstanceId = deriveChangeInstanceId({
      planningScopeId: foreignScopeId,
      instanceSeed: 'c'.repeat(32),
    });
    const directory = f.at('rasen', 'projects', 'elftia', 'changes', 'adopted-child');
    fs.mkdirSync(directory, { recursive: true });
    f.write(
      path.join(directory, '.openspec.yaml'),
      [
        'schema: spec-driven',
        'identity:',
        '  version: 2',
        `  instanceSeed: ${JSON.stringify('c'.repeat(32))}`,
        `  instanceId: ${JSON.stringify(foreignInstanceId)}`,
        `  storeUid: ${JSON.stringify(foreignUid)}`,
        '  projectId: "elftia"',
        `  targetLineId: ${JSON.stringify(LINE)}`,
        '',
      ].join('\n')
    );
    commitStore('a foreign store change landed on this store ref');

    const { evidence, reader } = await evidenceFor();
    const resolution = resolveChildByName(evidence, 'adopted-child');
    expect(resolution.status).toBe('foreign-store');
    const refusal = childNameRefusal('adopted-child', resolution as never, reader);
    expect(refusal?.issueCode).toBe('issue_reference_foreign_store');
    expect(refusal?.message).toContain(foreignUid);
  });

  it('reports an unsearchable Store ref rather than concluding the child absent', async () => {
    // A committed target-line catalog naming a ref this checkout cannot
    // resolve: the ref is listed by the reader as unsearched.
    f.writeTargetLine({ id: 'broken-line', storeRef: 'refs/heads/does-not-exist' });
    commitStore('a target line whose ref does not resolve');

    const { evidence, reader } = await evidenceFor();
    expect(reader.complete).toBe(false);
    const resolution = resolveChildByName(evidence, 'child-behind-broken-ref');
    expect(resolution.status).toBe('unresolved');
    const refusal = childNameRefusal('child-behind-broken-ref', resolution as never, reader);
    expect(refusal?.issueCode).toBe('store_query_ref_unreadable');
    expect(refusal?.message).toContain('refs/heads/does-not-exist');
    // No child was reported missing on the strength of the unreadable ref.
    expect(refusal?.message).not.toContain('issue_reference_unresolved');
  });

  it('pins the M-1 layer divergence: active+archived copies of ONE instance resolve by name, then the under-lock instance verification refuses', async () => {
    // A fork/migration anomaly: the Store carries the SAME Change instance
    // both active (`shared-fate`) and archived (`2026-08-07-shared-fate`).
    // The normal archive flow removes the active copy, so this state is not
    // the dogfood path — but when it exists, the two layers answer
    // differently, and the COMBINED outcome must stay the fail-safe one.
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE,
      changeId: 'shared-fate',
    });
    // COPY, not rename: the active copy stays beside the archived one.
    const active = path.join('rasen', 'projects', 'elftia', 'changes', 'shared-fate');
    const archived = path.join(
      'rasen',
      'projects',
      'elftia',
      'changes',
      'archive',
      LINE,
      '2026-08-07-shared-fate'
    );
    fs.mkdirSync(path.dirname(f.at(archived)), { recursive: true });
    fs.cpSync(f.at(active), f.at(archived), { recursive: true });
    commitStore('one instance, both active and archived');

    // Layer 1 — the name layer (this channel's resolution): the two entries
    // share one identity triple (instance/project/line), so the child name
    // resolves, preferring the active copy. This is CORRECT at its layer: the
    // name genuinely names one Change.
    const { evidence } = await evidenceFor();
    const byName = resolveChildByName(evidence, 'shared-fate');
    expect(byName).toEqual({
      status: 'resolved',
      identity: {
        changeInstanceId: seeded.instanceId,
        projectId: 'elftia',
        targetLineId: LINE,
      },
    });

    // Layer 2 — the mutation's under-lock instance verification
    // (`resolveChangeReference`): `collectCommittedChanges` dedups on identity
    // PLUS changeId, so the pair is TWO committed entries for one instance id
    // and the publication refuses as ambiguous, listing both copies. The
    // refusal is the fail-safe outcome this test PINS: never make it "work" —
    // a revision naming an instance the Store itself cannot count must not
    // publish, exactly as the manual --from-file path already refuses on the
    // same store state.
    const issues = new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
    await issues.create({
      store: f.storeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      issueId: 'm1-pin',
      title: 'active+archived pin',
    });
    const parent = 'm1-parent';
    const changeDir = f.at('rasen', 'projects', 'elftia', 'changes', parent);
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(
      path.join(changeDir, 'portfolio-run.json'),
      `${JSON.stringify(
        {
          parent,
          children: [{ id: 'shared-fate', pipeline: 'small-feature', status: 'pending' }],
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    let thrown: unknown;
    try {
      await publishPlanFromPortfolio(
        {
          issueId: 'm1-pin',
          parent,
          store: f.storeId,
          startPath: f.projectRoot('elftia'),
          globalDataDir: f.globalDataDir,
        },
        { issues }
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreIssueError);
    const refusal = thrown as StoreIssueError;
    expect(refusal.issueCode).toBe('issue_reference_ambiguous');
    // Both copies are named — the active directory and the archived entry.
    expect(refusal.message).toContain('shared-fate at refs/heads/main');
    expect(refusal.message).toContain('2026-08-07-shared-fate at refs/heads/main');
    // And the refusal held: no revision exists.
    expect(
      fs.existsSync(f.at('rasen', 'issues', 'm1-pin', 'plans', '0001.yaml'))
    ).toBe(false);
  });
});
