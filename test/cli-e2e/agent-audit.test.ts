import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCLI } from '../helpers/run-cli.js';
import { buildZedDb } from '../helpers/zed-db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ZED_ROOT_ID = 'zedroot1-2222-3333-4444-555555555555';
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'token-audit');
const CODEX_MAIN_THREAD_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CODEX_FORK_THREAD_ID = 'ffffffff-0000-0000-0000-000000000006';

describe('CLI: agent audit', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-cli-agent-audit-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('analyzes a Claude session by id prefix against a fixture projects dir', async () => {
    const outPath = path.join(workDir, 'out.json');
    const result = await runCLI(
      [
        'agent', 'audit', 'c4a16986',
        '--projects-dir', path.join(FIXTURES, 'claude', 'valid'),
        '--out', outPath,
        '--json',
      ],
      { cwd: workDir }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.schema).toBe('rasen-token-audit/2');
    expect(parsed.session.runtime).toBe('claude');
    expect(parsed.session.agentCount).toBe(2);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('analyzes a Claude transcript from an explicit path without a session id lookup', async () => {
    const mainPath = path.join(FIXTURES, 'claude', 'valid', 'c4a16986-fixture.jsonl');
    const outPath = path.join(workDir, 'explicit.json');
    const result = await runCLI(['agent', 'audit', mainPath, '--out', outPath, '--json'], { cwd: workDir });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.session.runtime).toBe('claude');
  });

  it('exits non-zero and names the matches on an ambiguous session id prefix', async () => {
    const projectsDir = path.join(workDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(path.join(projectsDir, 'abc11111.jsonl'), '', 'utf-8');
    fs.writeFileSync(path.join(projectsDir, 'abc22222.jsonl'), '', 'utf-8');

    const result = await runCLI(['agent', 'audit', 'abc', '--projects-dir', projectsDir], { cwd: workDir });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/ambiguous/);
  });

  it('resolves a Codex thread id via --runtime codex, including its subagent family', async () => {
    const outPath = path.join(workDir, 'codex-out.json');
    const result = await runCLI(
      ['agent', 'audit', CODEX_MAIN_THREAD_ID, '--runtime', 'codex', '--out', outPath, '--json'],
      { cwd: workDir, env: { CODEX_HOME: path.join(FIXTURES, 'codex', 'valid') } }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.session.runtime).toBe('codex');
    expect(parsed.session.agentCount).toBe(2);
    expect(parsed.pricing).toBeUndefined();
    expect(parsed.churnEvents).toBeUndefined();
  });

  it('flags a forked/resumed Codex thread with a caveat in both --json and the text summary (M1)', async () => {
    const outPath = path.join(workDir, 'fork-out.json');
    const jsonResult = await runCLI(
      ['agent', 'audit', CODEX_FORK_THREAD_ID, '--runtime', 'codex', '--out', outPath, '--json'],
      { cwd: workDir, env: { CODEX_HOME: path.join(FIXTURES, 'codex', 'fork') } }
    );
    expect(jsonResult.exitCode).toBe(0);
    const parsed = JSON.parse(jsonResult.stdout.trim());
    expect(parsed.session.forkedFrom).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(parsed.caveats).toHaveLength(1);

    const textResult = await runCLI(
      ['agent', 'audit', CODEX_FORK_THREAD_ID, '--runtime', 'codex', '--out', outPath],
      { cwd: workDir, env: { CODEX_HOME: path.join(FIXTURES, 'codex', 'fork') } }
    );
    expect(textResult.exitCode).toBe(0);
    expect(textResult.stdout).toMatch(/Caveat:/);
    expect(textResult.stdout).toMatch(/not per-request trustworthy/);
  });

  it('analyzes a Codex rollout from an explicit path, detected from its filename', async () => {
    const rolloutPath = path.join(
      FIXTURES, 'codex', 'valid', 'sessions', '2026', '01', '01',
      'rollout-2026-01-01T00-00-00-aaaaaaaa-0000-0000-0000-000000000001.jsonl'
    );
    const outPath = path.join(workDir, 'codex-explicit.json');
    const result = await runCLI(['agent', 'audit', rolloutPath, '--out', outPath, '--json'], {
      cwd: workDir,
      env: { CODEX_HOME: path.join(workDir, 'no-such-codex-home') },
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.session.runtime).toBe('codex');
  });

  it('emits the unavailable JSON shape on Claude format drift', async () => {
    const mainPath = path.join(FIXTURES, 'claude', 'malformed-non-numeric', 'main.jsonl');
    const result = await runCLI(['agent', 'audit', mainPath, '--out', path.join(workDir, 'x.json'), '--json'], {
      cwd: workDir,
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.available).toBe(false);
    expect(parsed.reason).toBe('format-drift');
    expect(typeof parsed.detail).toBe('string');
  });

  it('does not treat a Claude entry with entirely absent message.usage as format drift (M2)', async () => {
    const mainPath = path.join(FIXTURES, 'claude', 'skip-missing-usage', 'main.jsonl');
    const outPath = path.join(workDir, 'skip-usage.json');
    const result = await runCLI(['agent', 'audit', mainPath, '--out', outPath, '--json'], { cwd: workDir });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.available).not.toBe(false);
    expect(parsed.totals.requests).toBe(1);
  });

  it('emits the unavailable JSON shape on Codex format drift', async () => {
    const rolloutPath = path.join(
      FIXTURES, 'codex', 'malformed-missing-total-usage',
      'rollout-2026-01-01T00-00-00-cccccccc-0000-0000-0000-000000000003.jsonl'
    );
    const result = await runCLI(['agent', 'audit', rolloutPath, '--out', path.join(workDir, 'y.json'), '--json'], {
      cwd: workDir,
      env: { CODEX_HOME: path.join(workDir, 'no-such-codex-home') },
    });
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.available).toBe(false);
    expect(parsed.reason).toBe('format-drift');
  });

  it('prints the experimental caveat in --help text', async () => {
    const result = await runCLI(['agent', 'audit', '--help'], { cwd: workDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/experimental/i);
    expect(result.stdout).toMatch(/harness/i);
  });

  // ---- Zed runtime ----

  function buildZedFixture(): string {
    const dbPath = path.join(workDir, 'threads.db');
    buildZedDb(dbPath, [
      {
        id: ZED_ROOT_ID,
        summary: 'Zed Root',
        folderPaths: JSON.stringify(['/w/proj']),
        createdAt: '2026-07-22T15:00:00Z',
        updatedAt: '2026-07-22T18:00:00Z',
        payload: {
          version: '0.3.0',
          model: 'opus',
          cumulative_token_usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900 },
          request_token_usage: [{}, {}],
          messages: [{ User: { content: 'audit my zed session' } }],
        },
      },
    ]);
    return dbPath;
  }

  it('analyzes a Zed session by thread id, emitting a first-class runtime:"zed" report', async () => {
    const dbPath = buildZedFixture();
    const outPath = path.join(workDir, 'zed.json');
    const result = await runCLI(
      ['agent', 'audit', ZED_ROOT_ID, '--runtime', 'zed', '--db', dbPath, '--out', outPath, '--json'],
      { cwd: workDir }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.schema).toBe('rasen-token-audit/2');
    expect(parsed.session.runtime).toBe('zed');
    expect(parsed.session.agentCount).toBe(1);
    expect(parsed.totals.rawTokens.inputTokens).toBe(100);
    expect(Array.isArray(parsed.caveats)).toBe(true);
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it('analyzes a Zed session by its first command via --match', async () => {
    const dbPath = buildZedFixture();
    const result = await runCLI(
      ['agent', 'audit', '--runtime', 'zed', '--match', 'audit my zed', '--db', dbPath, '--out', path.join(workDir, 'm.json'), '--json'],
      { cwd: workDir }
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.session.id).toBe(ZED_ROOT_ID);
  });

  it('exits non-zero with a friendly message when the Zed database is absent', async () => {
    const result = await runCLI(
      ['agent', 'audit', ZED_ROOT_ID, '--runtime', 'zed', '--db', path.join(workDir, 'no-such.db')],
      { cwd: workDir }
    );
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/not found or unreadable/);
  });

  it('lists zed as a runtime in --help text', async () => {
    const result = await runCLI(['agent', 'audit', '--help'], { cwd: workDir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/zed/i);
  });
});
