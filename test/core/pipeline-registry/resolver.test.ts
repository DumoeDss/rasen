import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadPipelineByName,
  loadPreparedPipelineByName,
  resolvePipelinePath,
  listPipelines,
  listPipelinesWithInfo,
  getPipelineDir,
  getPackagePipelinesDir,
  getUserPipelinesDir,
  getProjectPipelinesDir,
  resolveChildPipelineName,
  validateDecomposeChildPipelines,
  PipelineLoadError,
} from '../../../src/core/pipeline-registry/resolver.js';
import { parsePipeline, PipelineValidationError } from '../../../src/core/pipeline-registry/pipeline.js';
import {
  createCapabilityCatalogSnapshot,
  type DefinitionSourceV2,
} from '../../../src/core/pipeline-registry/definition.js';
import { freezeProductionPreparedPipelineRegistry } from '../../../src/core/pipeline-registry/prepared-registry.js';

const VALID_PIPELINE = `name: NAME
stages:
  - id: a
    skill: rasen-propose
`;

function writePipeline(dir: string, name: string, content: string): void {
  const pipelineDir = path.join(dir, name);
  fs.mkdirSync(pipelineDir, { recursive: true });
  fs.writeFileSync(path.join(pipelineDir, 'pipeline.yaml'), content);
}

const DEFINITION_CATALOG = createCapabilityCatalogSnapshot([
  {
    id: 'skill:test',
    version: '1',
    availability: 'enabled',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    limits: {},
  },
]);

function v2Definition(
  provenance: 'built-in' | 'custom' = 'built-in'
): DefinitionSourceV2 {
  return {
    version: 2,
    id: 'prepared-registry',
    sourceId: 'fixture:prepared-registry',
    name: 'prepared-registry',
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations: [
      {
        id: 'body',
        kind: 'Composite',
        provenance,
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [{ id: 'body-finish', kind: 'Finish', outcome: 'done' }],
          connections: [],
        },
      },
    ],
    root: {
      nodes: [{ id: 'body-call', kind: 'CompositeRef', declarationId: 'body' }],
      connections: [],
    },
  };
}

describe('pipeline-registry/resolver', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `rasen-pipeline-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    originalEnv = { ...process.env };
    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_DATA_HOME — clear it so this suite's per-test XDG_DATA_HOME
    // isolation actually applies.
    delete process.env.RASEN_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getPackagePipelinesDir', () => {
    it('should return a valid path ending in pipelines', () => {
      const dir = getPackagePipelinesDir();
      expect(typeof dir).toBe('string');
      expect(dir.endsWith('pipelines')).toBe(true);
    });
  });

  describe('getUserPipelinesDir', () => {
    it('should use XDG_DATA_HOME when set', () => {
      process.env.XDG_DATA_HOME = tempDir;
      expect(getUserPipelinesDir()).toBe(path.join(tempDir, 'rasen', 'pipelines'));
    });
  });

  describe('getProjectPipelinesDir', () => {
    it('should return correct path', () => {
      expect(getProjectPipelinesDir('/path/to/project')).toBe(
        path.join('/path/to/project', 'rasen', 'pipelines')
      );
    });
  });

  describe('package built-ins', () => {
    it('should resolve full-feature built-in', async () => {
      expect(resolvePipelinePath('full-feature')).not.toBeNull();
      const registry = await freezeProductionPreparedPipelineRegistry(undefined, {
        reporter: false,
      });
      const prepared = registry.load('full-feature').prepared;
      expect(prepared.authoredSource.name).toBe('full-feature');
      expect(prepared.definition.root.nodes.length).toBeGreaterThan(0);
    });

    it('should resolve small-feature and bug-fix built-ins', async () => {
      const registry = await freezeProductionPreparedPipelineRegistry(undefined, {
        reporter: false,
      });
      expect(registry.load('small-feature').prepared.authoredSource.name).toBe('small-feature');
      expect(registry.load('bug-fix').prepared.authoredSource.name).toBe('bug-fix');
    });

    it('should list all three built-ins', () => {
      const names = listPipelines();
      expect(names).toContain('full-feature');
      expect(names).toContain('small-feature');
      expect(names).toContain('bug-fix');
    });

    it('should strip .yaml/.yml extension from name', async () => {
      const registry = await freezeProductionPreparedPipelineRegistry(undefined, {
        reporter: false,
      });
      expect(registry.load('full-feature.yaml')).toBe(registry.load('full-feature'));
      expect(registry.load('full-feature.yml')).toBe(registry.load('full-feature'));
    });
  });

  describe('getPipelineDir', () => {
    it('should return null for non-existent pipeline', () => {
      expect(getPipelineDir('nonexistent-pipeline')).toBeNull();
    });

    it('should return package dir for built-in pipeline', () => {
      const dir = getPipelineDir('full-feature');
      expect(dir).not.toBeNull();
      expect(dir).toContain('pipelines');
      expect(dir).toContain('full-feature');
    });
  });

  describe('resolvePipelinePath', () => {
    it('should return null for unknown pipeline', () => {
      expect(resolvePipelinePath('does-not-exist')).toBeNull();
    });
  });

  describe('loadPipelineByName errors', () => {
    it('should throw with available list when not found', () => {
      try {
        loadPipelineByName('nope');
        expect.fail('Should have thrown');
      } catch (e) {
        const error = e as Error;
        expect(error.message).toContain('not found');
        expect(error.message).toContain('full-feature');
      }
    });

    it('should throw PipelineLoadError for invalid user override', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'full-feature',
        'name: broken\nstages:\n  - id: a\n' // missing skill
      );
      expect(() => loadPipelineByName('full-feature')).toThrow(PipelineLoadError);
    });

    it('should detect cycles in user override pipelines', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'full-feature',
        `name: cyclic
stages:
  - id: a
    skill: rasen-propose
    requires: [b]
  - id: b
    skill: rasen-apply-change
    requires: [a]
`
      );
      expect(() => loadPipelineByName('full-feature')).toThrow(/Cyclic dependency/);
    });
  });

  describe('precedence: project > user > package', () => {
    it('should prefer user override over package built-in', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'full-feature',
        VALID_PIPELINE.replace('NAME', 'user-override')
      );

      const pipeline = loadPipelineByName('full-feature');
      expect(pipeline.name).toBe('user-override');
    });

    it('should prefer project-local over user override', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'shared',
        VALID_PIPELINE.replace('NAME', 'user-version')
      );

      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'shared',
        VALID_PIPELINE.replace('NAME', 'project-version')
      );

      const dir = getPipelineDir('shared', projectRoot);
      expect(dir).toBe(path.join(projectRoot, 'rasen', 'pipelines', 'shared'));

      const pipeline = loadPipelineByName('shared', projectRoot);
      expect(pipeline.name).toBe('project-version');
    });

    it('should prefer project-local over package built-in', () => {
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'full-feature',
        VALID_PIPELINE.replace('NAME', 'project-full-feature')
      );

      expect(loadPipelineByName('full-feature', projectRoot).name).toBe('project-full-feature');
    });

    it('should fall back to package built-in when no project or user', () => {
      const projectRoot = path.join(tempDir, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });
      const dir = getPipelineDir('full-feature', projectRoot);
      expect(dir).not.toBeNull();
      expect(dir).not.toContain(projectRoot);
    });

    it('should maintain backward compatibility when projectRoot not provided', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'shared',
        VALID_PIPELINE.replace('NAME', 'user-version')
      );
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'shared',
        VALID_PIPELINE.replace('NAME', 'project-version')
      );

      // Without projectRoot, project-local is ignored -> user wins
      expect(loadPipelineByName('shared').name).toBe('user-version');
    });
  });

  describe('prepared definition resolution', () => {
    it('prepares native-v2 package and authored-v1 user definitions', async () => {
      const registry = await freezeProductionPreparedPipelineRegistry(undefined, {
        reporter: false,
      });
      const packageResult = registry.load('small-feature');
      expect(packageResult.source).toBe('package');
      expect(packageResult.prepared.authoredVersion).toBe(2);
      expect(packageResult.prepared.capability).toMatchObject({
        planAvailable: true,
        executable: true,
        executionMode: 'reconciler',
      });

      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'explicit-v1',
        `version: 1\n${VALID_PIPELINE.replace('NAME', 'explicit-v1')}`
      );
      const userResult = loadPreparedPipelineByName('explicit-v1', undefined, {
        catalog: createCapabilityCatalogSnapshot([]),
      });
      expect(userResult.source).toBe('user');
      expect(userResult.prepared.authoredVersion).toBe(1);
      expect(userResult.authoredText).toContain('version: 1');
    });

    it('prepares a v2 winner from the project layer and retains authored source and provenance', () => {
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'prepared-v2',
        JSON.stringify(v2Definition('custom'))
      );

      const result = loadPreparedPipelineByName('prepared-v2', projectRoot, {
        catalog: DEFINITION_CATALOG,
      });

      expect(result.source).toBe('project');
      expect(result.pipelinePath).toBe(
        path.join(projectRoot, 'rasen', 'pipelines', 'prepared-v2', 'pipeline.yaml')
      );
      expect(result.prepared.authoredVersion).toBe(2);
      expect(result.prepared.authoredSource).toMatchObject({
        declarations: [expect.objectContaining({ provenance: 'custom' })],
      });
      expect(result.prepared.capability).toMatchObject({
        definitionValid: true,
        planAvailable: true,
        executable: false,
        executionMode: 'unavailable',
        unavailableReason: 'ecp_v2_runtime_unavailable',
      });
    });

    it('uses the supplied frozen catalog before selecting the unavailable v2 runtime', () => {
      const projectRoot = path.join(tempDir, 'project');
      const source: DefinitionSourceV2 = {
        ...v2Definition('custom'),
        root: {
          nodes: [
            {
              id: 'exact-capability',
              kind: 'AtomicStage',
              capability: { id: 'skill:test', version: '1' },
              execution: {
                version: 1,
                role: 'implementer',
                workspace: { access: 'write' },
              },
            },
          ],
          connections: [],
        },
      };
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'prepared-v2',
        JSON.stringify(source)
      );

      expect(() =>
        parsePipeline(JSON.stringify(source), DEFINITION_CATALOG)
      ).toThrow(
        expect.objectContaining({ code: 'ecp_v2_runtime_unavailable' })
      );
      try {
        loadPipelineByName('prepared-v2', projectRoot, {
          catalog: DEFINITION_CATALOG,
        });
        expect.fail('expected valid v2 to stop at the unavailable runtime selection');
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineLoadError);
        expect((error as PipelineLoadError).cause).toMatchObject({
          code: 'ecp_v2_runtime_unavailable',
        });
        expect((error as PipelineLoadError).message).not.toContain('stages');
        expect((error as PipelineLoadError).message).not.toContain('CAPABILITY_MISSING');
        expect((error as PipelineLoadError).message).not.toContain('PORT_MISMATCH');
      }
    });

    it('fails closed on an unsupported project winner instead of falling through to user', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'shadowed',
        VALID_PIPELINE.replace('NAME', 'user-fallback')
      );
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'shadowed',
        'version: 99\nname: future'
      );

      try {
        loadPreparedPipelineByName('shadowed', projectRoot, {
          catalog: DEFINITION_CATALOG,
        });
        expect.fail('expected unsupported winning version to fail closed');
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineLoadError);
        const loadError = error as PipelineLoadError;
        expect(loadError.pipelinePath).toBe(
          path.join(projectRoot, 'rasen', 'pipelines', 'shadowed', 'pipeline.yaml')
        );
        expect(loadError.cause).toMatchObject({
          diagnostics: [
            expect.objectContaining({ code: 'UNSUPPORTED_VERSION', path: '/version' }),
          ],
        });
      }
    });

    it('keeps an invalid project winner authoritative in prepared inventory', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'shadowed',
        VALID_PIPELINE.replace('NAME', 'user-fallback')
      );
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'shadowed',
        'version: 99\nname: future'
      );

      const infos = listPipelinesWithInfo(projectRoot, {
        catalog: DEFINITION_CATALOG,
      });
      const winners = infos.filter((entry) => entry.name === 'shadowed');

      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({
        source: 'project',
        authoredVersion: 99,
        definitionValid: false,
        planAvailable: false,
        executable: false,
        diagnostics: [
          expect.objectContaining({
            code: 'UNSUPPORTED_VERSION',
            path: '/version',
          }),
        ],
      });
    });

    it('surfaces an invalid winner in prepared inventory without any fallback', () => {
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'invalid-only',
        JSON.stringify({
          ...v2Definition('custom'),
          root: {
            nodes: [{ id: 'choice', kind: 'Choice' }],
            connections: [],
          },
        })
      );

      const info = listPipelinesWithInfo(projectRoot, {
        catalog: DEFINITION_CATALOG,
      }).find((entry) => entry.name === 'invalid-only');

      expect(info).toMatchObject({
        source: 'project',
        authoredVersion: 2,
        definitionValid: false,
        diagnostics: [
          expect.objectContaining({
            code: 'INVALID_SOURCE',
            path: '/root/nodes/0/outcomes',
          }),
        ],
      });
    });

    it('projects the authoritative cyclic-v1 diagnostic through prepared load and inventory', () => {
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'cyclic-v1',
        [
          'version: 1',
          'name: cyclic-v1',
          'stages:',
          '  - id: a',
          '    skill: rasen-propose',
          '    requires: [b]',
          '  - id: b',
          '    skill: rasen-review',
          '    requires: [a]',
          '',
        ].join('\n')
      );

      expect(() =>
        loadPreparedPipelineByName('cyclic-v1', projectRoot, {
          catalog: DEFINITION_CATALOG,
        })
      ).toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({
            diagnostics: expect.arrayContaining([
              expect.objectContaining({
                code: 'GRAPH_CYCLE',
                path: '/stages/1/requires/0',
              }),
            ]),
          }),
        })
      );

      expect(
        listPipelinesWithInfo(projectRoot, {
          catalog: DEFINITION_CATALOG,
        }).find((entry) => entry.name === 'cyclic-v1')
      ).toMatchObject({
        authoredVersion: 1,
        definitionValid: false,
        diagnostics: [
          expect.objectContaining({
            code: 'GRAPH_CYCLE',
            path: '/stages/1/requires/0',
          }),
        ],
      });
    });

    it('prepares equivalent built-in and custom Composite declarations identically', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'built-in-composite',
        JSON.stringify(v2Definition('built-in'))
      );
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'custom-composite',
        JSON.stringify(v2Definition('custom'))
      );

      const builtIn = loadPreparedPipelineByName('built-in-composite', projectRoot, {
        catalog: DEFINITION_CATALOG,
      });
      const custom = loadPreparedPipelineByName('custom-composite', projectRoot, {
        catalog: DEFINITION_CATALOG,
      });

      expect(builtIn.source).toBe('user');
      expect(custom.source).toBe('project');
      expect(builtIn.prepared.definition.declarations[0]?.provenance).toBe('built-in');
      expect(custom.prepared.definition.declarations[0]?.provenance).toBe('custom');
      expect(custom.prepared.digests.source).toBe(builtIn.prepared.digests.source);
      expect(custom.prepared.digests.plan).toBe(builtIn.prepared.digests.plan);
    });
  });

  describe('listPipelines', () => {
    it('should include user override pipelines', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'custom-flow',
        VALID_PIPELINE.replace('NAME', 'custom-flow')
      );
      const names = listPipelines();
      expect(names).toContain('custom-flow');
      expect(names).toContain('full-feature');
    });

    it('should deduplicate pipelines with same name and return sorted', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'full-feature',
        VALID_PIPELINE.replace('NAME', 'override')
      );
      const names = listPipelines();
      expect(names.filter(n => n === 'full-feature')).toHaveLength(1);
      expect(names).toEqual([...names].sort());
    });

    it('should only include directories with pipeline.yaml', () => {
      process.env.XDG_DATA_HOME = tempDir;
      const base = path.join(tempDir, 'rasen', 'pipelines');
      fs.mkdirSync(path.join(base, 'empty-dir'), { recursive: true });
      writePipeline(base, 'valid', VALID_PIPELINE.replace('NAME', 'valid'));

      const names = listPipelines();
      expect(names).toContain('valid');
      expect(names).not.toContain('empty-dir');
    });
  });

  describe('listPipelinesWithInfo', () => {
    it('should return source: package for built-ins', () => {
      const infos = listPipelinesWithInfo();
      const fullFeature = infos.find(p => p.name === 'full-feature');
      expect(fullFeature).toBeDefined();
      expect(fullFeature!.source).toBe('package');
      expect(fullFeature!.stages).toContain('propose');
    });

    it('should return source: user for user overrides', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'user-custom',
        VALID_PIPELINE.replace('NAME', 'user-custom')
      );
      const infos = listPipelinesWithInfo();
      const userInfo = infos.find(p => p.name === 'user-custom');
      expect(userInfo).toBeDefined();
      expect(userInfo!.source).toBe('user');
    });

    it('should return source: project and project wins over user', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'shared',
        VALID_PIPELINE.replace('NAME', 'user-shared')
      );
      const projectRoot = path.join(tempDir, 'project');
      writePipeline(
        path.join(projectRoot, 'rasen', 'pipelines'),
        'shared',
        VALID_PIPELINE.replace('NAME', 'project-shared')
      );

      const infos = listPipelinesWithInfo(projectRoot);
      const shared = infos.find(p => p.name === 'shared');
      expect(shared).toBeDefined();
      expect(shared!.source).toBe('project');
    });
  });

  describe('decompose childPipeline resolution', () => {
    const DECOMPOSE_PARENT = (child?: string) => `
name: parent
stages:
  - id: decompose
    kind: decompose
${child ? `    childPipeline: ${child}\n` : ''}  - id: propose
    skill: rasen-propose
    requires: [decompose]
`;

    it('resolveChildPipelineName defaults to small-feature when omitted', () => {
      const pipeline = parsePipeline(DECOMPOSE_PARENT());
      expect(resolveChildPipelineName(pipeline.stages[0])).toBe('small-feature');
    });

    it('resolveChildPipelineName returns the explicit childPipeline', () => {
      const pipeline = parsePipeline(DECOMPOSE_PARENT('bug-fix'));
      expect(resolveChildPipelineName(pipeline.stages[0])).toBe('bug-fix');
    });

    it('passes when the omitted-default childPipeline (small-feature) resolves and is decompose-free', () => {
      const pipeline = parsePipeline(DECOMPOSE_PARENT());
      expect(() => validateDecomposeChildPipelines(pipeline)).not.toThrow();
    });

    it('throws when the childPipeline cannot be resolved', () => {
      const pipeline = parsePipeline(DECOMPOSE_PARENT('no-such-pipeline'));
      expect(() => validateDecomposeChildPipelines(pipeline)).toThrow(PipelineValidationError);
      expect(() => validateDecomposeChildPipelines(pipeline)).toThrow(/cannot be resolved/);
    });

    it('throws a recursion-guard error when the childPipeline itself contains a decompose stage', () => {
      process.env.XDG_DATA_HOME = tempDir;
      writePipeline(
        path.join(tempDir, 'rasen', 'pipelines'),
        'recursive-child',
        `name: recursive-child
stages:
  - id: decompose
    kind: decompose
  - id: propose
    skill: rasen-propose
    requires: [decompose]
`
      );
      const pipeline = parsePipeline(DECOMPOSE_PARENT('recursive-child'));
      expect(() => validateDecomposeChildPipelines(pipeline)).toThrow(/Recursion guard/);
      expect(() => validateDecomposeChildPipelines(pipeline)).toThrow(/recursive-child/);
    });

    it('is a no-op for pipelines without a decompose stage', () => {
      const pipeline = parsePipeline(VALID_PIPELINE.replace('NAME', 'plain'));
      expect(() => validateDecomposeChildPipelines(pipeline)).not.toThrow();
    });
  });
});
