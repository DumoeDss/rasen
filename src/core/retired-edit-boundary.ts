/**
 * Frozen exact identifiers and artifact shapes used only for upgrade
 * normalization and cleanup.
 *
 * Nothing in this module can set, inspect, or enforce an edit boundary. It is
 * intentionally a subtractive compatibility shim for installations produced
 * by the retired 0.1.6/0.2.0 implementations.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  getGlobalDataDir,
  type GlobalDataDirOptions,
} from './global-config.js';

export const RETIRED_EDIT_BOUNDARY_EXPERT_IDS = [
  'freeze',
  'guard',
  'unfreeze',
] as const;

export const RETIRED_EDIT_BOUNDARY_SKILL_DIRS = [
  'rasen-freeze',
  'rasen-guard',
  'rasen-unfreeze',
] as const;

const RETIRED_IDS = new Set<string>(RETIRED_EDIT_BOUNDARY_EXPERT_IDS);

export const RETIRED_EDIT_BOUNDARY_STATE_VERSION = 1 as const;
export const RETIRED_EDIT_BOUNDARY_STATE_RELATIVE_DIR = [
  'runtime',
  'edit-boundaries',
] as const;

const RETIRED_EDIT_BOUNDARY_HOOK_STATUS = 'Checking Rasen edit boundary';
const RETIRED_CLAUDE_EDIT_BOUNDARY_MATCHER = 'Edit|Write';
const RETIRED_CODEX_EDIT_BOUNDARY_MATCHER = 'apply_patch|Edit|Write';

export const RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER = Object.freeze({
  type: 'command',
  command: 'rasen agent edit-boundary check --runtime claude',
  timeout: 10,
  statusMessage: RETIRED_EDIT_BOUNDARY_HOOK_STATUS,
});

export const RETIRED_CODEX_EDIT_BOUNDARY_HANDLER = Object.freeze({
  type: 'command',
  command: 'rasen agent edit-boundary check --runtime codex',
  timeout: 10,
  statusMessage: RETIRED_EDIT_BOUNDARY_HOOK_STATUS,
  command_windows: 'rasen.cmd agent edit-boundary check --runtime codex',
});

type JsonObject = Record<string, unknown>;

interface RetiredEditBoundaryStateRecord {
  version: typeof RETIRED_EDIT_BOUNDARY_STATE_VERSION;
  root: string;
  boundary: string;
  setByRuntime: 'claude' | 'codex';
  setByEnforcement: 'hard' | 'soft';
  updatedAt: string;
}

export interface RetiredEditBoundaryCleanupResult {
  removedHooks: string[];
  removedStateEntries: string[];
  warnings: string[];
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function platformPath(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function stateIdentity(root: string, platform: NodeJS.Platform): string {
  const pathApi = platformPath(platform);
  const normalized = pathApi.normalize(root);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function retiredEditBoundaryStateFileName(
  root: string,
  platform: NodeJS.Platform = process.platform
): string {
  const digest = createHash('sha256')
    .update(stateIdentity(root, platform))
    .digest('hex');
  return `${digest}.json`;
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return isDeepStrictEqual(actual, expected);
}

function isRecognizedStateRecord(
  value: unknown,
  fileName: string,
  platform: NodeJS.Platform
): value is RetiredEditBoundaryStateRecord {
  if (!isObject(value)) return false;
  if (
    !hasExactKeys(value, [
      'version',
      'root',
      'boundary',
      'setByRuntime',
      'setByEnforcement',
      'updatedAt',
    ])
  ) {
    return false;
  }
  const pathApi = platformPath(platform);
  if (
    value.version !== RETIRED_EDIT_BOUNDARY_STATE_VERSION ||
    typeof value.root !== 'string' ||
    !pathApi.isAbsolute(value.root) ||
    typeof value.boundary !== 'string' ||
    !pathApi.isAbsolute(value.boundary) ||
    (value.setByRuntime !== 'claude' && value.setByRuntime !== 'codex') ||
    (value.setByEnforcement !== 'hard' && value.setByEnforcement !== 'soft') ||
    typeof value.updatedAt !== 'string'
  ) {
    return false;
  }
  const relative = pathApi.relative(value.root, value.boundary);
  if (
    relative === '..' ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    return false;
  }
  return retiredEditBoundaryStateFileName(value.root, platform) === fileName;
}

function exactGeneratedGroup(
  runtime: 'claude' | 'codex'
): JsonObject {
  return runtime === 'claude'
    ? {
        matcher: RETIRED_CLAUDE_EDIT_BOUNDARY_MATCHER,
        hooks: [RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER],
      }
    : {
        matcher: RETIRED_CODEX_EDIT_BOUNDARY_MATCHER,
        hooks: [RETIRED_CODEX_EDIT_BOUNDARY_HANDLER],
      };
}

function cleanupHookFile(
  configPath: string,
  runtime: 'claude' | 'codex'
): { removed: boolean; warning?: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { removed: false };
    }
    return {
      removed: false,
      warning:
        `Could not inspect retired Rasen edit-boundary hooks in ${configPath}; ` +
        'the file was left unchanged for manual review.',
    };
  }

  let root: JsonObject;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) throw new Error('root is not an object');
    root = parsed;
  } catch {
    return {
      removed: false,
      warning:
        `Could not clean retired Rasen edit-boundary hooks because ${configPath} ` +
        'is not valid JSON; the file was left unchanged for manual review.',
    };
  }

  const hooksValue = root.hooks;
  if (hooksValue === undefined) return { removed: false };
  if (!isObject(hooksValue)) {
    return {
      removed: false,
      warning:
        `Could not clean retired Rasen edit-boundary hooks because ${configPath} ` +
        'has an unexpected hooks structure; the file was left unchanged for manual review.',
    };
  }
  const preToolUseValue = hooksValue.PreToolUse;
  if (preToolUseValue === undefined) return { removed: false };
  if (
    !Array.isArray(preToolUseValue) ||
    !preToolUseValue.every(
      (group) =>
        isObject(group) &&
        Array.isArray(group.hooks) &&
        group.hooks.every((handler) => isObject(handler))
    )
  ) {
    return {
      removed: false,
      warning:
        `Could not clean retired Rasen edit-boundary hooks because ${configPath} ` +
        'has an unexpected PreToolUse structure; the file was left unchanged for manual review.',
    };
  }

  const frozenHandler =
    runtime === 'claude'
      ? RETIRED_CLAUDE_EDIT_BOUNDARY_HANDLER
      : RETIRED_CODEX_EDIT_BOUNDARY_HANDLER;
  const frozenGroup = exactGeneratedGroup(runtime);
  let changed = false;
  const groups: JsonObject[] = [];
  for (const group of preToolUseValue as JsonObject[]) {
    const handlers = group.hooks as JsonObject[];
    const filtered = handlers.filter(
      (handler) => !isDeepStrictEqual(handler, frozenHandler)
    );
    if (filtered.length === handlers.length) {
      groups.push(group);
      continue;
    }
    changed = true;
    if (isDeepStrictEqual(group, frozenGroup)) {
      continue;
    }
    groups.push({ ...group, hooks: filtered });
  }

  if (!changed) return { removed: false };
  hooksValue.PreToolUse = groups;
  fs.writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`, 'utf-8');
  return { removed: true };
}

const RETIRED_STATE_FILE_NAME = /^[a-f0-9]{64}\.json$/u;
const RETIRED_TEMP_FILE_NAME =
  /^\.[a-f0-9]{64}\.json\.\d+\.[a-f0-9]{16}\.tmp$/u;

export function cleanupRetiredEditBoundaryArtifacts(
  projectRoot: string,
  options: GlobalDataDirOptions = {}
): RetiredEditBoundaryCleanupResult {
  const result: RetiredEditBoundaryCleanupResult = {
    removedHooks: [],
    removedStateEntries: [],
    warnings: [],
  };

  for (const [runtime, configPath] of [
    ['claude', path.join(projectRoot, '.claude', 'settings.json')],
    ['codex', path.join(projectRoot, '.codex', 'hooks.json')],
  ] as const) {
    const hookResult = cleanupHookFile(configPath, runtime);
    if (hookResult.removed) result.removedHooks.push(configPath);
    if (hookResult.warning) result.warnings.push(hookResult.warning);
  }

  const platform = options.platform ?? process.platform;
  const pathApi = platformPath(platform);
  const stateDir = pathApi.join(
    getGlobalDataDir(options),
    ...RETIRED_EDIT_BOUNDARY_STATE_RELATIVE_DIR
  );
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      result.warnings.push(
        `Could not inspect retired Rasen edit-boundary state in ${stateDir}; ` +
        'unknown entries were preserved for manual review.'
      );
    }
    return result;
  }

  for (const entry of entries) {
    const entryPath = pathApi.join(stateDir, entry.name);
    if (!entry.isFile()) {
      result.warnings.push(
        `Preserved unrecognized retired edit-boundary entry ${entryPath}.`
      );
      continue;
    }
    if (RETIRED_TEMP_FILE_NAME.test(entry.name)) {
      try {
        fs.rmSync(entryPath);
        result.removedStateEntries.push(entryPath);
      } catch {
        result.warnings.push(
          `Could not remove recognized retired edit-boundary temporary file ${entryPath}.`
        );
      }
      continue;
    }
    if (!RETIRED_STATE_FILE_NAME.test(entry.name)) {
      result.warnings.push(
        `Preserved unrecognized retired edit-boundary entry ${entryPath}.`
      );
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(entryPath, 'utf-8'));
    } catch {
      result.warnings.push(
        `Preserved unreadable retired edit-boundary state ${entryPath}.`
      );
      continue;
    }
    if (!isRecognizedStateRecord(parsed, entry.name, platform)) {
      result.warnings.push(
        `Preserved unrecognized retired edit-boundary state ${entryPath}.`
      );
      continue;
    }
    try {
      fs.rmSync(entryPath);
      result.removedStateEntries.push(entryPath);
    } catch {
      result.warnings.push(
        `Could not remove recognized retired edit-boundary state ${entryPath}.`
      );
    }
  }

  try {
    fs.rmdirSync(stateDir);
  } catch {
    // Non-empty, missing, or unreadable directories are deliberately kept.
  }
  return result;
}

export function isRetiredEditBoundaryExpertId(value: string): boolean {
  return RETIRED_IDS.has(value);
}

export function normalizeRetiredEditBoundaryExpertIds(
  ids: readonly string[]
): string[] {
  return ids.filter((id) => !isRetiredEditBoundaryExpertId(id));
}
