import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import { readProjectConfig, classifyOpenSpecDir, hasStoreDeclaration } from '../project-config.js';
import { storeBindingDeclarationFrom } from '../effective-config.js';
import {
  describeUnavailableStore,
  findRegisteredStoreAtRoot,
  resolveStoreBinding,
} from '../store/identity.js';
import { isValidStoreUid, storeUidsMatch } from '../store/identity-types.js';
import {
  listStoreRegistryEntries,
  readStoreRegistryState,
} from '../store/foundation.js';
import { sameProjectIdentity } from '../store/project-records.js';
import {
  requireSessionRuntimeContext,
  type RuntimeContext,
  type RuntimeExecutionRef,
} from '../session-runtime-context.js';
import {
  findProjectIdentityClaimants,
  findProjectRegistryEntry,
  formatProjectIdentityAmbiguity,
} from '../project-registry.js';
import {
  findQualifyingRootSync,
  inspectRegisteredStore,
} from '../root-selection.js';
import { resolveEvaluationCheckout } from './evaluation-root.js';
import { resolveProjectStore } from './stores.js';
import type {
  DurableKnowledgeOwnerRef,
  DurableKnowledgePlanningRootRef,
  FrozenExecutionRef,
  FrozenKnowledgeContext,
  KnowledgeOwnerRef,
  KnowledgePlanningRootRef,
  KnowledgeSelector,
  LearnedSkillExecutionContext,
  LearnedSkillScope,
  ResolvedKnowledgeOwnerRef,
  ResolvedKnowledgePlanningRootRef,
} from './types.js';

export type KnowledgeContextDiagnosticCode =
  | 'knowledge_owner_unknown'
  | 'knowledge_owner_ambiguous'
  | 'knowledge_owner_stale'
  | 'knowledge_owner_scope_mismatch'
  | 'knowledge_selector_conflict'
  | 'knowledge_store_scope_unavailable'
  /**
   * A display name is being asked to do an identity's job — either a frozen
   * record that carries only a name and no longer settles to exactly one
   * Store, or a Store with no permanent identity to freeze. The same code the
   * durable knowledge WRITE path already refuses under, so one problem has one
   * name and one repair.
   */
  | 'learned_owner_legacy_alias';

export interface KnowledgeContextDiagnostic {
  code: KnowledgeContextDiagnosticCode;
  message: string;
  selectorGuidance?: string[];
  owner?: KnowledgeOwnerRef;
  planningRoot?: KnowledgePlanningRootRef;
}

export class KnowledgeContextError extends Error {
  readonly diagnostic: KnowledgeContextDiagnostic;

  constructor(diagnostic: KnowledgeContextDiagnostic) {
    super(diagnostic.message);
    this.name = 'KnowledgeContextError';
    this.diagnostic = diagnostic;
  }
}

export function isKnowledgeContextError(error: unknown): error is KnowledgeContextError {
  return error instanceof KnowledgeContextError;
}

export interface ResolveLearnedSkillExecutionContextInput {
  launchDirectory?: string;
  selector?: KnowledgeSelector;
  requestedScope?: LearnedSkillScope | 'mixed';
  frozen?: FrozenKnowledgeContext;
  globalDataDir?: string;
  /**
   * The session runtime context this command runs under
   * (unified-session-runtime-context D4). Defaults to the one the supervisor
   * handed this process; pass `null` to opt out explicitly, or a context to
   * pin one in a test. It changes WHERE this resolver reads its planning root
   * from — the session's recorded planning root instead of the working
   * directory — and nothing about what it then decides.
   */
  sessionContext?: RuntimeContext | null;
}

type ResolvedNonGlobalOwner = Exclude<ResolvedKnowledgeOwnerRef, { type: 'global' }>;

const selectorGuidance = ['--project <id>', '--store <id>'];

function fail(
  code: KnowledgeContextDiagnosticCode,
  message: string,
  details: Omit<KnowledgeContextDiagnostic, 'code' | 'message'> = {}
): never {
  throw new KnowledgeContextError({ code, message, ...details });
}

function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

function pathsEqual(left: string, right: string): boolean {
  const a = canonicalizeOrResolve(left);
  const b = canonicalizeOrResolve(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}


/**
 * The DISPLAY form of a resolved owner: what a diagnostic names, and what a
 * selector is compared against. It is deliberately alias-keyed — a message that
 * printed a Store's UID instead of its name would be worse, not better.
 *
 * It is NOT what a frozen run records: see {@link durableOwnerIdentity}, which
 * keeps the permanent identity this narrowing used to drop.
 */
function ownerIdentity(owner: ResolvedKnowledgeOwnerRef): KnowledgeOwnerRef {
  return owner.type === 'global' ? { type: 'global' } : { type: owner.type, id: owner.id };
}

function planningIdentity(
  planningRoot: ResolvedKnowledgePlanningRootRef
): KnowledgePlanningRootRef {
  return { type: planningRoot.type, id: planningRoot.id };
}

/**
 * The DURABLE form of a resolved owner — permanent identity as the authority,
 * display name carried alongside for readability only. This is what keeps the
 * `uid` that {@link ownerIdentity} narrows away.
 *
 * `undefined` when the owner has no permanent identity to record: a Store whose
 * metadata predates one. That is not an error here — refusing to freeze would
 * stop runs that work today, and the fail-closed treatment this release adds is
 * on the READ side, where an unsettleable name is the actual hazard. The caller
 * falls back to the legacy record shape in that case, and the read path then
 * refuses to guess between namesakes.
 */
function durableOwnerIdentity(
  owner: ResolvedKnowledgeOwnerRef
): DurableKnowledgeOwnerRef | undefined {
  if (owner.type === 'global') return { type: 'global' };
  if (owner.type === 'project') return { type: 'project', projectId: owner.id, id: owner.id };
  if (owner.uid === undefined) return undefined;
  return { type: 'store', uid: owner.uid, id: owner.id };
}

function durablePlanningIdentity(
  planningRoot: ResolvedKnowledgePlanningRootRef
): DurableKnowledgePlanningRootRef | undefined {
  const durable = durableOwnerIdentity(planningRoot);
  // A planning root is never global; the union just does not say so.
  return durable === undefined || durable.type === 'global' ? undefined : durable;
}

/**
 * A frozen owner, in whichever shape its record version wrote it. Version 3
 * carries permanent identity; versions 1 and 2 carry a display name only.
 */
type FrozenOwnerRef = FrozenKnowledgeContext['owner'];
type FrozenPlanningRootRef = FrozenKnowledgeContext['planningRoot'];

/** True when a frozen ref names its subject by display alias only (v1/v2). */
function isNameOnlyRef(ref: FrozenOwnerRef | FrozenPlanningRootRef): boolean {
  if (ref.type === 'global') return false;
  if (ref.type === 'store') return !('uid' in ref) || ref.uid === undefined;
  return !('projectId' in ref) || ref.projectId === undefined;
}

/**
 * The locator a frozen ref resolves through, and the display name a diagnostic
 * about it should use. For a durable ref the permanent identity IS the
 * locator — `resolveStoreOwner` reads a UID as a durable declaration — so
 * a rename cannot retarget it and a namesake cannot claim it.
 */
function frozenRefLocator(
  ref: Exclude<FrozenOwnerRef, { type: 'global' }> | FrozenPlanningRootRef
): Exclude<KnowledgeOwnerRef, { type: 'global' }> {
  if (ref.type === 'store') {
    return { type: 'store', id: 'uid' in ref && ref.uid !== undefined ? ref.uid : (ref.id as string) };
  }
  return {
    type: 'project',
    id: 'projectId' in ref && ref.projectId !== undefined ? ref.projectId : (ref.id as string),
  };
}

/** How a frozen ref should be NAMED in a message: the display alias when it has one. */
function frozenRefDisplay(
  ref: Exclude<FrozenOwnerRef, { type: 'global' }> | FrozenPlanningRootRef
): Exclude<KnowledgeOwnerRef, { type: 'global' }> {
  return { type: ref.type, id: ref.id ?? frozenRefLocator(ref).id };
}

function selectorIdentity(selector: KnowledgeSelector): KnowledgeOwnerRef | undefined {
  if (selector.project !== undefined && selector.store !== undefined) {
    fail(
      'knowledge_selector_conflict',
      '--project and --store are mutually exclusive knowledge-owner selectors; pass only one.',
      { selectorGuidance }
    );
  }
  if (selector.project !== undefined) return { type: 'project', id: selector.project };
  if (selector.store !== undefined) return { type: 'store', id: selector.store };
  return undefined;
}

function sameOwner(left: KnowledgeOwnerRef, right: KnowledgeOwnerRef): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'global') return true;
  // Project identities are UUIDs that may differ only in case or whitespace
  // — compare in canonical form (M3). Store ids are display aliases compared
  // as-is, matching the registry's own alias equality.
  if (left.type === 'project' && right.type === 'project')
    return sameProjectIdentity(left.id, right.id);
  if (left.type === 'store' && right.type === 'store') return left.id === right.id;
  return false;
}

function pathOptions(globalDataDir: string | undefined): { globalDataDir?: string } {
  return globalDataDir === undefined ? {} : { globalDataDir };
}

/** One registry entry, with the root it points at. */
interface TypedRegistryEntry {
  id: string;
  type: 'project' | 'store';
  uid?: string;
  storeRoot: string;
}

/**
 * ENUMERATES the registry through its own reader.
 *
 * Enumeration is legitimate; what the boundary bans is resolving ONE store by
 * its display name, because that silently picks a winner between two Stores
 * that share one. Every by-name Store lookup in this file now goes through
 * `resolveStoreBinding` instead, which is why the file no longer imports the
 * compat reader at all.
 */
async function listTypedRegistryEntries(
  globalDataDir: string | undefined
): Promise<TypedRegistryEntry[]> {
  const registry = await readStoreRegistryState(pathOptions(globalDataDir));
  if (!registry) return [];
  return listStoreRegistryEntries(registry).map((entry) => ({
    id: entry.id,
    type: entry.type,
    ...(entry.uid !== undefined ? { uid: entry.uid } : {}),
    storeRoot: entry.backend.local_path,
  }));
}

async function inspectTypedRegistryEntry(
  entry: TypedRegistryEntry,
  expectedType: 'project' | 'store'
): Promise<ResolvedNonGlobalOwner> {
  const inspection = await inspectRegisteredStore(entry.id, entry.storeRoot);
  if (inspection.kind !== 'ok') {
    fail(
      'knowledge_owner_stale',
      `${expectedType === 'project' ? 'Project' : 'Store'} '${entry.id}' is registered, but its identity metadata or Rasen root is stale. Run \`rasen store doctor ${entry.id}\` and repair the registration before retrying.`,
      { owner: { type: expectedType, id: entry.id }, selectorGuidance }
    );
  }
  return { type: expectedType, id: entry.id, root: inspection.canonicalRoot };
}

/**
 * A project-namespace store entry is a locator, not a second project identity.
 * When its root also carries the normal project config/machine identity, keep
 * that stable projectId as the canonical knowledge owner.
 */
async function canonicalizeProjectLocator(
  entry: TypedRegistryEntry,
  globalDataDir: string | undefined
): Promise<Extract<ResolvedKnowledgeOwnerRef, { type: 'project' }>> {
  const located = await inspectTypedRegistryEntry(entry, 'project');
  const root = located.root;
  const configuredId = readProjectConfig(root)?.projectId;
  const registered = await findProjectRegistryEntry(root, pathOptions(globalDataDir));

  if (registered) {
    if (!sameProjectIdentity(configuredId, registered.entry.projectId)) {
      fail(
        'knowledge_owner_stale',
        `Project locator '${entry.id}' resolves to ${root}, but its project registry and config identities do not match. Run \`rasen init\` in that project or repair its registry entry.`,
        { owner: { type: 'project', id: entry.id }, selectorGuidance }
      );
    }
    return {
      type: 'project',
      id: registered.entry.projectId,
      root: registered.canonicalPath,
    };
  }

  // Config identity remains the stable project identity even before this
  // machine has created a project home. The downstream store resolver will
  // still refuse a mutation until `rasen init` registers that home.
  if (configuredId) {
    return { type: 'project', id: configuredId, root };
  }

  // Preserve typed project locators for roots that predate projectId config.
  return { type: 'project', id: entry.id, root };
}

async function resolveMachineProjectById(
  id: string,
  globalDataDir: string | undefined
): Promise<Extract<ResolvedKnowledgeOwnerRef, { type: 'project' }> | null> {
  const matches = await findProjectIdentityClaimants(
    id,
    pathOptions(globalDataDir)
  );
  if (
    matches.length > 1 ||
    matches.some(match => match.fixedMetadataConflict)
  ) {
    fail(
      'knowledge_owner_ambiguous',
      formatProjectIdentityAmbiguity(id, matches),
      { owner: { type: 'project', id }, selectorGuidance }
    );
  }
  if (matches.length === 0) return null;
  const [{ path: root, entry, live }] = matches;
  if (
    !live ||
    !sameProjectIdentity(readProjectConfig(root)?.projectId, entry.projectId)
  ) {
    fail(
      'knowledge_owner_stale',
      `Project owner '${id}' no longer resolves to matching project registry and config identity facts. Run \`rasen init\` in that project or repair its registry entry.`,
      { owner: { type: 'project', id }, selectorGuidance }
    );
  }
  return { type: 'project', id, root: canonicalizeOrResolve(root) };
}

/**
 * Resolves a `--store <selector>` through the single Store resolver.
 *
 * The selector may be the Store's permanent identity or its display name, and
 * the difference matters: a display name that matches two registered Stores
 * comes back `unavailable` with both candidates named, instead of one of them
 * being picked by registry order. That is exactly the situation a Store
 * catalog must never guess at — the wrong guess publishes a team's knowledge
 * into someone else's repository.
 */
async function resolveStoreOwner(
  id: string,
  globalDataDir: string | undefined
): Promise<Extract<ResolvedKnowledgeOwnerRef, { type: 'store' }>> {
  const binding = await resolveStoreBinding({
    declaration: isValidStoreUid(id) ? { form: 'durable', uid: id } : { form: 'alias', id },
    ...pathOptions(globalDataDir),
  });

  if (binding.kind === 'resolved') {
    return {
      type: 'store',
      id: binding.store.id,
      ...(binding.store.uid !== undefined ? { uid: binding.store.uid } : {}),
      root: binding.store.root,
    };
  }
  if (binding.kind === 'absent') {
    fail(
      'knowledge_owner_unknown',
      `Unknown store knowledge owner '${id}'. Run \`rasen store list\` to inspect registered stores.`,
      { owner: { type: 'store', id }, selectorGuidance }
    );
  }
  // A store that is registered but unusable is a DIFFERENT problem from one
  // that was never registered, and the repair differs too — so the reason and
  // the repair travel with the failure rather than collapsing into "unknown".
  fail(
    binding.reason === 'not-registered' ? 'knowledge_owner_unknown' : 'knowledge_owner_stale',
    describeUnavailableStore(binding),
    { owner: { type: 'store', id }, selectorGuidance: [...binding.repair, ...selectorGuidance] }
  );
}

async function resolveTypedOwner(
  identity: Exclude<KnowledgeOwnerRef, { type: 'global' }>,
  globalDataDir: string | undefined
): Promise<ResolvedNonGlobalOwner> {
  if (identity.type === 'store') {
    return resolveStoreOwner(identity.id, globalDataDir);
  }

  const entries = await listTypedRegistryEntries(globalDataDir);
  const typed = entries.find((entry) => entry.type === 'project' && entry.id === identity.id);
  if (typed) return canonicalizeProjectLocator(typed, globalDataDir);

  const machineProject = await resolveMachineProjectById(identity.id, globalDataDir);
  if (machineProject) return machineProject;

  fail(
    'knowledge_owner_unknown',
    `Unknown project knowledge owner '${identity.id}'. Run \`rasen store list\` to inspect registered typed ids.`,
    { owner: identity, selectorGuidance }
  );
}

async function resolvePlanningRoot(
  launchDirectory: string,
  globalDataDir: string | undefined
): Promise<ResolvedKnowledgePlanningRootRef | undefined> {
  const root = findQualifyingRootSync(launchDirectory);
  if (!root) return undefined;
  const canonicalRoot = canonicalizeOrResolve(root);
  const entries = await listTypedRegistryEntries(globalDataDir);
  const exact = entries.filter((entry) => pathsEqual(entry.storeRoot, canonicalRoot));

  // "Is this planning root a Store's own root?" is answered by the resolver's
  // read-only lookup, so no consumer has to enumerate the registry to ask.
  // Health is still checked here, exactly as before: a Store whose metadata or
  // root has gone stale is reported as stale rather than named as a planning
  // root that would fail at the next step.
  const storeAtRoot = await findRegisteredStoreAtRoot(canonicalRoot, pathOptions(globalDataDir));
  if (storeAtRoot) {
    const owner = await inspectTypedRegistryEntry(
      { id: storeAtRoot.id, type: 'store', storeRoot: storeAtRoot.root },
      'store'
    );
    return {
      type: 'store',
      id: owner.id,
      ...(storeAtRoot.uid !== undefined ? { uid: storeAtRoot.uid } : {}),
      root: owner.root,
    };
  }

  const classification = classifyOpenSpecDir(canonicalRoot);
  // "Does this repo declare a Store?" is `hasStoreDeclaration`, never
  // `pointer.value !== undefined`: a durable declaration records only the
  // permanent identity, leaving the display alias undefined, so the old test
  // silently read a uid-only pointer as "no declaration" and fell through.
  // Resolution then goes through the single identity resolver rather than an
  // alias lookup in the registry, which cannot address two Stores that share
  // a display name.
  if (!classification.hasPlanningShape && hasStoreDeclaration(classification.pointer)) {
    const binding = await resolveStoreBinding({
      declaration: storeBindingDeclarationFrom(classification.pointer),
      projectRoot: canonicalRoot,
      ...pathOptions(globalDataDir),
    });
    if (binding.kind === 'resolved') {
      return {
        type: 'store',
        id: binding.store.id,
        ...(binding.store.uid !== undefined ? { uid: binding.store.uid } : {}),
        root: binding.store.root,
      };
    }
  }

  const typedProject = exact.find((entry) => entry.type === 'project');
  if (typedProject) {
    const owner = await canonicalizeProjectLocator(typedProject, globalDataDir);
    return { type: 'project', id: owner.id!, root: owner.root! };
  }

  const registered = await findProjectRegistryEntry(
    canonicalRoot,
    pathOptions(globalDataDir)
  );
  if (registered) {
    return {
      type: 'project',
      id: registered.entry.projectId,
      root: registered.canonicalPath,
    };
  }

  const configuredId = readProjectConfig(canonicalRoot)?.projectId;
  return configuredId
    ? { type: 'project', id: configuredId, root: canonicalRoot }
    : undefined;
}

async function resolveLaunchOwner(
  launchDirectory: string,
  requestedScope: LearnedSkillScope | 'mixed' | undefined,
  globalDataDir: string | undefined
): Promise<ResolvedKnowledgeOwnerRef> {
  if (requestedScope === 'global') return { type: 'global' };

  const root = findQualifyingRootSync(launchDirectory);
  if (!root) {
    fail(
      'knowledge_owner_unknown',
      'No authoritative learned-skill owner was found from this directory.',
      { selectorGuidance }
    );
  }
  const canonicalRoot = canonicalizeOrResolve(root);
  const entries = await listTypedRegistryEntries(globalDataDir);
  const exact = entries.filter((entry) => pathsEqual(entry.storeRoot, canonicalRoot));
  const typedProjects = exact.filter((entry) => entry.type === 'project');
  const typedStores = exact.filter((entry) => entry.type === 'store');

  if (typedProjects.length > 0 && typedStores.length > 0) {
    fail(
      'knowledge_owner_ambiguous',
      'This launch root is registered in both project and store namespaces. Pass an explicit typed knowledge-owner selector.',
      { selectorGuidance }
    );
  }

  if (typedStores.length === 1) {
    if (requestedScope === 'project' || requestedScope === 'mixed' || requestedScope === undefined) {
      fail(
        'knowledge_owner_ambiguous',
        `The operation was launched directly from store '${typedStores[0].id}', which does not identify one member project. Pass --project <id> or --store <id>.`,
        {
          planningRoot: { type: 'store', id: typedStores[0].id },
          selectorGuidance,
        }
      );
    }
    return inspectTypedRegistryEntry(typedStores[0], 'store');
  }

  if (typedProjects.length === 1) {
    return canonicalizeProjectLocator(typedProjects[0], globalDataDir);
  }

  const registered = await findProjectRegistryEntry(
    canonicalRoot,
    pathOptions(globalDataDir)
  );
  if (registered) {
    const configuredId = readProjectConfig(canonicalRoot)?.projectId;
    if (!sameProjectIdentity(configuredId, registered.entry.projectId)) {
      fail(
        'knowledge_owner_stale',
        `The registered project at ${canonicalRoot} no longer matches its projectId metadata. Run \`rasen init\` to repair it.`,
        {
          owner: { type: 'project', id: registered.entry.projectId },
          selectorGuidance,
        }
      );
    }
    return {
      type: 'project',
      id: registered.entry.projectId,
      root: registered.canonicalPath,
    };
  }

  fail(
    'knowledge_owner_stale',
    `The Rasen root at ${canonicalRoot} has no verified project registration. Run \`rasen init\` or pass an explicit typed selector.`,
    { selectorGuidance }
  );
}

function assertScopeAgreement(
  owner: ResolvedKnowledgeOwnerRef,
  requestedScope: LearnedSkillScope | 'mixed' | undefined,
  explicitSelector: KnowledgeOwnerRef | undefined,
  planningRoot: ResolvedKnowledgePlanningRootRef | undefined
): void {
  if (requestedScope === 'global' && owner.type !== 'global') {
    fail(
      'knowledge_owner_scope_mismatch',
      `Global learned-skill scope cannot use ${owner.type}:${owner.id} as its owner.`,
      {
        owner: ownerIdentity(owner),
        ...(planningRoot ? { planningRoot: planningIdentity(planningRoot) } : {}),
        selectorGuidance,
      }
    );
  }
  if (requestedScope === 'project' && owner.type !== 'project') {
    fail(
      'knowledge_owner_scope_mismatch',
      'Project learned-skill scope requires a project owner.',
      {
        owner: ownerIdentity(owner),
        ...(planningRoot ? { planningRoot: planningIdentity(planningRoot) } : {}),
        selectorGuidance,
      }
    );
  }
  if (requestedScope === 'store' && owner.type !== 'store') {
    fail(
      'knowledge_owner_scope_mismatch',
      'Store learned-skill scope requires a store owner. Pass --store <store>.',
      {
        owner: ownerIdentity(owner),
        ...(planningRoot ? { planningRoot: planningIdentity(planningRoot) } : {}),
        selectorGuidance,
      }
    );
  }
  if (requestedScope === 'mixed' && owner.type === 'global') {
    fail(
      'knowledge_owner_scope_mismatch',
      'An owner-scoped learned-skill read requires a project or store owner.',
      {
        owner: { type: 'global' },
        ...(planningRoot ? { planningRoot: planningIdentity(planningRoot) } : {}),
        selectorGuidance,
      }
    );
  }
  if (requestedScope === 'global' && explicitSelector?.type !== undefined) {
    fail(
      'knowledge_owner_scope_mismatch',
      'A global learned-skill operation cannot be combined with --project or --store.',
      {
        owner: explicitSelector,
        ...(planningRoot ? { planningRoot: planningIdentity(planningRoot) } : {}),
        selectorGuidance,
      }
    );
  }
}

/**
 * Does an explicitly supplied selector name the same owner the run was frozen
 * against? Compared on IDENTITY where the frozen record has one: a version 3
 * record settles on the Store's permanent identity, so a selector that names
 * the Store by its (possibly since-changed) display name still agrees, and a
 * namesake Store still does not.
 */
async function selectorAgreesWithFrozenOwner(
  explicitSelector: KnowledgeOwnerRef,
  frozenOwner: FrozenOwnerRef,
  globalDataDir: string | undefined
): Promise<boolean> {
  if (explicitSelector.type === 'global' || frozenOwner.type === 'global') {
    return explicitSelector.type === 'global' && frozenOwner.type === 'global';
  }
  if (sameOwner(explicitSelector, frozenRefDisplay(frozenOwner))) return true;
  if (sameOwner(explicitSelector, frozenRefLocator(frozenOwner))) return true;
  try {
    const resolved = await resolveTypedOwner(explicitSelector, globalDataDir);
    return sameResolvedAsFrozen(resolved, frozenOwner);
  } catch {
    // A newly supplied unknown/stale selector is still selector drift. Frozen
    // identity remains authoritative and is revalidated independently below.
    return false;
  }
}

/** Identity-first comparison of a resolved owner against a frozen ref. */
function sameResolvedAsFrozen(
  resolved: ResolvedKnowledgeOwnerRef,
  frozen: FrozenOwnerRef
): boolean {
  if (frozen.type === 'global' || resolved.type === 'global') {
    return frozen.type === 'global' && resolved.type === 'global';
  }
  if (frozen.type !== resolved.type) return false;
  if (frozen.type === 'store' && resolved.type === 'store') {
    if ('uid' in frozen && frozen.uid !== undefined) {
      return storeUidsMatch(resolved.uid, frozen.uid);
    }
    return resolved.id === frozen.id;
  }
  return sameOwner(ownerIdentity(resolved), frozenRefLocator(frozen));
}

/**
 * Resolves a frozen owner / planning root on THIS machine.
 *
 * A version 3 record names its subject by permanent identity, which resolves
 * regardless of renames and cannot be claimed by a namesake. A version 1 or 2
 * record carries only a display name, and resolving it is FAIL-CLOSED: exactly
 * one match continues the run; none, or several, stops it and reports what
 * could not be settled (the underlying resolver names every candidate). The one
 * outcome not allowed is picking a namesake, which is the failure the durable
 * shape exists to prevent.
 *
 * Nothing here writes: the record is left exactly as it was written.
 */
async function resolveFrozenOwner(
  ref: Exclude<FrozenOwnerRef, { type: 'global' }> | FrozenPlanningRootRef,
  globalDataDir: string | undefined,
  subject: 'owner' | 'planning root'
): Promise<ResolvedNonGlobalOwner> {
  const locator = frozenRefLocator(ref);
  const display = frozenRefDisplay(ref);
  if (ref.type === 'store' && isNameOnlyRef(ref)) {
    await assertLegacyStoreNameSettles(display.id, globalDataDir, subject);
  }
  try {
    return await resolveTypedOwner(locator, globalDataDir);
  } catch (error) {
    if (
      isKnowledgeContextError(error) &&
      error.diagnostic.code === 'knowledge_owner_unknown'
    ) {
      fail(
        'knowledge_owner_stale',
        `Frozen knowledge ${subject} ${display.type}:${display.id} no longer resolves on this machine. Repair its registry/config identity before resuming.`,
        { owner: display, selectorGuidance }
      );
    }
    throw error;
  }
}

/**
 * The fail-closed gate for a frozen record that names its Store by display
 * name only. It checks ARITY and nothing else: no match, or more than one, and
 * the run stops with the candidates named. Exactly one match falls through to
 * ordinary resolution, which then reports a broken-but-unambiguous Store as the
 * stale registration it is — a different problem with a different repair.
 */
async function assertLegacyStoreNameSettles(
  id: string,
  globalDataDir: string | undefined,
  subject: 'owner' | 'planning root'
): Promise<void> {
  const binding = await resolveStoreBinding({
    declaration: { form: 'alias', id },
    ...pathOptions(globalDataDir),
  });
  const unsettled =
    binding.kind === 'absent' ||
    (binding.kind === 'unavailable' &&
      (binding.reason === 'not-registered' || binding.reason === 'alias-ambiguous'));
  if (!unsettled) return;
  const detail =
    binding.kind === 'unavailable'
      ? describeUnavailableStore(binding)
      : `No store named '${id}' is registered on this machine.`;
  const repair = binding.kind === 'unavailable' ? [...binding.repair] : [];
  fail(
    'learned_owner_legacy_alias',
    `This run was frozen against ${subject} store '${id}' by display name only, and that name does not identify exactly one store on this machine. ${detail}`,
    { owner: { type: 'store', id }, selectorGuidance: [...repair, ...selectorGuidance] }
  );
}

/**
 * Resolves the deterministic execution context shared by every learned-skill
 * command. Planning-root identity and knowledge ownership are intentionally
 * resolved independently; canonical roots remain machine-local runtime data.
 */
export async function resolveLearnedSkillExecutionContext(
  input: ResolveLearnedSkillExecutionContextInput = {}
): Promise<LearnedSkillExecutionContext> {
  const launchDirectory = input.launchDirectory ?? process.cwd();
  const selector = input.selector ?? {};
  const explicitSelector = selectorIdentity(selector);
  // Resolution order (design D4): an explicit selector wins; then the
  // session's own recorded context; then, only when neither applies, the
  // working directory. A BROKEN session context throws here rather than
  // quietly dropping to the working directory — a silent fallback is exactly
  // how a command ends up resolving the checkout's own Store instead of the
  // one the session plans in.
  const sessionContext =
    input.sessionContext === undefined
      ? requireSessionRuntimeContext()
      : (input.sessionContext ?? undefined);
  // The session's recorded roots replace the working directory as the place
  // this resolver looks; the derivation applied to each is unchanged.
  //
  // They are two different questions and they take two different roots. WHERE
  // planning lives is the session's planning root. WHOSE knowledge this is
  // follows the project the session executes in — the same thing the working
  // directory used to answer, since a Store session's cwd IS its checkout. A
  // planning-only session executes in no project, so both fall to the
  // planning root.
  const planningDirectory = sessionContext ? sessionContext.planning.root : launchDirectory;
  const ownerDirectory = sessionContext
    ? sessionContext.execution.kind === 'project'
      ? sessionContext.execution.root
      : sessionContext.planning.root
    : launchDirectory;

  let owner: ResolvedKnowledgeOwnerRef;
  let planningRoot: ResolvedKnowledgePlanningRootRef | undefined;
  let source: LearnedSkillExecutionContext['source'];
  if (input.frozen) {
    owner =
      input.frozen.owner.type === 'global'
        ? { type: 'global' }
        : await resolveFrozenOwner(input.frozen.owner, input.globalDataDir, 'owner');
    const resolvedFrozenPlanning = await resolveFrozenOwner(
      input.frozen.planningRoot,
      input.globalDataDir,
      'planning root'
    );
    // Identity decides WHICH; the resolution decides where it is and what it
    // is currently called. Taking the display name from the resolution rather
    // than from the record is what lets a renamed Store keep owning the run
    // and still be reported under its current name.
    planningRoot =
      resolvedFrozenPlanning.type === 'store'
        ? {
            type: 'store',
            id: resolvedFrozenPlanning.id,
            ...(resolvedFrozenPlanning.uid !== undefined
              ? { uid: resolvedFrozenPlanning.uid }
              : {}),
            root: resolvedFrozenPlanning.root,
          }
        : {
            type: 'project',
            id: resolvedFrozenPlanning.id,
            root: resolvedFrozenPlanning.root,
          };
    if (
      explicitSelector &&
      !(await selectorAgreesWithFrozenOwner(
        explicitSelector,
        input.frozen.owner,
        input.globalDataDir
      ))
    ) {
      const frozenOwnerDisplay: KnowledgeOwnerRef =
        input.frozen.owner.type === 'global'
          ? { type: 'global' }
          : frozenRefDisplay(input.frozen.owner);
      fail(
        'knowledge_selector_conflict',
        `The supplied selector conflicts with frozen knowledge owner ${frozenOwnerDisplay.type}${frozenOwnerDisplay.type === 'global' ? '' : `:${frozenOwnerDisplay.id}`}.`,
        {
          owner: frozenOwnerDisplay,
          planningRoot: frozenRefDisplay(input.frozen.planningRoot),
          selectorGuidance,
        }
      );
    }
    source = 'run-state';
  } else {
    planningRoot = await resolvePlanningRoot(planningDirectory, input.globalDataDir);
    if (explicitSelector) {
      owner =
        explicitSelector.type === 'global'
          ? { type: 'global' }
          : await resolveTypedOwner(explicitSelector, input.globalDataDir);
      source = explicitSelector.type === 'project' ? 'explicit-project' : 'explicit-store';
    } else {
      owner = await resolveLaunchOwner(
        ownerDirectory,
        input.requestedScope,
        input.globalDataDir
      );
      source = sessionContext
        ? 'session-context'
        : owner.type === 'project'
          ? 'launch-project'
          : owner.type === 'store'
            ? 'direct-store'
            : 'launch-project';
    }
  }

  assertScopeAgreement(owner, input.requestedScope, explicitSelector, planningRoot);
  return {
    ...(planningRoot ? { planningRoot } : {}),
    owner,
    evaluationRoot: resolveEvaluationRoot(owner, sessionContext, ownerDirectory),
    source,
    ...(input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {}),
  };
}

/**
 * The checkout applicability is decided in — the second of the three roots.
 *
 * Precedence, and each step exists for a case that actually happens:
 *
 * 1. the session's own execution checkout, WHEN it belongs to the resolved
 *    owner — child C's stated precedence, and the only value that is right for
 *    a linked worktree or a second clone, both of which resolve `owner.root`
 *    away to the registered root;
 * 2. the working checkout, WHEN it is this project's — the ordinary case with
 *    no session;
 * 3. `owner.root` otherwise — which is what `--project <id>` needs: it names
 *    somebody else's project, and evaluating that project's applicability
 *    against the directory the command happened to run in would answer for the
 *    wrong tree.
 */
function resolveEvaluationRoot(
  owner: ResolvedKnowledgeOwnerRef,
  sessionContext: RuntimeContext | undefined,
  ownerDirectory: string
): string {
  if (owner.type !== 'project') return canonicalizeOrResolve(ownerDirectory);
  if (
    sessionContext?.execution.kind === 'project' &&
    sameProjectIdentity(sessionContext.execution.projectId, owner.id)
  ) {
    return canonicalizeOrResolve(sessionContext.execution.root);
  }
  const launchedRoot = findQualifyingRootSync(ownerDirectory);
  if (launchedRoot) {
    const canonical = canonicalizeOrResolve(launchedRoot);
    if (sameProjectIdentity(readProjectConfig(canonical)?.projectId, owner.id)) return canonical;
  }
  return owner.root;
}

/**
 * The three roots §15.6 keeps apart, resolved together so no caller has to
 * re-derive one of them from another.
 *
 * The source this change adapts conflated all three into "the current project
 * directory". Separating them is what lets two clones of one project share a
 * catalog while still deciding applicability, and writing generated files, in
 * the checkout actually being worked on.
 */
export interface LearnedSkillRoots {
  /** Where the project's own knowledge LIVES — identity-keyed, clone-independent. */
  canonicalOwnerRoot: string;
  /** Where applicability is DECIDED — the session's execution checkout. */
  evaluationRoot: string;
  /**
   * Where generated files are WRITTEN: a tool's project-local skill home
   * INSIDE {@link evaluationRoot}. Each tool composes its own subdirectory from
   * this root (`resolveToolSkillsRoot`), so the root is what travels and the
   * per-tool suffix stays the tool adapter's business.
   */
  materializationRoot: string;
}

/**
 * The three roots for one resolved execution context.
 *
 * A project owner that cannot resolve its canonical catalog (an unregistered
 * project, an identity that cannot key a directory) returns the refusal rather
 * than inventing a location — the same answer `resolveProjectStore` gives, not
 * a second opinion about it.
 */
export async function resolveLearnedSkillRoots(
  execution: LearnedSkillExecutionContext
): Promise<{ ok: true; roots: LearnedSkillRoots } | { ok: false; code: string; message: string }> {
  // One stated order, shared with effective.ts so the two cannot drift apart
  // again: session checkout → resolved project checkout → current directory.
  // Reaching for the current directory here while a resolved checkout existed
  // was the violation — it consults the last step after an earlier one has
  // already answered.
  const evaluationRoot = resolveEvaluationCheckout(execution);
  const resolution = await resolveProjectStore({ execution });
  if (!resolution.ok) {
    return { ok: false, code: resolution.code, message: resolution.message };
  }
  return {
    ok: true,
    roots: {
      canonicalOwnerRoot: resolution.store.root,
      evaluationRoot,
      materializationRoot: evaluationRoot,
    },
  };
}

/**
 * Freezes the run's typed identity.
 *
 * Version 3 is what a run records whenever every ref has a permanent identity:
 * that identity is the authority and the display name travels alongside for
 * readability, so a Store renamed after this point still owns the run and a
 * namesake never claims it. Its execution binding is recorded when the session
 * has one and omitted when it does not — the same "nothing to record" case
 * version 1 expressed, without giving up the durable identity.
 *
 * A Store whose metadata predates permanent identity has nothing durable to
 * record, so the record keeps its previous shape (version 1, or version 2 with
 * an execution binding) rather than the run being refused. Resolving such a
 * record on resume is fail-closed: exactly one match continues, none or several
 * stop the run with the candidates named.
 *
 * The frozen execution ref carries a `projectId` and NO root: the run-state
 * file is Git-tracked for a repo-local change, and a checkout root recorded
 * there would travel to another machine and misroute the resume.
 */
export function freezeKnowledgeContext(
  context: LearnedSkillExecutionContext,
  execution?: RuntimeExecutionRef
): FrozenKnowledgeContext {
  if (!context.planningRoot) {
    fail(
      'knowledge_owner_unknown',
      'A retain/codify run cannot freeze knowledge identity without a typed planning root.',
      { owner: ownerIdentity(context.owner), selectorGuidance }
    );
  }
  const frozenExecution: FrozenExecutionRef | undefined =
    execution === undefined
      ? undefined
      : execution.kind === 'planning-only'
        ? { kind: 'planning-only' }
        : { kind: 'project', projectId: execution.projectId };

  const durableOwner = durableOwnerIdentity(context.owner);
  const durablePlanning = durablePlanningIdentity(context.planningRoot);
  if (durableOwner !== undefined && durablePlanning !== undefined) {
    return {
      version: 3,
      planningRoot: durablePlanning,
      owner: durableOwner,
      ...(frozenExecution === undefined ? {} : { execution: frozenExecution }),
    };
  }

  const base = {
    planningRoot: planningIdentity(context.planningRoot),
    owner: ownerIdentity(context.owner),
  };
  if (frozenExecution === undefined) return { version: 1, ...base };
  return { version: 2, ...base, execution: frozenExecution };
}

/**
 * The execution binding a frozen record carries, or undefined when it recorded
 * none — a version 1 record (written before bindings existed) or a version 3
 * record for a run that had nothing to bind.
 */
export function frozenExecutionRef(
  frozen: FrozenKnowledgeContext
): FrozenExecutionRef | undefined {
  return frozen.version === 1 ? undefined : frozen.execution;
}
