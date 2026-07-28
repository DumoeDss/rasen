/**
 * Checkout-scoped runtime edit-boundary state and hook evaluation.
 *
 * This module is deliberately independent of generated/optional skills. State
 * is keyed by the canonical execution root and stored in Rasen's machine-data
 * directory so concurrent agents in one checkout observe the same boundary.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { FileSystemUtils } from '../utils/file-system.js';
import { getGlobalDataDir, type GlobalDataDirOptions } from './global-config.js';
import type {
  EditBoundaryEnforcement,
  HostRuntimeSource,
  RuntimeAdapterId,
} from './runtime-adapters.js';

export const EDIT_BOUNDARY_STATE_VERSION = 1 as const;
export const EDIT_BOUNDARY_STATE_RELATIVE_DIR = path.join(
  'runtime',
  'edit-boundaries'
);

export const EDIT_BOUNDARY_LIMITATIONS: Readonly<
  Record<EditBoundaryEnforcement, readonly string[]>
> = Object.freeze({
  hard: Object.freeze([
    'Only covered structured write tools are denied outside the boundary.',
    'Shell, MCP, external-process, and other unhooked writes are outside this contract.',
  ]),
  soft: Object.freeze([
    'The boundary requires agent cooperation and is not a host-enforced restriction.',
    'Shell, MCP, external-process, specialized, and unhooked writes may bypass it.',
  ]),
  unsupported: Object.freeze([
    'This runtime has no edit-boundary adapter; edits remain unrestricted.',
  ]),
});

export interface EditBoundaryStateRecord {
  version: typeof EDIT_BOUNDARY_STATE_VERSION;
  root: string;
  boundary: string;
  setByRuntime: RuntimeAdapterId;
  setByEnforcement: Exclude<EditBoundaryEnforcement, 'unsupported'>;
  updatedAt: string;
}

export type EditBoundaryAction = 'set' | 'status' | 'clear';

export interface EditBoundaryResult {
  version: typeof EDIT_BOUNDARY_STATE_VERSION;
  action: EditBoundaryAction;
  active: boolean;
  changed: boolean;
  root: string;
  boundary: string | null;
  runtime: RuntimeAdapterId | 'unknown';
  runtimeSource: HostRuntimeSource;
  enforcement: EditBoundaryEnforcement;
  statePath: string;
  limitations: readonly string[];
  warning?: string;
  error?: string;
}

export interface EditBoundaryOperationOptions extends GlobalDataDirOptions {
  cwd?: string;
  root?: string;
  runtime: RuntimeAdapterId | 'unknown';
  runtimeSource: HostRuntimeSource;
  enforcement: EditBoundaryEnforcement;
  now?: Date;
}

export interface EditBoundaryReadResult {
  record: EditBoundaryStateRecord | null;
  warning?: string;
}

type PathApi = Pick<
  typeof path,
  'relative' | 'isAbsolute' | 'sep'
>;

function isRecord(value: unknown): value is EditBoundaryStateRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === EDIT_BOUNDARY_STATE_VERSION &&
    typeof record.root === 'string' &&
    path.isAbsolute(record.root) &&
    typeof record.boundary === 'string' &&
    path.isAbsolute(record.boundary) &&
    (record.setByRuntime === 'claude' || record.setByRuntime === 'codex') &&
    (record.setByEnforcement === 'hard' || record.setByEnforcement === 'soft') &&
    typeof record.updatedAt === 'string'
  );
}

function pathExistsAsDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the checkout/execution root. The nearest `.git` or `rasen`
 * project marker wins; an uninitialized directory is scoped to itself.
 */
export function resolveEditBoundaryRoot(start = process.cwd()): string {
  const canonicalStart = FileSystemUtils.canonicalizeExistingPath(start);
  let current = pathExistsAsDirectory(canonicalStart)
    ? canonicalStart
    : path.dirname(canonicalStart);

  for (;;) {
    if (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, 'rasen', 'config.yaml')) ||
      fs.existsSync(path.join(current, 'rasen', 'config.yml'))
    ) {
      return FileSystemUtils.canonicalizeExistingPath(current);
    }
    const parent = path.dirname(current);
    if (parent === current) return canonicalStart;
    current = parent;
  }
}

/** Canonicalize an existing path or its nearest existing ancestor. */
export function canonicalizeEditTarget(target: string, cwd = process.cwd()): string {
  return FileSystemUtils.canonicalizeExistingPath(
    path.isAbsolute(target) ? target : path.resolve(cwd, target)
  );
}

/**
 * Separator-aware containment. Supplying `path.win32` makes Windows
 * drive-case, separator, and UNC behavior testable on every CI platform.
 */
export function isPathWithinBoundary(
  boundary: string,
  target: string,
  pathApi: PathApi = path
): boolean {
  const relative = pathApi.relative(boundary, target);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

function rootIdentity(root: string, platform = process.platform): string {
  const normalized = path.normalize(root);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function getEditBoundaryStatePath(
  root: string,
  options: GlobalDataDirOptions = {}
): string {
  const canonicalRoot = FileSystemUtils.canonicalizeExistingPath(root);
  const digest = createHash('sha256')
    .update(rootIdentity(canonicalRoot, options.platform))
    .digest('hex');
  return path.join(
    getGlobalDataDir(options),
    EDIT_BOUNDARY_STATE_RELATIVE_DIR,
    `${digest}.json`
  );
}

export function readEditBoundaryState(
  root: string,
  options: GlobalDataDirOptions = {}
): EditBoundaryReadResult {
  const canonicalRoot = FileSystemUtils.canonicalizeExistingPath(root);
  const statePath = getEditBoundaryStatePath(canonicalRoot, options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { record: null };
    }
    return {
      record: null,
      warning: `Ignored unreadable edit-boundary state at ${statePath}.`,
    };
  }
  if (!isRecord(parsed)) {
    return {
      record: null,
      warning: `Ignored invalid edit-boundary state at ${statePath}.`,
    };
  }
  const recordRoot = FileSystemUtils.canonicalizeExistingPath(parsed.root);
  if (rootIdentity(recordRoot, options.platform) !== rootIdentity(canonicalRoot, options.platform)) {
    return {
      record: null,
      warning: `Ignored edit-boundary state for a different execution root at ${statePath}.`,
    };
  }
  const boundary = FileSystemUtils.canonicalizeExistingPath(parsed.boundary);
  if (!isPathWithinBoundary(canonicalRoot, boundary)) {
    return {
      record: null,
      warning: `Ignored edit-boundary state whose boundary is outside its execution root at ${statePath}.`,
    };
  }
  return { record: { ...parsed, root: recordRoot, boundary } };
}

function resultBase(
  action: EditBoundaryAction,
  root: string,
  options: EditBoundaryOperationOptions
): Omit<EditBoundaryResult, 'active' | 'changed' | 'boundary'> {
  return {
    version: EDIT_BOUNDARY_STATE_VERSION,
    action,
    root,
    runtime: options.runtime,
    runtimeSource: options.runtimeSource,
    enforcement: options.enforcement,
    statePath: getEditBoundaryStatePath(root, options),
    limitations: EDIT_BOUNDARY_LIMITATIONS[options.enforcement],
  };
}

function writeStateAtomically(statePath: string, record: EditBoundaryStateRecord): void {
  const stateDir = path.dirname(statePath);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    stateDir,
    `.${path.basename(statePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, statePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function setEditBoundary(
  directory: string,
  options: EditBoundaryOperationOptions
): EditBoundaryResult {
  const cwd = options.cwd ?? process.cwd();
  const root = FileSystemUtils.canonicalizeExistingPath(
    options.root ?? resolveEditBoundaryRoot(cwd)
  );
  const base = resultBase('set', root, options);
  if (options.enforcement === 'unsupported' || options.runtime === 'unknown') {
    const state = readEditBoundaryState(root, options);
    const active = state.record !== null;
    return {
      ...base,
      active,
      changed: false,
      boundary: state.record?.boundary ?? null,
      ...(state.warning ? { warning: state.warning } : {}),
      error: active
        ? `Runtime "${options.runtime}" does not support edit boundaries; the existing boundary remains recorded, but this runtime does not enforce it and edits remain unrestricted.`
        : `Runtime "${options.runtime}" does not support edit boundaries; no active state was created and edits remain unrestricted.`,
    };
  }
  const resolvedInput = path.isAbsolute(directory)
    ? directory
    : path.resolve(cwd, directory);
  if (!pathExistsAsDirectory(resolvedInput)) {
    throw new Error(`Edit boundary must be an existing directory: ${resolvedInput}`);
  }
  const boundary = FileSystemUtils.canonicalizeExistingPath(resolvedInput);
  if (!isPathWithinBoundary(root, boundary)) {
    throw new Error(`Edit boundary must be inside the execution root (${root}): ${boundary}`);
  }

  const statePath = getEditBoundaryStatePath(root, options);
  const previous = readEditBoundaryState(root, options).record;
  const record: EditBoundaryStateRecord = {
    version: EDIT_BOUNDARY_STATE_VERSION,
    root,
    boundary,
    setByRuntime: options.runtime,
    setByEnforcement: options.enforcement,
    updatedAt: (options.now ?? new Date()).toISOString(),
  };
  writeStateAtomically(statePath, record);
  return {
    ...base,
    active: true,
    changed: previous?.boundary !== boundary,
    boundary,
  };
}

export function getEditBoundaryStatus(
  options: EditBoundaryOperationOptions
): EditBoundaryResult {
  const cwd = options.cwd ?? process.cwd();
  const root = FileSystemUtils.canonicalizeExistingPath(
    options.root ?? resolveEditBoundaryRoot(cwd)
  );
  const state = readEditBoundaryState(root, options);
  return {
    ...resultBase('status', root, options),
    active: state.record !== null,
    changed: false,
    boundary: state.record?.boundary ?? null,
    ...(state.warning ? { warning: state.warning } : {}),
  };
}

export function clearEditBoundary(
  options: EditBoundaryOperationOptions
): EditBoundaryResult {
  const cwd = options.cwd ?? process.cwd();
  const root = FileSystemUtils.canonicalizeExistingPath(
    options.root ?? resolveEditBoundaryRoot(cwd)
  );
  const statePath = getEditBoundaryStatePath(root, options);
  const wasActive = readEditBoundaryState(root, options).record !== null;
  fs.rmSync(statePath, { force: true });
  return {
    ...resultBase('clear', root, options),
    active: false,
    changed: wasActive,
    boundary: null,
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function patchTargets(command: string): string[] {
  const targets: string[] = [];
  const header =
    /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/gmu;
  for (const match of command.matchAll(header)) {
    const target = match[1].trim();
    if (target && target !== '/dev/null') targets.push(target);
  }
  return targets;
}

export interface ParsedEditHookEnvelope {
  cwd: string;
  toolName: string;
  targets: string[];
}

/**
 * Parse the covered Claude/Codex hook inputs. Unknown/malformed envelopes
 * return null so the hidden hook exits successfully without fabricating hard
 * protection.
 */
export function parseEditHookEnvelope(
  input: unknown,
  fallbackCwd = process.cwd()
): ParsedEditHookEnvelope | null {
  const envelope = objectValue(input);
  if (!envelope) return null;
  const toolName =
    typeof envelope.tool_name === 'string' ? envelope.tool_name : '';
  const cwd =
    typeof envelope.cwd === 'string' && envelope.cwd.trim()
      ? envelope.cwd
      : fallbackCwd;
  const toolInput = objectValue(envelope.tool_input);
  if (!toolInput) return null;

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path;
    return typeof filePath === 'string' && filePath.trim()
      ? { cwd, toolName, targets: [filePath] }
      : null;
  }
  if (toolName === 'apply_patch') {
    const command = toolInput.command;
    if (typeof command !== 'string') return null;
    const targets = patchTargets(command);
    return targets.length > 0 ? { cwd, toolName, targets } : null;
  }
  return null;
}

export interface EditBoundaryHookEvaluation {
  decision: 'allow' | 'deny' | 'no-decision';
  reason: string;
  boundary: string | null;
  outsideTargets: string[];
}

export function evaluateEditHook(
  input: unknown,
  options: GlobalDataDirOptions & { fallbackCwd?: string; root?: string } = {}
): EditBoundaryHookEvaluation {
  const envelope = parseEditHookEnvelope(input, options.fallbackCwd);
  if (!envelope) {
    return {
      decision: 'no-decision',
      reason: 'unrecognized-or-invalid-hook-envelope',
      boundary: null,
      outsideTargets: [],
    };
  }
  const root = FileSystemUtils.canonicalizeExistingPath(
    options.root ?? resolveEditBoundaryRoot(envelope.cwd)
  );
  const record = readEditBoundaryState(root, options).record;
  if (!record) {
    return {
      decision: 'allow',
      reason: 'no-active-boundary',
      boundary: null,
      outsideTargets: [],
    };
  }
  const outsideTargets = envelope.targets
    .map((target) => canonicalizeEditTarget(target, envelope.cwd))
    .filter((target) => !isPathWithinBoundary(record.boundary, target));
  return outsideTargets.length === 0
    ? {
        decision: 'allow',
        reason: 'targets-inside-boundary',
        boundary: record.boundary,
        outsideTargets: [],
      }
    : {
        decision: 'deny',
        reason: 'targets-outside-boundary',
        boundary: record.boundary,
        outsideTargets,
      };
}

export interface PreToolUseDenyOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
}

export function editHookOutput(
  evaluation: EditBoundaryHookEvaluation
): PreToolUseDenyOutput | undefined {
  if (evaluation.decision !== 'deny' || !evaluation.boundary) return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Rasen edit boundary blocked covered target(s) outside ${evaluation.boundary}: ` +
        evaluation.outsideTargets.join(', '),
    },
  };
}
