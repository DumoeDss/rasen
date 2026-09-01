/**
 * `store-issue-resources` tasks 5.1/5.3 — the Store aggregate HTTP bridge
 * (`src/core/management-api/stores.ts`).
 *
 * Handler-level (in-process), not over-the-wire HTTP: `resolveStoreSpace` and
 * the 10 handlers are plain exported functions, and driving them directly
 * exercises the same code the router calls with far less fixture weight than
 * spinning up `startManagementServer`. `router.ts`'s own wiring (path
 * registration, query-param parsing) is deliberately thin pass-through and is
 * not re-verified here.
 *
 * Real Git throughout via `createStoreWorkspaceFixture` — the same fixture
 * `store-worktree-bindings-v2` built and this change's CLI suites
 * (`store-issue-cli.test.ts`, `store-aggregate-cli.test.ts`) already use.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveStoreSpace,
  handleStoreProjects,
  handleStoreTargetLines,
  handleStoreChanges,
  handleStoreIssues,
  handleStoreIssue,
  handleStoreIssueReferences,
  handleStoreExecutionPlan,
  handleStoreIssueCreate,
  handleStoreIssueSetState,
  handleStorePublishPlan,
  findIncompletePlanNodeScopes,
  findInvalidPlanNodes,
  type ResolvedStoreSpace,
} from '../../../src/core/management-api/stores.js';
import { runCLI } from '../../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';

function unwrap<T>(result: { ok: true; response: T } | { ok: false; status: number; code: string; message: string }): T {
  expect(result.ok, result.ok ? '' : `${(result as any).code}: ${(result as any).message}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.response;
}

describe('Store aggregate HTTP bridge (stores.ts)', () => {
  let f: StoreWorkspaceFixture;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-stores-http-',
      projects: [PROJECT],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/main',
          codeRefs: { [PROJECT]: 'refs/heads/main' },
        },
      ],
    });
    // `createStoreWorkspaceFixture` writes `rasen/config.yaml` inside each
    // PROJECT partition (`rasen/projects/<id>/config.yaml`), but never at the
    // Store's own registered root. Real `rasen store setup` always writes one
    // there too (`ensureOpenSpecRoot`, `src/core/store/operations.ts:826`,
    // run before the `.rasen-store/store.yaml` identity file). This file's
    // handlers resolve through `resolveStoreBinding`'s alias/uid path
    // (`resolveStoreSpace`), which — unlike `StoreIssuesModuleInstance`'s
    // lighter `resolveRegisteredStore` path the CLI suites exercise — runs
    // that same root-health check (`inspectRegisteredStore` ->
    // `inspectOpenSpecRoot`) and reports `space_unavailable` without it.
    // Added locally rather than in the shared fixture, which 16 other,
    // already-landed suites depend on byte-for-byte.
    f.write(path.join(f.storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    f.git(f.storeRoot, ['add', '.']);
    f.git(f.storeRoot, ['commit', '-m', 'add Rasen workspace root config']);
    originalEnv = { ...process.env };
    // These in-process handlers (unlike the CLI suites, which spawn `runCLI`
    // subprocesses with `env: f.env`) resolve the store registry through
    // whatever `process.env` this test process itself has, so the fixture's
    // isolated env is mirrored onto it for the duration of each test.
    // `vitest.setup.ts`'s machine-root safety net sets a GLOBAL `RASEN_HOME`
    // that outranks `XDG_DATA_HOME` in `getGlobalDataDir`'s precedence — it
    // must be deleted here (as `changes.test.ts` does) or the fixture's own
    // `XDG_DATA_HOME` is silently shadowed and every registry lookup misses.
    delete process.env.RASEN_HOME;
    for (const [key, value] of Object.entries(f.env)) {
      if (value !== undefined) process.env[key] = value;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    f.cleanup();
  });

  describe('resolveStoreSpace', () => {
    it('resolves by display alias', async () => {
      const result = await resolveStoreSpace(`store:${f.storeId}`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.space.storeUid).toBe(f.storeUid);
      expect(result.space.storeId).toBe(f.storeId);
      expect(result.space.root).toBe(fs.realpathSync.native(f.storeRoot));
    });

    it('resolves by stable uid — the same Store as the alias', async () => {
      const byAlias = await resolveStoreSpace(`store:${f.storeId}`);
      const byUid = await resolveStoreSpace(`store:${f.storeUid}`);
      expect(byAlias.ok && byUid.ok).toBe(true);
      if (!byAlias.ok || !byUid.ok) return;
      expect(byUid.space.storeUid).toBe(byAlias.space.storeUid);
      expect(byUid.space.root).toBe(byAlias.space.root);
    });

    it('refuses an absent selector with space_required, not a default', async () => {
      const result = await resolveStoreSpace(undefined);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.code).toBe('space_required');
    });

    it('refuses a project: selector — this surface is Store-only', async () => {
      const result = await resolveStoreSpace('project:whatever');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.code).toBe('invalid_space');
    });

    it('404s a store alias that matches nothing in the registry', async () => {
      const result = await resolveStoreSpace('store:no-such-store');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
      expect(result.code).toBe('space_not_found');
    });
  });

  describe('reads (management-http-api: aggregate reads are available, and never mutate)', () => {
    let space: ResolvedStoreSpace;

    beforeEach(async () => {
      const resolved = await resolveStoreSpace(`store:${f.storeUid}`);
      if (!resolved.ok) throw new Error('fixture store did not resolve');
      space = resolved.space;
    });

    it('lists the fixture project via handleStoreProjects', async () => {
      const rollup = unwrap(await handleStoreProjects(space));
      expect(rollup.storeUid).toBe(f.storeUid);
      expect(rollup.projects.map((p) => p.projectId)).toEqual([PROJECT]);
    });

    it('lists the fixture target line via handleStoreTargetLines', async () => {
      const rollup = unwrap(await handleStoreTargetLines(space));
      expect(rollup.targetLines.map((t) => t.targetLineId)).toEqual([LINE]);
    });

    it('lists the declared group as present and empty (none seeded) via handleStoreChanges', async () => {
      const grouped = unwrap(await handleStoreChanges(space, {}));
      // The end-to-end reachability of the board's empty group: the fixture
      // declares one project on one target line and holds no Change, and the
      // SERVER answers with that pair, present and empty. Previously this
      // returned `[]` — the UI's "a group with zero Changes is rendered, not
      // hidden" test fed the component a group its own server could never
      // produce.
      expect(
        grouped.groups.map((group) => `${group.projectId}/${group.targetLineId}`)
      ).toEqual([`${PROJECT}/${LINE}`]);
      expect(grouped.groups[0]?.active).toEqual([]);
      expect(grouped.groups[0]?.archived).toEqual([]);
      expect(grouped.complete).toBe(true);
    });

    it('every read path leaves the Store Git tree byte-identical', async () => {
      const before = f.git(f.storeRoot, ['status', '--porcelain']);
      await handleStoreProjects(space);
      await handleStoreTargetLines(space);
      await handleStoreChanges(space, {});
      await handleStoreIssues(space);
      await handleStoreIssueReferences(space, 'no-such-change-instance');
      const after = f.git(f.storeRoot, ['status', '--porcelain']);
      expect(after).toBe(before);
    });

    it('the read paths and the CLI report the same Issue (management-http-api: "the API and the command line agree")', async () => {
      await handleStoreIssueCreate(space, { issueId: 'parity-issue', title: 'Parity Issue' });

      const apiPage = unwrap(await handleStoreIssues(space));
      const cli = await runCLI(
        ['store', 'issue', 'list', '--store', f.storeId, '--json'],
        { cwd: f.storeRoot, env: f.env }
      );
      expect(cli.exitCode, cli.stderr).toBe(0);
      const cliJson = JSON.parse(cli.stdout);

      expect(apiPage.issues.map((i) => i.issueId).sort()).toEqual(
        cliJson.issues.map((i: { issueId: string }) => i.issueId).sort()
      );
    });
  });

  describe('mutations', () => {
    let space: ResolvedStoreSpace;

    beforeEach(async () => {
      const resolved = await resolveStoreSpace(`store:${f.storeUid}`);
      if (!resolved.ok) throw new Error('fixture store did not resolve');
      space = resolved.space;
    });

    it('creates title-only Issues with server-assigned identity, refusing a missing title', async () => {
      const missingTitle = await handleStoreIssueCreate(space, { issueId: 'no-title' });
      expect(missingTitle.ok).toBe(false);
      if (missingTitle.ok) return;
      expect(missingTitle.status).toBe(400);
      expect(missingTitle.code).toBe('issue_title_required');

      const overlongTitle = await handleStoreIssueCreate(space, {
        title: 'x'.repeat(201),
      });
      expect(overlongTitle).toMatchObject({
        ok: false,
        status: 400,
        code: 'issue_title_required',
      });
      expect(unwrap(await handleStoreIssues(space)).issues).toEqual([]);

      const first = unwrap(await handleStoreIssueCreate(space, { title: '修复登录超时' }));
      const second = unwrap(await handleStoreIssueCreate(space, { title: '修复登录超时' }));
      expect(first.record).toMatchObject({ version: 2, identity: first.identity, state: 'open' });
      expect(first.issueId).toBe(first.identity.uid);
      expect(first.identity.key).toMatch(/^ISS-[0-9A-HJKMNP-TV-Z]{16}$/u);
      expect(second.identity.uid).not.toBe(first.identity.uid);
      expect(second.identity.key).not.toBe(first.identity.key);
      for (const locator of ['checkoutRoot', 'checkoutRef', 'written', 'suggestedCommits']) {
        expect(first).not.toHaveProperty(locator);
      }

      const compatible = unwrap(
        await handleStoreIssueCreate(space, { issueId: 'ok-issue', title: 'OK Issue' })
      );
      expect(compatible.identity.aliases).toContainEqual({ kind: 'legacy-id', value: 'ok-issue' });
      for (const selector of [compatible.identity.uid, compatible.identity.key, 'ok-issue']) {
        const detail = unwrap(await handleStoreIssue(space, selector));
        expect(detail.issue.identity).toEqual(compatible.identity);
        expect(detail.issue.issueId).toBe(compatible.identity.uid);
      }
    });

    it('uses issue_selector_required for every Issue route that needs a selector', async () => {
      const results = [
        await handleStoreIssue(space, undefined),
        await handleStoreExecutionPlan(space, undefined, undefined),
        await handleStoreIssueSetState(space, { state: 'resolved' }),
        await handleStorePublishPlan(space, { nodes: [] }),
      ];
      for (const result of results) {
        expect(result).toMatchObject({
          ok: false,
          status: 400,
          code: 'issue_selector_required',
        });
      }
    });

    it('returns issue_not_found for absent detail and execution-plan selectors', async () => {
      for (const result of [
        await handleStoreIssue(space, 'absent-issue'),
        await handleStoreExecutionPlan(space, 'absent-issue', undefined),
      ]) {
        expect(result).toMatchObject({
          ok: false,
          status: 404,
          code: 'issue_not_found',
        });
      }
    });

    it('transitions Issue state, refusing an invalid state name', async () => {
      await handleStoreIssueCreate(space, { issueId: 'state-issue', title: 'State Issue' });

      const badState = await handleStoreIssueSetState(space, { issueId: 'state-issue', state: 'closed' });
      expect(badState.ok).toBe(false);
      if (badState.ok) return;
      expect(badState.status).toBe(400);

      const resolved = unwrap(
        await handleStoreIssueSetState(space, { issueId: 'state-issue', state: 'resolved', reason: undefined })
      );
      expect(resolved.record.state).toBe('resolved');
    });
  });

  describe('findIncompletePlanNodeScopes (task 5.3, pure)', () => {
    it('reports nothing missing for a fully-scoped node', () => {
      expect(
        findIncompletePlanNodeScopes([{ nodeId: 'n1', projectId: PROJECT, targetLineId: LINE }])
      ).toEqual([]);
    });

    it('names both the node and each missing field', () => {
      expect(findIncompletePlanNodeScopes([{ nodeId: 'n1' }])).toEqual([
        { nodeId: 'n1', missing: ['projectId', 'targetLineId'] },
      ]);
      expect(findIncompletePlanNodeScopes([{ nodeId: 'n2', projectId: PROJECT }])).toEqual([
        { nodeId: 'n2', missing: ['targetLineId'] },
      ]);
    });

    it('treats an empty-string field as missing, not present', () => {
      expect(
        findIncompletePlanNodeScopes([{ nodeId: 'n1', projectId: '', targetLineId: LINE }])
      ).toEqual([{ nodeId: 'n1', missing: ['projectId'] }]);
    });
  });

  describe('findInvalidPlanNodes (round-1 MINOR-2, pure)', () => {
    it('accepts each defined kind carrying the field that kind requires', () => {
      expect(
        findInvalidPlanNodes([
          { nodeId: 'n1', kind: 'intent', summary: 'do the thing' },
          { nodeId: 'n2', kind: 'change', changeInstanceId: `ci_${'1'.repeat(64)}` },
        ])
      ).toEqual([]);
    });

    it('names an undefined kind rather than silently treating it as an intent', () => {
      // `normalizePlanNodes` branches on `kind === "change"` and treats
      // everything else as an intent, so an unrecognized kind used to reach
      // `assertPortableIssueText(undefined, ...)` and throw a TypeError.
      expect(findInvalidPlanNodes([{ nodeId: 'n1', kind: 'task', summary: 'x' }])).toEqual([
        { nodeId: 'n1', problem: 'kind must be "change" or "intent", not "task"' },
      ]);
      expect(findInvalidPlanNodes([{ nodeId: 'n1' }])).toEqual([
        { nodeId: 'n1', problem: 'kind must be "change" or "intent", not null' },
      ]);
    });

    it('names the field each kind is missing, and an unnamed node as unnamed', () => {
      expect(findInvalidPlanNodes([{ nodeId: 'n1', kind: 'intent' }])).toEqual([
        { nodeId: 'n1', problem: 'an intent node requires a summary string' },
      ]);
      expect(findInvalidPlanNodes([{ kind: 'change' }])).toEqual([
        { nodeId: '(unnamed node)', problem: 'a change node requires a changeInstanceId string' },
      ]);
    });
  });

  describe('handleStorePublishPlan — complete-scope enforcement (task 5.3)', () => {
    let space: ResolvedStoreSpace;

    beforeEach(async () => {
      const resolved = await resolveStoreSpace(`store:${f.storeUid}`);
      if (!resolved.ok) throw new Error('fixture store did not resolve');
      space = resolved.space;
      await handleStoreIssueCreate(space, { issueId: 'plan-issue', title: 'Plan Issue' });
    });

    it('publishes a revision when every node carries a complete scope', async () => {
      const published = unwrap(
        await handleStorePublishPlan(space, {
          issueId: 'plan-issue',
          nodes: [
            {
              nodeId: 'intent-a',
              kind: 'intent',
              projectId: PROJECT,
              targetLineId: LINE,
              summary: 'Complete scope',
            },
          ],
        })
      );
      expect(published.revision.revisionId).toBe('0001');
    });

    it(
      'refuses a node missing its scope even though the Store has exactly one project and one target line ' +
        '— the sole candidate is never adopted as the missing part (management-http-api spec scenario)',
      async () => {
        // Precondition this test depends on: exactly one project, one target
        // line — the situation an inference-based implementation would be
        // tempted to auto-fill from.
        const projects = unwrap(await handleStoreProjects(space));
        const lines = unwrap(await handleStoreTargetLines(space));
        expect(projects.projects).toHaveLength(1);
        expect(lines.targetLines).toHaveLength(1);

        const result = await handleStorePublishPlan(space, {
          issueId: 'plan-issue',
          nodes: [{ nodeId: 'intent-a', kind: 'intent', summary: 'Missing scope' }],
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.status).toBe(400);
        expect(result.code).toBe('store_query_scope_incomplete');
        expect(result.message).toContain('intent-a');
        expect(result.message).toContain('projectId');
        expect(result.message).toContain('targetLineId');

        // Nothing was published: no revision file exists.
        expect(
          fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'plan-issue', 'plans', '0001.yaml'))
        ).toBe(false);
      }
    );

    it('refuses the WHOLE request when only one of several nodes is incomplete — never a per-node drop', async () => {
      const result = await handleStorePublishPlan(space, {
        issueId: 'plan-issue',
        nodes: [
          { nodeId: 'complete-node', kind: 'intent', projectId: PROJECT, targetLineId: LINE, summary: 'Fine' },
          { nodeId: 'incomplete-node', kind: 'intent', projectId: PROJECT, summary: 'Missing target line' },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('store_query_scope_incomplete');
      // The well-scoped node was not published either — this is a whole-request refusal.
      expect(
        fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'plan-issue', 'plans', '0001.yaml'))
      ).toBe(false);
    });

    it('refuses an undefined node kind as a 400 naming the field, never a 500 (round-1 MINOR-2)', async () => {
      // A fully-scoped node whose `kind` the product does not define. Before
      // the fix this reached `normalizePlanNodes`, which assumed intent, and
      // `assertPortableIssueText(undefined, ...)` threw a TypeError that
      // `mapThrown` could only report as 500 `store_query_failed` — an
      // internal error for a request that is simply not accepted.
      const result = await handleStorePublishPlan(space, {
        issueId: 'plan-issue',
        nodes: [
          { nodeId: 'task-node', kind: 'task', projectId: PROJECT, targetLineId: LINE },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.code).toBe('plan_node_invalid');
      expect(result.message).toContain('task-node');
      expect(result.message).toContain('kind');
      // Nothing was written; the refusal precedes every write.
      expect(
        fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'plan-issue', 'plans', '0001.yaml'))
      ).toBe(false);
    });

    it('refuses a summary past the declared maximum as a 400, never a 500 (round-2 MINOR-R2-1)', async () => {
      // Round 2 measured this body as a 500 `store_query_failed` carrying
      // `revision: nodes.0.summary: Too big` — `NodeSchema`'s `max(500)` was
      // declared but bypassed by `normalizePlanNodes`'s cast, so the limit was
      // first enforced at serialize time, deep past the boundary, as a
      // `StorePlanningValidationError` that `mapThrown` can only call internal.
      const result = await handleStorePublishPlan(space, {
        issueId: 'plan-issue',
        nodes: [
          {
            nodeId: 'long-summary',
            kind: 'intent',
            projectId: PROJECT,
            targetLineId: LINE,
            summary: 'x'.repeat(501),
          },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.code).toBe('plan_node_invalid');
      expect(result.message).toContain('long-summary');
      expect(result.message).toContain('summary');
      expect(
        fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'plan-issue', 'plans', '0001.yaml'))
      ).toBe(false);
    });

    it('refuses a non-string nodeId as a 400, never a 500 (round-2 MINOR-R2-1)', async () => {
      // The other measured body: a numeric `nodeId` reached
      // `assertPortableSegment` and raised `value.includes is not a function`,
      // reported as 500 `store_query_failed`.
      const result = await handleStorePublishPlan(space, {
        issueId: 'plan-issue',
        nodes: [
          {
            nodeId: 7,
            kind: 'intent',
            projectId: PROJECT,
            targetLineId: LINE,
            summary: 'Numeric identifier',
          },
        ],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(result.code).toBe('plan_node_invalid');
      expect(result.message).toContain('nodeId');
      expect(result.message).not.toContain('value.includes is not a function');
      expect(
        fs.existsSync(path.join(f.storeRoot, 'rasen', 'issues', 'plan-issue', 'plans', '0001.yaml'))
      ).toBe(false);
    });

    it('the published revision resolves back through handleStoreExecutionPlan with a verified digest', async () => {
      await handleStorePublishPlan(space, {
        issueId: 'plan-issue',
        nodes: [
          { nodeId: 'intent-a', kind: 'intent', projectId: PROJECT, targetLineId: LINE, summary: 'Resolve me' },
        ],
      });
      const resolved = unwrap(await handleStoreExecutionPlan(space, 'plan-issue', undefined));
      expect(resolved.revisionId).toBe('0001');
      expect(resolved.diagnostic).toBeNull();
    });
  });
});
