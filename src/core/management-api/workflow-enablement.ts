/**
 * Per-space workflow enablement (space-workflow-enablement design D4/D5):
 *   GET  /api/v1/workflow-enablement?root=<absolute space root>
 *   POST /api/v1/workflow-enablement  { root, op: 'enable'|'disable'|'reset', id? }
 *
 * The read is computed in-process from a fresh catalog + the per-project
 * resolution seam (`resolveProjectWorkflowSelection`), exactly mirroring how
 * `update`/drift resolve a space's effective selection, so the page can never
 * show a state that diverges from what `update` would actually apply.
 *
 * The mutation writes the project-scope `workflows` override through the
 * same comment-preserving project-config write path `rasen config set`
 * uses, then applies it by spawning the CLI's own `update` in the space's
 * root as a bounded subprocess (never installing/removing artifacts itself,
 * mirroring `workflow-submit.ts`'s bridge pattern). `update` prints human
 * output, not JSON — success is exit code 0, not a parsed stdout payload.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { AI_TOOLS } from '../config.js';
import { getGlobalConfig } from '../global-config.js';
import { getConfiguredTools, resolveToolSkillsRoot } from '../shared/index.js';
import { resolveExpertSelectionExplicitReadOnly } from '../expert-selection-state.js';
import {
  readProjectConfig,
  updateProjectConfigKey,
  updateProjectConfigKeys,
  type ProjectConfig,
} from '../project-config.js';
import {
  getProfileWorkflows,
  resolveLockedProfileBase,
  resolveProjectWorkflowSelection,
} from '../profiles.js';
import { resolveProfileDefinition } from '../named-profiles.js';
import {
  filterKnownWorkflowRoots,
  loadWorkflowCatalog,
  type WorkflowCatalog,
} from '../workflow-registry/index.js';
import { resolveProjectSelector } from '../config-api/project-addressing.js';
import type { ManagementApiContext } from './router.js';
import { getBoundedCliEntry } from './whitelist.js';
import type {
  WorkflowEnablementMutationRequest,
  WorkflowEnablementResponse,
  WorkflowEnablementUnit,
} from './wire-types.js';

const require = createRequire(import.meta.url);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_KILL_GRACE_MS = 2_000;

export type WorkflowEnablementResult<T> =
  | { ok: true; response: T }
  | { ok: false; status: number; code: string; message: string };

/**
 * Validates `root`: an absolute path (no filesystem probe for anything
 * else — a relative value rejects on shape alone) that resolves to a
 * registered project space via the machine project registry. Returns the
 * canonical registered root on success.
 */
async function validateSpaceRoot(root: unknown): Promise<WorkflowEnablementResult<string>> {
  if (typeof root !== 'string' || root.length === 0 || !path.isAbsolute(root)) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'root must be an absolute path.' };
  }
  const resolved = await resolveProjectSelector(root);
  if (!resolved) {
    return {
      ok: false,
      status: 404,
      code: 'space_not_found',
      message: `No registered space matches root "${root}".`,
    };
  }
  return { ok: true, response: resolved.root };
}

/** Whether `id`'s skill artifacts are installed in `root` for ANY configured tool. */
function isInstalledInAnyConfiguredTool(root: string, dirName: string): boolean {
  const configuredTools = new Set(getConfiguredTools(root));
  for (const tool of AI_TOOLS) {
    if (!tool.skillsDir || !configuredTools.has(tool.value)) continue;
    const skillFile = path.join(resolveToolSkillsRoot(tool, root), dirName, 'SKILL.md');
    try {
      if (fs.existsSync(skillFile)) return true;
    } catch {
      // fall through
    }
  }
  return false;
}

/**
 * Resolves the un-expanded base selection (before dependency closure) so the
 * read can mark a closure-only unit as `requiredByClosure` rather than a
 * genuine selection member (design D4).
 */
function resolveBaseSelectionIds(
  catalog: WorkflowCatalog,
  projectConfig: ProjectConfig | null,
  globalConfig: ReturnType<typeof getGlobalConfig>,
  expertSelectionExplicit: boolean
): string[] {
  const override = projectConfig?.workflows;
  if (override !== undefined) {
    return [...filterKnownWorkflowRoots(catalog, override).known];
  }
  // A resolvable `profile` lock supplies the base (init-profile-lock spec),
  // mirroring resolveProjectWorkflowSelection's layer order; an unresolvable
  // lock falls through to the user-wide profile exactly like the seam does.
  const lockedProfile = projectConfig?.profile;
  if (lockedProfile !== undefined) {
    const lockBase = resolveLockedProfileBase(lockedProfile, expertSelectionExplicit);
    if (lockBase.ok) {
      return [...filterKnownWorkflowRoots(catalog, lockBase.workflows).known];
    }
  }
  const base = getProfileWorkflows(globalConfig.profile ?? 'full', globalConfig.workflows, {
    expertSelectionExplicit,
  });
  return [...filterKnownWorkflowRoots(catalog, base).known];
}

async function computeEnablementResponse(root: string): Promise<WorkflowEnablementResponse> {
  const catalog = loadWorkflowCatalog();
  const globalConfig = getGlobalConfig();
  const projectConfig = readProjectConfig(root);
  const expertSelectionExplicit = await resolveExpertSelectionExplicitReadOnly(root);

  const { ids, mode, lockedProfile } = resolveProjectWorkflowSelection(
    catalog,
    root,
    globalConfig.profile ?? 'full',
    globalConfig.workflows,
    expertSelectionExplicit
  );
  const enabledSet = new Set(ids);
  const baseSet = new Set(resolveBaseSelectionIds(catalog, projectConfig, globalConfig, expertSelectionExplicit));

  const units: WorkflowEnablementUnit[] = catalog.definitions.map((definition) => {
    const enabled = enabledSet.has(definition.id);
    return {
      id: definition.id,
      kind: definition.kind,
      source: definition.source,
      title: definition.title ?? definition.skill.template.name,
      skillName: definition.skill.template.name,
      enabled,
      installed: isInstalledInAnyConfiguredTool(root, definition.skill.dirName),
      requiredByClosure: enabled && !baseSet.has(definition.id),
    };
  });

  return { mode, ...(lockedProfile !== undefined ? { lockedProfile } : {}), units };
}

/** `GET /api/v1/workflow-enablement?root=<...>` (design D4 / task 2.2). Fresh read; writes nothing. */
export async function handleWorkflowEnablementRead(
  root: unknown
): Promise<WorkflowEnablementResult<WorkflowEnablementResponse>> {
  const validated = await validateSpaceRoot(root);
  if (!validated.ok) return validated;
  return { ok: true, response: await computeEnablementResponse(validated.response) };
}

/** Resolves the CLI entry belonging to this server process's own installation (mirrors workflow-submit.ts). */
function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

export type WorkflowEnablementMutationResult =
  | { ok: true; status: 200; response: WorkflowEnablementResponse }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      /** Present only on an apply failure (selection write succeeded, `update` did not): the space's actual post-write state. */
      state?: WorkflowEnablementResponse;
    };

/**
 * Builds the enablement mutation submitter (design D5), closed over one
 * server's cap-1 concurrency state (independent of the workflow-library
 * bridge's own cap-1 slot).
 */
export function createWorkflowEnablementSubmitter(
  _context: Pick<ManagementApiContext, 'launchProjectRoot'>,
  options: { timeoutMs?: number; killGraceMs?: number; cliEntryOverride?: string } = {}
): (request: unknown) => Promise<WorkflowEnablementMutationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const cliEntry = options.cliEntryOverride ?? resolveCliEntry();
  let inFlight = false;

  return async (request) => {
    if (typeof request !== 'object' || request === null) {
      return { ok: false, status: 400, code: 'invalid_input', message: 'Request body must be an object.' };
    }
    const body = request as Partial<WorkflowEnablementMutationRequest>;
    if (
      body.op !== 'enable' &&
      body.op !== 'disable' &&
      body.op !== 'reset' &&
      body.op !== 'set-profile' &&
      body.op !== 'clear-profile'
    ) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_input',
        message: 'op must be "enable", "disable", "reset", "set-profile", or "clear-profile".',
      };
    }

    const validatedRoot = await validateSpaceRoot(body.root);
    if (!validatedRoot.ok) return validatedRoot;
    const root = validatedRoot.response;

    const catalog = loadWorkflowCatalog();
    if ((body.op === 'enable' || body.op === 'disable') && (typeof body.id !== 'string' || !catalog.has(body.id))) {
      return { ok: false, status: 400, code: 'invalid_input', message: 'id must be a known catalog unit id.' };
    }
    if (body.op === 'set-profile') {
      if (typeof body.profile !== 'string' || body.profile.length === 0) {
        return { ok: false, status: 400, code: 'invalid_input', message: 'profile must be a non-empty string.' };
      }
      // Accepts `full`, `core`, or a saved profile name; rejects `custom`
      // (reserved) and unknown names (design D2). The library's own resolution
      // throws a message naming the problem; surface it verbatim.
      try {
        resolveProfileDefinition(body.profile);
      } catch (error) {
        return {
          ok: false,
          status: 400,
          code: 'invalid_input',
          message: error instanceof Error ? error.message : `Unknown profile "${body.profile}".`,
        };
      }
    }

    // Admission gate through the shared whitelist table (mirrors
    // workflow-submit.ts): this bridge serves only its own apply op.
    if (!getBoundedCliEntry('workflow-enablement-update')) {
      return {
        ok: false,
        status: 500,
        code: 'internal_error',
        message: 'Workflow enablement apply is not present in the admission whitelist.',
      };
    }

    if (inFlight) {
      return { ok: false, status: 409, code: 'busy', message: 'Another workflow enablement mutation is already in flight.' };
    }

    inFlight = true;
    try {
      // Selection write: through the unified config layer's project-scope
      // write path — the exact code path `rasen config set --scope project`
      // uses (comment-preserving, no new config logic here).
      const writeResult = writeSelection(root, catalog, body as WorkflowEnablementMutationRequest);
      if (!writeResult.ok) return writeResult;

      // Apply: spawn the CLI's own `update`, bounded, cwd = the space root.
      const applyResult = await runUpdate(cliEntry, root, timeoutMs, killGraceMs);
      const state = await computeEnablementResponse(root);

      if (!applyResult.ok) {
        return {
          ok: false,
          status: 422,
          code: 'cli_error',
          message: applyResult.message,
          state,
        };
      }

      return { ok: true, status: 200, response: state };
    } finally {
      inFlight = false;
    }
  };
}

/** Writes the project's `workflows` override (enable/disable materialize-or-update it; reset unsets it). */
function writeSelection(
  root: string,
  catalog: WorkflowCatalog,
  request: WorkflowEnablementMutationRequest
): WorkflowEnablementResult<void> {
  try {
    if (request.op === 'reset') {
      updateProjectConfigKey(root, 'workflows', undefined);
      return { ok: true, response: undefined };
    }

    if (request.op === 'clear-profile') {
      // Unset the lock only — the space returns to the user-wide profile. An
      // override, if any, is deliberately left untouched (design D4).
      updateProjectConfigKey(root, 'profile', undefined);
      return { ok: true, response: undefined };
    }

    if (request.op === 'set-profile') {
      // Write the lock AND clear any `workflows` override in ONE write (design
      // D2/D4 "same write step"): an override always shadows the lock, so
      // leaving it would make the switch a silent no-op — and two sequential
      // single-key writes could crash between them and strand exactly that
      // shadowed state. The profile value was validated as resolvable above.
      updateProjectConfigKeys(root, [
        { keyPath: 'profile', value: request.profile },
        { keyPath: 'workflows', value: undefined },
      ]);
      return { ok: true, response: undefined };
    }

    const globalConfig = getGlobalConfig();
    const projectConfig = readProjectConfig(root);
    const existingOverride = projectConfig?.workflows;
    // D2: first toggle materializes a snapshot of the current effective
    // (un-expanded) selection; a space already carrying an override just
    // updates that list.
    const base =
      existingOverride !== undefined
        ? [...existingOverride]
        : [...getProfileWorkflows(globalConfig.profile ?? 'full', globalConfig.workflows)];
    const { known } = filterKnownWorkflowRoots(catalog, base);
    const nextSet = new Set(known);
    if (request.op === 'enable') {
      nextSet.add(request.id);
    } else {
      nextSet.delete(request.id);
    }
    updateProjectConfigKey(root, 'workflows', [...nextSet]);
    return { ok: true, response: undefined };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      code: 'internal_error',
      message: `Failed to write the project's workflow selection: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Runs `update` as a bounded subprocess in `cwd`; success = exit code 0 (never JSON-parsed — `update` prints human output). */
function runUpdate(
  cliEntry: string,
  cwd: string,
  timeoutMs: number,
  killGraceMs: number
): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry, 'update'], { cwd, shell: false });

    let stdout = '';
    let stderr = '';
    let responded = false;
    let childClosed = false;
    let killTimer: NodeJS.Timeout | undefined;

    const respond = (result: { ok: true } | { ok: false; message: string }) => {
      if (responded) return;
      responded = true;
      resolve(result);
    };

    const timeoutTimer = setTimeout(() => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!childClosed) child.kill('SIGKILL');
      }, killGraceMs);
      killTimer.unref?.();
      respond({ ok: false, message: 'The `update` subprocess timed out.' });
    }, timeoutMs);
    timeoutTimer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (error) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      respond({ ok: false, message: `Failed to spawn the CLI subprocess: ${error.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      childClosed = true;
      if (code === 0) {
        respond({ ok: true });
      } else {
        const message = stderr.trim().length > 0 ? stderr.trim() : stdout.trim();
        respond({ ok: false, message: message.length > 0 ? message : `\`update\` exited with code ${code}.` });
      }
    });
  });
}
