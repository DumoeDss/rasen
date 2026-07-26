/**
 * Where a resumed run executes (unified-session-runtime-context design D4).
 *
 * This is deliberately NOT a longer version of the first-command precedence
 * list. A frozen run already knows which project it belongs to, so:
 *
 *  - the **frozen identity is the authority** — it says WHICH project;
 *  - the session context, and failing that the current checkout, is the
 *    **local locator** — it says WHERE that project is on this machine;
 *  - an explicit selector **only cross-checks**; it can never retarget a run.
 *
 * And it fails closed. When the frozen project does not match the checkout the
 * session executes in, the command stops and names both identities and the
 * checkout. It never continues in another clone of the same project: a resume
 * that edits the wrong working tree produces a plausible-looking diff, which
 * is far more expensive to discover than an error.
 */
import * as path from 'node:path';

import { readProjectConfig } from '../project-config.js';
import { readProjectRegistryState } from '../project-registry.js';
import type { RuntimeContext } from '../session-runtime-context.js';
import type { FrozenExecutionRef } from '../learned-skills/types.js';
import { FileSystemUtils } from '../../utils/file-system.js';

/** Canonical comparison, so a drive-letter or separator difference is never a mismatch (design D8). */
function canonicalizeOrResolve(target: string): string {
  try {
    return FileSystemUtils.canonicalizeExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

export function checkoutsMatch(left: string, right: string): boolean {
  const a = canonicalizeOrResolve(left);
  const b = canonicalizeOrResolve(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

export type ExecutionBindingErrorCode =
  /** The frozen project is not the project the session executes in. */
  | 'project_binding_mismatch'
  /** Several registered checkouts carry the frozen project's identity. */
  | 'project_binding_ambiguous'
  /** No checkout of the frozen project could be located on this machine. */
  | 'project_binding_missing'
  /** An explicit selector named a different project than the frozen one. */
  | 'project_binding_selector_conflict';

export interface ExecutionBindingFailure {
  ok: false;
  code: ExecutionBindingErrorCode;
  /** The project the run is frozen against. */
  frozenProjectId: string;
  /** The identity actually found where the run would have continued, when one was found. */
  foundProjectId?: string;
  /** The checkout that produced `foundProjectId`, when there was one. */
  checkout?: string;
  /** Every candidate checkout, for the ambiguous case. */
  candidates?: string[];
}

export type ExecutionBindingResult =
  | { ok: true; kind: 'planning-only' }
  | { ok: true; kind: 'project'; projectId: string; root: string; source: 'session-context' | 'cwd' | 'registry' }
  /** The run recorded no execution binding (a version 1 frozen record). */
  | { ok: true; kind: 'unrecorded' }
  | ExecutionBindingFailure;

export interface ResolveFrozenExecutionInput {
  /** The frozen execution ref, or undefined for a run frozen before this existed. */
  frozen: FrozenExecutionRef | undefined;
  /** The session context this command runs under, when there is one. */
  sessionContext?: RuntimeContext | undefined;
  /** The working directory to consider when there is no session context. */
  cwd: string;
  /** An explicit project selector on the command; it only ever cross-checks. */
  explicitProjectId?: string | undefined;
  /** Machine data directory override for the registry read. */
  globalDataDir?: string | undefined;
}

/** Every registered checkout whose recorded identity is `projectId`. */
async function registeredCheckoutsFor(
  projectId: string,
  globalDataDir: string | undefined
): Promise<string[]> {
  const state = await readProjectRegistryState(
    globalDataDir === undefined ? {} : { globalDataDir }
  );
  if (!state) return [];
  const roots = Object.entries(state.projects)
    .filter(([, entry]) => entry.projectId === projectId)
    .map(([root]) => root)
    .sort();
  // Canonical dedupe (task 6.5): two registry keys that differ only by
  // drive-letter case or separator form name ONE checkout, and reporting them
  // as two candidates would be a spurious ambiguity failure.
  return roots.filter(
    (root, index) => !roots.slice(0, index).some((earlier) => checkoutsMatch(earlier, root))
  );
}

/** The project identity a checkout records for itself, if any. */
function checkoutIdentity(root: string): string | undefined {
  return readProjectConfig(root)?.projectId;
}

export async function resolveFrozenExecutionBinding(
  input: ResolveFrozenExecutionInput
): Promise<ExecutionBindingResult> {
  const frozen = input.frozen;
  if (frozen === undefined) return { ok: true, kind: 'unrecorded' };
  if (frozen.kind === 'planning-only') return { ok: true, kind: 'planning-only' };

  const frozenProjectId = frozen.projectId;

  // An explicit selector cross-checks and nothing more. Disagreeing with the
  // frozen identity is reported; it never retargets the run.
  if (
    input.explicitProjectId !== undefined &&
    input.explicitProjectId !== frozenProjectId
  ) {
    return {
      ok: false,
      code: 'project_binding_selector_conflict',
      frozenProjectId,
      foundProjectId: input.explicitProjectId,
    };
  }

  // The session context is the locator of first resort: it names the exact
  // checkout the session executes in, including which of several clones and
  // which linked worktree.
  const sessionExecution = input.sessionContext?.execution;
  if (sessionExecution && sessionExecution.kind === 'project') {
    if (sessionExecution.projectId !== frozenProjectId) {
      return {
        ok: false,
        code: 'project_binding_mismatch',
        frozenProjectId,
        foundProjectId: sessionExecution.projectId,
        checkout: sessionExecution.root,
      };
    }
    return {
      ok: true,
      kind: 'project',
      projectId: frozenProjectId,
      root: sessionExecution.root,
      source: 'session-context',
    };
  }

  if (sessionExecution && sessionExecution.kind === 'planning-only') {
    // The session works on no project at all, so it cannot be the local
    // address of a run frozen against one. Fail closed rather than reaching
    // for whichever clone happens to be registered.
    return {
      ok: false,
      code: 'project_binding_mismatch',
      frozenProjectId,
      checkout: input.sessionContext?.planning.root ?? input.cwd,
    };
  }

  // No session context. The current directory counts only when its OWN
  // recorded identity is the frozen project — never merely because it is
  // where the command was typed.
  const cwdIdentity = checkoutIdentity(input.cwd);
  if (cwdIdentity === frozenProjectId) {
    return {
      ok: true,
      kind: 'project',
      projectId: frozenProjectId,
      root: input.cwd,
      source: 'cwd',
    };
  }

  const candidates = await registeredCheckoutsFor(frozenProjectId, input.globalDataDir);
  if (candidates.length === 1) {
    return {
      ok: true,
      kind: 'project',
      projectId: frozenProjectId,
      root: candidates[0] as string,
      source: 'registry',
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      code: 'project_binding_ambiguous',
      frozenProjectId,
      candidates,
      ...(cwdIdentity !== undefined ? { foundProjectId: cwdIdentity } : {}),
      checkout: input.cwd,
    };
  }

  return {
    ok: false,
    code: 'project_binding_missing',
    frozenProjectId,
    ...(cwdIdentity !== undefined ? { foundProjectId: cwdIdentity } : {}),
    checkout: input.cwd,
  };
}
