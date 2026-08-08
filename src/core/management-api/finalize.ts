/**
 * `POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize`
 * — the Store change-finalization bridge.
 *
 * Same posture as `submit.ts`: the server never writes a workspace file and
 * never re-implements finalization. It validates the request, then spawns the
 * CLI's own `dist/cli/index.js` (never PATH) with `shell: false` and an argv
 * array, capped at one subprocess in flight, and passes the CLI's diagnostics
 * through verbatim.
 *
 * Two CLI invocations, in this order, and the order is the point:
 *
 *   1. `archive <change> --store … --project … --target-line … --outcome … \
 *      --dry-run --save-plan --json` — READ-ONLY. It produces the same
 *      immutable finalization plan every other surface produces, and that plan
 *      names the Change's committed `changeInstanceId`.
 *   2. only if that instance equals the one in the PATH,
 *      `archive --apply-plan <token> --json --yes` — the mutation.
 *
 * A path scope that disagrees with the Change's committed identity is therefore
 * refused BEFORE any mutating subprocess exists, which is what the requirement
 * asks for. The scope is never completed from a query filter, a session, a
 * launch project, or a previously viewed selection: every scope field is read
 * from the path and from nowhere else, and a missing one is a 400.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { validateChangeName } from '../../utils/change-utils.js';
import { isChangeInstanceId } from '../store/planning-identity.js';
import type { ManagementApiContext } from './router.js';
import { getBoundedCliEntry } from './whitelist.js';

const require = createRequire(import.meta.url);

/** Hard timeout per subprocess: a finalization stages and publishes a tree. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Grace period between SIGTERM and SIGKILL on timeout. */
const DEFAULT_KILL_GRACE_MS = 2_000;

/** Length cap on the free-text reason. */
const MAX_REASON_LENGTH = 4_000;

/** Any C0 control character or DEL, except tab and newline in the reason. */
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/;

export interface FinalizeChangePathScope {
  readonly storeUid: string;
  readonly projectId: string;
  readonly targetLineId: string;
  readonly changeInstanceId: string;
}

export interface FinalizeChangeResponse {
  readonly finalization: {
    readonly outcome: string;
    readonly changeId: string;
    readonly changeInstanceId: string;
    readonly workspacePairId: string;
    readonly storeUid: string;
    readonly projectId: string;
    readonly targetLineId: string;
    readonly publishedEntry: string;
    readonly specSyncApplied: boolean;
    readonly specSyncActionCount: number;
    readonly provenCommit: string | null;
    readonly codeRef: string | null;
  };
}

export type FinalizeResult =
  | { ok: true; status: 200; response: FinalizeChangeResponse }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      cliExitCode?: number;
      stderr?: string;
    };

function resolveCliEntry(): string {
  const pkgPath = require.resolve('../../../package.json');
  return path.join(path.dirname(pkgPath), 'dist', 'cli', 'index.js');
}

/**
 * A path segment that could be read as a CLI option, or that carries a control
 * character, is rejected before it is ever placed in an argv array.
 */
function invalidSegment(label: string, value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return `${label} must be a non-empty string.`;
  }
  if (value.startsWith('-')) return `${label} must not be option-shaped.`;
  if (CONTROL_CHAR_PATTERN.test(value) || value.includes('\n')) {
    return `${label} must not contain control characters.`;
  }
  return null;
}

function validateScope(scope: FinalizeChangePathScope): string | null {
  for (const [label, value] of [
    ['storeUid', scope.storeUid],
    ['projectId', scope.projectId],
    ['targetLineId', scope.targetLineId],
    ['changeInstanceId', scope.changeInstanceId],
  ] as const) {
    const problem = invalidSegment(label, value);
    if (problem !== null) return problem;
  }
  if (!isChangeInstanceId(scope.changeInstanceId)) {
    return `changeInstanceId '${scope.changeInstanceId}' is not a Change instance identifier; the path names the Change INSTANCE, never an alias, a directory, or a branch.`;
  }
  return null;
}

export interface FinalizeChangeRequestBody {
  changeId?: unknown;
  outcome?: unknown;
  reason?: unknown;
  by?: unknown;
  byTargetLine?: unknown;
  commit?: unknown;
}

/**
 * Builds the finalization argv options from the body. Nothing is defaulted:
 * an absent outcome is a 400 here rather than a CLI refusal later, and every
 * other option is passed through exactly as supplied so the CLI's own resolver
 * remains the single authority on which combinations are legal.
 */
export function finalizationOptions(
  body: FinalizeChangeRequestBody
): { ok: true; argv: string[] } | { ok: false; message: string } {
  if (typeof body.outcome !== 'string' || body.outcome.trim().length === 0) {
    return {
      ok: false,
      message:
        'outcome is required: a Store v2 Change ends in exactly one explicitly declared outcome (landed, superseded, cancelled, abandoned) and there is no default.',
    };
  }
  const argv: string[] = [];
  for (const [flag, value, cap] of [
    ['--outcome', body.outcome, 64],
    ['--reason', body.reason, MAX_REASON_LENGTH],
    ['--by', body.by, 256],
    ['--by-target-line', body.byTargetLine, 256],
    ['--commit', body.commit, 256],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      return { ok: false, message: `${flag.slice(2)} must be a string.` };
    }
    if (value.length > cap) {
      return { ok: false, message: `${flag.slice(2)} must be at most ${cap} characters.` };
    }
    if (CONTROL_CHAR_PATTERN.test(value)) {
      return { ok: false, message: `${flag.slice(2)} must not contain control characters.` };
    }
    argv.push(flag, value);
  }
  return { ok: true, argv };
}

/**
 * The exact argv arrays this bridge executes, exposed so the four-surface
 * parity test can drive the API's commands through the real Commander program
 * — the same shape `createGeneratedArchiveConsumerArgv` established for the
 * three CLI consumers. There is no second command builder behind the route.
 */
export interface FinalizationCliArgv {
  readonly preview: string[];
  apply(planToken: string): string[];
}

export function createFinalizationCliArgv(
  scope: FinalizeChangePathScope,
  changeId: string,
  finalizationArgv: readonly string[]
): FinalizationCliArgv {
  return {
    preview: [
      'archive',
      changeId,
      '--store',
      scope.storeUid,
      '--project',
      scope.projectId,
      '--target-line',
      scope.targetLineId,
      ...finalizationArgv,
      '--dry-run',
      '--save-plan',
      '--json',
    ],
    apply: planToken => ['archive', '--apply-plan', planToken, '--json', '--yes'],
  };
}

interface CliRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

function runCli(
  cliEntry: string,
  cwd: string,
  argv: readonly string[],
  timeoutMs: number,
  killGraceMs: number
): Promise<CliRun> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliEntry, ...argv], {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
      killTimer.unref?.();
    }, timeoutMs);
    timeoutTimer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    const finish = (run: CliRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(run);
    };
    child.on('error', error => {
      finish({ exitCode: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on('close', code => {
      finish({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

function parseJsonPayload(stdout: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The CLI's `--json` failure envelope, surfaced UNCHANGED: whatever diagnostic
 * the finalization Module refused with is what the client sees.
 */
function cliDiagnostic(
  stdout: string,
  stderr: string
): { code: string; message: string } {
  const payload = parseJsonPayload(stdout);
  const status = payload?.status;
  if (Array.isArray(status) && status.length > 0) {
    const first = status[0] as { code?: unknown; message?: unknown };
    if (typeof first.code === 'string' && typeof first.message === 'string') {
      return { code: first.code, message: first.message };
    }
  }
  return {
    code: 'cli_error',
    message:
      stderr.trim().length > 0
        ? stderr.trim()
        : 'The CLI exited with an error and produced no message.',
  };
}

/**
 * Builds the finalization bridge closed over one server's context and its own
 * cap-1 concurrency state, exactly as the change-submission bridge does.
 */
export function createChangeFinalizer(
  context: Pick<ManagementApiContext, 'launchProjectRoot'>,
  options: {
    timeoutMs?: number;
    killGraceMs?: number;
    cliEntryOverride?: string;
    cwdOverride?: string;
  } = {}
): (
  scope: FinalizeChangePathScope,
  body: FinalizeChangeRequestBody
) => Promise<FinalizeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const cliEntry = options.cliEntryOverride ?? resolveCliEntry();
  let inFlight = false;

  return async (scope, body) => {
    // The admission whitelist is the single source (design D7): this endpoint
    // serves exactly one bounded-cli entry and can admit nothing else.
    if (!getBoundedCliEntry('finalize-change')) {
      return {
        ok: false,
        status: 500,
        code: 'internal_error',
        message: 'finalize-change is not present in the admission whitelist.',
      };
    }
    if (inFlight) {
      return {
        ok: false,
        status: 409,
        code: 'busy',
        message: 'Another finalization is already in flight.',
      };
    }

    const scopeProblem = validateScope(scope);
    if (scopeProblem !== null) {
      return { ok: false, status: 400, code: 'invalid_input', message: scopeProblem };
    }
    if (typeof body.changeId !== 'string') {
      return {
        ok: false,
        status: 400,
        code: 'invalid_input',
        message:
          'changeId is required: the path names the Change instance, which is identity, and the CLI addresses the Change by its alias. Neither is inferred from the other.',
      };
    }
    const nameCheck = validateChangeName(body.changeId);
    if (!nameCheck.valid) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_input',
        message: nameCheck.error ?? 'Invalid changeId.',
      };
    }
    const finalization = finalizationOptions(body);
    if (!finalization.ok) {
      return {
        ok: false,
        status: 400,
        code: 'invalid_input',
        message: finalization.message,
      };
    }

    const cwd = options.cwdOverride ?? context.launchProjectRoot;
    if (!cwd) {
      return {
        ok: false,
        status: 409,
        code: 'no_project',
        message:
          'No Rasen project is available for this server; launch `rasen ui` inside the execution checkout bound to this Change.',
      };
    }

    inFlight = true;
    try {
      const argv = createFinalizationCliArgv(scope, body.changeId, finalization.argv);
      // ---- 1. read-only preview -------------------------------------------
      const preview = await runCli(cliEntry, cwd, argv.preview, timeoutMs, killGraceMs);
      if (preview.timedOut) {
        return {
          ok: false,
          status: 504,
          code: 'cli_timeout',
          message: 'The CLI subprocess timed out while planning the finalization.',
        };
      }
      if (preview.exitCode !== 0) {
        const diagnostic = cliDiagnostic(preview.stdout, preview.stderr);
        return {
          ok: false,
          status: 422,
          code: diagnostic.code,
          message: diagnostic.message,
          ...(preview.exitCode === null ? {} : { cliExitCode: preview.exitCode }),
          stderr: preview.stderr,
        };
      }
      const previewPayload = parseJsonPayload(preview.stdout);
      const archive = previewPayload?.archive as
        | {
            planToken?: unknown;
            finalizationPlan?: { changeInstanceId?: unknown; blockers?: unknown[] };
          }
        | undefined;
      const plan = archive?.finalizationPlan;
      if (
        archive === undefined ||
        typeof archive.planToken !== 'string' ||
        plan === undefined ||
        typeof plan.changeInstanceId !== 'string'
      ) {
        return {
          ok: false,
          status: 500,
          code: 'cli_protocol_error',
          message: `The CLI planned the finalization but its output could not be read: ${preview.stdout || '(empty)'}`,
        };
      }
      // The path's scope is checked against the Change's COMMITTED identity,
      // and a disagreement stops here — before any mutating subprocess exists.
      if (plan.changeInstanceId !== scope.changeInstanceId) {
        return {
          ok: false,
          status: 409,
          code: 'change_identity_mismatch',
          message: `The path names Change instance '${scope.changeInstanceId}', but Change '${body.changeId}' in ${scope.projectId}/${scope.targetLineId} is committed as '${plan.changeInstanceId}'. Nothing was finalized and no file was modified.`,
        };
      }

      // ---- 2. the mutation --------------------------------------------------
      const applied = await runCli(
        cliEntry,
        cwd,
        argv.apply(archive.planToken),
        timeoutMs,
        killGraceMs
      );
      if (applied.timedOut) {
        return {
          ok: false,
          status: 504,
          code: 'cli_timeout',
          message: 'The CLI subprocess timed out while applying the finalization.',
        };
      }
      if (applied.exitCode !== 0) {
        const diagnostic = cliDiagnostic(applied.stdout, applied.stderr);
        return {
          ok: false,
          status: 422,
          code: diagnostic.code,
          message: diagnostic.message,
          ...(applied.exitCode === null ? {} : { cliExitCode: applied.exitCode }),
          stderr: applied.stderr,
        };
      }
      const appliedPayload = parseJsonPayload(applied.stdout);
      const result = (appliedPayload?.archive as { finalization?: unknown } | undefined)
        ?.finalization as FinalizeChangeResponse['finalization'] | undefined;
      if (result === undefined || typeof result.publishedEntry !== 'string') {
        return {
          ok: false,
          status: 500,
          code: 'cli_protocol_error',
          message: `The CLI applied the finalization but its output could not be read: ${applied.stdout || '(empty)'}`,
        };
      }
      return {
        ok: true,
        status: 200,
        response: {
          finalization: {
            outcome: result.outcome,
            changeId: result.changeId,
            changeInstanceId: result.changeInstanceId,
            workspacePairId: result.workspacePairId,
            storeUid: result.storeUid,
            projectId: result.projectId,
            targetLineId: result.targetLineId,
            publishedEntry: result.publishedEntry,
            specSyncApplied: result.specSyncApplied,
            specSyncActionCount: result.specSyncActionCount,
            provenCommit: result.provenCommit ?? null,
            codeRef: result.codeRef ?? null,
          },
        },
      };
    } finally {
      inFlight = false;
    }
  };
}
