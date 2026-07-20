import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deleteWorkflow,
  exportWorkflow,
  importWorkflow,
  scaffoldWorkflow,
  scanWorkflowUsage,
  validateWorkflowInput,
  WorkflowLibraryError,
} from '../../src/core/workflow-library.js';
import {
  commitWorkflowInstall,
  stageWorkflowDefinitions,
} from '../../src/core/workflow-package/index.js';
import {
  getUserWorkflowsDir,
  loadWorkflowCatalog,
  validateWorkflowDirectory,
} from '../../src/core/workflow-registry/index.js';

describe('workflow library lifecycle', () => {
  let home: string;
  let originalHome: string | undefined;
  const cleanup: string[] = [];

  beforeEach(() => {
    originalHome = process.env.RASEN_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-home-'));
    cleanup.push(home);
    process.env.RASEN_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = originalHome;
    for (const directory of cleanup.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function draft(id: string): string {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-draft-'));
    cleanup.push(parent);
    return scaffoldWorkflow(id, path.join(parent, id));
  }

  it('scaffolds, validates, installs, and reuses an identical workflow', async () => {
    const source = draft('team-release');

    expect(validateWorkflowInput(source)).toMatchObject({ valid: true, kind: 'directory' });
    await expect(importWorkflow(source)).resolves.toEqual({
      imported: ['team-release'],
      reused: [],
      roots: ['team-release'],
    });
    await expect(importWorkflow(source)).resolves.toEqual({
      imported: [],
      reused: ['team-release'],
      roots: ['team-release'],
    });
    expect(loadWorkflowCatalog().get('team-release')?.source).toBe('user');
  });

  it('rejects different content under an installed ID without replacing it', async () => {
    const source = draft('immutable-id');
    await importWorkflow(source);
    fs.appendFileSync(path.join(source, 'SKILL.md'), '\nChanged instructions.\n');

    await expect(importWorkflow(source)).rejects.toMatchObject({
      code: 'workflow_digest_conflict',
    });
    const installedSkill = path.join(getUserWorkflowsDir(), 'immutable-id', 'SKILL.md');
    expect(fs.readFileSync(installedSkill, 'utf8')).not.toContain('Changed instructions');
  });

  it('exports deterministic bytes and imports them into a clean home', async () => {
    const source = draft('portable');
    await importWorkflow(source);
    const packagePath = path.join(home, 'portable.rasenpkg');

    exportWorkflow('portable', packagePath);
    const first = fs.readFileSync(packagePath);
    exportWorkflow('portable', packagePath, { overwrite: true });
    expect(fs.readFileSync(packagePath)).toEqual(first);
    expect(validateWorkflowInput(packagePath)).toMatchObject({
      valid: true,
      kind: 'package',
      packageKind: 'workflow',
    });

    const cleanHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-clean-'));
    cleanup.push(cleanHome);
    process.env.RASEN_HOME = cleanHome;
    await expect(importWorkflow(packagePath)).resolves.toMatchObject({ imported: ['portable'] });
    expect(loadWorkflowCatalog().get('portable')).toBeDefined();
  });

  it('leaves the registry unchanged when staged package validation fails', async () => {
    const source = draft('broken');
    fs.appendFileSync(path.join(source, 'workflow.yaml'), 'unknown: true\n');

    await expect(importWorkflow(source)).rejects.toMatchObject({ code: 'workflow_invalid' });
    expect(fs.existsSync(getUserWorkflowsDir())).toBe(false);
  });

  it('rejects imports that collide with an always-installed expert skill', async () => {
    const source = draft('expert-collision');
    const skillPath = path.join(source, 'SKILL.md');
    fs.writeFileSync(
      skillPath,
      fs.readFileSync(skillPath, 'utf8').replace(
        'name: rasen-expert-collision',
        'name: rasen-careful'
      )
    );

    await expect(importWorkflow(source)).rejects.toMatchObject({
      code: 'expert_skill_collision',
    });
    expect(fs.existsSync(path.join(getUserWorkflowsDir(), 'expert-collision'))).toBe(false);
  });

  it('rolls back only directories created by a failed multi-workflow commit', async () => {
    const first = validateWorkflowDirectory(draft('first')).definition!;
    const second = validateWorkflowDirectory(draft('second')).definition!;
    const plan = stageWorkflowDefinitions([first, second], ['first', 'second']);
    let renameCount = 0;

    await expect(
      commitWorkflowInstall(plan, {
        rename: (oldPath, newPath) => {
          renameCount += 1;
          if (renameCount === 2) throw new Error('injected rename failure');
          fs.renameSync(oldPath, newPath);
        },
      })
    ).rejects.toThrow('injected rename failure');
    expect(fs.existsSync(path.join(getUserWorkflowsDir(), 'first'))).toBe(false);
    expect(fs.existsSync(path.join(getUserWorkflowsDir(), 'second'))).toBe(false);
  });

  it('rolls back newly installed workflows when a dependent commit fails', async () => {
    const definition = validateWorkflowDirectory(draft('dependent-commit')).definition!;
    const plan = stageWorkflowDefinitions([definition], ['dependent-commit']);

    await expect(
      commitWorkflowInstall(plan, {
        afterInstall: () => {
          throw new Error('injected dependent commit failure');
        },
      })
    ).rejects.toThrow('injected dependent commit failure');
    expect(fs.existsSync(path.join(getUserWorkflowsDir(), 'dependent-commit'))).toBe(false);
  });

  it('blocks deletion while a known consumer references the workflow', async () => {
    await importWorkflow(draft('referenced'));
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ profile: 'custom', delivery: 'both', workflows: ['referenced'] })
    );

    expect(scanWorkflowUsage('referenced')).toEqual([
      expect.objectContaining({ kind: 'global-selection' }),
    ]);
    await expect(deleteWorkflow('referenced')).rejects.toMatchObject({ code: 'workflow_in_use' });

    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ workflows: [] }));
    await deleteWorkflow('referenced');
    expect(loadWorkflowCatalog().get('referenced')).toBeUndefined();
  });

  it('refuses built-in export and deletion', async () => {
    expect(() => exportWorkflow('apply', path.join(home, 'apply.rasenpkg'))).toThrow(
      expect.objectContaining<Partial<WorkflowLibraryError>>({ code: 'builtin_export_forbidden' })
    );
    await expect(deleteWorkflow('apply')).rejects.toMatchObject({
      code: 'builtin_delete_forbidden',
    });
  });
});
