import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  deleteNamedProfile,
  exportProfile,
  exportProfileDefinition,
  getBuiltinProfileDefinition,
  getNamedProfilePath,
  getNamedProfilesDir,
  importNamedProfile,
  importProfilePackage,
  listAvailableProfiles,
  listUserProfiles,
  namedProfileExists,
  parseProfileDefinition,
  readNamedProfile,
  saveNamedProfile,
  validateUserProfileName,
} from '../../src/core/named-profiles.js';
import { importWorkflow, scaffoldWorkflow } from '../../src/core/workflow-library.js';
import { decodePackage } from '../../src/core/workflow-package/index.js';
import { loadWorkflowCatalog } from '../../src/core/workflow-registry/index.js';

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
      workflows: ['apply', 'propose', 'explore'],
    });

    expect(getNamedProfilesDir()).toBe(path.join(tempDir, 'profiles'));
    expect(fs.existsSync(getNamedProfilePath('team'))).toBe(true);
    expect(readNamedProfile('team')).toEqual({
      version: 2,
      workflows: ['propose', 'explore', 'apply'],
      retention: 'off',
    });
    expect(listAvailableProfiles().map((profile) => profile.name)).toEqual([
      'full',
      'core',
      'team',
    ]);
  });

  it('rejects unknown and duplicate workflows before writing', () => {
    expect(() =>
      parseProfileDefinition({
        version: 1,
        workflows: ['propose', 'unknown-workflow'],
      })
    ).toThrow('Unknown workflow ID');

    expect(() =>
      parseProfileDefinition({
        version: 1,
        workflows: ['propose', 'propose'],
      })
    ).toThrow('Duplicate workflow ID');
    expect(fs.existsSync(getNamedProfilesDir())).toBe(false);
  });

  it('M1: accepts an expert id as a valid profile member', () => {
    const definition = parseProfileDefinition({
      version: 1,
      workflows: ['propose', 'review'],
    });
    expect(definition.workflows).toEqual(['propose', 'review']);
  });

  it('M1: still rejects an unknown id even alongside a valid expert id', () => {
    expect(() =>
      parseProfileDefinition({
        version: 1,
        workflows: ['review', 'not-a-real-id'],
      })
    ).toThrow('Unknown workflow ID');
  });

  it('normalizes without auto-expanding closure-pulled experts (a saved snapshot lists exactly the chosen ids)', () => {
    // `auto-command` requires the `review` expert via `requires.skills`, but
    // normalization (used when saving/exporting a profile) must not widen
    // the selection with that closure — only install-time resolution does.
    const definition = parseProfileDefinition({
      version: 1,
      workflows: ['auto-command'],
    });
    expect(definition.workflows).toEqual(['auto-command']);
    expect(definition.workflows).not.toContain('review');
  });

  it('saveNamedProfile refuses to replace an existing definition unless overwrite is explicit (profile update path)', () => {
    saveNamedProfile('team', { version: 1, workflows: ['propose'] });

    expect(() => saveNamedProfile('team', { version: 1, workflows: ['explore'] })).toThrow(
      'already exists'
    );
    expect(readNamedProfile('team')).toEqual({
      version: 2,
      workflows: ['propose'],
      retention: 'off',
    });

    saveNamedProfile('team', { version: 1, workflows: ['explore'] }, { overwrite: true });
    expect(readNamedProfile('team')).toEqual({
      version: 2,
      workflows: ['explore'],
      retention: 'off',
    });
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
      workflows: ['explore'],
    });
  });

  it('does not replace an existing definition when imported content is invalid', () => {
    saveNamedProfile('team', {
      version: 1,
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
      workflows: ['apply', 'propose'],
    };
    const jsonPath = path.join(tempDir, 'exports', 'profile.json');
    const yamlPath = path.join(tempDir, 'exports', 'profile.yaml');

    exportProfileDefinition(jsonPath, definition);
    exportProfileDefinition(yamlPath, definition);

    expect(JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))).toEqual({
      version: 2,
      workflows: ['propose', 'apply'],
      retention: 'off',
    });
    expect(fs.readFileSync(yamlPath, 'utf-8')).toContain('workflows:');
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

  it('round-trips a user-workflow profile as a deterministic self-contained package', async () => {
    const draftRoot = path.join(tempDir, 'drafts', 'team-release');
    scaffoldWorkflow('team-release', draftRoot);
    await importWorkflow(draftRoot);
    const definition = {
      version: 1 as const,
      workflows: ['propose', 'team-release'],
    };
    const packagePath = path.join(tempDir, 'team.rasenpkg');

    expect(exportProfile(packagePath, 'team', definition)).toMatchObject({ kind: 'package' });
    const firstBytes = fs.readFileSync(packagePath);
    exportProfile(packagePath, 'team', definition, { overwrite: true });
    expect(fs.readFileSync(packagePath)).toEqual(firstBytes);

    const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-clean-'));
    process.env.RASEN_HOME = cleanHome;
    try {
      const imported = await importProfilePackage(packagePath, { name: 'renamed' });
      expect(imported.name).toBe('renamed');
      expect(imported.workflows.imported).toEqual(['team-release']);
      expect(readNamedProfile('renamed').workflows).toEqual(['propose', 'team-release']);
      expect(loadWorkflowCatalog().get('team-release')?.source).toBe('user');
    } finally {
      fs.rmSync(cleanHome, { recursive: true, force: true });
      process.env.RASEN_HOME = tempDir;
    }
  });

  it('requires --thin semantics for user-workflow YAML and validates membership', async () => {
    const draftRoot = path.join(tempDir, 'drafts', 'portable-profile');
    scaffoldWorkflow('portable-profile', draftRoot);
    await importWorkflow(draftRoot);
    const definition = {
      version: 1 as const,
      workflows: ['portable-profile'],
    };
    const yamlPath = path.join(tempDir, 'portable-profile.yaml');

    expect(() => exportProfile(yamlPath, 'portable-profile', definition)).toThrow('.rasenpkg');
    expect(exportProfile(yamlPath, 'portable-profile', definition, { thin: true })).toMatchObject({
      kind: 'thin',
    });

    const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-thin-'));
    process.env.RASEN_HOME = cleanHome;
    try {
      expect(() => importNamedProfile(yamlPath)).toThrow('Unknown workflow ID');
      expect(namedProfileExists('portable-profile')).toBe(false);
    } finally {
      fs.rmSync(cleanHome, { recursive: true, force: true });
      process.env.RASEN_HOME = tempDir;
    }
  });

  describe('retention (version 2 profile model)', () => {
    it('migrates a v1 selection containing retro-command to report and strips the id', () => {
      const definition = parseProfileDefinition({
        version: 1,
        workflows: ['propose', 'retro-command', 'apply'],
      });
      expect(definition.version).toBe(2);
      expect(definition.retention).toBe('report');
      expect(definition.workflows).not.toContain('retro-command');
      expect(definition.workflows).toEqual(expect.arrayContaining(['propose', 'apply']));
    });

    it('migrates a v1 selection without retro-command to off', () => {
      const definition = parseProfileDefinition({ version: 1, workflows: ['propose', 'apply'] });
      expect(definition).toMatchObject({ version: 2, retention: 'off' });
    });

    it('tolerates a legacy delivery field on a v1 read and omits it from v2 output', () => {
      const definition = parseProfileDefinition({
        version: 1,
        delivery: 'both',
        workflows: ['propose'],
      });
      expect(definition).toEqual({ version: 2, workflows: ['propose'], retention: 'off' });
    });

    it('accepts an explicit v2 retention value verbatim', () => {
      const definition = parseProfileDefinition({
        version: 2,
        workflows: ['propose'],
        retention: 'codify',
      });
      expect(definition.retention).toBe('codify');
    });

    it('rejects an unknown field on a strict v2 definition', () => {
      expect(() =>
        parseProfileDefinition({
          version: 2,
          workflows: ['propose'],
          retention: 'off',
          extra: true,
        })
      ).toThrow('Invalid');
    });

    it('rejects an invalid v2 retention value', () => {
      expect(() =>
        parseProfileDefinition({ version: 2, workflows: ['propose'], retention: 'always' })
      ).toThrow('Invalid');
    });

    it('gives the built-in profiles their retention defaults without a retro-command id', () => {
      const full = getBuiltinProfileDefinition('full');
      const core = getBuiltinProfileDefinition('core');
      expect(full.retention).toBe('report');
      expect(core.retention).toBe('off');
      expect(full.workflows).not.toContain('retro-command');
    });

    it('does not rewrite a v1 profile file merely because it was read', () => {
      fs.mkdirSync(getNamedProfilesDir(), { recursive: true });
      const target = getNamedProfilePath('legacy');
      fs.writeFileSync(target, 'version: 1\nworkflows:\n  - propose\n', 'utf-8');
      const before = fs.readFileSync(target, 'utf-8');

      const definition = readNamedProfile('legacy');
      expect(definition).toMatchObject({ version: 2, retention: 'off' });
      // Reading migrates in memory only; the file on disk is untouched.
      expect(fs.readFileSync(target, 'utf-8')).toBe(before);
    });

    it('round-trips a v2 retention value through a self-contained package and stamps a min version', async () => {
      const draftRoot = path.join(tempDir, 'drafts', 'retention-pkg');
      scaffoldWorkflow('retention-pkg', draftRoot);
      await importWorkflow(draftRoot);
      const packagePath = path.join(tempDir, 'retention.rasenpkg');
      exportProfile(packagePath, 'retention-team', {
        version: 2,
        workflows: ['propose', 'retention-pkg'],
        retention: 'codify',
      });

      const decoded = decodePackage(fs.readFileSync(packagePath), 'profile');
      expect(decoded.kind).toBe('profile');
      if (decoded.kind === 'profile') {
        expect(decoded.profile).toMatchObject({ version: 2, retention: 'codify' });
      }
      expect(typeof decoded.minRasenVersion).toBe('string');

      const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-retention-'));
      process.env.RASEN_HOME = cleanHome;
      try {
        const imported = await importProfilePackage(packagePath, { name: 'renamed' });
        expect(imported.definition.retention).toBe('codify');
        expect(readNamedProfile('renamed').retention).toBe('codify');
      } finally {
        fs.rmSync(cleanHome, { recursive: true, force: true });
        process.env.RASEN_HOME = tempDir;
      }
    });
  });

  it('rolls back embedded workflows when the profile commit fails', async () => {
    const draftRoot = path.join(tempDir, 'drafts', 'rollback-profile');
    scaffoldWorkflow('rollback-profile', draftRoot);
    await importWorkflow(draftRoot);
    const packagePath = path.join(tempDir, 'rollback.rasenpkg');
    exportProfile(packagePath, 'rollback-target', {
      version: 1,
      workflows: ['rollback-profile'],
    });

    const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-rollback-'));
    process.env.RASEN_HOME = cleanHome;
    const blockedProfilePath = path.join(cleanHome, 'profiles', 'rollback-target.yaml');
    fs.mkdirSync(blockedProfilePath, { recursive: true });
    try {
      await expect(importProfilePackage(packagePath, { overwrite: true })).rejects.toThrow(
        'Destination is not a file'
      );
      expect(loadWorkflowCatalog().get('rollback-profile')).toBeUndefined();
      expect(fs.statSync(blockedProfilePath).isDirectory()).toBe(true);
    } finally {
      fs.rmSync(cleanHome, { recursive: true, force: true });
      process.env.RASEN_HOME = tempDir;
    }
  });
});
