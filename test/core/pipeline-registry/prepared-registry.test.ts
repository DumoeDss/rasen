import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  freezeProductionPreparedPipelineRegistry,
  PipelineValidationError,
  PipelineLoadError,
} from '../../../src/core/pipeline-registry/index.js';
import {
  loadWorkflowCatalog,
  WorkflowCatalog,
} from '../../../src/core/workflow-registry/index.js';

function writePipeline(
  projectRoot: string,
  name: string,
  source: string
): string {
  const directory = path.join(projectRoot, 'rasen', 'pipelines', name);
  fs.mkdirSync(directory, { recursive: true });
  const manifest = path.join(directory, 'pipeline.yaml');
  fs.writeFileSync(manifest, source);
  return manifest;
}

function writeWorkflow(workflowsDir: string, id: string): void {
  const directory = path.join(workflowsDir, id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'workflow.yaml'),
    [
      'version: 1',
      `id: ${id}`,
      'files:',
      '  sidecars: []',
      '  scripts: []',
      'requires:',
      '  workflows: []',
      '  skills: []',
      '  pipelines: []',
      '  schemas: []',
      'recommends:',
      '  workflows: []',
      '',
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(directory, 'SKILL.md'),
    [
      '---',
      `name: rasen-${id}`,
      `description: ${id} fixture`,
      'license: MIT',
      'compatibility: Requires rasen CLI.',
      'metadata:',
      '  author: test',
      '  version: "1.0"',
      '---',
      '',
      'Fixture.',
      '',
    ].join('\n')
  );
}

describe('frozen production prepared pipeline registry', () => {
  let temporaryRoot: string;
  let originalRasenHome: string | undefined;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rasen-prepared-registry-')
    );
    originalRasenHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = path.join(temporaryRoot, 'home');
    fs.mkdirSync(process.env.RASEN_HOME, { recursive: true });
  });

  afterEach(() => {
    if (originalRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = originalRasenHome;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('loads one authoritative WorkflowCatalog for skill sets, revisions, and availability', async () => {
    const projectRoot = path.join(temporaryRoot, 'project');
    const catalogA = loadWorkflowCatalog();
    const propose = catalogA.definitions.find(
      (definition) => definition.skill.template.name === 'rasen-propose'
    )!;
    writePipeline(
      projectRoot,
      'exact-v2',
      JSON.stringify({
        version: 2,
        id: 'exact-v2',
        sourceId: 'fixture:exact-v2',
        name: 'exact-v2',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [
            {
              id: 'propose',
              kind: 'AtomicStage',
              capability: {
                id: 'skill:rasen-propose',
                version: propose.digest,
              },
            },
          ],
          connections: [],
        },
      })
    );
    const loader = vi
      .fn()
      .mockReturnValueOnce(catalogA)
      .mockReturnValue(new WorkflowCatalog([]));

    const registry = await freezeProductionPreparedPipelineRegistry(
      projectRoot,
      { workflowCatalogLoader: loader }
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(registry.skillSets.knownSkillNames.has('rasen-propose')).toBe(true);
    expect(
      registry.catalog.descriptors.find(
        (descriptor) => descriptor.id === 'skill:rasen-propose'
      )
    ).toMatchObject({ version: propose.digest, availability: 'enabled' });
    expect(registry.load('exact-v2').prepared.capability.definitionValid).toBe(
      true
    );
  });

  it('threads alternate workflowsDir/projectRoot into the same one-load catalog operation', async () => {
    const projectRoot = path.join(temporaryRoot, 'alternate-project');
    const workflowsDir = path.join(temporaryRoot, 'alternate-workflows');
    writeWorkflow(workflowsDir, 'alternate');
    const loader = vi.fn(loadWorkflowCatalog);

    const registry = await freezeProductionPreparedPipelineRegistry(
      projectRoot,
      {
        workflowRegistryOptions: { workflowsDir },
        workflowCatalogLoader: loader,
      }
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith({ workflowsDir, projectRoot });
    expect(registry.skillSets.knownSkillNames.has('rasen-alternate')).toBe(true);
    expect(
      registry.catalog.descriptors.some(
        (descriptor) => descriptor.id === 'skill:rasen-alternate'
      )
    ).toBe(true);
  });

  it('memoizes successful and failed source resolutions for the whole session', async () => {
    const projectRoot = path.join(temporaryRoot, 'project');
    const stableManifest = writePipeline(
      projectRoot,
      'stable',
      [
        'version: 1',
        'name: stable',
        'description: before',
        'stages:',
        '  - id: propose',
        '    skill: rasen-propose',
        '',
      ].join('\n')
    );
    const brokenManifest = writePipeline(
      projectRoot,
      'broken',
      'version: 2\nname: broken\nroot: [\n'
    );
    const registry = await freezeProductionPreparedPipelineRegistry(
      projectRoot
    );

    const listedStable = registry
      .list()
      .find((pipeline) => pipeline.name === 'stable');
    const listedBroken = registry
      .list()
      .find((pipeline) => pipeline.name === 'broken');
    expect(listedStable?.description).toBe('before');
    expect(listedBroken).toMatchObject({
      definitionValid: false,
      authoredDefinition: {},
    });

    fs.writeFileSync(
      stableManifest,
      [
        'version: 1',
        'name: stable',
        'description: after',
        'stages:',
        '  - id: propose',
        '    skill: rasen-propose',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      brokenManifest,
      [
        'version: 1',
        'name: broken',
        'stages:',
        '  - id: propose',
        '    skill: rasen-propose',
        '',
      ].join('\n')
    );

    expect(
      registry.load('stable').prepared.authoredSource.description
    ).toBe('before');
    let firstError: unknown;
    let secondError: unknown;
    try {
      registry.load('broken');
    } catch (error) {
      firstError = error;
    }
    try {
      registry.load('broken');
    } catch (error) {
      secondError = error;
    }
    expect(firstError).toBeInstanceOf(PipelineLoadError);
    expect(secondError).toBe(firstError);
  });

  it('preserves direct child launch diagnostics through decompose context under one frozen catalog', async () => {
    const projectRoot = path.join(temporaryRoot, 'recursive-project');
    const workflowsDir = path.join(temporaryRoot, 'recursive-workflows');
    writeWorkflow(workflowsDir, 'alternate');
    const workflowCatalog = loadWorkflowCatalog({ workflowsDir, projectRoot });
    const alternate = workflowCatalog.get('alternate')!;
    const parent = (name: string, child: string) =>
      writePipeline(
        projectRoot,
        name,
        [
          'version: 1',
          `name: ${name}`,
          'stages:',
          '  - id: decompose',
          '    kind: decompose',
          `    childPipeline: ${child}`,
          '',
        ].join('\n')
      );
    writePipeline(
      projectRoot,
      'valid-v2',
      JSON.stringify({
        version: 2,
        id: 'valid-v2',
        sourceId: 'fixture:valid-v2',
        name: 'valid-v2',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
          connections: [],
        },
      })
    );
    parent('parent-valid-v2', 'valid-v2');
    writePipeline(
      projectRoot,
      'invalid-v2',
      JSON.stringify({
        version: 2,
        id: 'invalid-v2',
        sourceId: 'fixture:invalid-v2',
        name: 'invalid-v2',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [
            { id: 'duplicate', kind: 'Finish', outcome: 'done' },
            { id: 'duplicate', kind: 'Finish', outcome: 'done' },
          ],
          connections: [],
        },
      })
    );
    parent('parent-invalid-v2', 'invalid-v2');
    writePipeline(
      projectRoot,
      'disabled-v2',
      JSON.stringify({
        version: 2,
        id: 'disabled-v2',
        sourceId: 'fixture:disabled-v2',
        name: 'disabled-v2',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        declarations: [],
        root: {
          nodes: [
            {
              id: 'alternate',
              kind: 'AtomicStage',
              capability: {
                id: 'skill:rasen-alternate',
                version: alternate.digest,
              },
            },
          ],
          connections: [],
        },
      })
    );
    parent('parent-disabled-v2', 'disabled-v2');
    parent('recursive-v1', 'valid-v2');
    parent('parent-recursive-v1', 'recursive-v1');

    const registry = await freezeProductionPreparedPipelineRegistry(
      projectRoot,
      { workflowRegistryOptions: { workflowsDir } }
    );
    expect(
      registry.catalog.descriptors.find(
        (descriptor) => descriptor.id === 'skill:rasen-alternate'
      )
    ).toMatchObject({ availability: 'disabled' });

    let directValid: unknown;
    let nestedValid: unknown;
    try {
      await registry.selectForExecution('valid-v2');
    } catch (error) {
      directValid = error;
    }
    try {
      await registry.selectForExecution('parent-valid-v2');
    } catch (error) {
      nestedValid = error;
    }
    expect(directValid).toMatchObject({
      code: 'ecp_v2_runtime_unavailable',
    });
    expect(nestedValid).toMatchObject({
      code: 'ecp_v2_runtime_unavailable',
      path: '/stages/0/childPipeline',
      cause: directValid,
    });
    expect((nestedValid as Error).message).toContain(
      "Decompose stage 'decompose'"
    );

    await expect(
      registry.selectForExecution('parent-invalid-v2')
    ).rejects.toMatchObject({
      code: 'DUPLICATE_ID',
      path: '/root/nodes/1/id',
    });
    await expect(
      registry.selectForExecution('parent-disabled-v2')
    ).rejects.toMatchObject({
      code: 'CAPABILITY_DISABLED',
      path: '/root/nodes/0/capability',
    });
    await expect(
      registry.selectForExecution('parent-recursive-v1')
    ).rejects.toMatchObject({
      code: 'pipeline_invalid',
      path: '/stages/0/childPipeline',
    });

    expect(nestedValid).toBeInstanceOf(PipelineValidationError);
  });
});
