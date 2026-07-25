import * as fs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../../utils/file-system.js';
import { readProjectConfig, classifyOpenSpecDir } from '../project-config.js';
import {
  findProjectRegistryEntry,
  readProjectRegistryState,
  type ProjectRegistryEntryState,
} from '../project-registry.js';
import {
  findQualifyingRootSync,
  inspectRegisteredStore,
} from '../root-selection.js';
import { listRegisteredStores, type RegisteredStoreEntry } from '../store/registry.js';
import type {
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
  | 'knowledge_store_scope_unavailable';

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

function pathExistsAsDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function ownerIdentity(owner: ResolvedKnowledgeOwnerRef): KnowledgeOwnerRef {
  return owner.type === 'global' ? { type: 'global' } : { type: owner.type, id: owner.id };
}

function planningIdentity(
  planningRoot: ResolvedKnowledgePlanningRootRef
): KnowledgePlanningRootRef {
  return { type: planningRoot.type, id: planningRoot.id };
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
  return (
    left.type === right.type &&
    (left.type === 'global' || (right.type !== 'global' && left.id === right.id))
  );
}

function pathOptions(globalDataDir: string | undefined): { globalDataDir?: string } {
  return globalDataDir === undefined ? {} : { globalDataDir };
}

async function inspectTypedRegistryEntry(
  entry: RegisteredStoreEntry,
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
  entry: RegisteredStoreEntry,
  globalDataDir: string | undefined
): Promise<Extract<ResolvedKnowledgeOwnerRef, { type: 'project' }>> {
  const located = await inspectTypedRegistryEntry(entry, 'project');
  const root = located.root;
  const configuredId = readProjectConfig(root)?.projectId;
  const registered = await findProjectRegistryEntry(root, pathOptions(globalDataDir));

  if (registered) {
    if (configuredId !== registered.entry.projectId) {
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
  const state = await readProjectRegistryState(pathOptions(globalDataDir));
  if (!state) return null;
  const matches = Object.entries(state.projects).filter(([, entry]) => entry.projectId === id);
  if (matches.length > 1) {
    fail(
      'knowledge_owner_ambiguous',
      `Project owner '${id}' resolves to more than one registered project root. Repair the project registry before retrying.`,
      { owner: { type: 'project', id }, selectorGuidance }
    );
  }
  if (matches.length === 0) return null;
  const [root, entry] = matches[0] as [string, ProjectRegistryEntryState];
  if (!pathExistsAsDirectory(root) || readProjectConfig(root)?.projectId !== entry.projectId) {
    fail(
      'knowledge_owner_stale',
      `Project owner '${id}' no longer resolves to matching project registry and config identity facts. Run \`rasen init\` in that project or repair its registry entry.`,
      { owner: { type: 'project', id }, selectorGuidance }
    );
  }
  return { type: 'project', id, root: canonicalizeOrResolve(root) };
}

async function resolveTypedOwner(
  identity: Exclude<KnowledgeOwnerRef, { type: 'global' }>,
  globalDataDir: string | undefined
): Promise<ResolvedNonGlobalOwner> {
  const entries = await listRegisteredStores(pathOptions(globalDataDir));
  const typed = entries.find(
    (entry) => entry.type === identity.type && entry.id === identity.id
  );
  if (typed) {
    return identity.type === 'project'
      ? canonicalizeProjectLocator(typed, globalDataDir)
      : inspectTypedRegistryEntry(typed, 'store');
  }

  if (identity.type === 'project') {
    const machineProject = await resolveMachineProjectById(identity.id, globalDataDir);
    if (machineProject) return machineProject;
  }

  fail(
    'knowledge_owner_unknown',
    `Unknown ${identity.type} knowledge owner '${identity.id}'. Run \`rasen store list\` to inspect registered typed ids.`,
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
  const entries = await listRegisteredStores(pathOptions(globalDataDir));
  const exact = entries.filter((entry) => pathsEqual(entry.storeRoot, canonicalRoot));

  const storeEntry = exact.find((entry) => entry.type === 'store');
  if (storeEntry) {
    const owner = await inspectTypedRegistryEntry(storeEntry, 'store');
    return { type: 'store', id: owner.id!, root: owner.root! };
  }

  const classification = classifyOpenSpecDir(canonicalRoot);
  if (
    !classification.hasPlanningShape &&
    classification.pointer.value !== undefined &&
    classification.pointer.malformed === undefined
  ) {
    const pointed = entries.find(
      (entry) => entry.type === 'store' && entry.id === classification.pointer.value
    );
    if (pointed) {
      const owner = await inspectTypedRegistryEntry(pointed, 'store');
      return { type: 'store', id: owner.id!, root: owner.root! };
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
  const entries = await listRegisteredStores(pathOptions(globalDataDir));
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
    if (configuredId !== registered.entry.projectId) {
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
  if (
    (requestedScope === 'project' || requestedScope === 'mixed') &&
    owner.type === 'global'
  ) {
    fail(
      'knowledge_owner_scope_mismatch',
      'Project learned-skill scope requires a project owner.',
      {
        owner: { type: 'global' },
        ...(planningRoot ? { planningRoot: planningIdentity(planningRoot) } : {}),
        selectorGuidance,
      }
    );
  }
  if (owner.type === 'store') {
    fail(
      'knowledge_store_scope_unavailable',
      `Store owner '${owner.id}' resolved successfully, but store-scoped learned-skill persistence is not available in this context slice.`,
      {
        owner: ownerIdentity(owner),
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

async function selectorAgreesWithFrozenOwner(
  explicitSelector: KnowledgeOwnerRef,
  frozenOwner: KnowledgeOwnerRef,
  globalDataDir: string | undefined
): Promise<boolean> {
  if (sameOwner(explicitSelector, frozenOwner)) return true;
  if (explicitSelector.type === 'global' || frozenOwner.type === 'global') return false;
  try {
    const resolved = await resolveTypedOwner(explicitSelector, globalDataDir);
    return sameOwner(ownerIdentity(resolved), frozenOwner);
  } catch {
    // A newly supplied unknown/stale selector is still selector drift. Frozen
    // identity remains authoritative and is revalidated independently below.
    return false;
  }
}

async function resolveFrozenOwner(
  identity: Exclude<KnowledgeOwnerRef, { type: 'global' }>,
  globalDataDir: string | undefined,
  subject: 'owner' | 'planning root'
): Promise<ResolvedNonGlobalOwner> {
  try {
    return await resolveTypedOwner(identity, globalDataDir);
  } catch (error) {
    if (
      isKnowledgeContextError(error) &&
      error.diagnostic.code === 'knowledge_owner_unknown'
    ) {
      fail(
        'knowledge_owner_stale',
        `Frozen knowledge ${subject} ${identity.type}:${identity.id} no longer resolves on this machine. Repair its registry/config identity before resuming.`,
        { owner: identity, selectorGuidance }
      );
    }
    throw error;
  }
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
    planningRoot = {
      type: input.frozen.planningRoot.type,
      id: input.frozen.planningRoot.id,
      root: resolvedFrozenPlanning.root!,
    };
    if (
      explicitSelector &&
      !(await selectorAgreesWithFrozenOwner(
        explicitSelector,
        input.frozen.owner,
        input.globalDataDir
      ))
    ) {
      fail(
        'knowledge_selector_conflict',
        `The supplied selector conflicts with frozen knowledge owner ${input.frozen.owner.type}${input.frozen.owner.type === 'global' ? '' : `:${input.frozen.owner.id}`}.`,
        {
          owner: input.frozen.owner,
          planningRoot: input.frozen.planningRoot,
          selectorGuidance,
        }
      );
    }
    source = 'run-state';
  } else {
    planningRoot = await resolvePlanningRoot(launchDirectory, input.globalDataDir);
    if (explicitSelector) {
      owner =
        explicitSelector.type === 'global'
          ? { type: 'global' }
          : await resolveTypedOwner(explicitSelector, input.globalDataDir);
      source = explicitSelector.type === 'project' ? 'explicit-project' : 'explicit-store';
    } else {
      owner = await resolveLaunchOwner(
        launchDirectory,
        input.requestedScope,
        input.globalDataDir
      );
      source =
        owner.type === 'project'
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
    source,
    ...(input.globalDataDir !== undefined ? { globalDataDir: input.globalDataDir } : {}),
  };
}

export function freezeKnowledgeContext(
  context: LearnedSkillExecutionContext
): FrozenKnowledgeContext {
  if (!context.planningRoot) {
    fail(
      'knowledge_owner_unknown',
      'A retain/codify run cannot freeze knowledge identity without a typed planning root.',
      { owner: ownerIdentity(context.owner), selectorGuidance }
    );
  }
  return {
    version: 1,
    planningRoot: planningIdentity(context.planningRoot),
    owner: ownerIdentity(context.owner),
  };
}
