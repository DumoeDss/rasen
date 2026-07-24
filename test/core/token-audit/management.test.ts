import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import {
  AuditManagementService,
  AuditReportRepository,
  AuditServiceError,
  discoverAuditSessions,
  resolveNativeAuditTarget,
  validateAuditReport,
} from '../../../src/core/token-audit/management.js';
import { runAudit } from '../../../src/core/token-audit/audit.js';
import { buildZedDb } from '../../helpers/zed-db.js';

function report(id = 'session-a') {
  return {
    schema: 'rasen-token-audit/2',
    generatedAt: '2026-07-24T00:00:00.000Z',
    session: {
      id,
      runtime: 'claude',
      mainTranscript: '/redacted/source.jsonl',
      start: 1,
      end: 2,
      durationMs: 1,
      agentCount: 1,
    },
    pricing: { cacheReadX: 0.1, cacheWriteMainX: 1.25, cacheWriteSubX: 1.25 },
    totals: {
      requests: 0,
      outputTokens: 0,
      inputRaw: 0,
      cacheWrite: 0,
      cacheRead: 0,
      billedInputEq: 0,
      churn: { tokens: 0, events: 0, byCause: {} },
      resumes: { hit: 0, miss: 0, missRewrote: 0 },
    },
    byModel: {},
    gapHistogram: {},
    agents: [],
    requests: { columns: [], classes: [], rows: [] },
    churnEvents: [],
  };
}

describe('audit management core', () => {
  let root: string;
  let claudeRoot: string;
  let codexHome: string;
  let dataHome: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-audit-management-'));
    claudeRoot = path.join(root, 'claude-projects');
    codexHome = path.join(root, 'codex');
    dataHome = path.join(root, 'rasen-home');
    fs.mkdirSync(path.join(claudeRoot, 'project-a'), { recursive: true });
    fs.mkdirSync(path.join(codexHome, 'sessions', '2026', '07', '24'), { recursive: true });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('discovers Claude and main non-fork Codex sessions newest-first and fails soft for Zed', () => {
    const claude = path.join(claudeRoot, 'project-a', 'claude-id.jsonl');
    fs.writeFileSync(claude, '{}\n');
    fs.utimesSync(claude, new Date(1000), new Date(1000));

    const codex = path.join(
      codexHome,
      'sessions',
      '2026',
      '07',
      '24',
      'rollout-2026-07-24T00-00-00-codex-id.jsonl'
    );
    fs.writeFileSync(
      codex,
      `${JSON.stringify({ type: 'session_meta', payload: { session_id: 'codex-id', cwd: '/work' } })}\n`
    );
    fs.utimesSync(codex, new Date(2000), new Date(2000));

    const result = discoverAuditSessions(20, {
      claudeProjectsRoot: claudeRoot,
      codexHome,
      zedDbPath: path.join(root, 'missing.db'),
      env: { RASEN_HOME: dataHome },
    });
    expect(result.sessions.map((session) => `${session.runtime}:${session.sessionId}`)).toEqual([
      'codex:codex-id',
      'claude:claude-id',
    ]);
    expect(result.diagnostics.find((item) => item.runtime === 'zed')).toMatchObject({ available: false });
    expect(result.sessions.every((session) => !('path' in session))).toBe(true);
  });

  it('resolves exact Claude identities deterministically when duplicate ids exist without accepting a path', () => {
    fs.writeFileSync(path.join(claudeRoot, 'project-a', 'same.jsonl'), '{}\n');
    const resolved = resolveNativeAuditTarget('claude', 'same', { claudeProjectsRoot: claudeRoot });
    expect(resolved.target).toBe('same');
    expect(resolved.options.projectsDir).toBe(path.join(claudeRoot, 'project-a'));
    expect(() => resolveNativeAuditTarget('claude', '../same', { claudeProjectsRoot: claudeRoot })).toThrow(
      AuditServiceError
    );

    fs.mkdirSync(path.join(claudeRoot, 'project-b'));
    const newer = path.join(claudeRoot, 'project-b', 'same.jsonl');
    fs.writeFileSync(newer, '{}\n');
    fs.utimesSync(path.join(claudeRoot, 'project-a', 'same.jsonl'), new Date(1000), new Date(1000));
    fs.utimesSync(newer, new Date(2000), new Date(2000));
    expect(
      resolveNativeAuditTarget('claude', 'same', { claudeProjectsRoot: claudeRoot }).options.projectsDir
    ).toBe(path.join(claudeRoot, 'project-b'));

    const discovered = discoverAuditSessions(20, {
      claudeProjectsRoot: claudeRoot,
      codexHome: path.join(root, 'missing-codex'),
      zedDbPath: path.join(root, 'missing.db'),
    });
    expect(discovered.sessions.filter((item) => item.sessionId === 'same')).toHaveLength(1);
    expect(discovered.diagnostics.find((item) => item.runtime === 'claude')?.message).toMatch(/duplicate/i);
  });

  it('discovers and audits the same newest Codex entry across active and archived stores', async () => {
    const sessionId = 'duplicate-codex-id';
    const active = path.join(
      codexHome,
      'sessions',
      '2026',
      '07',
      '24',
      `rollout-2026-07-24T00-00-00-${sessionId}.jsonl`
    );
    const archivedDir = path.join(codexHome, 'archived_sessions');
    const archived = path.join(archivedDir, `rollout-2026-07-24T01-00-00-${sessionId}.jsonl`);
    fs.mkdirSync(archivedDir, { recursive: true });
    const rollout = (inputTokens: number) => [
      JSON.stringify({
        timestamp: '2026-07-24T00:00:00.000Z',
        type: 'session_meta',
        payload: { session_id: sessionId, id: sessionId, cwd: '/work' },
      }),
      JSON.stringify({
        timestamp: '2026-07-24T00:00:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: inputTokens,
              cached_input_tokens: 0,
              output_tokens: 1,
              reasoning_output_tokens: 0,
              total_tokens: inputTokens + 1,
            },
          },
        },
      }),
    ].join('\n') + '\n';
    fs.writeFileSync(active, rollout(1000));
    fs.writeFileSync(archived, rollout(9000));
    fs.utimesSync(active, new Date(1000), new Date(1000));
    fs.utimesSync(archived, new Date(2000), new Date(2000));

    const options = {
      codexHome,
      claudeProjectsRoot: path.join(root, 'missing-claude'),
      zedDbPath: path.join(root, 'missing.db'),
      env: { RASEN_HOME: dataHome },
    };
    const discovered = discoverAuditSessions(20, options);
    expect(discovered.sessions.filter((item) => item.sessionId === sessionId)).toEqual([
      expect.objectContaining({ runtime: 'codex', updatedAt: 2000 }),
    ]);

    const resolved = resolveNativeAuditTarget('codex', sessionId, options);
    const audited = await runAudit(resolved.target, {
      ...resolved.options,
      outPath: path.join(dataHome, 'analytics', 'codex-duplicate.json'),
    });
    expect(audited.result.session.mainTranscript).toBe(archived);
    expect('agents' in audited.result && audited.result.agents[0].rawTokens.inputTokens).toBe(9000);
  });

  it('rejects hostile and future-shaped reports before descriptor or viewer use', () => {
    const hostile = report('hostile') as ReturnType<typeof report> & {
      session: ReturnType<typeof report>['session'] & { agentCount: unknown };
    };
    hostile.session.agentCount = '<img src=x onerror="globalThis.auditPwned=1">';
    expect(() => validateAuditReport(hostile)).toThrow(/structure/);
    expect(() => validateAuditReport({ ...report(), schema: 'rasen-token-audit/999' })).toThrow(
      /supported/
    );

    const codexHostile = {
      schema: 'rasen-token-audit/2',
      generatedAt: '2026-07-24T00:00:00.000Z',
      session: {
        id: 'hostile-codex',
        runtime: 'codex',
        mainTranscript: '/redacted/source.jsonl',
        start: 1,
        end: 2,
        durationMs: 1,
        agentCount: 1,
      },
      totals: {
        requests: 1,
        cacheHitRatio: 0,
        rawTokens: {
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 1,
        },
      },
      agents: [{
        index: 0,
        label: 'agent',
        kind: 'main',
        requests: 1,
        cacheHitRatio: 0,
        rawTokens: {
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 1,
        },
        turns: [],
        rebuilds: {
          events: '<img src=x onerror="globalThis.auditPwned=DATA.session.id">',
          rewroteTokens: 1,
          byCause: {},
        },
      }],
    };
    expect(() => validateAuditReport(codexHostile)).toThrow(/structure/);

    const zedHostile = {
      schema: 'rasen-token-audit/2',
      generatedAt: '2026-07-24T00:00:00.000Z',
      session: {
        id: 'hostile-zed',
        runtime: 'zed',
        mainTranscript: '/redacted/threads.db',
        title: null,
        workingDir: null,
        firstUserCommand: { toString: 'handler' },
        start: 1,
        end: 2,
        durationMs: 1,
        agentCount: 0,
      },
      totals: {
        retainedRequests: 0,
        cacheHitRatio: 0,
        rawTokens: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      },
      threads: [],
      source: { adapter: 'zed-threads-db', dataVersion: null },
      caveats: [],
    };
    expect(() => validateAuditReport(zedHostile)).toThrow(/structure/);
  });

  it('discovers Zed roots through metadata-only rows', () => {
    const zedPath = path.join(root, 'threads.db');
    buildZedDb(zedPath, [
      {
        id: 'zed-root',
        summary: 'Root thread',
        createdAt: '2026-01-01T00:00:00Z',
        payload: { cumulative_token_usage: { input_tokens: 1 } },
      },
      {
        id: 'zed-child',
        parentId: 'zed-root',
        createdAt: '2026-01-02T00:00:00Z',
        payload: { cumulative_token_usage: { input_tokens: 2 } },
      },
    ]);
    const discovered = discoverAuditSessions(20, {
      claudeProjectsRoot: path.join(root, 'missing-claude'),
      codexHome: path.join(root, 'missing-codex'),
      zedDbPath: zedPath,
    });
    expect(discovered.sessions).toEqual([
      expect.objectContaining({ runtime: 'zed', sessionId: 'zed-root', title: 'Root thread' }),
    ]);
  });

  it('lists only direct valid regular reports and safely reads exact basenames', () => {
    const dir = path.join(dataHome, 'analytics');
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'valid.json'), JSON.stringify(report()));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{');
    fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
    let symlinkCreated = false;
    try {
      fs.symlinkSync(path.join(dir, 'valid.json'), path.join(dir, 'linked.json'));
      symlinkCreated = true;
    } catch {
      // Windows without Developer Mode cannot create file symlinks; Linux/macOS CI covers this branch.
    }
    const repository = new AuditReportRepository({ env: { RASEN_HOME: dataHome } });
    const listed = repository.list();
    expect(listed.reports).toEqual([
      expect.objectContaining({ id: 'valid.json', runtime: 'claude', sessionId: 'session-a' }),
    ]);
    expect(listed.skipped).toBe(symlinkCreated ? 4 : 3);
    expect(repository.read('valid.json').report.session.id).toBe('session-a');
    if (symlinkCreated) expect(() => repository.read('linked.json')).toThrow(AuditServiceError);
    for (const unsafe of ['../valid.json', 'nested/valid.json', 'C:\\valid.json', 'valid.json\\other']) {
      expect(() => repository.read(unsafe)).toThrow(AuditServiceError);
    }
  });

  it('imports report bytes collision-safely, cleans temporary files, and rejects overlapping work', async () => {
    const service = new AuditManagementService({ env: { RASEN_HOME: dataHome } });
    const body = Buffer.from(JSON.stringify(report('imported')));
    const first = await service.importStream(Readable.from(body), '..\\picked.json', body.length);
    const second = await service.importStream(Readable.from(body), 'picked.json', body.length);
    expect(first.descriptor.id).toBe('picked.json');
    expect(second.descriptor.id).toBe('picked-1.json');

    const pending = new PassThrough();
    const active = service.importStream(pending, 'third.json');
    await expect(service.importStream(Readable.from(body), 'fourth.json')).rejects.toMatchObject({
      status: 409,
      code: 'audit_busy',
    });
    pending.end(body);
    await active;
    const tempDir = path.join(dataHome, 'tmp', 'audit-imports');
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it('stops streamed imports at the cap and removes the partial temporary file', async () => {
    const service = new AuditManagementService({ env: { RASEN_HOME: dataHome } });
    const chunks = async function* () {
      yield Buffer.alloc(8, 1);
      yield Buffer.alloc(8, 2);
      throw new Error('the service must stop before requesting another chunk');
    };
    await expect(service.importStream(Readable.from(chunks()), 'large.jsonl', undefined, 12)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
    expect(fs.readdirSync(path.join(dataHome, 'tmp', 'audit-imports'))).toEqual([]);
    expect(fs.existsSync(path.join(dataHome, 'analytics'))).toBe(false);
  });

  it('routes Claude, Codex, and Zed source uploads through the existing audit engine', async () => {
    const service = new AuditManagementService({
      env: { RASEN_HOME: dataHome },
      claudeProjectsRoot: claudeRoot,
    });
    const claudeFixtureDir = path.resolve('test', 'fixtures', 'token-audit', 'claude', 'valid');
    const claudeFixture = fs.readFileSync(path.join(claudeFixtureDir, 'c4a16986-fixture.jsonl'));
    const codexFixture = fs.readFileSync(
      path.resolve(
        'test',
        'fixtures',
        'token-audit',
        'codex',
        'valid',
        'sessions',
        '2026',
        '01',
        '01',
        'rollout-2026-01-01T00-00-00-aaaaaaaa-0000-0000-0000-000000000001.jsonl'
      )
    );
    const zedPath = path.join(root, 'source.db');
    buildZedDb(zedPath, [
      {
        id: 'zed-root',
        summary: 'Root',
        createdAt: '2026-01-01T00:00:00Z',
        payload: { cumulative_token_usage: { input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 } },
      },
    ]);

    const importedClaude = await service.importStream(Readable.from(claudeFixture), 'claude.jsonl');
    expect(importedClaude.descriptor.runtime).toBe('claude');
    expect(importedClaude.descriptor.memberCount).toBe(1);

    const nativeMain = path.join(claudeRoot, 'project-a', 'c4a16986-fixture.jsonl');
    fs.copyFileSync(path.join(claudeFixtureDir, 'c4a16986-fixture.jsonl'), nativeMain);
    const nativeSubagents = path.join(
      claudeRoot,
      'project-a',
      'c4a16986-fixture',
      'subagents'
    );
    fs.mkdirSync(nativeSubagents, { recursive: true });
    fs.copyFileSync(
      path.join(claudeFixtureDir, 'c4a16986-fixture', 'subagents', 'agent-worker-1a2b3c4d.jsonl'),
      path.join(nativeSubagents, 'agent-worker-1a2b3c4d.jsonl')
    );
    expect((await service.runNative('claude', 'c4a16986-fixture')).descriptor.memberCount).toBe(2);
    expect((await service.importStream(Readable.from(codexFixture), 'codex.jsonl')).descriptor.runtime).toBe('codex');
    expect(
      (await service.importStream(Readable.from(fs.readFileSync(zedPath)), 'threads.sqlite')).descriptor.runtime
    ).toBe('zed');
  });
});
