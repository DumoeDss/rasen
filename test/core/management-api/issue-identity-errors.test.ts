import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  handleStoreIssueCreate,
  projectExecutionPlanForWire,
  projectIssueDiagnosticPayloadForWire,
  projectIssuePageForWire,
  projectIssueSummaryForWire,
  statusForIssueCode,
} from '../../../src/core/management-api/stores.js';
import {
  buildArgv,
  createStoreMutator,
  serveStoreRead,
} from '../../../src/core/management-api/stores-routes.js';
import {
  deriveIssueKey,
  issueError,
  serializeIssueRecordV2,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import type {
  IssueDetail,
  IssueSummary,
  ResolvedExecutionPlan,
  StoreQueryModule,
} from '../../../src/core/store/query/types.js';
import { parseIssueUid } from '../../../src/core/store/planning-validation.js';
import { createStoreWorkspaceFixture } from '../../helpers/store-workspace-fixture.js';

describe('Issue identity HTTP refusal mapping', () => {
  it.each([
    ['issue_title_required', 400],
    ['issue_selector_required', 400],
    ['issue_selector_invalid', 400],
    ['issue_not_found', 404],
    ['issue_selector_ambiguous', 409],
    ['issue_identity_conflict', 409],
    ['issue_key_conflict', 409],
    ['issue_alias_conflict', 409],
    ['issue_storage_identity_mismatch', 409],
    ['issue_resource_identity_mismatch', 422],
    ['issue_identity_allocation_failed', 500],
    ['issue_publication_indeterminate', 500],
  ] as const)('maps %s to HTTP %i', (code, status) => {
    expect(statusForIssueCode(code)).toBe(status);
  });

  it('projects divergence copies without exposing their storage locator', () => {
    const identity = {
      uid: '11111111-1111-4111-8111-111111111111',
      key: 'ISS-0000000000000000',
      slug: 'example',
      aliases: [{ kind: 'legacy-id', value: 'old-example' }],
    };
    const summary = {
      identity,
      issueId: identity.uid,
      record: null,
      diagnostic: null,
      divergence: {
        copies: [{
          storeRef: 'refs/heads/main',
          targetLineId: 'main',
          storageKey: 'old-example',
          identity: { identity, storageKey: 'old-example', sourceVersion: 1 },
          sha256: 'a'.repeat(64),
          record: null,
          diagnostic: null,
        }],
      },
      revisionIds: [],
      latestRevisionId: null,
      refs: ['refs/heads/main'],
      uncommitted: false,
    } as unknown as Parameters<typeof projectIssueSummaryForWire>[0];

    const projected = projectIssueSummaryForWire(summary);
    expect(projected.divergence?.copies[0]?.identity).toEqual(identity);
    expect(JSON.stringify(projected)).not.toContain('"storageKey"');
  });

  it('redacts Issue storage paths from public aggregate problems', () => {
    const projected = projectIssuePageForWire({
      issues: [],
      complete: false,
      unsearchedRefs: [],
      problems: [{
        kind: 'issue',
        itemId: 'compatibility-reference',
        storeRef: null,
        path: 'C:\\private\\store\\rasen\\issues\\internal-storage-key\\issue.yaml',
        reason: 'record is unreadable',
      }],
    });

    expect(projected.problems[0]?.path).toBe('(internal Issue storage)');
    expect(JSON.stringify(projected)).not.toContain('internal-storage-key');
    expect(JSON.stringify(projected)).not.toContain('C:\\\\private');
  });

  it('redacts a real storage-identity mismatch from both HTTP and CLI-shaped JSON', async () => {
    const fixture = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-wire-redaction-',
      lines: [{
        id: 'main',
        storeRef: 'refs/heads/main',
        codeRefs: { 'app-a': 'refs/heads/main' },
      }],
    });
    try {
      const locator = 'private-storage-locator';
      const uid = parseIssueUid('11111111-1111-4111-8111-111111111111');
      const recordPath = fixture.at('rasen', 'issues', locator, 'issue.yaml');
      fixture.write(
        recordPath,
        serializeIssueRecordV2({
          version: 2,
          identity: {
            uid,
            key: deriveIssueKey(uid),
            slug: 'wire-redaction',
            aliases: [],
          },
          title: 'Wire redaction',
          state: 'open',
          reason: null,
          createdAt: '2026-08-01T00:00:00.000Z',
        })
      );

      const core = await new StoreQueryModuleImpl().listIssues({
        store: fixture.storeId,
        startPath: fixture.storeRoot,
        globalDataDir: fixture.globalDataDir,
      });
      expect(core.complete).toBe(false);
      expect(JSON.stringify(core)).toContain(locator);

      const projected = projectIssuePageForWire(core);
      const httpBody = JSON.stringify(projected);
      const cliBody = JSON.stringify(projectIssueDiagnosticPayloadForWire({
        ...projected,
        issues: projected.issues.map(issue => ({
          ...issue,
          status: {
            problems: core.problems.map(problem => ({
              kind: 'unreadable-plan',
              node: null,
              ref: problem.path,
              reason: problem.reason,
            })),
            nodes: [{ diagnostic: core.issues[0]?.diagnostic ?? null }],
          },
        })),
      }, core.issues));
      for (const serialized of [httpBody, cliBody]) {
        expect(serialized).not.toContain(locator);
        expect(serialized).not.toContain(recordPath);
        expect(serialized).not.toContain(fixture.tempDir);
      }
      expect(projected.issues[0]).toMatchObject({
        identity: null,
        issueId: '(unavailable Issue identity)',
        diagnostic: expect.stringContaining('inspect the Store locally'),
      });
      expect(projected.problems[0]).toMatchObject({
        itemId: '(unavailable Issue identity)',
        path: '(internal Issue storage)',
        reason: expect.stringContaining('inspect the Store locally'),
      });
    } finally {
      fixture.cleanup();
    }
  });

  it('defensively projects an injected unreadable plan without treating its storage key as identity', async () => {
    const locator = 'private-plan-storage-locator';
    const internalPath = `C:\\private\\store\\rasen\\issues\\${locator}\\issue.yaml`;
    const summary = {
      identity: null,
      issueId: locator,
      record: null,
      diagnostic: `Unreadable Issue at ${internalPath}`,
      divergence: null,
      revisionIds: ['0001'],
      latestRevisionId: '0001',
      refs: [],
      uncommitted: true,
    } as unknown as IssueSummary;
    const plan = {
      issueId: locator,
      revisionId: '0001',
      revision: null,
      diagnostic: `Unreadable Issue at ${internalPath}`,
      readiness: { nodes: [], readyToResolve: false },
      complete: false,
      unsearchedRefs: [],
      problems: [{
        kind: 'issue',
        itemId: locator,
        storeRef: null,
        path: internalPath,
        reason: `Unreadable Issue at ${internalPath}`,
      }],
    } as unknown as ResolvedExecutionPlan;
    const detail = {
      issue: summary,
      plan,
      complete: false,
      unsearchedRefs: [],
      problems: plan.problems,
    } satisfies IssueDetail;
    const base = new StoreQueryModuleImpl();
    const query = new Proxy(base, {
      get(target, property, receiver) {
        if (property === 'showIssue') return async () => detail;
        if (property === 'resolveExecutionPlan') return async () => plan;
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StoreQueryModule;

    const direct = projectExecutionPlanForWire(plan, summary);
    const pathScoped = await serveStoreRead(
      {
        kind: 'issue-plans',
        storeUid: '11111111-1111-4111-8111-111111111111',
        issueId: locator,
      },
      {},
      { query }
    );
    expect(pathScoped.ok).toBe(true);
    if (!pathScoped.ok) throw new Error(pathScoped.message);

    for (const payload of [direct, pathScoped.response]) {
      expect(payload).toMatchObject({
        issueId: '(unavailable Issue identity)',
        diagnostic: expect.stringContaining('inspect the Store locally'),
        problems: [expect.objectContaining({
          itemId: '(unavailable Issue identity)',
          path: '(internal Issue storage)',
        })],
      });
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(locator);
      expect(serialized).not.toContain(internalPath);
    }
  });

  it('maps a core allocation failure through the flat HTTP creation handler', async () => {
    const result = await handleStoreIssueCreate(
      {
        storeUid: '11111111-1111-4111-8111-111111111111',
        storeId: 'fixture-store',
        root: process.cwd(),
      },
      { title: 'Title only' },
      {
        issues: {
          async create() {
            throw issueError(
              'issue_identity_allocation_failed',
              'injected allocation failure'
            );
          },
        },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      code: 'issue_identity_allocation_failed',
    });
  });

  it('maps structured indeterminate-publication recovery through the flat HTTP handler', async () => {
    const uid = parseIssueUid('11111111-1111-4111-8111-111111111111');
    const recovery = {
      kind: 'issue-publication-indeterminate' as const,
      identity: { uid, key: deriveIssueKey(uid) },
      retrySafe: false as const,
    };
    const result = await handleStoreIssueCreate(
      {
        storeUid: uid,
        storeId: 'fixture-store',
        root: process.cwd(),
      },
      { title: 'Title only' },
      {
        issues: {
          async create() {
            throw issueError(
              'issue_publication_indeterminate',
              'Issue record publication outcome is indeterminate.',
              { recovery }
            );
          },
        },
      }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      code: 'issue_publication_indeterminate',
      recovery,
    });
  });

  it('strips internal warning causes from the flat HTTP success payload', async () => {
    const uid = parseIssueUid('11111111-1111-4111-8111-111111111111');
    const internalPath = 'C:\\private\\store\\rasen\\issues\\record\\issue.yaml';
    const identity = {
      uid,
      key: deriveIssueKey(uid),
      slug: 'warning-redaction',
      aliases: [],
    };
    const result = await handleStoreIssueCreate(
      { storeUid: uid, storeId: 'fixture-store', root: process.cwd() },
      { title: 'Warning redaction' },
      {
        issues: {
          async create() {
            return {
              identity,
              issueId: uid,
              record: {
                version: 2,
                identity,
                title: 'Warning redaction',
                state: 'open',
                reason: null,
                createdAt: '2026-08-01T00:00:00.000Z',
              },
              storeId: 'fixture-store',
              storeUid: uid,
              warnings: [{
                code: 'issue_record_post_publish_warning',
                message: 'The Issue record was created, but a later atomic cleanup step failed.',
                cause: new Error(`cleanup failed at ${internalPath}`),
              }],
            } as never;
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(internalPath);
    expect(serialized).not.toContain('"cause"');
  });

  it('keeps path-scoped creation validation aligned with the canonical contract', async () => {
    const route = {
      kind: 'issues' as const,
      storeUid: '11111111-1111-4111-8111-111111111111',
    };
    await expect(buildArgv(route, {})).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: 'issue_title_required',
    });
    await expect(buildArgv(route, { title: 'Valid', issueId: 42 })).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: 'issue_selector_invalid',
    });
    const longAlias = 'a'.repeat(200);
    const built = await buildArgv(route, { title: 'Valid', issueId: longAlias });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.argv).toContain(longAlias);
  });

  it.each(['-alias', '--store'])('places option-shaped compatibility alias %s after --', async alias => {
    const built = await buildArgv(
      {
        kind: 'issues',
        storeUid: '11111111-1111-4111-8111-111111111111',
      },
      { title: 'Valid', issueId: alias }
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const delimiter = built.argv.lastIndexOf('--');
    expect(delimiter).toBeGreaterThan(built.argv.indexOf('--json'));
    expect(built.argv.slice(delimiter)).toEqual(['--', alias]);
  });

  it('maps the CLI allocation diagnostic through the path-scoped HTTP bridge', async () => {
    const mutate = createStoreMutator(
      { launchProjectRoot: process.cwd() },
      {
        cliEntryOverride: path.resolve(
          process.cwd(),
          'test',
          'fixtures',
          'management-api',
          'store-issue-fake-cli.mjs'
        ),
        cwdOverride: process.cwd(),
      }
    );
    const result = await mutate(
      {
        kind: 'issues',
        storeUid: '11111111-1111-4111-8111-111111111111',
      },
      { title: 'force allocation failure' }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      code: 'issue_identity_allocation_failed',
      cliExitCode: 1,
    });
  });

  it('maps CLI indeterminate-publication recovery through the path-scoped HTTP bridge', async () => {
    const mutate = createStoreMutator(
      { launchProjectRoot: process.cwd() },
      {
        cliEntryOverride: path.resolve(
          process.cwd(),
          'test',
          'fixtures',
          'management-api',
          'store-issue-fake-cli.mjs'
        ),
        cwdOverride: process.cwd(),
      }
    );
    const result = await mutate(
      {
        kind: 'issues',
        storeUid: '11111111-1111-4111-8111-111111111111',
      },
      { title: 'force indeterminate publication' }
    );

    expect(result).toMatchObject({
      ok: false,
      status: 500,
      code: 'issue_publication_indeterminate',
      recovery: {
        kind: 'issue-publication-indeterminate',
        identity: {
          uid: '11111111-1111-4111-8111-111111111111',
          key: 'ISS-2XSJ22FNSYD353XC',
        },
        retrySafe: false,
      },
    });
  });
});
