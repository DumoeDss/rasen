import { PipelineYamlSchema, type PipelineYaml } from './types.js';
import { validateLegacyPipelineDefinition } from './legacy-validation.js';
import { parsePipelineSourceDocument } from './source-document.js';
import { sealDefinitionPlan } from './definition-plan-internal.js';

export const ECP_DEFINITION_VERSION = 2 as const;
export const CHANGE_RUN_PLAN_VERSION = 1 as const;
export const CAPABILITY_CATALOG_VERSION = 1 as const;
export const V2_RUNTIME_UNAVAILABLE_REASON = 'ecp_v2_runtime_unavailable' as const;

export const ECP_NODE_KINDS = [
  'AtomicStage',
  'CompositeRef',
  'BoundedLoop',
  'Choice',
  'FanOut',
  'Join',
  'Gate',
  'Finish',
] as const;

export type EcpNodeKind = (typeof ECP_NODE_KINDS)[number];
export type DefinitionPort = Readonly<{ name: string; type: string; required?: boolean }>;
export type DefinitionArtifact = Readonly<{ name: string; type: string }>;

interface DefinitionNodeBase {
  id: string;
  kind: EcpNodeKind;
  [key: string]: unknown;
}

export interface AtomicStageNode extends DefinitionNodeBase {
  kind: 'AtomicStage';
  capability: Readonly<{ id: string; version: string }>;
}

export interface CompositeRefNode extends DefinitionNodeBase {
  kind: 'CompositeRef';
  declarationId: string;
}

export interface BoundedLoopNode extends DefinitionNodeBase {
  kind: 'BoundedLoop';
  body: string;
  limits: Readonly<{ maxIterations: number; maxActions?: number; budget?: number }>;
  exits: Readonly<
    Record<
      string,
      Readonly<{ action: 'continue' } | { action: 'exit'; outcome: string }>
    >
  >;
}

export interface ChoiceNode extends DefinitionNodeBase {
  kind: 'Choice';
  outcomes: readonly string[];
}

export interface FanOutNode extends DefinitionNodeBase {
  kind: 'FanOut';
  branches: readonly string[];
}

export interface JoinNode extends DefinitionNodeBase {
  kind: 'Join';
  inputs: readonly string[];
}

export interface GateNode extends DefinitionNodeBase {
  kind: 'Gate';
  outcomes: readonly string[];
}

export interface FinishNode extends DefinitionNodeBase {
  kind: 'Finish';
  outcome: string;
}

export type DefinitionNode =
  | AtomicStageNode
  | CompositeRefNode
  | BoundedLoopNode
  | ChoiceNode
  | FanOutNode
  | JoinNode
  | GateNode
  | FinishNode;

export type OrchestrationEvaluatorCapability =
  | 'parallel-dispatch'
  | 'choice-select';

/**
 * ECP-4: the synthetic capability name for root nodes the reconciler admits an
 * *evaluator* Action for, or `null` when the node is not one. The FanOut
 * condition evaluator (`parallel-dispatch`) and the v2-authored Choice
 * evaluator (`choice-select`) need a capability/policy binding in the
 * execution profile even though no authored stage backs them; the profile
 * resolver synthesizes one.
 *
 * `Choice` nodes produced by v1 `condition:` normalization carry
 * `legacyRuntimeOwner` and are metadata carriers only — the lowerer skips
 * them, so they must NOT get a binding. `Join` nodes are never admitted (the
 * Join pass derives its state from committed member results), so they are
 * excluded too.
 *
 * Returns a nullable name rather than a type predicate on purpose: a legacy
 * `Choice` node is still a `ChoiceNode`, so narrowing on a predicate would
 * wrongly tell the compiler no `Choice` survives the check.
 */
export function orchestrationEvaluatorCapabilityFor(
  node: DefinitionNode
): OrchestrationEvaluatorCapability | null {
  if (node.kind === 'FanOut') return 'parallel-dispatch';
  if (node.kind !== 'Choice') return null;
  const legacyOwner = (node as Readonly<{ legacyRuntimeOwner?: unknown }>)
    .legacyRuntimeOwner;
  return legacyOwner === undefined ? 'choice-select' : null;
}

export interface DefinitionConnection {
  id: string;
  from: Readonly<{ node: string; port: string }>;
  to: Readonly<{ node: string; port: string }>;
  [key: string]: unknown;
}

export interface DefinitionGraph {
  nodes: readonly DefinitionNode[];
  connections: readonly DefinitionConnection[];
  [key: string]: unknown;
}

export interface CompositeDeclaration {
  id: string;
  kind: 'Composite';
  provenance: 'built-in' | 'custom';
  inputs: readonly DefinitionPort[];
  artifacts: readonly DefinitionArtifact[];
  outcomes: readonly string[];
  graph: DefinitionGraph;
  [key: string]: unknown;
}

export interface DefinitionSourceV2 {
  version: 2;
  id: string;
  sourceId: string;
  name: string;
  description?: string;
  inputs: readonly DefinitionPort[];
  artifacts: readonly DefinitionArtifact[];
  outcomes: readonly string[];
  declarations: readonly CompositeDeclaration[];
  root: DefinitionGraph;
  limits?: Readonly<{ maxActions?: number; budget?: number }>;
  [key: string]: unknown;
}

export type DefinitionSource = string | PipelineYaml | DefinitionSourceV2 | unknown;

export type CapabilityAvailability = 'enabled' | 'disabled' | 'forbidden';

export interface CapabilityDescriptor {
  id: string;
  version: string;
  availability: CapabilityAvailability;
  inputs: readonly DefinitionPort[];
  artifacts: readonly DefinitionArtifact[];
  outcomes: readonly string[];
  limits: Readonly<{ maxActions?: number; budget?: number }>;
}

export interface CapabilityCatalogSnapshot {
  readonly version: 1;
  readonly descriptors: readonly Readonly<CapabilityDescriptor>[];
}

export interface ProductionCapabilityDefinition {
  readonly id: string;
  readonly digest: string;
  readonly skill: Readonly<{ template: Readonly<{ name: string }> }>;
}

export type DefinitionDiagnosticCode =
  | 'LEGACY_NORMALIZED'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_SOURCE'
  | 'UNKNOWN_NODE_KIND'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_REFERENCE'
  | 'GRAPH_CYCLE'
  | 'COMPOSITE_RECURSION'
  | 'NESTED_LOOP'
  | 'MISSING_EXIT'
  | 'UNREACHABLE_EXIT'
  | 'PORT_MISMATCH'
  | 'INVALID_LIMIT'
  | 'IMPOSSIBLE_BUDGET'
  | 'CAPABILITY_MISSING'
  | 'CAPABILITY_DISABLED'
  | 'CAPABILITY_FORBIDDEN'
  | 'CAPABILITY_VERSION_MISMATCH'
  | 'DUPLICATE_CATALOG_DESCRIPTOR';

export interface DefinitionDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly code: DefinitionDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly related?: readonly Readonly<{ path: string; message: string }>[];
}

export class DefinitionReadError extends Error {
  constructor(
    readonly diagnostics: readonly DefinitionDiagnostic[],
    /**
     * Total authored projection captured by the authoritative preparation
     * parse. Syntax-invalid text deliberately projects to an empty object;
     * parseable invalid input retains the parsed authored value.
     */
    readonly authoredSource: unknown = {}
  ) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join('; '));
    this.name = 'DefinitionReadError';
  }
}

declare const changeRunPlanBrand: unique symbol;

/**
 * Public, immutable plan envelope. The compiled representation stays `unknown`
 * outside this module; callers may retain or JSON-serialize it, but cannot
 * depend on its internal node union through the TypeScript contract.
 */
export interface ChangeRunPlan {
  readonly version: 1;
  readonly digest: string;
  readonly payload: unknown;
  readonly [changeRunPlanBrand]: true;
}

export interface PreparedDefinition {
  readonly authoredVersion: 1 | 2;
  readonly normalizedVersion: 2;
  /** Parsed authored-version value, retained without rewriting it to v2. */
  readonly authoredSource: Readonly<PipelineYaml | DefinitionSourceV2>;
  readonly definition: Readonly<DefinitionSourceV2>;
  readonly warnings: readonly DefinitionDiagnostic[];
  readonly plan: ChangeRunPlan;
  readonly digests: Readonly<{
    source: string;
    capability: string;
    plan: string;
  }>;
  readonly capability: Readonly<{
    definitionValid: true;
    planAvailable: true;
    executable: boolean;
    executionMode: 'legacy' | 'reconciler' | 'unavailable';
    unavailableReason?: typeof V2_RUNTIME_UNAVAILABLE_REASON;
  }>;
}

export type DefinitionPreparationResult =
  | Readonly<{ ok: true; value: PreparedDefinition }>
  | Readonly<{ ok: false; error: DefinitionReadError }>;

/**
 * ECP-5 (D4): the ONE rule for "does this definition execute through the v2
 * hierarchical path?". A definition needs v2 lowering when it was authored at
 * v2, or when its NORMALIZED root carries a construct the v1 flat lowerer
 * cannot express — a `BoundedLoop` (ReviewCycle/GoalLoop migration) or a
 * `FanOut`/`Join` pair (`parallelGroup` normalization).
 *
 * Before this existed, three layers each carried their own inline copy and they
 * disagreed: the lowerer routed any FanOut/Join-bearing definition through the
 * v2 lowerer (which looks bindings up by `root:<nodeId>`), while capability
 * binding resolution only produced `root:<nodeId>` bindings when a ReviewCycle
 * BoundedLoop was present — so a v1 pipeline whose ONLY v2 construct was a
 * `parallelGroup` got flat `stage:<id>` bindings the v2 lowerer could not find.
 * Support analysis then reported `unsupported_pipeline_shape`, making
 * `supported_v2_parallel` unreachable for exactly the v1 audience it was built
 * for. Every consumer resolves the question here so the three layers can never
 * disagree again.
 */
export function definitionRequiresV2Lowering(
  prepared: PreparedDefinition
): boolean {
  if (prepared.authoredVersion === 2) return true;
  return prepared.definition.root.nodes.some(
    (node) =>
      node.kind === 'BoundedLoop' ||
      node.kind === 'FanOut' ||
      node.kind === 'Join'
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

/**
 * Canonical ordering must not depend on the host ICU build or process locale.
 * JavaScript relational string comparison is defined in terms of UTF-16 code
 * units and is therefore stable on every supported platform.
 */
function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createCapabilityCatalogSnapshot(
  descriptors: readonly CapabilityDescriptor[]
): CapabilityCatalogSnapshot {
  const seen = new Set<string>();
  for (const [index, descriptor] of descriptors.entries()) {
    const identity = `${descriptor.id}\0${descriptor.version}`;
    if (seen.has(identity)) {
      throw new DefinitionReadError([
        diagnostic(
          'DUPLICATE_CATALOG_DESCRIPTOR',
          `/descriptors/${index}`,
          `Duplicate capability descriptor '${descriptor.id}' version '${descriptor.version}'.`
        ),
      ]);
    }
    seen.add(identity);
  }
  const normalized = descriptors
    .map((descriptor) => ({
      ...descriptor,
      inputs: [...descriptor.inputs],
      artifacts: [...descriptor.artifacts],
      outcomes: [...descriptor.outcomes],
      limits: { ...descriptor.limits },
    }))
    .sort((left, right) =>
      compareCanonicalStrings(
        `${left.id}\0${left.version}`,
        `${right.id}\0${right.version}`
      )
    );
  return deepFreeze({
    version: CAPABILITY_CATALOG_VERSION,
    descriptors: normalized,
  });
}

/**
 * Adapter from the installed workflow catalog to the closed Definition
 * capability contract. Current workflows expose a single completion outcome;
 * future typed workflow manifests can deepen these descriptors without
 * changing the snapshot boundary.
 */
export function createProductionCapabilityCatalogSnapshot(
  definitions: readonly ProductionCapabilityDefinition[],
  enabledSkillNames: ReadonlySet<string>,
  forbiddenSkillNames: ReadonlySet<string> = new Set()
): CapabilityCatalogSnapshot {
  return createCapabilityCatalogSnapshot(
    definitions.map((definition) => ({
      id: `skill:${definition.skill.template.name}`,
      version: definition.digest,
      availability: forbiddenSkillNames.has(definition.skill.template.name)
        ? 'forbidden'
        : enabledSkillNames.has(definition.skill.template.name)
          ? 'enabled'
          : 'disabled',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      limits: {},
    }))
  );
}

function diagnostic(
  code: DefinitionDiagnosticCode,
  path: string,
  message: string,
  related?: readonly Readonly<{ path: string; message: string }>[]
): DefinitionDiagnostic {
  return { severity: 'error', code, path, message, ...(related ? { related } : {}) };
}

export function orderDefinitionDiagnostics(
  diagnostics: readonly DefinitionDiagnostic[]
): readonly DefinitionDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    compareCanonicalStrings(left.path, right.path) ||
    compareCanonicalStrings(left.severity, right.severity) ||
    compareCanonicalStrings(left.code, right.code) ||
    compareCanonicalStrings(left.message, right.message)
  );
}

function invalidSource(message: string, path = '/'): DefinitionPreparationResult {
  return {
    ok: false,
    error: new DefinitionReadError([
      diagnostic('INVALID_SOURCE', path, message),
    ]),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type V2SourceReadResult =
  | Readonly<{
      ok: true;
      value: DefinitionSourceV2;
      diagnostics: readonly DefinitionDiagnostic[];
    }>
  | Readonly<{ ok: false; error: DefinitionReadError }>;

function readRequiredString(
  value: unknown,
  path: string,
  label: string,
  diagnostics: DefinitionDiagnostic[]
): value is string {
  if (typeof value === 'string' && value.length > 0) return true;
  diagnostics.push(
    diagnostic('INVALID_SOURCE', path, `${label} must be a non-empty string.`)
  );
  return false;
}

interface AuthoredIdentityOccurrence {
  readonly path: string;
  readonly label: string;
}

function recordOwnerLocalIdentity(
  identity: string,
  path: string,
  label: string,
  firstOccurrences: Map<string, AuthoredIdentityOccurrence>,
  diagnostics: DefinitionDiagnostic[]
): void {
  const first = firstOccurrences.get(identity);
  if (first) {
    diagnostics.push(
      diagnostic(
        'DUPLICATE_ID',
        path,
        `Duplicate ${label} identity '${identity}'.`,
        [
          {
            path: first.path,
            message: `The first ${first.label} with this identity is here.`,
          },
        ]
      )
    );
    return;
  }
  firstOccurrences.set(identity, { path, label });
}

function readStringList(
  value: unknown,
  path: string,
  label: string,
  diagnostics: DefinitionDiagnostic[],
  firstOccurrences: Map<string, AuthoredIdentityOccurrence> = new Map()
): value is string[] {
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', path, `${label} must be an array.`)
    );
    return false;
  }
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}/${index}`;
    if (readRequiredString(
      item,
      itemPath,
      `${label} entry`,
      diagnostics
    )) {
      recordOwnerLocalIdentity(
        item,
        itemPath,
        label,
        firstOccurrences,
        diagnostics
      );
    }
  }
  return true;
}

function readPorts(
  value: unknown,
  path: string,
  label: string,
  diagnostics: DefinitionDiagnostic[]
): void {
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', path, `${label} must be an array.`)
    );
    return;
  }
  const firstOccurrences = new Map<string, AuthoredIdentityOccurrence>();
  for (const [index, port] of value.entries()) {
    const portPath = `${path}/${index}`;
    if (!isObject(port)) {
      diagnostics.push(
        diagnostic('INVALID_SOURCE', portPath, `${label} entry must be an object.`)
      );
      continue;
    }
    const namePath = `${portPath}/name`;
    if (readRequiredString(port.name, namePath, `${label} name`, diagnostics)) {
      recordOwnerLocalIdentity(
        port.name,
        namePath,
        label,
        firstOccurrences,
        diagnostics
      );
    }
    readRequiredString(port.type, `${portPath}/type`, `${label} type`, diagnostics);
    if (port.required !== undefined && typeof port.required !== 'boolean') {
      diagnostics.push(
        diagnostic(
          'INVALID_SOURCE',
          `${portPath}/required`,
          `${label} required flag must be a boolean.`
        )
      );
    }
  }
}

function readArtifacts(
  value: unknown,
  path: string,
  label: string,
  diagnostics: DefinitionDiagnostic[],
  firstOccurrences: Map<string, AuthoredIdentityOccurrence> = new Map()
): void {
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', path, `${label} must be an array.`)
    );
    return;
  }
  for (const [index, artifact] of value.entries()) {
    const artifactPath = `${path}/${index}`;
    if (!isObject(artifact)) {
      diagnostics.push(
        diagnostic(
          'INVALID_SOURCE',
          artifactPath,
          `${label} entry must be an object.`
        )
      );
      continue;
    }
    const namePath = `${artifactPath}/name`;
    if (readRequiredString(
      artifact.name,
      namePath,
      `${label} name`,
      diagnostics
    )) {
      recordOwnerLocalIdentity(
        artifact.name,
        namePath,
        label,
        firstOccurrences,
        diagnostics
      );
    }
    readRequiredString(
      artifact.type,
      `${artifactPath}/type`,
      `${label} type`,
      diagnostics
    );
  }
}

function readLimits(
  value: unknown,
  path: string,
  diagnostics: DefinitionDiagnostic[],
  requireMaxIterations: boolean
): void {
  if (!isObject(value)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', path, 'Limits must be an object.')
    );
    return;
  }
  const numericKeys = requireMaxIterations
    ? (['maxIterations', 'maxActions', 'budget'] as const)
    : (['maxActions', 'budget'] as const);
  for (const key of numericKeys) {
    if (key === 'maxIterations' || value[key] !== undefined) {
      if (typeof value[key] !== 'number') {
        diagnostics.push(
          diagnostic(
            'INVALID_SOURCE',
            `${path}/${key}`,
            `${key} must be a number.`
          )
        );
      }
    }
  }
}

function readEndpoint(
  value: unknown,
  path: string,
  label: string,
  diagnostics: DefinitionDiagnostic[]
): void {
  if (!isObject(value)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', path, `${label} endpoint must be an object.`)
    );
    return;
  }
  readRequiredString(value.node, `${path}/node`, `${label} node`, diagnostics);
  readRequiredString(value.port, `${path}/port`, `${label} port`, diagnostics);
}

function readDefinitionNode(
  value: unknown,
  path: string,
  diagnostics: DefinitionDiagnostic[]
): void {
  if (!isObject(value)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', path, 'Definition node must be an object.')
    );
    return;
  }
  readRequiredString(value.id, `${path}/id`, 'Node id', diagnostics);
  if (typeof value.kind !== 'string') {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_NODE_KIND',
        `${path}/kind`,
        `Unknown Definition v2 node kind ${JSON.stringify(value.kind)}; supported kinds are ${ECP_NODE_KINDS.join(', ')}.`
      )
    );
    return;
  }
  if (!(ECP_NODE_KINDS as readonly string[]).includes(value.kind)) {
    diagnostics.push(
      diagnostic(
        'UNKNOWN_NODE_KIND',
        `${path}/kind`,
        `Unknown Definition v2 node kind ${JSON.stringify(value.kind)}; supported kinds are ${ECP_NODE_KINDS.join(', ')}.`
      )
    );
    return;
  }

  switch (value.kind as EcpNodeKind) {
    case 'AtomicStage': {
      if (!isObject(value.capability)) {
        diagnostics.push(
          diagnostic(
            'INVALID_SOURCE',
            `${path}/capability`,
            'AtomicStage capability must be an object.'
          )
        );
        break;
      }
      readRequiredString(
        value.capability.id,
        `${path}/capability/id`,
        'Capability id',
        diagnostics
      );
      readRequiredString(
        value.capability.version,
        `${path}/capability/version`,
        'Capability version',
        diagnostics
      );
      break;
    }
    case 'CompositeRef':
      readRequiredString(
        value.declarationId,
        `${path}/declarationId`,
        'Composite declarationId',
        diagnostics
      );
      break;
    case 'BoundedLoop': {
      readRequiredString(value.body, `${path}/body`, 'BoundedLoop body', diagnostics);
      readLimits(value.limits, `${path}/limits`, diagnostics, true);
      if (!isObject(value.exits)) {
        diagnostics.push(
          diagnostic(
            'INVALID_SOURCE',
            `${path}/exits`,
            'BoundedLoop exits must be an object.'
          )
        );
        break;
      }
      const terminalOutcomePaths = new Map<
        string,
        AuthoredIdentityOccurrence
      >();
      for (const [outcome, exit] of Object.entries(value.exits)) {
        const exitPath = `${path}/exits/${pointerSegment(outcome)}`;
        if (!isObject(exit)) {
          diagnostics.push(
            diagnostic('INVALID_SOURCE', exitPath, 'Loop exit must be an object.')
          );
          continue;
        }
        if (exit.action !== 'continue' && exit.action !== 'exit') {
          diagnostics.push(
            diagnostic(
              'INVALID_SOURCE',
              `${exitPath}/action`,
              "Loop exit action must be 'continue' or 'exit'."
            )
          );
        }
        if (exit.action === 'exit') {
          const outcomePath = `${exitPath}/outcome`;
          if (readRequiredString(
            exit.outcome,
            outcomePath,
            'Loop terminal outcome',
            diagnostics
          )) {
            recordOwnerLocalIdentity(
              exit.outcome,
              outcomePath,
              'BoundedLoop terminal output',
              terminalOutcomePaths,
              diagnostics
            );
          }
        }
      }
      break;
    }
    case 'Choice':
    case 'Gate':
      readStringList(value.outcomes, `${path}/outcomes`, `${value.kind} outcomes`, diagnostics);
      break;
    case 'FanOut':
      readStringList(value.branches, `${path}/branches`, 'FanOut branches', diagnostics);
      break;
    case 'Join':
      readStringList(value.inputs, `${path}/inputs`, 'Join inputs', diagnostics);
      break;
    case 'Finish':
      readRequiredString(value.outcome, `${path}/outcome`, 'Finish outcome', diagnostics);
      break;
  }
}

function readDefinitionGraph(
  value: unknown,
  path: string,
  diagnostics: DefinitionDiagnostic[]
): void {
  if (!isObject(value)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', path, 'Definition graph must be an object.')
    );
    return;
  }
  if (!Array.isArray(value.nodes)) {
    diagnostics.push(
      diagnostic('INVALID_SOURCE', `${path}/nodes`, 'Graph nodes must be an array.')
    );
  } else {
    for (const [index, node] of value.nodes.entries()) {
      readDefinitionNode(node, `${path}/nodes/${index}`, diagnostics);
    }
  }
  if (!Array.isArray(value.connections)) {
    diagnostics.push(
      diagnostic(
        'INVALID_SOURCE',
        `${path}/connections`,
        'Graph connections must be an array.'
      )
    );
  } else {
    for (const [index, connection] of value.connections.entries()) {
      const connectionPath = `${path}/connections/${index}`;
      if (!isObject(connection)) {
        diagnostics.push(
          diagnostic(
            'INVALID_SOURCE',
            connectionPath,
            'Graph connection must be an object.'
          )
        );
        continue;
      }
      readRequiredString(
        connection.id,
        `${connectionPath}/id`,
        'Connection id',
        diagnostics
      );
      readEndpoint(
        connection.from,
        `${connectionPath}/from`,
        'Connection producer',
        diagnostics
      );
      readEndpoint(
        connection.to,
        `${connectionPath}/to`,
        'Connection consumer',
        diagnostics
      );
    }
  }
}

function readV2Source(source: unknown): V2SourceReadResult {
  if (!isObject(source)) {
    return {
      ok: false,
      error: new DefinitionReadError([
        diagnostic('INVALID_SOURCE', '/', 'Pipeline Definition source must be an object.'),
      ]),
    };
  }
  const diagnostics: DefinitionDiagnostic[] = [];
  readRequiredString(source.id, '/id', 'Definition id', diagnostics);
  readRequiredString(source.sourceId, '/sourceId', 'Definition sourceId', diagnostics);
  readRequiredString(source.name, '/name', 'Definition name', diagnostics);
  if (source.description !== undefined && typeof source.description !== 'string') {
    diagnostics.push(
      diagnostic(
        'INVALID_SOURCE',
        '/description',
        'Definition description must be a string.'
      )
    );
  }
  readPorts(source.inputs, '/inputs', 'Definition input', diagnostics);
  const definitionOutputOccurrences = new Map<
    string,
    AuthoredIdentityOccurrence
  >();
  readArtifacts(
    source.artifacts,
    '/artifacts',
    'Definition artifact',
    diagnostics,
    definitionOutputOccurrences
  );
  readStringList(
    source.outcomes,
    '/outcomes',
    'Definition outcomes',
    diagnostics,
    definitionOutputOccurrences
  );
  if (!Array.isArray(source.declarations)) {
    diagnostics.push(
      diagnostic(
        'INVALID_SOURCE',
        '/declarations',
        'Definition declarations must be an array.'
      )
    );
  } else {
    for (const [index, declaration] of source.declarations.entries()) {
      const declarationPath = `/declarations/${index}`;
      if (!isObject(declaration)) {
        diagnostics.push(
          diagnostic(
            'INVALID_SOURCE',
            declarationPath,
            'Composite declaration must be an object.'
          )
        );
        continue;
      }
      readRequiredString(
        declaration.id,
        `${declarationPath}/id`,
        'Composite declaration id',
        diagnostics
      );
      if (declaration.kind !== 'Composite') {
        diagnostics.push(
          diagnostic(
            'INVALID_SOURCE',
            `${declarationPath}/kind`,
            "Composite declaration kind must be 'Composite'."
          )
        );
      }
      if (
        declaration.provenance !== 'built-in' &&
        declaration.provenance !== 'custom'
      ) {
        diagnostics.push(
          diagnostic(
            'INVALID_SOURCE',
            `${declarationPath}/provenance`,
            "Composite provenance must be 'built-in' or 'custom'."
          )
        );
      }
      readPorts(
        declaration.inputs,
        `${declarationPath}/inputs`,
        'Composite input',
        diagnostics
      );
      const compositeOutputOccurrences = new Map<
        string,
        AuthoredIdentityOccurrence
      >();
      readArtifacts(
        declaration.artifacts,
        `${declarationPath}/artifacts`,
        'Composite artifact',
        diagnostics,
        compositeOutputOccurrences
      );
      readStringList(
        declaration.outcomes,
        `${declarationPath}/outcomes`,
        'Composite outcomes',
        diagnostics,
        compositeOutputOccurrences
      );
      readDefinitionGraph(
        declaration.graph,
        `${declarationPath}/graph`,
        diagnostics
      );
    }
  }
  readDefinitionGraph(source.root, '/root', diagnostics);
  if (source.limits !== undefined) {
    readLimits(source.limits, '/limits', diagnostics, false);
  }

  const shapeDiagnostics = diagnostics.filter(
    (item) => item.code !== 'DUPLICATE_ID'
  );
  if (shapeDiagnostics.length > 0) {
    return {
      ok: false,
      error: new DefinitionReadError(orderDefinitionDiagnostics(diagnostics)),
    };
  }
  return {
    ok: true,
    value: source as unknown as DefinitionSourceV2,
    diagnostics: orderDefinitionDiagnostics(diagnostics),
  };
}

function normalizeNamedList<T extends { name: string }>(values: readonly T[]): T[] {
  return [...values]
    .map((value) => structuredClone(value))
    .sort((left, right) => compareCanonicalStrings(left.name, right.name));
}

function normalizeDefinitionNode(node: DefinitionNode): DefinitionNode {
  const normalized = structuredClone(node) as DefinitionNode;
  switch (normalized.kind) {
    case 'Choice':
    case 'Gate':
      return {
        ...normalized,
        outcomes: [...normalized.outcomes].sort(compareCanonicalStrings),
      };
    case 'FanOut':
      return {
        ...normalized,
        branches: [...normalized.branches].sort(compareCanonicalStrings),
      };
    case 'Join':
      return {
        ...normalized,
        inputs: [...normalized.inputs].sort(compareCanonicalStrings),
      };
    default:
      return normalized;
  }
}

function normalizeDefinitionGraph(graph: DefinitionGraph): DefinitionGraph {
  return {
    ...structuredClone(graph),
    nodes: graph.nodes
      .map(normalizeDefinitionNode)
      .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
    connections: graph.connections
      .map((connection) => structuredClone(connection))
      .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
  };
}

function normalizeV2Definition(definition: DefinitionSourceV2): DefinitionSourceV2 {
  return {
    ...structuredClone(definition),
    inputs: normalizeNamedList(definition.inputs),
    artifacts: normalizeNamedList(definition.artifacts),
    outcomes: [...definition.outcomes].sort(compareCanonicalStrings),
    declarations: definition.declarations
      .map((declaration) => ({
        ...structuredClone(declaration),
        inputs: normalizeNamedList(declaration.inputs),
        artifacts: normalizeNamedList(declaration.artifacts),
        outcomes: [...declaration.outcomes].sort(compareCanonicalStrings),
        graph: normalizeDefinitionGraph(declaration.graph),
      }))
      .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
    root: normalizeDefinitionGraph(definition.root),
  };
}

function validateCompositeRecursion(
  definition: DefinitionSourceV2
): DefinitionDiagnostic[] {
  const declarations = new Map(
    definition.declarations.map((declaration, index) => [
      declaration.id,
      { declaration, index },
    ])
  );
  const diagnostics: DefinitionDiagnostic[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();

  const visit = (declarationId: string): void => {
    if (visited.has(declarationId)) return;
    const entry = declarations.get(declarationId);
    if (!entry) return;
    active.add(declarationId);

    for (const [nodeIndex, node] of entry.declaration.graph.nodes.entries()) {
      if (node.kind !== 'CompositeRef') continue;
      const target = node.declarationId;
      const targetEntry = declarations.get(target);
      if (!targetEntry) continue;
      const path = `/declarations/${entry.index}/graph/nodes/${nodeIndex}/declarationId`;
      if (active.has(target)) {
        diagnostics.push(
          diagnostic(
            'COMPOSITE_RECURSION',
            path,
            `Composite '${entry.declaration.id}' recursively references '${target}'. Composite call graphs must be non-recursive.`,
            [
              {
                path: `/declarations/${targetEntry.index}`,
                message: `Recursive declaration '${target}' is defined here.`,
              },
            ]
          )
        );
        continue;
      }
      visit(target);
    }

    active.delete(declarationId);
    visited.add(declarationId);
  };

  for (const declaration of definition.declarations) {
    visit(declaration.id);
  }
  return diagnostics;
}

interface DefinitionGraphEntry {
  graph: DefinitionGraph;
  path: string;
}

function definitionGraphEntries(definition: DefinitionSourceV2): DefinitionGraphEntry[] {
  return [
    { graph: definition.root, path: '/root' },
    ...definition.declarations.map((declaration, index) => ({
      graph: declaration.graph,
      path: `/declarations/${index}/graph`,
    })),
  ];
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function validateIdentitiesAndReferences(
  definition: DefinitionSourceV2
): DefinitionDiagnostic[] {
  const diagnostics: DefinitionDiagnostic[] = [];
  const declarationPaths = new Map<string, string>();
  for (const [index, declaration] of definition.declarations.entries()) {
    const currentPath = `/declarations/${index}/id`;
    const firstPath = declarationPaths.get(declaration.id);
    if (firstPath) {
      diagnostics.push(
        diagnostic(
          'DUPLICATE_ID',
          currentPath,
          `Duplicate Composite declaration identity '${declaration.id}'.`,
          [{ path: firstPath, message: 'The first declaration with this identity is here.' }]
        )
      );
    } else {
      declarationPaths.set(declaration.id, currentPath);
    }
  }
  const declarationIds = new Set(declarationPaths.keys());

  for (const { graph, path } of definitionGraphEntries(definition)) {
    const nodePaths = new Map<string, string>();
    for (const [index, node] of graph.nodes.entries()) {
      const currentPath = `${path}/nodes/${index}/id`;
      const firstPath = nodePaths.get(node.id);
      if (firstPath) {
        diagnostics.push(
          diagnostic(
            'DUPLICATE_ID',
            currentPath,
            `Duplicate node identity '${node.id}' in the same graph.`,
            [{ path: firstPath, message: 'The first node with this identity is here.' }]
          )
        );
      } else {
        nodePaths.set(node.id, currentPath);
      }

      if (node.kind === 'CompositeRef' && !declarationIds.has(node.declarationId)) {
        diagnostics.push(
          diagnostic(
            'UNKNOWN_REFERENCE',
            `${path}/nodes/${index}/declarationId`,
            `Composite declaration '${node.declarationId}' does not exist.`
          )
        );
      }
      if (node.kind === 'BoundedLoop' && !declarationIds.has(node.body)) {
        diagnostics.push(
          diagnostic(
            'UNKNOWN_REFERENCE',
            `${path}/nodes/${index}/body`,
            `BoundedLoop body declaration '${node.body}' does not exist.`
          )
        );
      }
    }

    const connectionPaths = new Map<string, string>();
    for (const [index, connection] of graph.connections.entries()) {
      const identityPath = `${path}/connections/${index}/id`;
      const firstPath = connectionPaths.get(connection.id);
      if (firstPath) {
        diagnostics.push(
          diagnostic(
            'DUPLICATE_ID',
            identityPath,
            `Duplicate connection identity '${connection.id}' in the same graph.`,
            [{ path: firstPath, message: 'The first connection with this identity is here.' }]
          )
        );
      } else {
        connectionPaths.set(connection.id, identityPath);
      }
      if (!nodePaths.has(connection.from.node)) {
        diagnostics.push(
          diagnostic(
            'UNKNOWN_REFERENCE',
            `${path}/connections/${index}/from/node`,
            `Connection producer node '${connection.from.node}' does not exist.`
          )
        );
      }
      if (!nodePaths.has(connection.to.node)) {
        diagnostics.push(
          diagnostic(
            'UNKNOWN_REFERENCE',
            `${path}/connections/${index}/to/node`,
            `Connection consumer node '${connection.to.node}' does not exist.`
          )
        );
      }
    }
  }
  return diagnostics;
}

function validateGraphCycles(definition: DefinitionSourceV2): DefinitionDiagnostic[] {
  const diagnostics: DefinitionDiagnostic[] = [];
  for (const { graph, path } of definitionGraphEntries(definition)) {
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const indegree = new Map([...nodeIds].map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const connection of graph.connections) {
      if (!nodeIds.has(connection.from.node) || !nodeIds.has(connection.to.node)) continue;
      indegree.set(connection.to.node, (indegree.get(connection.to.node) ?? 0) + 1);
      const targets = outgoing.get(connection.from.node) ?? [];
      targets.push(connection.to.node);
      outgoing.set(connection.from.node, targets);
    }
    const queue = [...indegree.entries()]
      .filter(([, count]) => count === 0)
      .map(([id]) => id)
      .sort(compareCanonicalStrings);
    const processed = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      processed.add(current);
      for (const target of outgoing.get(current) ?? []) {
        const next = (indegree.get(target) ?? 1) - 1;
        indegree.set(target, next);
        if (next === 0) queue.push(target);
      }
      queue.sort(compareCanonicalStrings);
    }
    if (processed.size === nodeIds.size) continue;
    const cyclic = new Set([...nodeIds].filter((id) => !processed.has(id)));
    const edgeIndex = graph.connections.findIndex(
      (connection) =>
        cyclic.has(connection.from.node) && cyclic.has(connection.to.node)
    );
    diagnostics.push(
      diagnostic(
        'GRAPH_CYCLE',
        `${path}/connections/${Math.max(0, edgeIndex)}`,
        `Graph contains an ordinary cycle involving ${[...cyclic].sort(compareCanonicalStrings).join(', ')}; feedback must use BoundedLoop.`
      )
    );
  }
  return diagnostics;
}

function validateLoopsAndLimits(
  definition: DefinitionSourceV2,
  catalog: CapabilityCatalogSnapshot
): DefinitionDiagnostic[] {
  const diagnostics: DefinitionDiagnostic[] = [];
  const declarations = new Map(
    definition.declarations.map((declaration, index) => [
      declaration.id,
      { declaration, index },
    ])
  );

  const addPositiveLimitDiagnostic = (
    value: unknown,
    path: string,
    label: string
  ): void => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      diagnostics.push(
        diagnostic('INVALID_LIMIT', path, `${label} must be a finite positive integer.`)
      );
    }
  };

  if (definition.limits) {
    if (definition.limits.maxActions !== undefined) {
      addPositiveLimitDiagnostic(
        definition.limits.maxActions,
        '/limits/maxActions',
        'Definition maxActions'
      );
    }
    if (definition.limits.budget !== undefined) {
      addPositiveLimitDiagnostic(
        definition.limits.budget,
        '/limits/budget',
        'Definition budget'
      );
    }
    if (
      typeof definition.limits.maxActions === 'number' &&
      typeof definition.limits.budget === 'number' &&
      definition.limits.budget < definition.limits.maxActions
    ) {
      diagnostics.push(
        diagnostic(
          'IMPOSSIBLE_BUDGET',
          '/limits/budget',
          `Definition budget ${definition.limits.budget} cannot admit maxActions ${definition.limits.maxActions}.`
        )
      );
    }
  }

  for (const { graph, path } of definitionGraphEntries(definition)) {
    for (const [nodeIndex, node] of graph.nodes.entries()) {
      if (node.kind !== 'BoundedLoop') continue;
      const loopPath = `${path}/nodes/${nodeIndex}`;
      addPositiveLimitDiagnostic(
        node.limits.maxIterations,
        `${loopPath}/limits/maxIterations`,
        'BoundedLoop maxIterations'
      );
      if (node.limits.maxActions !== undefined) {
        addPositiveLimitDiagnostic(
          node.limits.maxActions,
          `${loopPath}/limits/maxActions`,
          'BoundedLoop maxActions'
        );
      }
      if (node.limits.budget !== undefined) {
        addPositiveLimitDiagnostic(
          node.limits.budget,
          `${loopPath}/limits/budget`,
          'BoundedLoop budget'
        );
      }
      if (
        typeof node.limits.maxActions === 'number' &&
        typeof node.limits.budget === 'number' &&
        node.limits.budget < node.limits.maxActions
      ) {
        diagnostics.push(
          diagnostic(
            'IMPOSSIBLE_BUDGET',
            `${loopPath}/limits/budget`,
            `Loop budget ${node.limits.budget} cannot admit maxActions ${node.limits.maxActions}.`
          )
        );
      }

      const body = declarations.get(node.body);
      if (!body) continue;
      const reachableOutcomes = resolveGraphTerminalOutcomes(
        body.declaration.graph,
        `/declarations/${body.index}/graph`,
        catalog,
        declarations,
        new Set([body.declaration.id])
      );
      for (const outcome of [...reachableOutcomes.outcomes.keys()].sort(compareCanonicalStrings)) {
        if (!(outcome in node.exits)) {
          diagnostics.push(
            diagnostic(
              'MISSING_EXIT',
              `${loopPath}/exits/${pointerSegment(outcome)}`,
              `BoundedLoop has no continue/exit mapping for reachable body outcome '${outcome}'.`
            )
          );
        }
      }
      for (const outcome of Object.keys(node.exits).sort(compareCanonicalStrings)) {
        if (
          reachableOutcomes.complete &&
          !reachableOutcomes.outcomes.has(outcome)
        ) {
          diagnostics.push(
            diagnostic(
              'UNREACHABLE_EXIT',
              `${loopPath}/exits/${pointerSegment(outcome)}`,
              `BoundedLoop exit '${outcome}' does not name a reachable body outcome.`
            )
          );
        }
      }

      const visitedDeclarations = new Set<string>();
      const reportedNestedPaths = new Set<string>();
      const visitBody = (declarationId: string): void => {
        if (visitedDeclarations.has(declarationId)) return;
        visitedDeclarations.add(declarationId);
        const current = declarations.get(declarationId);
        if (!current) return;
        for (const [nestedIndex, nested] of current.declaration.graph.nodes.entries()) {
          const nestedPath = `/declarations/${current.index}/graph/nodes/${nestedIndex}/kind`;
          if (nested.kind === 'BoundedLoop') {
            if (!reportedNestedPaths.has(nestedPath)) {
              reportedNestedPaths.add(nestedPath);
              diagnostics.push(
                diagnostic(
                  'NESTED_LOOP',
                  nestedPath,
                  `BoundedLoop body '${body.declaration.id}' transitively contains nested loop '${nested.id}'.`,
                  [
                    {
                      path: `${loopPath}/body`,
                      message: `The outer loop references body '${body.declaration.id}' here.`,
                    },
                  ]
                )
              );
            }
            visitBody(nested.body);
          } else if (nested.kind === 'CompositeRef') {
            visitBody(nested.declarationId);
          }
        }
      };
      visitBody(body.declaration.id);
    }
  }
  return diagnostics;
}

function validateCapabilities(
  definition: DefinitionSourceV2,
  catalog: CapabilityCatalogSnapshot
): DefinitionDiagnostic[] {
  const diagnostics: DefinitionDiagnostic[] = [];
  const graphEntries: { graph: DefinitionGraph; path: string }[] = [
    { graph: definition.root, path: '/root' },
    ...definition.declarations.map((declaration, index) => ({
      graph: declaration.graph,
      path: `/declarations/${index}/graph`,
    })),
  ];

  for (const { graph, path } of graphEntries) {
    for (const [nodeIndex, node] of graph.nodes.entries()) {
      if (node.kind !== 'AtomicStage' || node.capability.version === 'legacy') continue;
      const capabilityPath = `${path}/nodes/${nodeIndex}/capability`;
      const byId = catalog.descriptors.filter(
        (descriptor) => descriptor.id === node.capability.id
      );
      if (byId.length === 0) {
        diagnostics.push(
          diagnostic(
            'CAPABILITY_MISSING',
            capabilityPath,
            `Capability '${node.capability.id}' is not present in catalog snapshot version ${catalog.version}.`
          )
        );
        continue;
      }
      const descriptor = byId.find(
        (candidate) => candidate.version === node.capability.version
      );
      if (!descriptor) {
        diagnostics.push(
          diagnostic(
            'CAPABILITY_VERSION_MISMATCH',
            capabilityPath,
            `Capability '${node.capability.id}' version '${node.capability.version}' is unavailable; catalog versions are ${byId.map((candidate) => candidate.version).sort(compareCanonicalStrings).join(', ')}.`
          )
        );
        continue;
      }
      if (descriptor.availability === 'disabled') {
        diagnostics.push(
          diagnostic(
            'CAPABILITY_DISABLED',
            capabilityPath,
            `Capability '${descriptor.id}' version '${descriptor.version}' is installed but disabled.`
          )
        );
      } else if (descriptor.availability === 'forbidden') {
        diagnostics.push(
          diagnostic(
            'CAPABILITY_FORBIDDEN',
            capabilityPath,
            `Capability '${descriptor.id}' version '${descriptor.version}' is forbidden by the trusted catalog.`
          )
        );
      }
    }
  }
  return diagnostics;
}

const CONTROL_PORT_TYPE = 'ecp/control';
const CONTROL_INPUT_PORTS = ['input', 'in', 'start'] as const;

interface NodePortContract {
  readonly inputs: ReadonlyMap<string, string>;
  readonly outputs: ReadonlyMap<string, string>;
}

function portMap(
  ports: readonly Readonly<{ name: string; type: string }>[]
): Map<string, string> {
  return new Map(ports.map((port) => [port.name, port.type]));
}

function controlInputs(): Map<string, string> {
  return new Map(CONTROL_INPUT_PORTS.map((name) => [name, CONTROL_PORT_TYPE]));
}

function outcomeOutputs(outcomes: readonly string[]): Map<string, string> {
  return new Map(outcomes.map((outcome) => [outcome, CONTROL_PORT_TYPE]));
}

/**
 * The sole static contract resolver for the closed v2 node algebra. Every
 * connection validator and reachable-outcome proof consumes this same view.
 */
function contractForNode(
  node: DefinitionNode,
  catalog: CapabilityCatalogSnapshot,
  declarations: ReadonlyMap<string, CompositeDeclaration>
): NodePortContract {
  switch (node.kind) {
    case 'AtomicStage': {
      const descriptor = catalog.descriptors.find(
        (candidate) =>
          candidate.id === node.capability.id &&
          candidate.version === node.capability.version
      );
      if (!descriptor && node.capability.version === 'legacy') {
        return {
          inputs: new Map([['start', CONTROL_PORT_TYPE]]),
          outputs: new Map([['done', CONTROL_PORT_TYPE]]),
        };
      }
      return {
        inputs: descriptor ? portMap(descriptor.inputs) : new Map(),
        outputs: descriptor
          ? new Map([
              ...portMap(descriptor.artifacts),
              ...outcomeOutputs(descriptor.outcomes),
            ])
          : new Map(),
      };
    }
    case 'CompositeRef': {
      const declaration = declarations.get(node.declarationId);
      return {
        inputs: declaration ? portMap(declaration.inputs) : new Map(),
        outputs: declaration
          ? new Map([
              ...portMap(declaration.artifacts),
              ...outcomeOutputs(declaration.outcomes),
            ])
          : new Map(),
      };
    }
    case 'BoundedLoop': {
      const declaration = declarations.get(node.body);
      const terminalOutcomes = Object.values(node.exits)
        .filter(
          (
            exit
          ): exit is Readonly<{ action: 'exit'; outcome: string }> =>
            exit.action === 'exit'
        )
        .map((exit) => exit.outcome);
      return {
        inputs: declaration ? portMap(declaration.inputs) : new Map(),
        outputs: outcomeOutputs(terminalOutcomes),
      };
    }
    case 'Choice':
    case 'Gate':
      return {
        inputs: controlInputs(),
        outputs: outcomeOutputs(node.outcomes),
      };
    case 'FanOut':
      return {
        inputs: controlInputs(),
        outputs: outcomeOutputs(node.branches),
      };
    case 'Join':
      return {
        inputs: new Map(
          node.inputs.map((input) => [input, CONTROL_PORT_TYPE])
        ),
        outputs: outcomeOutputs(['done']),
      };
    case 'Finish':
      return {
        inputs: controlInputs(),
        outputs: new Map(),
      };
  }
}

interface TerminalOutcome {
  readonly paths: readonly string[];
}

interface TerminalDeclarationEntry {
  readonly declaration: CompositeDeclaration;
  readonly index: number;
}

interface GraphTerminalResolution {
  readonly outcomes: Map<string, TerminalOutcome>;
  readonly complete: boolean;
}

function outputPathForNode(
  node: DefinitionNode,
  nodePath: string,
  outcome: string
): string {
  switch (node.kind) {
    case 'Choice':
    case 'Gate': {
      const index = node.outcomes.indexOf(outcome);
      return `${nodePath}/outcomes/${Math.max(index, 0)}`;
    }
    case 'FanOut': {
      const index = node.branches.indexOf(outcome);
      return `${nodePath}/branches/${Math.max(index, 0)}`;
    }
    case 'BoundedLoop': {
      const entry = Object.entries(node.exits).find(
        ([, exit]) => exit.action === 'exit' && exit.outcome === outcome
      );
      return entry
        ? `${nodePath}/exits/${pointerSegment(entry[0])}/outcome`
        : `${nodePath}/exits`;
    }
    case 'CompositeRef':
      return `${nodePath}/declarationId`;
    case 'AtomicStage':
      return `${nodePath}/capability`;
    case 'Join':
      return `${nodePath}/kind`;
    case 'Finish':
      return `${nodePath}/outcome`;
  }
}

function resolveGraphTerminalOutcomes(
  graph: DefinitionGraph,
  graphPath: string,
  catalog: CapabilityCatalogSnapshot,
  declarations: ReadonlyMap<string, TerminalDeclarationEntry>,
  activeDeclarations: ReadonlySet<string> = new Set()
): GraphTerminalResolution {
  const declarationContracts = new Map(
    [...declarations].map(([id, entry]) => [id, entry.declaration])
  );
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const consumedControlOutputs = new Set<string>();
  const outcomes = new Map<string, TerminalOutcome>();
  let complete = true;
  for (const connection of graph.connections) {
    const producerNode = nodes.get(connection.from.node);
    const consumerNode = nodes.get(connection.to.node);
    if (!producerNode || !consumerNode) {
      complete = false;
      continue;
    }
    const producer = contractForNode(
      producerNode,
      catalog,
      declarationContracts
    );
    const consumer = contractForNode(
      consumerNode,
      catalog,
      declarationContracts
    );
    const producedType = producer.outputs.get(connection.from.port);
    const consumedType = consumer.inputs.get(connection.to.port);
    if (
      !producedType ||
      !consumedType ||
      producedType !== consumedType
    ) {
      complete = false;
      continue;
    }
    if (producedType === CONTROL_PORT_TYPE) {
      consumedControlOutputs.add(
        `${connection.from.node}\0${connection.from.port}`
      );
    }
  }
  const add = (outcome: string, path: string): void => {
    const existing = outcomes.get(outcome);
    outcomes.set(outcome, {
      paths: existing ? [...existing.paths, path] : [path],
    });
  };

  for (const [nodeIndex, node] of graph.nodes.entries()) {
    const nodePath = `${graphPath}/nodes/${nodeIndex}`;
    if (node.kind === 'Finish') {
      add(node.outcome, `${nodePath}/outcome`);
      continue;
    }
    if (node.kind === 'CompositeRef') {
      const target = declarations.get(node.declarationId);
      if (!target || activeDeclarations.has(target.declaration.id)) {
        complete = false;
        continue;
      }
      const nested = resolveGraphTerminalOutcomes(
        target.declaration.graph,
        `/declarations/${target.index}/graph`,
        catalog,
        declarations,
        new Set([...activeDeclarations, target.declaration.id])
      );
      complete = complete && nested.complete;
      for (const outcome of nested.outcomes.keys()) {
        if (!consumedControlOutputs.has(`${node.id}\0${outcome}`)) {
          add(outcome, `${nodePath}/declarationId`);
        }
      }
      continue;
    }
    if (
      node.kind === 'AtomicStage' &&
      node.capability.version !== 'legacy' &&
      !catalog.descriptors.some(
        (descriptor) =>
          descriptor.id === node.capability.id &&
          descriptor.version === node.capability.version
      )
    ) {
      complete = false;
    }
    for (const [name, type] of contractForNode(
      node,
      catalog,
      declarationContracts
    ).outputs) {
      if (
        type === CONTROL_PORT_TYPE &&
        !consumedControlOutputs.has(`${node.id}\0${name}`)
      ) {
        add(name, outputPathForNode(node, nodePath, name));
      }
    }
  }
  return { outcomes, complete };
}

function validateOwnerTerminalOutcomes(
  definition: DefinitionSourceV2,
  catalog: CapabilityCatalogSnapshot
): DefinitionDiagnostic[] {
  const diagnostics: DefinitionDiagnostic[] = [];
  const declarations = new Map(
    definition.declarations.map((declaration, index) => [
      declaration.id,
      { declaration, index },
    ])
  );
  const owners = [
    {
      graph: definition.root,
      graphPath: '/root',
      outcomes: definition.outcomes,
      outcomePath: (index: number) => `/outcomes/${index}`,
      label: 'Definition',
      active: new Set<string>(),
    },
    ...definition.declarations.map((declaration, index) => ({
      graph: declaration.graph,
      graphPath: `/declarations/${index}/graph`,
      outcomes: declaration.outcomes,
      outcomePath: (outcomeIndex: number) =>
        `/declarations/${index}/outcomes/${outcomeIndex}`,
      label: `Composite '${declaration.id}'`,
      active: new Set([declaration.id]),
    })),
  ];

  for (const owner of owners) {
    const actual = resolveGraphTerminalOutcomes(
      owner.graph,
      owner.graphPath,
      catalog,
      declarations,
      owner.active
    );
    const declared = new Set(owner.outcomes);
    for (const [outcome, produced] of actual.outcomes) {
      if (declared.has(outcome)) continue;
      diagnostics.push(
        diagnostic(
          'PORT_MISMATCH',
          produced.paths[0]!,
          `${owner.label} graph produces terminal outcome '${outcome}', but it is not declared by the owner contract.`,
          produced.paths.slice(1).map((path) => ({
            path,
            message: `The same undeclared terminal outcome is also produced here.`,
          }))
        )
      );
    }
    for (const [index, outcome] of owner.outcomes.entries()) {
      if (!actual.complete || actual.outcomes.has(outcome)) continue;
      diagnostics.push(
        diagnostic(
          'PORT_MISMATCH',
          owner.outcomePath(index),
          `${owner.label} declares terminal outcome '${outcome}', but it cannot be produced by the graph.`
        )
      );
    }
  }
  return diagnostics;
}

function validateTypedPorts(
  definition: DefinitionSourceV2,
  catalog: CapabilityCatalogSnapshot
): DefinitionDiagnostic[] {
  const diagnostics: DefinitionDiagnostic[] = [];
  const declarations = new Map(
    definition.declarations.map((declaration) => [declaration.id, declaration])
  );
  const graphEntries: {
    graph: DefinitionGraph;
    path: string;
  }[] = [
    { graph: definition.root, path: '/root' },
    ...definition.declarations.map((declaration, index) => ({
      graph: declaration.graph,
      path: `/declarations/${index}/graph`,
    })),
  ];

  for (const { graph, path } of graphEntries) {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const [connectionIndex, connection] of graph.connections.entries()) {
      const producerNode = nodes.get(connection.from.node);
      const consumerNode = nodes.get(connection.to.node);
      if (!producerNode || !consumerNode) continue;
      const producer = contractForNode(producerNode, catalog, declarations);
      const consumer = contractForNode(consumerNode, catalog, declarations);
      const producedType = producer.outputs.get(connection.from.port);
      const consumedType = consumer.inputs.get(connection.to.port);
      const fromPath = `${path}/connections/${connectionIndex}/from/port`;
      const toPath = `${path}/connections/${connectionIndex}/to/port`;

      if (!producedType) {
        diagnostics.push(
          diagnostic(
            'PORT_MISMATCH',
            fromPath,
            `Node '${connection.from.node}' has no declared output or outcome port '${connection.from.port}'.`,
            [
              {
                path: toPath,
                message: `The connection consumes '${connection.to.node}.${connection.to.port}' here.`,
              },
            ]
          )
        );
      }
      if (!consumedType) {
        diagnostics.push(
          diagnostic(
            'PORT_MISMATCH',
            toPath,
            `Node '${connection.to.node}' has no declared input port '${connection.to.port}'.`,
            [
              {
                path: fromPath,
                message: `The connection produces '${connection.from.node}.${connection.from.port}' here.`,
              },
            ]
          )
        );
      }
      if (
        producedType &&
        consumedType &&
        producedType !== consumedType
      ) {
        diagnostics.push(
          diagnostic(
            'PORT_MISMATCH',
            toPath,
            `Port '${connection.to.port}' requires '${consumedType}' but '${connection.from.node}.${connection.from.port}' produces '${producedType}'.`,
            [
              {
                path: fromPath,
                message: `Producer port '${connection.from.node}.${connection.from.port}' is declared here.`,
              },
            ]
          )
        );
      }
    }
  }
  return diagnostics;
}

function relevantCapabilityDescriptors(
  definition: DefinitionSourceV2,
  catalog: CapabilityCatalogSnapshot
): readonly Readonly<CapabilityDescriptor>[] {
  const identities = new Set<string>();
  const graphs = [
    definition.root,
    ...definition.declarations.map((declaration) => declaration.graph),
  ];
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (node.kind !== 'AtomicStage' || node.capability.version === 'legacy') continue;
      identities.add(`${node.capability.id}\0${node.capability.version}`);
    }
  }
  return catalog.descriptors.filter((descriptor) =>
    identities.has(`${descriptor.id}\0${descriptor.version}`)
  );
}

/**
 * Determine whether a v2 definition is executable via the v2 reconciler runtime.
 * Admits plans with root-level AtomicStage, Gate, Choice, Finish, CompositeRef,
 * and BoundedLoop nodes. CompositeRef declarations must have AtomicStage-only
 * bodies. BoundedLoop declarations must be either ReviewCycle-shaped or have
 * AtomicStage-only bodies (composite body kind).
 */
function supportsV2ExecutableRuntime(
  definition: DefinitionSourceV2
): boolean {
  let compositeOrLoop = 0;
  for (const node of definition.root.nodes) {
    if (node.kind === 'Finish') continue;
    if (node.kind === 'AtomicStage') continue;
    if (node.kind === 'Gate') continue;
    if (node.kind === 'Choice') continue;
    if (node.kind === 'FanOut') { compositeOrLoop += 1; continue; }
    if (node.kind === 'Join') continue;
    if (node.kind === 'CompositeRef') {
      // A CompositeRef is executable if its declaration body contains only
      // AtomicStage nodes (flat DAG).
      const declaration = definition.declarations.find(
        (candidate) => candidate.id === node.declarationId
      );
      if (declaration === undefined) return false;
      const hasNonAtomic = declaration.graph.nodes.some(
        (bodyNode) => bodyNode.kind !== 'AtomicStage'
      );
      if (hasNonAtomic) return false;
      compositeOrLoop += 1;
      continue;
    }
    if (node.kind !== 'BoundedLoop') return false;
    compositeOrLoop += 1;
    const declaration = definition.declarations.find(
      (candidate) => candidate.id === node.body
    );
    if (declaration === undefined) return false;
    // Check if ReviewCycle-shaped.
    const phases = declaration.graph.nodes
      .map((bodyNode) =>
        bodyNode.kind === 'AtomicStage'
          ? bodyNode.reviewCyclePhase
          : undefined
      )
      .filter((phase): phase is string => typeof phase === 'string')
      .sort();
    const isReviewCycleShaped =
      phases.length === 4 &&
      JSON.stringify(phases) ===
        JSON.stringify(['fix', 're-review', 'review', 'triage']);
    if (isReviewCycleShaped) {
      // ReviewCycle loop: must exit on clean and continue on needs_fix.
      if (
        node.exits.clean?.action !== 'exit' ||
        node.exits.needs_fix?.action !== 'continue'
      ) {
        return false;
      }
    } else {
      // Composite body: declaration must contain only AtomicStage nodes.
      const hasNonAtomic = declaration.graph.nodes.some(
        (bodyNode) => bodyNode.kind !== 'AtomicStage'
      );
      if (hasNonAtomic) return false;
    }
    compositeOrLoop += 1;
  }
  return compositeOrLoop > 0;
}

function normalizeV1(pipeline: PipelineYaml): DefinitionSourceV2 {
  const stages = [...pipeline.stages].sort((left, right) =>
    compareCanonicalStrings(left.id, right.id)
  );
  const nodes: DefinitionNode[] = [];
  const declarations: CompositeDeclaration[] = [];

  for (const stage of stages) {
    const capability = {
      id: stage.kind === 'decompose'
        ? `pipeline:${stage.childPipeline ?? 'small-feature'}`
        : `skill:${stage.skill}`,
      version: 'legacy',
    };
    const normalizedLegacyStage = {
      ...stage,
      requires: [...stage.requires].sort(compareCanonicalStrings),
    };

    // D4 migration: stages with loop.kind === 'review-cycle' or
    // verifyPolicy === 'adaptive' produce a v2 BoundedLoop with a 4-phase
    // ReviewCycle body, enabling reconciler execution.
    const isReviewCycleLoop =
      stage.loop?.kind === 'review-cycle';
    const isAdaptiveVerify = stage.verifyPolicy === 'adaptive';

    if (isReviewCycleLoop || isAdaptiveVerify) {
      const bodyId = `review-cycle-body:${stage.id}`;
      const maxIterations = isReviewCycleLoop
        ? stage.loop!.maxRounds
        : 3;
      // Trivial-1 fix: all 4 ReviewCycle body phases use the same capability
      // (`skill:rasen-review`) for consistency. The per-phase role/workspace
      // differentiation is encoded in the execution profile, not the capability.
      const reviewCycleCapability = { id: 'skill:rasen-review', version: 'legacy' };
      declarations.push({
        id: bodyId,
        kind: 'Composite',
        provenance: 'built-in',
        inputs: [],
        artifacts: [],
        outcomes: ['clean', 'needs_fix'],
        graph: {
          nodes: [
            {
              id: `${stage.id}:review`,
              kind: 'AtomicStage',
              capability: reviewCycleCapability,
              reviewCyclePhase: 'review',
              legacyStageId: stage.id,
              legacyRuntimeOwner: 'prompt-owned-v1',
            },
            {
              id: `${stage.id}:triage`,
              kind: 'AtomicStage',
              capability: reviewCycleCapability,
              reviewCyclePhase: 'triage',
              legacyRuntimeOwner: 'prompt-owned-v1',
            },
            {
              id: `${stage.id}:fix`,
              kind: 'AtomicStage',
              capability: reviewCycleCapability,
              reviewCyclePhase: 'fix',
              legacyRuntimeOwner: 'prompt-owned-v1',
            },
            {
              id: `${stage.id}:re-review`,
              kind: 'AtomicStage',
              capability: reviewCycleCapability,
              reviewCyclePhase: 're-review',
              legacyRuntimeOwner: 'prompt-owned-v1',
            },
          ],
          connections: [
            {
              id: `${stage.id}:review-to-triage`,
              from: { node: `${stage.id}:review`, port: 'findings' },
              to: { node: `${stage.id}:triage`, port: 'start' },
            },
            {
              id: `${stage.id}:triage-to-fix`,
              from: { node: `${stage.id}:triage`, port: 'ready' },
              to: { node: `${stage.id}:fix`, port: 'start' },
            },
            {
              id: `${stage.id}:fix-to-re-review`,
              from: { node: `${stage.id}:fix`, port: 'fixed' },
              to: { node: `${stage.id}:re-review`, port: 'start' },
            },
          ],
        },
      });
      nodes.push({
        id: `stage:${stage.id}`,
        kind: 'BoundedLoop',
        body: bodyId,
        limits: { maxIterations },
        exits: {
          clean: { action: 'exit', outcome: 'clean' },
          needs_fix: { action: 'continue' },
        },
        exhaustedOutcome: 'review_cycle_exhausted',
        legacyRuntimeOwner: 'prompt-owned-v1',
        legacy: normalizedLegacyStage,
      });
      continue;
    }

    // ECP-3 migration: stages with loop.kind === 'goal' produce a v2
    // BoundedLoop with a 2-phase goal-cycle body (work → judge), enabling
    // reconciler execution. The variant is derived from the gate type
    // (measure → measure, evaluate → evaluate) and pipeline name
    // (goal-loop-research → research), then stored as an explicit
    // goalCycleVariant tag on the BoundedLoop node so downstream layers
    // (lowerer) do not need to re-derive it from the pipeline name.
    if (stage.loop?.kind === 'goal') {
      const goalLoop = stage.loop;
      const bodyId = `goal-cycle-body:${stage.id}`;
      const maxIterations = goalLoop.maxRounds;
      const gateKind = goalLoop.gate?.kind;
      // Detect research variant from pipeline name.
      const isResearch = pipeline.name === 'goal-loop-research';
      const variant = isResearch
        ? 'research'
        : gateKind === 'measure'
          ? 'measure'
          : 'evaluate';
      const iterateCapability = { id: 'skill:rasen-goal-iterate', version: 'legacy' };

      declarations.push({
        id: bodyId,
        kind: 'Composite',
        provenance: 'built-in',
        inputs: [],
        artifacts: [],
        outcomes: ['clean', 'needs_fix'],
        graph: {
          nodes: [
            {
              id: `${stage.id}:work`,
              kind: 'AtomicStage',
              capability: iterateCapability,
              goalCyclePhase: 'work',
              legacyStageId: stage.id,
              legacyRuntimeOwner: 'prompt-owned-v1',
            },
            {
              id: `${stage.id}:judge`,
              kind: 'AtomicStage',
              capability: iterateCapability,
              goalCyclePhase: 'judge',
              legacyRuntimeOwner: 'prompt-owned-v1',
            },
          ],
          connections: [
            {
              id: `${stage.id}:work-to-judge`,
              from: { node: `${stage.id}:work`, port: 'done' },
              to: { node: `${stage.id}:judge`, port: 'start' },
            },
          ],
        },
      });
      nodes.push({
        id: `stage:${stage.id}`,
        kind: 'BoundedLoop',
        body: bodyId,
        limits: { maxIterations },
        exits: {
          clean: { action: 'exit', outcome: 'clean' },
          needs_fix: { action: 'continue' },
        },
        exhaustedOutcome: 'goal_cycle_exhausted',
        legacyRuntimeOwner: 'prompt-owned-v1',
        legacy: normalizedLegacyStage,
        // Explicit variant tag so downstream layers (lowerer) do not need to
        // re-derive the variant from the pipeline name. The pipeline-name
        // fallback in the lowerer is kept only for backward compatibility.
        goalCycleVariant: variant,
      });
      continue;
    }

    nodes.push({
      id: `stage:${stage.id}`,
      kind: 'AtomicStage',
      capability,
      legacyStageId: stage.id,
      legacyRuntimeOwner: 'prompt-owned-v1',
      legacy: normalizedLegacyStage,
    });

    if (stage.condition) {
      nodes.push({
        id: `condition:${stage.id}`,
        kind: 'Choice',
        outcomes: ['matched', 'skipped'],
        expression: stage.condition,
        target: `stage:${stage.id}`,
        legacyRuntimeOwner: 'prompt-owned-v1',
      });
    }
    if (stage.gate) {
      nodes.push({
        id: `gate:${stage.id}`,
        kind: 'Gate',
        outcomes: ['approved', 'rejected'],
        target: `stage:${stage.id}`,
        legacyRuntimeOwner: 'prompt-owned-v1',
      });
    }
    if (stage.loop) {
      const bodyId = `legacy-loop-body:${stage.id}`;
      declarations.push({
        id: bodyId,
        kind: 'Composite',
        provenance: 'built-in',
        inputs: [],
        artifacts: [],
        outcomes: ['done'],
        graph: {
          nodes: [
            {
              id: `body-stage:${stage.id}`,
              kind: 'AtomicStage',
              capability,
              legacyStageId: stage.id,
              legacyRuntimeOwner: 'prompt-owned-v1',
            },
          ],
          connections: [],
        },
        legacyLoop: stage.loop,
      });
      nodes.push({
        id: `loop:${stage.id}`,
        kind: 'BoundedLoop',
        body: bodyId,
        limits: {
          maxIterations: stage.loop.maxRounds,
        },
        exits: {
          done: { action: 'exit', outcome: 'done' },
        },
        legacyRuntimeOwner: 'prompt-owned-v1',
        legacyLoop: stage.loop,
      });
    }
  }

  nodes.sort((left, right) => compareCanonicalStrings(left.id, right.id));
  declarations.sort((left, right) => compareCanonicalStrings(left.id, right.id));

  // ECP-4: detect v1 parallelGroup on stages and produce FanOut/Join v2 nodes.
  const groupMap = new Map<string, typeof stages>();
  for (const stage of stages) {
    const group = (stage as Readonly<{ parallelGroup?: string }>).parallelGroup;
    if (group === undefined) continue;
    const existing = groupMap.get(group) ?? [];
    existing.push(stage);
    groupMap.set(group, existing);
  }
  // FanOut/Join nodes and connections produced by groups
  const groupConnections: DefinitionConnection[] = [];

  for (const [groupName, groupStages] of groupMap) {
    const memberIds = groupStages.map((s) => s.id).sort(compareCanonicalStrings);
    const joinId = `${groupName}-join`;
    const memberMeta = groupStages.map((s) => {
      const condition = (s as Readonly<{ condition?: string }>).condition ?? 'always';
      return {
        id: s.id,
        required: condition === 'always',
        condition,
      };
    });
    const requiredMembers = memberMeta.filter((m) => m.required).map((m) => `stage:${m.id}`);
    const optionalMembers = memberMeta.filter((m) => !m.required).map((m) => `stage:${m.id}`);

    // FanOut node
    const fanOutNode: DefinitionNode = {
      id: `fanout:${groupName}`,
      kind: 'FanOut',
      branches: memberIds,
      // ECP-4 metadata for the lowerer
      concurrencyCap: 3,
      budget: memberIds.length,
      joinNodeId: `join:${joinId}`,
      members: memberMeta.map((m) => ({
        id: m.id,
        hierarchicalPath: `stage:${m.id}`,
        required: m.required,
        condition: m.condition,
      })),
    };
    nodes.push(fanOutNode);

    // Join node
    const joinNode: DefinitionNode = {
      id: `join:${joinId}`,
      kind: 'Join',
      inputs: memberIds.map((id) => `stage:${id}`),
      requiredMembers,
      optionalMembers,
      outcomes: { proceed: `${groupName}-done`, failed: `${groupName}-failed` },
    };
    nodes.push(joinNode);

    // Connect FanOut → members (each member requires the FanOut)
    for (const memberId of memberIds) {
      groupConnections.push({
        id: `fanout:${groupName}->stage:${memberId}`,
        from: { node: `fanout:${groupName}`, port: 'dispatch' },
        to: { node: `stage:${memberId}`, port: 'start' },
      });
    }
    // Connect members → Join
    for (const memberId of memberIds) {
      groupConnections.push({
        id: `stage:${memberId}->join:${joinId}`,
        from: { node: `stage:${memberId}`, port: 'done' },
        to: { node: `join:${joinId}`, port: 'input' },
      });
    }
  }

  // Rewrite downstream connections: a stage that requires a group member now
  // requires the Join instead. Also, group members' upstream requires connect
  // to the FanOut node instead of individual upstream stages.
  const groupMemberIds = new Set<string>();
  for (const [, groupStages] of groupMap) {
    for (const s of groupStages) groupMemberIds.add(s.id);
  }

  const connections = stages
    .flatMap((stage) => {
      // Skip group members — their connections are generated above
      if (groupMemberIds.has(stage.id)) {
        // Member requires point to FanOut (already connected)
        // But we still need to connect upstream deps to the FanOut
        return [...stage.requires].sort(compareCanonicalStrings).map((required) => ({
          id: `stage:${required}->fanout:${(stage as Readonly<{ parallelGroup?: string }>).parallelGroup}`,
          from: { node: `stage:${required}`, port: 'done' },
          to: { node: `fanout:${(stage as Readonly<{ parallelGroup?: string }>).parallelGroup}`, port: 'start' },
        }));
      }
      // Non-member stages: if they require a group member, rewrite to Join
      return [...stage.requires].sort(compareCanonicalStrings).map((required) => {
        if (groupMemberIds.has(required)) {
          const groupName = stages.find((s) => s.id === required)?.parallelGroup;
          return {
            id: `join:${groupName}-join->stage:${stage.id}`,
            from: { node: `join:${groupName}-join`, port: 'done' },
            to: { node: `stage:${stage.id}`, port: 'start' },
          };
        }
        return {
          id: `stage:${required}->stage:${stage.id}`,
          from: { node: `stage:${required}`, port: 'done' },
          to: { node: `stage:${stage.id}`, port: 'start' },
        };
      });
    })
    .concat(groupConnections);

  // Deduplicate by connection id: multiple group members sharing the same
  // upstream (e.g. 6 expert stages all requiring `apply`) produce identical
  // upstream→FanOut connections; downstream stages requiring multiple group
  // members produce identical Join→stage connections. Dedup keeps the
  // connection list canonical.
  const dedupConnections = [
    ...new Map(connections.map((conn) => [conn.id, conn])).values(),
  ].sort((left, right) => compareCanonicalStrings(left.id, right.id));

  return {
    version: ECP_DEFINITION_VERSION,
    id: `legacy:${pipeline.name}`,
    sourceId: `legacy:${pipeline.name}`,
    name: pipeline.name,
    ...(pipeline.description ? { description: pipeline.description } : {}),
    inputs: [],
    artifacts: [],
    outcomes: ['done'],
    declarations,
    root: {
      nodes,
      connections: dedupConnections,
    },
    legacyRuntime: {
      owner: 'prompt-owned-v1',
      authoredVersion: 1,
    },
    legacyPolicy: {
      ...(pipeline.agents ? { agents: pipeline.agents } : {}),
      ...(pipeline.handoff ? { handoff: pipeline.handoff } : {}),
      ...(pipeline.reuse ? { reuse: pipeline.reuse } : {}),
      ...(pipeline.origin ? { origin: pipeline.origin } : {}),
    },
  };
}

function prepare(source: DefinitionSource, catalog: CapabilityCatalogSnapshot): DefinitionPreparationResult {
  let sourceValue: unknown = source;
  if (typeof sourceValue === 'string') {
    try {
      sourceValue = parsePipelineSourceDocument(sourceValue);
    } catch (error) {
      return invalidSource(
        `Pipeline Definition syntax could not be parsed: ${error instanceof Error ? error.message : String(error)}.`
      );
    }
  }
  if (!isObject(sourceValue)) {
    return invalidSource('Pipeline Definition source must be an object.');
  }
  const explicitVersion = sourceValue.version;
  if (
    explicitVersion !== undefined &&
    explicitVersion !== 1 &&
    explicitVersion !== ECP_DEFINITION_VERSION
  ) {
    return {
      ok: false,
      error: new DefinitionReadError([
        diagnostic(
          'UNSUPPORTED_VERSION',
          '/version',
          `Unsupported Pipeline Definition version: received ${JSON.stringify(explicitVersion)}; supported versions are 1 and 2; upgrade to a compatible Rasen version before using this definition.`
        ),
      ], structuredClone(sourceValue)),
    };
  }

  let authoredVersion: 1 | 2;
  let authoredSource: PipelineYaml | DefinitionSourceV2;
  let definition: DefinitionSourceV2;
  if (explicitVersion === ECP_DEFINITION_VERSION) {
    authoredVersion = 2;
    const parsed = readV2Source(sourceValue);
    if (!parsed.ok) {
      return {
        ok: false,
        error: new DefinitionReadError(
          parsed.error.diagnostics,
          structuredClone(sourceValue)
        ),
      };
    }
    authoredSource = structuredClone(parsed.value);
    const diagnostics = [
      ...parsed.diagnostics,
      ...validateIdentitiesAndReferences(parsed.value),
      ...validateGraphCycles(parsed.value),
      ...validateCompositeRecursion(parsed.value),
      ...validateLoopsAndLimits(parsed.value, catalog),
      ...validateCapabilities(parsed.value, catalog),
      ...validateTypedPorts(parsed.value, catalog),
      ...validateOwnerTerminalOutcomes(parsed.value, catalog),
    ];
    if (diagnostics.length > 0) {
      return {
        ok: false,
        error: new DefinitionReadError(
          orderDefinitionDiagnostics(diagnostics),
          structuredClone(sourceValue)
        ),
      };
    }
    definition = normalizeV2Definition(parsed.value);
  } else {
    authoredVersion = 1;
    const parsed = PipelineYamlSchema.safeParse(sourceValue);
    if (!parsed.success) {
      const diagnostics = parsed.error.issues.map((issue) =>
        diagnostic(
          'INVALID_SOURCE',
          issue.path.length > 0 ? `/${issue.path.join('/')}` : '/',
          issue.message
        )
      );
      return {
        ok: false,
        error: new DefinitionReadError(
          orderDefinitionDiagnostics(diagnostics),
          structuredClone(sourceValue)
        ),
      };
    }
    const diagnostics = [
      ...validateLegacyPipelineDefinition(parsed.data).map((item) =>
        diagnostic(item.code, item.path, item.message, item.related)
      ),
    ];
    if (diagnostics.length > 0) {
      return {
        ok: false,
        error: new DefinitionReadError(
          orderDefinitionDiagnostics(diagnostics),
          structuredClone(sourceValue)
        ),
      };
    }
    authoredSource = structuredClone(parsed.data);
    definition = normalizeV1(parsed.data);
  }

  const frozenAuthoredSource = deepFreeze(authoredSource);
  const frozenDefinition = deepFreeze(structuredClone(definition));
  const relevantDescriptors = relevantCapabilityDescriptors(frozenDefinition, catalog);
  const sealedPlan = sealDefinitionPlan(
    frozenDefinition,
    catalog.version,
    relevantDescriptors
  );
  const warnings = authoredVersion === 1
    ? orderDefinitionDiagnostics([
        {
          severity: 'warning',
          code: 'LEGACY_NORMALIZED',
          path: '/version',
          message:
            'Legacy Pipeline Definition v1 was normalized for planning; its authored source and prompt-owned execution remain unchanged.',
        },
      ])
    : [];
  // D4 migration: a v1 definition whose normalized form contains a
  // ReviewCycle BoundedLoop is executable via the reconciler. This makes
  // `bug-fix` (verifyPolicy: 'adaptive') and `small-feature` (review-loop)
  // route through the same ReviewCycle body as authored v2 definitions.
  const v2Executable = supportsV2ExecutableRuntime(frozenDefinition);

  return deepFreeze({
    ok: true,
    value: {
      authoredVersion,
      normalizedVersion: ECP_DEFINITION_VERSION,
      authoredSource: frozenAuthoredSource,
      definition: frozenDefinition,
      warnings,
      plan: sealedPlan.plan,
      digests: {
        source: sealedPlan.sourceDigest,
        capability: sealedPlan.capabilityDigest,
        plan: sealedPlan.planDigest,
      },
      capability: v2Executable
        ? {
            definitionValid: true,
            planAvailable: true,
            executable: true,
            executionMode: 'reconciler' as const,
          }
        : authoredVersion === 1
          ? {
              definitionValid: true,
              planAvailable: true,
              executable: true,
              executionMode: 'legacy' as const,
            }
          : {
              definitionValid: true,
              planAvailable: true,
              executable: false,
              executionMode: 'unavailable' as const,
              unavailableReason: V2_RUNTIME_UNAVAILABLE_REASON,
            },
    },
  });
}

export const EcpDefinitionModule = deepFreeze({ prepare });
