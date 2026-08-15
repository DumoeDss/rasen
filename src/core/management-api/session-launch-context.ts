/**
 * Resolves the complete launch context for a supervised Session. Planning
 * attribution comes from StorePlanning-backed management spaces; execution is
 * a separately verified project checkout.
 */
import * as path from 'node:path';

import {
  resolveProjectPlanningSpaceFromRoot,
  resolveProjectSelector,
  resolveSpaceSelector,
  type ResolvedProjectSpace,
  type ResolvedSpace,
  type ResolvedStoreSpace,
} from '../config-api/project-addressing.js';
import { storeBindingDeclarationFrom } from '../effective-config.js';
import { pathIsDirectory } from '../file-state.js';
import { hasStoreDeclaration, readProjectConfig, readStorePointer } from '../project-config.js';
import { findProjectRegistryEntry } from '../project-registry.js';
import type { RuntimeExecutionRef } from '../session-runtime-context.js';
import { resolveStoreBinding } from '../store/identity.js';
import { resolveProjectMembership } from '../store/membership.js';
import { storeUidsMatch, type ResolvedStoreRef } from '../store/identity-types.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import type { SessionSpace } from './session-registry.js';

export interface ResolveSessionLaunchContextInput {
  space?: string;
  /** Raw request value; parsed and validated here so malformed input never reaches spawn. */
  execution?: unknown;
  launchProject: {
    root: string;
    projectId: string;
    name: string;
  } | null;
}

export interface ResolvedSessionLaunchContext {
  planningSpace?: SessionSpace;
  cwd: string;
  attachedRoots: string[];
  execution: RuntimeExecutionRef;
}

export type SessionLaunchContextResult =
  | { ok: true; context: ResolvedSessionLaunchContext }
  | { ok: false; status: number; code: string; message: string };

type PlanningFacts = NonNullable<SessionSpace['planning']>;

/** Canonical comparison so a separator or drive-letter difference is not a different root. */
function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

export function rootsEqual(left: string, right: string): boolean {
  const a = canonicalizeOrResolve(left);
  const b = canonicalizeOrResolve(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

function planningFactsFor(space: ResolvedProjectSpace): PlanningFacts | undefined {
  const ref = space.planningScope.ref;
  if (ref.mode === 'store-project') {
    return {
      storeUid: ref.storeUid,
      storeId: ref.storeId,
      projectId: ref.projectId,
      ...(ref.targetLineId === undefined ? {} : { targetLineId: ref.targetLineId }),
    };
  }
  if (ref.mode === 'legacy-store') {
    return {
      ...(ref.storeUid === undefined ? {} : { storeUid: ref.storeUid }),
      storeId: ref.storeId,
      ...(ref.projectId === undefined ? {} : { projectId: ref.projectId }),
    };
  }
  return undefined;
}

function toSessionSpace(
  selected: ResolvedSpace,
  projectPlanning?: ResolvedProjectSpace
): SessionSpace {
  const planning = projectPlanning === undefined ? undefined : planningFactsFor(projectPlanning);
  return {
    type: selected.type,
    id: selected.id,
    root: selected.root,
    ...(planning === undefined ? {} : { planning }),
  };
}

function sameStore(
  left: { storeUid?: string; storeId: string },
  right: { storeUid?: string; storeId: string }
): boolean {
  if (left.storeUid !== undefined && right.storeUid !== undefined) {
    return storeUidsMatch(left.storeUid, right.storeUid);
  }
  return left.storeId === right.storeId;
}

function sameProjectPlanningScope(left: ResolvedProjectSpace, right: ResolvedProjectSpace): boolean {
  const a = left.planningScope.ref;
  const b = right.planningScope.ref;
  if (a.mode !== b.mode) return false;
  if (a.mode === 'standalone' && b.mode === 'standalone') return left.id === right.id;
  if (a.mode === 'legacy-store' && b.mode === 'legacy-store') {
    return sameStore(a, b) && a.projectId === b.projectId;
  }
  if (a.mode === 'store-project' && b.mode === 'store-project') {
    return sameStore(a, b) &&
      a.projectId === b.projectId &&
      a.targetLineId === b.targetLineId;
  }
  return false;
}

/**
 * THE membership seam (design D6, `specs/session-runtime-context/spec.md:212`).
 * A Store session may work on a project only when the Store's own membership
 * record vouches for it — the record under the Store's metadata directory
 * named by the project's permanent identity, resolved through
 * `resolveProjectMembership`. The project's own durable Store declaration is a
 * LOCATOR and SHALL NOT vouch for the project here. The declaration MAY be
 * consulted by the caller, ONLY to shape the rejection diagnostic when this
 * function returns false.
 *
 * This is deliberately NOT the project's effective planning scope: a project
 * whose own default planning Store is a different Store remains a valid choice
 * once THIS Store records it, because the session records its planning Store
 * explicitly (`spec.md:238-243`).
 */
async function storePermitsProject(
  space: { id: string; root: string },
  projectId: string
): Promise<boolean> {
  const store: ResolvedStoreRef = { type: 'store', id: space.id, root: space.root };
  const membership = await resolveProjectMembership(store, projectId).catch(() => null);
  return membership !== null;
}

/**
 * Rejection diagnostic only, never eligibility. Distinguishes a legacy
 * declaration-only install (the project points at this Store but no record
 * exists) from a project unrelated to it, and names the repair either way.
 */
async function membershipRejection(
  space: ResolvedStoreSpace,
  projectId: string,
  cwd: string
): Promise<{ ok: false; status: number; code: string; message: string }> {
  const repairCommand = `rasen store add-project ${projectId} --store ${space.id}`;
  const pointer = readStorePointer(cwd);
  let declarationNamesThisStore = false;
  if (hasStoreDeclaration(pointer)) {
    const binding = await resolveStoreBinding({
      declaration: storeBindingDeclarationFrom(pointer),
    }).catch(() => null);
    declarationNamesThisStore =
      binding?.kind === 'resolved' && rootsEqual(binding.store.root, space.root);
  }
  return {
    ok: false,
    status: 409,
    code: 'execution_not_member',
    message: declarationNamesThisStore
      ? `Store "${space.id}" has no membership record for project "${projectId}", although the project's own declaration names this Store (legacy declaration-only install). Establish the record with \`${repairCommand}\`.`
      : `Store "${space.id}" does not record project "${projectId}" as a member; the project's own declaration does not name this Store. Add it with \`${repairCommand}\`.`,
  };
}

async function resolveExecutionProject(selector: string): Promise<
  | { ok: true; projectId: string; project?: ResolvedProjectSpace; cwd: string }
  | { ok: false; status: number; code: string; message: string }
> {
  const registered = await resolveProjectSelector(selector);
  if (!registered) {
    return {
      ok: false,
      status: 404,
      code: 'execution_not_found',
      message: `No registered project or linked worktree matches "${selector}".`,
    };
  }
  const projectId = registered.ref.projectId;
  const cwd = canonicalizeOrResolve(registered.root);

  // Validation order is the spec's order, and each failure names its OWN check
  // rather than collapsing into one opaque diagnostic.
  if (!(await pathIsDirectory(cwd))) {
    return {
      ok: false,
      status: 409,
      code: 'execution_unavailable',
      message: `Project "${selector}" is not available at its registered root.`,
    };
  }

  // The checkout must actually BE the project that was chosen. Both recorded
  // identities are consulted: the machine registry entry and the checkout's own
  // config. A checkout whose config names a different project is the wrong
  // clone, however it got registered.
  const owner = await findProjectRegistryEntry(cwd);
  const configuredProjectId = readProjectConfig(cwd)?.projectId;
  if (
    !owner ||
    owner.entry.projectId !== projectId ||
    (configuredProjectId !== undefined && configuredProjectId !== projectId)
  ) {
    return {
      ok: false,
      status: 409,
      code: 'execution_identity_mismatch',
      message: `Checkout "${cwd}" does not record project "${projectId}"; it records "${configuredProjectId ?? owner?.entry.projectId ?? 'no project'}".`,
    };
  }

  // The execution project's OWN planning scope is enrichment used to freeze
  // planning facts on the Session — never authority, and never a gate. If it
  // cannot be resolved (an unusable Store declaration, say), the established
  // membership and identity diagnostics below must still be the ones the user
  // sees, so a failure here yields no facts rather than an early error.
  const planning = await resolveProjectPlanningSpaceFromRoot(cwd).catch(() => null);
  const project = planning && planning.ok && planning.space.type === 'project'
    ? planning.space
    : undefined;
  return { ok: true, projectId, ...(project === undefined ? {} : { project }), cwd };
}

function attachedPlanningRoot(planningRoot: string, cwd: string): string[] {
  return rootsEqual(planningRoot, cwd) ? [] : [planningRoot];
}

export async function resolveSessionLaunchContext(
  input: ResolveSessionLaunchContextInput
): Promise<SessionLaunchContextResult> {
  const execution = input.execution;
  if (
    execution !== undefined &&
    (typeof execution !== 'string' ||
      (execution !== 'planning' &&
        (!execution.startsWith('project:') || execution.length === 'project:'.length)))
  ) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_execution',
      message: 'execution must be "planning" or a non-empty "project:<selector>" value.',
    };
  }

  if (input.space !== undefined) {
    const selected = await resolveSpaceSelector(input.space);
    if (!selected.ok) return selected;
    const selectedSpace = selected.space;

    if (selectedSpace.type === 'project' && execution === 'planning') {
      return {
        ok: false,
        status: 400,
        code: 'invalid_execution',
        message: 'execution "planning" is only valid for a Store planning space.',
      };
    }

    if (selectedSpace.type === 'project') {
      let executionProject: ResolvedProjectSpace | undefined = selectedSpace;
      let cwd = selectedSpace.executionRoot;
      if (execution?.startsWith('project:')) {
        const resolved = await resolveExecutionProject(execution.slice('project:'.length));
        if (!resolved.ok) return resolved;
        if (
          resolved.projectId !== selectedSpace.id ||
          (resolved.project !== undefined &&
            !sameProjectPlanningScope(selectedSpace, resolved.project))
        ) {
          return {
            ok: false,
            status: 409,
            code: 'execution_unavailable',
            message: `Project "${resolved.projectId}" does not belong to project planning space "${selectedSpace.id}".`,
          };
        }
        executionProject = resolved.project;
        cwd = resolved.cwd;
      }
      if (cwd === undefined || !(await pathIsDirectory(cwd))) {
        return {
          ok: false,
          status: 409,
          code: 'execution_unavailable',
          message: `Project planning space "${selectedSpace.id}" has no available execution checkout.`,
        };
      }
      const canonicalCwd = canonicalizeOrResolve(cwd);
      const planningSpace = toSessionSpace(selectedSpace, executionProject);
      return {
        ok: true,
        context: {
          planningSpace,
          cwd: canonicalCwd,
          attachedRoots: attachedPlanningRoot(planningSpace.root, canonicalCwd),
          execution: {
            kind: 'project',
            projectId: selectedSpace.id,
            root: canonicalCwd,
          },
        },
      };
    }

    if (execution?.startsWith('project:')) {
      const resolved = await resolveExecutionProject(execution.slice('project:'.length));
      if (!resolved.ok) return resolved;
      // The Store's own membership RECORD vouches; the project's declaration
      // only locates. Deriving eligibility from the project's effective
      // planning scope would both grant a Store any project whose checkout
      // merely names it, and reject a genuinely recorded member that plans
      // elsewhere — the two directions `spec.md:219-224` and `:238-243` forbid.
      if (!(await storePermitsProject(selectedSpace, resolved.projectId))) {
        return membershipRejection(selectedSpace, resolved.projectId, resolved.cwd);
      }
      const planningSpace = toSessionSpace(selectedSpace, resolved.project);
      return {
        ok: true,
        context: {
          planningSpace,
          cwd: resolved.cwd,
          attachedRoots: attachedPlanningRoot(planningSpace.root, resolved.cwd),
          execution: {
            kind: 'project',
            projectId: resolved.projectId,
            root: resolved.cwd,
          },
        },
      };
    }

    if (execution === 'planning') {
      const planningSpace = toSessionSpace(selectedSpace);
      return {
        ok: true,
        context: {
          planningSpace,
          cwd: planningSpace.root,
          attachedRoots: [],
          execution: { kind: 'planning-only' },
        },
      };
    }

    return {
      ok: false,
      status: 409,
      code: 'execution_required',
      message: `Store "${selectedSpace.id}" requires an explicit execution project or planning-only selection.`,
    };
  }

  if (execution === undefined && input.launchProject) {
    const cwd = canonicalizeOrResolve(input.launchProject.root);
    if (!(await pathIsDirectory(cwd))) {
      return {
        ok: false,
        status: 409,
        code: 'execution_unavailable',
        message: 'The launch project checkout is unavailable.',
      };
    }
    // A launch directory that resolves to no project planning scope is not a
    // broken binding — it is simply not a planning root, and the baseline
    // launched there with no planning space attributed. The spec's error clause
    // covers "the binding is unavailable or inconsistent"
    // (`specs/planning-space-addressing/spec.md:93`), which presupposes a
    // Store-bound project; nothing in this child mandates refusing a bare
    // directory, and refusing would stop `rasen ui` from launching any session
    // outside a Rasen root.
    const resolved = await resolveProjectPlanningSpaceFromRoot(cwd).catch(() => null);
    if (!resolved || !resolved.ok || resolved.space.type !== 'project') {
      return {
        ok: true,
        context: {
          cwd,
          attachedRoots: [],
          execution: {
            kind: 'project',
            projectId: input.launchProject.projectId,
            root: cwd,
          },
        },
      };
    }
    const planningSpace = toSessionSpace(resolved.space, resolved.space);
    return {
      ok: true,
      context: {
        planningSpace,
        cwd,
        attachedRoots: attachedPlanningRoot(planningSpace.root, cwd),
        execution: {
          kind: 'project',
          projectId: resolved.space.id,
          root: cwd,
        },
      },
    };
  }

  return {
    ok: false,
    status: 409,
    code: 'no_project',
    message: 'No Rasen project is available for this server; select a space or launch `rasen ui` inside a project.',
  };
}
