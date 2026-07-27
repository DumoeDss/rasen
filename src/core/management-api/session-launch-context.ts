/**
 * Resolves the complete launch context for a supervised Session. Callers pass
 * only wire selectors plus the trusted daemon launch-project fact; this module
 * owns planning attribution, execution selection, path identity, membership,
 * and attachment policy.
 */
import * as path from 'node:path';

import { resolveProjectSelector, resolveSpaceSelector } from '../config-api/project-addressing.js';
import { storeBindingDeclarationFrom } from '../effective-config.js';
import { pathIsDirectory } from '../file-state.js';
import { hasStoreDeclaration, readProjectConfig, readStorePointer } from '../project-config.js';
import { findProjectRegistryEntry } from '../project-registry.js';
import { deriveSpaceFromCwd } from '../root-selection.js';
import { resolveStoreBinding } from '../store/identity.js';
import { resolveProjectMembership } from '../store/membership.js';
import type { ResolvedStoreRef } from '../store/identity-types.js';
import type { RuntimeExecutionRef } from '../session-runtime-context.js';
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
  /**
   * What this session works on. Always present: a Store session that works on
   * no project reports `{ kind: 'planning-only' }` explicitly, never an
   * omitted field (unified-session-runtime-context task 3.3).
   */
  execution: RuntimeExecutionRef;
}

export type SessionLaunchContextResult =
  | { ok: true; context: ResolvedSessionLaunchContext }
  | { ok: false; status: number; code: string; message: string };

function toSessionSpace(space: {
  type: 'project' | 'store';
  id: string;
  root: string;
}): SessionSpace {
  return { type: space.type, id: space.id, root: space.root };
}

/** Canonical comparison so a separator or drive-letter difference is not a different root (design D8). */
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

/**
 * THE membership seam (design D6). A Store session may work on a project only
 * when the Store's own membership record vouches for it — the record under the
 * Store's metadata directory named by the project's permanent identity,
 * resolved through `resolveProjectMembership`. The project's own durable Store
 * declaration is a LOCATOR and SHALL NOT vouch for the project here. The
 * declaration MAY be consulted by the caller, ONLY to shape the rejection
 * diagnostic when this function returns false.
 */
async function storePermitsProject(
  space: { id: string; root: string },
  projectId: string
): Promise<boolean> {
  const store: ResolvedStoreRef = { type: 'store', id: space.id, root: space.root };
  const membership = await resolveProjectMembership(store, projectId).catch(() => null);
  return membership !== null;
}

export async function resolveSessionLaunchContext(
  input: ResolveSessionLaunchContextInput
): Promise<SessionLaunchContextResult> {
  const execution = input.execution;
  if (
    execution !== undefined &&
    (typeof execution !== 'string' ||
      (execution !== 'planning' &&
        (!execution.startsWith('project:') ||
          execution.length === 'project:'.length)))
  ) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_execution',
      message: 'execution must be "planning" or a non-empty "project:<selector>" value.',
    };
  }

  if (input.space !== undefined) {
    const resolvedSpace = await resolveSpaceSelector(input.space);
    if (!resolvedSpace.ok) return resolvedSpace;

    if (resolvedSpace.space.type === 'project' && execution === undefined) {
      const project = await resolveProjectSelector(resolvedSpace.space.root);
      const cwd = FileSystemUtils.canonicalizeExistingPath(resolvedSpace.space.root);
      if (!(await pathIsDirectory(cwd))) {
        return {
          ok: false,
          status: 409,
          code: 'execution_unavailable',
          message: `Project planning space "${resolvedSpace.space.id}" is not available at its registered root.`,
        };
      }
      return {
        ok: true,
        context: {
          planningSpace: toSessionSpace(resolvedSpace.space),
          cwd,
          attachedRoots: [],
          // A project planning space whose own registry entry cannot be read
          // still executes in its checkout; it is recorded under the space's
          // own identity rather than reported as planning-only, which would
          // wrongly claim the session may not touch code.
          execution: {
            kind: 'project',
            projectId: project ? project.ref.projectId : resolvedSpace.space.id,
            root: cwd,
          },
        },
      };
    }

    if (resolvedSpace.space.type === 'project' && execution === 'planning') {
      return {
        ok: false,
        status: 400,
        code: 'invalid_execution',
        message: 'execution "planning" is only valid for a Store planning space.',
      };
    }

    if (
      resolvedSpace.space.type === 'project' &&
      execution?.startsWith('project:')
    ) {
      const selector = execution.slice('project:'.length);
      const project = await resolveProjectSelector(selector);
      if (!project) {
        return {
          ok: false,
          status: 404,
          code: 'execution_not_found',
          message: `No registered project or linked worktree matches "${selector}".`,
        };
      }
      if (project.ref.projectId !== resolvedSpace.space.id) {
        return {
          ok: false,
          status: 409,
          code: 'execution_unavailable',
          message: `Project "${selector}" does not belong to project planning space "${resolvedSpace.space.id}".`,
        };
      }
      const cwd = FileSystemUtils.canonicalizeExistingPath(project.root);
      if (!(await pathIsDirectory(cwd))) {
        return {
          ok: false,
          status: 409,
          code: 'execution_unavailable',
          message: `Project "${selector}" is not available at its registered root.`,
        };
      }
      const planningSpace = toSessionSpace(resolvedSpace.space);
      return {
        ok: true,
        context: {
          planningSpace,
          cwd,
          attachedRoots: planningSpace.root === cwd ? [] : [planningSpace.root],
          execution: {
            kind: 'project',
            projectId: project.ref.projectId,
            root: cwd,
          },
        },
      };
    }

    if (
      resolvedSpace.space.type === 'store' &&
      execution?.startsWith('project:') &&
      execution.length > 'project:'.length
    ) {
      const selector = execution.slice('project:'.length);
      const project = await resolveProjectSelector(selector);
      if (!project) {
        return {
          ok: false,
          status: 404,
          code: 'execution_not_found',
          message: `No registered project or linked worktree matches "${selector}".`,
        };
      }
      const cwd = FileSystemUtils.canonicalizeExistingPath(project.root);

      // Validation order is the spec's order, and each failure names its OWN
      // check rather than collapsing into one opaque "not a live member".
      if (!(await pathIsDirectory(cwd))) {
        return {
          ok: false,
          status: 409,
          code: 'execution_unavailable',
          message: `Project "${selector}" is not available at its registered root.`,
        };
      }

      // The checkout must actually BE the project that was chosen. Both
      // recorded identities are consulted: the machine registry entry and the
      // checkout's own config. A checkout whose config names a different
      // project is the wrong clone, however it got registered.
      const owner = await findProjectRegistryEntry(cwd);
      const configuredProjectId = readProjectConfig(cwd)?.projectId;
      if (
        !owner ||
        owner.entry.projectId !== project.ref.projectId ||
        (configuredProjectId !== undefined && configuredProjectId !== project.ref.projectId)
      ) {
        return {
          ok: false,
          status: 409,
          code: 'execution_identity_mismatch',
          message: `Checkout "${cwd}" does not record project "${project.ref.projectId}"; it records "${configuredProjectId ?? owner?.entry.projectId ?? 'no project'}".`,
        };
      }

      const pointer = readStorePointer(cwd);
      if (pointer.malformed !== undefined) {
        return {
          ok: false,
          status: 409,
          code: 'execution_unavailable',
          message: `Project "${selector}" has an unreadable store declaration; repair it with \`rasen doctor\` before launching a session against it.`,
        };
      }

      if (!(await storePermitsProject(resolvedSpace.space, project.ref.projectId))) {
        // The declaration is a LOCATOR and cannot vouch for the project. The
        // declaration helpers are consulted here ONLY to classify the
        // rejection diagnostic — never to re-grant eligibility. The
        // malformed-pointer branch above already handled `pointer.malformed`.
        const repairCommand = `rasen store add-project ${project.ref.projectId} --store ${resolvedSpace.space.id}`;
        let declarationNamesThisStore = false;
        if (hasStoreDeclaration(pointer)) {
          const binding = await resolveStoreBinding({
            declaration: storeBindingDeclarationFrom(pointer),
          }).catch(() => null);
          declarationNamesThisStore =
            binding?.kind === 'resolved' && rootsEqual(binding.store.root, resolvedSpace.space.root);
        }
        const message = declarationNamesThisStore
          ? `Store "${resolvedSpace.space.id}" has no membership record for project "${project.ref.projectId}", although the project's own declaration names this Store (legacy declaration-only install). Establish the record with \`${repairCommand}\`.`
          : `Store "${resolvedSpace.space.id}" does not record project "${project.ref.projectId}" as a member; the project's own declaration does not name this Store. Add it with \`${repairCommand}\`.`;
        return {
          ok: false,
          status: 409,
          code: 'execution_not_member',
          message,
        };
      }

      const planningSpace = toSessionSpace(resolvedSpace.space);
      return {
        ok: true,
        context: {
          planningSpace,
          cwd,
          attachedRoots: planningSpace.root === cwd ? [] : [planningSpace.root],
          execution: {
            kind: 'project',
            projectId: project.ref.projectId,
            root: cwd,
          },
        },
      };
    }

    if (resolvedSpace.space.type === 'store' && execution === 'planning') {
      const planningSpace = toSessionSpace(resolvedSpace.space);
      return {
        ok: true,
        context: {
          planningSpace,
          cwd: planningSpace.root,
          attachedRoots: [],
          // Explicit, not an omission: this session works on no project and
          // therefore has no code write root at all.
          execution: { kind: 'planning-only' },
        },
      };
    }

    if (resolvedSpace.space.type === 'store' && execution === undefined) {
      return {
        ok: false,
        status: 409,
        code: 'execution_required',
        message: `Store "${resolvedSpace.space.id}" requires an explicit execution project or planning-only selection.`,
      };
    }
  }

  if (input.space === undefined && execution === undefined && input.launchProject) {
    const cwd = FileSystemUtils.canonicalizeExistingPath(input.launchProject.root);
    const planningSpace = await deriveSpaceFromCwd(cwd);
    return {
      ok: true,
      context: {
        ...(planningSpace ? { planningSpace } : {}),
        cwd,
        attachedRoots:
          planningSpace && planningSpace.root !== cwd ? [planningSpace.root] : [],
        execution: {
          kind: 'project',
          projectId: input.launchProject.projectId,
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
