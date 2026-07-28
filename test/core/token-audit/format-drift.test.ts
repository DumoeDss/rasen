/**
 * Fixture-based fail-soft regression pin (design D3, corrected post-review —
 * see M2 in rasen/changes/agent-audit-command/work/review-report.md): the
 * valid fixture produces exact hand-computed totals; a fixture that violates
 * a shape assumption the accounting math depends on (a PRESENT-but-non-
 * numeric token field) throws TranscriptFormatError, not an unhandled
 * exception. A single truncated/unparseable line, and (on the Claude side)
 * an assistant entry with `message.usage` entirely absent, are NOT format
 * drift — the parser skips them and keeps going, matching the original
 * `audit.mjs`'s `if (u && sum > 0)` guard and task 3.2's explicit
 * unparseable-line contract (the "A stray malformed line does not abort the
 * audit" scenario in specs/cli-agent-audit/spec.md) — pinned here for both
 * runtimes.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAudit } from '../../../src/core/token-audit/audit.js';
import { TranscriptFormatError } from '../../../src/core/token-audit/errors.js';
import type { ClaudeAuditResult, CodexAuditResult } from '../../../src/core/token-audit/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'token-audit');

describe('token-audit fail-soft format-drift pin', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-token-audit-format-drift-'));
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe('Claude runtime', () => {
    it('the valid fixture produces the exact hand-computed totals', async () => {
      const mainPath = path.join(FIXTURES, 'claude', 'valid', 'c4a16986-fixture.jsonl');
      const { result } = await runAudit(mainPath, { homedir: dataDir, outPath: path.join(dataDir, 'out.json') });
      const claude = result as ClaudeAuditResult;
      expect(claude.totals.requests).toBe(4);
      expect(claude.totals.billedInputEq).toBe(1050 + 107);
      expect(claude.totals.churn).toEqual({
        tokens: 250,
        events: 1,
        byCause: { 'ttl-expiry': { tokens: 250, events: 1 } },
      });
    });

    it('a missing message.usage object does NOT throw — the line is skipped and the audit continues (M2)', async () => {
      const mainPath = path.join(FIXTURES, 'claude', 'skip-missing-usage', 'main.jsonl');
      const { result } = await runAudit(mainPath, { homedir: dataDir, outPath: path.join(dataDir, 'a.json') });
      // Only the usage-bearing second line becomes a request.
      expect((result as ClaudeAuditResult).totals.requests).toBe(1);
    });

    it('a non-numeric usage token field throws TranscriptFormatError, not an unhandled exception', async () => {
      const mainPath = path.join(FIXTURES, 'claude', 'malformed-non-numeric', 'main.jsonl');
      await expect(
        runAudit(mainPath, { homedir: dataDir, outPath: path.join(dataDir, 'b.json') })
      ).rejects.toThrow(TranscriptFormatError);
    });

    it('a truncated line does NOT abort the audit — it is skipped like any unparseable line', async () => {
      const mainPath = path.join(FIXTURES, 'claude', 'malformed-truncated', 'main.jsonl');
      const { result } = await runAudit(mainPath, { homedir: dataDir, outPath: path.join(dataDir, 'c.json') });
      expect((result as ClaudeAuditResult).totals.requests).toBe(1);
    });
  });

  describe('Codex runtime', () => {
    it('a token_count event missing info.total_token_usage throws TranscriptFormatError', async () => {
      const rolloutPath = path.join(
        FIXTURES, 'codex', 'malformed-missing-total-usage',
        'rollout-2026-01-01T00-00-00-cccccccc-0000-0000-0000-000000000003.jsonl'
      );
      await expect(
        runAudit(rolloutPath, { outPath: path.join(dataDir, 'd.json'), codexHome: path.join(dataDir, 'no-codex-home') })
      ).rejects.toThrow(TranscriptFormatError);
    });

    it('a non-numeric total_token_usage field throws TranscriptFormatError', async () => {
      const rolloutPath = path.join(
        FIXTURES, 'codex', 'malformed-non-numeric',
        'rollout-2026-01-01T00-00-00-dddddddd-0000-0000-0000-000000000004.jsonl'
      );
      await expect(
        runAudit(rolloutPath, { outPath: path.join(dataDir, 'e.json'), codexHome: path.join(dataDir, 'no-codex-home') })
      ).rejects.toThrow(TranscriptFormatError);
    });

    it('a truncated line does NOT abort the audit — the rollout still produces a report from the rest', async () => {
      const rolloutPath = path.join(
        FIXTURES, 'codex', 'malformed-truncated',
        'rollout-2026-01-01T00-00-00-eeeeeeee-0000-0000-0000-000000000005.jsonl'
      );
      const { result } = await runAudit(rolloutPath, {
        outPath: path.join(dataDir, 'f.json'),
        codexHome: path.join(dataDir, 'no-codex-home'),
      });
      // The truncated token_count line is skipped; no requests were derived,
      // but the rollout itself parses without throwing.
      expect((result as CodexAuditResult).totals.requests).toBe(0);
    });
  });
});
