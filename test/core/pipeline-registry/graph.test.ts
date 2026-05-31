import { describe, it, expect } from 'vitest';
import { PipelineGraph } from '../../../src/core/pipeline-registry/graph.js';
import type { PipelineYaml } from '../../../src/core/pipeline-registry/types.js';

describe('pipeline-registry/graph', () => {
  const createPipeline = (stages: PipelineYaml['stages']): PipelineYaml => ({
    name: 'test',
    stages,
  });

  const stage = (id: string, requires: string[] = []): PipelineYaml['stages'][number] => ({
    id,
    skill: 'openspec-propose',
    requires,
    gate: false,
    leadReview: false,
  });

  describe('fromPipeline', () => {
    it('should create graph from pipeline object', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A')]));
      expect(graph.getName()).toBe('test');
      expect(graph.getStage('A')).toBeDefined();
    });
  });

  describe('fromYamlContent', () => {
    it('should create graph from YAML string', () => {
      const yaml = `
name: my-pipeline
stages:
  - id: doc
    skill: openspec-propose
`;
      const graph = PipelineGraph.fromYamlContent(yaml);
      expect(graph.getName()).toBe('my-pipeline');
      expect(graph.getStage('doc')).toBeDefined();
    });
  });

  describe('getStage / getAllStages', () => {
    it('should return stage by ID and undefined for missing', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('a')]));
      expect(graph.getStage('a')?.id).toBe('a');
      expect(graph.getStage('nope')).toBeUndefined();
    });

    it('should return all stages', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([stage('A'), stage('B', ['A']), stage('C')])
      );
      const all = graph.getAllStages();
      expect(all).toHaveLength(3);
      expect(all.map(s => s.id).sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('getBuildOrder', () => {
    it('should return correct order for linear chain A → B → C', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([stage('C', ['B']), stage('A'), stage('B', ['A'])])
      );
      expect(graph.getBuildOrder()).toEqual(['A', 'B', 'C']);
    });

    it('should handle diamond dependency correctly', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([
          stage('D', ['B', 'C']),
          stage('B', ['A']),
          stage('C', ['A']),
          stage('A'),
        ])
      );
      const order = graph.getBuildOrder();
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
    });

    it('should return independent stages in stable sorted order', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([stage('Z'), stage('A'), stage('M')])
      );
      expect(graph.getBuildOrder()).toEqual(['A', 'M', 'Z']);
    });
  });

  describe('getNextStages', () => {
    it('should return root stages when nothing completed', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([stage('A'), stage('B', ['A']), stage('C')])
      );
      expect(graph.getNextStages(new Set()).sort()).toEqual(['A', 'C']);
    });

    it('should include stage when all deps completed', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A'), stage('B', ['A'])]));
      expect(graph.getNextStages(new Set(['A']))).toEqual(['B']);
    });

    it('should not include completed stages', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A'), stage('B', ['A'])]));
      expect(graph.getNextStages(new Set(['A', 'B']))).toEqual([]);
    });

    it('should handle diamond dependency correctly', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([stage('A'), stage('B', ['A']), stage('C', ['A']), stage('D', ['B', 'C'])])
      );
      expect(graph.getNextStages(new Set(['A'])).sort()).toEqual(['B', 'C']);
      expect(graph.getNextStages(new Set(['A', 'B']))).toEqual(['C']);
      expect(graph.getNextStages(new Set(['A', 'B', 'C']))).toEqual(['D']);
    });
  });

  describe('isComplete', () => {
    it('should return true when all stages completed', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A'), stage('B', ['A'])]));
      expect(graph.isComplete(new Set(['A', 'B']))).toBe(true);
    });

    it('should return false when some stages incomplete', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A'), stage('B', ['A'])]));
      expect(graph.isComplete(new Set(['A']))).toBe(false);
      expect(graph.isComplete(new Set())).toBe(false);
    });
  });

  describe('getBlocked', () => {
    it('should return empty object when nothing is blocked', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A')]));
      expect(graph.getBlocked(new Set())).toEqual({});
    });

    it('should return stage blocked by single dependency', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A'), stage('B', ['A'])]));
      expect(graph.getBlocked(new Set())).toEqual({ B: ['A'] });
    });

    it('should return stage blocked by multiple dependencies', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([stage('A'), stage('B'), stage('C', ['A', 'B'])])
      );
      expect(graph.getBlocked(new Set())).toEqual({ C: ['A', 'B'] });
    });

    it('should only list unmet dependencies', () => {
      const graph = PipelineGraph.fromPipeline(
        createPipeline([stage('A'), stage('B'), stage('C', ['A', 'B'])])
      );
      expect(graph.getBlocked(new Set(['A']))).toEqual({ C: ['B'] });
    });

    it('should not include completed stages', () => {
      const graph = PipelineGraph.fromPipeline(createPipeline([stage('A'), stage('B', ['A'])]));
      expect(graph.getBlocked(new Set(['A', 'B']))).toEqual({});
    });
  });
});
