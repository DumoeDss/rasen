import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { registerKnowledgeCommand } from '../../src/commands/knowledge.js';
import { PipelineCommand } from '../../src/commands/pipeline.js';
import { registerRetainCommand } from '../../src/commands/retain.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { resolveProjectKnowledgeHome } from '../../src/core/project-knowledge-home.js';
import { writeStoreMetadataState } from '../../src/core/store/foundation.js';
import { mintStoreUid } from '../../src/core/store/identity-types.js';
import { writeStoreProjectRecord } from '../../src/core/store/project-records.js';
import { registerStore } from '../../src/core/store/registry.js';
import { RUN_STATE_FILENAME } from '../../src/core/pipeline-registry/index.js';

const CHANGE = 'retain-me';
const DIGEST = `sha256:${'c'.repeat(64)}`;
const SKILL_ID = 'go-sql-transaction-locking';

/**
 * `rasen retain prepare` — the single Rasen-owned transition from "standalone
 * retention resolved a mode" to "project knowledge operations have a frozen
 * identity". These tests are the report's regression matrix.
 */
describe('rasen retain prepare', () => {
  let tempHome: string;
  let projectRoot: string;
  let projectId: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  async function runRetain(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerRetainCommand(program);
    await program.parseAsync(['node', 'rasen', 'retain', ...args]);
  }

  async function runKnowledge(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerKnowledgeCommand(program);
    await program.parseAsync(['node', 'rasen', 'knowledge', ...args]);
  }

  /** The last JSON document written to stdout. */
  function lastJson<T = Record<string, unknown>>(): T {
    const calls = logSpy.mock.calls.map(([value]) => String(value));
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(calls[index]) as T;
      } catch {
        // not JSON; keep scanning back
      }
    }
    throw new Error('no JSON document was written to stdout');
  }

  function createChange(root: string, name = CHANGE): string {
    const dir = path.join(root, 'rasen', 'changes', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '## Why\nBecause.\n', 'utf-8');
    return dir;
  }

  function writeCandidate(candidate: unknown): string {
    const file = path.join(tempHome, `candidate-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(candidate), 'utf-8');
    return file;
  }

  function projectCandidate(ownerProjectId: string): Record<string, unknown> {
    return {
      version: 1,
      operation: 'upsert',
      scope: 'project',
      id: SKILL_ID,
      knowledgeKey: 'go-sql-tx-locking',
      description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
      applicability: { mode: 'all', markers: ['go.mod'] },
      evidence: [{ projectId: ownerProjectId, change: CHANGE, artifact: 'proposal', digest: DIGEST }],
    };
  }

  beforeEach(async () => {
    tempHome = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-retain-home-'))
    );
    projectRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-retain-proj-'))
    );
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;

    process.env.RASEN_HOME = tempHome;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    process.env.RASEN_LANG = 'en';

    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.writeFileSync(path.join(projectRoot, 'go.mod'), 'module example\n');
    projectId = (await resolveProjectHome(projectRoot))!.projectId;

    // `codify` is the only mode that READS a frozen knowledge context, so it is
    // the only mode preparation writes one for. The default fixture therefore
    // stores it explicitly: every test below that exercises freezing needs the
    // write open. The profile-derived modes (`full` → report, `core` → off) and
    // the gate they close have their own tests.
    saveGlobalConfig({ featureFlags: {}, profile: 'full', retention: 'codify' });

    process.chdir(projectRoot);
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.clearAllMocks();
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('freezes a durable context for a change with no run-state and reports where it lives', async () => {
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);

    const result = lastJson<{
      ok: boolean;
      change: string;
      retention: string;
      runStateDir: string;
      runStatePath: string;
      pipeline: null;
      contextSource: string;
      knowledgeContext: { version: number; owner: { type: string; projectId?: string } };
    }>();
    expect(process.exitCode).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.change).toBe(CHANGE);
    expect(result.pipeline).toBeNull();
    expect(result.contextSource).toBe('prepared');
    expect(result.knowledgeContext.version).toBe(3);
    expect(result.knowledgeContext.owner).toEqual({ type: 'project', projectId, id: projectId });
    // The deterministic ephemera location, composed platform-neutrally.
    expect(result.runStateDir).toBe(
      path.join(projectRoot, '.rasen', 'changes', CHANGE, 'ephemera')
    );
    expect(result.runStatePath).toBe(path.join(result.runStateDir, RUN_STATE_FILENAME));
    expect(fs.existsSync(result.runStatePath)).toBe(true);
  });

  // The report's resolution option 1 and option 2 must name the SAME place: the
  // directory `pipeline resume` points at before any state exists is where
  // preparation then writes it.
  it('writes to the directory pipeline resume reported before any state existed', async () => {
    createChange(projectRoot);
    await new PipelineCommand().resume(CHANGE, { json: true });
    const resumed = lastJson<{ hasRunState: boolean; runStateDir: string }>();
    expect(resumed.hasRunState).toBe(false);

    logSpy.mockClear();
    await runRetain(['prepare', CHANGE, '--json']);
    const prepared = lastJson<{ runStateDir: string; runStatePath: string }>();
    expect(prepared.runStateDir).toBe(resumed.runStateDir);
    expect(fs.existsSync(prepared.runStatePath)).toBe(true);

    // And resume now reports it as present, with no pipeline claimed.
    logSpy.mockClear();
    await new PipelineCommand().resume(CHANGE, { json: true });
    const after = lastJson<{ hasRunState: boolean; pipeline: null; runStateDir: string }>();
    expect(after.hasRunState).toBe(true);
    expect(after.pipeline).toBeNull();
    expect(after.runStateDir).toBe(prepared.runStateDir);
  });

  it('reports the effective profile retention rather than only a stored value', async () => {
    // The exact configuration the report showed `config get retention` answering
    // nothing for: the `full` profile with NO stored `retention` key.
    saveGlobalConfig({ featureFlags: {}, profile: 'full' });
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);
    // `full` supplies `report` with no `retention` key stored anywhere.
    expect(lastJson<{ retention: string }>().retention).toBe('report');

    saveGlobalConfig({ featureFlags: {}, profile: 'custom', workflows: ['apply'], retention: 'codify' });
    logSpy.mockClear();
    await runRetain(['prepare', CHANGE, '--json']);
    expect(lastJson<{ retention: string }>().retention).toBe('codify');
  });

  // Freezing is a WRITE and only the codify branch reads what it writes, so
  // under any other mode preparation has to be inert: `off` is documented as a
  // successful no-op that changes no learning state, and a change that never ran
  // a pipeline must not be left holding run-state no run produced — `pipeline
  // resume` and the board both report such a file as a run, and a context frozen
  // now is authoritative forever at the version of the day it was written.
  it.each([
    { profile: 'full', mode: 'report' },
    { profile: 'core', mode: 'off' },
  ])('records nothing under the effective $mode mode', async ({ profile, mode }) => {
    saveGlobalConfig({ featureFlags: {}, profile });
    createChange(projectRoot);

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBeUndefined();
    const result = lastJson<{
      ok: boolean;
      retention: string;
      contextSource: string;
      runStateDir: string;
      runStatePath: string;
      knowledgeContext?: unknown;
      owner?: string;
      planningRoot?: string;
    }>();
    expect(result.ok).toBe(true);
    expect(result.retention).toBe(mode);
    expect(result.contextSource).toBe('skipped');
    // Nothing was resolved, so nothing is reported as resolved.
    expect(result.knowledgeContext).toBeUndefined();
    expect(result.owner).toBeUndefined();
    expect(result.planningRoot).toBeUndefined();
    // The location is still reported (design D2) — as where durable state WOULD
    // live, which is not a claim that anything lives there.
    expect(result.runStateDir).toBe(
      path.join(projectRoot, '.rasen', 'changes', CHANGE, 'ephemera')
    );
    expect(fs.existsSync(result.runStatePath)).toBe(false);
    expect(fs.existsSync(result.runStateDir)).toBe(false);

    // The human surface says so too, and offers no apply guidance for an
    // identity it did not freeze.
    logSpy.mockClear();
    await runRetain(['prepare', CHANGE]);
    const printed = logSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(printed).toContain(mode);
    expect(printed).not.toContain('--run-state-dir');
    expect(printed).not.toContain('{');

    // And the change still reads as a change that never ran.
    logSpy.mockClear();
    await new PipelineCommand().resume(CHANGE, { json: true });
    expect(lastJson<{ hasRunState: boolean }>().hasRunState).toBe(false);
  });

  // A worker dispatched for a canonical `retain` stage uses the mode the LEAD
  // froze rather than the current profile, and preparation cannot tell that
  // caller from a standalone one — so either mode being `codify` has to open the
  // write. This is the arm the effective mode alone would have closed.
  it('freezes identity when run-state froze codify and the effective mode is off', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'core' });
    const changeDir = createChange(projectRoot);
    fs.writeFileSync(
      path.join(changeDir, RUN_STATE_FILENAME),
      `${JSON.stringify({ pipeline: 'full-feature', retention: 'codify' }, null, 2)}\n`,
      'utf-8'
    );

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBeUndefined();
    const result = lastJson<{
      retention: string;
      frozenRetention: string;
      contextSource: string;
      knowledgeContext: { version: number };
    }>();
    expect(result.retention).toBe('off');
    expect(result.frozenRetention).toBe('codify');
    expect(result.contextSource).toBe('prepared');
    expect(result.knowledgeContext.version).toBe(3);

    const record = JSON.parse(
      fs.readFileSync(path.join(changeDir, RUN_STATE_FILENAME), 'utf-8')
    ) as Record<string, unknown>;
    expect(record.knowledgeContext).toMatchObject({ version: 3 });
    // The LEAD stays the sole writer of the frozen mode.
    expect(record.retention).toBe('codify');
  });

  // The mirror arm: the effective mode codifies while run-state froze something
  // else. The write must still open, because a standalone invocation uses the
  // effective mode.
  it('freezes identity when the effective mode codifies and run-state froze report', async () => {
    const changeDir = createChange(projectRoot);
    fs.writeFileSync(
      path.join(changeDir, RUN_STATE_FILENAME),
      `${JSON.stringify({ pipeline: 'full-feature', retention: 'report' }, null, 2)}\n`,
      'utf-8'
    );

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBeUndefined();
    const result = lastJson<{ retention: string; frozenRetention: string; contextSource: string }>();
    expect(result.retention).toBe('codify');
    expect(result.frozenRetention).toBe('report');
    expect(result.contextSource).toBe('prepared');
    expect(
      (
        JSON.parse(
          fs.readFileSync(path.join(changeDir, RUN_STATE_FILENAME), 'utf-8')
        ) as Record<string, unknown>
      ).knowledgeContext
    ).toMatchObject({ version: 3 });
  });

  it('records durable identity only — no absolute planning or owner root', async () => {
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);
    const { runStatePath } = lastJson<{ runStatePath: string }>();

    const raw = fs.readFileSync(runStatePath, 'utf-8');
    expect(raw).not.toContain(projectRoot);
    expect(raw).not.toContain(tempHome);
    const record = JSON.parse(raw) as { knowledgeContext: Record<string, unknown> };
    // No value anywhere in the frozen record is a filesystem location, so the
    // record stays valid read from another machine or checkout.
    const absolutes: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        if (path.isAbsolute(value)) absolutes.push(value);
        return;
      }
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(record.knowledgeContext);
    expect(absolutes).toEqual([]);
    expect(record.knowledgeContext).toEqual({
      version: 3,
      planningRoot: { type: 'project', projectId, id: projectId },
      owner: { type: 'project', projectId, id: projectId },
    });
  });

  // The positive half of the durable-identity requirement: the previous test
  // proves no absolute root is written, this one proves the record is still
  // resolvable when the checkout it was prepared in lives somewhere else. The
  // whole record travels with the checkout, so the move is the real scenario —
  // a path-derived identity would leave the planning root resolving to the old
  // absolute location and the command refusing with a root mismatch.
  it('resolves the recorded identity after the checkout moves to another absolute path', async () => {
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);
    const before = lastJson<{
      contextSource: string;
      knowledgeContext: unknown;
      owner: string;
      planningRoot: string;
      runStatePath: string;
    }>();
    expect(before.contextSource).toBe('prepared');
    const recorded = fs.readFileSync(before.runStatePath, 'utf-8');

    // Release the working directory first: a directory that is the process cwd
    // cannot be renamed on Windows.
    const movedRoot = `${projectRoot}-moved`;
    process.chdir(originalCwd);
    fs.renameSync(projectRoot, movedRoot);
    try {
      process.chdir(movedRoot);
      logSpy.mockClear();
      await runRetain(['prepare', CHANGE, '--json']);

      // No refusal: the identity on record resolves from the new location.
      expect(process.exitCode).toBeUndefined();
      const after = lastJson<{
        contextSource: string;
        knowledgeContext: unknown;
        owner: string;
        planningRoot: string;
        runStateDir: string;
        runStatePath: string;
      }>();
      expect(after.contextSource).toBe('recorded');
      // The same planning root and the same owner, by identity.
      expect(after.knowledgeContext).toEqual(before.knowledgeContext);
      expect(after.owner).toBe(before.owner);
      expect(after.planningRoot).toBe(before.planningRoot);
      // Reported at the checkout's new location, and untouched on disk.
      expect(after.runStateDir).toBe(
        path.join(movedRoot, '.rasen', 'changes', CHANGE, 'ephemera')
      );
      expect(after.runStatePath).toBe(path.join(after.runStateDir, RUN_STATE_FILENAME));
      expect(fs.readFileSync(after.runStatePath, 'utf-8')).toBe(recorded);
    } finally {
      // Back under `projectRoot` so the suite's own cleanup reaches it.
      process.chdir(originalCwd);
      fs.renameSync(movedRoot, projectRoot);
    }
  });

  it('is idempotent: a repeated run reuses the record and writes nothing new', async () => {
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);
    const first = lastJson<{ runStatePath: string; knowledgeContext: unknown }>();
    const before = fs.readFileSync(first.runStatePath, 'utf-8');

    logSpy.mockClear();
    await runRetain(['prepare', CHANGE, '--json']);
    const second = lastJson<{
      runStateDir: string;
      contextSource: string;
      knowledgeContext: unknown;
    }>();
    expect(second.contextSource).toBe('recorded');
    expect(second.knowledgeContext).toEqual(first.knowledgeContext);
    expect(second.runStateDir).toBe(path.dirname(first.runStatePath));
    expect(fs.readFileSync(first.runStatePath, 'utf-8')).toBe(before);
  });

  it('reports an existing pipeline run-state unchanged, at any context version', async () => {
    const changeDir = createChange(projectRoot);
    for (const version of [1, 2, 3] as const) {
      const recorded =
        version === 3
          ? {
              version: 3,
              planningRoot: { type: 'project', projectId },
              owner: { type: 'project', projectId },
            }
          : version === 2
            ? {
                version: 2,
                planningRoot: { type: 'project', id: projectId },
                owner: { type: 'project', id: projectId },
                execution: { kind: 'planning-only' },
              }
            : {
                version: 1,
                planningRoot: { type: 'project', id: projectId },
                owner: { type: 'project', id: projectId },
              };
      const before = `${JSON.stringify(
        { pipeline: 'full-feature', retention: 'report', knowledgeContext: recorded },
        null,
        2
      )}\n`;
      fs.writeFileSync(path.join(changeDir, RUN_STATE_FILENAME), before, 'utf-8');

      logSpy.mockClear();
      await runRetain(['prepare', CHANGE, '--json']);
      const result = lastJson<{
        contextSource: string;
        pipeline: string;
        frozenRetention: string;
        runStateDir: string;
        knowledgeContext: unknown;
      }>();
      expect(result.contextSource).toBe('recorded');
      expect(result.pipeline).toBe('full-feature');
      expect(result.frozenRetention).toBe('report');
      expect(result.knowledgeContext).toEqual(recorded);
      // Sticky-legacy: the record keeps living where it already lives.
      expect(result.runStateDir).toBe(changeDir);
      // Byte-identical — never upgraded in place.
      expect(fs.readFileSync(path.join(changeDir, RUN_STATE_FILENAME), 'utf-8')).toBe(before);
    }
  });

  it('adds a context to an existing pipeline run-state without rewriting the rest', async () => {
    const changeDir = createChange(projectRoot);
    fs.writeFileSync(
      path.join(changeDir, RUN_STATE_FILENAME),
      `${JSON.stringify(
        {
          pipeline: 'full-feature',
          stages: { apply: { status: 'done' } },
          leadNote: 'hand-written by the LEAD',
        },
        null,
        2
      )}\n`,
      'utf-8'
    );

    await runRetain(['prepare', CHANGE, '--json']);
    expect(lastJson<{ contextSource: string }>().contextSource).toBe('prepared');

    const record = JSON.parse(
      fs.readFileSync(path.join(changeDir, RUN_STATE_FILENAME), 'utf-8')
    ) as Record<string, unknown>;
    expect(record.pipeline).toBe('full-feature');
    expect(record.stages).toEqual({ apply: { status: 'done' } });
    expect(record.leadNote).toBe('hand-written by the LEAD');
    expect(record.knowledgeContext).toMatchObject({ version: 3 });
  });

  it('refuses an unreadable run-state instead of overwriting it', async () => {
    const changeDir = createChange(projectRoot);
    const before = '{ not json';
    fs.writeFileSync(path.join(changeDir, RUN_STATE_FILENAME), before, 'utf-8');

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'retention_run_state_invalid' },
    });
    expect(fs.readFileSync(path.join(changeDir, RUN_STATE_FILENAME), 'utf-8')).toBe(before);
  });

  it('fails closed on a change whose planning root owns no resolvable identity', async () => {
    // A planning root with no project identity and no store declaration: there
    // is no owner to freeze, so preparation refuses before writing anything.
    const orphan = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-retain-orphan-'))
    );
    try {
      fs.mkdirSync(path.join(orphan, 'rasen', 'changes'), { recursive: true });
      fs.writeFileSync(path.join(orphan, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      createChange(orphan);
      process.chdir(orphan);

      await runRetain(['prepare', CHANGE, '--json']);
      expect(process.exitCode).toBe(1);
      const result = lastJson<{ ok: boolean; error: { code: string } }>();
      expect(result.ok).toBe(false);
      // Zero typed stores and zero typed projects at this root: the STALE arm.
      expect(result.error.code).toBe('knowledge_owner_stale');
      expect(fs.existsSync(path.join(orphan, '.rasen', 'changes', CHANGE, 'ephemera', RUN_STATE_FILENAME))).toBe(false);
    } finally {
      process.chdir(projectRoot);
      fs.rmSync(orphan, { recursive: true, force: true });
    }
  });

  it('names the ambiguity when the planning root is a store identifying no member project', async () => {
    // Launched directly from a registered store: planning resolves to the
    // store, but a store does not identify one member project, so there is no
    // owner to freeze and the AMBIGUOUS arm — not the stale one — must fire.
    const storeRoot = path.join(tempHome, 'ambiguous-store');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const uid = mintStoreUid();
    await writeStoreMetadataState(storeRoot, { version: 2, uid, id: 'ambiguous-store' });
    await registerStore({ id: 'ambiguous-store', localPath: storeRoot, globalDataDir: tempHome });
    const changeDir = createChange(storeRoot);
    process.chdir(storeRoot);

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBe(1);
    const result = lastJson<{
      ok: boolean;
      error: { code: string; message: string; selectorGuidance?: string[] };
    }>();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('knowledge_owner_ambiguous');
    // The remediation has to name THIS command's owner selectors. `--project`/
    // `--store` select the PLANNING ROOT here (ADR-2), so the shared resolver's
    // own wording would send the user at a flag that cannot settle ownership.
    expect(result.error.message).toContain('--owner-project <id> or --owner-store <id>');
    expect(result.error.message).not.toContain('--project <id> or --store <id>');
    expect(result.error.selectorGuidance).toEqual([
      '--owner-project <id>',
      '--owner-store <id>',
    ]);
    // Refused before any candidate and before any durable record, at either
    // location a record could have been born in.
    expect(
      fs.existsSync(
        path.join(storeRoot, '.rasen', 'changes', CHANGE, 'ephemera', RUN_STATE_FILENAME)
      )
    ).toBe(false);
    expect(fs.existsSync(path.join(changeDir, RUN_STATE_FILENAME))).toBe(false);
  });

  it('refuses when the RECORDED owner no longer exists on this machine', async () => {
    // The stale condition the spec names first: the identity is already frozen,
    // and the owner it names is gone. Revalidation must refuse rather than
    // silently resolving a second, present owner.
    const changeDir = createChange(projectRoot);
    const before = `${JSON.stringify(
      {
        pipeline: 'full-feature',
        knowledgeContext: {
          version: 3,
          planningRoot: { type: 'project', projectId },
          owner: { type: 'project', projectId: 'retired-owner-project-id' },
        },
      },
      null,
      2
    )}\n`;
    fs.writeFileSync(path.join(changeDir, RUN_STATE_FILENAME), before, 'utf-8');

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBe(1);
    const result = lastJson<{ ok: boolean; error: { code: string } }>();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('knowledge_owner_stale');
    // No owner was substituted and nothing was rewritten: byte-identical.
    expect(fs.readFileSync(path.join(changeDir, RUN_STATE_FILENAME), 'utf-8')).toBe(before);
  });

  it('refuses an explicit selector that disagrees with the recorded identity', async () => {
    const changeDir = createChange(projectRoot);
    const other = path.join(tempHome, 'other-project');
    fs.mkdirSync(path.join(other, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(other, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const otherId = (await resolveProjectHome(other, { globalDataDir: tempHome }))!.projectId;

    const before = `${JSON.stringify({
      pipeline: 'full-feature',
      knowledgeContext: {
        version: 3,
        planningRoot: { type: 'project', projectId },
        owner: { type: 'project', projectId },
      },
    }, null, 2)}\n`;
    fs.writeFileSync(path.join(changeDir, RUN_STATE_FILENAME), before, 'utf-8');

    await runRetain(['prepare', CHANGE, '--owner-project', otherId, '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'knowledge_selector_conflict' },
    });
    expect(fs.readFileSync(path.join(changeDir, RUN_STATE_FILENAME), 'utf-8')).toBe(before);
  });

  it('resolves the right store through durable identity when two stores share a display name', async () => {
    const stores: { root: string; uid: string }[] = [];
    for (const dirName of ['namesake-left', 'namesake-right']) {
      const storeRoot = path.join(tempHome, dirName);
      fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
      fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
      fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      const uid = mintStoreUid();
      // Both stores answer to the SAME display name; only the uid distinguishes.
      await writeStoreMetadataState(storeRoot, { version: 2, uid, id: 'shared' });
      await registerStore({ id: 'shared', localPath: storeRoot, globalDataDir: tempHome });
      stores.push({ root: storeRoot, uid });
    }
    const [left, right] = stores;
    expect(left.uid).not.toBe(right.uid);

    // The member project declares its planning store BY UID, which is the only
    // way to name one of two namesakes. Its change lives in that store.
    const member = path.join(tempHome, 'namesake-member');
    fs.mkdirSync(path.join(member, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(member, 'rasen', 'config.yaml'),
      `schema: spec-driven\nstore:\n  uid: ${right.uid}\n`
    );
    await resolveProjectHome(member, { globalDataDir: tempHome });
    createChange(right.root);
    process.chdir(member);

    await runRetain(['prepare', CHANGE, '--json']);
    const result = lastJson<{
      ok: boolean;
      knowledgeContext: {
        version: number;
        planningRoot: { type: string; uid?: string };
        owner: { type: string; projectId?: string };
      };
    }>();
    expect(process.exitCode).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.knowledgeContext.version).toBe(3);
    expect(result.knowledgeContext.planningRoot).toMatchObject({ type: 'store', uid: right.uid });
    expect(result.knowledgeContext.planningRoot.uid).not.toBe(left.uid);
    // The display name is carried for readability only; it never chose.
    expect(result.knowledgeContext.planningRoot).toMatchObject({ id: 'shared' });
    // Direct store planning does not imply the store owns the knowledge: the
    // member project the run launched from does.
    expect(result.knowledgeContext.owner).toMatchObject({ type: 'project' });
  });

  it('lets an accepted project candidate apply with the reported run-state directory', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', workflows: ['apply'], retention: 'codify' });
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);
    const { runStateDir, retention } = lastJson<{ runStateDir: string; retention: string }>();
    expect(retention).toBe('codify');

    logSpy.mockClear();
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate(projectId)),
      '--run-state-dir',
      runStateDir,
      '--json',
    ]);
    expect(process.exitCode).toBeUndefined();
    const applied = lastJson<{ ok: boolean; outcome: string; context: { source: string } }>();
    expect(applied.ok).toBe(true);
    expect(applied.outcome).toBe('created');
    // The write was authorized by the identity preparation froze, not by cwd.
    expect(applied.context.source).toBe('run-state');
    expect(
      fs.existsSync(path.join(resolveProjectKnowledgeHome(projectId).catalogDir, SKILL_ID, 'SKILL.md'))
    ).toBe(true);
  });

  it('refuses the same project candidate under the report mode preparation reported', async () => {
    // The other half of "reported mode agrees with the authorization decision":
    // the reported mode must also be the mode that REFUSES. Identity is frozen
    // under `codify` first, because a non-codify preparation deliberately writes
    // nothing at all — then the effective mode drops to `report` and the SAME
    // directory must stop authorizing the apply.
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);
    const { runStateDir, runStatePath } = lastJson<{
      runStateDir: string;
      runStatePath: string;
    }>();
    const frozen = fs.readFileSync(runStatePath, 'utf-8');

    saveGlobalConfig({ featureFlags: {}, profile: 'full' });
    logSpy.mockClear();
    await runRetain(['prepare', CHANGE, '--json']);
    const reported = lastJson<{ retention: string; contextSource: string }>();
    expect(reported.retention).toBe('report');
    // A mode that never reads the context also never rewrites it.
    expect(reported.contextSource).toBe('skipped');
    expect(fs.readFileSync(runStatePath, 'utf-8')).toBe(frozen);

    logSpy.mockClear();
    await runKnowledge([
      'apply',
      '--from',
      writeCandidate(projectCandidate(projectId)),
      '--run-state-dir',
      runStateDir,
      '--json',
    ]);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'codify_required' },
    });
    expect(fs.existsSync(resolveProjectKnowledgeHome(projectId).catalogDir)).toBe(false);
  });

  it('leaves no learned skill behind when a run accepts no candidate', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', workflows: ['apply'], retention: 'codify' });
    createChange(projectRoot);
    await runRetain(['prepare', CHANGE, '--json']);
    const { runStateDir } = lastJson<{ runStateDir: string }>();

    logSpy.mockClear();
    await runKnowledge(['list', '--scope', 'project', '--run-state-dir', runStateDir, '--json']);
    expect(process.exitCode).toBeUndefined();
    const listed = lastJson<{ learnedSkills: unknown[]; context: { source: string } }>();
    expect(listed.context.source).toBe('run-state');
    expect(listed.learnedSkills).toEqual([]);
    expect(fs.existsSync(resolveProjectKnowledgeHome(projectId).catalogDir)).toBe(false);
  });

  it('resolves a store-planned change with the store as planning root and the member as owner', async () => {
    const storeRoot = path.join(tempHome, 'member-store');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const uid = mintStoreUid();
    await writeStoreMetadataState(storeRoot, { version: 2, uid, id: 'member-store' });
    await registerStore({ id: 'member-store', localPath: storeRoot, globalDataDir: tempHome });

    // A genuine store-planned member: it declares the store and keeps NO local
    // planning shape of its own, so planning resolves store-side while the
    // member project keeps owning the knowledge.
    const member = path.join(tempHome, 'member-checkout');
    fs.mkdirSync(path.join(member, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(member, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.writeFileSync(path.join(member, 'go.mod'), 'module member\n');
    const memberId = (await resolveProjectHome(member, { globalDataDir: tempHome }))!.projectId;
    fs.appendFileSync(path.join(member, 'rasen', 'config.yaml'), `store:\n  uid: ${uid}\n`);
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: memberId,
      roles: { planning: false, knowledge: true },
    });
    createChange(storeRoot);
    process.chdir(member);

    await runRetain(['prepare', CHANGE, '--store', 'member-store', '--json']);
    const result = lastJson<{
      ok: boolean;
      runStateDir: string;
      knowledgeContext: {
        planningRoot: { type: string; uid?: string };
        owner: { type: string; projectId?: string };
      };
    }>();
    expect(process.exitCode).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.knowledgeContext.planningRoot).toEqual({ type: 'store', uid, id: 'member-store' });
    expect(result.knowledgeContext.owner).toMatchObject({ type: 'project', projectId: memberId });
    // `file-placement`: for a store-selected run, planning lives store-side
    // while ephemera lives in the member checkout the run launched from. That
    // checkout is discovered as a qualifying project root, never guessed from
    // the bare current directory.
    expect(result.runStateDir).toBe(
      path.join(member, '.rasen', 'changes', CHANGE, 'ephemera')
    );
  });

  it('freezes the owner an explicit selector names, independently of the planning root', async () => {
    // ADR-2's second selector pair: WHERE planning lives and WHOSE knowledge
    // this is are two questions, and the owner selector answers only the
    // second. Same store-planned fixture as above, but the run is retained for
    // a project that is neither the planning root nor the launch checkout.
    const storeRoot = path.join(tempHome, 'selector-store');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const uid = mintStoreUid();
    await writeStoreMetadataState(storeRoot, { version: 2, uid, id: 'selector-store' });
    await registerStore({ id: 'selector-store', localPath: storeRoot, globalDataDir: tempHome });

    // The launch checkout: a genuine store-planned member with no local
    // planning shape, so planning resolves store-side.
    const member = path.join(tempHome, 'selector-member');
    fs.mkdirSync(path.join(member, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(member, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.writeFileSync(path.join(member, 'go.mod'), 'module member\n');
    const memberId = (await resolveProjectHome(member, { globalDataDir: tempHome }))!.projectId;
    fs.appendFileSync(path.join(member, 'rasen', 'config.yaml'), `store:\n  uid: ${uid}\n`);
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId: memberId,
      roles: { planning: false, knowledge: true },
    });

    // A third, legitimately registered project — the owner the selector names.
    const owned = path.join(tempHome, 'selected-owner');
    fs.mkdirSync(path.join(owned, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(owned, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const ownedId = (await resolveProjectHome(owned, { globalDataDir: tempHome }))!.projectId;
    expect(ownedId).not.toBe(memberId);

    createChange(storeRoot);
    process.chdir(member);

    await runRetain([
      'prepare',
      CHANGE,
      '--store',
      'selector-store',
      '--owner-project',
      ownedId,
      '--json',
    ]);
    const result = lastJson<{
      ok: boolean;
      knowledgeContext: {
        planningRoot: { type: string; uid?: string };
        owner: { type: string; projectId?: string };
      };
    }>();
    expect(process.exitCode).toBeUndefined();
    expect(result.ok).toBe(true);
    // The root decided planning; the selector decided ownership.
    expect(result.knowledgeContext.planningRoot).toEqual({ type: 'store', uid, id: 'selector-store' });
    expect(result.knowledgeContext.owner).toMatchObject({ type: 'project', projectId: ownedId });
    // Not the launch checkout, which is what would have been chosen with no selector.
    expect(result.knowledgeContext.owner.projectId).not.toBe(memberId);
  });

  it('fails closed when the change and the resolved identity come from different planning roots', async () => {
    const otherStore = path.join(tempHome, 'unrelated-store');
    fs.mkdirSync(path.join(otherStore, 'rasen', 'changes'), { recursive: true });
    fs.mkdirSync(path.join(otherStore, 'rasen', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(otherStore, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const uid = mintStoreUid();
    await writeStoreMetadataState(otherStore, { version: 2, uid, id: 'unrelated-store' });
    await registerStore({ id: 'unrelated-store', localPath: otherStore, globalDataDir: tempHome });
    // Same change name in both spaces, so the change resolves and only the ROOT
    // disagreement can stop the run.
    createChange(otherStore);
    createChange(projectRoot);

    // cwd plans in its own project; the flag reads the change from a store the
    // checkout has nothing to do with.
    await runRetain(['prepare', CHANGE, '--store', 'unrelated-store', '--json']);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'retention_planning_root_mismatch' },
    });
    expect(
      fs.existsSync(path.join(projectRoot, '.rasen', 'changes', CHANGE, 'ephemera', RUN_STATE_FILENAME))
    ).toBe(false);
  });

  it('rejects two owner selectors at once', async () => {
    createChange(projectRoot);
    await runRetain([
      'prepare',
      CHANGE,
      '--owner-project',
      projectId,
      '--owner-store',
      'whatever',
      '--json',
    ]);
    expect(process.exitCode).toBe(1);
    expect(lastJson()).toMatchObject({
      ok: false,
      error: { code: 'retention_owner_selector_conflict' },
    });
  });

  // Identity resolution is async, so "there is no run-state here" can go stale
  // between the decision and the write. The create must therefore be exclusive:
  // a record that appeared meanwhile carries a LEAD's pipeline name and every
  // stage record, and replacing it would destroy a whole run's progress while
  // leaving a file no reader could tell apart from a retention-only one.
  it('merges into a run-state that appeared during preparation instead of replacing it', async () => {
    createChange(projectRoot);
    const ephemera = path.join(projectRoot, '.rasen', 'changes', CHANGE, 'ephemera');
    const runStateFile = path.join(ephemera, RUN_STATE_FILENAME);

    // Stand in for the concurrent writer: seed a full LEAD record after the
    // location probe would have run, by planting it before the write lands.
    const seeded = {
      pipeline: 'full-feature',
      stages: { propose: { status: 'done' }, implement: { status: 'in_progress' } },
      rounds: 2,
    };
    fs.mkdirSync(ephemera, { recursive: true });
    fs.writeFileSync(runStateFile, `${JSON.stringify(seeded, null, 2)}\n`, 'utf-8');

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBeUndefined();

    const result = lastJson<{ ok: boolean; pipeline: string | null; contextSource: string }>();
    expect(result.ok).toBe(true);
    // The seeded record survives in full, and the context was added beside it.
    const after = JSON.parse(fs.readFileSync(runStateFile, 'utf-8')) as Record<string, unknown>;
    expect(after.pipeline).toBe('full-feature');
    expect(after.stages).toEqual(seeded.stages);
    expect(after.rounds).toBe(2);
    expect(after.knowledgeContext).toMatchObject({
      version: 3,
      owner: { type: 'project', projectId },
    });
    expect(result.pipeline).toBe('full-feature');
  });

  it('reports a mistyped change name as a retain error rather than crashing', async () => {
    createChange(projectRoot);
    await runRetain(['prepare', 'no-such-change', '--json']);
    expect(process.exitCode).toBe(1);
    const result = lastJson<{ ok: boolean; error: { code: string; message: string } }>();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('retain_error');
    expect(result.error.message).toContain('no-such-change');
    expect(
      fs.existsSync(path.join(projectRoot, '.rasen', 'changes', 'no-such-change'))
    ).toBe(false);
  });

  it('reports a run-state the filesystem refuses to record into with its real cause', async () => {
    const changeDir = createChange(projectRoot);
    const ephemera = path.join(projectRoot, '.rasen', 'changes', CHANGE, 'ephemera');
    // A FILE where the ephemera directory belongs. Nothing is located (there is
    // no directory to hold a record), so preparation takes the create path and
    // fails there — on every platform, without chmod or an fs mock. It has to
    // arrive as the named write refusal carrying the path it failed at, not as a
    // bare errno under the generic code.
    fs.mkdirSync(path.dirname(ephemera), { recursive: true });
    fs.writeFileSync(ephemera, 'not a directory\n', 'utf-8');

    await runRetain(['prepare', CHANGE, '--json']);
    expect(process.exitCode).toBe(1);
    const result = lastJson<{
      ok: boolean;
      error: { code: string; runStatePath?: string; reason?: string };
    }>();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('retention_context_write_failed');
    expect(result.error.runStatePath).toBe(path.join(ephemera, RUN_STATE_FILENAME));
    expect(result.error.reason).toBeTruthy();
    expect(fs.existsSync(path.join(changeDir, RUN_STATE_FILENAME))).toBe(false);
  });

  it('prints a localized human surface, and keeps the JSON message English', async () => {
    createChange(projectRoot);
    process.env.RASEN_LANG = 'ja';

    await runRetain(['prepare', CHANGE]);
    expect(process.exitCode).toBeUndefined();
    const printed = logSpy.mock.calls.map(([value]) => String(value)).join('\n');
    // The human surface is rendered from the ja catalog, names no pipeline for a
    // change that never ran one, and leaks no unresolved template placeholder.
    expect(printed).toContain(CHANGE);
    expect(printed).toContain('codify');
    expect(printed).toContain('パイプライン');
    expect(printed).not.toContain('{');

    logSpy.mockClear();
    errSpy.mockClear();
    await runRetain(['prepare', CHANGE, '--owner-project', projectId, '--owner-store', 'x']);
    expect(process.exitCode).toBe(1);
    const refusal = errSpy.mock.calls.map(([value]) => String(value)).join('\n');
    expect(refusal).toContain('Error:');
    // Rendered in the caller's locale — the mechanism the English-only literal
    // this command replaced could not provide.
    expect(refusal).toMatch(/[^\x00-\x7F]/);
  });
});
