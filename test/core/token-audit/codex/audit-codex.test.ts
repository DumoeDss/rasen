import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAudit } from '../../../../src/core/token-audit/audit.js';
import type { CodexAuditResult } from '../../../../src/core/token-audit/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODEX_VALID_FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'fixtures', 'token-audit', 'codex', 'valid');
const CODEX_FORK_FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'fixtures', 'token-audit', 'codex', 'fork');
const MAIN_THREAD_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FORK_THREAD_ID = 'ffffffff-0000-0000-0000-000000000006';
const FORK_PARENT_THREAD_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('runAudit (Codex path)', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-codex-data-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('analyzes a Codex thread by id, discovering its subagent family and deriving per-request/turn totals', async () => {
    const { result, outPath } = await runAudit(MAIN_THREAD_ID, {
      runtime: 'codex',
      codexHome: CODEX_VALID_FIXTURE_DIR,
      outPath: path.join(dataDir, 'codex-out.json'),
    });
    expect(fs.existsSync(outPath)).toBe(true);

    const codexResult = result as CodexAuditResult;
    expect(codexResult.schema).toBe('rasen-token-audit/2');
    expect(codexResult.session.runtime).toBe('codex');
    expect(codexResult.session.id).toBe(MAIN_THREAD_ID);
    expect(codexResult.session.agentCount).toBe(2);

    // Claude-only fields must be absent, not zero-filled (design D6).
    expect((codexResult as unknown as Record<string, unknown>).pricing).toBeUndefined();
    expect((codexResult as unknown as Record<string, unknown>).churnEvents).toBeUndefined();

    expect(codexResult.totals.requests).toBe(3); // 2 derived main requests + 1 subagent request
    expect(codexResult.totals.rawTokens).toEqual({
      inputTokens: 1700, cachedInputTokens: 350, cacheWriteInputTokens: 0,
      outputTokens: 100, reasoningOutputTokens: 15, totalTokens: 2165,
    });
    expect(codexResult.totals.cacheHitRatio).toBeCloseTo(350 / 1700, 10);

    const mainAgent = codexResult.agents.find((a) => a.kind === 'main')!;
    const subAgent = codexResult.agents.find((a) => a.kind === 'subagent')!;
    expect(mainAgent.threadId).toBe(MAIN_THREAD_ID);
    expect(mainAgent.requests).toBe(2);
    expect(mainAgent.turns).toHaveLength(2);
    expect(mainAgent.turns.map((t) => t.turnId)).toEqual(['turn-1', 'turn-2']);

    expect(subAgent.label).toBe('worker');
    expect(subAgent.parentThreadId).toBe(MAIN_THREAD_ID);
    expect(subAgent.requests).toBe(1);
    expect(subAgent.rawTokens).toEqual({
      inputTokens: 200, cachedInputTokens: 50, cacheWriteInputTokens: 0,
      outputTokens: 20, reasoningOutputTokens: 0, totalTokens: 270,
    });

    // A non-forked session carries no fork flag/caveat (M1: additive, not zero-filled).
    expect(codexResult.session.forkedFrom).toBeUndefined();
    expect(codexResult.caveats).toBeUndefined();
  });

  it('analyzes a Codex rollout from an explicit path, auto-detecting the runtime from the filename', async () => {
    const rolloutPath = path.join(
      CODEX_VALID_FIXTURE_DIR,
      'sessions', '2026', '01', '01',
      'rollout-2026-01-01T00-00-00-aaaaaaaa-0000-0000-0000-000000000001.jsonl'
    );
    const { result } = await runAudit(rolloutPath, {
      outPath: path.join(dataDir, 'by-path.json'),
      codexHome: path.join(dataDir, 'no-such-codex-home'), // isolate the subagent-discovery scan from the real machine
    });
    expect((result as CodexAuditResult).session.runtime).toBe('codex');
  });

  it('flags a forked/resumed thread with session.forkedFrom and a caveat, WITHOUT excluding its requests (M1)', async () => {
    const { result } = await runAudit(FORK_THREAD_ID, {
      runtime: 'codex',
      codexHome: CODEX_FORK_FIXTURE_DIR,
      outPath: path.join(dataDir, 'fork-out.json'),
    });
    const codexResult = result as CodexAuditResult;

    expect(codexResult.session.id).toBe(FORK_THREAD_ID);
    expect(codexResult.session.forkedFrom).toBe(FORK_PARENT_THREAD_ID);
    expect(codexResult.caveats).toHaveLength(1);
    expect(codexResult.caveats![0]).toContain(FORK_PARENT_THREAD_ID);
    expect(codexResult.caveats![0]).toMatch(/not per-request trustworthy/);

    // Do-not-exclude: the fork's own token_count-derived request is still counted normally.
    expect(codexResult.totals.requests).toBe(1);
    expect(codexResult.totals.rawTokens.inputTokens).toBe(300);
  });
});
