/**
 * `issue-read-surface` design D1/D4 — the ONE place a caller's machine-local
 * run-state context is resolved for an Issue read.
 *
 * An Issue is Store content and reads from anywhere; the run-state that
 * explains what its nodes are doing right now is machine-local and is found by
 * walking out from a start path. The CLI's start path is the operator's
 * working directory; the daemon's is the project it was launched from. Both
 * resolve through this function so "which execution root did this read see"
 * has one answer shape and one failure mode.
 *
 * Never throws: an unresolvable start path is an ANSWER (`{}`), which the
 * projection reports as `runStateVisibility: { kind: 'none' }` and
 * committed-evidence-only observations. A read from a directory that is not a
 * Rasen project is not an error — it is a read with no live-run facts in
 * scope, and saying so is the honest degradation the spec requires.
 */
import { resolveOpenSpecRoot, resolvedExecutionProjectRoot } from '../root-selection.js';

/** The machine-local inputs `projectIssueStatus` reads run-state through. */
export interface IssueRunStateContext {
  readonly executionRoot?: string;
  readonly changesDir?: string;
  readonly projectRoot?: string;
}

/**
 * Probes `startPath` for a Rasen root, with the reporter off (a read surface
 * narrates nothing to stdout) and every failure answered with `{}`.
 * `undefined` start path — a daemon launched with no project root — skips the
 * probe entirely rather than falling back to the server process's own working
 * directory, which is not a fact about the request.
 */
export async function resolveRunStateContext(
  startPath: string | undefined
): Promise<IssueRunStateContext> {
  if (startPath === undefined) return {};
  try {
    const root = await resolveOpenSpecRoot({ startPath, reporter: false });
    return {
      executionRoot: resolvedExecutionProjectRoot(root),
      changesDir: root.changesDir,
      projectRoot: root.path,
    };
  } catch {
    return {};
  }
}
