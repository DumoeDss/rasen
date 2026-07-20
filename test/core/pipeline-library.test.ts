import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deletePipeline,
  exportPipeline,
  importPipelinePackage,
  PipelineLibraryError,
  scaffoldPipeline,
  validatePipelineInput,
} from '../../src/core/pipeline-library.js';
import {
  createPipelinePackage,
  encodePackage,
  type PipelinePackageInput,
} from '../../src/core/workflow-package/index.js';
import { getUserPipelinesDir, listPipelines } from '../../src/core/pipeline-registry/index.js';
import { loadWorkflowCatalog } from '../../src/core/workflow-registry/index.js';
import { scaffoldWorkflow, importWorkflow } from '../../src/core/workflow-library.js';

function pipelineInput(name: string, extra: string[] = []): PipelinePackageInput {
  return {
    name,
    files: [
      {
        path: 'pipeline.yaml',
        content: [
          `name: ${name}`,
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '    role: implementer',
          '    requires: []',
          ...extra,
          '',
        ].join('\n'),
      },
    ],
  };
}

function packagePath(home: string, name: string, extra: string[] = []): string {
  const packageValue = createPipelinePackage([name], [pipelineInput(name, extra)]);
  const dest = path.join(home, `${name}.rasenpkg`);
  fs.writeFileSync(dest, encodePackage(packageValue));
  return dest;
}

describe('pipeline library lifecycle', () => {
  let home: string;
  let originalHome: string | undefined;
  const originalCwd = process.cwd();
  const cleanup: string[] = [];

  beforeEach(() => {
    originalHome = process.env.RASEN_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-home-'));
    cleanup.push(home);
    process.env.RASEN_HOME = home;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = originalHome;
    for (const directory of cleanup.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('imports a pipeline package into the user layer and exports it back', async () => {
    const source = packagePath(home, 'solo');

    const result = await importPipelinePackage(source);
    expect(result.imported).toEqual(['solo']);
    expect(listPipelines()).toContain('solo');
    expect(fs.existsSync(path.join(getUserPipelinesDir(), 'solo', 'pipeline.yaml'))).toBe(true);

    const dest = path.join(home, 'solo-export.rasenpkg');
    const exportedPath = exportPipeline('solo', dest);
    expect(exportedPath).toBe(path.resolve(dest));
    expect(validatePipelineInput(exportedPath)).toMatchObject({ valid: true, kind: 'package', packageKind: 'pipeline' });
  });

  it('refuses to overwrite an already-installed pipeline without --force, and allows it with --force', async () => {
    const source = packagePath(home, 'dup');
    await importPipelinePackage(source);

    await expect(importPipelinePackage(source)).rejects.toMatchObject({
      code: 'pipeline_already_exists',
    });
    await expect(importPipelinePackage(source, { overwrite: true })).resolves.toMatchObject({
      imported: ['dup'],
    });
  });

  it('serializes two concurrent imports of the same pipeline name via .pipelines.lock/.workflows.lock: one wins, one fails cleanly, no corruption', async () => {
    // Both packages install under the SAME pipeline name ("contended"),
    // forcing the two concurrent imports to contend on the same target.
    const contendedA = createPipelinePackage(['contended'], [pipelineInput('contended', ['    condition: from-a'])]);
    const contendedB = createPipelinePackage(['contended'], [pipelineInput('contended', ['    condition: from-b'])]);
    const sourceA = path.join(home, 'contended-a.rasenpkg');
    const sourceB = path.join(home, 'contended-b.rasenpkg');
    fs.writeFileSync(sourceA, encodePackage(contendedA));
    fs.writeFileSync(sourceB, encodePackage(contendedB));

    const results = await Promise.allSettled([
      importPipelinePackage(sourceA),
      importPipelinePackage(sourceB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'pipeline_already_exists',
    });

    // No corruption: the installed pipeline.yaml is exactly ONE of the two
    // candidates' content in full, never a mix of both.
    const installedContent = fs.readFileSync(
      path.join(getUserPipelinesDir(), 'contended', 'pipeline.yaml'),
      'utf8'
    );
    const wonFromA = installedContent.includes('from-a');
    const wonFromB = installedContent.includes('from-b');
    expect(wonFromA !== wonFromB).toBe(true); // exactly one, never both, never neither
    expect(listPipelines()).toContain('contended');
  });

  it('imports multiple pipelines atomically: a conflict on one leaves none newly installed', async () => {
    const first = packagePath(home, 'multi-a');
    await importPipelinePackage(first);

    const packageValue = createPipelinePackage(
      ['multi-a', 'multi-b'],
      [pipelineInput('multi-a'), pipelineInput('multi-b')]
    );
    const conflictingSource = path.join(home, 'multi.rasenpkg');
    fs.writeFileSync(conflictingSource, encodePackage(packageValue));

    await expect(importPipelinePackage(conflictingSource)).rejects.toMatchObject({
      code: 'pipeline_already_exists',
    });
    // multi-b must NOT have been installed even though it had no conflict —
    // the whole import is one transaction.
    expect(listPipelines()).not.toContain('multi-b');
  });

  it('validates a pipeline draft directory and a package without requiring installation', () => {
    const draftParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-draft-'));
    cleanup.push(draftParent);
    const draft = scaffoldPipeline('draft-pipe', path.join(draftParent, 'draft-pipe'));

    expect(validatePipelineInput(draft)).toMatchObject({ valid: true, kind: 'directory', name: 'draft-pipe' });

    const source = packagePath(home, 'validate-only');
    expect(validatePipelineInput(source)).toMatchObject({ valid: true, kind: 'package', packageKind: 'pipeline' });
    expect(listPipelines()).not.toContain('validate-only');
  });

  it('refuses to export a pipeline that is not in the user layer', () => {
    expect(() => exportPipeline('small-feature', path.join(home, 'small-feature.rasenpkg'))).toThrow(
      expect.objectContaining<Partial<PipelineLibraryError>>({ code: 'pipeline_not_found' })
    );
  });

  it('rejects a path-traversal name before ever touching the filesystem for it', () => {
    // A secret file living OUTSIDE the user pipelines directory, at a
    // location a `../`-laden name could reach if `exportPipeline` ever
    // built a path from `name` before validating it.
    const secretDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-pipeline-secret-'));
    cleanup.push(secretDir);
    fs.writeFileSync(path.join(secretDir, 'pipeline.yaml'), 'name: secret\nstages: []\n');
    fs.writeFileSync(path.join(secretDir, 'do-not-read-me.txt'), 'top secret contents');

    const traversalName = path.relative(getUserPipelinesDir(), secretDir);
    expect(() => exportPipeline(traversalName, path.join(home, 'traversal.rasenpkg'))).toThrow(
      expect.objectContaining<Partial<PipelineLibraryError>>({ code: 'pipeline_not_found' })
    );
    // Nothing should have been written from that directory's content.
    expect(fs.existsSync(path.join(home, 'traversal.rasenpkg'))).toBe(false);
  });

  it('blocks delete while another installed pipeline decompose-references it, then allows --force', async () => {
    await importPipelinePackage(packagePath(home, 'child-pipe'));
    const parentPackage = createPipelinePackage(
      ['parent-pipe'],
      [
        {
          name: 'parent-pipe',
          files: [
            {
              path: 'pipeline.yaml',
              content: [
                'name: parent-pipe',
                'stages:',
                '  - id: fanout',
                '    kind: decompose',
                '    childPipeline: child-pipe',
                '    requires: []',
                '',
              ].join('\n'),
            },
          ],
        },
      ]
    );
    const parentPath = path.join(home, 'parent-pipe.rasenpkg');
    fs.writeFileSync(parentPath, encodePackage(parentPackage));
    await importPipelinePackage(parentPath);

    await expect(deletePipeline('child-pipe')).rejects.toMatchObject({ code: 'pipeline_in_use' });
    const result = await deletePipeline('child-pipe', { force: true });
    expect(result.forcedReferrers).toEqual([expect.stringContaining('decompose:parent-pipe')]);
    expect(listPipelines()).not.toContain('child-pipe');
  });

  it('blocks delete while an installed workflow requires the pipeline', async () => {
    await importPipelinePackage(packagePath(home, 'required-pipe'));

    const draftParent = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-draft-'));
    cleanup.push(draftParent);
    const draft = scaffoldWorkflow('needs-pipe', path.join(draftParent, 'needs-pipe'));
    fs.writeFileSync(
      path.join(draft, 'workflow.yaml'),
      fs
        .readFileSync(path.join(draft, 'workflow.yaml'), 'utf8')
        .replace('pipelines: []', "pipelines: ['required-pipe']")
    );
    await importWorkflow(draft);
    expect(loadWorkflowCatalog().get('needs-pipe')?.requires.pipelines).toEqual(['required-pipe']);

    await expect(deletePipeline('required-pipe')).rejects.toMatchObject({ code: 'pipeline_in_use' });
  });

  it('never deletes a built-in pipeline, even with --force', async () => {
    await expect(deletePipeline('small-feature', { force: true })).rejects.toMatchObject({
      code: 'pipeline_delete_forbidden',
    });
  });

  it('deletes an unreferenced user pipeline cleanly', async () => {
    await importPipelinePackage(packagePath(home, 'lonely-pipe'));
    const result = await deletePipeline('lonely-pipe');
    expect(result.forcedReferrers).toEqual([]);
    expect(listPipelines()).not.toContain('lonely-pipe');
    expect(fs.existsSync(path.join(getUserPipelinesDir(), 'lonely-pipe'))).toBe(false);
  });
});
