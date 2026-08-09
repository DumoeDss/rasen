import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { DEFAULT_SCHEMA, WORKSPACE_DIR_NAME } from '../../config.js';
import { ChangeMetadataSchema, type ChangeMetadata } from '../../change-metadata/index.js';
import { validateSchemaName } from '../../../utils/change-metadata.js';
import { validateChangeName } from '../../../utils/change-utils.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  parseChangeId,
  parseChangeInstanceId,
  parseProjectId,
  parseStoreProjectCatalogV2,
  parseStoreTargetLineCatalogV1,
  parseTargetLineId,
  resolveStorePlanningLayoutV2Path,
  type PlanningScopeId,
  type StoreProjectCatalogV2,
  type StoreTargetLineCatalogV1,
  type VerifiedChangeInstanceId,
} from '../../store/planning-foundation.js';
import {
  parseStoreMetadataState,
  validateStoreSelector,
  type StoreMetadataState,
  type RegistryEntryType,
} from '../../store/foundation.js';
import { normalizeStoreUid, storeUidsMatch } from '../../store/identity-types.js';
import { formatProjectIdentityAmbiguity } from '../../project-registry.js';
import { normalizeProjectIdentity } from '../../store/project-records.js';
import { RuntimeContextSchema } from '../../session-runtime-context.js';
import { readChangeMetadata } from '../../../utils/change-metadata.js';
import { asPlanningScopeError, PlanningScopeError } from '../diagnostics.js';
import type {
  ChangeCreationScope,
  ChangeFinalizationScope,
  ChangeSelector,
  CreateScopedChangeInput,
  OpenChangeCreation,
  OpenChangeFinalization,
  OpenPlanningScope,
  OpenProjectRead,
  OpenStoreRead,
  PlanningAddressKind,
  PlanningNotice,
  PlanningPathFlavor,
  PlanningScopeDescription,
  PlanningScopeSource,
  PlanningSelection,
  ProjectReadAddress,
  ProjectReadScope,
  ResolvedOpenSpecRootReadProjection,
  ScopeEvidence,
  ScopedAuthoredChange,
  ScopedReadChange,
  ScopedReadLocation,
  OpenStoreIssue,
  PlanningIntent,
  StablePlanningRef,
  StoreAggregateReadScope,
  StoreAggregateRef,
  StoreIssueAddress,
  StoreIssueScope,
  StorePlanning,
  StoreProjectAuthoringRef,
  StoreProjectRef,
  StoreReadAddress,
} from '../types.js';
import type { ChangeBindingInput } from '../../store/workspace/index.js';
import type {
  CheckoutRole,
  ProjectRegistrySnapshotEntry,
  StorePlanningDependencies,
  StorePlanningFileIdentity,
  StoreRegistrySnapshotEntry,
} from './dependencies.js';

interface LooseProjectConfig {
  readonly schema?: string;
  readonly projectId?: string;
  readonly store?: string | { readonly uid?: string; readonly id?: string };
}

interface AssociationFact {
  readonly storeUid?: string;
  readonly storeId?: string;
  readonly projectId?: string;
  readonly targetLineId?: string;
  readonly planningWorktree?: string;
  readonly executionRoot?: string;
  /**
   * The Change this checkout's binding records as FINALIZED, written inside the
   * archive transaction by `store-finalization-outcomes-v2`. It is deliberately
   * not scope evidence — the Store, project, and target line are unchanged by a
   * finalization — but it must be admitted, because refusing it would make
   * every command run from an execution checkout fail after its Change is
   * archived.
   */
  readonly finalizedChangeId?: string;
}

interface StoreState {
  readonly id: string;
  readonly uid?: string;
  readonly registeredRoot: string;
  readonly planningRoot: string;
  readonly metadata: StoreMetadataState;
  readonly metadataText: string;
  readonly checkoutRole: CheckoutRole;
}

interface ProjectCatalogEntry {
  readonly catalog: StoreProjectCatalogV2;
  readonly text: string;
  readonly path: string;
}

interface BrokenProjectCatalog {
  readonly path: string;
  readonly reason: string;
}

interface ProjectCatalogRead {
  readonly entries: readonly ProjectCatalogEntry[];
  readonly broken: readonly BrokenProjectCatalog[];
}

interface ReducedFacts {
  storeUid?: string;
  storeId?: string;
  projectId?: string;
  targetLineId?: string;
  planningRoot?: string;
  executionRoot?: string;
}

interface FactCandidate extends ReducedFacts {
  readonly source: PlanningScopeSource;
}

interface InternalResolved {
  readonly input: OpenPlanningScope;
  readonly description: PlanningScopeDescription;
  readonly ref: StablePlanningRef;
  readonly fingerprint: string;
  readonly flavor: PlanningPathFlavor;
  readonly pathApi: path.PlatformPath;
  readonly splitTruth: boolean;
  readonly planningWorktreeVerified: boolean;
  readonly projectConfig: LooseProjectConfig | null;
  readonly projectConfigPath?: string;
  readonly projectRoot?: string;
  readonly store?: StoreState;
  readonly projectCatalog?: StoreProjectCatalogV2;
  readonly targetLineCatalog?: StoreTargetLineCatalogV1;
}

const CAPABILITY = Symbol('StorePlanningCapability');
const LOCATION = Symbol('ScopedReadLocation');
const PUBLICATION_OWNER_FILENAME = '.rasen-publish-owner';

interface PublishedChangeOwnership {
  readonly targetIdentity: StorePlanningFileIdentity;
  readonly entries: ReadonlyMap<string, StorePlanningFileIdentity>;
}

function pathApi(flavor: PlanningPathFlavor): path.PlatformPath {
  if (flavor === 'win32') return path.win32;
  if (flavor === 'posix') return path.posix;
  return path;
}

function normalizePathForComparison(value: string, flavor: PlanningPathFlavor): string {
  const api = pathApi(flavor);
  const resolved = api.resolve(value);
  return flavor === 'win32' || (flavor === 'native' && process.platform === 'win32')
    ? resolved.toLowerCase()
    : resolved;
}

function freeze<T>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function fingerprint(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

function sameFileIdentity(
  left: StorePlanningFileIdentity | null,
  right: StorePlanningFileIdentity
): boolean {
  return left !== null && left.dev === right.dev && left.ino === right.ino;
}

interface StoreCheckoutIdentity {
  readonly id: string;
  readonly uid?: string;
}

/**
 * Identity of a Store checkout, for comparison only. Unreadable or malformed
 * metadata yields no identity, which can only make a checkout fail to match —
 * it never becomes a redirect. The strict parse stays where the metadata is
 * actually consumed (`loadStore`).
 */
function readStoreIdentityLeniently(text: string | null): StoreCheckoutIdentity | null {
  if (text === null) return null;
  try {
    const metadata = parseStoreMetadataState(text);
    const uid = metadata.version === 2 ? normalizeStoreUid(metadata.uid) : undefined;
    return freeze({ id: metadata.id, ...(uid === undefined ? {} : { uid }) });
  } catch {
    return null;
  }
}

function storeEntryMatchesIdentity(
  entry: StoreRegistrySnapshotEntry,
  identity: StoreCheckoutIdentity | null
): boolean {
  if (identity === null) return false;
  if (entry.uid !== undefined && identity.uid !== undefined) {
    return storeUidsMatch(entry.uid, identity.uid);
  }
  return entry.id === identity.id;
}

function readObject(text: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('must be a JSON object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `${label} is not a valid planning fact document: ${error instanceof Error ? error.message : String(error)}.`,
      { target: label, cause: error }
    );
  }
}

function optionalString(
  value: unknown,
  field: string,
  source: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `${source}.${field} must be a non-empty string.`,
      { target: `${source}.${field}` }
    );
  }
  return value;
}

function parseAssociation(text: string, source: string): AssociationFact {
  const value = readObject(text, source);
  const version = value.version;
  if (version !== 1) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `${source}.version must be 1.`,
      { target: `${source}.version` }
    );
  }
  // The allow-list is EXTENDED by enumerating each admitted field with its
  // reason, never relaxed to a prefix rule — that would keep the gate passing
  // while destroying the precision it exists for.
  const allowed = new Set([
    'version',
    'storeUid',
    'storeId',
    'projectId',
    'targetLineId',
    'planningWorktree',
    'executionRoot',
    // Written by the archive transaction's `association-finalized` phase
    // (`store-finalization-outcomes-v2` §8.2). Refusing it here would make
    // every subsequent command from this checkout fail with a selection
    // conflict the moment its Change is archived.
    'finalizedChange',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `${source} contains unsupported fields: ${unknown.sort().join(', ')}.`,
      { target: source }
    );
  }
  return freeze({
    ...(optionalString(value.storeUid, 'storeUid', source) === undefined
      ? {}
      : { storeUid: optionalString(value.storeUid, 'storeUid', source) }),
    ...(optionalString(value.storeId, 'storeId', source) === undefined
      ? {}
      : { storeId: optionalString(value.storeId, 'storeId', source) }),
    ...(optionalString(value.projectId, 'projectId', source) === undefined
      ? {}
      : { projectId: optionalString(value.projectId, 'projectId', source) }),
    ...(optionalString(value.targetLineId, 'targetLineId', source) === undefined
      ? {}
      : { targetLineId: optionalString(value.targetLineId, 'targetLineId', source) }),
    ...(optionalString(value.planningWorktree, 'planningWorktree', source) === undefined
      ? {}
      : { planningWorktree: optionalString(value.planningWorktree, 'planningWorktree', source) }),
    ...(optionalString(value.executionRoot, 'executionRoot', source) === undefined
      ? {}
      : { executionRoot: optionalString(value.executionRoot, 'executionRoot', source) }),
    // Read but NOT treated as scope evidence: a finalization changes no Store,
    // project, or target line, and the archived Change is no longer an active
    // one to select.
    ...(finalizedChangeId(value.finalizedChange) === undefined
      ? {}
      : { finalizedChangeId: finalizedChangeId(value.finalizedChange) }),
  });
}

function finalizedChangeId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const changeId = (value as { changeId?: unknown }).changeId;
  return typeof changeId === 'string' && changeId.length > 0 ? changeId : undefined;
}

function parseLooseProjectConfig(text: string, source: string): LooseProjectConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `Cannot parse project planning configuration at ${source}.`,
      { target: source, cause: error }
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `Project planning configuration at ${source} must be an object.`,
      { target: source }
    );
  }
  const value = raw as Record<string, unknown>;
  const schema = optionalString(value.schema, 'schema', source);
  const projectId = optionalString(value.projectId, 'projectId', source);
  let store: LooseProjectConfig['store'];
  if (typeof value.store === 'string' && value.store.length > 0) {
    store = value.store;
  } else if (typeof value.store === 'object' && value.store !== null && !Array.isArray(value.store)) {
    const declaration = value.store as Record<string, unknown>;
    const uid = optionalString(declaration.uid, 'uid', `${source}.store`);
    const id = optionalString(declaration.id, 'id', `${source}.store`);
    if (!uid && !id) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `${source}.store must carry uid or id.`,
        { target: `${source}.store` }
      );
    }
    store = freeze({ ...(uid ? { uid } : {}), ...(id ? { id } : {}) });
  } else if (value.store !== undefined) {
    throw new PlanningScopeError(
      'planning_selection_conflict',
      `${source}.store must be a non-empty alias or durable Store reference.`,
      { target: `${source}.store` }
    );
  }
  return freeze({
    ...(schema === undefined ? {} : { schema }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(store === undefined ? {} : { store }),
  });
}

function selectedStoreMatches(
  entry: StoreRegistrySnapshotEntry,
  selector: string
): boolean {
  return entry.type === 'store' &&
    (entry.id === selector || (entry.uid !== undefined && storeUidsMatch(entry.uid, selector)));
}

function registeredProjectMatches(
  entry: StoreRegistrySnapshotEntry,
  selector: string
): boolean {
  return entry.type === 'project' && entry.id === selector;
}

function projectRegistryMatches(
  candidate: ProjectRegistrySnapshotEntry,
  selector: string,
  flavor: PlanningPathFlavor
): boolean {
  return normalizeProjectIdentity(candidate.entry.projectId) ===
    normalizeProjectIdentity(selector) ||
    candidate.entry.name === selector ||
    (pathApi(flavor).isAbsolute(selector) &&
      normalizePathForComparison(candidate.root, flavor) ===
        normalizePathForComparison(selector, flavor));
}

function primarySource(evidence: readonly ScopeEvidence[]): PlanningScopeSource {
  const order: readonly PlanningScopeSource[] = [
    'explicit',
    'session',
    'execution-association',
    'planning-worktree-marker',
    'project-binding',
    'nearest-standalone',
  ];
  return order.find((source) => evidence.some((item) => item.source === source)) ??
    'nearest-standalone';
}

/**
 * The intents that address a STORE rather than one project. Both resolve a
 * Store aggregate and neither may be refused for having no project selected.
 * `store-issue` additionally tolerates a project-shaped resolution, which
 * `resolve` handles separately.
 */
function isStoreLevelIntent(intent: PlanningIntent): boolean {
  return intent === 'store-read' || intent === 'store-issue';
}

function followupSelection(ref: StablePlanningRef): PlanningSelection {
  if (ref.mode === 'standalone') return freeze({});
  if (ref.mode === 'legacy-store' || ref.mode === 'store-aggregate') {
    return freeze({ store: ref.storeUid ?? ref.storeId });
  }
  return freeze({
    store: ref.storeUid,
    project: ref.projectId,
    ...(ref.targetLineId === undefined ? {} : { targetLine: ref.targetLineId }),
  });
}

export class StorePlanningResolver implements StorePlanning {
  constructor(private readonly dependencies: StorePlanningDependencies) {}

  open(input: OpenStoreRead): Promise<StoreAggregateReadScope>;
  open(input: OpenProjectRead): Promise<ProjectReadScope>;
  open(input: OpenChangeCreation): Promise<ChangeCreationScope>;
  open(input: OpenChangeFinalization): Promise<ChangeFinalizationScope>;
  open(input: OpenStoreIssue): Promise<StoreIssueScope>;
  async open(
    input: OpenPlanningScope
  ): Promise<
    | StoreAggregateReadScope
    | ProjectReadScope
    | ChangeCreationScope
    | ChangeFinalizationScope
    | StoreIssueScope
  > {
    try {
      const resolved = await this.resolve(input);
      // Every intent is dispatched EXPLICITLY. The fallback below is
      // `create-change` and nothing else, so a new intent added to the union
      // without an arm here would silently authorize Change creation; the
      // exhaustive check keeps that from compiling.
      switch (input.intent) {
        case 'store-read':
          return this.aggregateCapability(resolved);
        case 'store-issue':
          return this.issueCapability(resolved);
        case 'project-read':
          return this.readCapability(resolved);
        case 'finalize-change':
          return this.finalizationCapability(resolved, input.change);
        case 'create-change':
          return this.creationCapability(resolved);
        default: {
          const unreachable: never = input;
          throw new PlanningScopeError(
            'invalid_start_path',
            `Unknown planning intent: ${JSON.stringify(unreachable)}.`,
            { target: 'intent' }
          );
        }
      }
    } catch (error) {
      throw asPlanningScopeError(error);
    }
  }

  private async canonicalStart(
    startPath: string,
    flavor: PlanningPathFlavor
  ): Promise<string> {
    const api = pathApi(flavor);
    if (!api.isAbsolute(startPath)) {
      throw new PlanningScopeError(
        'invalid_start_path',
        `StorePlanning.open requires an absolute startPath; received '${startPath}'.`,
        { target: 'startPath' }
      );
    }
    if (flavor !== 'native') return api.resolve(startPath);
    const kind = await this.dependencies.fs.statKind(startPath);
    const directory = kind === 'file' ? api.dirname(startPath) : startPath;
    if (kind === 'absent') return api.resolve(directory);
    return this.dependencies.fs.canonicalizeExisting(directory);
  }

  private async findAncestor(
    startPath: string,
    flavor: PlanningPathFlavor,
    predicate: (candidate: string) => Promise<boolean>
  ): Promise<string | null> {
    const api = pathApi(flavor);
    let current = startPath;
    while (true) {
      if (await predicate(current)) return current;
      const parent = api.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }

  private async findProjectRoot(
    startPath: string,
    flavor: PlanningPathFlavor
  ): Promise<string | null> {
    const api = pathApi(flavor);
    return this.findAncestor(startPath, flavor, async (candidate) => {
      const rasen = api.join(candidate, WORKSPACE_DIR_NAME);
      if ((await this.dependencies.fs.statKind(rasen)) !== 'directory') return false;
      return (
        (await this.dependencies.fs.statKind(api.join(rasen, 'config.yaml'))) === 'file' ||
        (await this.dependencies.fs.statKind(api.join(rasen, 'config.yml'))) === 'file' ||
        (await this.dependencies.fs.statKind(api.join(rasen, 'changes'))) === 'directory' ||
        (await this.dependencies.fs.statKind(api.join(rasen, 'specs'))) === 'directory'
      );
    });
  }

  private async findStoreRoot(
    startPath: string,
    flavor: PlanningPathFlavor
  ): Promise<string | null> {
    const api = pathApi(flavor);
    return this.findAncestor(startPath, flavor, async (candidate) =>
      (await this.dependencies.fs.statKind(
        api.join(candidate, '.rasen-store', 'store.yaml')
      )) === 'file'
    );
  }

  private async projectConfig(
    projectRoot: string,
    api: path.PlatformPath
  ): Promise<{ config: LooseProjectConfig | null; path?: string; text?: string }> {
    const candidates = [
      api.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yaml'),
      api.join(projectRoot, WORKSPACE_DIR_NAME, 'config.yml'),
    ];
    for (const candidate of candidates) {
      const text = await this.dependencies.fs.readText(candidate);
      if (text !== null) {
        return { config: parseLooseProjectConfig(text, candidate), path: candidate, text };
      }
    }
    return { config: null };
  }

  private async hasLocalPlanning(projectRoot: string, api: path.PlatformPath): Promise<boolean> {
    return (
      (await this.dependencies.fs.statKind(
        api.join(projectRoot, WORKSPACE_DIR_NAME, 'changes')
      )) === 'directory' ||
      (await this.dependencies.fs.statKind(
        api.join(projectRoot, WORKSPACE_DIR_NAME, 'specs')
      )) === 'directory'
    );
  }

  private selectStoreEntry(
    entries: readonly StoreRegistrySnapshotEntry[],
    selector: string
  ): StoreRegistrySnapshotEntry {
    const matches = entries.filter((entry) => selectedStoreMatches(entry, selector));
    if (matches.length > 1) {
      throw new PlanningScopeError(
        'store_alias_ambiguous',
        `Store selector '${selector}' matches more than one Store. Use a permanent Store UID.`,
        { target: 'selection.store' }
      );
    }
    const selected = matches[0];
    if (!selected) {
      throw new PlanningScopeError(
        'unknown_store',
        `Unknown Store '${selector}'.`,
        { target: 'selection.store', fix: 'Run rasen store list --json.' }
      );
    }
    return selected;
  }

  private storeEntryForDeclaration(
    entries: readonly StoreRegistrySnapshotEntry[],
    declaration: NonNullable<LooseProjectConfig['store']>
  ): StoreRegistrySnapshotEntry {
    const selector = typeof declaration === 'string'
      ? declaration
      : declaration.uid ?? declaration.id as string;
    const entry = this.selectStoreEntry(entries, selector);
    if (
      typeof declaration !== 'string' &&
      declaration.id !== undefined &&
      entry.id !== declaration.id
    ) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `Project Store declaration id '${declaration.id}' does not match Store '${entry.id}'.`,
        { target: 'project.store' }
      );
    }
    return entry;
  }

  private async loadStore(
    entry: StoreRegistrySnapshotEntry,
    planningRoot: string,
    api: path.PlatformPath
  ): Promise<StoreState> {
    const metadataPath = api.join(planningRoot, '.rasen-store', 'store.yaml');
    const metadataText = await this.dependencies.fs.readText(metadataPath);
    if (metadataText === null) {
      throw new PlanningScopeError(
        'invalid_store_metadata',
        `Store '${entry.id}' has no metadata at ${metadataPath}.`,
        { target: metadataPath }
      );
    }
    const metadata = parseStoreMetadataState(metadataText);
    if (metadata.id !== entry.id) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `Store metadata id '${metadata.id}' does not match registry alias '${entry.id}'.`,
        { target: metadataPath }
      );
    }
    const uid = metadata.version === 2 ? normalizeStoreUid(metadata.uid) : entry.uid;
    if (entry.uid !== undefined && uid !== undefined && !storeUidsMatch(entry.uid, uid)) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `Store metadata UID does not match the selected registry entry.`,
        { target: metadataPath }
      );
    }
    return freeze({
      id: entry.id,
      ...(uid === undefined ? {} : { uid }),
      registeredRoot: entry.root,
      planningRoot,
      metadata,
      metadataText,
      checkoutRole: this.dependencies.checkoutRole(planningRoot),
    });
  }

  private canonicalizeFactPath(
    value: string,
    flavor: PlanningPathFlavor
  ): string {
    return flavor === 'native'
      ? this.dependencies.fs.canonicalizeExisting(value)
      : value;
  }

  private mergeFacts(
    candidates: readonly FactCandidate[],
    flavor: PlanningPathFlavor
  ): { facts: ReducedFacts; evidence: readonly ScopeEvidence[] } {
    const facts: ReducedFacts = {};
    const owners = new Map<keyof ReducedFacts, PlanningScopeSource>();
    const evidence: ScopeEvidence[] = [];
    const comparisons: Record<keyof ReducedFacts, (left: string, right: string) => boolean> = {
      storeUid: (left, right) => storeUidsMatch(left, right),
      storeId: (left, right) => left === right,
      projectId: (left, right) => left === right,
      targetLineId: (left, right) => left === right,
      planningRoot: (left, right) =>
        normalizePathForComparison(left, flavor) === normalizePathForComparison(right, flavor),
      executionRoot: (left, right) =>
        normalizePathForComparison(left, flavor) === normalizePathForComparison(right, flavor),
    };
    const evidenceField: Record<keyof ReducedFacts, ScopeEvidence['field']> = {
      storeUid: 'store',
      storeId: 'store',
      projectId: 'project',
      targetLineId: 'target-line',
      planningRoot: 'planning-root',
      executionRoot: 'execution-root',
    };
    for (const candidate of candidates) {
      for (const field of Object.keys(comparisons) as Array<keyof ReducedFacts>) {
        const rawIncoming = candidate[field];
        if (rawIncoming === undefined) continue;
        const incoming =
          field === 'planningRoot' || field === 'executionRoot'
            ? this.canonicalizeFactPath(rawIncoming, flavor)
            : rawIncoming;
        const existing = facts[field];
        if (existing !== undefined && !comparisons[field](existing, incoming)) {
          throw new PlanningScopeError(
            'planning_selection_conflict',
            `${candidate.source} ${field} '${incoming}' conflicts with ${owners.get(field)} '${existing}'.`,
            {
              target: `selection.${field}`,
              details: freeze({
                field,
                strongerSource: owners.get(field),
                strongerValue: existing,
                conflictingSource: candidate.source,
                conflictingValue: incoming,
              }),
            }
          );
        }
        if (existing === undefined) {
          facts[field] = incoming;
          owners.set(field, candidate.source);
        }
        evidence.push(freeze({
          source: candidate.source,
          field: evidenceField[field],
          value: incoming,
        }));
      }
    }
    const sorted = evidence.sort((left, right) =>
      left.source.localeCompare(right.source) ||
      left.field.localeCompare(right.field) ||
      left.value.localeCompare(right.value)
    );
    return { facts, evidence: freeze(sorted) };
  }

  private async readSessionFact(
    flavor: PlanningPathFlavor
  ): Promise<FactCandidate | null> {
    const contextPath = this.dependencies.sessionContextPath();
    if (!contextPath) return null;
    const text = await this.dependencies.fs.readText(contextPath);
    if (text === null) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `Session context ${contextPath} is unavailable; scope fallback is forbidden.`,
        { target: contextPath }
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `Session context ${contextPath} is invalid JSON.`,
        { target: contextPath, cause: error }
      );
    }
    const parsed = RuntimeContextSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `Session context ${contextPath} is invalid.`,
        { target: contextPath, cause: parsed.error }
      );
    }
    const context = parsed.data;
    // A frozen worktree is USED, not re-derived. When the live worktree
    // disagrees — removed, moved, or switched to another ref — the command
    // fails naming both values instead of continuing in whatever the working
    // directory happens to resolve to.
    await this.assertFrozenWorktreeStillLive(
      context.planning.worktree,
      'session planning worktree',
      contextPath
    );
    if (context.execution.kind === 'project') {
      await this.assertFrozenWorktreeStillLive(
        context.execution.worktree,
        'session execution worktree',
        contextPath
      );
    }
    return freeze({
      source: 'session' as const,
      ...(context.planning.type === 'store'
        ? {
            ...(context.planning.uid === undefined ? {} : { storeUid: context.planning.uid }),
            ...(context.planning.id === undefined ? {} : { storeId: context.planning.id }),
            ...(context.planning.projectId === undefined
              ? {}
              : { projectId: context.planning.projectId }),
            ...(context.planning.targetLineId === undefined
              ? {}
              : { targetLineId: context.planning.targetLineId }),
            planningRoot: pathApi(flavor).resolve(context.planning.root),
          }
        : {
            projectId: context.planning.projectId,
            planningRoot: pathApi(flavor).resolve(context.planning.root),
          }),
      ...(context.execution.kind === 'project'
        ? {
            projectId: context.execution.projectId,
            executionRoot: pathApi(flavor).resolve(context.execution.root),
          }
        : {}),
    });
  }

  /**
   * Fails closed when a worktree the session froze no longer is that worktree.
   * A frozen side with no recorded worktree is simply not checked — absence is
   * an explicit state, and a mutation that needs the pair refuses separately on
   * that absence rather than on a fabricated comparison.
   */
  private async assertFrozenWorktreeStillLive(
    frozen: { root: string; worktreeInstanceId: string; ref?: string } | undefined,
    label: string,
    contextPath: string
  ): Promise<void> {
    if (frozen === undefined) return;
    const probe = await this.dependencies.probePlanningWorktree({
      planningRoot: frozen.root,
    });
    if (!probe.isWorktree || probe.worktreeInstanceId === undefined) {
      throw new PlanningScopeError(
        'planning_execution_binding_mismatch',
        `The ${label} frozen by this session (${frozen.root}) is no longer a worktree on this machine.`,
        {
          target: contextPath,
          fix: 'End the session and start a new one; a session never falls back to the working directory.',
          details: freeze({
            frozenRoot: frozen.root,
            frozenWorktreeInstanceId: frozen.worktreeInstanceId,
            liveWorktreeInstanceId: null,
          }),
        }
      );
    }
    if (probe.worktreeInstanceId !== frozen.worktreeInstanceId) {
      throw new PlanningScopeError(
        'planning_execution_binding_mismatch',
        `The ${label} frozen by this session (${frozen.root}) no longer re-derives its recorded worktree identity.`,
        {
          target: contextPath,
          fix: 'End the session and start a new one.',
          details: freeze({
            frozenWorktreeInstanceId: frozen.worktreeInstanceId,
            liveWorktreeInstanceId: probe.worktreeInstanceId,
          }),
        }
      );
    }
    if (frozen.ref !== undefined && probe.ref !== frozen.ref) {
      throw new PlanningScopeError(
        'planning_execution_binding_mismatch',
        `The ${label} frozen by this session (${frozen.root}) is on '${probe.ref ?? '(detached HEAD)'}', not the frozen '${frozen.ref}'.`,
        {
          target: contextPath,
          fix: `Switch it back to ${frozen.ref}, or end the session and start a new one.`,
          details: freeze({ frozenRef: frozen.ref, liveRef: probe.ref ?? null }),
        }
      );
    }
  }

  private async readAssociationFact(
    projectRoot: string | null,
    api: path.PlatformPath,
    flavor: PlanningPathFlavor
  ): Promise<{ candidate: FactCandidate; text: string } | null> {
    if (!projectRoot) return null;
    const associationPath = api.join(projectRoot, '.rasen', 'planning-binding.json');
    const text = await this.dependencies.fs.readText(associationPath);
    if (text === null) return null;
    const fact = parseAssociation(text, associationPath);
    return {
      text,
      candidate: freeze({
        source: 'execution-association' as const,
        ...(fact.storeUid === undefined ? {} : { storeUid: fact.storeUid }),
        ...(fact.storeId === undefined ? {} : { storeId: fact.storeId }),
        ...(fact.projectId === undefined ? {} : { projectId: fact.projectId }),
        ...(fact.targetLineId === undefined ? {} : { targetLineId: fact.targetLineId }),
        ...(fact.planningWorktree === undefined
          ? {}
          : {
              planningRoot: this.canonicalizeFactPath(
                api.resolve(fact.planningWorktree),
                flavor
              ),
            }),
        executionRoot: this.canonicalizeFactPath(
          api.resolve(fact.executionRoot ?? projectRoot),
          flavor
        ),
      }),
    };
  }

  private async readMarkerFact(
    storeRoot: string | null,
    api: path.PlatformPath,
    flavor: PlanningPathFlavor
  ): Promise<{ candidate: FactCandidate; text: string } | null> {
    if (!storeRoot) return null;
    const markerPath = api.join(storeRoot, '.rasen', 'planning-line.json');
    const text = await this.dependencies.fs.readText(markerPath);
    if (text === null) return null;
    const fact = parseAssociation(text, markerPath);
    return {
      text,
      candidate: freeze({
        source: 'planning-worktree-marker' as const,
        ...(fact.storeUid === undefined ? {} : { storeUid: fact.storeUid }),
        ...(fact.storeId === undefined ? {} : { storeId: fact.storeId }),
        ...(fact.projectId === undefined ? {} : { projectId: fact.projectId }),
        ...(fact.targetLineId === undefined ? {} : { targetLineId: fact.targetLineId }),
        planningRoot: this.canonicalizeFactPath(api.resolve(storeRoot), flavor),
        ...(fact.executionRoot === undefined
          ? {}
          : {
              executionRoot: this.canonicalizeFactPath(
                api.resolve(fact.executionRoot),
                flavor
              ),
            }),
      }),
    };
  }

  /**
   * Read every project catalog, isolating faults per file. One unreadable
   * sibling must not disable every other project or the diagnostic surfaces
   * (doctor) whose job is to report a broken Store, so a file that cannot be
   * parsed becomes a reported `broken` entry carrying its own path instead of
   * a thrown error. The selected project is still fail-closed: see
   * `selectProjectCatalog`.
   */
  private async loadProjectCatalogs(
    storeRoot: string,
    api: path.PlatformPath
  ): Promise<ProjectCatalogRead> {
    const dir = api.join(storeRoot, '.rasen-store', 'projects');
    const entries: ProjectCatalogEntry[] = [];
    const broken: BrokenProjectCatalog[] = [];
    for (const name of await this.dependencies.fs.listNames(dir)) {
      if (!name.endsWith('.yaml')) continue;
      const filePath = api.join(dir, name);
      const text = await this.dependencies.fs.readText(filePath);
      if (text === null) continue;
      let catalog: StoreProjectCatalogV2;
      try {
        catalog = parseStoreProjectCatalogV2(text, filePath);
      } catch (error) {
        broken.push(freeze({
          path: filePath,
          reason: error instanceof Error ? error.message : String(error),
        }));
        continue;
      }
      if (name !== `${catalog.projectId}.yaml`) {
        broken.push(freeze({
          path: filePath,
          reason: `filename does not match projectId '${catalog.projectId}'`,
        }));
        continue;
      }
      entries.push(freeze({ catalog, text, path: filePath }));
    }
    // Canonical ordering so notices and diagnostics never depend on filesystem
    // enumeration order (design D10).
    entries.sort((left, right) => left.catalog.projectId.localeCompare(right.catalog.projectId));
    broken.sort((left, right) => left.path.localeCompare(right.path));
    return freeze({ entries: freeze(entries), broken: freeze(broken) });
  }

  private selectProjectCatalog(
    catalogs: ProjectCatalogRead,
    selector: string
  ): ProjectCatalogEntry {
    const matches = catalogs.entries.filter(
      ({ catalog }) => catalog.projectId === selector || catalog.id === selector
    );
    if (matches.length > 1) {
      throw new PlanningScopeError(
        'planning_selection_conflict',
        `Project selector '${selector}' is ambiguous in the selected Store. Use its permanent projectId.`,
        { target: 'selection.project' }
      );
    }
    const match = matches[0];
    if (!match) {
      // The selector may be recorded in a file that could not be parsed, so an
      // unreadable catalog is reported as itself rather than as "not in Store".
      const first = catalogs.broken[0];
      if (first) {
        throw new PlanningScopeError(
          'invalid_project_catalog',
          `Project catalog ${first.path} could not be read (${first.reason}); project '${selector}' cannot be resolved.`,
          { target: first.path, fix: `Repair or remove ${first.path}, then retry.` }
        );
      }
      throw new PlanningScopeError(
        'project_not_in_store',
        `Project '${selector}' is not in the selected Store's v2 catalog.`,
        { target: 'selection.project' }
      );
    }
    if (match.catalog.planningBinding.state !== 'bound' || !match.catalog.roles.planning) {
      throw new PlanningScopeError(
        'project_not_in_store',
        `Project '${selector}' is not planning-bound in the selected Store.`,
        { target: match.path }
      );
    }
    return match;
  }

  /**
   * Does the declared Store positively own this project's planning?
   *
   * Only a version 2 catalog entry recorded as `bound` with the planning role
   * transfers planning ownership (`store-config-inheritance`). Anything weaker
   * — a legacy flat Store, an absent catalog entry, membership without a bound
   * planning state — leaves planning local, which is configuration inheritance
   * rather than Store-owned truth. A bound entry beside a local planning tree
   * is split truth, not inheritance, and is handled by the caller.
   */
  private async storeClaimsProjectPlanning(
    store: StoreState,
    projectId: string | undefined,
    api: path.PlatformPath
  ): Promise<boolean> {
    if (store.metadata.layoutVersion !== 2 || projectId === undefined) return false;
    const catalogs = await this.loadProjectCatalogs(store.planningRoot, api);
    const match = catalogs.entries.find(
      ({ catalog }) => catalog.projectId === projectId || catalog.id === projectId
    );
    if (!match) {
      const first = catalogs.broken[0];
      if (first) {
        // An unreadable file could be this project's own record. Downgrading
        // Store-owned planning to local inheritance on unverifiable evidence
        // is exactly the fail-open this resolver exists to prevent.
        throw new PlanningScopeError(
          'invalid_project_catalog',
          `Project catalog ${first.path} could not be read (${first.reason}); the Store's planning claim on '${projectId}' cannot be verified.`,
          { target: first.path, fix: `Repair or remove ${first.path}, then retry.` }
        );
      }
      return false;
    }
    return match.catalog.planningBinding.state === 'bound' && match.catalog.roles.planning === true;
  }

  /**
   * A planning worktree is VERIFIED, not assumed.
   *
   * Marker presence used to be the whole gate. It now has to hold together:
   * the worktree must be a linked worktree of the selected Store repository
   * (the integration checkout is never authorized), its marker must declare the
   * resolved Store, project, AND target line, that target line must resolve to
   * an existing Store ref in this repository, and the worktree's identity must
   * re-derive from live Git. Each failure is reported by name, because
   * "unverified" with no reason is the diagnostic this gate used to give.
   *
   * A healthy hand-assembled pair satisfies every condition and keeps working;
   * an inconsistent one that used to pass now fails closed.
   */
  private async verifyPlanningWorktree(input: {
    readonly store: StoreState;
    readonly projectId: string;
    readonly targetLineId?: string;
    readonly targetLineCatalog?: StoreTargetLineCatalogV1;
    readonly marker?: FactCandidate;
  }): Promise<{ verified: boolean; findings: readonly string[] }> {
    const findings: string[] = [];
    if (input.targetLineId === undefined || input.targetLineCatalog === undefined) {
      findings.push('target_line_required');
      return { verified: false, findings: freeze(findings) };
    }
    if (input.store.checkoutRole !== 'linked-worktree') {
      findings.push(`checkout_role:${input.store.checkoutRole}`);
    }
    const marker = input.marker;
    if (marker === undefined) {
      findings.push('planning_marker_absent');
    } else {
      if (marker.storeUid === undefined && marker.storeId === undefined) {
        findings.push('planning_marker_declares_no_store');
      } else if (
        marker.storeUid !== undefined &&
        input.store.uid !== undefined &&
        !storeUidsMatch(marker.storeUid, input.store.uid)
      ) {
        findings.push('planning_marker_store_mismatch');
      }
      if (marker.projectId === undefined) {
        findings.push('planning_marker_declares_no_project');
      } else if (marker.projectId !== input.projectId) {
        findings.push('planning_marker_project_mismatch');
      }
      if (marker.targetLineId === undefined) {
        findings.push('planning_marker_declares_no_target_line');
      } else if (marker.targetLineId !== input.targetLineId) {
        findings.push('planning_marker_target_line_mismatch');
      }
    }

    const probe = await this.dependencies.probePlanningWorktree({
      planningRoot: input.store.planningRoot,
      storeRef: input.targetLineCatalog.storeRef,
    });
    if (!probe.isWorktree || probe.worktreeInstanceId === undefined) {
      findings.push('planning_worktree_identity_unavailable');
    }
    if (!probe.linked) findings.push('planning_worktree_not_linked');
    if (probe.storeRefOid === undefined) findings.push('target_line_store_ref_unresolved');

    return { verified: findings.length === 0, findings: freeze(findings) };
  }

  private async targetLineCatalog(
    storeRoot: string,
    targetLineId: string,
    projectId: string,
    api: path.PlatformPath
  ): Promise<{ catalog: StoreTargetLineCatalogV1; text: string; path: string }> {
    const parsedLine = parseTargetLineId(targetLineId);
    const filePath = resolveStorePlanningLayoutV2Path(
      storeRoot,
      { kind: 'target-line-catalog', targetLineId: parsedLine },
      api === path.win32 ? 'win32' : api === path.posix ? 'posix' : 'native'
    );
    const text = await this.dependencies.fs.readText(filePath);
    if (text === null) {
      throw new PlanningScopeError(
        'target_line_required',
        `Target line '${targetLineId}' is not present in the selected Store.`,
        { target: filePath }
      );
    }
    const catalog = parseStoreTargetLineCatalogV1(text, filePath);
    if (catalog.projects[projectId] === undefined) {
      throw new PlanningScopeError(
        'project_not_in_store',
        `Target line '${targetLineId}' has no code locator for project '${projectId}'.`,
        { target: filePath }
      );
    }
    return { catalog, text, path: filePath };
  }

  private async validateSelectedChange(
    ref: StablePlanningRef,
    selector: ChangeSelector,
    flavor: PlanningPathFlavor
  ): Promise<string | null> {
    const api = pathApi(flavor);
    const changeId = parseChangeId(selector.changeId);
    const changesDir = ref.mode === 'store-project'
      ? resolveStorePlanningLayoutV2Path(
          ref.storeRoot,
          { kind: 'active-change', projectId: ref.projectId, changeId },
          flavor
        )
      : api.join(
          ref.mode === 'standalone' ? ref.projectRoot : ref.storeRoot,
          WORKSPACE_DIR_NAME,
          'changes',
          changeId
        );
    const metadataPath = api.join(changesDir, '.openspec.yaml');
    const text = await this.dependencies.fs.readText(metadataPath);
    if (text === null) {
      if (selector.expectedInstanceId !== undefined) {
        throw new PlanningScopeError(
          'change_identity_mismatch',
          `Change '${changeId}' has no metadata for expected instance '${selector.expectedInstanceId}'.`,
          { target: metadataPath }
        );
      }
      return null;
    }
    let raw: unknown;
    try {
      raw = parseYaml(text);
    } catch (error) {
      throw new PlanningScopeError(
        'change_identity_mismatch',
        `Change '${changeId}' metadata is unreadable.`,
        { target: metadataPath, cause: error }
      );
    }
    const parsed = ChangeMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PlanningScopeError(
        'change_identity_mismatch',
        `Change '${changeId}' metadata is invalid for the selected scope.`,
        { target: metadataPath, cause: parsed.error }
      );
    }
    const identity = parsed.data.identity;
    if (ref.mode === 'store-project') {
      if (!identity) {
        throw new PlanningScopeError(
          'change_identity_mismatch',
          `Store v2 Change '${changeId}' has no portable v2 identity.`,
          { target: metadataPath }
        );
      }
      if (!ref.targetLineId) {
        throw new PlanningScopeError(
          'target_line_required',
          `Change '${changeId}' cannot supply target-line authority; select its stable target line independently.`,
          { target: 'selection.targetLine' }
        );
      }
      if (
        !storeUidsMatch(identity.storeUid, ref.storeUid) ||
        identity.projectId !== ref.projectId
      ) {
        throw new PlanningScopeError(
          'change_identity_mismatch',
          `Change '${changeId}' identity conflicts with the selected Store/project scope.`,
          { target: metadataPath }
        );
      }
      // A target line disagreement is its OWN refusal, named after the thing
      // that disagrees, and it names both lines: a Change's line is frozen at
      // creation and no weaker source re-points it.
      if (identity.targetLineId !== ref.targetLineId) {
        throw new PlanningScopeError(
          'target_line_mismatch',
          `Change '${changeId}' is frozen against target line '${identity.targetLineId}', but this command resolved '${ref.targetLineId}'.`,
          {
            target: metadataPath,
            fix: `Address the Change on its own line: --target-line ${identity.targetLineId}.`,
            details: freeze({
              frozenTargetLineId: identity.targetLineId,
              resolvedTargetLineId: ref.targetLineId,
            }),
          }
        );
      }
    } else if (identity) {
      throw new PlanningScopeError(
        'change_identity_mismatch',
        `Change '${changeId}' carries Store v2 identity outside a Store project scope.`,
        { target: metadataPath }
      );
    }
    if (
      selector.expectedInstanceId !== undefined &&
      selector.expectedInstanceId !== identity?.instanceId
    ) {
      throw new PlanningScopeError(
        'change_identity_mismatch',
        `Change '${changeId}' does not have expected instance '${selector.expectedInstanceId}'.`,
        { target: metadataPath }
      );
    }
    return text;
  }

  private async resolve(input: OpenPlanningScope): Promise<InternalResolved> {
    const flavor = input.pathFlavor ?? 'native';
    const api = pathApi(flavor);
    const startPath = await this.canonicalStart(input.startPath, flavor);
    if (input.selection?.store !== undefined) {
      validateStoreSelector(input.selection.store);
    }
    if (input.selection?.project !== undefined) {
      parseProjectId(input.selection.project, 'selection.project');
    }
    if (input.selection?.targetLine !== undefined) {
      parseTargetLineId(input.selection.targetLine, 'selection.targetLine');
    }
    const stores = await this.dependencies.snapshotStores(input.globalDataDir);
    const discoveredProjectRoot = await this.findProjectRoot(startPath, flavor);
    // An explicit Store selector chooses a remote planning namespace. The
    // unrelated cwd project is not binding evidence for that Store/project;
    // session or durable association facts still participate separately and
    // conflict when they actually claim the selected scope.
    const nearestProjectRoot = input.selection?.store === undefined
      ? discoveredProjectRoot
      : null;
    const nearestStoreRoot = await this.findStoreRoot(startPath, flavor);
    const projectConfigRead = nearestProjectRoot
      ? await this.projectConfig(nearestProjectRoot, api)
      : { config: null as LooseProjectConfig | null };
    const discoveredLocalPlanning = discoveredProjectRoot
      ? await this.hasLocalPlanning(discoveredProjectRoot, api)
      : false;
    const localPlanning = nearestProjectRoot !== null && discoveredLocalPlanning;

    let selectedProjectRoot: string | null = nearestProjectRoot;
    if (
      selectedProjectRoot === null &&
      input.intent === 'create-change' &&
      input.selection?.store === undefined &&
      input.selection?.project === undefined
    ) {
      selectedProjectRoot = startPath;
    }
    let selectedProjectConfig = projectConfigRead.config;
    let selectedProjectConfigPath = projectConfigRead.path;
    let selectedProjectConfigText = projectConfigRead.text;
    let selectedProjectRegistry: ProjectRegistrySnapshotEntry | undefined;
    let explicitStoreEntry: StoreRegistrySnapshotEntry | undefined;
    let explicitProjectSelector = input.selection?.project;

    if (input.selection?.store !== undefined) {
      explicitStoreEntry = this.selectStoreEntry(stores, input.selection.store);
    }

    if (input.selection?.project !== undefined && input.selection.store === undefined) {
      const legacyNamespace = stores.filter((entry) =>
        registeredProjectMatches(entry, input.selection!.project!)
      );
      let projects: readonly ProjectRegistrySnapshotEntry[] = [];
      try {
        projects = await this.dependencies.snapshotProjects(input.globalDataDir);
      } catch (error) {
        // A project registered in the legacy typed Store registry is already
        // sufficient explicit identity. Keep that compatibility route usable
        // when the optional machine project registry is corrupt; the later
        // skill-version/home probe is deliberately best-effort too. A
        // machine-registry-only selector still fails loudly because that
        // registry is its sole source of truth.
        if (legacyNamespace.length === 0) throw error;
      }
      let machineNamespace = projects.filter((entry) =>
        projectRegistryMatches(entry, input.selection!.project!, flavor)
      );
      const machineProjectIds = new Set(
        machineNamespace.map(entry =>
          normalizeProjectIdentity(entry.entry.projectId)
        )
      );
      if (machineNamespace.length > 1 && machineProjectIds.size === 1) {
        const [projectId] = machineProjectIds;
        const claimants = await this.dependencies.findProjectIdentityClaimants(
          projectId!,
          input.globalDataDir
        );
        if (claimants.length > 1) {
          throw new PlanningScopeError(
            'planning_selection_conflict',
            formatProjectIdentityAmbiguity(
              input.selection.project,
              claimants.map(claimant => ({
                path: claimant.root,
                entry: claimant.entry,
                live: claimant.live,
              }))
            ),
            {
              target: 'selection.project',
              fix: claimants.some(claimant => !claimant.live)
                ? 'Run rasen home prune to preview, then rasen home prune --apply and retry.'
                : 'Repair the copied projectId metadata, then retry.',
            }
          );
        }
        if (claimants.length === 1) {
          machineNamespace = [
            {
              root: claimants[0]!.root,
              entry: claimants[0]!.entry,
            },
          ];
        }
      }
      if (legacyNamespace.length + machineNamespace.length === 0) {
        const registeredIds = [...new Set([
          ...stores.filter((entry) => entry.type === 'project').map((entry) => entry.id),
          ...projects.map((entry) => entry.entry.projectId),
        ])].sort((left, right) => left.localeCompare(right));
        throw new PlanningScopeError(
          'unknown_project',
          `Unknown project '${input.selection.project}'.${
            registeredIds.length === 0
              ? ' No projects are registered.'
              : ` Registered projects: ${registeredIds.join(', ')}.`
          }`,
          { target: 'selection.project', fix: 'Run rasen store list --json.' }
        );
      }
      if (legacyNamespace.length + machineNamespace.length > 1) {
        const canonicalRoots = await Promise.all(
          [...legacyNamespace, ...machineNamespace].map(async (entry) => {
            if (flavor !== 'native') {
              return normalizePathForComparison(entry.root, flavor);
            }
            const registered = await this.dependencies.findRegisteredProject(
              entry.root,
              input.globalDataDir
            );
            const canonicalRoot = registered?.root ??
              this.dependencies.fs.canonicalizeExisting(entry.root);
            return normalizePathForComparison(canonicalRoot, flavor);
          })
        );
        if (new Set(canonicalRoots).size > 1) {
          throw new PlanningScopeError(
            'planning_selection_conflict',
            `Project selector '${input.selection.project}' matches more than one checkout. Use a permanent projectId or absolute root.`,
            { target: 'selection.project' }
          );
        }
      }
      const projectRoot = legacyNamespace[0]?.root ?? machineNamespace[0]!.root;
      selectedProjectRoot = flavor === 'native'
        ? this.dependencies.fs.canonicalizeExisting(projectRoot)
        : api.resolve(projectRoot);
      selectedProjectRegistry = machineNamespace[0];
      const configRead = await this.projectConfig(selectedProjectRoot, api);
      selectedProjectConfig = configRead.config;
      selectedProjectConfigPath = configRead.path;
      selectedProjectConfigText = configRead.text;
      explicitProjectSelector =
        selectedProjectConfig?.projectId ??
        selectedProjectRegistry?.entry.projectId ??
        input.selection.project;
    }

    const sessionFact = await this.readSessionFact(flavor);
    const association = await this.readAssociationFact(
      selectedProjectRoot ?? discoveredProjectRoot,
      api,
      flavor
    );

    let bindingStoreEntry: StoreRegistrySnapshotEntry | undefined;
    if (selectedProjectConfig?.store !== undefined) {
      bindingStoreEntry = this.storeEntryForDeclaration(stores, selectedProjectConfig.store);
    }

    // The Store checkout the start path happens to sit in is evidence only for
    // the Store it actually IS. Without this identity gate a fully explicit
    // `--store S --project P --target-line L` would be redirected by an
    // unrelated Store checkout in the current directory, which is precisely
    // the cwd sensitivity the routing contract forbids. When no Store has been
    // selected yet the nearest checkout is the only Store evidence there is,
    // so it stays admissible and `loadStore` verifies identity afterwards.
    const nearestStoreMetadataText = nearestStoreRoot === null
      ? null
      : await this.dependencies.fs.readText(
          api.join(nearestStoreRoot, '.rasen-store', 'store.yaml')
        );
    const nearestStoreIdentity = readStoreIdentityLeniently(nearestStoreMetadataText);
    const preselectedStoreEntry = explicitStoreEntry ?? bindingStoreEntry;
    const nearestStoreRootIsSelected =
      nearestStoreRoot !== null &&
      (preselectedStoreEntry === undefined ||
        storeEntryMatchesIdentity(preselectedStoreEntry, nearestStoreIdentity));

    const marker = await this.readMarkerFact(
      association?.candidate.planningRoot ??
        (nearestStoreRootIsSelected ? nearestStoreRoot : null) ??
        explicitStoreEntry?.root ??
        null,
      api,
      flavor
    );

    if (explicitStoreEntry && bindingStoreEntry) {
      const explicitIdentity = explicitStoreEntry.uid ?? explicitStoreEntry.id;
      const bindingIdentity = bindingStoreEntry.uid ?? bindingStoreEntry.id;
      const equal = explicitStoreEntry.uid && bindingStoreEntry.uid
        ? storeUidsMatch(explicitStoreEntry.uid, bindingStoreEntry.uid)
        : explicitIdentity === bindingIdentity;
      if (!equal) {
        throw new PlanningScopeError(
          'planning_selection_conflict',
          `Explicit Store '${explicitStoreEntry.id}' conflicts with project binding Store '${bindingStoreEntry.id}'.`,
          { target: 'selection.store' }
        );
      }
    }

    const selectedStoreEntry = explicitStoreEntry ?? bindingStoreEntry ?? (() => {
      const factUid = association?.candidate.storeUid ?? marker?.candidate.storeUid ?? sessionFact?.storeUid;
      const factId = association?.candidate.storeId ?? marker?.candidate.storeId ?? sessionFact?.storeId;
      if (!factUid && !factId) return undefined;
      return this.selectStoreEntry(stores, factUid ?? factId as string);
    })();

    // Same identity rule as the marker read above: the nearest checkout may
    // replace the registered Store root only when it IS the selected Store
    // (the linked planning worktree case), never when it merely happens to be
    // a Store checkout the caller is standing in.
    const nearestStoreRootIsSelectedStore =
      nearestStoreRoot !== null &&
      selectedStoreEntry !== undefined &&
      storeEntryMatchesIdentity(selectedStoreEntry, nearestStoreIdentity);

    const preliminaryStoreRoot = association?.candidate.planningRoot ??
      marker?.candidate.planningRoot ??
      (nearestStoreRoot && nearestStoreRootIsSelectedStore &&
       normalizePathForComparison(nearestStoreRoot, flavor) !==
         normalizePathForComparison(selectedStoreEntry!.root, flavor)
        ? nearestStoreRoot
        : selectedStoreEntry?.root);

    let store: StoreState | undefined;
    if (selectedStoreEntry && preliminaryStoreRoot) {
      store = await this.loadStore(selectedStoreEntry, preliminaryStoreRoot, api);
    } else if (nearestStoreRoot && nearestStoreMetadataText !== null) {
      const metadata = parseStoreMetadataState(nearestStoreMetadataText);
      const matches = stores.filter((entry) =>
        entry.type === 'store' &&
        (entry.id === metadata.id ||
          (metadata.version === 2 && entry.uid !== undefined && storeUidsMatch(entry.uid, metadata.uid)))
      );
      if (matches.length === 1) store = await this.loadStore(matches[0]!, nearestStoreRoot, api);
    }

    // store-config-inheritance: a Store named ONLY by this project's own
    // configuration declaration, beside a local planning tree, contributes
    // configuration and nothing else. Planning stays local unless the Store's
    // v2 catalog positively records the project as planning-bound — which is
    // split truth, handled below, not inheritance. Resolving this here is what
    // lets the CLI adapter stop catching exceptions to reach the same answer.
    const declaredProjectIdentity =
      explicitProjectSelector ??
      selectedProjectConfig?.projectId ??
      selectedProjectRegistry?.entry.projectId;
    if (
      store &&
      localPlanning &&
      explicitStoreEntry === undefined &&
      bindingStoreEntry !== undefined &&
      !association?.candidate.storeUid &&
      !association?.candidate.storeId &&
      !marker?.candidate.storeUid &&
      !marker?.candidate.storeId &&
      !sessionFact?.storeUid &&
      !sessionFact?.storeId &&
      !(await this.storeClaimsProjectPlanning(store, declaredProjectIdentity, api))
    ) {
      store = undefined;
    }

    const candidates: FactCandidate[] = [];
    if (input.selection && Object.keys(input.selection).length > 0) {
      candidates.push(freeze({
        source: 'explicit',
        ...(store?.uid === undefined ? {} : { storeUid: store.uid }),
        ...(store?.id === undefined ? {} : { storeId: store.id }),
        ...(explicitProjectSelector === undefined ? {} : { projectId: explicitProjectSelector }),
        ...(input.selection.targetLine === undefined
          ? {}
          : { targetLineId: parseTargetLineId(input.selection.targetLine) }),
      }));
    }
    if (sessionFact) candidates.push(sessionFact);
    if (association) candidates.push(association.candidate);
    if (marker) candidates.push(marker.candidate);
    if (bindingStoreEntry || selectedProjectConfig?.projectId || selectedProjectRegistry) {
      candidates.push(freeze({
        source: 'project-binding',
        ...(store?.uid === undefined ? {} : { storeUid: store.uid }),
        ...(store?.id === undefined ? {} : { storeId: store.id }),
        ...(selectedProjectConfig?.projectId === undefined && selectedProjectRegistry === undefined
          ? {}
          : {
              projectId: selectedProjectConfig?.projectId ??
                selectedProjectRegistry!.entry.projectId,
            }),
        ...(store === undefined ? {} : { planningRoot: store.planningRoot }),
        ...(selectedProjectRoot === null ? {} : { executionRoot: selectedProjectRoot }),
      }));
    }
    if (!store && selectedProjectRoot) {
      candidates.push(freeze({
        source: 'nearest-standalone',
        ...(selectedProjectConfig?.projectId === undefined
          ? {}
          : { projectId: selectedProjectConfig.projectId }),
        planningRoot: selectedProjectRoot,
        executionRoot: selectedProjectRoot,
      }));
    }
    const mergedFacts = this.mergeFacts(candidates, flavor);
    // `--store S` is an explicit aggregate selection, not an incomplete
    // project selection. Ambient/session project and line facts therefore do
    // not fill those dimensions unless `--project` was also supplied.
    const explicitStoreAggregate =
      input.selection?.store !== undefined && input.selection.project === undefined;
    const reduced: { facts: Readonly<ReducedFacts>; evidence: readonly ScopeEvidence[] } = explicitStoreAggregate
      ? {
          facts: freeze({
            ...(mergedFacts.facts.storeUid === undefined
              ? {}
              : { storeUid: mergedFacts.facts.storeUid }),
            ...(mergedFacts.facts.storeId === undefined
              ? {}
              : { storeId: mergedFacts.facts.storeId }),
            ...(mergedFacts.facts.planningRoot === undefined
              ? {}
              : { planningRoot: mergedFacts.facts.planningRoot }),
            ...(mergedFacts.facts.executionRoot === undefined
              ? {}
              : { executionRoot: mergedFacts.facts.executionRoot }),
          }),
          evidence: freeze(
            mergedFacts.evidence.filter(
              (item) => item.field !== 'project' && item.field !== 'target-line'
            )
          ),
        }
      : mergedFacts;

    const notices: PlanningNotice[] = [];
    const fingerprintParts: unknown[] = [
      input.intent,
      reduced.facts,
      selectedProjectConfigText ?? null,
      association?.text ?? null,
      marker?.text ?? null,
      store?.metadataText ?? null,
    ];

    let projectCatalog: StoreProjectCatalogV2 | undefined;
    let targetLineCatalog: StoreTargetLineCatalogV1 | undefined;
    let splitTruth = false;
    let planningWorktreeVerified = false;
    let planningWorktreeFindings: readonly string[] = [];
    let ref: StablePlanningRef;

    if (store) {
      if (store.metadata.layoutVersion !== 2) {
        // A legacy flat Store has no project catalog, so a project selector
        // cannot address a partition inside it — it only records WHICH member
        // the flat planning content belongs to, which is a legitimate internal
        // combination (a frozen Session carries exactly this pair). The CLI
        // adapter owns refusing the user-facing two-selector form; see
        // `resolveOpenSpecRoot`.
        notices.push(freeze({
          code: 'legacy_flat_store_layout',
          message: 'This Store uses the legacy flat planning layout; migrate it to layout v2 for project partitions and target lines.',
        }));
        ref = freeze({
          mode: 'legacy-store',
          ...(store.uid === undefined ? {} : { storeUid: store.uid }),
          storeId: store.id,
          storeRoot: store.planningRoot,
          ...(reduced.facts.projectId === undefined ? {} : { projectId: reduced.facts.projectId }),
        });
      } else {
        if (!store.uid) {
          throw new PlanningScopeError(
            'invalid_store_metadata',
            'Store layout v2 requires permanent Store identity metadata.',
            { target: api.join(store.planningRoot, '.rasen-store', 'store.yaml') }
          );
        }
        const catalogs = await this.loadProjectCatalogs(store.planningRoot, api);
        for (const brokenCatalog of catalogs.broken) {
          notices.push(freeze({
            code: 'invalid_project_catalog',
            message: `Project catalog ${brokenCatalog.path} is unreadable (${brokenCatalog.reason}); that project is unavailable until it is repaired.`,
          }));
        }
        fingerprintParts.push(
          catalogs.broken.map((entry) => `${entry.path} ${entry.reason}`)
        );
        const projectSelector = reduced.facts.projectId;
        if (!projectSelector) {
          ref = freeze({
            mode: 'store-aggregate',
            storeUid: store.uid,
            storeId: store.id,
            storeRoot: store.planningRoot,
            layoutVersion: 2 as const,
          });
        } else {
          const selectedCatalog = this.selectProjectCatalog(catalogs, projectSelector);
          projectCatalog = selectedCatalog.catalog;
          fingerprintParts.push(selectedCatalog.text);
          if (
            explicitProjectSelector !== undefined &&
            explicitProjectSelector !== projectCatalog.projectId &&
            explicitProjectSelector !== projectCatalog.id
          ) {
            throw new PlanningScopeError(
              'planning_selection_conflict',
              `Explicit project '${explicitProjectSelector}' does not match catalog project '${projectCatalog.projectId}'.`,
              { target: 'selection.project' }
            );
          }
          const projectHome = resolveStorePlanningLayoutV2Path(
            store.planningRoot,
            { kind: 'project-home', projectId: projectCatalog.projectId },
            flavor
          );
          const scopedConfigCandidates = [
            api.join(projectHome, 'config.yaml'),
            api.join(projectHome, 'config.yml'),
          ];
          for (const configPath of scopedConfigCandidates) {
            const configText = await this.dependencies.fs.readText(configPath);
            if (configText === null) continue;
            selectedProjectConfig = parseLooseProjectConfig(configText, configPath);
            selectedProjectConfigPath = configPath;
            selectedProjectConfigText = configText;
            fingerprintParts.push(configText);
            if (
              selectedProjectConfig.projectId !== undefined &&
              selectedProjectConfig.projectId !== projectCatalog.projectId
            ) {
              throw new PlanningScopeError(
                'planning_selection_conflict',
                `Project config identity '${selectedProjectConfig.projectId}' does not match catalog project '${projectCatalog.projectId}'.`,
                { target: configPath }
              );
            }
            break;
          }
          const targetLineId = reduced.facts.targetLineId;
          let planningScopeId: PlanningScopeId | undefined;
          if (targetLineId) {
            const line = await this.targetLineCatalog(
              store.planningRoot,
              targetLineId,
              projectCatalog.projectId,
              api
            );
            targetLineCatalog = line.catalog;
            fingerprintParts.push(line.text);
            planningScopeId = derivePlanningScopeId({
              storeUid: store.uid,
              projectId: projectCatalog.projectId,
              targetLineId,
            });
          }
          splitTruth = Boolean(
            (selectedProjectRoot !== null || association !== null) &&
            discoveredLocalPlanning
          );
          if (splitTruth) {
            notices.push(freeze({
              code: 'split_planning_truth',
              message: `Project '${projectCatalog.projectId}' is Store-bound but still has local planning content; reads use Store truth and mutations are blocked.`,
            }));
          }
          const verification = await this.verifyPlanningWorktree({
            store,
            projectId: projectCatalog.projectId,
            ...(targetLineId === undefined ? {} : { targetLineId }),
            ...(targetLineCatalog === undefined ? {} : { targetLineCatalog }),
            ...(marker === null ? {} : { marker: marker.candidate }),
          });
          planningWorktreeVerified = verification.verified;
          planningWorktreeFindings = verification.findings;
          fingerprintParts.push(verification.findings);
          ref = freeze({
            mode: 'store-project',
            storeUid: store.uid,
            storeId: store.id,
            storeRoot: store.planningRoot,
            projectId: projectCatalog.projectId,
            ...(targetLineId === undefined ? {} : { targetLineId }),
            ...(planningScopeId === undefined ? {} : { planningScopeId }),
          });
        }
      }
    } else if (selectedProjectRoot) {
      if (!localPlanning && selectedProjectConfig?.store !== undefined) {
        throw new PlanningScopeError(
          'project_not_in_store',
          `Project '${selectedProjectConfig.projectId ?? selectedProjectRoot}' declares Store-owned planning but has no verified bound Store catalog.`,
          { target: selectedProjectConfigPath }
        );
      }
      if (selectedProjectConfig?.store !== undefined) {
        notices.push(freeze({
          code: 'configuration_store_inheritance',
          message: 'Planning stays local; the declared Store contributes configuration only.',
        }));
      }
      ref = freeze({
        mode: 'standalone',
        ...(reduced.facts.projectId === undefined ? {} : { projectId: reduced.facts.projectId }),
        projectRoot: selectedProjectRoot,
      });
    } else {
      if (isStoreLevelIntent(input.intent) || input.selection?.store !== undefined) {
        throw new PlanningScopeError(
          'unknown_store',
          'No Store scope can be resolved from the supplied selection and start path.',
          { target: 'selection.store' }
        );
      }
      throw new PlanningScopeError(
        'project_scope_required',
        'No project planning scope can be resolved from the supplied selection and start path.',
        { target: 'selection.project' }
      );
    }

    if (input.intent === 'store-read' && ref.mode !== 'store-aggregate') {
      if (ref.mode === 'legacy-store') {
        // A legacy Store has only one aggregate/flat read shape. Keep it
        // available as a Store capability without pretending it is v2.
      } else {
        throw new PlanningScopeError(
          'project_scope_required',
          'Store aggregate read requires a Store scope without a selected project.',
          { target: 'intent' }
        );
      }
    }
    // A Store-level Issue operation is the one intent that must SUCCEED from a
    // project-shaped resolution. Standing in an execution worktree whose
    // binding names one project is the ordinary case — the operator should not
    // have to change directory to open a cross-project Issue — so a
    // `store-project` ref is projected down to its Store in `issueCapability`
    // rather than refused here. It gains no project authority by doing so: the
    // capability exposes only Issue addresses, and every project surface still
    // demands its own scope.
    if (input.intent === 'store-issue' && ref.mode === 'standalone') {
      throw new PlanningScopeError(
        'unknown_store',
        'A Store-level Issue belongs to a Store; this start path resolves a standalone project.',
        {
          target: 'selection.store',
          fix: 'Add --store <store-id>, or run the command inside a Store checkout.',
        }
      );
    }
    if (!isStoreLevelIntent(input.intent) && ref.mode === 'store-aggregate') {
      throw new PlanningScopeError(
        'project_scope_required',
        'This operation requires one project; --store alone selects only the Store aggregate.',
        { target: 'selection.project', fix: 'Add --project <project-id>.' }
      );
    }
    if (input.intent === 'project-read' && input.change !== undefined) {
      fingerprintParts.push(
        await this.validateSelectedChange(ref, input.change, flavor)
      );
    }
    if (input.intent === 'finalize-change' && ref.mode === 'store-project') {
      // Finalization needs strictly more authority than a project read: the
      // Change already exists, its identity is frozen, and the entry it
      // publishes is Git-tracked Store content. The integration checkout is
      // never a fallback. A standalone project and a legacy flat Store reach
      // their existing flat archive location through the same intent, so they
      // deliberately fall through this block without minting any v2 identity.
      if (splitTruth) {
        throw new PlanningScopeError(
          'split_planning_truth',
          'Store and project-local planning both exist; Change finalization is blocked.',
          { target: 'project.planning' }
        );
      }
      if (!ref.targetLineId) {
        throw new PlanningScopeError(
          'target_line_required',
          'Store v2 Change finalization requires a stable target-line id.',
          { target: 'selection.targetLine', fix: 'Add --target-line <id>.' }
        );
      }
      if (!planningWorktreeVerified) {
        throw new PlanningScopeError(
          'planning_worktree_required',
          `Store v2 Change finalization requires a verified planning worktree; the integration checkout is read-only. Unsatisfied: ${
            planningWorktreeFindings.length === 0
              ? 'no verification evidence'
              : planningWorktreeFindings.join(', ')
          }.`,
          {
            target: 'planning.worktree',
            fix: `Prepare one with 'rasen store workspace plan --store ${ref.storeId} --project ${ref.projectId} --target-line ${ref.targetLineId} --change <change-id>' and apply it.`,
            details: freeze({ findings: planningWorktreeFindings }),
          }
        );
      }
    }
    if (input.intent === 'create-change') {
      // A legacy flat Store's planning tree is READ-ONLY. Layout v2 has no
      // writable flat Store namespace, so authoring a new Change into one would
      // write content the migration must then move again — and would keep
      // producing content in a layout the portfolio is retiring. This refusal
      // ships together with the migration that makes it survivable
      // (`store-layout-v2-migration`, tasks 10b.1-10b.3).
      if (ref.mode === 'legacy-store') {
        throw new PlanningScopeError(
          'legacy_flat_store_requires_migration',
          'This Store still uses the legacy flat planning layout, which is read-only; Change creation requires layout v2.',
          {
            target: 'store.layout',
            fix: `Run 'rasen store migrate-layout ${ref.storeId}' to migrate this Store, then retry.`,
          }
        );
      }
      if (splitTruth) {
        throw new PlanningScopeError(
          'split_planning_truth',
          'Store and project-local planning both exist; Change creation is blocked.',
          { target: 'project.planning' }
        );
      }
      if (ref.mode === 'store-project') {
        if (!ref.targetLineId) {
          throw new PlanningScopeError(
            'target_line_required',
            'Store v2 Change creation requires a stable target-line id.',
            { target: 'selection.targetLine', fix: 'Add --target-line <id>.' }
          );
        }
        if (!planningWorktreeVerified) {
          throw new PlanningScopeError(
            'planning_worktree_required',
            `Store v2 Change creation requires a verified planning worktree; the integration checkout is read-only. Unsatisfied: ${
              planningWorktreeFindings.length === 0
                ? 'no verification evidence'
                : planningWorktreeFindings.join(', ')
            }.`,
            {
              target: 'planning.worktree',
              fix: `Prepare one with 'rasen store workspace plan --store ${ref.storeId} --project ${ref.projectId} --target-line ${ref.targetLineId ?? '<id>'} --change <change-id>' and apply it.`,
              details: freeze({ findings: planningWorktreeFindings }),
            }
          );
        }
      }
    }

    const paths = this.describePaths(ref, flavor);
    if (reduced.facts.executionRoot === undefined) {
      notices.push(freeze({
        code: 'execution_authority_unavailable',
        message: 'No execution checkout is verified for this planning scope.',
      }));
    }
    const description: PlanningScopeDescription = freeze({
      kind: ref.mode,
      intent: input.intent,
      source: primarySource(reduced.evidence),
      ref,
      paths: freeze({
        ...paths,
        ...(selectedProjectConfigPath === undefined
          ? {}
          : { 'project-config': selectedProjectConfigPath }),
        ...(reduced.facts.executionRoot === undefined
          ? {}
          : { 'execution-root': reduced.facts.executionRoot }),
      }),
      evidence: reduced.evidence,
      notices: freeze(notices.sort((left, right) => left.code.localeCompare(right.code))),
      followupSelection: followupSelection(ref),
    });
    fingerprintParts.push(ref, planningWorktreeVerified, splitTruth);
    return freeze({
      input: freeze({ ...input, selection: freeze({ ...(input.selection ?? {}) }) }) as OpenPlanningScope,
      description,
      ref,
      fingerprint: fingerprint(fingerprintParts),
      flavor,
      pathApi: api,
      splitTruth,
      planningWorktreeVerified,
      projectConfig: selectedProjectConfig,
      ...(selectedProjectConfigPath === undefined ? {} : { projectConfigPath: selectedProjectConfigPath }),
      ...(selectedProjectRoot === null ? {} : { projectRoot: selectedProjectRoot }),
      ...(store === undefined ? {} : { store }),
      ...(projectCatalog === undefined ? {} : { projectCatalog }),
      ...(targetLineCatalog === undefined ? {} : { targetLineCatalog }),
    });
  }

  private describePaths(
    ref: StablePlanningRef,
    flavor: PlanningPathFlavor
  ): PlanningScopeDescription['paths'] {
    if (ref.mode === 'store-aggregate') {
      return freeze({
        'planning-checkout': ref.storeRoot,
        'store-metadata': resolveStorePlanningLayoutV2Path(
          ref.storeRoot,
          { kind: 'store-metadata' },
          flavor
        ),
        'store-design-docs': resolveStorePlanningLayoutV2Path(
          ref.storeRoot,
          { kind: 'store-design-docs' },
          flavor
        ),
      });
    }
    if (ref.mode === 'store-project') {
      const home = resolveStorePlanningLayoutV2Path(
        ref.storeRoot,
        { kind: 'project-home', projectId: ref.projectId },
        flavor
      );
      return freeze({
        'planning-checkout': ref.storeRoot,
        'project-home': home,
        'project-config': pathApi(flavor).join(home, 'config.yaml'),
        'project-schemas': pathApi(flavor).join(home, 'schemas'),
        'project-work': pathApi(flavor).join(home, 'work'),
        specs: resolveStorePlanningLayoutV2Path(
          ref.storeRoot,
          { kind: 'project-specs', projectId: ref.projectId },
          flavor
        ),
        'project-design-docs': resolveStorePlanningLayoutV2Path(
          ref.storeRoot,
          { kind: 'project-design-docs', projectId: ref.projectId },
          flavor
        ),
        'active-changes': pathApi(flavor).join(home, 'changes'),
        ...(ref.targetLineId === undefined
          ? {}
          : {
              'archive-line': resolveStorePlanningLayoutV2Path(
                ref.storeRoot,
                {
                  kind: 'archive-line',
                  projectId: ref.projectId,
                  targetLineId: ref.targetLineId,
                },
                flavor
              ),
            }),
      });
    }
    const root = ref.mode === 'standalone' ? ref.projectRoot : ref.storeRoot;
    const rasen = pathApi(flavor).join(root, WORKSPACE_DIR_NAME);
    return freeze({
      'planning-checkout': root,
      'project-home': rasen,
      'project-config': pathApi(flavor).join(rasen, 'config.yaml'),
      'project-schemas': pathApi(flavor).join(rasen, 'schemas'),
      'project-work': pathApi(flavor).join(rasen, 'work'),
      specs: pathApi(flavor).join(rasen, 'specs'),
      'project-design-docs': pathApi(flavor).join(rasen, 'design-docs'),
      'active-changes': pathApi(flavor).join(rasen, 'changes'),
      'archive-line': pathApi(flavor).join(rasen, 'changes', 'archive'),
    });
  }

  private location(
    resolved: InternalResolved,
    address: StoreReadAddress | ProjectReadAddress
  ): ScopedReadLocation {
    const ref = resolved.ref;
    let absolutePath: string;
    if (address.kind === 'store-metadata') {
      if (ref.mode !== 'store-aggregate' && ref.mode !== 'legacy-store') {
        throw new PlanningScopeError(
          'planning_address_not_available',
          'Store metadata is not available from a project capability.',
          { target: address.kind }
        );
      }
      absolutePath = resolved.pathApi.join(ref.storeRoot, '.rasen-store', 'store.yaml');
    } else if (address.kind === 'store-design-docs') {
      if (ref.mode !== 'store-aggregate' && ref.mode !== 'legacy-store') {
        throw new PlanningScopeError(
          'planning_address_not_available',
          'Store design docs require a Store aggregate capability.',
          { target: address.kind }
        );
      }
      absolutePath = resolved.pathApi.join(ref.storeRoot, 'rasen', 'design-docs');
    } else if (
      address.kind === 'issue' ||
      address.kind === 'issue-record' ||
      address.kind === 'execution-plans' ||
      address.kind === 'execution-plan'
    ) {
      // Store-level Issue content. A project scope must NOT reach it: an Issue
      // is not project-planning content, and a project capability that could
      // address one would be a project scope with Store-level write reach.
      if (ref.mode !== 'store-aggregate' && ref.mode !== 'legacy-store') {
        throw new PlanningScopeError(
          'planning_address_not_available',
          'Store-level Issue content requires a Store-level capability, not a project one.',
          { target: address.kind }
        );
      }
      // Every path comes from the layout contract, which validates the
      // identifiers and containment-checks the result; nothing is joined here.
      absolutePath = resolveStorePlanningLayoutV2Path(
        ref.storeRoot,
        address.kind === 'execution-plan'
          ? {
              kind: 'execution-plan',
              issueId: address.issueId,
              revisionId: address.revisionId,
            }
          : { kind: address.kind, issueId: address.issueId },
        resolved.flavor
      );
    } else {
      if (ref.mode === 'store-aggregate') {
        throw new PlanningScopeError(
          'project_scope_required',
          `Address '${address.kind}' requires a project scope.`,
          { target: address.kind }
        );
      }
      const paths = resolved.description.paths;
      switch (address.kind) {
        case 'project-home':
        case 'project-config':
        case 'project-schemas':
        case 'project-work':
        case 'specs':
        case 'project-design-docs':
        case 'active-changes':
          absolutePath = paths[address.kind] as string;
          break;
        case 'spec': {
          const capabilityId = parseChangeId(address.capabilityId, 'capabilityId');
          absolutePath = resolved.pathApi.join(paths.specs as string, capabilityId, 'spec.md');
          break;
        }
        case 'active-change': {
          const changeId = parseChangeId(address.changeId);
          absolutePath = ref.mode === 'store-project'
            ? resolveStorePlanningLayoutV2Path(
                ref.storeRoot,
                { kind: 'active-change', projectId: ref.projectId, changeId },
                resolved.flavor
              )
            : resolved.pathApi.join(paths['active-changes'] as string, changeId);
          break;
        }
        case 'archive-line':
          if (paths['archive-line'] === undefined) {
            throw new PlanningScopeError(
              'target_line_required',
              'The Archive line is unavailable until target line is proven.',
              { target: address.kind }
            );
          }
          absolutePath = paths['archive-line'];
          break;
        case 'archive-entry': {
          const changeId = parseChangeId(address.changeId);
          if (ref.mode === 'store-project') {
            if (ref.targetLineId === undefined) {
              throw new PlanningScopeError(
                'target_line_required',
                'A Store v2 Archive entry address requires a proven stable target line.',
                { target: address.kind }
              );
            }
            if (address.changeInstanceId === undefined) {
              throw new PlanningScopeError(
                'change_identity_mismatch',
                'A Store v2 Archive entry address requires the Change instance it belongs to.',
                { target: address.kind }
              );
            }
            // Rejected BEFORE any path is returned, so a malformed instance can
            // never reach the filesystem as a candidate location.
            const instanceId = parseChangeInstanceId(
              address.changeInstanceId,
              'changeInstanceId'
            ) as VerifiedChangeInstanceId;
            absolutePath = resolveStorePlanningLayoutV2Path(
              ref.storeRoot,
              {
                kind: 'archive-entry',
                projectId: ref.projectId,
                targetLineId: ref.targetLineId,
                changeId,
                archiveDate: address.archiveDate,
                changeInstanceId: instanceId,
              },
              resolved.flavor
            );
            break;
          }
          // Standalone and legacy flat Stores keep their established flat entry
          // name. No v2 identity is minted and no v2 address is computed.
          if (paths['archive-line'] === undefined) {
            throw new PlanningScopeError(
              'target_line_required',
              'The Archive line is unavailable until target line is proven.',
              { target: address.kind }
            );
          }
          absolutePath = resolved.pathApi.join(
            paths['archive-line'],
            `${address.archiveDate}-${changeId}`
          );
          break;
        }
      }
    }
    return freeze({
      absolutePath,
      address: address.kind as PlanningAddressKind,
      owner: ref,
      [LOCATION]: true,
    }) as unknown as ScopedReadLocation;
  }

  private aggregateCapability(resolved: InternalResolved): StoreAggregateReadScope {
    if (resolved.ref.mode !== 'store-aggregate' && resolved.ref.mode !== 'legacy-store') {
      throw new PlanningScopeError(
        'project_scope_required',
        'The resolved scope is project-scoped, not a Store aggregate.',
        { target: 'intent' }
      );
    }
    const aggregateRef: StoreAggregateRef = resolved.ref.mode === 'store-aggregate'
      ? resolved.ref
      : freeze({
          mode: 'store-aggregate',
          ...(resolved.ref.storeUid === undefined ? {} : { storeUid: resolved.ref.storeUid }),
          storeId: resolved.ref.storeId,
          storeRoot: resolved.ref.storeRoot,
        });
    return freeze({
      kind: 'store-aggregate' as const,
      ref: aggregateRef,
      [CAPABILITY]: true,
      locate: (address: StoreReadAddress) => this.location(resolved, address),
      describe: () => resolved.description,
    }) as unknown as StoreAggregateReadScope;
  }

  /**
   * A Store-level Issue scope.
   *
   * Two things it does that no other capability does:
   *
   *   - It PROJECTS a project-shaped resolution down to its Store. Opening an
   *     Issue from an execution worktree bound to one project is the ordinary
   *     case, and requiring a `cd` would make the cross-project resource the
   *     hardest one to reach.
   *   - It reports the Store's REGISTERED checkout as the write location, never
   *     `planningRoot`. `planningRoot` may be a planning worktree bound to one
   *     Change, whose branch carries that Change's unmerged line; an Issue
   *     written there is invisible from every other target line. The Issue
   *     Module refuses such a checkout outright, and this makes sure the scope
   *     never hands it one to begin with.
   */
  private issueCapability(resolved: InternalResolved): StoreIssueScope {
    const ref = resolved.ref;
    if (ref.mode === 'standalone') {
      throw new PlanningScopeError(
        'unknown_store',
        'A Store-level Issue belongs to a Store; this scope resolved a standalone project.',
        { target: 'selection.store' }
      );
    }
    const aggregateRef: StoreAggregateRef = ref.mode === 'store-aggregate'
      ? ref
      : freeze({
          mode: 'store-aggregate',
          ...(ref.storeUid === undefined ? {} : { storeUid: ref.storeUid }),
          storeId: ref.storeId,
          storeRoot: ref.storeRoot,
          ...(ref.mode === 'store-project' ? { layoutVersion: 2 as const } : {}),
        });
    const storeCheckoutRoot = resolved.store?.registeredRoot ?? aggregateRef.storeRoot;
    const issueResolved: InternalResolved = {
      ...resolved,
      ref: aggregateRef,
      description: freeze({
        ...resolved.description,
        kind: 'store-aggregate',
        ref: aggregateRef,
        // Recomputed from the AGGREGATE ref. Carrying the project-shaped
        // follow-up forward would have this scope advertise `--project` to the
        // next command — for the one resource that must never require one.
        followupSelection: followupSelection(aggregateRef),
        // Issue content is Store-level, so a description of this scope must not
        // keep advertising the project paths the underlying resolution found.
        paths: this.describePaths(aggregateRef, resolved.flavor),
      }),
    };
    return freeze({
      kind: 'store-issue' as const,
      ref: aggregateRef,
      storeCheckoutRoot,
      [CAPABILITY]: true,
      locate: (address: StoreIssueAddress) =>
        this.location({ ...issueResolved, ref: freeze({ ...aggregateRef, storeRoot: storeCheckoutRoot }) }, address),
      describe: () => issueResolved.description,
    }) as unknown as StoreIssueScope;
  }

  private readCapability(resolved: InternalResolved): ProjectReadScope {
    if (resolved.ref.mode === 'store-aggregate') {
      throw new PlanningScopeError(
        'project_scope_required',
        'Project content requires one selected project.',
        { target: 'selection.project' }
      );
    }
    const capability = {
      kind: 'project' as const,
      ref: resolved.ref,
      [CAPABILITY]: true,
      locate: (address: ProjectReadAddress) => this.location(resolved, address),
      openChange: async (selector: ChangeSelector) => {
        const changeId = parseChangeId(selector.changeId);
        const location = this.location(resolved, { kind: 'active-change', changeId });
        const metadata = readChangeMetadata(
          location.absolutePath,
          resolved.projectRoot ?? resolved.store?.planningRoot,
          resolved.description.paths['project-schemas']
        );
        let instanceId: VerifiedChangeInstanceId | undefined;
        if (metadata?.identity) {
          instanceId = metadata.identity.instanceId;
          if (resolved.ref.mode !== 'store-project') {
            throw new PlanningScopeError(
              'change_identity_mismatch',
              `Change '${changeId}' carries Store v2 identity outside a Store project scope.`,
              { target: location.absolutePath }
            );
          }
          if (
            !storeUidsMatch(metadata.identity.storeUid, resolved.ref.storeUid) ||
            metadata.identity.projectId !== resolved.ref.projectId
          ) {
            throw new PlanningScopeError(
              'change_identity_mismatch',
              `Change '${changeId}' identity does not match the selected Store/project scope.`,
              { target: location.absolutePath }
            );
          }
          if (
            resolved.ref.targetLineId !== undefined &&
            metadata.identity.targetLineId !== resolved.ref.targetLineId
          ) {
            throw new PlanningScopeError(
              'target_line_mismatch',
              `Change '${changeId}' is frozen against target line '${metadata.identity.targetLineId}', but this command resolved '${resolved.ref.targetLineId}'.`,
              {
                target: location.absolutePath,
                fix: `Address the Change on its own line: --target-line ${metadata.identity.targetLineId}.`,
                details: freeze({
                  frozenTargetLineId: metadata.identity.targetLineId,
                  resolvedTargetLineId: resolved.ref.targetLineId,
                }),
              }
            );
          }
          if (resolved.ref.targetLineId === undefined) {
            throw new PlanningScopeError(
              'target_line_required',
              `Change '${changeId}' is v2 but the selected scope did not independently prove its target line.`,
              { target: 'selection.targetLine' }
            );
          }
        }
        if (
          selector.expectedInstanceId !== undefined &&
          selector.expectedInstanceId !== instanceId
        ) {
          throw new PlanningScopeError(
            'change_identity_mismatch',
            `Change '${changeId}' does not have expected instance '${selector.expectedInstanceId}'.`,
            { target: location.absolutePath }
          );
        }
        return freeze({
          changeId,
          location,
          metadata,
          ...(instanceId === undefined ? {} : { instanceId }),
        }) as ScopedReadChange;
      },
      describe: () => resolved.description,
    };
    return freeze(capability) as unknown as ProjectReadScope;
  }

  private creationCapability(resolved: InternalResolved): ChangeCreationScope {
    if (resolved.ref.mode === 'store-aggregate') {
      throw new PlanningScopeError(
        'project_scope_required',
        'Change creation requires an authoring project scope.',
        { target: 'selection.project' }
      );
    }
    const authoringRef = resolved.ref.mode === 'store-project'
      ? resolved.ref as StoreProjectAuthoringRef
      : resolved.ref;
    return freeze({
      kind: 'change-creation' as const,
      ref: authoringRef,
      [CAPABILITY]: true,
      createChange: (input: CreateScopedChangeInput) => this.createChange(resolved, input),
      describe: () => resolved.description,
    }) as unknown as ChangeCreationScope;
  }

  /**
   * The finalization capability. Authority was already required by `resolve`
   * (target line and planning worktree for a Store v2 project); what remains
   * here is opening the Change itself, which re-verifies its committed v2
   * identity against the resolved scope and refuses a target-line disagreement
   * before any address is computed.
   */
  private async finalizationCapability(
    resolved: InternalResolved,
    selector: ChangeSelector
  ): Promise<ChangeFinalizationScope> {
    if (resolved.ref.mode === 'store-aggregate') {
      throw new PlanningScopeError(
        'project_scope_required',
        'Change finalization requires one selected project.',
        { target: 'selection.project' }
      );
    }
    const change = await this.readCapability(resolved).openChange(selector);
    const capability = {
      kind: 'change-finalization' as const,
      ref: resolved.ref,
      change,
      [CAPABILITY]: true,
      locate: (address: ProjectReadAddress) => this.location(resolved, address),
      describe: () => resolved.description,
    };
    return freeze(capability) as unknown as ChangeFinalizationScope;
  }

  private async revalidate(resolved: InternalResolved): Promise<void> {
    const next = await this.resolve(resolved.input);
    if (next.fingerprint !== resolved.fingerprint) {
      throw new PlanningScopeError(
        'planning_scope_stale',
        'Planning ownership, layout, catalog, or worktree evidence changed after scope opening.',
        { target: 'planning.scope' }
      );
    }
  }

  private async ensureCreationParents(resolved: InternalResolved): Promise<void> {
    const activeChanges = resolved.description.paths['active-changes'];
    if (!activeChanges) {
      throw new PlanningScopeError(
        'planning_address_not_available',
        'Active Changes collection is unavailable in this scope.',
        { target: 'active-changes' }
      );
    }
    if (resolved.ref.mode === 'standalone') {
      const root = resolved.ref.projectRoot;
      await this.dependencies.fs.mkdir(activeChanges, { recursive: true });
      await this.dependencies.fs.mkdir(
        resolved.pathApi.join(root, WORKSPACE_DIR_NAME, 'specs'),
        { recursive: true }
      );
      await this.dependencies.fs.mkdir(
        resolved.pathApi.join(activeChanges, 'archive'),
        { recursive: true }
      );
      const configPath = resolved.pathApi.join(root, WORKSPACE_DIR_NAME, 'config.yaml');
      const configYml = resolved.pathApi.join(root, WORKSPACE_DIR_NAME, 'config.yml');
      if (
        (await this.dependencies.fs.statKind(configPath)) === 'absent' &&
        (await this.dependencies.fs.statKind(configYml)) === 'absent'
      ) {
        try {
          await this.dependencies.fs.writeText(configPath, `schema: ${DEFAULT_SCHEMA}\n`);
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error;
        }
      }
      return;
    }
    await this.dependencies.fs.mkdir(activeChanges, { recursive: true });
  }

  private async targetOwnershipMatches(
    resolved: InternalResolved,
    target: string,
    ownershipToken: string,
    targetIdentity: StorePlanningFileIdentity
  ): Promise<boolean> {
    if (!sameFileIdentity(await this.dependencies.fs.statIdentity(target), targetIdentity)) {
      return false;
    }
    return (await this.dependencies.fs.readText(
      resolved.pathApi.join(target, PUBLICATION_OWNER_FILENAME)
    )) === ownershipToken;
  }

  private async removeOwnedPublication(
    resolved: InternalResolved,
    target: string,
    ownershipToken: string,
    ownership: PublishedChangeOwnership
  ): Promise<void> {
    if (!ownership.entries.has(PUBLICATION_OWNER_FILENAME)) {
      if (sameFileIdentity(
        await this.dependencies.fs.statIdentity(target),
        ownership.targetIdentity
      )) {
        await this.dependencies.fs.removeDirectoryIfEmpty(target);
      }
      return;
    }
    if (!(await this.targetOwnershipMatches(
      resolved,
      target,
      ownershipToken,
      ownership.targetIdentity
    ))) {
      return;
    }

    for (const [name, identity] of [...ownership.entries].reverse()) {
      const candidate = resolved.pathApi.join(target, name);
      if (sameFileIdentity(await this.dependencies.fs.statIdentity(candidate), identity)) {
        await this.dependencies.fs.removeFile(candidate);
      }
    }

    if (sameFileIdentity(
      await this.dependencies.fs.statIdentity(target),
      ownership.targetIdentity
    )) {
      await this.dependencies.fs.removeDirectoryIfEmpty(target);
    }
  }

  /**
   * Retire the publication ownership token on the success path. Only the entry
   * this operation linked is removed (verified by file identity), so a foreign
   * replacement can never lose a file to this cleanup.
   */
  private async removePublicationOwnerToken(
    resolved: InternalResolved,
    target: string,
    ownership: PublishedChangeOwnership
  ): Promise<void> {
    const identity = ownership.entries.get(PUBLICATION_OWNER_FILENAME);
    if (identity === undefined) return;
    const ownerPath = resolved.pathApi.join(target, PUBLICATION_OWNER_FILENAME);
    if (sameFileIdentity(await this.dependencies.fs.statIdentity(ownerPath), identity)) {
      await this.dependencies.fs.removeFile(ownerPath);
    }
  }

  private async removeOwnedStage(
    resolved: InternalResolved,
    stage: string,
    ownershipToken: string
  ): Promise<void> {
    const owner = await this.dependencies.fs.readText(
      resolved.pathApi.join(stage, PUBLICATION_OWNER_FILENAME)
    );
    if (owner === ownershipToken) {
      await this.dependencies.fs.removeOwnedTree(stage);
    }
  }

  private async publishStagedChange(
    resolved: InternalResolved,
    stage: string,
    target: string,
    ownershipToken: string
  ): Promise<PublishedChangeOwnership> {
    let targetIdentity: StorePlanningFileIdentity | null = null;
    const linkedEntries = new Map<string, StorePlanningFileIdentity>();
    try {
      await this.dependencies.fs.mkdir(target);
      targetIdentity = await this.dependencies.fs.statIdentity(target);
      if (targetIdentity === null) {
        throw new Error('Reserved Change directory disappeared before publication.');
      }

      const names = await this.dependencies.fs.listNames(stage);
      const publishOrder = [
        PUBLICATION_OWNER_FILENAME,
        ...names.filter(
          (name) => name !== PUBLICATION_OWNER_FILENAME && name !== '.openspec.yaml'
        ),
        '.openspec.yaml',
      ];
      for (const name of publishOrder) {
        const source = resolved.pathApi.join(stage, name);
        const identity = await this.dependencies.fs.statIdentity(source);
        if (identity === null) {
          throw new Error(`Staged Change entry disappeared before publication: ${name}`);
        }
        await this.dependencies.fs.link(source, resolved.pathApi.join(target, name));
        linkedEntries.set(name, identity);
        if (!(await this.targetOwnershipMatches(
          resolved,
          target,
          ownershipToken,
          targetIdentity
        ))) {
          throw new Error('Published Change ownership changed during publication.');
        }
      }
      return { targetIdentity, entries: linkedEntries };
    } catch (error) {
      if (targetIdentity !== null) {
        await this.removeOwnedPublication(
          resolved,
          target,
          ownershipToken,
          { targetIdentity, entries: linkedEntries }
        );
      }
      if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(errorCode(error) ?? '')) {
        throw new PlanningScopeError(
          'change_already_exists',
          `Change '${resolved.pathApi.basename(target)}' was published concurrently in this scope.`,
          { target, cause: error }
        );
      }
      throw new PlanningScopeError(
        'change_publish_failed',
        `Publishing Change '${resolved.pathApi.basename(target)}' failed: ${error instanceof Error ? error.message : String(error)}.`,
        { target, cause: error }
      );
    }
  }

  /**
   * The two-phase binding's input, or null when this scope has no pair to bind
   * (standalone and legacy-flat authoring mint no Store v2 identity).
   */
  private changeBindingInput(
    resolved: InternalResolved,
    changeId: string
  ): ChangeBindingInput | null {
    const ref = resolved.ref;
    if (ref.mode !== 'store-project' || ref.targetLineId === undefined) return null;
    if (ref.planningScopeId === undefined) return null;
    return {
      storeUid: ref.storeUid,
      storeId: ref.storeId,
      projectId: ref.projectId,
      targetLineId: ref.targetLineId,
      planningScopeId: ref.planningScopeId,
      changeId,
      planningRoot: ref.storeRoot,
      ...(resolved.input.globalDataDir === undefined
        ? {}
        : { globalDataDir: resolved.input.globalDataDir }),
      ...(resolved.flavor === 'native' ? {} : { pathFlavor: resolved.flavor }),
    };
  }

  private async createChange(
    resolved: InternalResolved,
    input: CreateScopedChangeInput
  ): Promise<ScopedAuthoredChange> {
    const raw = input as unknown as Record<string, unknown>;
    const forbidden = ['identity', 'instanceSeed', 'instanceId', 'storeUid', 'projectId', 'targetLineId']
      .filter((field) => raw[field] !== undefined);
    if (forbidden.length > 0) {
      throw new PlanningScopeError(
        'invalid_change_creation',
        `Caller-controlled identity fields are forbidden: ${forbidden.join(', ')}.`,
        { target: 'change.metadata' }
      );
    }
    const validation = validateChangeName(input.changeId);
    if (!validation.valid) {
      throw new PlanningScopeError(
        'invalid_change_creation',
        validation.error ?? 'Invalid Change id.',
        { target: 'change.id' }
      );
    }
    const changeId = parseChangeId(input.changeId);
    if (input.description !== undefined && input.description.trim().length === 0) {
      throw new PlanningScopeError(
        'invalid_change_creation',
        'Change description must not be empty.',
        { target: 'change.description' }
      );
    }
    if (input.proposal !== undefined && input.proposal.trim().length === 0) {
      throw new PlanningScopeError(
        'invalid_change_creation',
        'Change proposal seed must not be empty.',
        { target: 'change.proposal' }
      );
    }
    const schema = input.schema ?? resolved.projectConfig?.schema ??
      input.defaultSchema ?? DEFAULT_SCHEMA;
    validateSchemaName(
      schema,
      resolved.projectRoot ?? resolved.store?.planningRoot,
      resolved.description.paths['project-schemas']
    );
    const location = this.location(resolved, { kind: 'active-change', changeId });
    const target = location.absolutePath;
    const lockPath = `${target}.create.lock`;
    const ownershipToken = this.dependencies.randomSuffix();
    const stage = `${target}.rasen-stage.${ownershipToken}`;

    // Revalidate before the first mkdir/lock write. Mutation methods never
    // silently reopen into a different scope.
    await this.revalidate(resolved);
    // One planning worktree carries exactly one active Change. The refusal is
    // decided from the RECORDED binding, before any Change directory exists —
    // a directory scan of the planning tree would have to guess which Change is
    // current, which is exactly what the binding rules forbid.
    const binding = this.changeBindingInput(resolved, changeId);
    if (binding !== null) {
      try {
        await this.dependencies.assertPlanningWorktreeUnbound(binding);
      } catch (error) {
        // The workspace taxonomy's codes are the diagnostic; re-wrapping keeps
        // `workspace_already_bound` (and its two disagreeing values) all the way
        // out to `--json`, instead of collapsing to the caller's fallback code.
        throw asPlanningScopeError(error);
      }
    }
    await this.ensureCreationParents(resolved);
    let lock: Awaited<ReturnType<StorePlanningDependencies['fs']['openExclusive']>>;
    let lockIdentity: StorePlanningFileIdentity | null = null;
    try {
      lock = await this.dependencies.fs.openExclusive(lockPath);
      lockIdentity = await this.dependencies.fs.statIdentity(lockPath);
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        throw new PlanningScopeError(
          'change_already_exists',
          `Change '${changeId}' is already being created in this scope.`,
          {
            target,
            fix: `If no other creation is running, delete the stale lock ${lockPath} and retry.`,
          }
        );
      }
      throw error;
    }
    try {
      const targetKind = await this.dependencies.fs.statKind(target);
      if (targetKind !== 'absent') {
        // An abandoned reservation is EMPTY — `mkdir(target)` ran and nothing
        // was linked, or only the ownership token was. Anything else is real
        // content: a hand-made Change directory, or one whose metadata was
        // removed. The recovery this names deletes the directory, so the test
        // has to be "provably holds nothing", never "lacks `.openspec.yaml`" —
        // that would tell a user to delete their own work.
        const remaining = targetKind === 'directory'
          ? (await this.dependencies.fs.listNames(target)).filter(
              (name) => name !== PUBLICATION_OWNER_FILENAME
            )
          : ['<not-a-directory>'];
        const incompleteReservation = remaining.length === 0;
        throw new PlanningScopeError(
          'change_already_exists',
          incompleteReservation
            ? `Change '${changeId}' has an empty, abandoned publication reservation at ${target}: the directory exists but holds nothing, so no Change was ever published there.`
            : `Change '${changeId}' already exists at ${target}.`,
          {
            target,
            ...(incompleteReservation
              ? { fix: `Delete the abandoned reservation directory ${target}, then retry.` }
              : {}),
          }
        );
      }
      await this.dependencies.fs.mkdir(stage);
      await this.dependencies.fs.writeText(
        resolved.pathApi.join(stage, PUBLICATION_OWNER_FILENAME),
        ownershipToken
      );
      let instanceId: VerifiedChangeInstanceId | undefined;
      let metadata: ChangeMetadata;
      if (resolved.ref.mode === 'store-project') {
        const seed = this.dependencies.mintInstanceSeed();
        const planningScopeId = resolved.ref.planningScopeId as PlanningScopeId;
        instanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed: seed });
        metadata = {
          schema,
          created: this.dependencies.now().toISOString().slice(0, 10),
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.implementation === undefined ? {} : { implementation: input.implementation }),
          identity: {
            version: 2,
            instanceSeed: seed,
            instanceId,
            storeUid: resolved.ref.storeUid,
            projectId: parseProjectId(resolved.ref.projectId),
            targetLineId: parseTargetLineId(resolved.ref.targetLineId as string),
          },
        };
      } else {
        metadata = {
          schema,
          created: this.dependencies.now().toISOString().slice(0, 10),
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.implementation === undefined ? {} : { implementation: input.implementation }),
        };
      }
      const parsedMetadata = ChangeMetadataSchema.safeParse(metadata);
      if (!parsedMetadata.success) {
        throw new PlanningScopeError(
          'invalid_change_creation',
          `Invalid Change metadata: ${parsedMetadata.error.message}`,
          { target: 'change.metadata' }
        );
      }
      await this.dependencies.fs.writeText(
        resolved.pathApi.join(stage, '.openspec.yaml'),
        stringifyYaml(parsedMetadata.data)
      );
      if (input.description !== undefined) {
        await this.dependencies.fs.writeText(
          resolved.pathApi.join(stage, 'README.md'),
          `# ${changeId}\n\n${input.description}\n`
        );
      }
      if (input.proposal !== undefined) {
        await this.dependencies.fs.writeText(
          resolved.pathApi.join(stage, 'proposal.md'),
          `# ${changeId}\n\n_Submission seed — created via \`--proposal\`; develop this into a full proposal._\n\n## Why\n\n${input.proposal}\n`
        );
      }
      const publication = await this.publishStagedChange(
        resolved,
        stage,
        target,
        ownershipToken
      );
      const publishedText = await this.dependencies.fs.readText(
        resolved.pathApi.join(target, '.openspec.yaml')
      );
      if (publishedText === null) {
        await this.removeOwnedPublication(resolved, target, ownershipToken, publication);
        throw new PlanningScopeError(
          'change_publish_failed',
          `Published Change '${changeId}' is missing metadata.`,
          { target }
        );
      }
      let publishedRaw: unknown;
      try {
        publishedRaw = parseYaml(publishedText);
      } catch (error) {
        await this.removeOwnedPublication(resolved, target, ownershipToken, publication);
        throw new PlanningScopeError(
          'change_publish_failed',
          `Published Change '${changeId}' metadata cannot be read back.`,
          { target, cause: error }
        );
      }
      const published = ChangeMetadataSchema.safeParse(publishedRaw);
      if (
        !published.success ||
        published.data.schema !== schema ||
        published.data.identity?.instanceId !== instanceId
      ) {
        await this.removeOwnedPublication(resolved, target, ownershipToken, publication);
        throw new PlanningScopeError(
          'change_identity_mismatch',
          `Published Change '${changeId}' did not verify against the authored metadata.`,
          { target, cause: published.success ? undefined : published.error }
        );
      }
      // The ownership token exists to make publication and identity-safe
      // cleanup verifiable; both are finished. Leaving it behind would commit a
      // hidden `<pid>.<random>` file into every published Change, the Store's
      // history, and later Archive digest accounting.
      await this.removePublicationOwnerToken(resolved, target, publication);
      // Phase two of the pair: the Change instance now exists, so the binding
      // can complete. This writes machine-local state only, and a pair the
      // operator assembled by hand is indexed here from what is already true on
      // disk.
      if (binding !== null && instanceId !== undefined) {
        await this.dependencies.completeChangeBinding({ ...binding, changeInstanceId: instanceId });
      }
      return freeze({
        changeId,
        schema,
        location,
        metadataPath: resolved.pathApi.join(target, '.openspec.yaml'),
        ...(instanceId === undefined ? {} : { instanceId }),
      });
    } finally {
      await lock.close();
      if (lockIdentity !== null && sameFileIdentity(
        await this.dependencies.fs.statIdentity(lockPath),
        lockIdentity
      )) {
        await this.dependencies.fs.removeFile(lockPath);
      }
      await this.removeOwnedStage(resolved, stage, ownershipToken);
    }
  }
}

export function projectReadProjection(
  scope: ProjectReadScope
): ResolvedOpenSpecRootReadProjection {
  const description = scope.describe();
  const projectHome = scope.locate({ kind: 'project-home' }).absolutePath;
  const schemasDir = scope.locate({ kind: 'project-schemas' }).absolutePath;
  const changesDir = scope.locate({ kind: 'active-changes' }).absolutePath;
  const specsDir = scope.locate({ kind: 'specs' }).absolutePath;
  let archiveDir: string | undefined;
  try {
    archiveDir = scope.locate({ kind: 'archive-line' }).absolutePath;
  } catch (error) {
    if (!(error instanceof PlanningScopeError) || error.diagnostic.code !== 'target_line_required') {
      throw error;
    }
  }
  return freeze({
    planningCheckoutRoot: description.paths['planning-checkout'] as string,
    projectHome,
    schemasDir,
    changesDir,
    specsDir,
    ...(archiveDir === undefined ? {} : { archiveDir }),
  });
}
