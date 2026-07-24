import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveProjectHome } from '../../../src/core/project-home.js';
import {
  commitLearnedSkillPlan,
  listCanonicalLearnedSkills,
  matchesApplicability,
  planLearnedSkillMutation,
  resolveLearnedSkills,
  LEARNED_SKILL_CONTENT_BUDGET,
  type EvidenceReference,
  type LearnedSkillContext,
} from '../../../src/core/learned-skills/index.js';

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
    const humanDir = path.join(home!.homeDir, 'learned-skills', ID);
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

    const oneProject = await planLearnedSkillMutation(globalBase, context);
    expect(oneProject.action).toBe('blocked');
    expect(oneProject.block?.code).toBe('global_evidence_insufficient');

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

  it('matches path-exists applicability with platform-native existence checks', () => {
    fs.writeFileSync(path.join(projectRoot, 'go.mod'), 'module example\n');
    expect(matchesApplicability({ mode: 'all', markers: ['go.mod'] }, projectRoot)).toBe(true);
    expect(matchesApplicability({ mode: 'all', markers: ['go.mod', 'missing'] }, projectRoot)).toBe(false);
    expect(matchesApplicability({ mode: 'any', markers: ['go.mod', 'missing'] }, projectRoot)).toBe(true);
    expect(matchesApplicability({ mode: 'any', markers: ['nope', 'missing'] }, projectRoot)).toBe(false);
  });
});
