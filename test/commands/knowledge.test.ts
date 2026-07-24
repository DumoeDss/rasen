import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { registerKnowledgeCommand } from '../../src/commands/knowledge.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { resolveProjectHome } from '../../src/core/project-home.js';

vi.mock('@inquirer/prompts', async () => {
  const actual = await vi.importActual<typeof import('@inquirer/prompts')>('@inquirer/prompts');
  return { ...actual, confirm: vi.fn() };
});

const DIGEST = `sha256:${'b'.repeat(64)}`;
const evidence = (projectId: string, change = 'add-thing', artifact = 'proposal') => ({
  projectId,
  change,
  artifact,
  digest: DIGEST,
});

const ID = 'go-sql-transaction-locking';
const projectCandidate = (overrides: Record<string, unknown> = {}) => ({
  version: 1,
  operation: 'upsert',
  scope: 'project',
  id: ID,
  knowledgeKey: 'go-sql-tx-locking',
  description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
  instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
  applicability: { mode: 'all', markers: ['go.mod'] },
  evidence: [evidence('project-a')],
  ...overrides,
});

describe('rasen knowledge command', () => {
  let tempHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;
  let originalTTY: boolean | undefined;
  let originalExitCode: typeof process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  async function promptMocks() {
    const prompts = await import('@inquirer/prompts');
    return { confirm: prompts.confirm as unknown as ReturnType<typeof vi.fn> };
  }

  async function runKnowledge(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerKnowledgeCommand(program);
    await program.parseAsync(['node', 'rasen', 'knowledge', ...args]);
  }

  function writeCandidate(candidate: unknown): string {
    const file = path.join(tempHome, `candidate-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(candidate), 'utf-8');
    return file;
  }

  /** The last JSON document written to stdout (the agent-contract single doc). */
  function lastJson(): unknown {
    const calls = logSpy.mock.calls.map(([value]) => String(value));
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(calls[index]);
      } catch {
        // not JSON; keep scanning back
      }
    }
    return undefined;
  }

  function projectStoreDir(): string {
    const home = fs
      .readdirSync(path.join(tempHome, 'projects'), { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name !== 'registry.json');
    return path.join(tempHome, 'projects', home!.name, 'learned-skills');
  }

  beforeEach(async () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-knowledge-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-knowledge-proj-'));
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    originalTTY = (process.stdout as unknown as { isTTY?: boolean }).isTTY;
    originalExitCode = process.exitCode;

    process.env.RASEN_HOME = tempHome;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    process.env.RASEN_LANG = 'en';
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.writeFileSync(path.join(projectRoot, 'go.mod'), 'module example\n');
    await resolveProjectHome(projectRoot);
    // Active codify profile authorizes project mutations.
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', workflows: ['apply'], retention: 'codify' });

    process.chdir(projectRoot);
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = true;
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = originalTTY;
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.clearAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('applies a project candidate under an active codify profile and is idempotent', async () => {
    await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
    expect(lastJson()).toMatchObject({ ok: true, outcome: 'created', scope: 'project', id: ID });
    expect(fs.existsSync(path.join(projectStoreDir(), ID, 'SKILL.md'))).toBe(true);

    logSpy.mockClear();
    await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
    expect(lastJson()).toMatchObject({ ok: true, outcome: 'no-op', id: ID });
  });

  it('rejects a relative candidate path and changes nothing', async () => {
    await runKnowledge(['apply', '--from', 'candidate.json', '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'candidate_path_not_absolute' } });
    expect(fs.existsSync(projectStoreDir())).toBe(false);
  });

  it('keeps a Windows drive-letter --from value as a single argument', async () => {
    // On POSIX a Windows path is not absolute, but it must arrive as one
    // argument and be rejected as a path, never parsed as skill-identity text.
    await runKnowledge(['apply', '--from', 'C:\\Users\\me\\candidate.json', '--json']);
    expect(process.exitCode).toBe(1);
    const result = lastJson() as { error?: { code?: string; message?: string } };
    expect(result.error?.message).toContain('C:\\Users\\me\\candidate.json');
  });

  it('rejects malformed and oversized candidate input', async () => {
    const badPath = path.join(tempHome, 'bad.json');
    fs.writeFileSync(badPath, '{ not valid json', 'utf-8');
    await runKnowledge(['apply', '--from', badPath, '--json']);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'candidate_invalid' } });

    logSpy.mockClear();
    const bigPath = path.join(tempHome, 'big.json');
    fs.writeFileSync(bigPath, 'x'.repeat(300 * 1024), 'utf-8');
    await runKnowledge(['apply', '--from', bigPath, '--json']);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'candidate_too_large' } });
  });

  it('refuses a project mutation without an active codify profile', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', workflows: ['apply'], retention: 'off' });
    await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'codify_required' } });
    expect(fs.existsSync(projectStoreDir())).toBe(false);
  });

  it('refuses to overwrite a human-authored collision and leaves it byte-identical', async () => {
    const humanDir = path.join(projectStoreDir(), ID);
    fs.mkdirSync(humanDir, { recursive: true });
    fs.writeFileSync(path.join(humanDir, 'SKILL.md'), 'human authored\n');
    const before = fs.readFileSync(path.join(humanDir, 'SKILL.md'), 'utf-8');

    await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({ ok: false, block: { code: 'ownership_collision' } });
    expect(fs.readFileSync(path.join(humanDir, 'SKILL.md'), 'utf-8')).toBe(before);
  });

  it('rejects --approve-global reused for a project mutation', async () => {
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate()),
      '--approve-global',
      '--json',
    ]);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'consent_scope_mismatch' } });
  });

  it('requires explicit consent for a global promotion outside a TTY', async () => {
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = false;
    const globalCandidate = projectCandidate({
      operation: 'promote',
      scope: 'global',
      evidence: [evidence('project-a'), evidence('project-b')],
    });
    await runKnowledge(['apply', '--from', writeCandidate(globalCandidate), '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'global_approval_required' } });

    logSpy.mockClear();
    process.exitCode = undefined;
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(globalCandidate),
      '--approve-global',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({ ok: true, outcome: 'created', scope: 'global', id: ID });
  });

  it('honors an interactive global approval prompt (accept and decline)', async () => {
    const { confirm } = await promptMocks();
    const globalCandidate = projectCandidate({
      operation: 'promote',
      scope: 'global',
      evidence: [evidence('project-a'), evidence('project-b')],
    });

    confirm.mockResolvedValueOnce(false);
    await runKnowledge(['apply', '--from', writeCandidate(globalCandidate)]);
    expect(errSpy.mock.calls.flat().join('\n')).toContain('Global approval was not granted');

    confirm.mockResolvedValueOnce(true);
    await runKnowledge(['apply', '--from', writeCandidate(globalCandidate)]);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('Created global learned skill');
  });

  it('lists, shows, and retires managed records through the same seam', async () => {
    await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
    logSpy.mockClear();

    await runKnowledge(['list', '--scope', 'project', '--json']);
    expect(lastJson()).toMatchObject({ learnedSkills: [{ id: ID, scope: 'project', status: 'active' }] });

    logSpy.mockClear();
    await runKnowledge(['show', ID, '--scope', 'project', '--json']);
    expect(lastJson()).toMatchObject({ id: ID, status: 'active' });

    logSpy.mockClear();
    await runKnowledge(['retire', ID, '--scope', 'project', '--yes', '--json']);
    expect(lastJson()).toMatchObject({ ok: true, outcome: 'retired', id: ID });
  });

  it('requires confirmation to retire outside a TTY', async () => {
    await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = false;
    logSpy.mockClear();
    await runKnowledge(['retire', ID, '--scope', 'project', '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'confirmation_required' } });
  });

  it('reports a missing skill on show', async () => {
    await runKnowledge(['show', 'go-sql-row-locking', '--scope', 'project', '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('localizes the path error in Japanese', async () => {
    process.env.RASEN_LANG = 'ja';
    await runKnowledge(['apply', '--from', 'candidate.json']);
    const output = errSpy.mock.calls.flat().join('\n');
    expect(output).toContain('候補パスは絶対パスである必要があります');
    expect(output).not.toContain('must be absolute');
  });
});
