import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import {
  getCommandFileId,
  getLegacyCommandFilePath,
  getCommandFilePathCandidates,
  generateCommand,
  claudeAdapter,
} from '../../../src/core/command-generation/index.js';
import { getCommandContents } from '../../../src/core/shared/skill-generation.js';
import { InitCommand } from '../../../src/core/init.js';
import { saveGlobalConfig } from '../../../src/core/global-config.js';
import { hasToolProfileOrDeliveryDrift } from '../../../src/core/profile-sync-drift.js';

const { confirmMock, showWelcomeScreenMock, searchableMultiSelectMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  showWelcomeScreenMock: vi.fn().mockResolvedValue(undefined),
  searchableMultiSelectMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: confirmMock,
}));

vi.mock('../../../src/ui/welcome-screen.js', () => ({
  showWelcomeScreen: showWelcomeScreenMock,
}));

vi.mock('../../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: searchableMultiSelectMock,
}));

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const FUSION_WORKFLOWS = [
  ['office-hours-command', 'office-hours'],
  ['verify-enhanced-command', 'verify-enhanced'],
  ['ship-command', 'ship'],
  ['retro-command', 'retro'],
  ['auto-command', 'auto'],
] as const;

describe('command file id mapping', () => {
  it('strips the -command suffix from fusion workflow ids', () => {
    for (const [workflowId, fileId] of FUSION_WORKFLOWS) {
      expect(getCommandFileId(workflowId)).toBe(fileId);
    }
  });

  it('leaves plain workflow ids unchanged', () => {
    for (const id of ['explore', 'propose', 'apply', 'archive', 'review-cycle', 'bulk-archive']) {
      expect(getCommandFileId(id)).toBe(id);
    }
  });

  it('returns a legacy path only for suffixed ids', () => {
    expect(getLegacyCommandFilePath(claudeAdapter, 'ship-command')).toBe(
      path.join('.claude', 'commands', 'rasen', 'ship-command.md')
    );
    expect(getLegacyCommandFilePath(claudeAdapter, 'explore')).toBeNull();
  });

  it('lists current path first, then legacy suffix and legacy-prefix variants', () => {
    expect(getCommandFilePathCandidates(claudeAdapter, 'auto-command')).toEqual([
      path.join('.claude', 'commands', 'rasen', 'auto.md'),
      path.join('.claude', 'commands', 'rasen', 'auto-command.md'),
      path.join('.claude', 'commands', 'opsx', 'auto.md'),
      path.join('.claude', 'commands', 'opsx', 'auto-command.md'),
    ]);
    expect(getCommandFilePathCandidates(claudeAdapter, 'explore')).toEqual([
      path.join('.claude', 'commands', 'rasen', 'explore.md'),
      path.join('.claude', 'commands', 'opsx', 'explore.md'),
    ]);
  });

  it('generateCommand emits the short filename for fusion command contents', () => {
    for (const [workflowId, fileId] of FUSION_WORKFLOWS) {
      const content = getCommandContents([workflowId])[0];
      expect(content).toBeDefined();
      const generated = generateCommand(content, claudeAdapter);
      expect(generated.path).toBe(path.join('.claude', 'commands', 'rasen', `${fileId}.md`));
    }
  });
});

describe('fusion command generation for the claude tool', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `openspec-cmd-file-id-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    configTempDir = path.join(os.tmpdir(), `openspec-cmd-file-id-config-${Date.now()}`);
    await fs.mkdir(configTempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configTempDir;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();

    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['propose', ...FUSION_WORKFLOWS.map(([workflowId]) => workflowId)],
    });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('generates short filenames (/rasen:ship, not /rasen:ship-command)', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
    for (const [workflowId, fileId] of FUSION_WORKFLOWS) {
      expect(await fileExists(path.join(commandsDir, `${fileId}.md`))).toBe(true);
      expect(await fileExists(path.join(commandsDir, `${workflowId}.md`))).toBe(false);
    }
  });

  it('removes legacy -command suffixed files on re-init', async () => {
    const commandsDir = path.join(testDir, '.claude', 'commands', 'rasen');
    await fs.mkdir(commandsDir, { recursive: true });
    await fs.writeFile(path.join(commandsDir, 'ship-command.md'), '# legacy\n', 'utf-8');

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    expect(await fileExists(path.join(commandsDir, 'ship-command.md'))).toBe(false);
    expect(await fileExists(path.join(commandsDir, 'ship.md'))).toBe(true);
  });

  it('reports drift when only a legacy suffixed file lingers', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const workflows = ['propose', ...FUSION_WORKFLOWS.map(([workflowId]) => workflowId)];
    expect(hasToolProfileOrDeliveryDrift(testDir, 'claude', workflows, 'both')).toBe(false);

    const legacyFile = path.join(testDir, '.claude', 'commands', 'rasen', 'auto-command.md');
    await fs.writeFile(legacyFile, '# legacy\n', 'utf-8');
    expect(hasToolProfileOrDeliveryDrift(testDir, 'claude', workflows, 'both')).toBe(true);
  });
});
