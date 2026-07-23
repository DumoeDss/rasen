import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAudit } from '../../../src/core/token-audit/audit.js';
import type { ClaudeAuditResult } from '../../../src/core/token-audit/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_VALID_FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'token-audit', 'claude', 'valid');

describe('runAudit (Claude path)', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-data-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('analyzes a session by explicit main-transcript path, applying dual TTL pricing across main + subagent', async () => {
    const mainPath = path.join(CLAUDE_VALID_FIXTURE_DIR, 'c4a16986-fixture.jsonl');
    const { result, outPath } = await runAudit(mainPath, { homedir: dataDir, outPath: path.join(dataDir, 'out.json') });
    expect(outPath).toBe(path.join(dataDir, 'out.json'));
    expect(fs.existsSync(outPath)).toBe(true);

    const claudeResult = result as ClaudeAuditResult;
    expect(claudeResult.schema).toBe('rasen-token-audit/2');
    expect(claudeResult.session.runtime).toBe('claude');
    expect(claudeResult.session.agentCount).toBe(2);

    // main: requests A (deduped, out=15) + B (ttl-expiry churn)
    // subagent: requests C (spawn) + D (hit)
    expect(claudeResult.totals.requests).toBe(4);
    expect(claudeResult.totals.outputTokens).toBe(15 + 5 + 3 + 2);
    expect(claudeResult.totals.inputRaw).toBe(100 + 50 + 20 + 20);
    expect(claudeResult.totals.cacheWrite).toBe(200 + 250 + 40 + 10);
    expect(claudeResult.totals.cacheRead).toBe(0 + 0 + 0 + 44);

    // billedInputEq: main = 150 + 2*450 + 0.1*0 = 1050; subagent = 40 + 1.25*50 + 0.1*44 = 106.9 -> 107
    const mainAgent = claudeResult.agents.find((a) => a.kind === 'main')!;
    const subAgent = claudeResult.agents.find((a) => a.kind === 'subagent')!;
    expect(mainAgent.billedInputEq).toBe(1050);
    expect(subAgent.billedInputEq).toBe(107);
    expect(claudeResult.totals.billedInputEq).toBe(1050 + 107);

    // churn: exactly one event, from main's ttl-expiry request
    expect(claudeResult.totals.churn.events).toBe(1);
    expect(claudeResult.totals.churn.tokens).toBe(250);
    expect(claudeResult.totals.churn.byCause['ttl-expiry']).toEqual({ tokens: 250, events: 1 });

    // activation order: main starts first
    expect(claudeResult.agents[0].kind).toBe('main');
    expect(claudeResult.agents[1].kind).toBe('subagent');
    expect(subAgent.label).toBe('worker');
  });

  it('discovers and analyzes a session by id prefix under --projects-dir', async () => {
    const { result } = await runAudit('c4a16986', {
      projectsDir: CLAUDE_VALID_FIXTURE_DIR,
      homedir: dataDir,
      outPath: path.join(dataDir, 'out2.json'),
    });
    expect((result as ClaudeAuditResult).session.id).toBe('c4a16986-fixture');
  });

  it('rejects an ambiguous session id prefix, naming the matches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-ambiguous-'));
    fs.writeFileSync(path.join(dir, 'abc11111.jsonl'), '', 'utf-8');
    fs.writeFileSync(path.join(dir, 'abc22222.jsonl'), '', 'utf-8');
    await expect(runAudit('abc', { projectsDir: dir, homedir: dataDir })).rejects.toThrow(/ambiguous/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('honors an explicit --out override over the default analytics path', async () => {
    const mainPath = path.join(CLAUDE_VALID_FIXTURE_DIR, 'c4a16986-fixture.jsonl');
    const explicitOut = path.join(dataDir, 'nested', 'custom-name.json');
    const { outPath } = await runAudit(mainPath, { homedir: dataDir, outPath: explicitOut });
    expect(outPath).toBe(explicitOut);
    expect(fs.existsSync(explicitOut)).toBe(true);
  });

  it('resolves the default output path under <globalDataDir>/analytics/session-audit-<sid8>.json', async () => {
    const mainPath = path.join(CLAUDE_VALID_FIXTURE_DIR, 'c4a16986-fixture.jsonl');
    const { outPath } = await runAudit(mainPath, { homedir: dataDir, env: {} });
    const expected = path.join(dataDir, '.rasen', 'analytics', 'session-audit-c4a16986.json');
    expect(outPath).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
  });
});
