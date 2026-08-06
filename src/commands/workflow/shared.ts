import { WORKSPACE_DIR_NAME } from '../../core/config.js';
/**
 * Shared Types and Utilities for Artifact Workflow Commands
 *
 * This module contains types, constants, and validation helpers used across
 * multiple artifact workflow commands.
 */

import chalk from 'chalk';
import path from 'path';
import * as fs from 'fs';
import { getSchemaDir, listSchemas } from '../../core/artifact-graph/index.js';
export { DEFAULT_SCHEMA } from '../../core/config.js';
import type { ReferenceIndexEntry } from '../../core/references.js';
import {
  isRootSelectionError,
  resolvedExecutionProjectRoot,
  type ResolvedOpenSpecRoot,
} from '../../core/root-selection.js';
import {
  evidenceDir,
  handoffDir,
  ephemeraDir,
} from '../../core/file-placement.js';
import {
  buildResolvedPlanningActionContext,
  type ActionContext,
} from '../../core/change-status-policy.js';
import { validateChangeName } from '../../utils/change-utils.js';
import type { ResolvedNextStep } from '../../core/workflow-chain.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ChangeCommandStatus {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  target?: string;
  fix?: string;
}

export interface TaskItem {
  id: string;
  description: string;
  done: boolean;
}

/**
 * The per-class landing directories a change-scoped payload always carries
 * (`file-placement` capability). Absolute, derived from the planning and
 * execution roots alone — no machine identity, no directory creation.
 */
export interface ChangeLandingDirs {
  /** `<changeRoot>/evidence` — reports, verification output, ship log. */
  evidenceDir: string;
  /** `<changeRoot>/handoff` — handoff documents and relay prompts. */
  handoffDir: string;
  /** `<executionRoot>/.rasen/changes/<change>/ephemera` — run-state, logs. */
  ephemeraDir?: string;
}

/**
 * Resolves the per-class landing directories for a change. Pure derivation
 * (plus the execution root's read-only `.git` walk for store-selected runs):
 * it mints no identity, registers nothing, and creates no directories.
 */
export function resolveChangeLandingDirs(
  root: ResolvedOpenSpecRoot,
  changeDir: string,
  changeName: string
): ChangeLandingDirs {
  const executionRoot = resolvedExecutionProjectRoot(root);
  return {
    evidenceDir: evidenceDir(changeDir),
    handoffDir: handoffDir(changeDir),
    ...(executionRoot === undefined ? {} : { ephemeraDir: ephemeraDir(executionRoot, changeName) }),
  };
}

/** Build the agent authority payload from the same frozen scope as its paths. */
export function resolvePlanningActionContext(
  root: ResolvedOpenSpecRoot,
  artifactIds: string[]
): ActionContext {
  const executionRoot = resolvedExecutionProjectRoot(root);
  const standaloneCompatibility =
    root.planningScope?.kind === 'standalone' ||
    (root.planningScope === undefined && root.storeType !== 'store');
  return buildResolvedPlanningActionContext({
    artifactIds,
    planningWriteRoots: [root.specsDir, root.changesDir],
    planningReadRoot: root.projectHome ?? root.path,
    ...(executionRoot === undefined ? {} : { executionRoot }),
    ...(standaloneCompatibility ? { compatibilityRoot: root.path } : {}),
  });
}

export interface ApplyInstructions {
  changeName: string;
  changeDir: string;
  schemaName: string;
  contextFiles: Record<string, string[]>;
  progress: {
    total: number;
    complete: number;
    remaining: number;
  };
  tasks: TaskItem[];
  state: 'blocked' | 'all_done' | 'ready';
  missingArtifacts?: string[];
  instruction: string;
  /** Referenced-store index (read-only upstream context; omitted when none declared) */
  references?: ReferenceIndexEntry[];
  /**
   * Legacy machine-home work directory (`change-work-dir` capability):
   * probe-only, present only when the project already has a machine identity.
   * Nothing NEW lands there — it exists so sticky-legacy readers can check it.
   */
  workDir?: string;
  /** `<changeRoot>/evidence` — always present (`file-placement` capability). */
  evidenceDir: string;
  /** `<changeRoot>/handoff` — always present (`file-placement` capability). */
  handoffDir: string;
  /** `<executionRoot>/.rasen/changes/<change>/ephemera` — always present. */
  ephemeraDir?: string;
  /**
   * Runtime-resolved next workflow(s), filtered to the installed workflow
   * set (design D1/D3/D4). Distinct from the artifact-authoring `nextSteps`
   * string array on `ChangeStatus` — this carries `{ workflow, reason }`.
   */
  nextWorkflows: ResolvedNextStep[];
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function statusFromError(error: unknown): ChangeCommandStatus {
  if (isRootSelectionError(error)) {
    return { ...error.diagnostic };
  }

  return {
    severity: 'error',
    code: 'change_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Checks if color output is disabled via NO_COLOR env or --no-color flag.
 */
export function isColorDisabled(): boolean {
  return process.env.NO_COLOR === '1' || process.env.NO_COLOR === 'true';
}

/**
 * Gets the color function based on status.
 */
export function getStatusColor(status: 'done' | 'ready' | 'blocked'): (text: string) => string {
  if (isColorDisabled()) {
    return (text: string) => text;
  }
  switch (status) {
    case 'done':
      return chalk.green;
    case 'ready':
      return chalk.yellow;
    case 'blocked':
      return chalk.red;
  }
}

/**
 * Gets the status indicator for an artifact.
 */
export function getStatusIndicator(status: 'done' | 'ready' | 'blocked'): string {
  const color = getStatusColor(status);
  switch (status) {
    case 'done':
      return color('[x]');
    case 'ready':
      return color('[ ]');
    case 'blocked':
      return color('[-]');
  }
}

/**
 * Returns the list of available change directory names under openspec/changes/.
 * Excludes the archive directory and hidden directories.
 */
export async function getAvailableChanges(
  projectRoot: string,
  changesDir = path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes')
): Promise<string[]> {
  const changesPath = changesDir;
  try {
    const entries = await fs.promises.readdir(changesPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name !== 'archive' && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Validates that a change exists and returns available changes if not.
 * Checks directory existence directly to support scaffolded changes (without proposal.md).
 */
export async function validateChangeExists(
  changeName: string | undefined,
  projectRoot: string,
  changesDir = path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes'),
  hints: { newChangeHint?: string } = {}
): Promise<string> {
  // Hints must stay pasteable: callers with a selected store pass a
  // store-carrying hint so following it lands in the same root.
  const newChangeHint = hints.newChangeHint ?? 'rasen new change <name>';

  if (!changeName) {
    const available = await getAvailableChanges(projectRoot, changesDir);
    if (available.length === 0) {
      throw new Error(`No changes found. Create one with: ${newChangeHint}`);
    }
    throw new Error(
      `Missing required option --change. Available changes:\n  ${available.join('\n  ')}`
    );
  }

  // Validate change name format to prevent path traversal
  const nameValidation = validateChangeName(changeName);
  if (!nameValidation.valid) {
    throw new Error(`Invalid change name '${changeName}': ${nameValidation.error}`);
  }

  // Check directory existence directly
  const changePath = path.join(changesDir, changeName);
  const exists = fs.existsSync(changePath) && fs.statSync(changePath).isDirectory();

  if (!exists) {
    const available = await getAvailableChanges(projectRoot, changesDir);
    if (available.length === 0) {
      throw new Error(
        `Change '${changeName}' not found. No changes exist. Create one with: ${newChangeHint}`
      );
    }
    throw new Error(
      `Change '${changeName}' not found. Available changes:\n  ${available.join('\n  ')}`
    );
  }

  return changeName;
}

/**
 * Validates that a schema exists and returns available schemas if not.
 *
 * @param schemaName - The schema name to validate
 * @param projectRoot - Optional project root for project-local schema resolution
 */
export function validateSchemaExists(
  schemaName: string,
  projectRoot?: string,
  projectSchemasDir?: string
): string {
  const schemaDir = getSchemaDir(schemaName, projectRoot, projectSchemasDir);
  if (!schemaDir) {
    const availableSchemas = listSchemas(projectRoot, projectSchemasDir);
    throw new Error(
      `Schema '${schemaName}' not found. Available schemas:\n  ${availableSchemas.join('\n  ')}`
    );
  }
  return schemaName;
}
