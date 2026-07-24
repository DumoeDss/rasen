import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { registerKnowledgeCommand } from '../../src/commands/knowledge.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { appendStoreReference } from '../../src/core/project-config.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { getStoreMetadataPath } from '../../src/core/store/foundation.js';
import {
  commitStoreRegistration,
  registerStore,
} from '../../src/core/store/registry.js';

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

describe('rasen knowledge command', () => {
  let tempHome: string;
  let projectRoot: string;
  let projectId: string;
  let projectHomeDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;
  let originalTTY: boolean | undefined;
  let originalExitCode: typeof process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  function projectCandidate(overrides: Record<string, unknown> = {}) {
    return {
      version: 1,
      operation: 'upsert',
      scope: 'project',
      id: ID,
      knowledgeKey: 'go-sql-tx-locking',
      description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
      applicability: { mode: 'all', markers: ['go.mod'] },
      evidence: [evidence(projectId)],
      ...overrides,
    };
  }

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
    return path.join(projectHomeDir, 'learned-skills');
  }

  async function createPromotionSources(): Promise<[string, string]> {
    const ids: string[] = [];
    for (const name of ['promotion-a', 'promotion-b']) {
      const root = path.join(tempHome, name);
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      fs.writeFileSync(path.join(root, 'go.mod'), `module ${name}\n`);
      const home = await resolveProjectHome(root, { globalDataDir: tempHome });
      ids.push(home!.projectId);
      await runKnowledge([
        'apply',
        '--from',
        writeCandidate(projectCandidate({ evidence: [evidence(home!.projectId)] })),
        '--project',
        home!.projectId,
        '--json',
      ]);
      process.exitCode = undefined;
    }
    logSpy.mockClear();
    errSpy.mockClear();
    return ids as [string, string];
  }

  async function createFrozenPointerFixture(name: string): Promise<{
    projectRoot: string;
    projectId: string;
    projectHome: string;
    storeRoot: string;
    storeId: string;
    runStateDir: string;
  }> {
    const storeId = `${name}-store`;
    const storeRoot = path.join(tempHome, `${name}-store-root`);
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    await registerStore({ id: storeId, localPath: storeRoot, globalDataDir: tempHome });

    const frozenProjectRoot = path.join(tempHome, `${name}-project`);
    fs.mkdirSync(path.join(frozenProjectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(frozenProjectRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nstore: ${storeId}\n`
    );
    fs.writeFileSync(path.join(frozenProjectRoot, 'go.mod'), 'module frozen\n');
    const home = await resolveProjectHome(frozenProjectRoot, { globalDataDir: tempHome });

    const runStateDir = path.join(tempHome, `${name}-run-state`);
    fs.mkdirSync(runStateDir, { recursive: true });
    fs.writeFileSync(
      path.join(runStateDir, 'auto-run.json'),
      `${JSON.stringify({
        pipeline: 'full-feature',
        knowledgeContext: {
          version: 1,
          planningRoot: { type: 'store', id: storeId },
          owner: { type: 'project', id: home!.projectId },
        },
      }, null, 2)}\n`
    );
    return {
      projectRoot: frozenProjectRoot,
      projectId: home!.projectId,
      projectHome: home!.homeDir,
      storeRoot,
      storeId,
      runStateDir,
    };
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
    const home = (await resolveProjectHome(projectRoot))!;
    projectId = home.projectId;
    projectHomeDir = home.homeDir;
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
    const [first, second] = await createPromotionSources();
    const globalCandidate = projectCandidate({
      operation: 'promote',
      scope: 'global',
      evidence: [evidence(first), evidence(second)],
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

  it('combines project and global records for default list/show reads', async () => {
    const [first, second] = await createPromotionSources();
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(
        projectCandidate({
          operation: 'promote',
          scope: 'global',
          evidence: [evidence(first), evidence(second)],
        })
      ),
      '--approve-global',
      '--json',
    ]);
    process.exitCode = undefined;
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(
        projectCandidate({
          id: 'project-only-routing',
          knowledgeKey: 'project-only-routing',
        })
      ),
      '--json',
    ]);

    logSpy.mockClear();
    await runKnowledge(['list', '--json']);
    expect(lastJson()).toMatchObject({
      context: { owner: { type: 'project', id: projectId } },
      learnedSkills: [
        {
          identity: {
            owner: { type: 'project', id: projectId },
            id: 'project-only-routing',
          },
        },
        { identity: { owner: { type: 'global' }, id: ID } },
      ],
    });

    logSpy.mockClear();
    await runKnowledge(['show', ID, '--json']);
    expect(lastJson()).toMatchObject({
      identity: { owner: { type: 'global' }, id: ID },
      context: { owner: { type: 'project', id: projectId } },
    });
  });

  it('honors an interactive global approval prompt (accept and decline)', async () => {
    const { confirm } = await promptMocks();
    const [first, second] = await createPromotionSources();
    const globalCandidate = projectCandidate({
      operation: 'promote',
      scope: 'global',
      evidence: [evidence(first), evidence(second)],
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
    const manifestPath = path.join(projectStoreDir(), ID, 'learned-skill.yaml');
    const manifestBeforeReads = fs.readFileSync(manifestPath);
    logSpy.mockClear();

    await runKnowledge(['list', '--scope', 'project', '--json']);
    expect(lastJson()).toMatchObject({ learnedSkills: [{ id: ID, scope: 'project', status: 'active' }] });

    logSpy.mockClear();
    await runKnowledge(['show', ID, '--scope', 'project', '--json']);
    expect(lastJson()).toMatchObject({ id: ID, status: 'active' });
    expect(fs.readFileSync(manifestPath)).toEqual(manifestBeforeReads);

    logSpy.mockClear();
    await runKnowledge(['retire', ID, '--scope', 'project', '--yes', '--json']);
    expect(lastJson()).toMatchObject({ ok: true, outcome: 'retired', id: ID });
  });

  it('resolves an explicit project owner independently from the planning root', async () => {
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate({ evidence: [evidence(projectId)] })),
      '--project',
      projectId,
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: true,
      context: {
        owner: { type: 'project', id: projectId },
        planningRoot: { type: 'project', id: projectId },
        source: 'explicit-project',
      },
    });
  });

  it('keeps the stable project owner across project-namespace registration and CLI reads', async () => {
    await commitStoreRegistration({
      id: 'friendly-project',
      type: 'project',
      backend: { type: 'git', local_path: projectRoot },
      writeMetadataIfMissing: true,
      globalDataDir: tempHome,
    });

    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate()),
      '--project',
      'friendly-project',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: true,
      context: {
        owner: { type: 'project', id: projectId },
        planningRoot: { type: 'project', id: projectId },
      },
    });

    logSpy.mockClear();
    await runKnowledge([
      'list',
      '--scope',
      'project',
      '--project',
      'friendly-project',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      context: { owner: { type: 'project', id: projectId } },
      learnedSkills: [{ id: ID }],
    });

    logSpy.mockClear();
    await runKnowledge([
      'show',
      ID,
      '--scope',
      'project',
      '--project',
      'friendly-project',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      id: ID,
      context: { owner: { type: 'project', id: projectId } },
    });
  });

  it('loads frozen retain identity without consulting a stale unrelated cwd', async () => {
    const frozen = await createFrozenPointerFixture('different-cwd');
    const unrelatedRoot = path.join(tempHome, 'unrelated-stale-store');
    fs.mkdirSync(path.join(unrelatedRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(unrelatedRoot, 'rasen', 'changes'), { recursive: true });
    fs.writeFileSync(
      path.join(unrelatedRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\n'
    );
    await registerStore({
      id: 'unrelated-stale',
      localPath: unrelatedRoot,
      globalDataDir: tempHome,
    });
    fs.rmSync(getStoreMetadataPath(unrelatedRoot), { force: true });
    process.chdir(unrelatedRoot);

    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate({ evidence: [evidence(frozen.projectId)] })),
      '--run-state-dir',
      frozen.runStateDir,
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: true,
      outcome: 'created',
      context: {
        owner: { type: 'project', id: frozen.projectId },
        planningRoot: { type: 'store', id: frozen.storeId },
        source: 'run-state',
      },
    });
    expect(
      fs.existsSync(path.join(frozen.projectHome, 'learned-skills', ID, 'SKILL.md'))
    ).toBe(true);
    expect(fs.existsSync(path.join(projectStoreDir(), ID))).toBe(false);
  });

  it('rejects selector drift against frozen retain identity through the CLI seam', async () => {
    const frozen = await createFrozenPointerFixture('selector-drift');

    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate({ evidence: [evidence(frozen.projectId)] })),
      '--run-state-dir',
      frozen.runStateDir,
      '--project',
      projectId,
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'knowledge_selector_conflict' },
    });
    expect(fs.existsSync(path.join(frozen.projectHome, 'learned-skills', ID))).toBe(false);
    expect(fs.existsSync(path.join(projectStoreDir(), ID))).toBe(false);
  });

  it('rejects stale frozen owner and planning-root identities through the CLI seam', async () => {
    const staleOwner = await createFrozenPointerFixture('stale-owner');
    fs.rmSync(staleOwner.projectRoot, { recursive: true, force: true });

    await runKnowledge([
      'list',
      '--scope',
      'project',
      '--run-state-dir',
      staleOwner.runStateDir,
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'knowledge_owner_stale' },
    });

    process.exitCode = undefined;
    logSpy.mockClear();
    const stalePlanning = await createFrozenPointerFixture('stale-planning');
    fs.rmSync(getStoreMetadataPath(stalePlanning.storeRoot), { force: true });

    await runKnowledge([
      'list',
      '--scope',
      'project',
      '--run-state-dir',
      stalePlanning.runStateDir,
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'knowledge_owner_stale' },
    });
  });

  it('rejects project/store selector conflicts before reading a candidate', async () => {
    const missing = path.join(tempHome, 'does-not-exist.json');
    await runKnowledge([
      'apply',
      '--from',
      missing,
      '--project',
      projectId,
      '--store',
      'team',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_selector_conflict',
        selectorGuidance: ['--project <id>', '--store <id>'],
      },
    });
    expect(fs.existsSync(projectStoreDir())).toBe(false);
  });

  it('rejects an owner selector on a global operation before approval', async () => {
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(
        projectCandidate({
          operation: 'promote',
          scope: 'global',
          evidence: [evidence('project-a'), evidence('project-b')],
        })
      ),
      '--project',
      projectId,
      '--approve-global',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'knowledge_owner_scope_mismatch' },
    });
    expect(fs.existsSync(path.join(tempHome, 'learned-skills', ID))).toBe(false);
  });

  it('lists only the explicitly selected store without creating a catalog', async () => {
    const storeRoot = path.join(tempHome, 'team-store');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: tempHome });

    await runKnowledge(['list', '--scope', 'store', '--store', 'team', '--json']);
    expect(lastJson()).toMatchObject({
      context: { owner: { type: 'store', id: 'team' } },
      learnedSkills: [],
    });
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'learned-skills'))).toBe(false);
  });

  it('applies, reads, rejects rename, and retires an explicitly selected store record', async () => {
    const sourceIds: string[] = [];
    const storeRoot = path.join(tempHome, 'team-store-lifecycle');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: tempHome });
    const canonicalStoreRoot = fs.realpathSync.native(storeRoot);

    for (const alias of ['member-a', 'member-b']) {
      const root = path.join(tempHome, alias);
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      fs.writeFileSync(path.join(root, 'go.mod'), `module ${alias}\n`);
      const home = (await resolveProjectHome(root, { globalDataDir: tempHome }))!;
      sourceIds.push(home.projectId);
      await commitStoreRegistration({
        id: alias,
        type: 'project',
        backend: { type: 'git', local_path: root },
        writeMetadataIfMissing: true,
        globalDataDir: tempHome,
      });
      appendStoreReference(storeRoot, alias, { type: 'project' });
      await runKnowledge([
        'apply',
        '--from',
        writeCandidate(projectCandidate({ evidence: [evidence(home.projectId)] })),
        '--project',
        alias,
        '--json',
      ]);
      process.exitCode = undefined;
    }
    logSpy.mockClear();
    errSpy.mockClear();

    const storeCandidate = writeCandidate({
      version: 2,
      operation: 'upsert',
      scope: 'store',
      owner: { type: 'store', id: 'team' },
      id: ID,
      knowledgeKey: 'go-sql-tx-locking',
      description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.',
      applicability: { mode: 'all', markers: ['go.mod'] },
      evidence: [],
      sources: sourceIds.map((id) => ({
        owner: { type: 'project', id },
        id: ID,
        knowledgeKey: 'go-sql-tx-locking',
      })),
    });

    await runKnowledge([
      'apply',
      '--from',
      storeCandidate,
      '--store',
      'team',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'store_approval_required' },
    });

    logSpy.mockClear();
    await runKnowledge([
      'apply',
      '--from',
      storeCandidate,
      '--store',
      'team',
      '--approve-global',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'consent_scope_mismatch' },
    });

    logSpy.mockClear();
    await runKnowledge([
      'apply',
      '--from',
      storeCandidate,
      '--store',
      'team',
      '--approve-store',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: true,
      outcome: 'created',
      identity: { owner: { type: 'store', id: 'team' }, id: ID },
      storeRoot: canonicalStoreRoot,
      changedFiles: [
        path.join(canonicalStoreRoot, 'rasen', 'learned-skills', ID, 'learned-skill.yaml'),
        path.join(canonicalStoreRoot, 'rasen', 'learned-skills', ID, 'SKILL.md'),
      ],
    });

    logSpy.mockClear();
    await runKnowledge(['list', '--scope', 'store', '--store', 'team', '--json']);
    expect(lastJson()).toMatchObject({
      learnedSkills: [
        { identity: { owner: { type: 'store', id: 'team' }, id: ID } },
      ],
    });

    const renamedId = 'go-sql-row-locking';
    logSpy.mockClear();
    await runKnowledge([
      'rename',
      ID,
      renamedId,
      '--scope',
      'store',
      '--store',
      'team',
      '--yes',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
    expect(
      fs.existsSync(path.join(storeRoot, 'rasen', 'learned-skills', ID))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(storeRoot, 'rasen', 'learned-skills', renamedId))
    ).toBe(false);

    logSpy.mockClear();
    await runKnowledge([
      'show',
      ID,
      '--scope',
      'store',
      '--store',
      'team',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      identity: { owner: { type: 'store', id: 'team' }, id: ID },
      status: 'active',
    });

    logSpy.mockClear();
    await runKnowledge([
      'retire',
      ID,
      '--scope',
      'store',
      '--store',
      'team',
      '--yes',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: true,
      outcome: 'retired',
      identity: { owner: { type: 'store', id: 'team' }, id: ID },
    });
  });

  it('prevents a known candidate project id from redirecting the selected owner', async () => {
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-knowledge-other-'));
    try {
      fs.mkdirSync(path.join(otherRoot, 'rasen'), { recursive: true });
      fs.writeFileSync(
        path.join(otherRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\n'
      );
      const otherId = (await resolveProjectHome(otherRoot, { globalDataDir: tempHome }))!.projectId;

      await runKnowledge([
        'apply',
        '--from',
        writeCandidate(projectCandidate({ evidence: [evidence(otherId)] })),
        '--project',
        projectId,
        '--json',
      ]);
      expect(lastJson()).toMatchObject({
        ok: false,
        block: { code: 'knowledge_candidate_owner_mismatch' },
      });
      expect(fs.existsSync(path.join(projectStoreDir(), ID))).toBe(false);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it('rejects an unregistered candidate project id that differs from the owner', async () => {
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate({ evidence: [evidence('not-registered-anywhere')] })),
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: false,
      block: { code: 'knowledge_candidate_owner_mismatch' },
    });
    expect(fs.existsSync(path.join(projectStoreDir(), ID))).toBe(false);
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
