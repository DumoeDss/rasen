/**
 * `issue-read-surface` tasks 3.1/3.2/3.3 — the Issue PROJECTION reads over the
 * management API (`/api/v1/stores/issue-projections|issue-projection|issue-attention`).
 *
 * Two layers, because they answer different questions:
 *
 *   - handler-level (the `stores.test.ts` in-process pattern) for payload
 *     content, the refusal statuses, the two disjoint reporting channels, the
 *     write-nothing property, and freshness;
 *   - over-the-wire (the `stores-api.test.ts` pattern) for the ONE property no
 *     in-process assertion can witness: the HTTP body and the CLI `--json`
 *     bytes are the same document, key order included. That is the spec's "the
 *     API and the command line derive the same facts", and after design D1 it
 *     holds by construction — this file is the witness that the construction
 *     is actually what shipped.
 *
 * The fixture carries the two shapes the payload's edges live at:
 *
 *   - `delta-issue` publishes TWO plan revisions, so the latest supersedes a
 *     predecessor and `status.delta` is non-null. A composition that forgot to
 *     resolve the predecessor input would report `delta: null` with no error
 *     at all — the silent-drift failure the extraction exists to prevent.
 *   - `broken-issue` has its committed plan revision damaged, so the read
 *     reports `unreadable-plan` through the PROBLEMS channel: a 200 payload
 *     carrying its own incompleteness, never an error envelope.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveStoreSpace,
  handleStoreIssueAttention,
  handleStoreIssueCreate,
  handleStoreIssueProjection,
  handleStoreIssueProjections,
  handleStoreIssueSetState,
  handleStorePublishPlan,
  type ResolvedStoreSpace,
  type StoreHandlerResult,
} from '../../../src/core/management-api/stores.js';
import { resolveRunStateContext } from '../../../src/core/issue-read/index.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'main';
const DELTA_ISSUE = 'delta-issue';
const BROKEN_ISSUE = 'broken-issue';
const TOKEN = 'test-token-issue-projection-abc123';

function unwrap<T>(result: StoreHandlerResult<T>): T {
  expect(result.ok, result.ok ? '' : `${result.code}: ${result.message}`).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return result.response;
}

function expectRefused<T>(result: StoreHandlerResult<T>, status: number, code: string): void {
  expect(result.ok, result.ok ? `expected a refusal, got a 200 payload` : '').toBe(false);
  if (result.ok) return;
  expect(result.status).toBe(status);
  expect(result.code).toBe(code);
}

interface HttpResult {
  status: number;
  body: string;
  json: () => any;
}

function req(port: number, options: { method: string; path: string; headers?: Record<string, string> }): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers,
        agent: false,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk as Buffer));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) });
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}

/** A deterministic fingerprint of every file under a root, path -> sha256. */
function treeFingerprint(root: string): Map<string, string> {
  const fingerprints = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') continue;
        walk(full);
        continue;
      }
      fingerprints.set(
        path.relative(root, full),
        createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      );
    }
  };
  if (fs.existsSync(root)) walk(root);
  return fingerprints;
}

function parseCliJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse CLI JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

/**
 * Vitest's 30s default is too tight for this file, and NOT because any single
 * assertion is slow: solo, its heaviest test runs ~20s and the fixture build
 * ~14s. Under the parallel shard CI actually runs — several real-Git suites
 * spawning CLI subprocesses on the same machine — those same tests cross 30s
 * and fail as timeouts rather than as anything about the code. The neighbouring
 * CLI-spawning suites carry explicit budgets for the same reason
 * (`stores-api.test.ts`: 120s; `store-attention-cli.test.ts`: 180s), so this
 * one states its own instead of inheriting a default that was never sized for
 * real Git.
 */
describe('the Issue projection reads', { timeout: 180_000 }, () => {
  let f: StoreWorkspaceFixture;
  let space: ResolvedStoreSpace;
  let deltaUid: string;
  let brokenUid: string;
  let handle: ManagementServerHandle | undefined;
  let originalEnv: NodeJS.ProcessEnv;

  /**
   * The run-state context the CLI would resolve from the Store checkout — the
   * same start path the server is given below (`launchProjectRoot`), so the
   * two reads see the same execution root and the parity assertion is about
   * the composition rather than about two different machines.
   */
  async function runState() {
    return resolveRunStateContext(f.storeRoot);
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

  function commitStore(message: string): void {
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', message]);
  }

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-projection-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    // `resolveStoreSpace` runs the registered-root health check the lighter
    // CLI path skips, and reports `space_unavailable` without a Rasen root
    // config at the Store's own root (the `stores.test.ts` note).
    f.write(path.join(f.storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    commitStore('add Rasen workspace root config');
    originalEnv = { ...process.env };
    // The in-process handlers resolve the registry through this process's own
    // env; `vitest.setup.ts`'s global `RASEN_HOME` outranks the fixture's
    // `XDG_DATA_HOME` and must be deleted or every lookup misses.
    delete process.env.RASEN_HOME;
    for (const [key, value] of Object.entries(f.env)) {
      if (value !== undefined) process.env[key] = value;
    }

    const resolved = await resolveStoreSpace(`store:${f.storeUid}`);
    if (!resolved.ok) throw new Error(`fixture store did not resolve: ${resolved.code}`);
    space = resolved.space;

    // The superseded-revision Issue: two published revisions, so the latest
    // names a predecessor and the delta derives.
    const first = seedAndCommit('delta-one', 'a1'.repeat(16));
    const second = seedAndCommit('delta-two', 'b2'.repeat(16));
    deltaUid = unwrap(
      await handleStoreIssueCreate(space, { issueId: DELTA_ISSUE, title: 'Delta Issue' })
    ).identity.uid;
    unwrap(
      await handleStorePublishPlan(space, {
        issueId: DELTA_ISSUE,
        nodes: [
          {
            nodeId: 'g-one',
            kind: 'change',
            projectId: PROJECT,
            targetLineId: LINE,
            changeInstanceId: first,
            changeAlias: 'delta-one',
            dependsOn: [],
          },
        ],
      })
    );
    unwrap(
      await handleStorePublishPlan(space, {
        issueId: DELTA_ISSUE,
        nodes: [
          {
            nodeId: 'g-one',
            kind: 'change',
            projectId: PROJECT,
            targetLineId: LINE,
            changeInstanceId: first,
            changeAlias: 'delta-one',
            dependsOn: [],
          },
          {
            nodeId: 'g-two',
            kind: 'change',
            projectId: PROJECT,
            targetLineId: LINE,
            changeInstanceId: second,
            changeAlias: 'delta-two',
            dependsOn: ['g-one'],
          },
        ],
      })
    );

    // The unreadable-plan Issue: published, committed, then its revision's
    // recorded digest key is damaged in place and re-committed, so BOTH the
    // committed blob and the checkout copy fail to read back.
    const third = seedAndCommit('broken-one', 'c3'.repeat(16));
    brokenUid = unwrap(
      await handleStoreIssueCreate(space, { issueId: BROKEN_ISSUE, title: 'Broken Issue' })
    ).identity.uid;
    unwrap(
      await handleStorePublishPlan(space, {
        issueId: BROKEN_ISSUE,
        nodes: [
          {
            nodeId: 'g-broken',
            kind: 'change',
            projectId: PROJECT,
            targetLineId: LINE,
            changeInstanceId: third,
            changeAlias: 'broken-one',
            dependsOn: [],
          },
        ],
      })
    );
    commitStore('publish issue plans');

    const brokenRevision = f.at('rasen', 'issues', brokenUid, 'plans', '0001.yaml');
    fs.writeFileSync(
      brokenRevision,
      fs.readFileSync(brokenRevision, 'utf8').replace('contentSha256:', 'contentSha256X:'),
      'utf8'
    );
    commitStore('damage the broken issue plan revision');
    // Hooks take their budget separately from tests: this one builds a real Git
    // Store, seeds three Changes, and publishes three plan revisions.
  }, 180_000);

  afterEach(async () => {
    await handle?.stopServer();
    handle = undefined;
    process.env = originalEnv;
    f.cleanup();
  });

  // ---------------------------------------------------------------------------
  // 3.1 — payload content and refusal statuses
  // ---------------------------------------------------------------------------

  it('the list carries each Issue`s status beside its summary', async () => {
    const payload = unwrap(await handleStoreIssueProjections(space, await runState()));

    expect(payload.issues.map(entry => entry.issueId).sort()).toEqual([brokenUid, deltaUid].sort());
    expect(payload.issues.map(entry => entry.identity?.uid).sort()).toEqual(
      [brokenUid, deltaUid].sort()
    );
    expect(JSON.stringify(payload)).not.toContain('"storageKey"');
    for (const entry of payload.issues) {
      // The three axes, present and separate — never blended.
      expect(typeof entry.status.phase).toBe('string');
      expect(typeof entry.status.health).toBe('string');
      expect(entry.status).toHaveProperty('progress');
      expect(entry.status).toHaveProperty('runStateVisibility');
      // The summary's own fields ride beside the status, not under it.
      expect(entry.record?.title ?? null).not.toBeNull();
    }
    expect(Object.keys(payload)).toEqual(['issues', 'complete', 'unsearchedRefs', 'problems']);
  });

  it('narrows the list to one lifecycle state', async () => {
    unwrap(await handleStoreIssueSetState(space, { issueId: BROKEN_ISSUE, state: 'resolved' }));
    commitStore('resolve the broken issue');

    const open = unwrap(await handleStoreIssueProjections(space, await runState(), 'open'));
    expect(open.issues.map(entry => entry.issueId)).toEqual([deltaUid]);

    const resolved = unwrap(await handleStoreIssueProjections(space, await runState(), 'resolved'));
    expect(resolved.issues.map(entry => entry.issueId)).toEqual([brokenUid]);
  });

  it('the single-Issue read carries status, delivery, and review together, with the revision delta', async () => {
    const payload = unwrap(await handleStoreIssueProjection(space, await runState(), DELTA_ISSUE));

    expect(Object.keys(payload)).toEqual([
      'issue',
      'plan',
      'status',
      'delivery',
      'review',
      'complete',
      'unsearchedRefs',
      'problems',
    ]);
    expect(payload.issue.issueId).toBe(deltaUid);
    expect(payload.issue.identity?.uid).toBe(deltaUid);
    expect(payload.plan?.revisionId).toBe('0002');
    // The predecessor input reached the projection: a composition that dropped
    // it would report `delta: null` here with no error anywhere.
    expect(payload.status.delta).not.toBeNull();
    expect(payload.status.delta?.supersedes).toBe('0001');
    expect(payload.status.delta?.added).toEqual(['g-two']);
    // Review rides the detail — no fourth path, derived from the same status.
    expect(payload.review.issueId).toBe(deltaUid);
    expect(payload.review.revisionId).toBe('0002');
    expect(payload.review.determination.kind).toBeTruthy();
    // Delivery is the rollup over the same status's nodes.
    expect(payload.delivery?.revisionId).toBe('0002');
    expect(payload.delivery?.entries.map(entry => entry.nodeId)).toEqual(['g-one', 'g-two']);
  });

  it('the attention scan reports every scanned Issue, and narrows to one', async () => {
    const scan = unwrap(await handleStoreIssueAttention(space, await runState()));
    expect(Object.keys(scan)).toEqual([
      'narrowed',
      'issueId',
      'scannedCount',
      'scanned',
      'items',
      'counts',
      'total',
      'unsearchedRefs',
      'complete',
    ]);
    expect(scan.narrowed).toBe(false);
    expect(scan.issueId).toBeNull();
    expect(scan.scannedCount).toBe(2);
    expect(scan.scanned.map(entry => entry.issueId).sort()).toEqual([brokenUid, deltaUid].sort());
    // The damaged plan is an attention item, not a dropped Issue.
    expect(scan.items.some(item => item.issueId === brokenUid && item.kind === 'problem')).toBe(true);

    const narrowed = unwrap(await handleStoreIssueAttention(space, await runState(), DELTA_ISSUE));
    expect(narrowed.narrowed).toBe(true);
    expect(narrowed.issueId).toBe(deltaUid);
    expect(narrowed.scannedCount).toBe(1);
    expect(narrowed.items.every(item => item.issueId === deltaUid)).toBe(true);
  });

  it('narrows a divergent Issue by its compatible alias instead of reporting it unknown', async () => {
    const releaseCatalog = f.at('.rasen-store', 'target-lines', 'release.yaml');
    fs.writeFileSync(
      releaseCatalog,
      [
        'version: 1',
        'id: release',
        'storeRef: refs/heads/release',
        'projects:',
        `  ${PROJECT}:`,
        '    codeRef: refs/heads/main',
        '',
      ].join('\n'),
      'utf8'
    );
    commitStore('declare release ref for divergent attention');
    f.git(f.storeRoot, ['branch', 'release']);
    f.git(f.storeRoot, ['checkout', 'release']);
    const recordPath = f.at('rasen', 'issues', deltaUid, 'issue.yaml');
    fs.writeFileSync(
      recordPath,
      fs.readFileSync(recordPath, 'utf8').replace('title: Delta Issue', 'title: Divergent Delta Issue'),
      'utf8'
    );
    commitStore('diverge delta Issue on release');
    f.git(f.storeRoot, ['checkout', 'main']);

    const narrowed = unwrap(
      await handleStoreIssueAttention(space, await runState(), DELTA_ISSUE)
    );
    expect(narrowed.narrowed).toBe(true);
    expect(narrowed.issueId).toBe(deltaUid);
    expect(narrowed.scannedCount).toBe(1);
    expect(narrowed.scanned[0]?.issueId).toBe(deltaUid);
  });

  it('refuses attention narrowing to an unknown Issue with 404 and the store`s own code', async () => {
    // Without the `mapThrown` addition this falls to 500 `store_query_failed`:
    // a client fault reported as a server fault.
    expectRefused(
      await handleStoreIssueAttention(space, await runState(), 'no-such-issue'),
      404,
      'issue_attention_unknown_issue'
    );
  });

  it('maps an unknown single-Issue projection to issue_not_found', async () => {
    expectRefused(
      await handleStoreIssueProjection(space, await runState(), 'no-such-issue'),
      404,
      'issue_not_found'
    );
  });

  it('refuses a single-Issue read with no issueId rather than answering for some Issue', async () => {
    expectRefused(
      await handleStoreIssueProjection(space, await runState(), undefined),
      400,
      'issue_selector_required'
    );
  });

  it('refuses an absent space selector — no launch-store fallback', async () => {
    const result = await resolveStoreSpace(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.code).toBe('space_required');
  });

  // ---------------------------------------------------------------------------
  // 3.3 — the two channels, freshness, write-nothing
  // ---------------------------------------------------------------------------

  it('reports unreadable evidence as a 200 payload carrying its problems, never an error envelope', async () => {
    const detail = unwrap(await handleStoreIssueProjection(space, await runState(), BROKEN_ISSUE));
    expect(detail.status.problems.some(problem => problem.kind === 'unreadable-plan')).toBe(true);
    expect(detail.status.complete).toBe(false);
    // The Issue is still answered in full: what derived, derived.
    expect(detail.issue.issueId).toBe(brokenUid);
    expect(detail.review.determination.kind).toBeTruthy();

    const list = unwrap(await handleStoreIssueProjections(space, await runState()));
    const broken = list.issues.find(entry => entry.issueId === brokenUid);
    expect(broken, 'the unreadable Issue is reported, never dropped from the list').toBeDefined();
    expect(broken?.status.problems.some(problem => problem.kind === 'unreadable-plan')).toBe(true);
  });

  it('reflects a mutation between two identical reads with no invalidation step', async () => {
    const before = unwrap(await handleStoreIssueProjection(space, await runState(), DELTA_ISSUE));
    expect(before.issue.record?.state).toBe('open');

    unwrap(await handleStoreIssueSetState(space, { issueId: DELTA_ISSUE, state: 'resolved' }));
    commitStore('resolve the delta issue');

    // No cache to clear, no refresh call in between — the same request again.
    const after = unwrap(await handleStoreIssueProjection(space, await runState(), DELTA_ISSUE));
    expect(after.issue.record?.state).toBe('resolved');
  });

  it('leaves the Store AND the machine-local state byte-identical across every projection read', async () => {
    const before = f.git(f.storeRoot, ['status', '--porcelain']);
    const beforeHead = f.git(f.storeRoot, ['rev-parse', 'HEAD']);
    // The spec names three things a projection read must not touch: no file in
    // the Store, no run-state file, and no index. Git status covers the first;
    // the workspace index and any run-state this machine holds live under the
    // fixture's global data dir, so it is fingerprinted too — otherwise "never
    // mutates" would be asserted over only one of the three.
    const beforeData = treeFingerprint(f.globalDataDir);

    const state = await runState();
    await handleStoreIssueProjections(space, state);
    await handleStoreIssueProjection(space, state, DELTA_ISSUE);
    await handleStoreIssueProjection(space, state, BROKEN_ISSUE);
    await handleStoreIssueAttention(space, state);
    await handleStoreIssueAttention(space, state, DELTA_ISSUE);
    // Repeatedly, as the scenario says.
    await handleStoreIssueProjections(space, state);
    await handleStoreIssueAttention(space, state);

    expect(f.git(f.storeRoot, ['status', '--porcelain'])).toBe(before);
    expect(f.git(f.storeRoot, ['rev-parse', 'HEAD'])).toBe(beforeHead);
    expect([...treeFingerprint(f.globalDataDir)].sort()).toEqual([...beforeData].sort());
  });

  it('degrades honestly when no execution root is in scope, rather than fabricating live facts', async () => {
    // The daemon's start path is its launch project; when none resolves, the
    // payload says so and the projection falls back to committed evidence.
    const nowhere = f.beside('nowhere');
    fs.mkdirSync(nowhere, { recursive: true });
    const blind = unwrap(
      await handleStoreIssueProjection(space, await resolveRunStateContext(nowhere), DELTA_ISSUE)
    );
    expect(blind.status.runStateVisibility.kind).toBe('none');

    const undisclosed = unwrap(await handleStoreIssueProjection(space, {}, DELTA_ISSUE));
    expect(undisclosed.status.runStateVisibility.kind).toBe('none');
  });

  // ---------------------------------------------------------------------------
  // 3.2 — over-the-wire CLI <-> API parity witness
  // ---------------------------------------------------------------------------

  it(
    'serves the same document the CLI --json prints, byte for byte, on all three paths',
    { timeout: 600_000 },
    async () => {
      const context: ManagementApiContext = {
        token: TOKEN,
        // The same start path the CLI runs from below, so the run-state
        // context both sides resolve is the same fact.
        launchProjectRoot: f.storeRoot,
        launchProjectRef: { projectId: PROJECT, name: PROJECT, root: f.storeRoot },
        version: '0.0.0-test',
        uiAssetsDir: null,
      };
      handle = await startManagementServer({ context });
      const headers = { Authorization: `Bearer ${TOKEN}` };
      const selector = `space=store:${encodeURIComponent(f.storeUid)}`;

      const pairs: Array<{ label: string; apiPath: string; cliArgs: readonly string[] }> = [
        {
          label: 'issue-projections',
          apiPath: `/api/v1/stores/issue-projections?${selector}`,
          cliArgs: ['store', 'issue', 'list', '--store', f.storeId, '--json'],
        },
        {
          label: 'issue-projection',
          apiPath: `/api/v1/stores/issue-projection?${selector}&issueId=${DELTA_ISSUE}`,
          cliArgs: ['store', 'issue', 'show', DELTA_ISSUE, '--store', f.storeId, '--json'],
        },
        {
          label: 'issue-projection (unreadable plan)',
          apiPath: `/api/v1/stores/issue-projection?${selector}&issueId=${BROKEN_ISSUE}`,
          cliArgs: ['store', 'issue', 'show', BROKEN_ISSUE, '--store', f.storeId, '--json'],
        },
        {
          label: 'issue-attention',
          apiPath: `/api/v1/stores/issue-attention?${selector}`,
          cliArgs: ['store', 'attention', '--store', f.storeId, '--json'],
        },
        {
          label: 'issue-attention (narrowed)',
          apiPath: `/api/v1/stores/issue-attention?${selector}&issueId=${DELTA_ISSUE}`,
          cliArgs: ['store', 'attention', '--store', f.storeId, '--issue', DELTA_ISSUE, '--json'],
        },
      ];

      for (const pair of pairs) {
        const apiRes = await req(handle.port, { method: 'GET', path: pair.apiPath, headers });
        expect(apiRes.status, `${pair.label}: ${apiRes.body}`).toBe(200);
        const cli = await runCLI([...pair.cliArgs], {
          cwd: f.storeRoot,
          env: f.env,
          timeoutMs: 120_000,
        });
        expect(cli.exitCode, `${pair.label}\n${cli.stderr}`).toBe(0);

        // Deep equality first (the facts), then the serialized form (the key
        // ORDER too — the CLI prints `JSON.stringify(payload, null, 2)`, so a
        // re-serialization of the wire body must reproduce its stdout exactly).
        expect(apiRes.json(), pair.label).toEqual(parseCliJson(cli));
        expect(`${JSON.stringify(apiRes.json(), null, 2)}\n`, pair.label).toBe(cli.stdout);
      }
    }
  );

  it(
    'refuses over the wire with the store`s own code in the shared error envelope',
    { timeout: 180_000 },
    async () => {
      const context: ManagementApiContext = {
        token: TOKEN,
        launchProjectRoot: f.storeRoot,
        launchProjectRef: { projectId: PROJECT, name: PROJECT, root: f.storeRoot },
        version: '0.0.0-test',
        uiAssetsDir: null,
      };
      handle = await startManagementServer({ context });
      const headers = { Authorization: `Bearer ${TOKEN}` };
      const selector = `space=store:${encodeURIComponent(f.storeUid)}`;

      const unknownNarrowing = await req(handle.port, {
        method: 'GET',
        path: `/api/v1/stores/issue-attention?${selector}&issueId=no-such-issue`,
        headers,
      });
      expect(unknownNarrowing.status).toBe(404);
      expect(unknownNarrowing.json().error.code).toBe('issue_attention_unknown_issue');

      const invalidState = await req(handle.port, {
        method: 'GET',
        path: `/api/v1/stores/issue-projections?${selector}&state=typo`,
        headers,
      });
      expect(invalidState.status).toBe(400);
      expect(invalidState.json().error.code).toBe('issue_state_undefined');

      const noSpace = await req(handle.port, {
        method: 'GET',
        path: '/api/v1/stores/issue-projections',
        headers,
      });
      expect(noSpace.status).toBe(400);
      expect(noSpace.json().error.code).toBe('space_required');

      const unauthenticated = await req(handle.port, {
        method: 'GET',
        path: `/api/v1/stores/issue-projections?${selector}`,
      });
      expect(unauthenticated.status).toBe(401);
    }
  );
});
