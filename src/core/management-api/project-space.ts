import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from '../config.js';
import type {
  ResolvedSpace,
} from '../config-api/project-addressing.js';
import type { ProjectReadScope } from '../store-planning/index.js';
import { resolveProjectHome, type ProjectHome } from '../project-home.js';
import { ephemeraDir } from '../file-placement.js';
import type { StateFileLocationOptions } from '../pipeline-registry/run-state.js';

export type ProjectSpaceInput = ResolvedSpace | string | undefined;

/**
 * True only for a Store space that genuinely cannot select project content: a
 * Store **v2** aggregate. A legacy flat Store has no project catalog, so its
 * flat planning tree IS the project content a `store:` space addresses — the
 * CLI reads and writes it, and `specs/store-planning-scope-routing`
 * ("Equivalent entry points resolve identically") requires the API to agree.
 * Every management refusal keyed on "is this a Store space" must use this
 * instead of `space.type === 'store'`.
 */
export function isStoreAggregateSpace(space: ResolvedSpace | undefined): boolean {
  return space !== undefined &&
    space.type === 'store' &&
    space.planningScope.describe().kind !== 'legacy-store';
}

export interface ProjectContentSpace {
  /** Compatibility root for schema/config readers; never used to rebuild planning paths. */
  planningCheckoutRoot: string;
  projectHome: string;
  schemasDir?: string;
  changesDir: string;
  archiveDir?: string;
  executionRoot?: string;
  planningScope?: ProjectReadScope;
}

export type ProjectContentSpaceResult =
  | { ok: true; space: ProjectContentSpace }
  | { ok: false; status: number; code: string; message: string };

/**
 * Adapts management project-content handlers to one resolved planning scope.
 * The string form is retained only for direct legacy callers and unit tests.
 */
export function resolveProjectContentSpace(input: ProjectSpaceInput): ProjectContentSpaceResult {
  if (input === undefined) {
    return {
      ok: false,
      status: 400,
      code: 'project_required',
      message: 'No Rasen project is available for this server; launch `rasen ui` inside a project.',
    };
  }

  if (typeof input === 'string') {
    const projectHome = path.join(input, WORKSPACE_DIR_NAME);
    return {
      ok: true,
      space: {
        planningCheckoutRoot: input,
        projectHome,
        schemasDir: path.join(projectHome, 'schemas'),
        changesDir: path.join(projectHome, 'changes'),
        archiveDir: path.join(projectHome, 'changes', 'archive'),
        executionRoot: input,
      },
    };
  }

  if (input.type === 'store') {
    // Discriminate on LAYOUT, not on the `store:` prefix. A legacy flat Store
    // has no project catalog, so its flat `rasen/changes` IS the project
    // content a `store:` space addresses — the resolver already models it as
    // project-capable and hands back a full flat project shape. Refusing here
    // would make the management API stricter than the CLI, which lists and
    // writes that same content, and `specs/store-planning-scope-routing`
    // ("Equivalent entry points resolve identically") requires them to agree.
    // Only a Store v2 AGGREGATE genuinely cannot select a project implicitly.
    const paths = input.planningScope.describe().paths;
    const projectHome = paths['project-home'];
    const changesDir = paths['active-changes'];
    // Every location comes from the scope's typed addresses; this adapter joins
    // no Store path of its own. A legacy scope always supplies both, so the
    // guard below is a fail-closed assertion rather than a fallback.
    if (isStoreAggregateSpace(input) || projectHome === undefined || changesDir === undefined) {
      return {
        ok: false,
        status: 400,
        code: 'project_scope_required',
        message: 'Project content requires a project planning scope; a Store aggregate cannot select a project implicitly.',
      };
    }
    return {
      ok: true,
      space: {
        planningCheckoutRoot: input.root,
        projectHome,
        changesDir,
        ...(paths['project-schemas'] === undefined
          ? {}
          : { schemasDir: paths['project-schemas'] }),
        ...(paths['archive-line'] === undefined
          ? {}
          : { archiveDir: paths['archive-line'] }),
        ...(paths['execution-root'] === undefined
          ? {}
          : { executionRoot: paths['execution-root'] }),
      },
    };
  }

  return {
    ok: true,
    space: {
      planningCheckoutRoot: input.root,
      projectHome: input.projectHome,
      schemasDir: input.schemasDir,
      changesDir: input.changesDir,
      ...(input.archiveDir === undefined ? {} : { archiveDir: input.archiveDir }),
      ...(input.executionRoot === undefined ? {} : { executionRoot: input.executionRoot }),
      planningScope: input.planningScope,
    },
  };
}

/** Resolves an active Change through the capability when one is available. */
export async function resolveActiveChangeDir(
  space: ProjectContentSpace,
  changeId: string
): Promise<string> {
  if (space.planningScope) {
    return (await space.planningScope.openChange({ changeId })).location.absolutePath;
  }
  return path.join(space.changesDir, changeId);
}

/**
 * Reuses a caller-provided machine home, or resolves one read-only from the
 * execution checkout. A Store planning checkout is never used as a fallback.
 */
export async function resolveExecutionHome(
  space: ProjectContentSpace,
  home?: ProjectHome | null
): Promise<ProjectHome | null> {
  if (home !== undefined) return home;
  if (!space.executionRoot) return null;
  try {
    return await resolveProjectHome(space.executionRoot, { ensure: false });
  } catch {
    return null;
  }
}

/** Builds the sticky-legacy run-state search inputs without planning-root fallback. */
export function changeStateLocations(
  space: ProjectContentSpace,
  home: ProjectHome | null,
  changeId: string
): StateFileLocationOptions {
  return {
    ...(space.executionRoot === undefined
      ? {}
      : { ephemeraDir: ephemeraDir(space.executionRoot, changeId) }),
    workDir: home ? home.workDir(changeId) : null,
    ...(space.planningScope?.describe().kind === 'store-project'
      ? { includeChangeDir: false }
      : {}),
  };
}
