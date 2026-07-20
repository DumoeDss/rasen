import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  beforeOpen: null as ((filePath: fs.PathLike) => void) | null,
  beforeReaddir: null as ((directoryPath: fs.PathLike) => void) | null,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const openSync: typeof actual.openSync = (filePath, flags, mode) => {
    fsMock.beforeOpen?.(filePath);
    return actual.openSync(filePath, flags, mode);
  };
  const readdirSync = ((directoryPath: fs.PathLike, options?: unknown) => {
    fsMock.beforeReaddir?.(directoryPath);
    return Reflect.apply(
      actual.readdirSync,
      actual,
      options === undefined ? [directoryPath] : [directoryPath, options]
    );
  }) as typeof actual.readdirSync;
  return { ...actual, default: actual, openSync, readdirSync };
});

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
  const originalCwd = process.cwd();
  const cleanup: string[] = [];

  beforeEach(() => {
    originalHome = process.env.RASEN_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-home-'));
    cleanup.push(home);
    process.env.RASEN_HOME = home;
  });

  afterEach(() => {
    fsMock.beforeOpen = null;
    fsMock.beforeReaddir = null;
    process.chdir(originalCwd);
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

  it.runIf(process.platform !== 'win32')(
    'rejects a source entry swapped to an external symlink before descriptor open',
    async () => {
      const source = draft('swapped-entry');
      const skillPath = path.join(source, 'SKILL.md');
      const originalSkillPath = path.join(source, 'SKILL.original.md');
      const externalPath = path.join(home, 'external-secret.md');
      const externalBytes = 'external bytes must never be staged\n';
      fs.writeFileSync(externalPath, externalBytes);
      let swapped = false;
      fsMock.beforeOpen = (filePath) => {
        if (!swapped && path.resolve(String(filePath)) === skillPath) {
          swapped = true;
          fs.renameSync(skillPath, originalSkillPath);
          fs.symlinkSync(externalPath, skillPath);
        }
      };

      await expect(importWorkflow(source)).rejects.toMatchObject({ code: 'workflow_invalid' });

      expect(swapped).toBe(true);
      const installedPath = path.join(getUserWorkflowsDir(), 'swapped-entry');
      expect(fs.existsSync(installedPath)).toBe(false);
      expect(fs.readFileSync(externalPath, 'utf8')).toBe(externalBytes);
    }
  );

  it.runIf(process.platform !== 'win32')(
    'rejects a source root swapped to an external directory during enumeration',
    async () => {
      const source = draft('swapped-root');
      const originalSource = `${source}.original`;
      const externalSource = path.join(home, 'external-swapped-root');
      const externalBytes = 'external root bytes must never be staged\n';
      fs.cpSync(source, externalSource, { recursive: true });
      fs.appendFileSync(path.join(externalSource, 'SKILL.md'), externalBytes);
      let swapped = false;
      fsMock.beforeReaddir = (directoryPath) => {
        if (!swapped && path.resolve(String(directoryPath)) === source) {
          swapped = true;
          fs.renameSync(source, originalSource);
          fs.symlinkSync(externalSource, source, 'dir');
        }
      };

      await expect(importWorkflow(source)).rejects.toMatchObject({
        code: 'workflow_invalid',
        details: { diagnostics: expect.arrayContaining(['directory_changed']) },
      });

      expect(swapped).toBe(true);
      expect(fs.existsSync(path.join(getUserWorkflowsDir(), 'swapped-root'))).toBe(false);
      expect(fs.readFileSync(path.join(externalSource, 'SKILL.md'), 'utf8')).toContain(
        externalBytes
      );
    }
  );

  it.runIf(process.platform !== 'win32')(
    'rejects a nested directory swapped after parent enumeration and child validation',
    async () => {
      const source = draft('swapped-directory');
      const nestedDirectory = path.join(source, 'references');
      const originalNestedDirectory = path.join(source, 'references.original');
      const externalDirectory = path.join(home, 'external-references');
      const externalBytes = 'external nested bytes must never be staged\n';
      fs.mkdirSync(nestedDirectory);
      fs.writeFileSync(path.join(nestedDirectory, 'policy.md'), 'original policy\n');
      fs.writeFileSync(
        path.join(source, 'workflow.yaml'),
        fs.readFileSync(path.join(source, 'workflow.yaml'), 'utf8').replace(
          '  sidecars: []',
          '  sidecars:\n    - references/policy.md'
        )
      );
      fs.mkdirSync(externalDirectory);
      fs.writeFileSync(path.join(externalDirectory, 'policy.md'), externalBytes);
      let swapped = false;
      fsMock.beforeReaddir = (directoryPath) => {
        if (!swapped && path.resolve(String(directoryPath)) === nestedDirectory) {
          swapped = true;
          fs.renameSync(nestedDirectory, originalNestedDirectory);
          fs.symlinkSync(externalDirectory, nestedDirectory, 'dir');
        }
      };

      await expect(importWorkflow(source)).rejects.toMatchObject({
        code: 'workflow_invalid',
        details: { diagnostics: expect.arrayContaining(['directory_changed']) },
      });

      expect(swapped).toBe(true);
      expect(fs.existsSync(path.join(getUserWorkflowsDir(), 'swapped-directory'))).toBe(false);
      expect(fs.readFileSync(path.join(externalDirectory, 'policy.md'), 'utf8')).toBe(
        externalBytes
      );
    }
  );

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

  it('force-deletes a referenced workflow and reports the dangling referrers', async () => {
    await importWorkflow(draft('force-referenced'));
    fs.writeFileSync(
      path.join(home, 'config.json'),
      JSON.stringify({ profile: 'custom', delivery: 'both', workflows: ['force-referenced'] })
    );

    await expect(deleteWorkflow('force-referenced')).rejects.toMatchObject({
      code: 'workflow_in_use',
    });
    const result = await deleteWorkflow('force-referenced', { force: true });
    expect(result.forcedReferrers).toEqual([
      expect.stringContaining('global-selection'),
    ]);
    expect(loadWorkflowCatalog().get('force-referenced')).toBeUndefined();
  });

  it('never lets --force delete a built-in workflow', async () => {
    await expect(deleteWorkflow('apply', { force: true })).rejects.toMatchObject({
      code: 'builtin_delete_forbidden',
    });
  });

  it('finds project pipeline usage when deletion starts from a nested directory', async () => {
    await importWorkflow(draft('nested-pipeline'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-project-'));
    cleanup.push(project);
    const pipelineDirectory = path.join(project, 'rasen', 'pipelines', 'uses-workflow');
    fs.mkdirSync(pipelineDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(pipelineDirectory, 'pipeline.yaml'),
      'stages:\n  - id: check\n    skill: rasen-nested-pipeline\n'
    );
    const nested = path.join(project, 'src', 'nested');
    fs.mkdirSync(nested, { recursive: true });
    process.chdir(nested);

    expect(scanWorkflowUsage('nested-pipeline')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'pipeline' })])
    );
    await expect(deleteWorkflow('nested-pipeline')).rejects.toMatchObject({
      code: 'workflow_in_use',
    });
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
