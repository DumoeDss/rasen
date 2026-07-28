/**
 * Project hook reconciliation for the base edit-boundary runtime.
 *
 * Entries are identified by one exact Rasen-owned status message and command,
 * never by an optional skill directory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { EditBoundaryEnforcement, RuntimeAdapterId } from './runtime-adapters.js';

export const EDIT_BOUNDARY_HOOK_STATUS = 'Checking Rasen edit boundary';
export const CLAUDE_EDIT_BOUNDARY_MATCHER = 'Edit|Write';
export const CODEX_EDIT_BOUNDARY_MATCHER = 'apply_patch|Edit|Write';

export function editBoundaryHookCommand(runtime: 'claude' | 'codex'): string {
  return `rasen agent edit-boundary check --runtime ${runtime}`;
}

export function editBoundaryHookWindowsCommand(runtime: 'claude' | 'codex'): string {
  return `rasen.cmd agent edit-boundary check --runtime ${runtime}`;
}

type JsonObject = Record<string, unknown>;

export type HookReconcileStatus =
  | 'created'
  | 'added'
  | 'already'
  | 'skipped-invalid'
  | 'unsupported';

export interface EditBoundaryHookInspection {
  runtime: RuntimeAdapterId;
  configured: boolean;
  usable: boolean;
  enforcement: EditBoundaryEnforcement;
  reason:
    | 'configured'
    | 'missing'
    | 'disabled'
    | 'invalid'
    | 'trust-required'
    | 'unsupported';
  configPath: string | null;
}

export interface EditBoundaryHookReconcileResult {
  runtime: RuntimeAdapterId;
  status: HookReconcileStatus;
  configPath: string | null;
  warning?: string;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonObject(
  filePath: string
): { existed: boolean; value: JsonObject } | { existed: true; invalid: true } {
  if (!fs.existsSync(filePath)) return { existed: false, value: {} };
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    return isObject(parsed)
      ? { existed: true, value: parsed }
      : { existed: true, invalid: true };
  } catch {
    return { existed: true, invalid: true };
  }
}

function handlerIsOwned(value: unknown, runtime: 'claude' | 'codex'): boolean {
  if (!isObject(value)) return false;
  return (
    value.statusMessage === EDIT_BOUNDARY_HOOK_STATUS ||
    value.command === editBoundaryHookCommand(runtime) ||
    value.command_windows === editBoundaryHookWindowsCommand(runtime)
  );
}

interface HookTree {
  hooks: JsonObject;
  preToolUse: JsonObject[];
}

/**
 * Validate every nested container reconciliation may replace. A syntactically
 * valid root object is not safe to merge when `hooks`, `PreToolUse`, a group,
 * or a handler list has an unusable shape.
 */
function readHookTree(root: JsonObject): HookTree | null {
  const hooksValue = root.hooks;
  if (hooksValue !== undefined && !isObject(hooksValue)) return null;
  const hooks = hooksValue ?? {};
  const preToolUseValue = hooks.PreToolUse;
  if (preToolUseValue !== undefined && !Array.isArray(preToolUseValue)) {
    return null;
  }

  const preToolUse = preToolUseValue ?? [];
  if (
    !preToolUse.every(
      (group) =>
        isObject(group) &&
        Array.isArray(group.hooks) &&
        group.hooks.every((handler) => isObject(handler))
    )
  ) {
    return null;
  }
  return { hooks, preToolUse };
}

function exactGroup(
  runtime: 'claude' | 'codex',
  matcher: string
): JsonObject {
  const handler: JsonObject = {
    type: 'command',
    command: editBoundaryHookCommand(runtime),
    timeout: 10,
    statusMessage: EDIT_BOUNDARY_HOOK_STATUS,
  };
  if (runtime === 'codex') {
    handler.command_windows = editBoundaryHookWindowsCommand(runtime);
  }
  return { matcher, hooks: [handler] };
}

function groupIsExact(
  value: unknown,
  runtime: 'claude' | 'codex',
  matcher: string
): boolean {
  if (!isObject(value) || value.matcher !== matcher || !Array.isArray(value.hooks)) {
    return false;
  }
  const expected = exactGroup(runtime, matcher);
  return JSON.stringify(value) === JSON.stringify(expected);
}

function reconcileHookFile(
  filePath: string,
  runtime: 'claude' | 'codex',
  matcher: string
): HookReconcileStatus {
  const read = readJsonObject(filePath);
  if ('invalid' in read) return 'skipped-invalid';
  const root = read.value;
  const tree = readHookTree(root);
  if (!tree) return 'skipped-invalid';

  const reconciled: JsonObject[] = [];
  for (const group of tree.preToolUse) {
    const handlers = group.hooks as JsonObject[];
    const unrelatedHandlers = handlers.filter(
      (handler) => !handlerIsOwned(handler, runtime)
    );
    if (unrelatedHandlers.length === handlers.length) {
      reconciled.push(group);
    } else if (unrelatedHandlers.length > 0) {
      // The group is user-owned when it contains unrelated siblings. Preserve
      // its position and every metadata field while removing only Rasen's
      // stale handler; the exact Rasen group is appended below.
      reconciled.push({ ...group, hooks: unrelatedHandlers });
    }
  }
  reconciled.push(exactGroup(runtime, matcher));

  if (JSON.stringify(reconciled) === JSON.stringify(tree.preToolUse)) {
    return 'already';
  }

  tree.hooks.PreToolUse = reconciled;
  root.hooks = tree.hooks;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(root, null, 2)}\n`, 'utf-8');
  return read.existed ? 'added' : 'created';
}

export function ensureClaudeEditBoundaryHook(
  projectRoot: string,
  claudeDir = '.claude'
): EditBoundaryHookReconcileResult {
  const configPath = path.join(projectRoot, claudeDir, 'settings.json');
  const status = reconcileHookFile(
    configPath,
    'claude',
    CLAUDE_EDIT_BOUNDARY_MATCHER
  );
  return {
    runtime: 'claude',
    status,
    configPath,
    ...(status === 'skipped-invalid'
      ? {
          warning:
            `Could not reconcile the Rasen edit-boundary hook because ${configPath} is not a valid hook configuration; the file was left unchanged.`,
        }
      : {}),
  };
}

export function ensureCodexEditBoundaryHook(
  projectRoot: string,
  codexDir = '.codex'
): EditBoundaryHookReconcileResult {
  const configPath = path.join(projectRoot, codexDir, 'hooks.json');
  const status = reconcileHookFile(
    configPath,
    'codex',
    CODEX_EDIT_BOUNDARY_MATCHER
  );
  return {
    runtime: 'codex',
    status,
    configPath,
    ...(status === 'created' || status === 'added'
      ? {
          warning:
            'Codex project hooks require project trust and review of the exact hook definition in /hooks; enforcement remains soft.',
        }
      : status === 'skipped-invalid'
        ? {
            warning:
              `Could not reconcile the Rasen edit-boundary hook because ${configPath} is not a valid hook configuration; the file was left unchanged.`,
          }
        : {}),
  };
}

function inspectExactHook(
  filePath: string,
  runtime: 'claude' | 'codex',
  matcher: string
): { configured: boolean; disabled: boolean; invalid: boolean } {
  const read = readJsonObject(filePath);
  if ('invalid' in read) {
    return { configured: false, disabled: false, invalid: true };
  }
  const root = read.value;
  const tree = readHookTree(root);
  if (!tree) {
    return { configured: false, disabled: false, invalid: true };
  }
  const exact = tree.preToolUse.find((entry) =>
    groupIsExact(entry, runtime, matcher)
  );
  if (!exact || !isObject(exact)) {
    return { configured: false, disabled: false, invalid: false };
  }
  const handler = Array.isArray(exact.hooks) ? exact.hooks[0] : null;
  const disabled =
    root.disableAllHooks === true ||
    exact.disabled === true ||
    (isObject(handler) && handler.disabled === true);
  return { configured: true, disabled, invalid: false };
}

export function inspectEditBoundaryHook(
  projectRoot: string,
  runtime: RuntimeAdapterId
): EditBoundaryHookInspection {
  if (runtime === 'zed') {
    return {
      runtime,
      configured: false,
      usable: false,
      enforcement: 'unsupported',
      reason: 'unsupported',
      configPath: null,
    };
  }
  if (runtime === 'claude') {
    const configPath = path.join(projectRoot, '.claude', 'settings.json');
    const inspected = inspectExactHook(
      configPath,
      runtime,
      CLAUDE_EDIT_BOUNDARY_MATCHER
    );
    const reason = inspected.invalid
      ? 'invalid'
      : inspected.disabled
        ? 'disabled'
        : inspected.configured
          ? 'configured'
          : 'missing';
    return {
      runtime,
      configured: inspected.configured,
      usable: inspected.configured && !inspected.disabled,
      enforcement:
        inspected.configured && !inspected.disabled ? 'hard' : 'soft',
      reason,
      configPath,
    };
  }

  const configPath = path.join(projectRoot, '.codex', 'hooks.json');
  const inspected = inspectExactHook(
    configPath,
    runtime,
    CODEX_EDIT_BOUNDARY_MATCHER
  );
  const reason = inspected.invalid
    ? 'invalid'
    : inspected.disabled
      ? 'disabled'
      : inspected.configured
        ? 'trust-required'
        : 'missing';
  return {
    runtime,
    configured: inspected.configured,
    usable: false,
    enforcement: 'soft',
    reason,
    configPath,
  };
}

export function reconcileEditBoundaryHooks(
  projectRoot: string,
  toolIds: readonly string[]
): EditBoundaryHookReconcileResult[] {
  const selected = new Set(toolIds);
  const results: EditBoundaryHookReconcileResult[] = [];
  if (selected.has('claude')) {
    results.push(ensureClaudeEditBoundaryHook(projectRoot));
  }
  if (selected.has('codex')) {
    results.push(ensureCodexEditBoundaryHook(projectRoot));
  }
  return results;
}
