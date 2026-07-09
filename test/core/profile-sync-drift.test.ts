import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  hasProjectConfigDrift,
  WORKFLOW_TO_SKILL_DIR,
} from '../../src/core/profile-sync-drift.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS } from '../../src/core/profiles.js';
import { CommandAdapterRegistry, getCommandFileId } from '../../src/core/command-generation/index.js';
import { COMMAND_IDS } from '../../src/core/shared/index.js';

function writeSkill(projectDir: string, workflowId: string): void {
  const skillDirName = WORKFLOW_TO_SKILL_DIR[workflowId as keyof typeof WORKFLOW_TO_SKILL_DIR];
  const skillPath = path.join(projectDir, '.claude', 'skills', skillDirName, 'SKILL.md');
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, `name: ${skillDirName}\n`);
}

function writeCommand(projectDir: string, workflowId: string): void {
  const adapter = CommandAdapterRegistry.get('claude');
  if (!adapter) throw new Error('Claude adapter unavailable in test environment');
  const cmdPath = adapter.getFilePath(getCommandFileId(workflowId));
  const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectDir, cmdPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, `# ${workflowId}\n`);
}

function setupCoreSkills(projectDir: string): void {
  for (const workflow of CORE_WORKFLOWS) {
    writeSkill(projectDir, workflow);
  }
}

function setupCoreCommands(projectDir: string): void {
  for (const workflow of CORE_WORKFLOWS) {
    writeCommand(projectDir, workflow);
  }
}

function setupFullSkills(projectDir: string): void {
  for (const workflow of ALL_WORKFLOWS) {
    writeSkill(projectDir, workflow);
  }
}

function setupFullCommands(projectDir: string): void {
  // Only workflows with a command template (e.g. goal-command) get a command
  // file. Skill-only workflows (e.g. goal-plan/iterate/report) have none.
  for (const workflow of ALL_WORKFLOWS) {
    if (!(COMMAND_IDS as readonly string[]).includes(workflow)) continue;
    writeCommand(projectDir, workflow);
  }
}

function setupCommandsFirstSkills(projectDir: string): void {
  // Under commands-first, only skill-only workflows (no command counterpart,
  // e.g. goal-plan/iterate/report) keep a skill dir — command-counterpart
  // workflows are replaced by their command and have no skill dir.
  for (const workflow of ALL_WORKFLOWS) {
    if ((COMMAND_IDS as readonly string[]).includes(workflow)) continue;
    writeSkill(projectDir, workflow);
  }
}

describe('WORKFLOW_TO_SKILL_DIR', () => {
  it('maps the goal-loop workflow family to their rasen-goal* skill directories', () => {
    expect(WORKFLOW_TO_SKILL_DIR['goal-plan']).toBe('rasen-goal-plan');
    expect(WORKFLOW_TO_SKILL_DIR['goal-iterate']).toBe('rasen-goal-iterate');
    expect(WORKFLOW_TO_SKILL_DIR['goal-report']).toBe('rasen-goal-report');
    expect(WORKFLOW_TO_SKILL_DIR['goal-command']).toBe('rasen-goal');
  });
});

describe('profile sync drift detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `rasen-profile-sync-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(tempDir, 'rasen'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects drift for skills-only delivery when commands still exist', () => {
    setupCoreSkills(tempDir);
    setupCoreCommands(tempDir);

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS, 'skills');
    expect(hasDrift).toBe(true);
  });

  it('detects drift for commands-only delivery when skills still exist', () => {
    setupCoreCommands(tempDir);
    setupCoreSkills(tempDir);

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS, 'commands');
    expect(hasDrift).toBe(true);
  });

  it('detects drift when required profile workflow files are missing', () => {
    writeSkill(tempDir, 'explore');

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS, 'both');
    expect(hasDrift).toBe(true);
  });

  it('returns false when project files match core profile and delivery', () => {
    setupCoreSkills(tempDir);
    setupCoreCommands(tempDir);

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS, 'both');
    expect(hasDrift).toBe(false);
  });

  it('detects drift when extra workflows are installed for both delivery', () => {
    setupCoreSkills(tempDir);
    setupCoreCommands(tempDir);
    writeSkill(tempDir, 'new');
    writeCommand(tempDir, 'new');

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS, 'both');
    expect(hasDrift).toBe(true);
  });

  it('returns false for the full profile after a clean install, including the skill-only goal-loop stage workflows', () => {
    setupFullSkills(tempDir);
    setupFullCommands(tempDir);

    const hasDrift = hasProjectConfigDrift(tempDir, ALL_WORKFLOWS, 'both');
    expect(hasDrift).toBe(false);
  });

  it('returns false for the full profile under commands-first after a clean install, sparing skill-only goal-loop stage workflows', () => {
    setupCommandsFirstSkills(tempDir);
    setupFullCommands(tempDir);

    const hasDrift = hasProjectConfigDrift(tempDir, ALL_WORKFLOWS, 'commands-first');
    expect(hasDrift).toBe(false);
  });
});
