import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runAudit } from '../../../../src/core/token-audit/audit.js';
import { TranscriptFormatError } from '../../../../src/core/token-audit/errors.js';
import type { ZedAuditResult } from '../../../../src/core/token-audit/types.js';
import { buildZedDb } from '../../../helpers/zed-db.js';

const ROOT = 'root1111-2222-3333-4444-555555555555';
const CHILD = 'child333-4444-5555-6666-777777777777';

describe('runAudit (Zed path)', () => {
  let dir: string;
  let dbPath: string;
  let out: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-zed-audit-'));
    dbPath = path.join(dir, 'threads.db');
    out = path.join(dir, 'report.json');
    buildZedDb(dbPath, [
      {
        id: ROOT,
        summary: 'Root Session',
        parentId: null,
        folderPaths: JSON.stringify(['/w/rasen']),
        createdAt: '2026-07-22T15:00:00Z',
        updatedAt: '2026-07-22T18:00:00Z',
        payload: {
          version: '0.3.0',
          model: 'opus',
          cumulative_token_usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900 },
          request_token_usage: [{}, {}, {}],
          messages: [{ User: { content: 'audit the zed session' } }],
        },
      },
      {
        id: CHILD,
        summary: 'Child',
        parentId: ROOT,
        createdAt: '2026-07-22T16:00:00Z',
        updatedAt: '2026-07-22T17:00:00Z',
        payload: {
          model: 'sonnet',
          cumulative_token_usage: { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 450 },
          request_token_usage: [{}, {}],
          messages: [{ User: { content: 'child helper task' } }],
        },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function auditZed(target: string, extra: Record<string, unknown> = {}): Promise<ZedAuditResult> {
    const { result } = await runAudit(target, { runtime: 'zed', db: dbPath, homedir: dir, outPath: out, ...extra });
    return result as ZedAuditResult;
  }

  it('produces a first-class runtime:"zed" report with honest totals and one aggregate entry per thread', async () => {
    const r = await auditZed(ROOT);
    expect(r.schema).toBe('rasen-token-audit/2');
    expect(r.session.runtime).toBe('zed');
    expect(r.session.id).toBe(ROOT);
    expect(r.session.agentCount).toBe(2);
    expect(r.session.title).toBe('Root Session');
    expect(r.session.workingDir).toBe('/w/rasen');
    expect(r.session.firstUserCommand).toBe('audit the zed session');

    expect(r.totals.rawTokens).toEqual({ inputTokens: 150, cachedInputTokens: 1350, outputTokens: 30 });
    expect(r.totals.retainedRequests).toBe(5);
    expect(r.totals.cacheHitRatio).toBeCloseTo(1350 / 1500, 10);

    // Honest mapping: no reasoning-output / cache-write fields exist at all.
    expect(Object.keys(r.threads[0].rawTokens).sort()).toEqual(['cachedInputTokens', 'inputTokens', 'outputTokens']);

    // Activation order: the root is main and comes first.
    expect(r.threads[0].kind).toBe('main');
    expect(r.threads[0].threadId).toBe(ROOT);
    expect(r.threads[1].kind).toBe('subagent');
    expect(r.threads[1].parentThreadId).toBe(ROOT);
    expect(r.threads[1].model).toBe('sonnet');

    expect(r.source).toEqual({ adapter: 'zed-threads-db', dataVersion: '0.3.0' });
    expect(r.caveats.length).toBeGreaterThanOrEqual(4);
    expect(r.caveats.join(' ')).toMatch(/reasoning-output|cache-write/);
    expect(fs.existsSync(out)).toBe(true);
  });

  it('resolves a thread by unique id prefix', async () => {
    const r = await auditZed('root1111');
    expect(r.session.id).toBe(ROOT);
  });

  it('resolves a session by its first command via --match', async () => {
    const r = await auditZed('', { match: 'child helper' });
    expect(r.session.id).toBe(CHILD);
    // Auditing the child directly makes it the (only) main thread.
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0].kind).toBe('main');
  });

  it('rejects an ambiguous --match, listing candidates', async () => {
    // "the" appears in "audit the zed session"; craft a shared substring across both.
    await expect(auditZed('', { match: 'task' })).resolves.toBeTruthy(); // "task" only in child → unique
    await expect(auditZed('', { match: 'e' })).rejects.toThrow(/ambiguous/);
  });

  it('rejects a --match with no first-command hit', async () => {
    await expect(auditZed('', { match: 'no-such-command-anywhere' })).rejects.toThrow(/no Zed thread whose first command/);
  });

  it('rejects supplying both a thread id and --match', async () => {
    await expect(auditZed(ROOT, { match: 'child helper' })).rejects.toThrow(/not both/);
  });

  it('rejects --match / --db on a non-Zed runtime', async () => {
    await expect(runAudit('someid', { runtime: 'claude', match: 'x', homedir: dir })).rejects.toThrow(
      /only apply to --runtime zed/
    );
  });

  it('fails soft (TranscriptFormatError) when the target thread payload is unrecognized', async () => {
    const badDb = path.join(dir, 'bad.db');
    buildZedDb(badDb, [{ id: ROOT, summary: 'bad', dataType: 'brotli', data: new Uint8Array([1, 2, 3]) }]);
    await expect(runAudit(ROOT, { runtime: 'zed', db: badDb, homedir: dir, outPath: out })).rejects.toThrow(
      TranscriptFormatError
    );
  });

  it('errors when the default database location is absent and no --db is given', async () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-zed-nohome-'));
    await expect(runAudit(ROOT, { runtime: 'zed', homedir: emptyHome, outPath: out })).rejects.toThrow(
      /default location/
    );
    fs.rmSync(emptyHome, { recursive: true, force: true });
  });
});
