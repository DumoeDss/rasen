/**
 * Per-class landing resolvers (design `file-placement-collapse-landing`, D1).
 *
 * The terminal file-placement model gives every file a change produces exactly
 * one class, and every class exactly one owner root:
 *
 * - 固定规划文件 / evidence / handoff / design-docs -> the PLANNING root
 * - probes / ephemera                              -> the EXECUTION root
 * - coordination                                   -> the machine root (CLI-owned)
 *
 * This module is the ONLY landing authority for the classes that derive from a
 * root plus a name. Every resolver here is pure: root (+ names) in, absolute
 * path out — no configuration branch, no filesystem probing, no directory
 * creation. Consumers create what they use (the existing resolver contract).
 *
 * Deliberately independent of `./change-work.js` and `./project-home.js`:
 * those exist to bridge to the frozen machine-home API and remain as the
 * LEGACY-READ bridge only. The terminal model must not depend on machine
 * identity at all — a project with no machine home still resolves every
 * landing path here.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FileSystemUtils } from '../utils/file-system.js';
import { WORKSPACE_DIR_NAME } from './config.js';
import { toKebabCase } from './id.js';

/**
 * The execution root's Rasen state directory. Distinct from the planning
 * root's `rasen/` (`WORKSPACE_DIR_NAME`): this one is hidden, holds only
 * regenerable material (ephemera, probe fallbacks), and whether it enters Git
 * is governed solely by the user's `.gitignore` — Rasen writes no ignore rules.
 */
export const EXECUTION_STATE_DIR_NAME = '.rasen';

/** `<changeRoot>/evidence` — reports, verification output, ship log. */
export const EVIDENCE_DIR_NAME = 'evidence';
/** `<changeRoot>/handoff` — handoff documents and relay prompts. */
export const HANDOFF_DIR_NAME = 'handoff';
/** `<executionRoot>/.rasen/changes/<change>/ephemera` — run-state, raw logs. */
export const EPHEMERA_DIR_NAME = 'ephemera';
/** `<executionRoot>/.rasen/probes/<change>/<probe>` — probe fallback only. */
export const PROBES_DIR_NAME = 'probes';
/** `<planningRoot>/rasen/design-docs` — root-level, outlives any one change. */
export const DESIGN_DOCS_DIR_NAME = 'design-docs';

/**
 * Evidence directory for a change: everything delivered WITH the Archive for
 * later re-running or review (`review-report.md`, `cso-report.md`,
 * `qa-report.md`, `benchmark-report.md`, `design-review-report.md`,
 * `review-cycle-report.md`, `verification-report.md`, `ship-log.md`, and
 * verification drivers). Inside the change directory, so the existing archive
 * flow carries it for free.
 */
export function evidenceDir(changeRoot: string): string {
  return path.join(changeRoot, EVIDENCE_DIR_NAME);
}

/**
 * Handoff directory for a change: relay knowledge for successor workers and
 * sessions (`<role>-<n>.md`, `relay-prompt.txt`). Inside the change directory
 * for the same reason as evidence.
 */
export function handoffDir(changeRoot: string): string {
  return path.join(changeRoot, HANDOFF_DIR_NAME);
}

/**
 * Ephemera directory for a change: run-state (`auto-run.json`,
 * `portfolio-run.json`, goal-loop run artifacts), raw logs and captures,
 * caches, regenerable intermediates. Lands in the EXECUTION root, which is
 * per-worktree by construction — this is what structurally eliminates the
 * cross-worktree run-state collision that a shared machine home produced.
 */
export function ephemeraDir(executionRoot: string, changeName: string): string {
  return path.join(
    executionRoot,
    EXECUTION_STATE_DIR_NAME,
    'changes',
    changeName,
    EPHEMERA_DIR_NAME
  );
}

/**
 * The documented FALLBACK landing for probe code — used only when no project
 * convention (`experiments/`, `prototypes/`, `tools/`, `fixtures/`, or a
 * module-adjacent location) can be identified. Probes have no machine-root
 * option: they are a project deliverable and must enter code history.
 */
export function probesFallbackDir(
  executionRoot: string,
  changeName: string,
  probeName: string
): string {
  return path.join(executionRoot, EXECUTION_STATE_DIR_NAME, PROBES_DIR_NAME, changeName, probeName);
}

/**
 * Design-docs directory: root-level in the PLANNING root. Design docs belong
 * to no single change (they pre-date any change and outlive it through
 * `Supersedes:` lineage), so they never land under a change directory — and
 * never under the machine root, where they would be invisible to the repo.
 */
export function designDocsDir(planningRoot: string): string {
  return path.join(planningRoot, WORKSPACE_DIR_NAME, DESIGN_DOCS_DIR_NAME);
}

/**
 * Archive bookkeeping directory: always `<planningRoot>/rasen/changes/archive`
 * (the same constants `makeRoot` uses). No configuration redirects it — the
 * `archive.destination` axis is retired.
 */
export function archiveBookkeepingDir(planningRoot: string): string {
  return path.join(planningRoot, WORKSPACE_DIR_NAME, 'changes', 'archive');
}

// -----------------------------------------------------------------------------
// Execution root
// -----------------------------------------------------------------------------
//
// There is deliberately no `resolveExecutionRoot()` here. Execution authority
// is a capability the resolved planning scope carries
// (`resolvedExecutionProjectRoot` in `./root-selection.ts`), never something a
// landing resolver derives by probing the current directory for a `.git`
// ancestor: `specs/file-placement/spec.md` requires that unavailable execution
// authority stay unavailable rather than being inferred from cwd, a Store
// checkout, or Store membership.

// -----------------------------------------------------------------------------
// Workspace identity (design D5)
// -----------------------------------------------------------------------------

export interface WorkspaceIdentity {
  /** Human-readable kebab-case name derived from the worktree's basename. */
  name: string;
  /** Short anti-collision id: first 8 hex of sha256(canonicalized path). */
  shortId: string;
  /** `<name>--<shortId>` — the key for workspace-scoped machine-root state. */
  id: string;
  /** The canonicalized worktree path the id was derived from. */
  canonicalPath: string;
}

/**
 * Derives the workspace identity for a Git worktree (原则 7: one Git worktree
 * = one workspace identity). The semantic name keeps it human-readable; the
 * short hash of the CANONICALIZED worktree path is what distinguishes two
 * worktrees of one project — the property a shared project home lacks, and
 * the reason same-named changes in two worktrees used to collide.
 *
 * Read-only: canonicalization touches the filesystem, but nothing is created.
 * In particular, resolving an identity NEVER creates machine-root
 * `workspaces/<id>/` state — that directory is minted only by an actual
 * coordination writer, of which there are currently none.
 */
export function deriveWorkspaceIdentity(worktreePath: string): WorkspaceIdentity {
  const canonicalPath = FileSystemUtils.canonicalizeExistingPath(worktreePath);
  const name = toKebabCase(path.basename(canonicalPath)) || 'workspace';
  const shortId = createHash('sha256').update(canonicalPath).digest('hex').slice(0, 8);
  return { name, shortId, id: `${name}--${shortId}`, canonicalPath };
}
