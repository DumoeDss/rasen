import * as os from 'node:os';
import * as path from 'node:path';

import { WORKSPACE_DIR_NAME } from './config.js';
import type { PlanningHome } from './planning-home.js';
import type { RuntimeExecutionRef, RuntimePlanningRef } from './session-runtime-context.js';

export interface PlanningHomeSummary {
  kind: 'repo';
  root: string;
  changesDir: string;
  defaultSchema: string;
}

/**
 * The file capability a session grants, stated as three separate lists
 * (unified-session-runtime-context design D5).
 *
 * `version` says which contract is being reported. Version 1 additionally
 * carries `allowedEditRoots`, the compatibility view for consumers that only
 * know the older single-list form — and it is present ONLY when the newer
 * capability projects into it WITHOUT granting anything the older form would
 * not have granted. Where that cannot hold, the version reported is 2 and
 * `allowedEditRoots` is absent, so an older consumer sees an unfamiliar
 * contract and stops rather than inheriting a root it never asked for.
 * Widening silently is the one outcome this projection must make impossible.
 */
export interface ActionContext {
  mode: 'repo-local';
  sourceOfTruth: 'repo';
  planningArtifacts: string[];
  linkedContext: Array<{ name: string }>;
  /** Which contract this object reports: 1 (with the compatibility view) or 2. */
  version: 1 | 2;
  /** Where planning artifacts may be written — the planning directories, never a repository root. */
  planningWriteRoots: string[];
  /** Where code may be written. EMPTY for a planning-only session, as a stated fact. */
  codeWriteRoots: string[];
  /** Roots the work may read. */
  readRoots: string[];
  /** Compatibility view of the older single-list form; present only when `version` is 1. */
  allowedEditRoots?: string[];
  requiresAffectedAreaSelection: boolean;
  constraints: string[];
}

/** The v2 view of a capability, for consumers that want only the new contract. */
export type ActionContextV2 = Pick<
  ActionContext,
  | 'version'
  | 'planningWriteRoots'
  | 'codeWriteRoots'
  | 'readRoots'
  | 'requiresAffectedAreaSelection'
  | 'constraints'
>;

export interface ChangeStatusPolicyArtifact {
  id: string;
  status: 'done' | 'ready' | 'blocked';
}

export interface ChangeNextStepsInput {
  changeName: string;
  artifactStatuses: ChangeStatusPolicyArtifact[];
  allArtifactsComplete: boolean;
  /** Selected store or project id; next-step commands must carry it. */
  storeId?: string;
  /** Namespace of storeId; absent/'store' renders --store, 'project' renders --project. */
  storeType?: 'store' | 'project';
  /** Complete scope selector, preferred over the legacy one-dimensional fields. */
  followupSelection?: {
    store?: string;
    project?: string;
    targetLine?: string;
  };
}

export interface ActionContextInput {
  projectRoot: string;
  artifactIds: string[];
  /**
   * The session's recorded planning and execution context, when the command
   * runs inside one. Absent means "resolve from the working directory exactly
   * as before this capability existed" — design D4's last-resort step.
   */
  session?: {
    planning: RuntimePlanningRef;
    execution: RuntimeExecutionRef;
  };
}

const VISIBILITY_CONSTRAINT =
  'A root made visible to the agent process (for example with --add-dir) is not authorization to write it; only the write roots above are writable.';

const PLANNING_ONLY_CONSTRAINT =
  'This session works on no project: it has no code write root, and no project-scoped materialization occurs.';

const SPLIT_ROOTS_CONSTRAINT =
  'Planning artifacts are written in the planning root; code changes are confined to the selected checkout. No other member checkout of the planning Store is writable.';

const REPO_LOCAL_CONSTRAINT =
  'Repo-local change artifacts and implementation edits are scoped to this project.';

export function summarizePlanningHome(
  planningHome: PlanningHome | undefined
): PlanningHomeSummary | undefined {
  if (!planningHome) {
    return undefined;
  }

  return {
    kind: planningHome.kind,
    root: planningHome.root,
    changesDir: planningHome.changesDir,
    defaultSchema: planningHome.defaultSchema,
  };
}

/**
 * Planning writes are narrowed to the planning directories rather than
 * granting a whole repository root (design D5): a session that may write
 * specs and changes has no business rewriting the repository around them.
 *
 * For standalone and legacy-flat layouts this is `<root>/rasen/specs` and
 * `<root>/rasen/changes`, which is correct. For a Store v2 project scope,
 * those root-level paths are exactly what layout v2 forbids — the project's
 * planning content lives under `<root>/rasen/projects/<projectId>/`. The
 * scope-derived form (`buildResolvedPlanningActionContext`, which receives
 * `[root.specsDir, root.changesDir]` from the resolved scope) already does
 * this correctly; this function is the straggler used by `buildActionContext`,
 * which sees only the raw `RuntimePlanningRef`.
 */
function planningDirectoriesOf(root: string): string[] {
  return [
    path.join(root, WORKSPACE_DIR_NAME, 'specs'),
    path.join(root, WORKSPACE_DIR_NAME, 'changes'),
  ];
}

/**
 * The planning write grant for a session's resolved planning scope. For a
 * Store v2 project scope (type `'store'` with a `projectId`), the grant is
 * the project partition's own planning locations — `rasen/projects/<id>/specs`
 * and `rasen/projects/<id>/changes` — not the root-level Store paths layout v2
 * forbids. For every other shape (standalone, project-type, store-aggregate
 * without a project), the legacy `planningDirectoriesOf` is correct.
 */
function planningWriteRootsForRef(ref: RuntimePlanningRef): string[] {
  if (ref.type === 'store' && ref.projectId !== undefined) {
    const projectBase = path.join(ref.root, WORKSPACE_DIR_NAME, 'projects', ref.projectId);
    return [
      path.join(projectBase, 'specs'),
      path.join(projectBase, 'changes'),
    ];
  }
  return planningDirectoriesOf(ref.root);
}

function normalizeRoot(root: string): string {
  return path.resolve(root);
}

function sameRoot(left: string, right: string): boolean {
  const a = normalizeRoot(left);
  const b = normalizeRoot(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

/** `child` is `parent` or lives under it. Used only for the narrowing check. */
function isWithinRoot(child: string, parent: string): boolean {
  if (sameRoot(child, parent)) return true;
  const relative = path.relative(normalizeRoot(parent), normalizeRoot(child));
  return (
    relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

function dedupeRoots(roots: readonly string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    if (!out.some((existing) => sameRoot(existing, root))) out.push(root);
  }
  return out;
}

/**
 * The smallest set covering the same paths: a root that lives under another
 * root in the set is dropped. Keeps the compatibility view identical to the
 * single root v1 used to report for a repo-local change, instead of listing
 * that root plus two of its own subdirectories.
 */
function minimizeRoots(roots: readonly string[]): string[] {
  return roots.filter(
    (root, index) =>
      !roots.some(
        (other, otherIndex) =>
          otherIndex !== index && !sameRoot(other, root) && isWithinRoot(root, other)
      )
  );
}

/**
 * A user's home directory is never a granted root — not for planning, not for
 * code, not even for reading. A project that HAPPENS to live under the home
 * directory is unaffected: only the home directory itself is rejected.
 *
 * The degenerate case is intentional and safe: when the project root IS the
 * home directory, `readRoots` and `codeWriteRoots` come back empty while
 * `planningWriteRoots` keeps `~/rasen/specs` and `~/rasen/changes`, because
 * those are subdirectories and only the home directory itself is filtered. A
 * session in that shape can write its own planning files and read nothing —
 * incoherent to look at, but this filter may only ever NARROW what was
 * granted. Do not "repair" it by re-admitting the home directory to any list,
 * or by widening the planning roots to cover the read gap: granting a read
 * root over `$HOME` is exactly the thing this function exists to refuse.
 */
function withoutHomeDirectory(roots: readonly string[]): string[] {
  let home: string;
  try {
    home = os.homedir();
  } catch {
    return [...roots];
  }
  if (!home) return [...roots];
  return roots.filter((root) => !sameRoot(root, home));
}

function planningRootOf(input: ActionContextInput): string {
  return input.session ? input.session.planning.root : input.projectRoot;
}

function executionOf(input: ActionContextInput): RuntimeExecutionRef {
  return (
    input.session?.execution ?? { kind: 'project', projectId: '', root: input.projectRoot }
  );
}

function constraintsFor(input: ActionContextInput, execution: RuntimeExecutionRef): string[] {
  if (execution.kind === 'planning-only') {
    return [PLANNING_ONLY_CONSTRAINT, VISIBILITY_CONSTRAINT];
  }
  if (input.session && !sameRoot(input.session.planning.root, execution.root)) {
    return [SPLIT_ROOTS_CONSTRAINT, VISIBILITY_CONSTRAINT];
  }
  return [REPO_LOCAL_CONSTRAINT, VISIBILITY_CONSTRAINT];
}

export function buildActionContext(input: ActionContextInput): ActionContext {
  const execution = executionOf(input);
  const planningRoot = planningRootOf(input);

  const planningWriteRoots = withoutHomeDirectory(
    dedupeRoots(
      input.session
        ? planningWriteRootsForRef(input.session.planning)
        : planningDirectoriesOf(planningRoot)
    )
  );
  // Exactly one checkout, always the session's own. Other member checkouts of
  // the same Store are never added here — that is the point of recording which
  // checkout the session executes in.
  const codeWriteRoots = withoutHomeDirectory(
    execution.kind === 'planning-only' ? [] : dedupeRoots([execution.root])
  );
  const readRoots = withoutHomeDirectory(
    dedupeRoots(
      execution.kind === 'planning-only' ? [planningRoot] : [planningRoot, execution.root]
    )
  );

  const union = dedupeRoots([...codeWriteRoots, ...planningWriteRoots]);
  // What v1 granted for this same context, verbatim: one root, the project
  // root the caller passed. The projection is reported as v1 only when every
  // root in the union is that root or lives under it — so the compatibility
  // view can only ever be narrower or equal, never broader.
  const priorV1Grant = [input.projectRoot];
  const projectable = union.every((root) =>
    priorV1Grant.some((granted) => isWithinRoot(root, granted))
  );

  return {
    mode: 'repo-local',
    sourceOfTruth: 'repo',
    planningArtifacts: input.artifactIds,
    linkedContext: [],
    version: projectable ? 1 : 2,
    planningWriteRoots,
    codeWriteRoots,
    readRoots,
    ...(projectable ? { allowedEditRoots: minimizeRoots(union) } : {}),
    requiresAffectedAreaSelection: false,
    constraints: constraintsFor(input, execution),
  };
}

export function buildResolvedPlanningActionContext(input: {
  artifactIds: string[];
  planningWriteRoots: string[];
  planningReadRoot: string;
  executionRoot?: string;
  /** Present only when the old single-root contract is an honest projection. */
  compatibilityRoot?: string;
}): ActionContext {
  const planningWriteRoots = withoutHomeDirectory(dedupeRoots(input.planningWriteRoots));
  const codeWriteRoots = withoutHomeDirectory(
    input.executionRoot === undefined ? [] : [input.executionRoot]
  );
  const readRoots = withoutHomeDirectory(
    dedupeRoots([
      input.planningReadRoot,
      ...(input.executionRoot === undefined ? [] : [input.executionRoot]),
    ])
  );
  const union = dedupeRoots([...planningWriteRoots, ...codeWriteRoots]);
  const projectable = input.compatibilityRoot !== undefined &&
    union.every((root) => isWithinRoot(root, input.compatibilityRoot as string));
  return {
    mode: 'repo-local',
    sourceOfTruth: 'repo',
    planningArtifacts: [...input.artifactIds],
    linkedContext: [],
    version: projectable ? 1 : 2,
    planningWriteRoots,
    codeWriteRoots,
    readRoots,
    ...(projectable ? { allowedEditRoots: minimizeRoots(union) } : {}),
    requiresAffectedAreaSelection: false,
    constraints: input.executionRoot === undefined
      ? [PLANNING_ONLY_CONSTRAINT, VISIBILITY_CONSTRAINT]
      : sameRoot(input.planningReadRoot, input.executionRoot)
        ? [REPO_LOCAL_CONSTRAINT, VISIBILITY_CONSTRAINT]
        : [SPLIT_ROOTS_CONSTRAINT, VISIBILITY_CONSTRAINT],
  };
}

export function buildNextSteps(input: ChangeNextStepsInput): string[] {
  const readyArtifact = input.artifactStatuses.find((artifact) => artifact.status === 'ready');
  const steps: string[] = [];

  if (readyArtifact) {
    const completeSelection = input.followupSelection;
    const storeFlag = completeSelection
      ? `${completeSelection.store === undefined ? '' : ` --store ${completeSelection.store}`}` +
        `${completeSelection.project === undefined ? '' : ` --project ${completeSelection.project}`}` +
        `${completeSelection.targetLine === undefined ? '' : ` --target-line ${completeSelection.targetLine}`}`
      : (() => {
          const flagName = input.storeType === 'project' ? '--project' : '--store';
          return input.storeId ? ` ${flagName} ${input.storeId}` : '';
        })();
    steps.push(
      `Run rasen instructions ${readyArtifact.id} --change "${input.changeName}"${storeFlag} --json before writing that artifact.`
    );
  } else if (input.allArtifactsComplete) {
    steps.push('All planning artifacts are complete; review tasks before implementation.');
  }

  return steps;
}
