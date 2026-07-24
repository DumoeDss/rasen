import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import path from 'path';
import os from 'os';

import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';
import {
  commitLearnedSkillPlan,
  planLearnedSkillMutation,
  type LearnedSkillMutationRequest,
} from '../../src/core/learned-skills/index.js';
import { readWorkflowArtifactLedger } from '../../src/core/workflow-artifact-ledger.js';

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
  const request: LearnedSkillMutationRequest = {
    operation: 'upsert',
    scope: 'project',
    id: LEARNED_ID,
    knowledgeKey: `key-${LEARNED_ID}`,
    description: 'Route diagnostics through the locale catalogs.',
    instructions: '## When\nEditing i18n routing.\n## Steps\nAdd every locale key.\n## Done\nParity test passes.',
    applicability: { mode: 'all', markers: ['package.json'] },
    evidence: [{ projectId: 'p', change: 'add-thing', artifact: 'proposal', digest: `sha256:${'a'.repeat(64)}` }],
  };
  const context = { projectRoot };
  const result = await commitLearnedSkillPlan(await planLearnedSkillMutation(request, context), context);
  if (result.outcome === 'blocked') {
    throw new Error(`commit blocked: ${result.block?.code} ${result.block?.message}`);
  }
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
    const ledger = readWorkflowArtifactLedger(testDir)!;
    expect(ledger.tools.claude.learned?.[LEARNED_ID]?.skillScope).toBe('project');
    // Learned ids never enter the workflow list.
    expect(ledger.workflows).not.toContain(LEARNED_ID);
  });

  it('reports a learned-only reconciliation without saying "Already up to date"', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    await commitProjectSkill(testDir);

    (console.log as ReturnType<typeof vi.fn>).mockClear();
    await new UpdateCommand({}).execute(testDir);

    const output = loggedOutput();
    expect(output).toContain('Learned skills');
    expect(output).not.toContain('Already up to date');
    const materialized = path.join(testDir, '.claude', 'skills', LEARNED_ID, 'SKILL.md');
    expect(fsSync.existsSync(materialized)).toBe(true);
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
});
