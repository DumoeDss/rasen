import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { registerKnowledgeCommand } from '../../src/commands/knowledge.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { resolveProjectKnowledgeHome } from '../../src/core/project-knowledge-home.js';
import {
  getStoreMetadataPath,
  writeStoreMetadataState,
} from '../../src/core/store/foundation.js';
import { mintStoreUid } from '../../src/core/store/identity-types.js';
import { writeStoreProjectRecord } from '../../src/core/store/project-records.js';
import {
  commitStoreRegistration,
  registerStore,
} from '../../src/core/store/registry.js';
import {
  LEARNED_SKILL_BACKUP_PREFIX,
  LEARNED_SKILL_MANIFEST_FILE,
} from '../../src/core/learned-skills/index.js';

vi.mock('@inquirer/prompts', async () => {
  const actual = await vi.importActual<typeof import('@inquirer/prompts')>('@inquirer/prompts');
  return { ...actual, confirm: vi.fn() };
});

// --- B3 fault injection: same toggle as mutate.test.ts ---
const { backupFail } = vi.hoisted(() => ({ backupFail: { enabled: false } }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const { join } = await import('node:path');
  return {
    ...actual,
    rmSync: ((target: fs.PathLike, options?: fs.RmOptions) => {
      const p = typeof target === 'string' ? target : target.toString();
      if (
        backupFail.enabled &&
        options?.recursive &&
        p.includes(LEARNED_SKILL_BACKUP_PREFIX)
      ) {
        try {
          const entries = actual.readdirSync(p);
          const victim = entries.find((e) => e.name !== LEARNED_SKILL_MANIFEST_FILE);
          if (victim) {
            actual.rmSync(join(p, victim.name), { force: true });
          }
        } catch {
          // already damaged
        }
        const err: NodeJS.ErrnoException = new Error(
          'EBUSY: resource busy or locked (simulated partial delete)'
        );
        err.code = 'EBUSY';
        throw err;
      }
      return actual.rmSync(target, options);
    }) as typeof fs.rmSync,
  };
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

  /**
   * The project's CANONICAL catalog — keyed on its identity, not on this
   * clone's machine home, so two clones share it.
   */
  function projectStoreDir(): string {
    return resolveProjectKnowledgeHome(projectId).catalogDir;
  }

  /**
   * Two projects that each own the record a global promotion names. Promotion
   * resolves EXACT managed records, so a projectId in an evidence array is a
   * claim the gate then goes and verifies.
   */
  async function createPromotionSources(): Promise<[string, string]> {
    const ids: string[] = [];
    for (const name of ['promotion-a', 'promotion-b']) {
      const root = path.join(tempHome, name);
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      fs.writeFileSync(path.join(root, 'go.mod'), `module ${name}\n`);
      const home = (await resolveProjectHome(root, { globalDataDir: tempHome }))!;
      ids.push(home.projectId);
      await runKnowledge([
        'apply',
        '--from',
        writeCandidate(projectCandidate({ evidence: [evidence(home.projectId)] })),
        '--project',
        home.projectId,
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
    tempHome = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-knowledge-home-'))
    );
    projectRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-knowledge-proj-'))
    );
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

  /**
   * Content-digest verification on read is right, but a check that removes a
   * record without saying so is indistinguishable from a deletion. These drive
   * the reporting through the COMMAND, not the loader: the loader computed the
   * reason correctly before this and the surface threw it away, which is the
   * exact shape of the defect that shipped one child earlier.
   */
  describe('a record that fails verification is reported, not dropped', () => {
    /** Hand-edits SKILL.md the way a user fixing a typo would. */
    function handEditBody(): string {
      const contentPath = path.join(projectStoreDir(), ID, 'SKILL.md');
      fs.writeFileSync(contentPath, `${fs.readFileSync(contentPath, 'utf-8')}\nA typo fix.\n`);
      return contentPath;
    }

    it('names the record, the failed check and the way back, in human and JSON alike', async () => {
      await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
      const contentPath = handEditBody();
      const before = fs.readFileSync(path.join(projectStoreDir(), ID, 'learned-skill.yaml'));
      logSpy.mockClear();

      await runKnowledge(['list', '--scope', 'project', '--json']);
      const payload = lastJson() as {
        learnedSkills: Array<{ id: string }>;
        unreadable: Array<{ id: string; scope: string; directory: string; reason: string }>;
      };
      // Gone from the valid list — that part was already true and is correct.
      expect(payload.learnedSkills.map((entry) => entry.id)).not.toContain(ID);
      // …but no longer gone WITHOUT EXPLANATION.
      expect(payload.unreadable).toHaveLength(1);
      expect(payload.unreadable[0]).toMatchObject({ id: ID, scope: 'project' });
      expect(payload.unreadable[0]!.reason).toContain('content digest');

      logSpy.mockClear();
      await runKnowledge(['list', '--scope', 'project']);
      const human = logSpy.mock.calls.flat().join('\n');
      expect(human).toContain(ID);
      // Human and JSON name the same reason and the human carries the repair.
      expect(human).toContain(payload.unreadable[0]!.reason);
      expect(human).toContain('rasen knowledge apply');

      // Diagnosis writes nothing.
      expect(fs.readFileSync(path.join(projectStoreDir(), ID, 'learned-skill.yaml'))).toEqual(before);
      expect(fs.readFileSync(contentPath, 'utf-8')).toContain('A typo fix.');
    });

    it('tells `show` the record exists and cannot be read, rather than that it does not exist', async () => {
      await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
      handEditBody();
      logSpy.mockClear();
      errSpy.mockClear();

      await runKnowledge(['show', ID, '--scope', 'project', '--json']);
      expect(lastJson()).toMatchObject({
        ok: false,
        error: { code: 'unreadable_record' },
      });
      const error = (lastJson() as { error: { message: string; next: string } }).error;
      expect(error.message).toContain(ID);
      expect(error.message).toContain('content digest');
      expect(error.next).toContain('rasen knowledge apply');
      process.exitCode = undefined;
    });

    /**
     * Direction A: a record whose manifest this version's strict schema will
     * not accept, but whose Rasen marker is intact, is still Rasen's — the
     * marker is readable at the schema-failure branch, where ownership used to
     * be discarded. The version case needs no user error at all: it is a
     * record written by a NEWER release, read back on this one, which is the
     * cross-version Store sharing this catalog exists for.
     */
    it.each([
      [
        'a record written by a newer release',
        (manifest: Record<string, unknown>) => ({ ...manifest, version: 3 }),
      ],
      [
        'a key added to the manifest by hand',
        (manifest: Record<string, unknown>) => ({ ...manifest, note: 'annotated by hand' }),
      ],
      [
        'a field retyped by hand',
        (manifest: Record<string, unknown>) => ({ ...manifest, description: 42 }),
      ],
    ])('reports %s rather than dropping it', async (_label, mutate) => {
      await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
      const manifestPath = path.join(projectStoreDir(), ID, 'learned-skill.yaml');
      const manifest = parseYaml(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      const rewritten = mutate(manifest);
      // The marker survives every one of these — that is the whole point.
      expect(rewritten.generatedBy).toBe(manifest.generatedBy);
      fs.writeFileSync(manifestPath, stringifyYaml(rewritten), 'utf-8');
      logSpy.mockClear();

      await runKnowledge(['list', '--scope', 'project', '--json']);
      const payload = lastJson() as {
        learnedSkills: Array<{ id: string }>;
        unreadable: Array<{ id: string; reason: string }>;
      };
      expect(payload.learnedSkills.map((entry) => entry.id)).not.toContain(ID);
      expect(payload.unreadable).toHaveLength(1);
      expect(payload.unreadable[0]).toMatchObject({ id: ID });
      expect(payload.unreadable[0]!.reason).toContain("carries Rasen's marker");

      logSpy.mockClear();
      errSpy.mockClear();
      await runKnowledge(['show', ID, '--scope', 'project', '--json']);
      expect(lastJson()).toMatchObject({ ok: false, error: { code: 'unreadable_record' } });
      process.exitCode = undefined;
    });

    it('still says nothing when the same manifest carries another tool s marker', async () => {
      await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
      const manifestPath = path.join(projectStoreDir(), ID, 'learned-skill.yaml');
      const manifest = parseYaml(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      // Schema-invalid AND not ours: ownership is somebody else's claim, so
      // reporting it would be the false positive the marker line prevents.
      fs.writeFileSync(
        manifestPath,
        stringifyYaml({ ...manifest, version: 3, generatedBy: 'some-other-tool' }),
        'utf-8'
      );
      logSpy.mockClear();

      await runKnowledge(['list', '--scope', 'project', '--json']);
      expect(lastJson()).toMatchObject({ learnedSkills: [], unreadable: [] });
    });

    it('says nothing about occupants the catalog never owned', async () => {
      await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
      // A skill the user wrote by hand, living in the same catalog. The spec
      // guarantees these are untouched; warning about each one would bury the
      // record that actually went missing.
      const authored = path.join(projectStoreDir(), 'my-own-notes');
      fs.mkdirSync(authored, { recursive: true });
      fs.writeFileSync(path.join(authored, 'SKILL.md'), '# Mine\n');
      logSpy.mockClear();

      await runKnowledge(['list', '--scope', 'project', '--json']);
      const payload = lastJson() as {
        learnedSkills: Array<{ id: string }>;
        unreadable: unknown[];
      };
      expect(payload.learnedSkills.map((entry) => entry.id)).toEqual([ID]);
      expect(payload.unreadable).toEqual([]);
      expect(fs.readFileSync(path.join(authored, 'SKILL.md'), 'utf-8')).toBe('# Mine\n');
    });
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
    // The record lands in the FROZEN project's canonical knowledge home, which
    // is keyed on that project's identity — not in the clone the command ran in
    // and not in the unrelated project the cwd points at.
    expect(
      fs.existsSync(
        path.join(resolveProjectKnowledgeHome(frozen.projectId).catalogDir, ID, 'SKILL.md')
      )
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

  it('reads an explicitly selected store without creating its catalog', async () => {
    const storeRoot = path.join(tempHome, 'team-store');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    await registerStore({ id: 'team', localPath: storeRoot, globalDataDir: tempHome });

    // A store selector on a PROJECT-scoped read is still refused: the two
    // scopes never satisfy one another.
    await runKnowledge(['list', '--scope', 'project', '--store', 'team', '--json']);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: {
        code: 'knowledge_owner_scope_mismatch',
        owner: { type: 'store', id: 'team' },
      },
    });

    logSpy.mockClear();
    process.exitCode = undefined;
    await runKnowledge(['list', '--scope', 'store', '--store', 'team', '--json']);
    expect(lastJson()).toMatchObject({
      context: { owner: { type: 'store', id: 'team' } },
      learnedSkills: [],
    });
    // Reading a catalog never brings one into existence.
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'learned-skills'))).toBe(false);
  });

  /** A Store with a permanent identity and two knowledge members that codified the record. */
  async function createStoreWithMembers(name: string): Promise<{
    storeRoot: string;
    storeUid: string;
    members: string[];
  }> {
    const storeRoot = path.join(tempHome, name);
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const storeUid = mintStoreUid();
    await writeStoreMetadataState(storeRoot, { version: 2, uid: storeUid, id: name });
    await registerStore({ id: name, localPath: storeRoot, globalDataDir: tempHome });

    const members: string[] = [];
    for (const memberName of [`${name}-member-a`, `${name}-member-b`]) {
      const root = path.join(tempHome, memberName);
      fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
      fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      fs.writeFileSync(path.join(root, 'go.mod'), `module ${memberName}\n`);
      const home = (await resolveProjectHome(root, { globalDataDir: tempHome }))!;
      members.push(home.projectId);
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: home.projectId,
        roles: { planning: false, knowledge: true },
      });
      await runKnowledge([
        'apply',
        '--from',
        writeCandidate(projectCandidate({ evidence: [evidence(home.projectId)] })),
        '--project',
        home.projectId,
        '--json',
      ]);
      process.exitCode = undefined;
    }
    logSpy.mockClear();
    errSpy.mockClear();
    return { storeRoot, storeUid, members };
  }

  function storeCandidate(
    storeUid: string,
    storeId: string,
    sourceProjectIds: string[]
  ): Record<string, unknown> {
    return {
      version: 2,
      operation: 'upsert',
      scope: 'store',
      owner: { type: 'store', uid: storeUid, id: storeId },
      id: ID,
      knowledgeKey: 'go-sql-tx-locking',
      description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
      applicability: { mode: 'all', markers: ['go.mod'] },
      evidence: [],
      sources: sourceProjectIds.map((id) => ({
        owner: { type: 'project', projectId: id },
        id: ID,
        knowledgeKey: 'go-sql-tx-locking',
      })),
    };
  }

  it('publishes into a store on an approval that names it, and reports what to commit', async () => {
    const { storeRoot, storeUid, members } = await createStoreWithMembers('team');
    const candidate = writeCandidate(storeCandidate(storeUid, 'team', members));

    await runKnowledge([
      'apply',
      '--from',
      candidate,
      '--store',
      storeUid,
      '--approve-store',
      'team',
      '--json',
    ]);
    expect(lastJson()).toMatchObject({
      ok: true,
      outcome: 'created',
      scope: 'store',
      identity: { owner: { type: 'store', uid: storeUid, id: 'team' }, id: ID },
      storeRoot,
      changedFiles: [
        path.join(storeRoot, 'rasen', 'learned-skills', ID, 'learned-skill.yaml'),
        path.join(storeRoot, 'rasen', 'learned-skills', ID, 'SKILL.md'),
      ],
    });
    // The permanent identity is what landed on disk.
    expect(
      fs.readFileSync(path.join(storeRoot, 'rasen', 'learned-skills', ID, 'learned-skill.yaml'), 'utf-8')
    ).toContain(`uid: ${storeUid}`);
  });

  it('refuses an approval that names a different store', async () => {
    const { storeRoot, storeUid, members } = await createStoreWithMembers('team');
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(storeCandidate(storeUid, 'team', members)),
      '--store',
      storeUid,
      '--approve-store',
      'some-other-store',
      '--json',
    ]);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'store_approval_scope_mismatch' },
    });
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'learned-skills'))).toBe(false);
  });

  it('reports the same refusal facts and the same next command in human and JSON output', async () => {
    const { storeRoot, storeUid, members } = await createStoreWithMembers('team');
    // A third project contributes evidence the store has no membership record for.
    const outsiderRoot = path.join(tempHome, 'outsider');
    fs.mkdirSync(path.join(outsiderRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(outsiderRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.writeFileSync(path.join(outsiderRoot, 'go.mod'), 'module outsider\n');
    const outsider = (await resolveProjectHome(outsiderRoot, { globalDataDir: tempHome }))!.projectId;
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate({ evidence: [evidence(outsider)] })),
      '--project',
      outsider,
      '--json',
    ]);
    process.exitCode = undefined;
    logSpy.mockClear();
    errSpy.mockClear();

    const candidate = writeCandidate(
      storeCandidate(storeUid, 'team', [members[0], outsider])
    );

    await runKnowledge(['apply', '--from', candidate, '--store', storeUid, '--json']);
    const wire = lastJson() as { block?: { code?: string; message?: string; repair?: string[] } };
    expect(wire.block?.code).toBe('store_membership_invalid');
    const repair = wire.block?.repair?.[0] as string;
    expect(repair).toContain('rasen store add-project');

    logSpy.mockClear();
    errSpy.mockClear();
    process.exitCode = undefined;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = false;
    await runKnowledge(['apply', '--from', candidate, '--store', storeUid]);
    const human = errSpy.mock.calls.flat().join('\n');
    // Same facts, same copy-pasteable next command.
    expect(human).toContain(wire.block!.message as string);
    expect(human).toContain(repair);
    expect(human).toContain(outsider);
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'learned-skills'))).toBe(false);
  });

  it('prevents a known candidate project id from redirecting the selected owner', async () => {
    const otherRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-knowledge-other-'))
    );
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

  describe('effective and migrate', () => {
    it('reports the resolved set, its roots, and its sources by permanent identity', async () => {
      await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
      logSpy.mockClear();
      process.exitCode = undefined;

      await runKnowledge(['effective', '--json']);

      expect(lastJson()).toMatchObject({
        ok: true,
        status: 'ready',
        project: { id: projectId },
        roots: {
          canonicalOwnerRoot: resolveProjectKnowledgeHome(projectId).root,
          evaluationRoot: projectRoot,
        },
        skills: [
          {
            id: ID,
            effectiveScope: 'project',
            sources: [{ owner: { type: 'project', projectId }, id: ID }],
          },
        ],
      });
    });

    it('writes nothing at all — it is a read', async () => {
      await runKnowledge(['apply', '--from', writeCandidate(projectCandidate()), '--json']);
      const before = fs.readFileSync(
        path.join(projectStoreDir(), ID, 'learned-skill.yaml')
      );
      logSpy.mockClear();

      await runKnowledge(['effective', '--json']);

      expect(fs.readFileSync(path.join(projectStoreDir(), ID, 'learned-skill.yaml'))).toEqual(
        before
      );
      expect(fs.existsSync(path.join(projectRoot, '.claude'))).toBe(false);
    });

    it('previews both migrations and changes nothing', async () => {
      // A catalog left in this clone's OLD per-clone location.
      const legacy = path.join(projectHomeDir, 'learned-skills', ID);
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(path.join(legacy, 'SKILL.md'), 'legacy body\n');
      logSpy.mockClear();

      await runKnowledge(['migrate', '--dry-run', '--json']);

      expect(lastJson()).toMatchObject({
        ok: true,
        dryRun: true,
        catalog: { dryRun: true, moved: [], moves: [{ id: ID }] },
        ledger: { status: 'nothing-to-do' },
      });
      expect(fs.existsSync(legacy)).toBe(true);
      expect(fs.existsSync(path.join(projectStoreDir(), ID))).toBe(false);
    });

    it('applies the catalog move and reports there is nothing left on a second run', async () => {
      const legacy = path.join(projectHomeDir, 'learned-skills', ID);
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(path.join(legacy, 'SKILL.md'), 'legacy body\n');

      await runKnowledge(['migrate', '--json']);
      expect(lastJson()).toMatchObject({ ok: true, catalog: { moved: [ID] } });
      expect(fs.existsSync(path.join(projectStoreDir(), ID, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(legacy)).toBe(false);

      logSpy.mockClear();
      await runKnowledge(['migrate', '--json']);
      expect(lastJson()).toMatchObject({ catalog: { status: 'nothing-to-do' } });
    });
  });

  // --- B3: degraded signal reaches CLI output (JSON + human) ---

  it('surfaces the degraded warning in JSON output when backup cleanup fails', async () => {
    const candidate = writeCandidate(projectCandidate());
    await runKnowledge(['apply', '--from', candidate, '--project', projectId, '--json']);
    expect(lastJson()).toMatchObject({ ok: true, outcome: 'created' });

    // Rewrite with a different evidence chain + backup-cleanup failure.
    const rewriteCandidate = writeCandidate(
      projectCandidate({ evidence: [evidence(projectId, 'degraded-output-change')] })
    );
    backupFail.enabled = true;
    try {
      await runKnowledge(['apply', '--from', rewriteCandidate, '--project', projectId, '--json']);
    } finally {
      backupFail.enabled = false;
    }

    const json = lastJson() as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.outcome).toBe('rewritten');
    expect(json.degraded).toBeDefined();
    expect(String(json.degraded)).toContain('debris');
  });

  it('surfaces the degraded warning in human output when backup cleanup fails', async () => {
    const candidate = writeCandidate(projectCandidate());
    await runKnowledge(['apply', '--from', candidate, '--project', projectId]);
    logSpy.mockClear();
    errSpy.mockClear();

    // Rewrite with a different evidence chain + backup-cleanup failure.
    const rewriteCandidate = writeCandidate(
      projectCandidate({ evidence: [evidence(projectId, 'degraded-human-change')] })
    );
    backupFail.enabled = true;
    try {
      await runKnowledge(['apply', '--from', rewriteCandidate, '--project', projectId]);
    } finally {
      backupFail.enabled = false;
    }

    // The degraded warning is printed to stderr.
    const errOutput = errSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(errOutput).toContain('Degraded:');
    expect(errOutput).toContain('debris');
  });
});
