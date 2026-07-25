/**
 * Resolves the complete launch context for a supervised Session. Callers pass
 * only wire selectors plus the trusted daemon launch-project fact; this module
 * owns planning attribution, execution selection, path identity, membership,
 * and attachment policy.
 */
import { resolveProjectSelector, resolveSpaceSelector } from '../config-api/project-addressing.js';
import { pathIsDirectory } from '../file-state.js';
import { readStorePointer } from '../project-config.js';
import { findProjectRegistryEntry } from '../project-registry.js';
import { deriveSpaceFromCwd } from '../root-selection.js';
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
  executionProject?: {
    projectId: string;
    root: string;
  };
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
          ...(project
            ? { executionProject: { projectId: project.ref.projectId, root: cwd } }
            : {}),
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
          executionProject: {
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
      const owner = await findProjectRegistryEntry(cwd);
      const pointer = readStorePointer(cwd);
      if (
        !(await pathIsDirectory(cwd)) ||
        !owner ||
        owner.entry.projectId !== project.ref.projectId ||
        owner.entry.mode !== 'store' ||
        pointer.malformed !== undefined ||
        pointer.value !== resolvedSpace.space.id
      ) {
        return {
          ok: false,
          status: 409,
          code: 'execution_unavailable',
          message: `Project "${selector}" is not a current live member of Store "${resolvedSpace.space.id}".`,
        };
      }
      const planningSpace = toSessionSpace(resolvedSpace.space);
      return {
        ok: true,
        context: {
          planningSpace,
          cwd,
          attachedRoots: planningSpace.root === cwd ? [] : [planningSpace.root],
          executionProject: {
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
        executionProject: {
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
