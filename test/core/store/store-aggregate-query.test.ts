/**
 * `store-scoped-issues-management` sections 3, 5, and 6, over a REAL Store with
 * three projects on two target lines and real Git objects.
 *
 * The module reads committed content as blobs, so everything asserted here goes
 * through `git show` against real refs rather than a stub — which is the only
 * way the "an unreadable ref is not absence" and "one Change reachable from two
 * refs is one Change" claims mean anything.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import { StoreIssuesModule } from '../../../src/core/store/issues/index.js';
import {
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import { serializeArchiveV2 } from '../../../src/core/store/finalization-v2.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
} from '../../../src/core/store/planning-identity.js';
import { StoreIssueError } from '../../../src/core/store/issues/index.js';

const NOW = '2026-08-07T00:00:00.000Z';
const LINE_MAIN = 'main';
const LINE_02 = 'line-0.2';
const PROJECTS = ['elftia', 'rocut', 'elftia-website'] as const;

function issues(fixture: StoreWorkspaceFixture): StoreIssuesModule {
  return new StoreIssuesModule({
    dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
  });
}

function query(): StoreQueryModuleImpl {
  return new StoreQueryModuleImpl();
}

describe('the Store aggregate query', () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-aggregate-',
      projects: [...PROJECTS],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_MAIN,
          storeRef: 'refs/heads/main',
          codeRefs: {
            elftia: 'refs/heads/main',
            rocut: 'refs/heads/main',
            'elftia-website': 'refs/heads/main',
          },
        },
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { elftia: 'refs/heads/release/0.2' },
        },
      ],
    });
    scope = {
      store: f.storeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
    };
  });

  afterEach(() => {
    f.cleanup();
  });

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  /** Seeds a Change into the integration checkout and commits it on `main`. */
  function seedAndCommit(
    projectId: string,
    targetLineId: string,
    changeId: string,
    instanceSeed?: string
  ): string {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId,
      targetLineId,
      changeId,
      ...(instanceSeed === undefined ? {} : { instanceSeed }),
    });
    commitStore(`seed ${projectId}/${changeId}`);
    return seeded.instanceId;
  }

  it('groups Changes by project and target line and never merges a shared alias', async () => {
    seedAndCommit('elftia', LINE_02, 'refresh-cache', 'a1'.repeat(16));
    seedAndCommit('rocut', LINE_MAIN, 'refresh-cache', 'b2'.repeat(16));

    const result = await query().listChanges(scope);

    expect(result.complete).toBe(true);
    // The groups that HOLD the alias, as an exact set. Exact rather than a
    // subset check, because the claim under test is that the shared alias is
    // never merged: one group holding both copies, a group keyed on anything
    // other than the two committed identities, or a third holder appearing
    // from nowhere each fail here. The declared-but-empty groups the same
    // result also carries are a different claim, asserted in the empty-group
    // test below, and are excluded here by holding no entries — never by
    // relaxing this assertion to `toContain`.
    const holders = result.groups.filter(
      group => group.active.length + group.archived.length > 0
    );
    const keys = holders.map(group => `${group.projectId}/${group.targetLineId}`).sort();
    expect(keys).toEqual(['elftia/line-0.2', 'rocut/main']);
    for (const group of holders) {
      expect(group.active.map(entry => entry.changeId)).toEqual(['refresh-cache']);
      // The two entries are distinguishable by their group key and their
      // instance, not by a path.
      expect(group.active[0]?.projectId).toBe(group.projectId);
      expect(group.active[0]?.targetLineId).toBe(group.targetLineId);
    }
    const instances = result.groups.flatMap(group =>
      group.active.map(entry => entry.changeInstanceId)
    );
    expect(new Set(instances).size).toBe(2);
  });

  it('reports a declared project and target line that hold no Changes as present and empty', async () => {
    // One Change, in ONE of the four declared (project, target line) pairs.
    seedAndCommit('elftia', LINE_02, 'only-change', 'a1'.repeat(16));

    const result = await query().listChanges(scope);

    // The whole DECLARED matrix, exactly: `main` declares all three projects,
    // `line-0.2` declares only `elftia`. Exact equality in both directions —
    // an omitted empty pair fails it, and so does an invented pair (a project
    // the line does not declare, or a line the Store does not have).
    expect(result.groups.map(group => `${group.projectId}/${group.targetLineId}`).sort()).toEqual([
      'elftia-website/main',
      'elftia/line-0.2',
      'elftia/main',
      'rocut/main',
    ]);

    // A declared project holding no Changes anywhere: present, and empty.
    const emptyProject = result.groups.find(group => group.projectId === 'elftia-website');
    expect(emptyProject).toBeDefined();
    expect(emptyProject?.active).toEqual([]);
    expect(emptyProject?.archived).toEqual([]);

    // A declared target line holding no Changes at all: every one of its
    // groups is present and empty, rather than the line vanishing.
    const mainLine = result.groups.filter(group => group.targetLineId === LINE_MAIN);
    expect(mainLine.map(group => group.projectId).sort()).toEqual([
      'elftia',
      'elftia-website',
      'rocut',
    ]);
    for (const group of mainLine) {
      expect(group.active.length + group.archived.length).toBe(0);
    }

    // Present-and-empty is an ANSWER, not a gap: the one non-empty group still
    // holds its Change, and nothing about the empties lowers completeness.
    expect(
      result.groups.find(
        group => group.projectId === 'elftia' && group.targetLineId === LINE_02
      )?.active.map(entry => entry.changeId)
    ).toEqual(['only-change']);
    expect(result.complete).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('does not invent an empty group for a target line whose ref could not be read', async () => {
    // The other half of the same rule: an empty group asserts that somebody
    // LOOKED and found nothing. A line whose ref does not resolve was never
    // searched, so its pairs stay absent and the result says so instead.
    f.writeTargetLine({
      id: LINE_02,
      storeRef: 'refs/heads/does-not-exist',
      codeRefs: { elftia: 'refs/heads/release/0.2' },
    });
    commitStore('re-point line-0.2 at a missing ref');

    const result = await query().listChanges(scope);

    expect(result.groups.map(group => `${group.projectId}/${group.targetLineId}`).sort()).toEqual([
      'elftia-website/main',
      'elftia/main',
      'rocut/main',
    ]);
    expect(result.complete).toBe(false);
    expect(result.unsearchedRefs.map(ref => ref.storeRef)).toContain('refs/heads/does-not-exist');
  });

  it('reports a committed Change whose metadata cannot be read, and never omits it', async () => {
    seedAndCommit('elftia', LINE_02, 'healthy', 'a1'.repeat(16));
    seedAndCommit('elftia', LINE_02, 'unreadable', 'b2'.repeat(16));
    fs.writeFileSync(
      f.at('rasen', 'projects', 'elftia', 'changes', 'unreadable', '.openspec.yaml'),
      'schema: [unclosed\n',
      'utf8'
    );
    commitStore('break one Change record');

    const result = await query().listChanges(scope);

    // The rest of the Store still answers — one malformed Change never fails
    // the whole read.
    const elftia = result.groups.find(
      group => group.projectId === 'elftia' && group.targetLineId === LINE_02
    );
    expect(elftia?.active.map(entry => entry.changeId)).toEqual(['healthy']);

    // And the broken one is REPORTED, naming the item, where it was read from,
    // and why. Before this, it returned `null` from `changeEvidence` and the
    // caller dropped the null: the Change vanished with no trace anywhere in
    // the result, and `complete` stayed true.
    expect(result.problems).toHaveLength(1);
    const problem = result.problems[0];
    expect(problem?.kind).toBe('change');
    expect(problem?.itemId).toBe('unreadable');
    expect(problem?.storeRef).toBe('refs/heads/main');
    expect(problem?.path).toBe('rasen/projects/elftia/changes/unreadable/.openspec.yaml');
    expect(problem?.reason).toContain('not valid YAML');
    // A result that could not read an item does not present itself as complete.
    expect(result.complete).toBe(false);
  });

  it('names WHY a committed Change cannot be read: bad YAML, a rejected schema, and a missing identity are three reports', async () => {
    // `changeEvidence` gives up in three distinct places. One reason string
    // for all three would report the failure without reporting the fault, so
    // each is asserted against the branch it comes from.
    seedAndCommit('elftia', LINE_02, 'bad-yaml', 'a1'.repeat(16));
    seedAndCommit('elftia', LINE_02, 'rejected-schema', 'b2'.repeat(16));
    seedAndCommit('elftia', LINE_02, 'no-identity', 'c3'.repeat(16));
    const metadata = (changeId: string) =>
      f.at('rasen', 'projects', 'elftia', 'changes', changeId, '.openspec.yaml');
    fs.writeFileSync(metadata('bad-yaml'), 'schema: [unclosed\n', 'utf8');
    fs.writeFileSync(
      metadata('rejected-schema'),
      'schema: spec-driven\nsurpriseField: 1\n',
      'utf8'
    );
    fs.writeFileSync(metadata('no-identity'), 'schema: spec-driven\n', 'utf8');
    commitStore('break three Changes in three different ways');

    const result = await query().listChanges(scope);
    const reasonFor = (itemId: string) =>
      result.problems.find(problem => problem.itemId === itemId)?.reason ?? '';

    expect(result.problems.map(problem => problem.itemId).sort()).toEqual([
      'bad-yaml',
      'no-identity',
      'rejected-schema',
    ]);
    expect(reasonFor('bad-yaml')).toContain('not valid YAML');
    // The rejected field is named, not just the fact of rejection.
    expect(reasonFor('rejected-schema')).toContain('does not validate');
    expect(reasonFor('rejected-schema')).toContain('surpriseField');
    expect(reasonFor('no-identity')).toContain('no v2 identity block');
    expect(result.complete).toBe(false);
  });

  it('collapses one Change reachable from two refs, and un-collapses on a byte difference (task 7.1)', async () => {
    // `collectCommittedChanges`'s de-dup key is
    // `instanceId project changeId digest` (`refs.ts:520`), so this is the
    // ONLY test in this suite that exercises `digest` as a DISCRIMINATOR
    // rather than as an opaque value. It never calls `changeEvidence` or
    // reads `.digest` — it only observes `listChanges`'s public shape — so a
    // broken digest (wrong bytes hashed, wrong algorithm, or one silently
    // dropped from the key) shows up here as a wrong ENTRY COUNT, which no
    // pinned-literal hex string would catch on its own.
    seedAndCommit('elftia', LINE_MAIN, 'shared-change', 'c9'.repeat(16));
    // `release/0.2` now names the exact same commit as `main`: the Change's
    // directory is reachable, byte-for-byte, from BOTH refs.
    f.git(f.storeRoot, ['branch', '-f', 'release/0.2', 'main']);

    const collapsed = await query().listChanges({
      ...scope,
      projects: ['elftia'],
      targetLines: [LINE_MAIN],
    });
    const collapsedGroup = collapsed.groups.find(
      group => group.projectId === 'elftia' && group.targetLineId === LINE_MAIN
    );
    // One Change, byte-identical on two refs, is one Change — not two.
    expect(collapsedGroup?.active.map(entry => entry.changeId)).toEqual(['shared-change']);

    // Now make `release/0.2`'s copy byte-DIFFERENT WITHOUT touching identity:
    // a trailing comment line, which `ChangeMetadataSchema` never looks at.
    f.git(f.storeRoot, ['checkout', 'release/0.2']);
    const recordPath = f.at(
      'rasen',
      'projects',
      'elftia',
      'changes',
      'shared-change',
      '.openspec.yaml'
    );
    fs.appendFileSync(recordPath, '# diverged on release/0.2\n', 'utf8');
    commitStore('diverge the committed bytes, not the identity');
    f.git(f.storeRoot, ['checkout', 'main']);

    const diverged = await query().listChanges({
      ...scope,
      projects: ['elftia'],
      targetLines: [LINE_MAIN],
    });
    const divergedGroup = diverged.groups.find(
      group => group.projectId === 'elftia' && group.targetLineId === LINE_MAIN
    );
    // Same identity, different committed bytes on each ref: two claimants now,
    // not one — the digest half of the key is doing real work above, not
    // riding along on the identity half.
    expect(divergedGroup?.active).toHaveLength(2);
    expect(new Set(divergedGroup?.active.map(entry => entry.foundAtRef))).toEqual(
      new Set(['refs/heads/main', 'refs/heads/release/0.2'])
    );
  });

  it('finds a Change whose instanceSeed is all digits', async () => {
    // Regression for a shared-helper defect this change found: the fixture
    // wrote the seed UNQUOTED, so an all-numeric seed parsed as a YAML
    // number, ChangeMetadataSchema rejected the metadata, and the Change was
    // invisible to every blob-reading consumer with no diagnostic anywhere.
    seedAndCommit('elftia', LINE_02, 'all-digit-seed', '1'.repeat(32));

    const result = await query().listChanges(scope);
    const elftia = result.groups.find(group => group.projectId === 'elftia');
    expect(elftia?.active.map(entry => entry.changeId)).toEqual(['all-digit-seed']);
    expect(elftia?.active[0]?.changeInstanceId).toMatch(/^ci_[0-9a-f]{64}$/u);
  });

  it('offers no flat listing method on the Interface', () => {
    const module = query() as unknown as Record<string, unknown>;
    expect(module.listChangesFlat).toBeUndefined();
    expect(typeof module.listChanges).toBe('function');
    for (const key of Object.getOwnPropertyNames(StoreQueryModuleImpl.prototype)) {
      expect(key.toLowerCase()).not.toContain('flat');
    }
  });

  it('narrows with the project, line, and state filters', async () => {
    seedAndCommit('elftia', LINE_02, 'a-change', 'a1'.repeat(16));
    seedAndCommit('rocut', LINE_MAIN, 'b-change', 'b2'.repeat(16));

    const byProject = await query().listChanges({ ...scope, projects: ['rocut'] });
    expect(byProject.groups.map(group => group.projectId)).toEqual(['rocut']);

    const byLine = await query().listChanges({ ...scope, targetLines: [LINE_02] });
    expect(byLine.groups.map(group => group.targetLineId)).toEqual([LINE_02]);

    // `state` filters ENTRIES, not groups: the declared pairs are still
    // reported (present and empty), and nothing archived exists to fill them.
    // The `active` assertion is the one that carries the filter's weight — it
    // fails the moment an active Change leaks into an archived-only answer,
    // which is exactly what the old `groups` equality was written to catch.
    const archivedOnly = await query().listChanges({ ...scope, state: 'archived' });
    expect(archivedOnly.groups.flatMap(group => group.active)).toEqual([]);
    expect(archivedOnly.groups.flatMap(group => group.archived)).toEqual([]);
  });

  it('reports an archived entry with its outcome, and a legacy record with none', async () => {
    const instanceId = seedAndCommit('elftia', LINE_02, 'telemetry-emit', 'c3'.repeat(16));
    const planningScopeId = derivePlanningScopeId({
      storeUid: f.storeUid,
      projectId: 'elftia',
      targetLineId: LINE_02,
    });
    const record = serializeArchiveV2({
      schemaVersion: 2,
      implementation: 'none',
      storeUid: f.storeUid,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'telemetry-emit',
      changeInstanceId: deriveChangeInstanceId({
        planningScopeId,
        instanceSeed: 'c3'.repeat(16),
      }),
      workspacePairId: deriveWorkspacePairId({
        changeInstanceId: deriveChangeInstanceId({
          planningScopeId,
          instanceSeed: 'c3'.repeat(16),
        }),
        planningWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        executionWorktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'execution',
        }),
      }),
      outcome: 'landed',
      reason: null,
      supersededBy: null,
      planning: {
        worktreeInstanceId: deriveWorktreeInstanceId({
          repositoryIdentity: 'repo',
          worktreeIdentity: 'planning',
        }),
        sourceRef: 'refs/heads/change/telemetry',
        sourceHead: 'a'.repeat(40),
        targetRef: 'refs/heads/release/0.2',
      },
      codeMerge: null,
      specSync: { applied: true, actions: [] },
      evidence: [],
      missing: [],
      archivedAt: NOW,
    });

    // Move the Change into the archive line, exactly where the layout contract
    // addresses it, and drop a v2 record beside it.
    const changeDir = f.at('rasen', 'projects', 'elftia', 'changes', 'telemetry-emit');
    const entryName = `2026-08-07-telemetry-emit--${instanceId.slice(3, 15)}`;
    const archiveDir = f.at(
      'rasen',
      'projects',
      'elftia',
      'changes',
      'archive',
      LINE_02,
      entryName
    );
    fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
    fs.renameSync(changeDir, archiveDir);
    fs.writeFileSync(path.join(archiveDir, 'archive.json'), record, 'utf8');

    // A relocated LEGACY v1 record in the same v2 partition.
    const legacyId = seedAndCommit('rocut', LINE_MAIN, 'legacy-import', 'd4'.repeat(16));
    const legacyDir = f.at('rasen', 'projects', 'rocut', 'changes', 'legacy-import');
    const legacyEntry = f.at(
      'rasen',
      'projects',
      'rocut',
      'changes',
      'archive',
      LINE_MAIN,
      `2025-11-02-legacy-import--${legacyId.slice(3, 15)}`
    );
    fs.mkdirSync(path.dirname(legacyEntry), { recursive: true });
    fs.renameSync(legacyDir, legacyEntry);
    fs.writeFileSync(
      path.join(legacyEntry, 'archive.json'),
      `${JSON.stringify({ version: 1, changeId: 'legacy-import' }, null, 2)}\n`,
      'utf8'
    );
    commitStore('archive entries');

    const result = await query().listChanges(scope);
    const elftia = result.groups.find(group => group.projectId === 'elftia');
    expect(elftia?.archived).toHaveLength(1);
    expect(elftia?.archived[0]?.outcome).toBe('landed');
    expect(elftia?.archived[0]?.legacyRecord).toBe(false);
    expect(elftia?.archived[0]?.archiveDate).toBe('2026-08-07');

    const rocut = result.groups.find(group => group.projectId === 'rocut');
    expect(rocut?.archived).toHaveLength(1);
    // Never inferred, defaulted, or upgraded.
    expect(rocut?.archived[0]?.outcome).toBeNull();
    expect(rocut?.archived[0]?.legacyRecord).toBe(true);

    const landedOnly = await query().listChanges({ ...scope, outcomes: ['landed'] });
    expect(
      landedOnly.groups.flatMap(group => group.archived.map(entry => entry.changeId))
    ).toEqual(['telemetry-emit']);
    // The archived entry reports the ALIAS, not the entry directory name.
    expect(elftia?.archived[0]?.entryName).toBe(entryName);
  });

  it('reports an unreadable ref as unsearched rather than as absence', async () => {
    seedAndCommit('elftia', LINE_02, 'kept-change', 'a1'.repeat(16));
    // Re-point one line at a ref that resolves to nothing. Its Changes are then
    // unknown, NOT absent.
    f.writeTargetLine({
      id: LINE_02,
      storeRef: 'refs/heads/does-not-exist',
      codeRefs: { elftia: 'refs/heads/release/0.2' },
    });
    commitStore('re-point line to a missing ref');

    const result = await query().listChanges(scope);
    expect(result.complete).toBe(false);
    expect(result.unsearchedRefs.map(ref => ref.storeRef)).toContain(
      'refs/heads/does-not-exist'
    );
    expect(result.unsearchedRefs[0]?.reason).toContain('does not resolve');
    // The readable ref still answers.
    expect(result.groups.length).toBeGreaterThan(0);
  });

  it('reports an invalid catalog as an entry carrying its diagnostic', async () => {
    fs.writeFileSync(
      f.at('.rasen-store', 'projects', 'rocut.yaml'),
      'version: 2\nprojectId: rocut\nowner: someone\nroles: { planning: true, knowledge: false }\nplanningBinding: { state: unbound }\n',
      'utf8'
    );
    commitStore('break a project catalog');

    const rollup = await query().listProjects(scope);
    const broken = rollup.projects.find(entry => entry.projectId === 'rocut');
    expect(broken).toBeDefined();
    expect(broken?.roles).toBeNull();
    expect(broken?.diagnostic?.message).toContain('owner');
    // Reported, not dropped.
    expect(rollup.projects.map(entry => entry.projectId).sort()).toEqual([...PROJECTS].sort());
  });

  it('reads one ref once per query and leaves no cache behind', async () => {
    seedAndCommit('elftia', LINE_02, 'one', 'a1'.repeat(16));
    seedAndCommit('rocut', LINE_MAIN, 'two', 'b2'.repeat(16));

    const calls: string[] = [];
    const module = new StoreQueryModuleImpl({
      dependencies: {
        ...(await import('../../../src/core/store/query/dependencies.js')).productionStoreQueryDependencies,
        git: {
          ...(await import('../../../src/core/store/query/dependencies.js')).nodeStoreQueryGit,
          async resolveCommit(repoRoot, rev) {
            calls.push(`resolve ${rev}`);
            return (
              await import('../../../src/core/store/query/dependencies.js')
            ).nodeStoreQueryGit.resolveCommit(repoRoot, rev);
          },
        },
      },
    });
    await module.listChanges(scope);

    const perRef = calls.filter(entry => entry === 'resolve refs/heads/main');
    expect(perRef).toHaveLength(1);
    // No durable index anywhere under the machine root.
    const machineRoot = path.join(f.globalDataDir, 'planning-workspaces');
    const names = fs.existsSync(machineRoot) ? fs.readdirSync(machineRoot) : [];
    expect(names).not.toContain('aggregate-index');
    expect(names).not.toContain('cache');
  });

  it('leaves every canonical spec byte-identical across a full aggregate query', async () => {
    seedAndCommit('elftia', LINE_02, 'spec-owner', 'a1'.repeat(16));
    const specsDir = f.at('rasen', 'projects', 'elftia', 'specs', 'telemetry');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'spec.md'), '## Purpose\n\nx\n', 'utf8');
    commitStore('add a canonical spec');

    const before = fs.readFileSync(path.join(specsDir, 'spec.md'), 'utf8');
    await query().listChanges(scope);
    await query().listProjects(scope);
    await query().listTargetLines(scope);
    await query().listIssues(scope);
    expect(fs.readFileSync(path.join(specsDir, 'spec.md'), 'utf8')).toBe(before);
  });
});

describe('Store-level Issues, end to end', () => {
  let f: StoreWorkspaceFixture;
  let scope: { store: string; startPath: string; globalDataDir: string };

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issues-',
      projects: [...PROJECTS],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_MAIN,
          storeRef: 'refs/heads/main',
          codeRefs: {
            elftia: 'refs/heads/main',
            rocut: 'refs/heads/main',
            'elftia-website': 'refs/heads/main',
          },
        },
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { elftia: 'refs/heads/release/0.2' },
        },
      ],
    });
    scope = { store: f.storeId, startPath: f.storeRoot, globalDataDir: f.globalDataDir };
  });

  afterEach(() => {
    f.cleanup();
  });

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  it('creates an Issue with only a Store, and touches nothing else', async () => {
    const before = treeOf(f.at('rasen', 'projects'));

    const result = await issues(f).create({
      ...scope,
      issueId: 'cross-line-telemetry',
      title: 'Unify telemetry across the three shipped surfaces',
    });

    expect(result.record.state).toBe('open');
    expect(result.record.createdAt).toBe(NOW);
    expect(result.checkoutRoot).toBe(f.storeRoot);
    expect(result.suggestedCommits[0]?.pathspecs).toEqual([
      'rasen/issues/cross-line-telemetry/issue.yaml',
    ]);
    // No project partition, canonical spec, Change directory, catalog, or
    // Archive entry was created or modified.
    expect(treeOf(f.at('rasen', 'projects'))).toEqual(before);
    // Nothing was staged.
    expect(f.git(f.storeRoot, ['diff', '--cached', '--name-only']).trim()).toBe('');
  });

  it('refuses a duplicate without touching the existing record', async () => {
    await issues(f).create({ ...scope, issueId: 'dup', title: 'first' });
    const recordPath = f.at('rasen', 'issues', 'dup', 'issue.yaml');
    const before = fs.readFileSync(recordPath, 'utf8');

    await expect(
      issues(f).create({ ...scope, issueId: 'dup', title: 'second' })
    ).rejects.toMatchObject({ issueCode: 'issue_already_exists' });
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(before);
  });

  it('permits open -> resolved and open -> dropped once, and nothing after', async () => {
    await issues(f).create({ ...scope, issueId: 'lifecycle', title: 'x' });
    const resolved = await issues(f).setState({
      ...scope,
      issueId: 'lifecycle',
      state: 'resolved',
    });
    expect(resolved.record.state).toBe('resolved');

    await expect(
      issues(f).setState({ ...scope, issueId: 'lifecycle', state: 'dropped', reason: 'no' })
    ).rejects.toMatchObject({ issueCode: 'issue_state_transition_refused' });
  });

  it('requires a reason for dropped and leaves the record byte-identical when refused', async () => {
    await issues(f).create({ ...scope, issueId: 'needs-reason', title: 'x' });
    const recordPath = f.at('rasen', 'issues', 'needs-reason', 'issue.yaml');
    const before = fs.readFileSync(recordPath, 'utf8');

    await expect(
      issues(f).setState({ ...scope, issueId: 'needs-reason', state: 'dropped' })
    ).rejects.toMatchObject({ issueCode: 'issue_state_transition_refused' });
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(before);

    const dropped = await issues(f).setState({
      ...scope,
      issueId: 'needs-reason',
      state: 'dropped',
      reason: 'folded into another issue',
    });
    expect(dropped.record.reason).toBe('folded into another issue');
  });

  it('publishes ordinals in order, never rewrites an earlier revision, and records supersedes', async () => {
    await issues(f).create({ ...scope, issueId: 'plan-order', title: 'x' });
    const node = (nodeId: string) => ({
      nodeId,
      kind: 'intent' as const,
      projectId: 'rocut',
      targetLineId: LINE_MAIN,
      summary: `work ${nodeId}`,
      dependsOn: [],
    });

    const first = await issues(f).publishPlan({
      ...scope,
      issueId: 'plan-order',
      nodes: [node('a')],
    });
    const firstBytes = fs.readFileSync(first.written[0] as string, 'utf8');

    const second = await issues(f).publishPlan({
      ...scope,
      issueId: 'plan-order',
      nodes: [node('a'), node('b')],
    });
    const third = await issues(f).publishPlan({
      ...scope,
      issueId: 'plan-order',
      nodes: [node('a'), node('b'), node('c')],
    });

    expect(first.revision.revisionId).toBe('0001');
    expect(first.revision.supersedes).toBeNull();
    expect(second.revision.revisionId).toBe('0002');
    expect(second.revision.supersedes).toBe('0001');
    expect(third.revision.revisionId).toBe('0003');
    expect(third.revision.supersedes).toBe('0002');
    // Every earlier revision is byte-identical after three publications.
    expect(fs.readFileSync(first.written[0] as string, 'utf8')).toBe(firstBytes);
  });

  const intentNode = (nodeId: string, summary: string) => ({
    nodeId,
    kind: 'intent' as const,
    projectId: 'rocut',
    targetLineId: LINE_MAIN,
    summary,
    dependsOn: [],
  });

  it('allocates past a revision a merge planted, leaving its bytes untouched', async () => {
    await issues(f).create({ ...scope, issueId: 'collide', title: 'x' });
    await issues(f).publishPlan({
      ...scope,
      issueId: 'collide',
      nodes: [intentNode('a', 'x')],
    });
    // What an add/add merge from a second clone leaves behind: an ordinal this
    // machine never minted.
    const planted = f.at('rasen', 'issues', 'collide', 'plans', '0002.yaml');
    fs.writeFileSync(planted, 'version: 1\n', 'utf8');

    const next = await issues(f).publishPlan({
      ...scope,
      issueId: 'collide',
      nodes: [intentNode('a', 'y')],
    });

    // A published revision is never overwritten: allocation skips past it.
    expect(next.revision.revisionId).toBe('0003');
    expect(next.revision.supersedes).toBe('0002');
    expect(fs.readFileSync(planted, 'utf8')).toBe('version: 1\n');
  });

  it('refuses with execution_plan_revision_exists when the target file is already there', async () => {
    await issues(f).create({ ...scope, issueId: 'guarded', title: 'x' });
    await issues(f).publishPlan({
      ...scope,
      issueId: 'guarded',
      nodes: [intentNode('a', 'x')],
    });
    const existing = f.at('rasen', 'issues', 'guarded', 'plans', '0001.yaml');
    const before = fs.readFileSync(existing, 'utf8');

    // The guard exists for the case allocation cannot see: a plans directory
    // whose listing does not report the file that is nonetheless there. Blinding
    // the listing reproduces it exactly, and proves the refusal is a real gate
    // rather than a branch nothing reaches.
    const blinded = new StoreIssuesModule({
      dependencies: {
        ...withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
        fs: {
          ...productionStoreIssueDependencies.fs,
          listNames: async (target: string) =>
            target.includes(`${path.sep}plans`)
              ? []
              : productionStoreIssueDependencies.fs.listNames(target),
        },
      },
    });

    await expect(
      blinded.publishPlan({ ...scope, issueId: 'guarded', nodes: [intentNode('a', 'y')] })
    ).rejects.toMatchObject({ issueCode: 'execution_plan_revision_exists' });
    expect(fs.readFileSync(existing, 'utf8')).toBe(before);
  });

  it('verifies a change node against committed evidence and writes nothing into it', async () => {
    const instanceId = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'telemetry-emit',
      instanceSeed: 'e5'.repeat(16),
    }).instanceId;
    commitStore('seed elftia change');
    const changeDir = f.at('rasen', 'projects', 'elftia', 'changes', 'telemetry-emit');
    const before = treeOf(changeDir);

    await issues(f).create({ ...scope, issueId: 'refs-issue', title: 'x' });
    const published = await issues(f).publishPlan({
      ...scope,
      issueId: 'refs-issue',
      nodes: [
        {
          nodeId: 'elftia-emit',
          kind: 'change',
          projectId: 'elftia',
          targetLineId: LINE_02,
          changeInstanceId: instanceId,
          changeAlias: 'telemetry-emit',
          dependsOn: [],
        },
      ],
    });

    expect(published.revision.nodes[0]).toMatchObject({ changeInstanceId: instanceId });
    // Referencing writes nothing into the referenced Change.
    expect(treeOf(changeDir)).toEqual(before);
  });

  it('refuses an unresolvable reference naming the refs it searched', async () => {
    await issues(f).create({ ...scope, issueId: 'unresolved-issue', title: 'x' });
    await expect(
      issues(f).publishPlan({
        ...scope,
        issueId: 'unresolved-issue',
        nodes: [
          {
            nodeId: 'ghost',
            kind: 'change',
            projectId: 'elftia',
            targetLineId: LINE_02,
            changeInstanceId: `ci_${'f0'.repeat(32)}`,
            dependsOn: [],
          },
        ],
      })
    ).rejects.toMatchObject({ issueCode: 'issue_reference_unresolved' });
    expect(
      fs.existsSync(f.at('rasen', 'issues', 'unresolved-issue', 'plans', '0001.yaml'))
    ).toBe(false);
  });

  it('refuses a reference whose committed identity names another project or line', async () => {
    const instanceId = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'scoped',
      instanceSeed: 'f6'.repeat(16),
    }).instanceId;
    commitStore('seed scoped change');

    await issues(f).create({ ...scope, issueId: 'conflict-issue', title: 'x' });
    let thrown: unknown;
    try {
      await issues(f).publishPlan({
        ...scope,
        issueId: 'conflict-issue',
        nodes: [
          {
            nodeId: 'wrong',
            kind: 'change',
            // Declares rocut/main; the committed identity says elftia/line-0.2.
            projectId: 'rocut',
            targetLineId: LINE_MAIN,
            changeInstanceId: instanceId,
            dependsOn: [],
          },
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreIssueError);
    expect((thrown as StoreIssueError).issueCode).toBe('issue_reference_scope_conflict');
    // Both values are named, and neither side is adjusted to agree.
    expect((thrown as StoreIssueError).message).toContain('rocut/main');
    expect((thrown as StoreIssueError).message).toContain(`elftia/${LINE_02}`);
  });

  it('refuses a node naming a project or line the Store does not declare', async () => {
    await issues(f).create({ ...scope, issueId: 'undeclared', title: 'x' });
    await expect(
      issues(f).publishPlan({
        ...scope,
        issueId: 'undeclared',
        nodes: [
          {
            nodeId: 'a',
            kind: 'intent',
            projectId: 'not-a-project',
            targetLineId: LINE_MAIN,
            summary: 'x',
            dependsOn: [],
          },
        ],
      })
    ).rejects.toMatchObject({ issueCode: 'issue_reference_scope_conflict' });
  });

  it('resolves by instance and never by a mismatching alias', async () => {
    const instanceId = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'real-change',
      instanceSeed: 'a7'.repeat(16),
    }).instanceId;
    // A DIFFERENT Change whose alias is what the node records.
    f.seedChange({
      root: f.storeRoot,
      projectId: 'rocut',
      targetLineId: LINE_MAIN,
      changeId: 'decoy-alias',
      instanceSeed: 'b8'.repeat(16),
    });
    commitStore('seed real and decoy');

    await issues(f).create({ ...scope, issueId: 'alias-issue', title: 'x' });
    const published = await issues(f).publishPlan({
      ...scope,
      issueId: 'alias-issue',
      nodes: [
        {
          nodeId: 'by-instance',
          kind: 'change',
          projectId: 'elftia',
          targetLineId: LINE_02,
          changeInstanceId: instanceId,
          // The alias names the OTHER Change. Resolution must ignore it.
          changeAlias: 'decoy-alias',
          dependsOn: [],
        },
      ],
    });
    commitStore('publish alias issue');

    const plan = await query().resolveExecutionPlan({ ...scope, issueId: 'alias-issue' });
    const node = plan.readiness.nodes[0];
    expect(node?.resolution.status).toBe('resolved');
    expect(node?.resolution.claimants[0]?.changeId).toBe('real-change');
    expect(node?.resolution.claimants.map(c => c.changeId)).not.toContain('decoy-alias');
    expect(published.revision.nodes[0]).toMatchObject({ changeAlias: 'decoy-alias' });
  });

  it('reports a divergent Issue with every copy and picks no winner', async () => {
    await issues(f).create({ ...scope, issueId: 'divergent', title: 'from main' });
    commitStore('issue on main');
    // Read back the COMMITTED blob, the same bytes `collectIssues` reads via
    // `RefReader.blob`, not the working-tree file `create()` just wrote.
    const mainText = f.git(f.storeRoot, ['show', 'main:rasen/issues/divergent/issue.yaml']);

    // A second Store ref carrying a byte-different record for the same id.
    f.git(f.storeRoot, ['checkout', 'release/0.2']);
    const recordPath = f.at('rasen', 'issues', 'divergent', 'issue.yaml');
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(
      recordPath,
      `version: 1\nid: divergent\ntitle: from the release line\nstate: open\nreason: null\ncreatedAt: ${NOW}\n`,
      'utf8'
    );
    commitStore('issue on release/0.2');
    const releaseText = f.git(f.storeRoot, [
      'show',
      'release/0.2:rasen/issues/divergent/issue.yaml',
    ]);
    f.git(f.storeRoot, ['checkout', 'main']);

    const page = await query().listIssues(scope);
    const divergent = page.issues.find(entry => entry.issueId === 'divergent');
    expect(divergent?.divergence).not.toBeNull();
    expect(divergent?.divergence?.copies.length).toBeGreaterThanOrEqual(2);
    // No copy is presented as THE record.
    expect(divergent?.record).toBeNull();
    const titles = divergent?.divergence?.copies.map(copy => copy.record?.title) ?? [];
    expect(titles).toEqual(expect.arrayContaining(['from main', 'from the release line']));

    // Anchor (task 7.1): `digestOf` in `query/issues-read.ts` is unexported
    // and reachable only through `collectIssues`/`listIssues`/`showIssue`, so
    // this is necessarily an integration-style anchor rather than a pure unit
    // test. It is not blind: `mainText`/`releaseText` are read independently
    // via `git show`, and hashed here with this test's OWN `crypto` call —
    // never by calling `digestOf` or `collectIssues` a second time. A
    // mutation that hashed the wrong bytes, a substring, or a different
    // algorithm inside `digestOf` would diverge from these two independently
    // computed digests without touching them.
    const mainCopy = divergent?.divergence?.copies.find(
      copy => copy.storeRef === 'refs/heads/main'
    );
    const releaseCopy = divergent?.divergence?.copies.find(
      copy => copy.storeRef === 'refs/heads/release/0.2'
    );
    expect(mainCopy?.sha256).toBe(createHash('sha256').update(mainText, 'utf8').digest('hex'));
    expect(releaseCopy?.sha256).toBe(
      createHash('sha256').update(releaseText, 'utf8').digest('hex')
    );
    // And the two differ, which is the whole reason this Issue is divergent.
    expect(mainCopy?.sha256).not.toBe(releaseCopy?.sha256);
  });

  it('names the malformed Issue and why, and keeps reporting the readable ones', async () => {
    await issues(f).create({ ...scope, issueId: 'readable', title: 'still fine' });
    await issues(f).create({ ...scope, issueId: 'malformed', title: 'x' });
    commitStore('seed two Issues');

    // ONE copy, and it does not validate — the case a divergence report cannot
    // cover, because there is nothing to diverge from. The id survived here
    // before this fix; the reason did not, and `complete` stayed true.
    const recordPath = f.at('rasen', 'issues', 'malformed', 'issue.yaml');
    fs.writeFileSync(
      recordPath,
      `${fs.readFileSync(recordPath, 'utf8')}surpriseField: 1\n`,
      'utf8'
    );
    commitStore('break the malformed Issue record');

    const page = await query().listIssues(scope);

    const malformed = page.issues.find(entry => entry.issueId === 'malformed');
    expect(malformed).toBeDefined();
    expect(malformed?.record).toBeNull();
    expect(malformed?.divergence).toBeNull();
    // The WHY travels with the item, not only with the absence of a record.
    expect(malformed?.diagnostic).toContain('surpriseField');

    // And with the result, so a caller reading the page sees the problem
    // without inspecting every summary.
    const problem = page.problems.find(
      entry => entry.kind === 'issue' && entry.itemId === 'malformed'
    );
    expect(problem).toBeDefined();
    expect(problem?.reason).toContain('surpriseField');
    expect(page.complete).toBe(false);

    // The readable Issue is untouched by its neighbour's failure, and carries
    // no diagnostic of its own.
    const readable = page.issues.find(entry => entry.issueId === 'readable');
    expect(readable?.record?.title).toBe('still fine');
    expect(readable?.diagnostic).toBeNull();
  });

  it(
    'reports a revision whose stored digest no longer matches its content as ' +
      'unverifiable, never as valid (tasks 3.5, 7.4)',
    async () => {
      await issues(f).create({ ...scope, issueId: 'tampered', title: 'x' });
      await issues(f).publishPlan({
        ...scope,
        issueId: 'tampered',
        nodes: [intentNode('only-node', 'do the thing')],
      });
      commitStore('publish tampered plan');

      // Confirm the committed revision really does carry a recorded digest,
      // reading the same committed bytes `readRevision` reads via
      // `RefReader.blob` -- not a working-tree shortcut.
      const before = f.git(f.storeRoot, [
        'show',
        'main:rasen/issues/tampered/plans/0001.yaml',
      ]);
      expect(before).toContain('contentSha256:');

      // Corrupt the revision's recorded body WITHOUT touching its recorded
      // `contentSha256` line -- exactly what a hand-edit or a partial write
      // would produce. The pinned-literal digest anchors (tasks 7.1/7.3)
      // already prove `executionPlanDigest` itself is correct; this test
      // proves the READ path (`resolveExecutionPlan` ->
      // `resolvePlanIn` -> `readRevision` ->
      // `parseExecutionPlanRevision(text, { verifyDigest: true })`) actually
      // calls it on every read and refuses to hand back a plan whose bytes
      // no longer match the digest it carries, rather than trusting the
      // stored value once and never checking again (task 7.4's "a preimage
      // change cannot hide behind a verifier that stopped checking").
      const revisionPath = f.at('rasen', 'issues', 'tampered', 'plans', '0001.yaml');
      const tampered = fs
        .readFileSync(revisionPath, 'utf8')
        .replace('do the thing', 'a different thing entirely');
      expect(tampered).not.toBe(fs.readFileSync(revisionPath, 'utf8'));
      fs.writeFileSync(revisionPath, tampered, 'utf8');
      commitStore('tamper with the committed revision body');

      const plan = await query().resolveExecutionPlan({ ...scope, issueId: 'tampered' });

      // Reported unverifiable, not returned as a (wrongly) valid plan.
      expect(plan.revision).toBeNull();
      expect(plan.diagnostic).not.toBeNull();
      expect(plan.diagnostic).toContain('contentSha256');
      expect(plan.diagnostic).toContain('does not match');
      // No readiness is derived for an unverifiable revision either -- it is
      // refused, not silently downgraded to an empty-looking success.
      expect(plan.readiness).toEqual({ nodes: [], readyToResolve: false });
    }
  );

  it('derives readiness without writing it back, and never auto-resolves an Issue', async () => {
    const instanceId = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'ready-change',
      instanceSeed: 'c9'.repeat(16),
    }).instanceId;
    commitStore('seed ready change');

    await issues(f).create({ ...scope, issueId: 'readiness', title: 'x' });
    await issues(f).publishPlan({
      ...scope,
      issueId: 'readiness',
      nodes: [
        {
          nodeId: 'done-node',
          kind: 'change',
          projectId: 'elftia',
          targetLineId: LINE_02,
          changeInstanceId: instanceId,
          dependsOn: [],
        },
        {
          nodeId: 'not-started',
          kind: 'intent',
          projectId: 'rocut',
          targetLineId: LINE_MAIN,
          summary: 'later',
          dependsOn: ['done-node'],
        },
      ],
    });
    commitStore('publish readiness plan');

    const recordPath = f.at('rasen', 'issues', 'readiness', 'issue.yaml');
    const recordBefore = fs.readFileSync(recordPath, 'utf8');
    const revisionPath = f.at('rasen', 'issues', 'readiness', 'plans', '0001.yaml');
    const revisionBefore = fs.readFileSync(revisionPath, 'utf8');

    const detail = await query().showIssue({ ...scope, issueId: 'readiness' });
    const readiness = detail.plan?.readiness;
    expect(readiness?.nodes.map(entry => entry.readiness)).toEqual([
      'in-progress',
      'blocked',
    ]);
    expect(readiness?.readyToResolve).toBe(false);
    // The Issue's own state stays operator-declared, and nothing was rewritten.
    expect(detail.issue.record?.state).toBe('open');
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(recordBefore);
    expect(fs.readFileSync(revisionPath, 'utf8')).toBe(revisionBefore);
  });

  it('derives the reverse lookup without persisting a back-reference', async () => {
    const instanceId = f.seedChange({
      root: f.storeRoot,
      projectId: 'elftia',
      targetLineId: LINE_02,
      changeId: 'referenced',
      instanceSeed: 'aa'.repeat(16),
    }).instanceId;
    commitStore('seed referenced change');

    await issues(f).create({ ...scope, issueId: 'reverse', title: 'x' });
    await issues(f).publishPlan({
      ...scope,
      issueId: 'reverse',
      nodes: [
        {
          nodeId: 'a',
          kind: 'change',
          projectId: 'elftia',
          targetLineId: LINE_02,
          changeInstanceId: instanceId,
          dependsOn: [],
        },
      ],
    });
    commitStore('publish reverse plan');

    const found = await query().issuesReferencing({ ...scope, changeInstanceId: instanceId });
    expect(found.issues.map(entry => entry.issueId)).toEqual(['reverse']);

    // No durable back-reference exists anywhere in the referenced Change.
    const changeDir = f.at('rasen', 'projects', 'elftia', 'changes', 'referenced');
    for (const [, content] of Object.entries(treeOf(changeDir))) {
      expect(content).not.toContain('reverse');
    }
  });
});

/** Every file under `root`, keyed by its relative POSIX path. */
function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(root)) return out;
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else out[path.relative(root, target).split(path.sep).join('/')] = fs.readFileSync(target, 'utf8');
    }
  };
  walk(root);
  return out;
}
