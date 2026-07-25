import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';

import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';
import {
  commitLearnedSkillPlan,
  digestContent,
  planLearnedSkillMutation,
  serializeManifest,
  type LearnedSkillMutationRequest,
} from '../../src/core/learned-skills/index.js';
import { readWorkflowArtifactLedger } from '../../src/core/workflow-artifact-ledger.js';
import { readProjectLearnedLedger } from '../../src/core/project-learned-skill-ledger.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { appendStoreReference } from '../../src/core/project-config.js';
import { commitStoreRegistration, registerStore } from '../../src/core/store/registry.js';

const { confirmMock, showWelcomeScreenMock, searchableMultiSelectMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  showWelcomeScreenMock: vi.fn().mockResolvedValue(undefined),
  searchableMultiSelectMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({ confirm: confirmMock }));
vi.mock('../../src/ui/welcome-screen.js', () => ({ showWelcomeScreen: showWelcomeScreenMock }));
vi.mock('../../src/prompts/searchable-multi-select.js', () => ({ searchableMultiSelect: searchableMultiSelectMock }));

const LEARNED_ID = 'typescript-cli-i18n-diagnostic-routing';

function loggedOutput(): string {
  return (console.log as ReturnType<typeof vi.fn>).mock.calls.map((call) => call.join(' ')).join('\n');
}

async function commitProjectSkill(projectRoot: string): Promise<void> {
  const home = await resolveProjectHome(projectRoot);
  const request: LearnedSkillMutationRequest = {
    operation: 'upsert',
    scope: 'project',
    id: LEARNED_ID,
    knowledgeKey: `key-${LEARNED_ID}`,
    description: 'Route diagnostics through the locale catalogs.',
    instructions: '## When\nEditing i18n routing.\n## Steps\nAdd every locale key.\n## Done\nParity test passes.',
    applicability: { mode: 'all', markers: ['package.json'] },
    evidence: [{ projectId: home!.projectId, change: 'add-thing', artifact: 'proposal', digest: `sha256:${'a'.repeat(64)}` }],
  };
  const context = { projectRoot };
  const result = await commitLearnedSkillPlan(await planLearnedSkillMutation(request, context), context);
  if (result.outcome === 'blocked') {
    throw new Error(`commit blocked: ${result.block?.code} ${result.block?.message}`);
  }
}

function writeStoreSkill(
  storeRoot: string,
  storeId: string,
  id: string,
  body: string
): void {
  const content = `---\nname: ${id}\n---\n\n${body}\n`;
  const directory = path.join(storeRoot, 'rasen', 'learned-skills', id);
  fsSync.mkdirSync(directory, { recursive: true });
  fsSync.writeFileSync(
    path.join(directory, 'learned-skill.yaml'),
    serializeManifest({
      version: 2,
      scope: 'store',
      owner: { type: 'store', id: storeId },
      id,
      knowledgeKey: `key-${id}`,
      status: 'active',
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(content),
      description: `Shared guidance for ${id}.`,
      applicability: { mode: 'all', markers: ['package.json'] },
      evidence: [],
      sources: [],
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    })
  );
  fsSync.writeFileSync(path.join(directory, 'SKILL.md'), content);
}

describe('init/update learned-skill wiring', () => {
  let testDir: string;
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'rasen-iul-'));
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    configTempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'rasen-iul-config-'));
    process.env.XDG_CONFIG_HOME = configTempDir;
    dataTempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'rasen-iul-data-'));
    process.env.XDG_DATA_HOME = dataTempDir;
    // The applicability marker every fixture skill keys off.
    await fs.writeFile(path.join(testDir, 'package.json'), '{}\n');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    await fs.rm(dataTempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('generates the rasen-retro compatibility wrapper (user-invoked report alias)', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const wrapper = path.join(testDir, '.claude', 'skills', 'rasen-retro', 'SKILL.md');
    expect(fsSync.existsSync(wrapper)).toBe(true);
    const content = fsSync.readFileSync(wrapper, 'utf-8');
    expect(content).toContain('disable-model-invocation: true');
    expect(content).toContain('report');
  });

  it('materializes an applicable project learned skill on a subsequent init', async () => {
    // First init registers the machine home so the project store resolves.
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await commitProjectSkill(testDir);

    // Re-running init (extend mode) materializes the now-applicable skill.
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const materialized = path.join(testDir, '.claude', 'skills', LEARNED_ID, 'SKILL.md');
    expect(fsSync.existsSync(materialized)).toBe(true);
    const learnedLedger = readProjectLearnedLedger(testDir)!;
    expect(learnedLedger.tools.claude.learned?.[LEARNED_ID]?.effectiveScope).toBe('project');
    // Learned ids never enter the workflow list.
    expect(readWorkflowArtifactLedger(testDir)?.workflows ?? []).not.toContain(LEARNED_ID);
  });

  it('reports a learned-only reconciliation without saying "Already up to date"', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await commitProjectSkill(testDir);

    (console.log as ReturnType<typeof vi.fn>).mockClear();
    await new UpdateCommand({}).execute(testDir);

    const output = loggedOutput();
    expect(output).toMatch(/Learned skills|学习技能|学習スキル/);
    expect(output).not.toContain('Already up to date');
    const materialized = path.join(testDir, '.claude', 'skills', LEARNED_ID, 'SKILL.md');
    expect(fsSync.existsSync(materialized)).toBe(true);
  });

  it('reports an already-reconciled learned no-op without rewriting its file or ledger', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await commitProjectSkill(testDir);
    await new UpdateCommand({}).execute(testDir);
    const materialized = path.join(testDir, '.claude', 'skills', LEARNED_ID, 'SKILL.md');
    const ledger = path.join(testDir, 'rasen', '.learned-skill-materializations.json');
    const stableTime = new Date('2001-01-01T00:00:00.000Z');
    fsSync.utimesSync(materialized, stableTime, stableTime);
    fsSync.utimesSync(ledger, stableTime, stableTime);
    const fileBefore = fsSync.readFileSync(materialized, 'utf8');
    const ledgerBefore = fsSync.readFileSync(ledger, 'utf8');

    (console.log as ReturnType<typeof vi.fn>).mockClear();
    await new UpdateCommand({}).execute(testDir);
    const output = loggedOutput();

    expect(output).toMatch(
      /Learned skills: already reconciled|学習スキルは調整済み|学习技能已完成对齐/
    );
    expect(fsSync.readFileSync(materialized, 'utf8')).toBe(fileBefore);
    expect(fsSync.readFileSync(ledger, 'utf8')).toBe(ledgerBefore);
    expect(fsSync.statSync(materialized).mtimeMs).toBe(stableTime.getTime());
    expect(fsSync.statSync(ledger).mtimeMs).toBe(stableTime.getTime());
  });

  it('prunes a retired learned skill on update and does not touch workflow skills', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await commitProjectSkill(testDir);
    await new UpdateCommand({}).execute(testDir);
    const materialized = path.join(testDir, '.claude', 'skills', LEARNED_ID, 'SKILL.md');
    expect(fsSync.existsSync(materialized)).toBe(true);

    // Retire the skill, then update again — the materialized copy is pruned.
    const context = { projectRoot: testDir };
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation({ operation: 'retire', scope: 'project', id: LEARNED_ID }, context),
      context
    );
    await new UpdateCommand({}).execute(testDir);

    expect(fsSync.existsSync(materialized)).toBe(false);
    // A core workflow skill is still present.
    expect(fsSync.existsSync(path.join(testDir, '.claude', 'skills', 'rasen-apply-change', 'SKILL.md'))).toBe(true);
  });

  it('installs an effective explicit member-store skill through update', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await commitStoreRegistration({
      id: 'web',
      type: 'project',
      backend: { type: 'git', local_path: testDir },
      writeMetadataIfMissing: true,
    });
    const storeRoot = path.join(dataTempDir, 'fixture-store-team');
    fsSync.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fsSync.mkdirSync(path.join(storeRoot, 'rasen', 'changes', 'archive'), {
      recursive: true,
    });
    fsSync.writeFileSync(
      path.join(storeRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\n'
    );
    await registerStore({ id: 'team', localPath: storeRoot });
    appendStoreReference(storeRoot, 'web', { type: 'project' });
    const id = 'typescript-store-shared-routing';
    writeStoreSkill(storeRoot, 'team', id, 'Use the shared store route.');

    await new UpdateCommand({}).execute(testDir);

    const target = path.join(testDir, '.claude', 'skills', id, 'SKILL.md');
    expect(fsSync.existsSync(target)).toBe(true);
    expect(fsSync.readFileSync(target, 'utf8')).toContain('learnedSkillScope: "store"');
    expect(readProjectLearnedLedger(testDir)?.tools.claude.learned[id]?.sources).toEqual([
      { owner: { type: 'store', id: 'team' }, id },
    ]);
  });

  it('reports a deterministic member-store conflict without learned writes', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await commitStoreRegistration({
      id: 'web',
      type: 'project',
      backend: { type: 'git', local_path: testDir },
      writeMetadataIfMissing: true,
    });
    const id = 'typescript-store-conflict-routing';
    for (const [storeId, body] of [
      ['alpha', 'Use alpha routing.'],
      ['beta', 'Use beta routing.'],
    ] as const) {
      const storeRoot = path.join(dataTempDir, `fixture-store-${storeId}`);
      fsSync.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
      fsSync.mkdirSync(path.join(storeRoot, 'rasen', 'changes', 'archive'), {
        recursive: true,
      });
      fsSync.writeFileSync(
        path.join(storeRoot, 'rasen', 'config.yaml'),
        'schema: spec-driven\n'
      );
      await registerStore({ id: storeId, localPath: storeRoot });
      appendStoreReference(storeRoot, 'web', { type: 'project' });
      writeStoreSkill(storeRoot, storeId, id, body);
    }

    (console.log as ReturnType<typeof vi.fn>).mockClear();
    await new UpdateCommand({}).execute(testDir);
    const output = loggedOutput();

    expect(output).toMatch(/conflict|冲突|競合/i);
    expect(output).toContain('store:alpha');
    expect(output).toContain('store:beta');
    expect(fsSync.existsSync(path.join(testDir, '.claude', 'skills', id, 'SKILL.md'))).toBe(
      false
    );
    expect(readProjectLearnedLedger(testDir)).toBeNull();
  });
});
