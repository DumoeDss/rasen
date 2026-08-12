/**
 * The strict Execution Plan revision schema and its graph checker — pure, no
 * filesystem, no Git.
 *
 * A revision is IMMUTABLE once published, so everything that could make one
 * invalid is decided here, before a byte is written: the schema, the two node
 * kinds, the acyclicity of `dependsOn`, duplicate node identifiers, and two
 * nodes claiming one Change instance. Reference verification against real Store
 * evidence is the one check this file cannot do, because it needs Git; it lives
 * in `references.ts` and runs before this file's serializer is ever called.
 *
 * `contentSha256` covers the canonical serialization of every other field. A
 * digest cannot cover itself, and stating which bytes it covers is the whole
 * point of having it: a hand-edited revision is reported as a mismatch and is
 * never silently repaired or re-digested.
 */
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { canonicalJson } from '../../canonical-json.js';
import { formatZodIssues } from '../../zod-issues.js';
import {
  StorePlanningValidationError,
  isCanonicalIsoTimestamp,
  parseChangeId,
  parseExecutionPlanRevisionId,
  parseIssueId,
  parseProjectId,
  parseSha256Digest,
  parseTargetLineId,
  type ExecutionPlanRevisionId,
  type IssueId,
  type Sha256Digest,
} from '../planning-validation.js';
import { parseChangeInstanceId } from '../planning-identity.js';
import { assertPortableIssueText } from './records.js';
import type {
  ExecutionPlanNode,
  ExecutionPlanNodeInput,
  ExecutionPlanRevisionV1,
} from './types.js';

function planError(
  field: string,
  message: string,
  cause?: unknown
): StorePlanningValidationError {
  return new StorePlanningValidationError('invalid_execution_plan', field, message, cause);
}

function rethrow<T>(field: string, action: () => T): T {
  try {
    return action();
  } catch (error) {
    throw planError(field, error instanceof Error ? error.message : String(error), error);
  }
}

const NodeBaseShape = {
  nodeId: z.string(),
  projectId: z.string(),
  targetLineId: z.string(),
  dependsOn: z.array(z.string()),
};

const ChangeNodeSchema = z
  .object({
    ...NodeBaseShape,
    kind: z.literal('change'),
    changeInstanceId: z.string(),
    changeAlias: z.string().min(1).optional(),
  })
  .strict();

const IntentNodeSchema = z
  .object({
    ...NodeBaseShape,
    kind: z.literal('intent'),
    summary: z.string().min(1).max(500),
  })
  .strict();

const NodeSchema = z.discriminatedUnion('kind', [ChangeNodeSchema, IntentNodeSchema]);

const RevisionSchema = z
  .object({
    version: z.literal(1),
    issueId: z.string(),
    revisionId: z.string(),
    supersedes: z.string().nullable(),
    createdAt: z.string().refine(isCanonicalIsoTimestamp, {
      message: 'createdAt must be a canonical ISO-8601 UTC timestamp',
    }),
    contentSha256: z.string(),
    nodes: z.array(NodeSchema),
  })
  .strict();

/** A node identifier is a path-free canonical kebab id, like a Change alias. */
function validateNodeId(value: string, index: number): string {
  return rethrow(`nodes[${index}].nodeId`, () => parseChangeId(value, 'nodeId'));
}

function validateNode(raw: z.output<typeof NodeSchema>, index: number): ExecutionPlanNode {
  const nodeId = validateNodeId(raw.nodeId, index);
  const projectId = rethrow(`nodes[${index}].projectId`, () =>
    parseProjectId(raw.projectId)
  );
  const targetLineId = rethrow(`nodes[${index}].targetLineId`, () =>
    parseTargetLineId(raw.targetLineId)
  );
  const dependsOn = raw.dependsOn.map((value, dependencyIndex) =>
    rethrow(`nodes[${index}].dependsOn[${dependencyIndex}]`, () =>
      parseChangeId(value, 'dependsOn')
    )
  );
  if (new Set(dependsOn).size !== dependsOn.length) {
    throw planError(`nodes[${index}].dependsOn`, 'repeats a dependency');
  }
  if (raw.kind === 'change') {
    const changeInstanceId = rethrow(`nodes[${index}].changeInstanceId`, () =>
      parseChangeInstanceId(raw.changeInstanceId)
    );
    if (raw.changeAlias !== undefined) {
      // Recorded for humans and verified as a Change alias so a path or a
      // branch name cannot be smuggled in. It is never resolved BY.
      rethrow(`nodes[${index}].changeAlias`, () =>
        parseChangeId(raw.changeAlias as string, 'changeAlias')
      );
    }
    return Object.freeze({
      nodeId,
      kind: 'change' as const,
      projectId,
      targetLineId,
      changeInstanceId,
      ...(raw.changeAlias === undefined ? {} : { changeAlias: raw.changeAlias }),
      dependsOn: Object.freeze(dependsOn),
    });
  }
  assertPortableIssueText(raw.summary, `nodes[${index}].summary`, 'invalid_execution_plan');
  return Object.freeze({
    nodeId,
    kind: 'intent' as const,
    projectId,
    targetLineId,
    summary: raw.summary,
    dependsOn: Object.freeze(dependsOn),
  });
}

export interface GraphViolation {
  readonly code: 'execution_plan_cycle' | 'execution_plan_node_duplicate';
  readonly message: string;
  /** Every node the violation names, in the order it names them. */
  readonly nodes: readonly string[];
}

/**
 * Every graph rule, checked together and reported together.
 *
 * Reporting them one at a time would make correcting a hand-written plan a
 * guessing loop, and the portfolio has already paid for that shape once with
 * the archive engine's one-requirement-per-attempt spec matcher.
 */
export function checkExecutionPlanGraph(
  nodes: readonly ExecutionPlanNode[]
): readonly GraphViolation[] {
  const violations: GraphViolation[] = [];

  const seen = new Map<string, number>();
  for (const node of nodes) {
    seen.set(node.nodeId, (seen.get(node.nodeId) ?? 0) + 1);
  }
  const duplicateIds = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([nodeId]) => nodeId)
    .sort();
  if (duplicateIds.length > 0) {
    violations.push({
      code: 'execution_plan_node_duplicate',
      message: `node identifier(s) declared more than once: ${duplicateIds.join(', ')}`,
      nodes: duplicateIds,
    });
  }

  const byInstance = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.kind !== 'change') continue;
    const claimants = byInstance.get(node.changeInstanceId) ?? [];
    claimants.push(node.nodeId);
    byInstance.set(node.changeInstanceId, claimants);
  }
  for (const [changeInstanceId, claimants] of [...byInstance.entries()].sort(
    ([left], [right]) => left.localeCompare(right)
  )) {
    if (claimants.length > 1) {
      violations.push({
        code: 'execution_plan_node_duplicate',
        message: `nodes ${claimants
          .sort()
          .join(', ')} all name Change instance ${changeInstanceId}`,
        nodes: [...claimants].sort(),
      });
    }
  }

  const known = new Set(nodes.map(node => node.nodeId));
  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (dependency === node.nodeId) {
        violations.push({
          code: 'execution_plan_cycle',
          message: `node ${node.nodeId} depends on itself`,
          nodes: [node.nodeId],
        });
        continue;
      }
      if (!known.has(dependency)) {
        violations.push({
          code: 'execution_plan_cycle',
          message: `node ${node.nodeId} depends on unknown node ${dependency}`,
          nodes: [node.nodeId, dependency],
        });
      }
    }
  }

  const cycle = findCycle(nodes);
  if (cycle !== null) {
    violations.push({
      code: 'execution_plan_cycle',
      message: `dependency cycle: ${cycle.join(' -> ')}`,
      nodes: cycle,
    });
  }

  return violations;
}

/** The first cycle reachable in `dependsOn`, as a closed node path. */
function findCycle(nodes: readonly ExecutionPlanNode[]): readonly string[] | null {
  const edges = new Map<string, readonly string[]>();
  for (const node of nodes) {
    edges.set(
      node.nodeId,
      node.dependsOn.filter(dependency => nodes.some(other => other.nodeId === dependency))
    );
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (nodeId: string): readonly string[] | null => {
    const current = state.get(nodeId);
    if (current === 'done') return null;
    if (current === 'visiting') {
      const start = stack.indexOf(nodeId);
      return [...stack.slice(start), nodeId];
    }
    state.set(nodeId, 'visiting');
    stack.push(nodeId);
    for (const dependency of edges.get(nodeId) ?? []) {
      const found = visit(dependency);
      if (found !== null) return found;
    }
    stack.pop();
    state.set(nodeId, 'done');
    return null;
  };

  for (const nodeId of [...edges.keys()].sort()) {
    const found = visit(nodeId);
    if (found !== null) return found;
  }
  return null;
}

/** The canonical body a revision's digest covers: every field except the digest. */
export function executionPlanDigestBody(
  revision: Omit<ExecutionPlanRevisionV1, 'contentSha256'>
): unknown {
  return {
    version: revision.version,
    issueId: revision.issueId,
    revisionId: revision.revisionId,
    supersedes: revision.supersedes,
    createdAt: revision.createdAt,
    nodes: revision.nodes.map(node =>
      node.kind === 'change'
        ? {
            nodeId: node.nodeId,
            kind: node.kind,
            projectId: node.projectId,
            targetLineId: node.targetLineId,
            changeInstanceId: node.changeInstanceId,
            ...(node.changeAlias === undefined ? {} : { changeAlias: node.changeAlias }),
            dependsOn: [...node.dependsOn],
          }
        : {
            nodeId: node.nodeId,
            kind: node.kind,
            projectId: node.projectId,
            targetLineId: node.targetLineId,
            summary: node.summary,
            dependsOn: [...node.dependsOn],
          }
    ),
  };
}

export function executionPlanDigest(
  revision: Omit<ExecutionPlanRevisionV1, 'contentSha256'>
): Sha256Digest {
  return createHash('sha256')
    .update(canonicalJson(executionPlanDigestBody(revision)), 'utf8')
    .digest('hex') as Sha256Digest;
}

export interface ValidateExecutionPlanOptions {
  /**
   * Whether the recorded digest must match the body. Publication computes the
   * digest and so passes `false`; every READ passes `true`, which is what makes
   * a hand-edited revision detectable.
   */
  readonly verifyDigest?: boolean;
}

export function validateExecutionPlanRevision(
  value: unknown,
  options: ValidateExecutionPlanOptions = {}
): ExecutionPlanRevisionV1 {
  const result = RevisionSchema.safeParse(value);
  if (!result.success) {
    throw planError('revision', formatZodIssues(result.error), result.error);
  }

  const issueId: IssueId = rethrow('issueId', () => parseIssueId(result.data.issueId));
  const revisionId: ExecutionPlanRevisionId = rethrow('revisionId', () =>
    parseExecutionPlanRevisionId(result.data.revisionId)
  );
  const supersedes =
    result.data.supersedes === null
      ? null
      : rethrow('supersedes', () =>
          parseExecutionPlanRevisionId(result.data.supersedes as string, 'supersedes')
        );
  if (supersedes !== null && supersedes >= revisionId) {
    throw planError('supersedes', `must precede revision '${revisionId}'`);
  }
  const contentSha256 = rethrow('contentSha256', () =>
    parseSha256Digest(result.data.contentSha256, 'contentSha256')
  );

  const nodes = result.data.nodes.map((node, index) => validateNode(node, index));
  const violations = checkExecutionPlanGraph(nodes);
  if (violations.length > 0) {
    throw planError('nodes', violations.map(violation => violation.message).join('; '));
  }

  const revision: ExecutionPlanRevisionV1 = Object.freeze({
    version: 1 as const,
    issueId,
    revisionId,
    supersedes,
    createdAt: result.data.createdAt,
    contentSha256,
    nodes: Object.freeze(nodes),
  });

  if (options.verifyDigest === true) {
    const expected = executionPlanDigest(revision);
    if (expected !== contentSha256) {
      throw planError(
        'contentSha256',
        `recorded digest '${contentSha256}' does not match the revision body '${expected}'`
      );
    }
  }
  return revision;
}

export function parseExecutionPlanRevision(
  content: string,
  options: ValidateExecutionPlanOptions = {}
): ExecutionPlanRevisionV1 {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw planError('revision', 'contains invalid YAML', error);
  }
  return validateExecutionPlanRevision(raw, options);
}

export function serializeExecutionPlanRevision(value: ExecutionPlanRevisionV1): string {
  const revision = validateExecutionPlanRevision(value, { verifyDigest: true });
  return stringifyYaml({
    version: 1,
    issueId: revision.issueId,
    revisionId: revision.revisionId,
    supersedes: revision.supersedes,
    createdAt: revision.createdAt,
    contentSha256: revision.contentSha256,
    nodes: revision.nodes.map(node =>
      node.kind === 'change'
        ? {
            nodeId: node.nodeId,
            kind: node.kind,
            projectId: node.projectId,
            targetLineId: node.targetLineId,
            changeInstanceId: node.changeInstanceId,
            ...(node.changeAlias === undefined ? {} : { changeAlias: node.changeAlias }),
            dependsOn: [...node.dependsOn],
          }
        : {
            nodeId: node.nodeId,
            kind: node.kind,
            projectId: node.projectId,
            targetLineId: node.targetLineId,
            summary: node.summary,
            dependsOn: [...node.dependsOn],
          }
    ),
  });
}

/**
 * Normalizes an authored node into the validated shape, without touching the
 * graph or any Store evidence. `dependsOn` defaults to empty rather than being
 * inferred from declaration order — an implicit chain would be a plan nobody
 * wrote.
 */
export function normalizePlanNodes(
  inputs: readonly ExecutionPlanNodeInput[]
): readonly ExecutionPlanNode[] {
  return inputs.map((input, index) =>
    validateNode(
      (input.kind === 'change'
        ? {
            nodeId: input.nodeId,
            kind: 'change' as const,
            projectId: input.projectId,
            targetLineId: input.targetLineId,
            changeInstanceId: input.changeInstanceId,
            ...(input.changeAlias === undefined ? {} : { changeAlias: input.changeAlias }),
            dependsOn: [...(input.dependsOn ?? [])],
          }
        : {
            nodeId: input.nodeId,
            kind: 'intent' as const,
            projectId: input.projectId,
            targetLineId: input.targetLineId,
            summary: input.summary,
            dependsOn: [...(input.dependsOn ?? [])],
          }) as z.output<typeof NodeSchema>,
      index
    )
  );
}
