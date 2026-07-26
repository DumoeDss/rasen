import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveGlobalConfig } from '../../src/core/global-config.js';
import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';

describe('Direction init/update generation', () => {
  let project: string;
  let machineHome: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-direction-project-'));
    machineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-direction-home-'));
    process.env.RASEN_HOME = machineHome;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(machineHome, { recursive: true, force: true });
  });

  it('an explicit custom selection installs the canonical skill with no Direction sidecars or workstream artifacts', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      workflows: ['direction'],
      expertSelectionExplicit: true,
    });

    await new InitCommand({ tools: 'claude', force: true }).execute(project);

    const directionDir = path.join(project, '.claude', 'skills', 'rasen-direction');
    expect(fs.readdirSync(directionDir).sort()).toEqual(['SKILL.md']);
    expect(fs.readFileSync(path.join(directionDir, 'SKILL.md'), 'utf8')).toContain(
      'name: rasen-direction'
    );
    expect(fs.existsSync(path.join(project, 'rasen', 'work'))).toBe(false);
    expect(fs.existsSync(path.join(project, 'rasen', 'work.yaml'))).toBe(false);
  });

  it('ordinary init and update never create Direction artifacts', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      workflows: ['explore'],
      expertSelectionExplicit: true,
    });

    await new InitCommand({ tools: 'claude', force: true }).execute(project);
    await new UpdateCommand().execute(project);

    const workDir = path.join(project, 'rasen', 'work');
    expect(fs.existsSync(workDir)).toBe(false);
    for (const artifact of [
      'work.yaml',
      'north-star.md',
      'target-state.md',
      'roadmap.md',
    ]) {
      expect(fs.existsSync(path.join(project, 'rasen', artifact))).toBe(false);
    }
    expect(
      fs.existsSync(path.join(project, '.claude', 'skills', 'rasen-direction', 'SKILL.md'))
    ).toBe(false);
  });
});
