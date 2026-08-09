/**
 * `store-finalization-outcomes-v2` tasks 12.2, 12.3 and 12.8 — the archive
 * command surface, executed.
 *
 * Two earlier children in this portfolio shipped broken command wiring because
 * nothing ever executed the command, so every case here runs the REAL Commander
 * program in a child process against a real Store v2 pair. Flag parsing, the
 * missing-outcome refusal, the JSON report, JSON/human parity, dry-run's
 * zero-write guarantee, and the stored-plan round trip are all asserted through
 * that surface and nowhere else.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreFinalizationFixture,
  hashTree,
  type BoundChange,
  type StoreFinalizationFixture,
} from '../helpers/store-finalization-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';

function parseJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

function expectOk(result: RunCLIResult): RunCLIResult {
  expect(
    result.exitCode,
    `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(0);
  return result;
}

describe('rasen archive: the Store v2 outcome surface', () => {
  let f: StoreFinalizationFixture;

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-archive-outcome-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function selectors(): string[] {
    return ['--store', f.storeId, '--project', PROJECT, '--target-line', LINE];
  }

  function archiveArgs(bound: BoundChange, ...rest: string[]): string[] {
    return ['archive', bound.changeId, ...selectors(), ...rest];
  }

  async function bind(changeId: string, instanceSeed?: string): Promise<BoundChange> {
    return f.bind({
      projectId: PROJECT,
      targetLineId: LINE,
      changeId,
      ...(instanceSeed === undefined ? {} : { instanceSeed }),
    });
  }

  it('refuses a missing outcome before writing anything, naming all four', async () => {
    const bound = await bind('needs-an-outcome');
    const changeBefore = hashTree(bound.changeDir);

    const refused = await runCLI(archiveArgs(bound, '--json', '--yes'), {
      cwd: bound.executionWorktree,
      env: f.env,
    });

    expect(refused.exitCode).toBe(1);
    const diagnostic = parseJson(refused).status[0];
    expect(diagnostic.code).toBe('finalization_outcome_required');
    for (const outcome of ['landed', 'superseded', 'cancelled', 'abandoned']) {
      expect(diagnostic.message).toContain(outcome);
    }
    expect(diagnostic.fix).toContain('Nothing was read or written.');
    // No archive line, no entry, and the Change is byte-identical.
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
    expect(hashTree(bound.changeDir)).toEqual(changeBefore);
  }, 240_000);

  it.each([
    ['--reason on landed', ['--outcome', 'landed', '--reason', 'we shipped it']],
    ['--by on abandoned', ['--outcome', 'abandoned', '--reason', 'x', '--by', `ci_${'a'.repeat(64)}`]],
    ['a missing reason', ['--outcome', 'cancelled']],
    ['a missing successor', ['--outcome', 'superseded', '--reason', 'moved']],
    ['an unknown outcome', ['--outcome', 'shipped']],
    ['--commit on a passive outcome', ['--outcome', 'abandoned', '--reason', 'x', '--commit', 'a'.repeat(40)]],
  ])('refuses %s through the real command surface', async (_label, flags) => {
    const bound = await bind('flag-parsing');

    const refused = await runCLI(archiveArgs(bound, '--json', '--yes', ...flags), {
      cwd: bound.executionWorktree,
      env: f.env,
    });

    expect(refused.exitCode).toBe(1);
    expect(parseJson(refused).status[0].code).toMatch(/^finalization_outcome_/u);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 240_000);

  it('emits the immutable finalization plan on --dry-run and writes nothing', async () => {
    const bound = await bind('dry-run-change');
    const changeBefore = hashTree(bound.changeDir);
    const globalBefore = hashTree(f.globalDataDir);

    const dryRun = expectOk(
      await runCLI(
        archiveArgs(
          bound,
          '--outcome',
          'abandoned',
          '--reason',
          'Previewing the finalization.',
          '--dry-run',
          '--json'
        ),
        { cwd: bound.executionWorktree, env: f.env }
      )
    );

    const payload = parseJson(dryRun).archive;
    expect(payload.dryRun).toBe(true);
    const plan = payload.finalizationPlan;
    // The SAME immutable plan `apply` consumes: its id, its destination, the
    // record draft, and every blocker.
    expect(plan.planId).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.outcome).toBe('abandoned');
    expect(plan.destination).toBe(payload.path);
    expect(plan.recordDraft).toMatchObject({
      schemaVersion: 2,
      outcome: 'abandoned',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: bound.changeInstanceId,
      workspacePairId: bound.workspacePairId,
      specSync: { applied: false, actions: [] },
    });
    expect(Array.isArray(plan.blockers)).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.applicable).toBe(true);

    // Nothing was created, moved, or written — not even a plan file, because
    // --save-plan was not asked for.
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
    expect(hashTree(bound.changeDir)).toEqual(changeBefore);
    expect(hashTree(f.globalDataDir)).toEqual(globalBefore);
  }, 240_000);

  it('reports the complete finalization record in --json for a landed archive', async () => {
    const bound = await bind('landed-change');
    const commit = f.refOid(bound.executionWorktree, 'HEAD');

    const archived = expectOk(
      await runCLI(
        archiveArgs(bound, '--outcome', 'landed', '--commit', commit, '--json', '--yes'),
        { cwd: bound.executionWorktree, env: f.env }
      )
    );

    const payload = parseJson(archived).archive;
    expect(payload.finalization).toMatchObject({
      outcome: 'landed',
      changeInstanceId: bound.changeInstanceId,
      workspacePairId: bound.workspacePairId,
      targetLineId: LINE,
      specSyncApplied: true,
      specSyncActionCount: 0,
      provenCommit: commit,
      codeRef: 'refs/heads/release/0.2',
      associationPhase: 'applied',
    });
    expect(payload.finalization.publishedEntry).toBe(payload.path);
    expect(payload.finalization.codeRefOid).toBe(
      f.refOid(f.projectRoot(PROJECT), 'refs/heads/release/0.2')
    );
    expect(path.basename(payload.path)).toMatch(
      /^\d{4}-\d{2}-\d{2}-landed-change--[0-9a-f]{12}$/u
    );
    const record = JSON.parse(
      fs.readFileSync(path.join(payload.path, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      schemaVersion: 2,
      outcome: 'landed',
      codeMerge: { commit, targetRef: 'refs/heads/release/0.2', reachable: true },
    });
  }, 240_000);

  it('states the same facts in human output as in JSON', async () => {
    const bound = await bind('human-parity-change');

    const archived = expectOk(
      await runCLI(
        archiveArgs(
          bound,
          '--outcome',
          'cancelled',
          '--reason',
          'Cancelled after review.',
          '--yes'
        ),
        { cwd: bound.executionWorktree, env: f.env }
      )
    );

    const entries = fs.readdirSync(bound.archiveLine);
    expect(entries).toHaveLength(1);
    const published = path.join(bound.archiveLine, entries[0] as string);

    // The four facts the JSON payload reports, in the human form.
    expect(archived.stdout).toContain("finalized as 'cancelled'");
    expect(archived.stdout).toContain(published);
    expect(archived.stdout).toContain(bound.changeInstanceId);
    expect(archived.stdout).toContain(bound.workspacePairId);
    expect(archived.stdout).toContain(LINE);
    expect(archived.stdout).toContain('Spec sync: not applied (0 action(s))');
    expect(archived.stdout).toContain('Association phase: applied');
  }, 240_000);

  it('round-trips a saved plan: preview writes nothing, apply consumes only the token', async () => {
    const bound = await bind('stored-plan-change');
    const changeBefore = hashTree(bound.changeDir);

    const preview = expectOk(
      await runCLI(
        archiveArgs(
          bound,
          '--outcome',
          'abandoned',
          '--reason',
          'Saved for later application.',
          '--dry-run',
          '--save-plan',
          '--json'
        ),
        { cwd: bound.executionWorktree, env: f.env }
      )
    );
    const previewPayload = parseJson(preview).archive;
    const token = previewPayload.planToken as string;
    expect(token).toMatch(/^archive-v1:/u);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
    expect(hashTree(bound.changeDir)).toEqual(changeBefore);

    // Applied from an UNRELATED directory with no selectors at all: the stored
    // plan carries the recorded outcome, so neither the invoking directory nor
    // a flag can re-decide it.
    const applied = expectOk(
      await runCLI(['archive', '--apply-plan', token, '--json', '--yes'], {
        cwd: f.tempDir,
        env: f.env,
      })
    );
    const finalization = parseJson(applied).archive.finalization;
    expect(finalization.status).toBe('complete');
    expect(finalization.outcome).toBe('abandoned');
    expect(finalization.changeInstanceId).toBe(bound.changeInstanceId);
    expect(finalization.publishedEntry).toBe(previewPayload.path);
    expect(fs.existsSync(previewPayload.path)).toBe(true);
    expect(fs.existsSync(bound.changeDir)).toBe(false);
  }, 240_000);

  it('aborts a saved Store finalization under its recorded coordination locks', async () => {
    const bound = await bind('stored-finalization-abort');
    const changeBefore = hashTree(bound.changeDir);
    const preview = expectOk(
      await runCLI(
        archiveArgs(
          bound,
          '--outcome',
          'abandoned',
          '--reason',
          'Retire this uncommitted plan.',
          '--dry-run',
          '--save-plan',
          '--json'
        ),
        { cwd: bound.executionWorktree, env: f.env }
      )
    );
    const payload = parseJson(preview).archive;
    const token = payload.planToken as string;

    const aborted = expectOk(
      await runCLI(['archive', '--abort-plan', token, '--json', '--yes'], {
        cwd: f.tempDir,
        env: f.env,
      })
    );
    expect(parseJson(aborted).archive.result).toMatchObject({
      status: 'aborted',
      change: bound.changeId,
      blockers: [],
    });
    expect(hashTree(bound.changeDir)).toEqual(changeBefore);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);

    const repeated = expectOk(
      await runCLI(['archive', '--abort-plan', token, '--json', '--yes'], {
        cwd: f.tempDir,
        env: f.env,
      })
    );
    expect(parseJson(repeated).archive.result.status).toBe('already-aborted');

    const reapplied = await runCLI(
      ['archive', '--apply-plan', token, '--json', '--yes'],
      { cwd: f.tempDir, env: f.env }
    );
    expect(reapplied.exitCode).toBe(1);
    expect(parseJson(reapplied).status[0].code).toBe('archive_plan_aborted');
    expect(hashTree(bound.changeDir)).toEqual(changeBefore);
  }, 240_000);

  it('refuses an unverifiable successor with the SPECIFIC diagnostic, not a shape complaint', async () => {
    const bound = await bind('no-such-successor');

    const refused = await runCLI(
      archiveArgs(
        bound,
        '--outcome',
        'superseded',
        '--reason',
        'The work moved somewhere.',
        '--by',
        `ci_${'9'.repeat(64)}`,
        '--json',
        '--yes'
      ),
      { cwd: bound.executionWorktree, env: f.env }
    );

    expect(refused.exitCode).toBe(1);
    const diagnostic = parseJson(refused).status[0];
    // The search's own refusal, naming the id it could not derive — NOT the
    // canonical validator's generic "a successor scope is required", which
    // carries none of that information.
    expect(diagnostic.code).toBe('successor_scope_unverified');
    expect(diagnostic.message).toContain(`ci_${'9'.repeat(64)}`);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 240_000);

  it('leaves the execution checkout resolvable after its Change is finalized', async () => {
    const bound = await bind('still-resolvable');

    expectOk(
      await runCLI(
        archiveArgs(bound, '--outcome', 'abandoned', '--reason', 'Dropped.', '--json', '--yes'),
        { cwd: bound.executionWorktree, env: f.env }
      )
    );

    // The transaction wrote a `finalizedChange` block into
    // `.rasen/planning-binding.json`. Every later command from this checkout
    // must still resolve its scope — a strict allow-list that refused the new
    // field would break the checkout the moment its Change was archived.
    const context = expectOk(
      await runCLI(['context', '--json', ...selectors()], {
        cwd: bound.executionWorktree,
        env: f.env,
      })
    );
    expect(parseJson(context).workspace).toMatchObject({
      projectId: PROJECT,
      targetLineId: LINE,
    });
    const binding = JSON.parse(
      fs.readFileSync(
        path.join(bound.executionWorktree, '.rasen', 'planning-binding.json'),
        'utf8'
      )
    ) as { finalizedChange?: { changeId: string } };
    expect(binding.finalizedChange?.changeId).toBe(bound.changeId);
  }, 240_000);

  it('refuses a landed outcome whose commit is not reachable from the code ref', async () => {
    const bound = await bind('unreachable-change');
    const codeRepo = f.projectRoot(PROJECT);
    // A commit that exists but is NOT an ancestor of release/0.2.
    f.git(codeRepo, ['checkout', '-b', 'sidetrack', 'main']);
    f.write(path.join(codeRepo, 'sidetrack.txt'), 'sidetrack\n');
    f.git(codeRepo, ['add', 'sidetrack.txt']);
    f.git(codeRepo, ['commit', '-m', 'sidetrack commit']);
    const unreachable = f.refOid(codeRepo, 'HEAD');
    f.git(codeRepo, ['checkout', 'main']);

    const refused = await runCLI(
      archiveArgs(bound, '--outcome', 'landed', '--commit', unreachable, '--json', '--yes'),
      { cwd: bound.executionWorktree, env: f.env }
    );

    expect(refused.exitCode).toBe(1);
    const diagnostic = parseJson(refused).status[0];
    expect(diagnostic.code).toBe('landed_commit_unreachable');
    expect(diagnostic.message).toContain(unreachable);
    expect(diagnostic.message).toContain('refs/heads/release/0.2');
    // The Change stays active.
    expect(fs.existsSync(bound.changeDir)).toBe(true);
    expect(fs.existsSync(bound.archiveLine)).toBe(false);
  }, 240_000);
});

describe('outside a Store v2 project scope, the outcome axis does not exist', () => {
  let f: StoreFinalizationFixture;
  let standaloneRoot: string;
  const CHANGE = 'standalone-change';

  beforeEach(async () => {
    f = await createStoreFinalizationFixture({
      prefix: 'rasen-archive-standalone-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main' }],
    });
    standaloneRoot = f.beside('solo-project');
    f.write(
      path.join(standaloneRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprojectId: solo\n'
    );
    f.write(
      path.join(standaloneRoot, 'rasen', 'changes', CHANGE, 'proposal.md'),
      '## Why\n\nSolo work.\n'
    );
    f.write(
      path.join(standaloneRoot, 'rasen', 'changes', CHANGE, 'tasks.md'),
      '- [x] Done\n'
    );
    fs.mkdirSync(path.join(standaloneRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(standaloneRoot, 'rasen', 'changes', 'archive'), {
      recursive: true,
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  it('archives with NO outcome required and records none', async () => {
    const archived = expectOk(
      await runCLI(['archive', CHANGE, '--json', '--yes'], {
        cwd: standaloneRoot,
        env: f.env,
      })
    );

    const payload = parseJson(archived).archive;
    expect(payload.finalization).toBeUndefined();
    expect(path.basename(payload.path)).toMatch(
      new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${CHANGE}$`, 'u')
    );
    const record = JSON.parse(
      fs.readFileSync(path.join(payload.path, 'archive.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(record).not.toHaveProperty('outcome');
    expect(record).not.toHaveProperty('schemaVersion');
  }, 240_000);

  it('REJECTS the outcome options rather than archiving while discarding them', async () => {
    const refused = await runCLI(
      ['archive', CHANGE, '--outcome', 'landed', '--json', '--yes'],
      { cwd: standaloneRoot, env: f.env }
    );

    expect(refused.exitCode).toBe(1);
    const diagnostic = parseJson(refused).status[0];
    expect(diagnostic.code).toBe('finalization_scope_unsupported');
    expect(diagnostic.message).toContain('--outcome');
    expect(diagnostic.fix).toContain('archive exactly as before');
    // Nothing was archived while the option was ignored.
    expect(
      fs.readdirSync(path.join(standaloneRoot, 'rasen', 'changes', 'archive'))
    ).toEqual([]);
    expect(
      fs.existsSync(path.join(standaloneRoot, 'rasen', 'changes', CHANGE))
    ).toBe(true);
  }, 240_000);
});
