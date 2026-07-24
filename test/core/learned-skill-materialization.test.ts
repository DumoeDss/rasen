import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveProjectHome } from '../../src/core/project-home.js';
import {
  commitLearnedSkillPlan,
  planLearnedSkillMutation,
  resolveLearnedSkills,
  type EvidenceReference,
  type LearnedSkillContext,
  type LearnedSkillMutationRequest,
} from '../../src/core/learned-skills/index.js';
import {
  reconcileGlobalLearnedSkillsForTool,
  reconcileProjectLearnedSkillsForTool,
} from '../../src/core/learned-skill-materialization.js';
import { readWorkflowArtifactLedger } from '../../src/core/workflow-artifact-ledger.js';
import { readGlobalLearnedArtifacts } from '../../src/core/global-learned-skill-ledger.js';
import { pruneRetiredRetentionSkillDirs } from '../../src/core/legacy-cleanup.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const evidence = (projectId: string, change = 'add-thing', artifact = 'proposal'): EvidenceReference => ({
  projectId,
  change,
  artifact,
  digest: DIGEST,
});

const PROJECT_ID = 'typescript-cli-i18n-diagnostic-routing';

describe('learned-skill materialization', () => {
  let globalDataDir: string;
  let projectRoot: string;
  let projectId: string;
  let context: LearnedSkillContext;
  let skillsRoot: string;

  async function makeProject(): Promise<{ root: string; projectId: string }> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-lsm-proj-'));
    fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, projectId: home!.projectId };
  }

  async function commit(request: LearnedSkillMutationRequest, ctx: LearnedSkillContext = context): Promise<void> {
    const plan = await planLearnedSkillMutation(request, ctx);
    const result = await commitLearnedSkillPlan(plan, ctx);
    if (result.outcome === 'blocked') {
      throw new Error(`commit blocked: ${result.block?.code} ${result.block?.message}`);
    }
  }

  const projectUpsert = (
    id: string,
    markers: string[],
    instructions = '## When\nEditing i18n routing.\n## Steps\nAdd every locale key.\n## Done\nParity test passes.'
  ): LearnedSkillMutationRequest => ({
    operation: 'upsert',
    scope: 'project',
    id,
    knowledgeKey: `key-${id}`,
    description: 'Route diagnostics through the locale catalogs.',
    instructions,
    applicability: { mode: 'all', markers },
    evidence: [evidence(projectId)],
  });

  beforeEach(async () => {
    globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-lsm-gdd-'));
    const project = await makeProject();
    projectRoot = project.root;
    projectId = project.projectId;
    context = { projectRoot, globalDataDir };
    skillsRoot = path.join(projectRoot, '.claude', 'skills');
    // The applicability marker used by most cases.
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
  });

  afterEach(() => {
    fs.rmSync(globalDataDir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  async function reconcile() {
    const resolved = await resolveLearnedSkills(context);
    return reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      resolved,
    });
  }

  const targetFile = (id: string): string => path.join(skillsRoot, id, 'SKILL.md');

  it.runIf(process.platform !== 'win32')(
    'skips a symlinked target instead of writing through it (byte-for-byte preservation)',
    async () => {
      await commit(projectUpsert(PROJECT_ID, ['package.json']));

      // Plant a symlink where the materialized SKILL.md would go, pointing at an
      // out-of-home file that must never be clobbered by writing through the link.
      const outside = path.join(projectRoot, 'precious.txt');
      fs.writeFileSync(outside, 'do not touch\n');
      const dir = path.join(skillsRoot, PROJECT_ID);
      fs.mkdirSync(dir, { recursive: true });
      fs.symlinkSync(outside, targetFile(PROJECT_ID));

      const result = await reconcile();

      expect(result.created).toEqual([]);
      expect(result.skipped.map((entry) => entry.id)).toContain(PROJECT_ID);
      // The symlink and its target are untouched.
      expect(fs.readFileSync(outside, 'utf-8')).toBe('do not touch\n');
      expect(fs.lstatSync(targetFile(PROJECT_ID)).isSymbolicLink()).toBe(true);
    }
  );

  it.runIf(process.platform !== 'win32')(
    'skips an in-place refresh through a symlinked <id> directory (never writes through the link)',
    async () => {
      await commit(projectUpsert(PROJECT_ID, ['package.json']));
      await reconcile(); // materialize v1
      const dir = path.join(skillsRoot, PROJECT_ID);
      const materializedBefore = fs.readFileSync(targetFile(PROJECT_ID), 'utf-8');

      // Relocate the owned dir and symlink `<id>` at it: the regular SKILL.md
      // inside still byte-matches the ledger (ownership holds), but the id dir
      // is now a symlink.
      const relocated = path.join(projectRoot, 'relocated-skill');
      fs.renameSync(dir, relocated);
      fs.symlinkSync(relocated, dir, 'dir');

      // Change the canonical content so a refresh would be attempted.
      await commit(
        projectUpsert(PROJECT_ID, ['package.json'], '## When\nDifferent.\n## Steps\nChanged.\n## Done\nDone.')
      );
      const result = await reconcile();

      expect(result.updated).toEqual([]);
      expect(result.skipped.map((entry) => entry.id)).toContain(PROJECT_ID);
      // The relocated file is NOT rewritten through the symlink.
      expect(fs.readFileSync(path.join(relocated, 'SKILL.md'), 'utf-8')).toBe(materializedBefore);
    }
  );

  it('materializes an applicable project skill, records the ledger, and stamps ownership frontmatter', async () => {
    await commit(projectUpsert(PROJECT_ID, ['package.json']));

    const result = await reconcile();

    expect(result.created.map((entry) => entry.id)).toEqual([PROJECT_ID]);
    const materialized = targetFile(PROJECT_ID);
    expect(fs.existsSync(materialized)).toBe(true);
    const content = fs.readFileSync(materialized, 'utf-8');
    expect(content).toContain('generatedBy: "rasen-learned-skill"');
    expect(content).toContain('learnedSkillScope: "project"');
    expect(content).toContain(`learnedSkillId: "${PROJECT_ID}"`);

    const ledger = readWorkflowArtifactLedger(projectRoot)!;
    const entry = ledger.tools.claude.learned?.[PROJECT_ID];
    expect(entry?.skillScope).toBe('project');
    expect(entry?.file.path).toBe(`.claude/skills/${PROJECT_ID}/SKILL.md`);

    // Re-running is idempotent — no further create/update/remove.
    const rerun = await reconcile();
    expect(rerun.created).toHaveLength(0);
    expect(rerun.updated).toHaveLength(0);
    expect(rerun.removed).toHaveLength(0);
  });

  it('does not materialize a skill whose applicability markers do not match', async () => {
    await commit(projectUpsert(PROJECT_ID, ['go.mod']));

    const result = await reconcile();

    expect(result.created).toHaveLength(0);
    expect(fs.existsSync(targetFile(PROJECT_ID))).toBe(false);
    expect(readWorkflowArtifactLedger(projectRoot)).toBeNull();
  });

  it('refreshes the exact generated copy when the canonical content changes', async () => {
    await commit(projectUpsert(PROJECT_ID, ['package.json']));
    await reconcile();
    const before = fs.readFileSync(targetFile(PROJECT_ID), 'utf-8');

    // Rewrite the canonical skill (new evidence + new instructions).
    await commit({
      ...projectUpsert(PROJECT_ID, ['package.json'], '## When\nEditing i18n routing.\n## Steps\nAdd EVERY locale key AND update the sweep.\n## Done\nSweep + parity pass.'),
      evidence: [evidence(projectId, 'add-second-change')],
    } as LearnedSkillMutationRequest);

    const result = await reconcile();

    expect(result.updated.map((entry) => entry.id)).toEqual([PROJECT_ID]);
    const after = fs.readFileSync(targetFile(PROJECT_ID), 'utf-8');
    expect(after).not.toBe(before);
    expect(after).toContain('update the sweep');
  });

  it('prunes the exact generated copy when the skill is retired', async () => {
    await commit(projectUpsert(PROJECT_ID, ['package.json']));
    await reconcile();
    expect(fs.existsSync(targetFile(PROJECT_ID))).toBe(true);

    await commit({ operation: 'retire', scope: 'project', id: PROJECT_ID, retirementReason: 'obsolete' });

    const result = await reconcile();

    expect(result.removed.map((entry) => entry.id)).toEqual([PROJECT_ID]);
    expect(fs.existsSync(targetFile(PROJECT_ID))).toBe(false);
    // Empty parent directory is pruned too.
    expect(fs.existsSync(path.join(skillsRoot, PROJECT_ID))).toBe(false);
    expect(readWorkflowArtifactLedger(projectRoot)?.tools.claude?.learned?.[PROJECT_ID]).toBeUndefined();
  });

  it('refuses a human-authored collision and leaves it byte-for-byte unchanged', async () => {
    await commit(projectUpsert(PROJECT_ID, ['package.json']));
    // A human authors a skill at the same target name before reconciliation.
    const humanDir = path.join(skillsRoot, PROJECT_ID);
    fs.mkdirSync(humanDir, { recursive: true });
    const humanBody = '---\nname: mine\n---\n\nhuman authored — do not touch\n';
    fs.writeFileSync(path.join(humanDir, 'SKILL.md'), humanBody);

    const result = await reconcile();

    expect(result.created).toHaveLength(0);
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['collision']);
    expect(fs.readFileSync(targetFile(PROJECT_ID), 'utf-8')).toBe(humanBody);
    // No ledger ownership was claimed over the human file.
    expect(readWorkflowArtifactLedger(projectRoot)?.tools.claude?.learned?.[PROJECT_ID]).toBeUndefined();
  });

  it('preserves a generated copy the user has since edited (no overwrite)', async () => {
    await commit(projectUpsert(PROJECT_ID, ['package.json']));
    await reconcile();
    const edited = '---\nname: edited\n---\n\nuser edited this generated copy\n';
    fs.writeFileSync(targetFile(PROJECT_ID), edited);

    const result = await reconcile();

    expect(result.skipped.map((entry) => entry.reason)).toEqual(['collision']);
    expect(fs.readFileSync(targetFile(PROJECT_ID), 'utf-8')).toBe(edited);
  });

  it('resolves nothing for an unregistered project without a machine home', async () => {
    const unregistered = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-lsm-unreg-'));
    fs.mkdirSync(path.join(unregistered, 'rasen'), { recursive: true });
    try {
      const resolved = await resolveLearnedSkills({ projectRoot: unregistered, globalDataDir });
      const result = reconcileProjectLearnedSkillsForTool({
        projectRoot: unregistered,
        toolId: 'claude',
        toolLabel: 'Claude Code',
        skillsRoot: path.join(unregistered, '.claude', 'skills'),
        resolved,
      });
      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    } finally {
      fs.rmSync(unregistered, { recursive: true, force: true });
    }
  });

  describe('global-only tool home (Hermes)', () => {
    let hermesSkills: string;
    let secondRoot: string;

    async function createGlobalSkill(): Promise<string> {
      const second = await makeProject();
      secondRoot = second.root;
      const id = 'go-sql-transaction-locking';
      const globalRequest: LearnedSkillMutationRequest = {
        operation: 'upsert',
        scope: 'global',
        id,
        knowledgeKey: 'go-sql-tx-locking',
        description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
        instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
        applicability: { mode: 'all', markers: ['go.mod'] },
        evidence: [evidence(projectId), evidence(second.projectId)],
      };
      await commit(globalRequest, { ...context, approveGlobal: true });
      return id;
    }

    beforeEach(() => {
      hermesSkills = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-lsm-hermes-'));
    });

    afterEach(() => {
      fs.rmSync(hermesSkills, { recursive: true, force: true });
      if (secondRoot) fs.rmSync(secondRoot, { recursive: true, force: true });
    });

    it('reconciles global skills, tracks them in the global ledger, and skips project-scoped skills with a warning', async () => {
      const globalId = await createGlobalSkill();
      await commit(projectUpsert(PROJECT_ID, ['package.json']));

      const resolved = await resolveLearnedSkills(context);
      const result = reconcileGlobalLearnedSkillsForTool({
        toolId: 'hermes',
        toolLabel: 'Hermes',
        skillsRoot: hermesSkills,
        resolved,
        globalDataDir,
      });

      // Global skill materialized into the Hermes home.
      expect(result.created.map((entry) => entry.id)).toEqual([globalId]);
      expect(fs.existsSync(path.join(hermesSkills, globalId, 'SKILL.md'))).toBe(true);
      // Project-scoped skill skipped with a global-only-home diagnostic.
      const projectSkip = result.skipped.find((entry) => entry.id === PROJECT_ID);
      expect(projectSkip?.reason).toBe('global-only-home');
      // Tracked in the machine-global ledger, not the project ledger.
      const globalLedger = readGlobalLearnedArtifacts(globalDataDir, 'hermes');
      expect(Object.keys(globalLedger)).toEqual([globalId]);
      expect(globalLedger[globalId].path).toBe(path.join(hermesSkills, globalId, 'SKILL.md'));
    });

    it('does not remove a shared global copy because another project\'s markers do not match', async () => {
      const globalId = await createGlobalSkill();
      const resolvedOne = await resolveLearnedSkills(context);
      reconcileGlobalLearnedSkillsForTool({
        toolId: 'hermes',
        toolLabel: 'Hermes',
        skillsRoot: hermesSkills,
        resolved: resolvedOne,
        globalDataDir,
      });
      expect(fs.existsSync(path.join(hermesSkills, globalId, 'SKILL.md'))).toBe(true);

      // A different project whose applicability markers do NOT match reconciles
      // the same shared Hermes home — the global copy MUST survive.
      const resolvedTwo = await resolveLearnedSkills({ projectRoot: secondRoot, globalDataDir });
      const result = reconcileGlobalLearnedSkillsForTool({
        toolId: 'hermes',
        toolLabel: 'Hermes',
        skillsRoot: hermesSkills,
        resolved: resolvedTwo,
        globalDataDir,
      });

      expect(result.removed).toHaveLength(0);
      expect(fs.existsSync(path.join(hermesSkills, globalId, 'SKILL.md'))).toBe(true);
    });
  });

  describe('retired retention skill-dir cleanup', () => {
    it('removes an exact retired dir while preserving the current compatibility wrapper', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-lsm-retro-'));
      try {
        fs.mkdirSync(path.join(root, 'rasen-retro'), { recursive: true });
        fs.writeFileSync(path.join(root, 'rasen-retro', 'SKILL.md'), 'wrapper\n');
        fs.mkdirSync(path.join(root, 'rasen-retro-old'), { recursive: true });
        fs.writeFileSync(path.join(root, 'rasen-retro-old', 'SKILL.md'), 'retired\n');
        fs.mkdirSync(path.join(root, 'rasen-retrospective'), { recursive: true });

        const removed = await pruneRetiredRetentionSkillDirs(
          root,
          ['rasen-retro'],
          ['rasen-retro', 'rasen-retro-old']
        );

        expect(removed).toEqual(['rasen-retro-old']);
        // The current wrapper survives.
        expect(fs.existsSync(path.join(root, 'rasen-retro'))).toBe(true);
        // A similarly named dir NOT in the retirement set is untouched.
        expect(fs.existsSync(path.join(root, 'rasen-retrospective'))).toBe(true);
        // The exact retired dir is gone.
        expect(fs.existsSync(path.join(root, 'rasen-retro-old'))).toBe(false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
