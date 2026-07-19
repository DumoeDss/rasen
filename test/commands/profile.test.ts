import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { registerProfileCommand } from '../../src/commands/profile.js';
import { getGlobalConfig, saveGlobalConfig } from '../../src/core/global-config.js';
import {
  namedProfileExists,
  readNamedProfile,
  saveNamedProfile,
} from '../../src/core/named-profiles.js';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  confirm: vi.fn(),
}));

async function runProfileCommand(args: string[]): Promise<void> {
  const program = new Command();
  registerProfileCommand(program);
  await program.parseAsync(['node', 'rasen', 'profile', ...args]);
}

async function promptMocks(): Promise<{
  input: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  checkbox: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
}> {
  const prompts = await import('@inquirer/prompts');
  return {
    input: prompts.input as unknown as ReturnType<typeof vi.fn>,
    select: prompts.select as unknown as ReturnType<typeof vi.fn>,
    checkbox: prompts.checkbox as unknown as ReturnType<typeof vi.fn>,
    confirm: prompts.confirm as unknown as ReturnType<typeof vi.fn>,
  };
}

describe('profile command', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalTTY: boolean | undefined;
  let originalExitCode: number | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-command-'));
    originalEnv = { ...process.env };
    originalTTY = (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    originalExitCode = process.exitCode;
    process.env.RASEN_HOME = tempDir;
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = true;
    process.exitCode = undefined;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = originalTTY;
    process.exitCode = originalExitCode;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses a saved profile by copying its delivery and workflows to global config', async () => {
    saveNamedProfile('minimal', {
      version: 1,
      delivery: 'skills',
      workflows: ['propose', 'apply'],
    });

    await runProfileCommand(['use', 'minimal']);

    expect(getGlobalConfig()).toMatchObject({
      profile: 'custom',
      delivery: 'skills',
      workflows: ['propose', 'apply'],
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Using profile "minimal".');
  });

  it('preserves delivery when using a built-in profile', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'custom', delivery: 'skills', workflows: [] });

    await runProfileCommand(['use', 'core']);

    expect(getGlobalConfig().profile).toBe('core');
    expect(getGlobalConfig().delivery).toBe('skills');
    expect(getGlobalConfig().workflows).toContain('sync');
  });

  it('offers profile selection when use is called without a name', async () => {
    const { select } = await promptMocks();
    select.mockResolvedValueOnce('core');

    await runProfileCommand(['use']);

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Select a profile to use:' })
    );
    expect(getGlobalConfig().profile).toBe('core');
  });

  it('creates, saves, and selects a named profile interactively', async () => {
    const { select, checkbox, confirm } = await promptMocks();
    select.mockResolvedValueOnce('skills');
    checkbox.mockResolvedValueOnce(['propose', 'explore']);
    confirm.mockResolvedValueOnce(true);

    await runProfileCommand(['new', 'team']);

    expect(readNamedProfile('team')).toEqual({
      version: 1,
      delivery: 'skills',
      workflows: ['propose', 'explore'],
    });
    expect(getGlobalConfig()).toMatchObject({
      profile: 'custom',
      delivery: 'skills',
      workflows: ['propose', 'explore'],
    });
    expect(checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: 'Space to toggle, A to select/clear all, Enter to confirm',
        shortcuts: { all: 'a' },
      })
    );
  });

  it('keeps the name prompt open for reserved and existing profile names', async () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
    const { input, select, checkbox, confirm } = await promptMocks();
    input.mockResolvedValueOnce('fresh');
    select.mockResolvedValueOnce('both');
    checkbox.mockResolvedValueOnce(['propose']);
    confirm.mockResolvedValueOnce(true);

    await runProfileCommand(['new']);

    const validate = input.mock.calls[0][0].validate as (name: string) => string | true;
    expect(validate('core')).toBe('Profile name "core" is reserved.');
    expect(validate('team')).toBe('Profile "team" already exists.');
    expect(validate('available')).toBe(true);
    expect(namedProfileExists('fresh')).toBe(true);
  });

  it('fails clearly for an explicit existing profile name', async () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
    const { select, checkbox } = await promptMocks();

    await runProfileCommand(['new', 'team']);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error: Profile "team" already exists.');
    expect(select).not.toHaveBeenCalled();
    expect(checkbox).not.toHaveBeenCalled();
  });

  it('lists built-in and saved profiles as JSON', async () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });

    await runProfileCommand(['list', '--json']);

    const output = consoleLogSpy.mock.calls.map(([value]) => String(value)).join('\n');
    const payload = JSON.parse(output) as { profiles: Array<{ name: string }> };
    expect(payload.profiles.map((profile) => profile.name)).toEqual(['full', 'core', 'team']);
  });

  it('imports without applying and exports a selected saved profile', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'skills',
      workflows: ['explore'],
    });
    const sourcePath = path.join(tempDir, 'shared.json');
    fs.writeFileSync(
      sourcePath,
      JSON.stringify({ version: 1, delivery: 'both', workflows: ['propose'] }),
      'utf-8'
    );

    await runProfileCommand(['import', sourcePath]);
    expect(namedProfileExists('shared')).toBe(true);
    expect(getGlobalConfig().workflows).toEqual(['explore']);

    const destinationPath = path.join(tempDir, 'exported.json');
    await runProfileCommand(['export', destinationPath, '--profile', 'shared']);
    expect(JSON.parse(fs.readFileSync(destinationPath, 'utf-8'))).toEqual({
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
  });

  it('requires --force to overwrite an export outside a TTY', async () => {
    const destinationPath = path.join(tempDir, 'existing.yaml');
    fs.writeFileSync(destinationPath, 'keep\n', 'utf-8');
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = false;

    await runProfileCommand(['export', destinationPath]);

    expect(process.exitCode).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Pass --force'));
    expect(fs.readFileSync(destinationPath, 'utf-8')).toBe('keep\n');
  });

  it('deletes a saved profile without changing current settings', async () => {
    saveNamedProfile('obsolete', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'skills',
      workflows: ['explore'],
    });

    await runProfileCommand(['delete', 'obsolete', '--yes']);

    expect(namedProfileExists('obsolete')).toBe(false);
    expect(getGlobalConfig().workflows).toEqual(['explore']);
  });
});
