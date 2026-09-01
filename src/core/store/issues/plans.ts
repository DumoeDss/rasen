/**
 * The strict Execution Plan revision schema and its graph checker — pure, no
 * filesystem, no Git.
 *
 * A revision is IMMUTABLE once published, so everything that could make one
 * invalid is decided here, before a byte is written: the schema, the two node
 * kinds, the closed `lifecycle` vocabulary and its conditional reason, the
 * optional decomposition-guidance fields and their portable text, the
 * acyclicity of `dependsOn`, duplicate node identifiers, and two
 * nodes claiming one Change instance. Two checks this file cannot do alone:
 * reference verification against real Store evidence (it needs Git; it lives
 * in `references.ts` and runs before this file's serializer is ever called),
 * and whether a node's `suggestedPipeline` names a pipeline the registry
 * resolves (pure here as `assertPlanNodeSuggestions` over an injected
 * membership test; the mutation supplies the test its caller composed).
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
  parseIssueUid,
  parseProjectId,
  parseSha256Digest,
  parseTargetLineId,
  type ExecutionPlanRevisionId,
  type IssueId,
  type IssueUid,
  type Sha256Digest,
} from '../planning-validation.js';
import { parseChangeInstanceId } from '../planning-identity.js';
import { assertPortableIssueText } from './records.js';
import type {
  ExecutionPlanNode,
  ExecutionPlanNodeInput,
  ExecutionPlanNodeLifecycle,
  ExecutionPlanRevisionV1,
  ExecutionPlanRevisionV2,
  StoredExecutionPlanRevision,
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

/**
 * The closed lifecycle vocabulary, named in the refusal it mints: an
 * out-of-vocabulary value is refused naming itself and the five defined
 * values, never absorbed into a default.
 */
const NODE_LIFECYCLES = ['required', 'optional', 'cancelled', 'superseded', 'deferred'] as const;

const lifecycleField = z
  .enum(NODE_LIFECYCLES, {
    error: issue =>
      `lifecycle must be one of ${NODE_LIFECYCLES.map(value => `'${value}'`).join(' | ')} (received ${JSON.stringify(issue.input)})`,
  })
  .optional();

/**
 * The decomposition-guidance fields, on BOTH node kinds (a manual revision may
 * suggest a pipeline for an existing Change node too). `suggestedPipeline` is
 * non-empty here; whether it names a pipeline the registry RESOLVES is a
 * publication-time check over an injected membership test (`assertPlanNodeSuggestions`)
 * — this file is pure and owns no registry view. `rationale` and `uncertainty`
 * additionally pass the portable-text contract in `validateNode`.
 */
const suggestionShape = {
  suggestedPipeline: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  uncertainty: z.string().min(1).optional(),
};

const ChangeNodeSchema = z
  .object({
    ...NodeBaseShape,
    kind: z.literal('change'),
    changeInstanceId: z.string(),
    changeAlias: z.string().min(1).optional(),
    lifecycle: lifecycleField,
    reason: z.string().min(1).optional(),
    ...suggestionShape,
  })
  .strict();

const IntentNodeSchema = z
  .object({
    ...NodeBaseShape,
    kind: z.literal('intent'),
    summary: z.string().min(1).max(500),
    // A plain string here deliberately: the semantic check in `validateNode`
    // refuses out-of-vocabulary values NAMING THE NODE and the two values
    // defined for the intent kind (and directing cancelled/superseded to
    // omission-from-next-revision, deferred to staying optional), which a bare
    // enum error cannot do.
    lifecycle: z.string().optional(),
    ...suggestionShape,
  })
  .strict();

const NodeSchema = z.discriminatedUnion('kind', [ChangeNodeSchema, IntentNodeSchema]);

const RevisionSchemaV1 = z
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

const RevisionSchemaV2 = z
  .object({
    version: z.literal(2),
    issueUid: z.string(),
    revisionId: z.string(),
    supersedes: z.string().nullable(),
    createdAt: z.string().refine(isCanonicalIsoTimestamp, {
      message: 'createdAt must be a canonical ISO-8601 UTC timestamp',
    }),
    contentSha256: z.string(),
    nodes: z.array(NodeSchema),
  })
  .strict();

const RevisionSchema = z.discriminatedUnion('version', [RevisionSchemaV1, RevisionSchemaV2]);

/** A node identifier is a path-free canonical kebab id, like a Change alias. */
function validateNodeId(value: string, index: number): string {
  return rethrow(`nodes[${index}].nodeId`, () => parseChangeId(value, 'nodeId'));
}

/**
 * The decomposition-guidance fields, validated and canonically spread — the
 * `lifecycle` precedent applied once for both kinds. `rationale` and
 * `uncertainty` are durable Store content, so they satisfy the same portable
 * durable text contract a node `reason` does: refused at the schema, never
 * trimmed. Absent fields are omitted so every revision published before they
 * existed re-derives its digest byte-for-byte, and an authored absence never
 * reads back as an empty string.
 */
function planSuggestionFields(
  raw: { suggestedPipeline?: string; rationale?: string; uncertainty?: string },
  index: number
):
  | Pick<ExecutionPlanNode, 'suggestedPipeline' | 'rationale' | 'uncertainty'>
  | Record<string, never> {
  if (raw.rationale !== undefined) {
    assertPortableIssueText(raw.rationale, `nodes[${index}].rationale`, 'invalid_execution_plan');
  }
  if (raw.uncertainty !== undefined) {
    assertPortableIssueText(raw.uncertainty, `nodes[${index}].uncertainty`, 'invalid_execution_plan');
  }
  return {
    ...(raw.suggestedPipeline === undefined ? {} : { suggestedPipeline: raw.suggestedPipeline }),
    ...(raw.rationale === undefined ? {} : { rationale: raw.rationale }),
    ...(raw.uncertainty === undefined ? {} : { uncertainty: raw.uncertainty }),
  };
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
    // The lifecycle's one conditional: `cancelled`/`superseded`/`deferred`
    // record why the plan does not demand the work toward Done — abandoned,
    // replaced, or postponed (portable durable text, refused rather than
    // trimmed) — and no other lifecycle records a reason; a dangling reason on
    // wanted work is a defect this checker can name, not a fact to store
    // beside one it does not explain. `deferred` work is still intended, so
    // the refusal below says "does not demand toward Done" rather than "no
    // longer wants": the older phrasing would be false the moment a deferral
    // exists.
    const lifecycle = raw.lifecycle;
    if (lifecycle === 'cancelled' || lifecycle === 'superseded' || lifecycle === 'deferred') {
      if (raw.reason === undefined) {
        throw planError(
          `nodes[${index}].reason`,
          `node '${nodeId}' is ${lifecycle}; a ${lifecycle} node requires a recorded reason`
        );
      }
      assertPortableIssueText(
        raw.reason as string,
        `nodes[${index}].reason`,
        'invalid_execution_plan'
      );
    } else if (raw.reason !== undefined) {
      throw planError(
        `nodes[${index}].reason`,
        `node '${nodeId}' records a reason without being cancelled, superseded, or deferred; a reason is recorded only for work the plan does not demand toward Done`
      );
    }
    return Object.freeze({
      nodeId,
      kind: 'change' as const,
      projectId,
      targetLineId,
      changeInstanceId,
      ...(raw.changeAlias === undefined ? {} : { changeAlias: raw.changeAlias }),
      // Canonical omission: an explicit `required` IS `required`, and the
      // stored canonical form omits it — mirroring `changeAlias` — so a plan
      // published before this field existed re-derives its exact digest and
      // two spellings of one plan publish one revision, not two.
      ...(lifecycle === undefined || lifecycle === 'required'
        ? {}
        : { lifecycle: lifecycle as Exclude<ExecutionPlanNodeLifecycle, 'required'> }),
      ...(raw.reason === undefined ? {} : { reason: raw.reason }),
      ...planSuggestionFields(raw, index),
      dependsOn: Object.freeze(dependsOn),
    });
  }
  // The intent lifecycle's two-value vocabulary, refused semantically so the
  // refusal can name the node. `cancelled`/`superseded`/`deferred` are
  // Change-node-only: they explain work that existed as a Change, while intent
  // work — work no Change ever backed — is postponed by keeping it `optional`
  // and expressed as unwanted by omitting the node from the next revision, and
  // each refusal says exactly which spelling its value's intent case takes.
  const intentLifecycle = raw.lifecycle;
  if (
    intentLifecycle !== undefined &&
    intentLifecycle !== 'required' &&
    intentLifecycle !== 'optional'
  ) {
    if (intentLifecycle === 'deferred') {
      throw planError(
        `nodes[${index}].lifecycle`,
        `node '${nodeId}' is an intent node carrying lifecycle 'deferred'; deferred explains work that existed as a Change and stays Change-node-only — intent work is postponed by keeping it 'optional' or by omitting the node from the next revision`
      );
    }
    if (intentLifecycle === 'cancelled' || intentLifecycle === 'superseded') {
      throw planError(
        `nodes[${index}].lifecycle`,
        `node '${nodeId}' is an intent node carrying lifecycle '${intentLifecycle}'; ${intentLifecycle} explains work that existed and stays Change-node-only — unwanted intent work is expressed by omitting the node from the next revision`
      );
    }
    throw planError(
      `nodes[${index}].lifecycle`,
      `node '${nodeId}' carries lifecycle '${intentLifecycle}', which the intent node kind does not define; the values defined for an intent node are 'required' | 'optional'`
    );
  }
  assertPortableIssueText(raw.summary, `nodes[${index}].summary`, 'invalid_execution_plan');
  return Object.freeze({
    nodeId,
    kind: 'intent' as const,
    projectId,
    targetLineId,
    summary: raw.summary,
    // Canonical omission, mirroring the change node: an explicit `required` IS
    // `required`, and the stored form omits it so two spellings of one plan
    // publish one revision and pre-vocabulary revisions keep their digests.
    ...(intentLifecycle === undefined || intentLifecycle === 'required'
      ? {}
      : { lifecycle: intentLifecycle as 'optional' }),
    ...planSuggestionFields(raw, index),
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
  revision:
    | Omit<ExecutionPlanRevisionV1, 'contentSha256'>
    | Omit<ExecutionPlanRevisionV2, 'contentSha256'>
): unknown {
  return {
    version: revision.version,
    ...(revision.version === 1
      ? { issueId: revision.issueId }
      : { issueUid: revision.issueUid }),
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
            ...(node.lifecycle === undefined ? {} : { lifecycle: node.lifecycle }),
            ...(node.reason === undefined ? {} : { reason: node.reason }),
            ...(node.suggestedPipeline === undefined
              ? {}
              : { suggestedPipeline: node.suggestedPipeline }),
            ...(node.rationale === undefined ? {} : { rationale: node.rationale }),
            ...(node.uncertainty === undefined ? {} : { uncertainty: node.uncertainty }),
            dependsOn: [...node.dependsOn],
          }
        : {
            nodeId: node.nodeId,
            kind: node.kind,
            projectId: node.projectId,
            targetLineId: node.targetLineId,
            summary: node.summary,
            ...(node.lifecycle === undefined ? {} : { lifecycle: node.lifecycle }),
            ...(node.suggestedPipeline === undefined
              ? {}
              : { suggestedPipeline: node.suggestedPipeline }),
            ...(node.rationale === undefined ? {} : { rationale: node.rationale }),
            ...(node.uncertainty === undefined ? {} : { uncertainty: node.uncertainty }),
            dependsOn: [...node.dependsOn],
          }
    ),
  };
}

export function executionPlanDigest(
  revision:
    | Omit<ExecutionPlanRevisionV1, 'contentSha256'>
    | Omit<ExecutionPlanRevisionV2, 'contentSha256'>
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
): StoredExecutionPlanRevision {
  const result = RevisionSchema.safeParse(value);
  if (!result.success) {
    throw planError('revision', formatZodIssues(result.error), result.error);
  }

  const owner: { readonly issueId: IssueId } | { readonly issueUid: IssueUid } =
    result.data.version === 1
      ? {
          issueId: rethrow('issueId', () =>
            parseIssueId((result.data as z.output<typeof RevisionSchemaV1>).issueId)
          ),
        }
      : {
          issueUid: rethrow('issueUid', () =>
            parseIssueUid((result.data as z.output<typeof RevisionSchemaV2>).issueUid)
          ),
        };
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

  const revision: StoredExecutionPlanRevision =
    result.data.version === 1
      ? Object.freeze({
          version: 1 as const,
          issueId: (owner as { readonly issueId: IssueId }).issueId,
          revisionId,
          supersedes,
          createdAt: result.data.createdAt,
          contentSha256,
          nodes: Object.freeze(nodes),
        })
      : Object.freeze({
          version: 2 as const,
          issueUid: (owner as { readonly issueUid: IssueUid }).issueUid,
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
): StoredExecutionPlanRevision {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw planError('revision', 'contains invalid YAML', error);
  }
  return validateExecutionPlanRevision(raw, options);
}

export function serializeExecutionPlanRevision(value: StoredExecutionPlanRevision): string {
  const revision = validateExecutionPlanRevision(value, { verifyDigest: true });
  return stringifyYaml({
    version: revision.version,
    ...(revision.version === 1
      ? { issueId: revision.issueId }
      : { issueUid: revision.issueUid }),
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
            ...(node.lifecycle === undefined ? {} : { lifecycle: node.lifecycle }),
            ...(node.reason === undefined ? {} : { reason: node.reason }),
            ...(node.suggestedPipeline === undefined
              ? {}
              : { suggestedPipeline: node.suggestedPipeline }),
            ...(node.rationale === undefined ? {} : { rationale: node.rationale }),
            ...(node.uncertainty === undefined ? {} : { uncertainty: node.uncertainty }),
            dependsOn: [...node.dependsOn],
          }
        : {
            nodeId: node.nodeId,
            kind: node.kind,
            projectId: node.projectId,
            targetLineId: node.targetLineId,
            summary: node.summary,
            ...(node.lifecycle === undefined ? {} : { lifecycle: node.lifecycle }),
            ...(node.suggestedPipeline === undefined
              ? {}
              : { suggestedPipeline: node.suggestedPipeline }),
            ...(node.rationale === undefined ? {} : { rationale: node.rationale }),
            ...(node.uncertainty === undefined ? {} : { uncertainty: node.uncertainty }),
            dependsOn: [...node.dependsOn],
          }
    ),
  });
}

/**
 * Ordering by code point, deliberately NOT `localeCompare`.
 *
 * The order this decides is a digest preimage, so it has to be the same order
 * on every machine that ever publishes. `localeCompare` is a locale-sensitive
 * collation whose result depends on the runtime's ICU data, which would make
 * one published plan mint two digests on two machines: exactly the thing an
 * immutable published digest must never do. Node identifiers and dependency
 * names are both `parseChangeId` kebab ids (`[a-z0-9-]`), so code-point order
 * here coincides with byte order in the UTF-8 the digest actually hashes.
 *
 * `checkExecutionPlanGraph` above uses `localeCompare` for the order it names
 * offending nodes IN A MESSAGE, which is human-facing and covers no bytes.
 */
function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The candidate object `NodeSchema` is run against: exactly the declared
 * fields, `dependsOn` defaulted, and `kind` carried through VERBATIM.
 *
 * Carrying `kind` verbatim is the point. Rewriting an unrecognized kind into
 * `intent` is what let a node the product does not define reach
 * `assertPortableIssueText(undefined, ...)` and raise a `TypeError` instead of
 * being named. `dependsOn` is passed through rather than spread, so a caller
 * that sends a string gets a typed refusal rather than a dependency per
 * character, and one that sends a number gets a refusal rather than a
 * `TypeError` out of the spread.
 *
 * `lifecycle` and `reason` are carried through on BOTH branches. Dropping
 * them from an intent node's candidate would silently publish away a field
 * the schema refuses — `reason` on an intent node still meets
 * `IntentNodeSchema`'s `.strict()` and is refused BY NAME — and carrying
 * `lifecycle` is now required, because the intent schema admits it.
 *
 * What the candidate cannot do is refuse a field it does not know: an
 * UNRECOGNIZED authored key never reaches the candidate at all and would
 * vanish before `.strict()` sees it. `planNodeUnknownFields` below closes that
 * seam — the authored-input boundary now meets the same refusal-by-name rule
 * the stored-record boundary always had.
 */
function planNodeCandidate(input: ExecutionPlanNodeInput): unknown {
  const raw = input as unknown as Record<string, unknown>;
  const base = {
    nodeId: raw.nodeId,
    kind: raw.kind,
    projectId: raw.projectId,
    targetLineId: raw.targetLineId,
    dependsOn: raw.dependsOn ?? [],
    ...(raw.lifecycle === undefined ? {} : { lifecycle: raw.lifecycle }),
    ...(raw.reason === undefined ? {} : { reason: raw.reason }),
    // Carried through on BOTH branches for the same reason `lifecycle` is:
    // both schemas accept these fields, and an unrecognized EXTRA field still
    // meets `.strict()` by name because the candidate only forwards fields
    // the input actually declared.
    ...(raw.suggestedPipeline === undefined ? {} : { suggestedPipeline: raw.suggestedPipeline }),
    ...(raw.rationale === undefined ? {} : { rationale: raw.rationale }),
    ...(raw.uncertainty === undefined ? {} : { uncertainty: raw.uncertainty }),
  };
  return raw.kind === 'change'
    ? {
        ...base,
        changeInstanceId: raw.changeInstanceId,
        ...(raw.changeAlias === undefined ? {} : { changeAlias: raw.changeAlias }),
      }
    : { ...base, summary: raw.summary };
}

/** The fields each node kind's schema declares — the authored-field baseline. */
const COMMON_AUTHORED_NODE_FIELDS: ReadonlySet<string> = new Set([
  'nodeId',
  'kind',
  'projectId',
  'targetLineId',
  'dependsOn',
  'lifecycle',
  'reason',
  'suggestedPipeline',
  'rationale',
  'uncertainty',
]);
const CHANGE_AUTHORED_NODE_FIELDS: ReadonlySet<string> = new Set([
  ...COMMON_AUTHORED_NODE_FIELDS,
  'changeInstanceId',
  'changeAlias',
]);
const INTENT_AUTHORED_NODE_FIELDS: ReadonlySet<string> = new Set([
  ...COMMON_AUTHORED_NODE_FIELDS,
  'summary',
]);

/**
 * Authored keys outside the known field set for the node's kind, in a stable
 * (code-point) order. An UNDEFINED kind is not this check's question: the
 * schema's discriminator refuses it by name, and nothing it carried can be
 * published, so the check yields nothing there and lets the discriminator
 * speak.
 */
function planNodeUnknownFields(input: ExecutionPlanNodeInput): readonly string[] {
  const raw = input as unknown as Record<string, unknown>;
  const known =
    raw.kind === 'change'
      ? CHANGE_AUTHORED_NODE_FIELDS
      : raw.kind === 'intent'
        ? INTENT_AUTHORED_NODE_FIELDS
        : null;
  if (known === null) return [];
  return Object.keys(raw)
    .filter(key => !known.has(key))
    .sort(compareCodePoints);
}

function unknownNodeFieldsMessage(
  nodeId: string,
  kind: unknown,
  fields: readonly string[]
): string {
  const kindName = kind === 'change' || kind === 'intent' ? String(kind) : 'node';
  return `node '${nodeId}' carries field(s) the ${kindName} node schema does not define: ${fields
    .map(field => `'${field}'`)
    .join(', ')}; authored input is refused naming the field rather than published with it silently dropped`;
}

/** The authored node id as the refusals name it, with the honest fallback. */
function authoredNodeId(input: ExecutionPlanNodeInput): string {
  const raw = (input as unknown as Record<string, unknown>).nodeId;
  return typeof raw === 'string' && raw.length > 0 ? raw : '(unnamed node)';
}

export interface PlanNodeSchemaProblem {
  readonly nodeId: string;
  readonly problem: string;
}

/**
 * `NodeSchema` run over authored nodes and REPORTED rather than thrown.
 *
 * The same gate `normalizePlanNodes` enforces, in the non-throwing shape an
 * untrusted-input boundary needs: a caller that must answer "your body is
 * wrong" with its own status code cannot use a throw, because the throw
 * arrives indistinguishable from an internal fault. Both go through
 * `planNodeCandidate` and the one `NodeSchema`, so the two surfaces cannot
 * drift into disagreeing about what a node is. The semantic layer
 * `validateNode` adds on top — the conditional reason, the portability of its
 * text — runs here too (reported, never thrown), so the boundary inherits the
 * whole gate rather than only its schema half.
 */
export function findPlanNodeSchemaProblems(
  inputs: readonly ExecutionPlanNodeInput[]
): readonly PlanNodeSchemaProblem[] {
  const problems: PlanNodeSchemaProblem[] = [];
  inputs.forEach((input, index) => {
    const nodeId = authoredNodeId(input);
    // The extra-keys refusal runs on the REPORTING path exactly as on the
    // throwing one: a misspelled key is refused by name here too, never
    // silently dropped from a published plan.
    const unknown = planNodeUnknownFields(input);
    if (unknown.length > 0) {
      problems.push({
        nodeId,
        problem: unknownNodeFieldsMessage(nodeId, (input as unknown as Record<string, unknown>).kind, unknown),
      });
      return;
    }
    const result = NodeSchema.safeParse(planNodeCandidate(input));
    if (!result.success) {
      problems.push({ nodeId, problem: formatZodIssues(result.error) });
      return;
    }
    try {
      validateNode(result.data, index);
    } catch (error) {
      if (!(error instanceof StorePlanningValidationError)) throw error;
      problems.push({ nodeId, problem: error.message });
    }
  });
  return problems;
}

/** One node, through the schema it declares, before any semantic parsing. */
function parsePlanNode(
  input: ExecutionPlanNodeInput,
  index: number
): z.output<typeof NodeSchema> {
  // The extra-keys check runs BEFORE the candidate: an authored key the
  // candidate does not forward would otherwise never meet `.strict()` and
  // would vanish silently — the exact asymmetry with the stored-record
  // boundary this refusal closes.
  const unknown = planNodeUnknownFields(input);
  if (unknown.length > 0) {
    throw planError(
      `nodes[${index}]`,
      unknownNodeFieldsMessage(authoredNodeId(input), (input as unknown as Record<string, unknown>).kind, unknown)
    );
  }
  const result = NodeSchema.safeParse(planNodeCandidate(input));
  if (!result.success) {
    throw planError(`nodes[${index}]`, formatZodIssues(result.error), result.error);
  }
  return result.data;
}

/** A node with its `dependsOn` in canonical order; every other field is kept. */
function canonicalizeDependsOn(node: ExecutionPlanNode): ExecutionPlanNode {
  const dependsOn = Object.freeze([...node.dependsOn].sort(compareCodePoints));
  return node.kind === 'change'
    ? Object.freeze({ ...node, dependsOn })
    : Object.freeze({ ...node, dependsOn });
}

/**
 * Normalizes authored nodes into the validated CANONICAL shape, without
 * touching the graph or any Store evidence. `dependsOn` defaults to empty
 * rather than being inferred from declaration order — an implicit chain would
 * be a plan nobody wrote.
 *
 * Canonical means two spellings of one plan are one plan: nodes are ordered by
 * `nodeId` and every node's `dependsOn` is ordered, so a plan re-authored with
 * its nodes listed in a different order publishes the same digest instead of a
 * second revision that differs in nothing.
 *
 * The ordering is sited HERE, at the publication boundary this function's one
 * production caller is (`publishPlan`), and NOWHERE on the read or serialize
 * path. Reads verify the recorded digest against the STORED node order, so a
 * reader that re-ordered would report every revision published before this
 * rule as a digest mismatch, and a re-ordering serializer would do the same to
 * its own round trip. Publication is the only moment at which a plan's
 * canonical form can be decided without rewriting history.
 *
 * The schema runs here too, on every caller's behalf. `NodeSchema` was
 * declared and then bypassed by a cast, which left its rules (a summary at
 * most 500 characters, a string `nodeId`, a `dependsOn` array of strings)
 * enforced only much later at serialize time, or not at all before a
 * `TypeError`. Enforcing at normalization refuses the same inputs the
 * serializer already refused, but earlier, by field name, and before a single
 * Git ref is read.
 */
export function normalizePlanNodes(
  inputs: readonly ExecutionPlanNodeInput[]
): readonly ExecutionPlanNode[] {
  return inputs
    .map((input, index) => validateNode(parsePlanNode(input, index), index))
    .map(canonicalizeDependsOn)
    .sort((left, right) => compareCodePoints(left.nodeId, right.nodeId));
}

/**
 * The publication-time registry check for node suggestions — the SAME seam
 * `store issue start --pipeline` validates through, taken as an injected
 * membership test because this module owns no registry view of its own. A
 * suggestion naming no known pipeline is refused naming the node and the
 * pipeline; a suggestion with NO supplied test is refused too, because a
 * suggestion that cannot be checked is not a fact the revision may record.
 * Whether the named pipeline itself carries a decompose stage is the LAUNCH
 * path's existing guard, deliberately not re-checked here.
 */
export function assertPlanNodeSuggestions(
  nodes: readonly ExecutionPlanNode[],
  pipelineKnown: ((name: string) => boolean) | undefined
): void {
  nodes.forEach((node, index) => {
    if (node.suggestedPipeline === undefined) return;
    if (pipelineKnown === undefined) {
      throw planError(
        `nodes[${index}].suggestedPipeline`,
        `node '${node.nodeId}' records suggestedPipeline '${node.suggestedPipeline}', but this publication was given no pipeline registry to resolve it against; a suggestion that cannot be checked is refused, not stored`
      );
    }
    if (!pipelineKnown(node.suggestedPipeline)) {
      throw planError(
        `nodes[${index}].suggestedPipeline`,
        `node '${node.nodeId}' records suggestedPipeline '${node.suggestedPipeline}', which the pipeline registry does not resolve; publication refuses a suggestion naming no known pipeline`
      );
    }
  });
}
