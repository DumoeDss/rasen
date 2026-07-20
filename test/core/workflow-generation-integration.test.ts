import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveGlobalConfig } from '../../src/core/global-config.js';
import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';
import { importWorkflow, scaffoldWorkflow } from '../../src/core/workflow-library.js';
import { readWorkflowArtifactLedger } from '../../src/core/workflow-artifact-ledger.js';
import { getUserWorkflowsDir, loadWorkflowCatalog } from '../../src/core/workflow-registry/index.js';

describe('user workflow generation integration', () => {
  let project: string;
  let configHome: string;
  let dataHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-user-generation-project-'));
    configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-user-generation-config-'));
    dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-user-generation-data-'));
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.XDG_DATA_HOME = dataHome;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(configHome, { recursive: true, force: true });
    fs.rmSync(dataHome, { recursive: true, force: true });
  });

  async function installCommandWorkflow(): Promise<void> {
    const draft = scaffoldWorkflow(
      'team-delivery',
      path.join(dataHome, 'drafts', 'team-delivery')
    );
    const manifestPath = path.join(draft, 'workflow.yaml');
    const manifest = fs.readFileSync(manifestPath, 'utf8')
      .replace(
        'command:\n  enabled: false',
        [
          'command:',
          '  enabled: true',
          '  name: Team delivery',
          '  category: Workflow',
          '  tags: [team, delivery]',
        ].join('\n')
      )
      .replace('  sidecars: []', '  sidecars: ["references/checklist.md"]');
    fs.writeFileSync(manifestPath, manifest);
    fs.mkdirSync(path.join(draft, 'references'), { recursive: true });
    fs.writeFileSync(path.join(draft, 'references', 'checklist.md'), 'checklist v1\n');
    await importWorkflow(draft);
  }

  it('generates, refreshes, and safely cleans user workflow artifacts', async () => {
    await installCommandWorkflow();
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['team-delivery'],
    });

    await new InitCommand({ tools: 'claude', force: true }).execute(project);

    const skillDir = path.join(project, '.claude', 'skills', 'rasen-team-delivery');
    const skillPath = path.join(skillDir, 'SKILL.md');
    const sidecarPath = path.join(skillDir, 'references', 'checklist.md');
    const commandPath = path.join(project, '.claude', 'commands', 'rasen', 'team-delivery.md');
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.readFileSync(sidecarPath, 'utf8')).toBe('checklist v1\n');
    expect(fs.existsSync(commandPath)).toBe(true);
    expect(readWorkflowArtifactLedger(project)?.workflows).toEqual(['team-delivery']);

    const installedSkill = path.join(getUserWorkflowsDir(), 'team-delivery', 'SKILL.md');
    fs.appendFileSync(installedSkill, '\nUpdated source instructions.\n');
    const changedDigest = loadWorkflowCatalog().get('team-delivery')!.digest;
    await new UpdateCommand().execute(project);
    expect(fs.readFileSync(skillPath, 'utf8')).toContain('Updated source instructions.');
    expect(
      readWorkflowArtifactLedger(project)?.tools.claude.workflows['team-delivery'].digest
    ).toBe(changedDigest);

    const unmanagedPath = path.join(skillDir, 'notes.md');
    fs.writeFileSync(unmanagedPath, 'user-owned\n');
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: [],
    });
    await new UpdateCommand().execute(project);

    expect(fs.existsSync(skillPath)).toBe(false);
    expect(fs.existsSync(sidecarPath)).toBe(false);
    expect(fs.existsSync(commandPath)).toBe(false);
    expect(fs.readFileSync(unmanagedPath, 'utf8')).toBe('user-owned\n');
    expect(readWorkflowArtifactLedger(project)).toBeNull();
  });
});
