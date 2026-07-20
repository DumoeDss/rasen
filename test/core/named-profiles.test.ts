import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  deleteNamedProfile,
  exportProfileDefinition,
  getNamedProfilePath,
  getNamedProfilesDir,
  importNamedProfile,
  listAvailableProfiles,
  listUserProfiles,
  parseProfileDefinition,
  readNamedProfile,
  saveNamedProfile,
  validateUserProfileName,
} from '../../src/core/named-profiles.js';

describe('named profiles', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-named-profiles-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates portable profile names and reserves built-in identifiers', () => {
    expect(validateUserProfileName('team-minimal')).toBeNull();
    expect(validateUserProfileName('Team')).toContain('lowercase');
    expect(validateUserProfileName('../escape')).toContain('1-64');
    expect(validateUserProfileName('core')).toContain('reserved');
    expect(validateUserProfileName('custom')).toContain('reserved');
  });

  it('saves definitions as normalized YAML and lists built-in profiles first', () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'skills',
      workflows: ['apply', 'propose', 'explore'],
    });

    expect(getNamedProfilesDir()).toBe(path.join(tempDir, 'profiles'));
    expect(fs.existsSync(getNamedProfilePath('team'))).toBe(true);
    expect(readNamedProfile('team')).toEqual({
      version: 1,
      delivery: 'skills',
      workflows: ['propose', 'explore', 'apply'],
    });
    expect(listAvailableProfiles('both').map((profile) => profile.name)).toEqual([
      'full',
      'core',
      'team',
    ]);
  });

  it('rejects unknown and duplicate workflows before writing', () => {
    expect(() =>
      parseProfileDefinition({
        version: 1,
        delivery: 'both',
        workflows: ['propose', 'unknown-workflow'],
      })
    ).toThrow('Unknown workflow ID');

    expect(() =>
      parseProfileDefinition({
        version: 1,
        delivery: 'both',
        workflows: ['propose', 'propose'],
      })
    ).toThrow('Duplicate workflow ID');
    expect(fs.existsSync(getNamedProfilesDir())).toBe(false);
  });

  it('imports JSON using the file basename and refuses an implicit overwrite', () => {
    const importPath = path.join(tempDir, 'minimal.json');
    fs.writeFileSync(
      importPath,
      JSON.stringify({ version: 1, delivery: 'both', workflows: ['propose'] }),
      'utf-8'
    );

    const imported = importNamedProfile(importPath);
    expect(imported.name).toBe('minimal');
    expect(readNamedProfile('minimal').workflows).toEqual(['propose']);
    expect(() => importNamedProfile(importPath)).toThrow('already exists');

    fs.writeFileSync(
      importPath,
      JSON.stringify({ version: 1, delivery: 'skills', workflows: ['explore'] }),
      'utf-8'
    );
    importNamedProfile(importPath, { overwrite: true });
    expect(readNamedProfile('minimal')).toMatchObject({
      delivery: 'skills',
      workflows: ['explore'],
    });
  });

  it('does not replace an existing definition when imported content is invalid', () => {
    saveNamedProfile('team', {
      version: 1,
      delivery: 'both',
      workflows: ['propose'],
    });
    const sourcePath = path.join(tempDir, 'team.yaml');
    fs.writeFileSync(
      sourcePath,
      'version: 1\ndelivery: both\nworkflows:\n  - missing\n',
      'utf-8'
    );

    expect(() => importNamedProfile(sourcePath, { overwrite: true })).toThrow(
      'Unknown workflow ID'
    );
    expect(readNamedProfile('team').workflows).toEqual(['propose']);
  });

  it('exports JSON or YAML and requires an explicit overwrite', () => {
    const definition = {
      version: 1 as const,
      delivery: 'both' as const,
      workflows: ['apply', 'propose'],
    };
    const jsonPath = path.join(tempDir, 'exports', 'profile.json');
    const yamlPath = path.join(tempDir, 'exports', 'profile.yaml');

    exportProfileDefinition(jsonPath, definition);
    exportProfileDefinition(yamlPath, definition);

    expect(JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))).toEqual({
      version: 1,
      delivery: 'both',
      workflows: ['propose', 'apply'],
    });
    expect(fs.readFileSync(yamlPath, 'utf-8')).toContain('delivery: both');
    expect(() => exportProfileDefinition(jsonPath, definition)).toThrow('already exists');
  });

  it('keeps corrupt saved files visible for diagnosis and allows deletion', () => {
    fs.mkdirSync(getNamedProfilesDir(), { recursive: true });
    fs.writeFileSync(path.join(getNamedProfilesDir(), 'broken.yaml'), 'not: valid\n', 'utf-8');

    expect(listUserProfiles()).toEqual([
      expect.objectContaining({ name: 'broken', builtIn: false, error: expect.any(String) }),
    ]);
    deleteNamedProfile('broken');
    expect(listUserProfiles()).toEqual([]);
  });
});
