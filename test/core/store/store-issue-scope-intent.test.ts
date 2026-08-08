/**
 * `store-scoped-issues-management` tasks 7.2–7.4 — the Store-level Issue scope
 * intent.
 *
 * Three claims, each of which the resolver could get wrong in a different
 * direction:
 *
 *   - it resolves a Store with NO project and NO target line, and does not
 *     report a missing project as an error;
 *   - it grants NO project authority — every project surface still demands its
 *     own scope, and the capability exposes only Issue addresses;
 *   - from an execution worktree bound to one Change it resolves the STORE,
 *     not the bound planning worktree, whose branch carries one Change's
 *     unmerged line.
 */
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StorePlanning } from '../../../src/core/store-planning/index.js';
import {
  createStoreFinalizationFixture,
  type BoundChange,
  type StoreFinalizationFixture,
} from '../../helpers/store-finalization-fixture.js';

const PROJECT = 'elftia';
const LINE = 'line-0.2';

describe('the Store-level Issue scope intent', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-issue-intent-',
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

  it('resolves with only a Store selector, and invents no project or target line', async () => {
    const scope = await StorePlanning.open({
      intent: 'store-issue',
      startPath: f.storeRoot,
      selection: { store: f.storeId },
      globalDataDir: f.globalDataDir,
    });

    expect(scope.kind).toBe('store-issue');
    expect(scope.ref.mode).toBe('store-aggregate');
    expect(scope.ref.storeId).toBe(f.storeId);

    const description = scope.describe();
    expect(description.intent).toBe('store-issue');
    // No project or target-line fact was resolved, and none was demanded.
    expect(description.followupSelection.project).toBeUndefined();
    expect(description.followupSelection.targetLine).toBeUndefined();
    expect(description.ref).toMatchObject({ mode: 'store-aggregate' });
  });

  it('exposes Issue addresses and nothing else', async () => {
    const scope = await StorePlanning.open({
      intent: 'store-issue',
      startPath: f.storeRoot,
      selection: { store: f.storeId },
      globalDataDir: f.globalDataDir,
    });

    const record = scope.locate({ kind: 'issue-record', issueId: 'cross-line-telemetry' });
    const plans = scope.locate({ kind: 'execution-plans', issueId: 'cross-line-telemetry' });
    const revision = scope.locate({
      kind: 'execution-plan',
      issueId: 'cross-line-telemetry',
      revisionId: '0002',
    });

    const relative = (target: string) =>
      path.relative(scope.storeCheckoutRoot, target).split(path.sep).join('/');
    expect(relative(record.absolutePath)).toBe(
      'rasen/issues/cross-line-telemetry/issue.yaml'
    );
    expect(relative(plans.absolutePath)).toBe('rasen/issues/cross-line-telemetry/plans');
    expect(relative(revision.absolutePath)).toBe(
      'rasen/issues/cross-line-telemetry/plans/0002.yaml'
    );

    // A project address is refused. The type already forbids it; this pins the
    // RUNTIME refusal, because a caller reaching this capability through an
    // `unknown` boundary would not be stopped by the type.
    const untyped = scope as unknown as {
      locate(address: unknown): { absolutePath: string };
    };
    expect(() => untyped.locate({ kind: 'specs' })).toThrow(/project scope/iu);
    expect(() => untyped.locate({ kind: 'active-changes' })).toThrow(/project scope/iu);
  });

  it('grants no project authority: a project read still requires its own scope', async () => {
    await StorePlanning.open({
      intent: 'store-issue',
      startPath: f.storeRoot,
      selection: { store: f.storeId },
      globalDataDir: f.globalDataDir,
    });

    // Holding an Issue scope changes nothing about what a project intent needs.
    await expect(
      StorePlanning.open({
        intent: 'project-read',
        startPath: f.storeRoot,
        selection: { store: f.storeId },
        globalDataDir: f.globalDataDir,
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'project_scope_required' } });

    await expect(
      StorePlanning.open({
        intent: 'create-change',
        startPath: f.storeRoot,
        selection: { store: f.storeId },
        globalDataDir: f.globalDataDir,
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'project_scope_required' } });
  });

  it('refuses a standalone project rather than inventing a Store', async () => {
    await expect(
      StorePlanning.open({
        intent: 'store-issue',
        startPath: f.beside('not-a-store'),
        globalDataDir: f.globalDataDir,
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'unknown_store' } });
  });

  describe('from a bound execution worktree', () => {
    let bound: BoundChange;

    beforeEach(async () => {
      bound = await f.bind({
        projectId: PROJECT,
        targetLineId: LINE,
        changeId: 'telemetry-emit',
      });
    });

    it('resolves the Store without the operator changing directory', async () => {
      const scope = await StorePlanning.open({
        intent: 'store-issue',
        startPath: bound.executionWorktree,
        globalDataDir: f.globalDataDir,
      });

      expect(scope.kind).toBe('store-issue');
      expect(scope.ref.storeId).toBe(f.storeId);
      // No project selector was supplied and none was required, even though the
      // binding names one.
      expect(scope.describe().followupSelection.project).toBeUndefined();
    });

    it('resolves the Store checkout, never the bound planning worktree', async () => {
      const scope = await StorePlanning.open({
        intent: 'store-issue',
        startPath: bound.executionWorktree,
        globalDataDir: f.globalDataDir,
      });

      const canonical = (target: string) => path.resolve(target).toLowerCase();
      expect(canonical(scope.storeCheckoutRoot)).not.toBe(
        canonical(bound.planningWorktree)
      );
      expect(canonical(scope.storeCheckoutRoot)).toBe(canonical(f.storeRoot));

      // And the addresses it hands out land in the Store checkout, not in the
      // planning worktree — an Issue written there would live on one Change's
      // unmerged line and be invisible from every other target line.
      const record = scope.locate({ kind: 'issue-record', issueId: 'cross-line' });
      expect(canonical(record.absolutePath).startsWith(canonical(f.storeRoot))).toBe(true);
      expect(
        canonical(record.absolutePath).startsWith(canonical(bound.planningWorktree))
      ).toBe(false);
    });

    it('leaves the execution association readable: the intent writes no new field', async () => {
      // The portfolio's worst defect was a strict allow-list that had not
      // learned a field a new phase wrote. This intent writes nothing into the
      // association or the marker, and the proof is that a project intent still
      // resolves from the same checkout AFTER an Issue scope was opened.
      await StorePlanning.open({
        intent: 'store-issue',
        startPath: bound.executionWorktree,
        globalDataDir: f.globalDataDir,
      });

      const project = await StorePlanning.open({
        intent: 'project-read',
        startPath: bound.executionWorktree,
        globalDataDir: f.globalDataDir,
      });
      expect(project.kind).toBe('project');
      expect(project.ref.mode).toBe('store-project');
    });
  });
});
