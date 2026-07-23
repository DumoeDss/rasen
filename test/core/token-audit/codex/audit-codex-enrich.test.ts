import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runAudit } from '../../../../src/core/token-audit/audit.js';
import type { CodexAuditResult } from '../../../../src/core/token-audit/types.js';

const THREAD_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function meta(): string {
  return JSON.stringify({
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'session_meta',
    payload: { session_id: THREAD_ID, id: THREAD_ID, cwd: '/synthetic', cli_version: '0.999.0' },
  });
}

function tc(
  total: Record<string, number>,
  last: Record<string, number> | null,
  opts: { window?: number; ts?: string } = {}
): string {
  const info: Record<string, unknown> = { total_token_usage: total };
  if (last) info.last_token_usage = last;
  if (opts.window !== undefined) info.model_context_window = opts.window;
  return JSON.stringify({
    timestamp: opts.ts ?? '2026-01-01T00:00:01.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info },
  });
}

function ev(type: string, extra: Record<string, unknown> = {}, ts = '2026-01-01T00:00:02.000Z'): string {
  return JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type, ...extra } });
}

describe('runAudit (Codex enrichment)', () => {
  let home: string;
  let dataDir: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-enrich-home-'));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-codex-enrich-data-'));
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function writeRollout(lines: string[]): string {
    const dir = path.join(home, 'sessions', '2026', '01', '01');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `rollout-2026-01-01T00-00-00-${THREAD_ID}.jsonl`);
    fs.writeFileSync(p, [meta(), ...lines].join('\n') + '\n', 'utf-8');
    return p;
  }

  async function audit(p: string): Promise<CodexAuditResult> {
    const { result } = await runAudit(p, {
      codexHome: path.join(dataDir, 'no-such-home'), // isolate family discovery
      outPath: path.join(dataDir, 'out.json'),
    });
    return result as CodexAuditResult;
  }

  it('emits the enriched report blocks: requests timeline, rebuildEvents, occupancy, unsupportedDimensions', async () => {
    const p = writeRollout([
      ev('task_started', { turn_id: 't1' }, '2026-01-01T00:00:00.500Z'),
      tc(
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 1020 },
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 1020 },
        { window: 200_000, ts: '2026-01-01T00:00:01.000Z' }
      ),
      // warm hit
      tc(
        { input_tokens: 2100, cached_input_tokens: 950, output_tokens: 40, reasoning_output_tokens: 0, total_tokens: 2140 },
        { input_tokens: 1100, cached_input_tokens: 950, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 1120 },
        { ts: '2026-01-01T00:00:02.000Z' }
      ),
      ev('user_message', { message: 'new instruction' }, '2026-01-01T00:00:03.000Z'),
      // injection-driven rebuild: cache collapses after a user_message
      tc(
        { input_tokens: 3300, cached_input_tokens: 0, output_tokens: 60, reasoning_output_tokens: 0, total_tokens: 3360 },
        { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 1220 },
        { ts: '2026-01-01T00:00:04.000Z' }
      ),
    ]);
    const r = await audit(p);

    expect(r.requests).toBeDefined();
    expect(r.requests!.columns).toEqual(['agent', 'ts', 'input', 'cachedInput', 'cacheWrite', 'output', 'reasoningOutput', 'context', 'class']);
    expect(r.requests!.rows).toHaveLength(3);

    expect(r.rebuildEvents).toHaveLength(1);
    expect(r.rebuildEvents![0]).toMatchObject({ cause: 'rebase', injected: true });
    expect(r.totals.rebuilds!.events).toBe(1);
    expect(r.totals.rebuilds!.byCause.rebase.events).toBe(1);

    const agent = r.agents[0];
    expect(agent.modelContextWindow).toBe(200_000);
    expect(agent.peakContext).toBe(1200); // max primary input_tokens
    expect(agent.bursts).toBeDefined();

    expect(r.unsupportedDimensions).toHaveLength(2);
    expect(r.unsupportedDimensions!.map((d) => d.dimension).join(' ')).toMatch(/message-chain fork/);
    // primary figures drove per-request totals, so agent raw totals sum the increments
    expect(agent.rawTokens.inputTokens).toBe(1000 + 1100 + 1200);
  });

  it('marks an idle-gap rebuild as approximate in the report payload', async () => {
    const p = writeRollout([
      tc(
        { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 },
        { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 },
        { ts: '2026-01-01T00:00:01.000Z' }
      ),
      // 6-minute gap, cache collapses to 0, no compaction/rollback/user_message => idle-gap ttl-expiry
      tc(
        { input_tokens: 2200, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 2220 },
        { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1210 },
        { ts: '2026-01-01T00:06:01.000Z' }
      ),
    ]);
    const r = await audit(p);
    expect(r.rebuildEvents).toHaveLength(1);
    expect(r.rebuildEvents![0]).toMatchObject({ cause: 'ttl-expiry', approximate: true });
  });

  it('adds a cross-check caveat when summed increments diverge from the cumulative endpoint', async () => {
    // last_token_usage increments (100 + 100 = 200) are far below the cumulative endpoint (5000).
    const p = writeRollout([
      tc(
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 },
        { input_tokens: 100, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 105 }
      ),
      tc(
        { input_tokens: 5000, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 5020 },
        { input_tokens: 100, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 105 }
      ),
    ]);
    const r = await audit(p);
    expect(r.caveats).toBeDefined();
    expect(r.caveats!.some((c) => /disagree with the cumulative endpoint/.test(c))).toBe(true);
  });

  it('adds no cross-check caveat when increments agree with the endpoint', async () => {
    const p = writeRollout([
      tc(
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 },
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 }
      ),
      tc(
        { input_tokens: 2000, cached_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 2040 },
        { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1030 }
      ),
    ]);
    const r = await audit(p);
    expect(r.caveats).toBeUndefined();
  });

  it('processes an old-format rollout (cumulative-only) end to end and labels occupancy unavailable', async () => {
    const p = writeRollout([
      tc({ input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 }, null),
      tc({ input_tokens: 1800, cached_input_tokens: 200, output_tokens: 30, reasoning_output_tokens: 0, total_tokens: 1830 }, null),
    ]);
    const r = await audit(p);
    expect(r.totals.requests).toBe(2);
    expect(r.agents[0].modelContextWindow).toBeNull(); // occupancy unavailable, not guessed
    expect(r.caveats).toBeUndefined(); // absence of increments alone adds no caveat
    expect(r.requests!.rows).toHaveLength(2);
  });

  it('accounts an aborted turn: closes it, marks it aborted, attributes its request', async () => {
    const p = writeRollout([
      ev('task_started', { turn_id: 't1' }, '2026-01-01T00:00:00.500Z'),
      tc(
        { input_tokens: 500, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 510 },
        { input_tokens: 500, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 510 },
        { ts: '2026-01-01T00:00:01.000Z' }
      ),
      ev('turn_aborted', { reason: 'interrupted' }, '2026-01-01T00:00:05.000Z'),
    ]);
    const r = await audit(p);
    const turn = r.agents[0].turns.find((t) => t.turnId === 't1')!;
    expect(turn.aborted).toBe(true);
    expect(turn.end).toBe(Date.parse('2026-01-01T00:00:05.000Z'));
    expect(turn.requests).toBe(1);
  });

  it('keeps the legacy report shape intact (raw totals, cacheHitRatio, turns)', async () => {
    const p = writeRollout([
      tc(
        { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 },
        { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 10, reasoning_output_tokens: 0, total_tokens: 1010 }
      ),
    ]);
    const r = await audit(p);
    expect(r.totals.rawTokens.inputTokens).toBe(1000);
    expect(r.totals.cacheHitRatio).toBeCloseTo(0.4, 10);
    expect(r.agents[0].turns.length).toBeGreaterThanOrEqual(1);
  });
});
