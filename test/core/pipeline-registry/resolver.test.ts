import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadPipelineByName,
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

describe('pipeline-registry/resolver', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `rasen-pipeline-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    originalEnv = { ...process.env };
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
    it('should resolve full-feature built-in', () => {
      expect(resolvePipelinePath('full-feature')).not.toBeNull();
      const pipeline = loadPipelineByName('full-feature');
      expect(pipeline.name).toBe('full-feature');
      expect(pipeline.stages.length).toBeGreaterThan(0);
    });

    it('should resolve small-feature and bug-fix built-ins', () => {
      expect(loadPipelineByName('small-feature').name).toBe('small-feature');
      expect(loadPipelineByName('bug-fix').name).toBe('bug-fix');
    });

    it('should list all three built-ins', () => {
      const names = listPipelines();
      expect(names).toContain('full-feature');
      expect(names).toContain('small-feature');
      expect(names).toContain('bug-fix');
    });

    it('should strip .yaml/.yml extension from name', () => {
      expect(loadPipelineByName('full-feature.yaml')).toEqual(loadPipelineByName('full-feature'));
      expect(loadPipelineByName('full-feature.yml')).toEqual(loadPipelineByName('full-feature'));
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
