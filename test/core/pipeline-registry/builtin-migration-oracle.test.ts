import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CHANGE_LEVEL_BUILTIN_PIPELINES,
  parsePipelineSourceDocument,
} from '../../../src/core/pipeline-registry/index.js';
import { resolvePipelinePath } from '../../../src/core/pipeline-registry/resolver.js';
import { BUILTIN_PIPELINE_MIGRATION_ORACLE } from '../../fixtures/builtin-pipeline-migration-oracle.js';

type LegacyStage = {
  id: string;
  role: string;
  gate?: boolean;
  verifyPolicy?: string;
  parallelGroup?: string;
  condition?: string;
  loop?: {
    kind: string;
    maxRounds?: number;
    loopStallLimit?: number;
    blockedThreshold?: number;
    gate?: { kind?: string };
  };
};

function captureOracle(name: keyof typeof BUILTIN_PIPELINE_MIGRATION_ORACLE) {
  const pipelinePath = resolvePipelinePath(name);
  if (!pipelinePath) throw new Error(`Missing pipeline ${name}.`);
  const source = parsePipelineSourceDocument(fs.readFileSync(pipelinePath, 'utf8')) as {
    version: number;
    handoff?: { roles?: { implementer?: number } };
    stages?: LegacyStage[];
    declarations?: Array<{
      id: string;
      graph: { nodes: Array<Record<string, any>> };
    }>;
    root?: { nodes: Array<Record<string, any>> };
  };

  if (source.version === 2) {
    const nodes = source.root!.nodes;
    const logicalNodes = nodes.filter((node) =>
      node.kind === 'AtomicStage' || node.kind === 'BoundedLoop'
    );
    const base: Record<string, unknown> = {
      order: logicalNodes.map((node) => node.id),
      roles: logicalNodes.map((node) =>
        node.kind === 'AtomicStage'
          ? node.execution.role
          : node.id === 'verify'
            ? 'reviewer'
            : node.id === 'review-loop'
              ? 'fixer'
              : 'implementer'
      ),
      gates: nodes
        .filter((node) => node.kind === 'Gate')
        .map((node) => node.target),
    };
    if (name === 'bug-fix' || name === 'small-feature' || name === 'full-feature') {
      const reviewLoop = logicalNodes.find((node) => node.kind === 'BoundedLoop')!;
      const declaration = source.declarations!.find(
        (candidate) => candidate.id === reviewLoop.body
      )!;
      base.verification = Object.fromEntries([
        ...logicalNodes.flatMap((node) =>
          node.kind === 'AtomicStage' && node.execution.verifyPolicy
            ? [[node.id, node.execution.verifyPolicy]]
            : []
        ),
        ...declaration.graph.nodes.flatMap((node) =>
          node.execution?.verifyPolicy
            ? [[reviewLoop.id, node.execution.verifyPolicy]]
            : []
        ),
      ]);
      base.review = {
        id: reviewLoop.id,
        maxIterations: reviewLoop.limits.maxIterations,
        phases: declaration.graph.nodes.map((node) => node.reviewCyclePhase),
      };
      const fanOut = nodes.find((node) => node.kind === 'FanOut');
      if (fanOut) {
        base.experts = {
          members: fanOut.members.map((member: any) => member.id),
          required: fanOut.members.filter((member: any) => member.required).map((member: any) => member.id),
          optional: fanOut.members.filter((member: any) => !member.required).map((member: any) => member.id),
          conditions: fanOut.members.map((member: any) => member.condition),
          concurrencyCap: fanOut.concurrencyCap,
          budget: fanOut.budget,
          joinMode: 'collect-all',
        };
      }
    } else {
      const iterate = logicalNodes.find((node) => node.id === 'iterate')!;
      base.goal = {
        variant: iterate.goalCycleVariant,
        maxIterations: iterate.limits.maxIterations,
        stallIterations: iterate.lifecycle.thresholds.stallIterations,
        sameBlockerAttempts: iterate.lifecycle.thresholds.sameBlockerAttempts,
      };
      if (name === 'goal-loop-research') {
        const declaration = source.declarations!.find(
          (candidate) => candidate.id === iterate.body
        )!;
        base.implementerHandoffThreshold = declaration.graph.nodes.find(
          (node) => node.goalCyclePhase === 'work'
        )!.execution.handoff.threshold;
      }
    }
    base.tail =
      name === 'goal-loop-research'
        ? ['report']
        : name === 'bug-fix' || name === 'small-feature'
          ? ['ship', 'archive']
          : ['ship', 'retain', 'archive'];
    return base;
  }

  expect(source.version).toBe(1);

  const stages = source.stages!;
  const base: Record<string, unknown> = {
    order: stages.map((stage) => stage.id),
    roles: stages.map((stage) => stage.role),
    gates: stages.filter((stage) => stage.gate).map((stage) => stage.id),
  };
  if (name === 'bug-fix' || name === 'small-feature' || name === 'full-feature') {
    base.verification = Object.fromEntries(
      stages.flatMap((stage) => stage.verifyPolicy ? [[stage.id, stage.verifyPolicy]] : [])
    );
    const loopStage = stages.find(
      (stage) => stage.loop?.kind === 'review-cycle' || stage.verifyPolicy === 'adaptive'
    )!;
    base.review = {
      id: loopStage.id,
      maxIterations: loopStage.loop?.maxRounds ?? 3,
      phases: ['review', 'triage', 'fix', 're-review'],
    };
    const experts = stages.filter((stage) => stage.parallelGroup === 'experts');
    if (experts.length > 0) {
      base.experts = {
        members: experts.map((stage) => stage.id),
        required: experts.filter((stage) => (stage.condition ?? 'always') === 'always').map((stage) => stage.id),
        optional: experts.filter((stage) => (stage.condition ?? 'always') !== 'always').map((stage) => stage.id),
        conditions: experts.map((stage) => stage.condition ?? 'always'),
        concurrencyCap: 3,
        budget: experts.length,
        joinMode: 'collect-all',
      };
    }
  } else {
    const iterate = stages.find((stage) => stage.id === 'iterate')!;
    base.goal = {
      variant: name === 'goal-loop-research' ? 'research' : iterate.loop?.gate?.kind,
      maxIterations: iterate.loop?.maxRounds ?? 5,
      stallIterations: iterate.loop?.loopStallLimit ?? 2,
      sameBlockerAttempts: iterate.loop?.blockedThreshold ?? 3,
    };
    if (name === 'goal-loop-research') {
      base.implementerHandoffThreshold = source.handoff?.roles?.implementer;
    }
  }
  base.tail =
    name === 'goal-loop-research'
      ? ['report']
      : name === 'bug-fix' || name === 'small-feature'
        ? ['ship', 'archive']
        : ['ship', 'retain', 'archive'];
  return base;
}

describe('built-in semantic migration oracle', () => {
  it('captures the established ReviewCycle, GoalLoop, and parallel contracts', () => {
    for (const name of CHANGE_LEVEL_BUILTIN_PIPELINES) {
      expect(captureOracle(name), name).toEqual(BUILTIN_PIPELINE_MIGRATION_ORACLE[name]);
    }
  });
});
