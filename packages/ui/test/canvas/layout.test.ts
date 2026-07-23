/**
 * Pure-logic coverage for the canvas layout seam (pipeline-canvas-view design
 * D3/D6): edge derivation from `requires` (including multi-requires
 * convergence), dagre LR ordering, and parallel-group bounding-box invariants
 * — the regression-prone logic that carries no dependency on React Flow's
 * rendering, so these run under the default `node` environment.
 */
import { describe, expect, it } from 'vitest';
import { definitionToGraph, layoutGraph, NODE_HEIGHT, NODE_WIDTH } from '../../src/canvas/layout.js';
import { pipelineDetailFixture } from '../fixtures/pipelines.js';
import type { PipelineDetailResponse } from '../../src/api/types.js';

describe('definitionToGraph', () => {
  it('derives one edge per requires entry, including multi-requires convergence', () => {
    const { edges } = definitionToGraph(pipelineDetailFixture);

    // review-loop requires review, cso, and qa — three convergent edges.
    const intoReviewLoop = edges.filter((e) => e.target === 'review-loop');
    expect(intoReviewLoop.map((e) => e.source).sort()).toEqual(['cso', 'qa', 'review']);

    // propose -> apply -> {review,cso,qa} -> review-loop -> ship
    expect(edges).toContainEqual({ id: 'propose->apply', source: 'propose', target: 'apply' });
    expect(edges).toContainEqual({ id: 'apply->review', source: 'apply', target: 'review' });
    expect(edges).toContainEqual({ id: 'review-loop->ship', source: 'review-loop', target: 'ship' });
    expect(edges).toHaveLength(8);
  });

  it('joins node data with the resolved stage by id', () => {
    const { nodes } = definitionToGraph(pipelineDetailFixture);
    const apply = nodes.find((n) => n.id === 'apply')!;
    expect(apply.data.role).toBe('implementer');
    expect(apply.data.effectiveModel).toEqual({ value: 'opus-4', source: 'stage-override-project' });
    expect(apply.parallelGroup).toBeUndefined();

    const review = nodes.find((n) => n.id === 'review')!;
    expect(review.parallelGroup).toBe('checks');
  });
});

describe('layoutGraph', () => {
  const { nodes, edges } = definitionToGraph(pipelineDetailFixture);
  const laidOut = layoutGraph(nodes, edges);

  function stageNode(id: string) {
    const node = laidOut.find((n) => n.id === id);
    if (!node || node.type !== 'stage') throw new Error(`expected stage node ${id}`);
    return node;
  }

  function groupNode(id: string) {
    const node = laidOut.find((n) => n.id === id);
    if (!node || node.type !== 'group') throw new Error(`expected group node ${id}`);
    return node;
  }

  it('orders stages left-to-right following their dependencies', () => {
    // Compare ABSOLUTE x (group members' positions are relative to their
    // group, so add the group's own x for a fair comparison).
    const checksBox = groupNode('group:checks');
    function absoluteX(id: string): number {
      const node = stageNode(id);
      return node.parentId ? node.position.x + checksBox.position.x : node.position.x;
    }
    expect(absoluteX('propose')).toBeLessThan(absoluteX('apply'));
    expect(absoluteX('apply')).toBeLessThan(absoluteX('review'));
    expect(absoluteX('apply')).toBeLessThan(absoluteX('cso'));
    expect(absoluteX('apply')).toBeLessThan(absoluteX('qa'));
    expect(absoluteX('review')).toBeLessThan(absoluteX('review-loop'));
    expect(absoluteX('review-loop')).toBeLessThan(absoluteX('ship'));
  });

  it('returns exactly one group node for the parallelGroup, before its members', () => {
    const groupIndex = laidOut.findIndex((n) => n.id === 'group:checks');
    expect(groupIndex).toBeGreaterThanOrEqual(0);
    for (const id of ['review', 'cso', 'qa']) {
      const memberIndex = laidOut.findIndex((n) => n.id === id);
      expect(memberIndex).toBeGreaterThan(groupIndex);
      expect(stageNode(id).parentId).toBe('group:checks');
      expect(stageNode(id).extent).toBe('parent');
    }
  });

  it('sizes the group box to contain exactly its members, with no non-member intersecting it', () => {
    const box = groupNode('group:checks');
    const { width, height } = box.style as { width: number; height: number };

    for (const id of ['review', 'cso', 'qa']) {
      const node = stageNode(id);
      expect(node.position.x).toBeGreaterThanOrEqual(0);
      expect(node.position.y).toBeGreaterThanOrEqual(0);
      expect(node.position.x + NODE_WIDTH).toBeLessThanOrEqual(width);
      expect(node.position.y + NODE_HEIGHT).toBeLessThanOrEqual(height);
    }

    // No non-member stage's absolute box intersects the group's absolute box.
    const groupAbs = {
      left: box.position.x,
      top: box.position.y,
      right: box.position.x + width,
      bottom: box.position.y + height,
    };
    for (const id of ['propose', 'apply', 'review-loop', 'ship']) {
      const node = stageNode(id);
      const nodeAbs = {
        left: node.position.x,
        top: node.position.y,
        right: node.position.x + NODE_WIDTH,
        bottom: node.position.y + NODE_HEIGHT,
      };
      const intersects =
        nodeAbs.left < groupAbs.right &&
        nodeAbs.right > groupAbs.left &&
        nodeAbs.top < groupAbs.bottom &&
        nodeAbs.bottom > groupAbs.top;
      expect(intersects).toBe(false);
    }
  });

  it('lays out an ungrouped pipeline (no parallelGroup) with plain stage nodes only', () => {
    const ungrouped: PipelineDetailResponse = {
      ...pipelineDetailFixture,
      definition: {
        ...pipelineDetailFixture.definition,
        stages: pipelineDetailFixture.definition.stages.map(({ parallelGroup: _drop, ...rest }) => rest),
      },
    };
    const graph = definitionToGraph(ungrouped);
    const result = layoutGraph(graph.nodes, graph.edges);
    expect(result.every((n) => n.type === 'stage')).toBe(true);
    expect(result.some((n) => n.type === 'group')).toBe(false);
  });
});
