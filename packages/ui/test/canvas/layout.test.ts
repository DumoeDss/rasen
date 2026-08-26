/**
 * Pure-logic coverage for the canvas layout seam (pipeline-canvas-view design
 * D3/D6): edge derivation from `requires` (including multi-requires
 * convergence), dagre LR ordering, and parallel-group bounding-box invariants
 * — the regression-prone logic that carries no dependency on React Flow's
 * rendering, so these run under the default `node` environment.
 */
import { describe, expect, it } from 'vitest';
import {
  definitionToGraph,
  draftToGraph,
  declarationBodyFrame,
  GROUP_LABEL_HEIGHT,
  GROUP_PADDING,
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  pruneAuthorPositions,
} from '../../src/canvas/layout.js';
import { pipelineDetailFixture } from '../fixtures/pipelines.js';
import {
  CANVAS_V2_APPLY_CAPABILITY,
  CANVAS_V2_AUTHORING_CATALOG,
  CANVAS_V2_AUTHORING_DEFINITION,
} from '../fixtures/canvas-v2-authoring.js';
import type {
  PipelineDetailResponse,
  WirePipelineDefinitionV2,
} from '../../src/api/types.js';

describe('definitionToGraph', () => {
  it('renders the accepted control target for production-shaped input-less AtomicStages', () => {
    const { nodes } = draftToGraph(
      structuredClone(CANVAS_V2_AUTHORING_DEFINITION),
      CANVAS_V2_AUTHORING_CATALOG
    );
    const atomic = nodes.find((node) => node.id === 'atomic-stage');

    expect(atomic?.data.inputPorts).toEqual([{ id: 'input' }]);
    expect(atomic?.data.outputPorts).toContainEqual({
      id: 'done',
      type: 'outcome/done',
    });
  });

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

describe('layoutGraph author positions (canvas-durable-node-positioning)', () => {
  // Ungrouped v2-shaped input: the cache only ever holds v2 placements, and
  // group members are excluded by contract, so the override surface here is
  // plain stage nodes.
  const { nodes: v2Nodes, edges: v2Edges } = draftToGraph(
    structuredClone(CANVAS_V2_AUTHORING_DEFINITION),
    CANVAS_V2_AUTHORING_CATALOG
  );
  const baseline = layoutGraph(v2Nodes, v2Edges);

  function positionsOf(result: ReturnType<typeof layoutGraph>) {
    return Object.fromEntries(
      result.map((node) => [node.id, node.position])
    );
  }

  it('renders a stage node with a cached placement at that placement, by id', () => {
    const placement = { x: 777, y: 333 };
    const result = layoutGraph(
      v2Nodes,
      v2Edges,
      new Map([['atomic-stage', placement]])
    );
    expect(result.find((n) => n.id === 'atomic-stage')?.position).toEqual(placement);
    // Every OTHER node keeps its computed layout position exactly.
    const basePositions = positionsOf(baseline);
    for (const node of result) {
      if (node.id === 'atomic-stage') continue;
      expect(node.position).toEqual(basePositions[node.id]);
    }
  });

  it('no cache (undefined or empty) is identical output to today', () => {
    expect(layoutGraph(v2Nodes, v2Edges, new Map())).toEqual(baseline);
    expect(layoutGraph(v2Nodes, v2Edges, undefined)).toEqual(baseline);
  });

  it('ignores cache entries whose ids are not in the graph', () => {
    const result = layoutGraph(
      v2Nodes,
      v2Edges,
      new Map([
        ['departed-node', { x: 500, y: 500 }],
        ['group:checks', { x: 900, y: 900 }],
      ])
    );
    expect(result).toEqual(baseline);
  });

  it('group members and group nodes never take a cached position', () => {
    const { nodes, edges } = definitionToGraph(pipelineDetailFixture);
    const groupedBaseline = layoutGraph(nodes, edges);
    const result = layoutGraph(
      nodes,
      edges,
      new Map([
        // 'review' is a member of group:checks — parent-relative coordinates,
        // excluded from the override by contract.
        ['review', { x: 4242, y: 2424 }],
        // A key shaped like a synthesized group node id — nothing matches it.
        ['group:checks', { x: 8484, y: 4848 }],
      ])
    );
    expect(result).toEqual(groupedBaseline);
  });
});

describe('pruneAuthorPositions', () => {
  it('drops departed ids and keeps present ones', () => {
    const cache = new Map([
      ['stays', { x: 1, y: 2 }],
      ['departs', { x: 3, y: 4 }],
    ]);
    const pruned = pruneAuthorPositions(cache, ['stays', 'newcomer']);
    expect([...pruned.keys()].sort()).toEqual(['stays']);
    expect(pruned.get('stays')).toEqual({ x: 1, y: 2 });
    // Pure: the input map is untouched, and the result is a fresh Map — a
    // re-added 'departs' cannot resurrect its departed placement.
    expect(cache.has('departs')).toBe(true);
    const reAdded = pruneAuthorPositions(cache, ['departs']);
    expect([...reAdded.keys()]).toEqual(['departs']);
  });

  it('an empty present set yields an empty cache', () => {
    const pruned = pruneAuthorPositions(
      new Map([['gone', { x: 0, y: 0 }]]),
      []
    );
    expect(pruned.size).toBe(0);
  });
});

describe('declarationBodyFrame / draftToGraph expandedFrames (canvas-loop-body-visibility)', () => {
  /**
   * The frame-test shape: a two-stage body (`review -> fix`) shared by a
   * BoundedLoop and TWO CompositeRefs, over a root graph that deliberately
   * contains a root node whose id EQUALS a body node id (`review`) — the
   * namespacing must keep them distinct.
   */
  function frameDefinition(): WirePipelineDefinitionV2 {
    const stage = (id: string) => ({
      id,
      kind: 'AtomicStage' as const,
      capability: { ...CANVAS_V2_APPLY_CAPABILITY },
      execution: {
        version: 1 as const,
        role: 'implementer' as const,
        workspace: { access: 'write' as const },
      },
    });
    return {
      version: 2,
      id: 'definition:frame-test',
      sourceId: 'fixture:frame-test',
      name: 'frame-test',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [
        {
          id: 'shared-body',
          kind: 'Composite' as const,
          provenance: 'custom' as const,
          inputs: [],
          artifacts: [],
          outcomes: ['done'],
          graph: {
            nodes: [stage('review'), stage('fix')],
            connections: [
              {
                id: 'review:done->fix:input',
                from: { node: 'review', port: 'done' },
                to: { node: 'fix', port: 'input' },
              },
            ],
          },
        },
      ],
      root: {
        nodes: [
          stage('start'),
          stage('review'),
          {
            id: 'loop',
            kind: 'BoundedLoop' as const,
            body: 'shared-body',
            limits: { maxIterations: 3, maxActions: 12, budget: 12 },
            lifecycle: {
              version: 1 as const,
              thresholds: { stallIterations: 2, sameBlockerAttempts: 2 },
              strategy: { maxAttempts: 0, requireMaterialChange: true as const },
              exits: {
                iterationLimit: { action: 'exit' as const, outcome: 'iteration-limit' },
                actionLimit: { action: 'fail' as const, outcome: 'action-limit' },
                budgetLimit: { action: 'fail' as const, outcome: 'budget-limit' },
                stalled: { action: 'escalate' as const, outcome: 'stalled' },
                blocked: { action: 'human-required' as const, outcome: 'blocked' },
                strategyExhausted: { action: 'fail' as const, outcome: 'strategy-exhausted' },
              },
            },
            exits: { done: { action: 'exit' as const, outcome: 'done' } },
          },
          { id: 'ref-a', kind: 'CompositeRef' as const, declarationId: 'shared-body' },
          { id: 'ref-b', kind: 'CompositeRef' as const, declarationId: 'shared-body' },
        ],
        connections: [
          {
            id: 'start:done->review:input',
            from: { node: 'start', port: 'done' },
            to: { node: 'review', port: 'input' },
          },
          {
            id: 'review:done->loop:review',
            from: { node: 'review', port: 'done' },
            to: { node: 'loop', port: 'review' },
          },
          {
            id: 'loop:done->ref-a:review',
            from: { node: 'loop', port: 'done' },
            to: { node: 'ref-a', port: 'review' },
          },
          {
            id: 'ref-a:done->ref-b:review',
            from: { node: 'ref-a', port: 'done' },
            to: { node: 'ref-b', port: 'review' },
          },
        ],
      },
    };
  }

  it('a node without dimensions lays out exactly as today (default pin, task 1.1)', () => {
    const { nodes: v2Nodes, edges: v2Edges } = draftToGraph(
      structuredClone(CANVAS_V2_AUTHORING_DEFINITION),
      CANVAS_V2_AUTHORING_CATALOG
    );
    const plain = layoutGraph(v2Nodes, v2Edges);
    // Explicitly passing TODAY's constants must produce the exact same
    // GEOMETRY as omitting them — the dagre default and the
    // center-to-top-left conversion are the old behavior. (Explicit dims also
    // stamp a style — that coupling is the frame mechanism, not geometry.)
    const geometry = (nodes: ReturnType<typeof layoutGraph>) =>
      nodes.map((node) => ({ id: node.id, position: node.position }));
    const withDefaults = layoutGraph(
      v2Nodes.map((node) => ({ ...node, width: NODE_WIDTH, height: NODE_HEIGHT })),
      v2Edges
    );
    expect(geometry(withDefaults)).toEqual(geometry(plain));
    // And omitting dimensions introduces no style key — the parity a plain
    // card relies on (no render-size override anywhere).
    for (const node of plain) {
      if (node.type === 'stage') expect(node.style).toBeUndefined();
    }
  });

  it('no expandedFrames arg (or an empty set) emits the pre-change projection — no body nodes, no affordance data', () => {
    const def = frameDefinition();
    const omitted = draftToGraph(structuredClone(def), CANVAS_V2_AUTHORING_CATALOG);
    expect(draftToGraph(structuredClone(def), CANVAS_V2_AUTHORING_CATALOG, undefined)).toEqual(
      omitted
    );
    expect(omitted.frameChildren.size).toBe(0);
    // View mode / non-editor callers: no chevron data anywhere.
    for (const node of omitted.nodes) {
      expect(node.data.frameToggle).toBeUndefined();
      expect(node.width).toBeUndefined();
      expect(node.height).toBeUndefined();
    }
    // Edit mode with NOTHING expanded: the affordance flag appears on exactly
    // the loop and the two refs (their declaration resolves), still with zero
    // body children and zero extra edges.
    const collapsedEdit = draftToGraph(structuredClone(def), CANVAS_V2_AUTHORING_CATALOG, new Set());
    for (const node of collapsedEdit.nodes) {
      const expandable = node.id === 'loop' || node.id === 'ref-a' || node.id === 'ref-b';
      expect(node.data.frameToggle).toEqual(expandable ? { expanded: false } : undefined);
    }
    expect(collapsedEdit.frameChildren.size).toBe(0);
    expect(collapsedEdit.edges).toHaveLength(def.root.connections.length);
    // The collapsed-edit nodes carry no dimensions — same render box as the
    // no-arg projection (the ONLY data delta is the frameToggle flag pinned
    // above).
    for (const node of collapsedEdit.nodes) {
      expect(node.width).toBeUndefined();
      expect(node.height).toBeUndefined();
    }
  });

  it('expands a loop into a sized frame with namespaced body children and a prefixed body edge', () => {
    const expanded = draftToGraph(frameDefinition(), CANVAS_V2_AUTHORING_CATALOG, new Set(['loop']));
    // Root nodes stay exactly the root ids — body children never mix into the
    // root array (the placement cache's prune set).
    expect(expanded.nodes.map((node) => node.id)).toEqual([
      'start',
      'review',
      'loop',
      'ref-a',
      'ref-b',
    ]);
    const frameStage = expanded.nodes.find((node) => node.id === 'loop')!;
    expect(frameStage.width).toBeGreaterThan(NODE_WIDTH);
    expect(frameStage.height).toBeGreaterThan(NODE_HEIGHT);
    const children = expanded.frameChildren.get('loop')!;
    expect(children).toHaveLength(2);
    // The root id 'review' coexists with the namespaced child 'loop::review'.
    expect(children.map((child) => child.id).sort()).toEqual(['loop::fix', 'loop::review']);
    for (const child of children) {
      expect(child.parentId).toBe('loop');
      expect(child.extent).toBe('parent');
      // Group-node parity: inert in React Flow terms by construction.
      expect(child.selectable).toBe(false);
      expect(child.draggable).toBe(false);
      expect(child.connectable).toBe(false);
      expect(child.deletable).toBe(false);
      expect(child.data.bodyStage).toEqual({ frameId: 'loop', declarationId: 'shared-body' });
      // Card data is the real projection (id/kind/ports from the body graph).
      expect(child.data.id).toBe(child.id.slice('loop::'.length));
      expect(child.data.definitionKind).toBe('AtomicStage');
    }
    expect(expanded.edges).toContainEqual({
      id: 'body:loop:review:done->fix:input',
      source: 'loop::review',
      target: 'loop::fix',
      sourceHandle: 'done',
      targetHandle: 'input',
    });
  });

  it('frame sizing arithmetic: children sit inside the box at the group insets, style carries the box', () => {
    const expanded = draftToGraph(frameDefinition(), CANVAS_V2_AUTHORING_CATALOG, new Set(['loop']));
    const frameStage = expanded.nodes.find((node) => node.id === 'loop')!;
    // The group-sizing arithmetic, pinned from the children's relative
    // positions: min insets exactly GROUP_PADDING (+ the header strip on top),
    // max edges exactly one GROUP_PADDING from the far side.
    const rel = expanded.frameChildren.get('loop')!.map((child) => child.position);
    expect(Math.min(...rel.map((p) => p.x))).toBe(GROUP_PADDING);
    expect(Math.min(...rel.map((p) => p.y))).toBe(GROUP_PADDING + GROUP_LABEL_HEIGHT);
    expect(Math.max(...rel.map((p) => p.x + NODE_WIDTH))).toBe(
      frameStage.width! - GROUP_PADDING
    );
    expect(Math.max(...rel.map((p) => p.y + NODE_HEIGHT))).toBe(
      frameStage.height! - GROUP_PADDING
    );
    // The laid-out frame node carries the same box as its render style.
    const laidOut = layoutGraph(expanded.nodes, expanded.edges, undefined, expanded.frameChildren);
    const frame = laidOut.find((node) => node.id === 'loop')!;
    expect(frame.style).toEqual({ width: frameStage.width, height: frameStage.height });
    // Frame strictly before its children — React Flow's parentId resolution
    // order (the v1 group rule).
    const frameIndex = laidOut.findIndex((node) => node.id === 'loop');
    for (const child of expanded.frameChildren.get('loop')!) {
      expect(laidOut.findIndex((node) => node.id === child.id)).toBeGreaterThan(frameIndex);
    }
  });

  it('two expanded refs sharing ONE declaration: per-frame namespacing, no duplicate flow ids', () => {
    const expanded = draftToGraph(frameDefinition(), CANVAS_V2_AUTHORING_CATALOG, new Set(['ref-a', 'ref-b']));
    expect([...expanded.frameChildren.get('ref-a')!.map((c) => c.id)].sort()).toEqual([
      'ref-a::fix',
      'ref-a::review',
    ]);
    expect([...expanded.frameChildren.get('ref-b')!.map((c) => c.id)].sort()).toEqual([
      'ref-b::fix',
      'ref-b::review',
    ]);
    const laidOut = layoutGraph(expanded.nodes, expanded.edges, undefined, expanded.frameChildren);
    const allIds = laidOut.map((node) => node.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(expanded.edges.map((edge) => edge.id).sort()).toEqual([
      'body:ref-a:review:done->fix:input',
      'body:ref-b:review:done->fix:input',
      'loop:done->ref-a:review',
      'ref-a:done->ref-b:review',
      'review:done->loop:review',
      'start:done->review:input',
    ]);
  });

  it('declarationBodyFrame returns null for an unresolvable declaration or an empty body', () => {
    const def = frameDefinition();
    expect(declarationBodyFrame(def, 'missing-declaration', 'loop', CANVAS_V2_AUTHORING_CATALOG)).toBeNull();
    expect(declarationBodyFrame(def, undefined, 'loop')).toBeNull();
    const emptyBody = structuredClone(def);
    emptyBody.declarations[0]!.graph = { nodes: [], connections: [] };
    expect(declarationBodyFrame(emptyBody, 'shared-body', 'loop')).toBeNull();
    // An id not in the expanded set is not projected at all (draftToGraph
    // level): the collapsed card carries no dimensions.
    const collapsed = draftToGraph(def, CANVAS_V2_AUTHORING_CATALOG, new Set(['loop']));
    for (const id of ['ref-a', 'ref-b']) {
      const node = collapsed.nodes.find((candidate) => candidate.id === id)!;
      expect(node.width).toBeUndefined();
      expect(node.data.frameToggle).toEqual({ expanded: false });
    }
  });
});
