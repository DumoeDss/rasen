import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveProjectHome } from '../../../src/core/project-home.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';
import {
  commitLearnedSkillPlan,
  listCanonicalLearnedSkills,
  matchesApplicability,
  planLearnedSkillMutation,
  resolveLearnedSkills,
  LEARNED_SKILL_CONTENT_BUDGET,
  LEARNED_SKILL_BACKUP_PREFIX,
  LEARNED_SKILL_MANIFEST_FILE,
  type EvidenceReference,
  type LearnedSkillContext,
} from '../../../src/core/learned-skills/index.js';

// --- B3 fault injection: intercept fs.rmSync for backup-cleanup failure ---
// vi.spyOn cannot patch ESM namespace exports, so we use vi.mock with a
// hoisted toggle. When enabled, recursive rmSync on a backup-prefixed path
// simulates a partial delete (removes one child file, then throws EBUSY).
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
        // Simulate a partial delete: remove a non-manifest child (so the
        // backup remains identifiable for sweepMutationDebris), then throw.
        // readdirSync order is platform-dependent, so we explicitly skip the
        // manifest rather than relying on sort order.
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

const DIGEST = `sha256:${'a'.repeat(64)}`;
const evidence = (projectId: string, change = 'add-thing', artifact = 'proposal'): EvidenceReference => ({
  projectId,
  change,
  artifact,
  digest: DIGEST,
});

const ID = 'go-sql-transaction-locking';
const upsertRequest = (projectId: string) =>
  ({
    operation: 'upsert' as const,
    scope: 'project' as const,
    id: ID,
    knowledgeKey: 'go-sql-tx-locking',
    description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
    instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
    applicability: { mode: 'all' as const, markers: ['go.mod'] },
    evidence: [evidence(projectId)],
  });

describe('learned-skill core mutation and resolution', () => {
  let globalDataDir: string;
  let projectRoot: string;
  let projectId: string;
  let context: LearnedSkillContext;

  async function makeProject(): Promise<{ root: string; projectId: string }> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ls-proj-'));
    fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, projectId: home!.projectId };
  }

  beforeEach(async () => {
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ls-gdd-'));
    const project = await makeProject();
    projectRoot = project.root;
    projectId = project.projectId;
    context = { projectRoot, globalDataDir };
  });

  afterEach(() => {
    fs.rmSync(globalDataDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('does not clobber a directory that appears on the id between plan and commit (TOCTOU)', async () => {
    const plan = await planLearnedSkillMutation(upsertRequest(projectId), context);
    expect(plan.action).toBe('create');

    // An unmanaged (human-authored) directory appears on the id AFTER planning
    // but before commit. The commit-time re-check under the lock must refuse to
    // overwrite it rather than treating any existing dir as a rewrite.
    const dir = plan.commit!.directory;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'human authored\n');

    const result = await commitLearnedSkillPlan(plan, context);
    expect(result.outcome).toBe('blocked');
    expect(result.block?.code).toBe('ownership_collision');
    // The human file is left byte-for-byte unchanged.
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8')).toBe('human authored\n');
  });

  it('creates a project record, is idempotent on the same evidence, and rewrites on new evidence', async () => {
    const created = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(projectId), context),
      context
    );
    expect(created.outcome).toBe('created');
    expect(created.directory && fs.existsSync(path.join(created.directory, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(created.directory!, 'learned-skill.yaml'))).toBe(true);

    const rerun = await planLearnedSkillMutation(upsertRequest(projectId), context);
    expect(rerun.action).toBe('no-op');

    const withNewEvidence = {
      ...upsertRequest(projectId),
      evidence: [evidence(projectId, 'add-other-change')],
    };
    const rewritePlan = await planLearnedSkillMutation(withNewEvidence, context);
    expect(rewritePlan.action).toBe('rewrite');
    const rewritten = await commitLearnedSkillPlan(rewritePlan, context);
    expect(rewritten.outcome).toBe('rewritten');
    // Provenance accumulates across the two changes.
    const [record] = await listCanonicalLearnedSkills('project', context);
    expect(record.manifest.evidence).toHaveLength(2);
  });

  it('resolves active project skills and excludes retired ones while preserving provenance', async () => {
    await commitLearnedSkillPlan(await planLearnedSkillMutation(upsertRequest(projectId), context), context);

    let set = await resolveLearnedSkills(context);
    expect(set.project.map((r) => r.manifest.id)).toEqual([ID]);

    const retired = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(
        { operation: 'retire', scope: 'project', id: ID, retirementReason: 'obsolete' },
        context
      ),
      context
    );
    expect(retired.outcome).toBe('retired');

    set = await resolveLearnedSkills(context);
    expect(set.project).toHaveLength(0);

    const [record] = await listCanonicalLearnedSkills('project', context);
    expect(record.manifest.status).toBe('retired');
    expect(record.manifest.retirementReason).toBe('obsolete');
    expect(record.manifest.evidence.length).toBeGreaterThan(0);
  });

  it('renames a managed record and leaves no source directory', async () => {
    const created = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(projectId), context),
      context
    );
    const store = path.dirname(created.directory!);

    const renamed = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(
        { operation: 'rename', scope: 'project', fromId: ID, toId: 'go-sql-row-locking' },
        context
      ),
      context
    );
    expect(renamed.outcome).toBe('renamed');
    expect(fs.existsSync(path.join(store, ID))).toBe(false);
    expect(fs.existsSync(path.join(store, 'go-sql-row-locking', 'SKILL.md'))).toBe(true);
  });

  it('blocks an over-budget content or evidence set before any write', async () => {
    const overContent = {
      ...upsertRequest(projectId),
      instructions: 'x'.repeat(LEARNED_SKILL_CONTENT_BUDGET + 100),
    };
    const contentPlan = await planLearnedSkillMutation(overContent, context);
    expect(contentPlan.action).toBe('blocked');
    expect(contentPlan.block?.code).toBe('content_budget_exceeded');

    const overEvidence = {
      ...upsertRequest(projectId),
      evidence: Array.from({ length: 800 }, (_unused, index) => evidence(projectId, `change-${index}`)),
    };
    const evidencePlan = await planLearnedSkillMutation(overEvidence, context);
    expect(evidencePlan.action).toBe('blocked');
    expect(evidencePlan.block?.code).toBe('context_budget_exceeded');
  });

  it('refuses to overwrite a human-authored collision and leaves it byte-identical', async () => {
    const home = await resolveProjectHome(projectRoot, { globalDataDir, ensure: false });
    // The catalog is keyed on the project's IDENTITY, not on this clone's
    // machine home — a collision has to be planted where the record would
    // actually be written.
    const humanDir = path.join(
      resolveProjectKnowledgeHome(home!.projectId, { globalDataDir }).catalogDir,
      ID
    );
    fs.mkdirSync(humanDir, { recursive: true });
    fs.writeFileSync(path.join(humanDir, 'SKILL.md'), 'human authored, do not touch\n');
    const before = fs.readFileSync(path.join(humanDir, 'SKILL.md'), 'utf-8');

    const plan = await planLearnedSkillMutation(upsertRequest(projectId), context);
    expect(plan.action).toBe('blocked');
    expect(plan.block?.code).toBe('ownership_collision');

    const result = await commitLearnedSkillPlan(plan, context);
    expect(result.outcome).toBe('blocked');
    expect(fs.readFileSync(path.join(humanDir, 'SKILL.md'), 'utf-8')).toBe(before);
  });

  it('rejects an invalid id before touching disk', async () => {
    const plan = await planLearnedSkillMutation(
      { ...upsertRequest(projectId), id: 'go-lesson' },
      context
    );
    expect(plan.action).toBe('blocked');
    expect(plan.block?.code).toBe('invalid_id');
  });

  it('reports an unregistered project instead of falling back to the repository', async () => {
    const unregistered = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ls-unreg-'));
    fs.mkdirSync(path.join(unregistered, 'rasen'), { recursive: true });
    try {
      const plan = await planLearnedSkillMutation(upsertRequest('some-project'), {
        projectRoot: unregistered,
        globalDataDir,
      });
      expect(plan.action).toBe('blocked');
      expect(plan.block?.code).toBe('unregistered_project');
    } finally {
      fs.rmSync(unregistered, { recursive: true, force: true });
    }
  });

  it('gates global creation on two-project evidence and explicit approval', async () => {
    const second = await makeProject();
    const globalBase = {
      operation: 'upsert' as const,
      scope: 'global' as const,
      id: ID,
      knowledgeKey: 'go-sql-tx-locking',
      description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
      instructions: '## When\n...\n## Steps\n...\n## Done\n...',
      applicability: { mode: 'all' as const, markers: ['go.mod'] },
      evidence: [evidence(projectId)],
    };

    // Promotion draws on EXACT managed records, so each contributing project
    // must actually own one — a projectId in an array is a claim, not evidence.
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(projectId), context),
      context
    );

    const oneProject = await planLearnedSkillMutation(globalBase, context);
    expect(oneProject.action).toBe('blocked');
    expect(oneProject.block?.code).toBe('global_evidence_insufficient');

    const secondContext = { projectRoot: second.root, globalDataDir };
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(second.projectId), secondContext),
      secondContext
    );

    const twoProjects = {
      ...globalBase,
      evidence: [evidence(projectId), evidence(second.projectId)],
    };
    const plan = await planLearnedSkillMutation(twoProjects, context);
    expect(plan.action).toBe('create');
    expect(plan.requiresGlobalApproval).toBe(true);

    const withoutApproval = await commitLearnedSkillPlan(plan, context);
    expect(withoutApproval.outcome).toBe('blocked');
    expect(withoutApproval.block?.code).toBe('global_approval_required');

    const approved = await commitLearnedSkillPlan(plan, { ...context, approveGlobal: true });
    expect(approved.outcome).toBe('created');

    const set = await resolveLearnedSkills(context);
    expect(set.global.map((r) => r.manifest.id)).toContain(ID);
    fs.rmSync(second.root, { recursive: true, force: true });
  });

  /**
   * The rename pair is not atomic against process DEATH — the restore path
   * covers a thrown error only. These reconstruct the exact on-disk states a
   * SIGKILL leaves and assert the next mutation recovers them, because a
   * catalog inside the user's Store repository otherwise keeps the debris in
   * `git status` forever and, in one window, keeps the record's only copy in it.
   */
  describe('debris a killed mutation left behind', () => {
    /** The state a kill between `record -> backup` and `staging -> record` leaves. */
    function simulateKillMidSwap(directory: string): { backup: string; staging: string } {
      const parent = path.dirname(directory);
      const base = path.basename(directory);
      const backup = path.join(parent, `.rasen-learned-skill-backup-${base}-4242-abcdef`);
      const staging = path.join(parent, `.rasen-learned-skill-staging-${base}-4242-abcdef`);
      fs.renameSync(directory, backup);
      fs.mkdirSync(staging, { recursive: true });
      fs.writeFileSync(path.join(staging, 'SKILL.md'), 'half-written\n');
      return { backup, staging };
    }

    it('restores the record the kill left under a backup name, and clears the staging debris', async () => {
      const created = await commitLearnedSkillPlan(
        await planLearnedSkillMutation(upsertRequest(projectId), context),
        context
      );
      const directory = created.directory!;
      const before = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf-8');
      const { backup, staging } = simulateKillMidSwap(directory);
      // Precondition: the record is GONE and its only copy is the backup —
      // which is why a blind sweep of backups would be data loss, not tidying.
      expect(fs.existsSync(directory)).toBe(false);

      const next = await planLearnedSkillMutation(
        { ...upsertRequest(projectId), evidence: [evidence(projectId, 'later-change')] },
        context
      );
      await commitLearnedSkillPlan(next, context);

      expect(fs.existsSync(staging)).toBe(false);
      expect(fs.existsSync(backup)).toBe(false);
      expect(fs.existsSync(directory)).toBe(true);
      expect(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf-8')).toBe(before);
      // Nothing named like debris survives to reach the user's `git status`.
      expect(
        fs.readdirSync(path.dirname(directory)).filter((name) => name.startsWith('.rasen-learned-skill-'))
      ).toEqual([]);
    });

    it('removes a backup whose record is already back in place, keeping the record', async () => {
      const created = await commitLearnedSkillPlan(
        await planLearnedSkillMutation(upsertRequest(projectId), context),
        context
      );
      const directory = created.directory!;
      const body = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf-8');
      // The state a kill AFTER the swap leaves: record present, backup stale.
      const backup = path.join(
        path.dirname(directory),
        `.rasen-learned-skill-backup-${path.basename(directory)}-4242-abcdef`
      );
      fs.cpSync(directory, backup, { recursive: true });

      await commitLearnedSkillPlan(
        await planLearnedSkillMutation(
          { ...upsertRequest(projectId), evidence: [evidence(projectId, 'later-change')] },
          context
        ),
        context
      );

      expect(fs.existsSync(backup)).toBe(false);
      expect(fs.existsSync(directory)).toBe(true);
      expect(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf-8')).toBe(body);
    });

    it('leaves a debris directory it cannot identify strictly alone', async () => {
      const created = await commitLearnedSkillPlan(
        await planLearnedSkillMutation(upsertRequest(projectId), context),
        context
      );
      const unidentifiable = path.join(
        path.dirname(created.directory!),
        '.rasen-learned-skill-backup-mystery-1-x'
      );
      fs.mkdirSync(unidentifiable, { recursive: true });
      fs.writeFileSync(path.join(unidentifiable, 'SKILL.md'), 'no manifest here\n');

      await commitLearnedSkillPlan(
        await planLearnedSkillMutation(
          { ...upsertRequest(projectId), evidence: [evidence(projectId, 'later-change')] },
          context
        ),
        context
      );

      // Nothing may delete a directory whose contents it cannot identify.
      expect(fs.readFileSync(path.join(unidentifiable, 'SKILL.md'), 'utf-8')).toBe('no manifest here\n');
    });
  });

  it('matches path-exists applicability with platform-native existence checks', () => {
    fs.writeFileSync(path.join(projectRoot, 'go.mod'), 'module example\n');
    expect(matchesApplicability({ mode: 'all', markers: ['go.mod'] }, projectRoot)).toBe(true);
    expect(matchesApplicability({ mode: 'all', markers: ['go.mod', 'missing'] }, projectRoot)).toBe(false);
    expect(matchesApplicability({ mode: 'any', markers: ['go.mod', 'missing'] }, projectRoot)).toBe(true);
    expect(matchesApplicability({ mode: 'any', markers: ['nope', 'missing'] }, projectRoot)).toBe(false);
  });

  // --- B2 regression: mixed-protocol contention ---

  it('does NOT evict a live owner-aware lock held for >30s (B2 mixed-protocol)', async () => {
    // Plan a mutation to discover the lockPath.
    const plan = await planLearnedSkillMutation(upsertRequest(projectId), context);
    expect(plan.commit).toBeDefined();
    const lockPath = plan.commit!.lockPath;

    // Pre-populate the lock with a LIVE PID (this process) and set its
    // mtime 31 seconds in the past — simulating a >30s hold by a slow
    // knowledge-bundle import. Pre-fix (legacy acquireFileLock with 30s
    // mtime threshold), this lock would be evicted and the mutation would
    // succeed. Post-fix (acquireOwnerAwareFileLock), the live PID
    // prevents eviction and the mutation times out.
    const liveToken = [
      `pid: ${process.pid}`,
      `bornAt: ${new Date().toISOString()}`,
      'holder: knowledge-bundle-import',
      'nonce: dddddddddddddddddddddddddddddddd',
      '',
    ].join('\n');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, liveToken, 'utf-8');
    const oldTime = new Date(Date.now() - 31_000);
    fs.utimesSync(lockPath, oldTime, oldTime);

    // The mutation must NOT evict the live lock — it must wait and time out.
    // Use a 1s deadline (via context.lockDeadlineMs) so the test proves
    // non-eviction quickly instead of waiting the full 5s default.
    await expect(
      commitLearnedSkillPlan(plan, { ...context, lockDeadlineMs: 1000 })
    ).rejects.toThrow('busy or unwritable');

    // The live lock is untouched — not evicted.
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(liveToken);
  }, 10_000);

  // --- B3 regression: backup-cleanup failure must not cause data loss ---

  it('retains the new record when a rewrite backup cleanup partially fails (B3 site 1)', async () => {
    // Create the initial record.
    const created = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(projectId), context),
      context
    );
    const directory = created.directory!;
    const oldBody = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf-8');
    expect(created.degraded).toBeUndefined();

    // Rewrite with a different evidence chain so the plan is not a no-op.
    const rewritePlan = await planLearnedSkillMutation(
      { ...upsertRequest(projectId), evidence: [evidence(projectId, 'b3-rewrite-change')] },
      context
    );

    backupFail.enabled = true;
    let result;
    try {
      result = await commitLearnedSkillPlan(rewritePlan, context);
    } finally {
      backupFail.enabled = false;
    }

    // The new record is intact and readable.
    expect(result.outcome).toBe('rewritten');
    expect(fs.existsSync(directory)).toBe(true);
    const newBody = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf-8');
    expect(newBody).toBe(oldBody); // content unchanged (same instructions), but manifest evidence differs

    // The degraded warning is reported.
    expect(result.degraded).toBeDefined();
    expect(result.degraded).toContain('debris');

    // The partially-deleted backup was NOT restored over the new record:
    // the new record's manifest is still intact (the backup's was destroyed).
    expect(fs.existsSync(path.join(directory, LEARNED_SKILL_MANIFEST_FILE))).toBe(true);

    // Backup debris exists in the catalog directory (inert, temp-prefixed).
    const debris = fs
      .readdirSync(path.dirname(directory))
      .filter((name) => name.startsWith(LEARNED_SKILL_BACKUP_PREFIX));
    expect(debris.length).toBeGreaterThanOrEqual(1);
  });

  it('retains the new record when a rename backup cleanup partially fails (B3 site 2)', async () => {
    // Create the initial record under the original ID.
    const created = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(projectId), context),
      context
    );
    const store = path.dirname(created.directory!);
    const fromDir = path.join(store, ID);

    // Plan a rename to a new ID.
    const renamePlan = await planLearnedSkillMutation(
      { operation: 'rename', scope: 'project', fromId: ID, toId: 'go-sql-row-locking-b3' },
      context
    );

    backupFail.enabled = true;
    let result;
    try {
      result = await commitLearnedSkillPlan(renamePlan, context);
    } finally {
      backupFail.enabled = false;
    }

    // The rename succeeded — the new record is published.
    expect(result.outcome).toBe('renamed');
    expect(result.degraded).toBeDefined();
    expect(result.degraded).toContain('debris');

    const newDir = path.join(store, 'go-sql-row-locking-b3');
    expect(fs.existsSync(newDir)).toBe(true);
    expect(fs.existsSync(path.join(newDir, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(newDir, LEARNED_SKILL_MANIFEST_FILE))).toBe(true);

    // The old directory was NOT restored — it was moved aside for cleanup.
    expect(fs.existsSync(fromDir)).toBe(false);

    // Backup debris exists in the catalog directory (inert, temp-prefixed).
    const debris = fs
      .readdirSync(store)
      .filter((name) => name.startsWith(LEARNED_SKILL_BACKUP_PREFIX));
    expect(debris.length).toBeGreaterThanOrEqual(1);
  });

  it('reports no degraded warning on a clean rewrite (B3 happy path)', async () => {
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(projectId), context),
      context
    );

    const result = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(
        { ...upsertRequest(projectId), evidence: [evidence(projectId, 'clean-rewrite')] },
        context
      ),
      context
    );

    expect(result.outcome).toBe('rewritten');
    expect(result.degraded).toBeUndefined();
  });

  it('sweeps leftover backup debris on the next mutation (B3 self-healing)', async () => {
    // Create + rewrite with an injected cleanup failure to leave debris.
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation(upsertRequest(projectId), context),
      context
    );
    const rewritePlan = await planLearnedSkillMutation(
      { ...upsertRequest(projectId), evidence: [evidence(projectId, 'debris-leaving-change')] },
      context
    );
    backupFail.enabled = true;
    try {
      await commitLearnedSkillPlan(rewritePlan, context);
    } finally {
      backupFail.enabled = false;
    }

    // Debris exists after the failed cleanup.
    const catalogDir = path.dirname(rewritePlan.commit!.directory);
    const debrisBefore = fs
      .readdirSync(catalogDir)
      .filter((name) => name.startsWith(LEARNED_SKILL_BACKUP_PREFIX));
    expect(debrisBefore.length).toBeGreaterThanOrEqual(1);

    // The next mutation's sweep cleans it up.
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation(
        { ...upsertRequest(projectId), evidence: [evidence(projectId, 'sweep-change')] },
        context
      ),
      context
    );

    const debrisAfter = fs
      .readdirSync(catalogDir)
      .filter((name) => name.startsWith(LEARNED_SKILL_BACKUP_PREFIX));
    expect(debrisAfter).toEqual([]);
  });
});
