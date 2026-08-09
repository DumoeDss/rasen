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
 *   2. only if that instance equals the one in the PATH and the preview has no
 *      blockers — except the sole typed merge blocker after the caller's
 *      explicit independently-verified assertion —
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
import { ARCHIVE_MERGE_CONFIRMATION_BLOCKER_CODE } from '../archive-engine.js';
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

export interface FinalizationCliBlocker {
  readonly code: string;
  readonly message: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly fix?: string;
  readonly archiveBlocker?: Readonly<Record<string, unknown>>;
}

export interface FinalizationCliDisposition {
  readonly status: 'complete' | 'blocked' | 'recoverable' | 'abort-required';
  readonly blockers: readonly FinalizationCliBlocker[];
  readonly recoveryCommand?: string;
  readonly abortCommand?: string;
  readonly manualRecoveryAction?: Readonly<Record<string, unknown>>;
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
      finalization?: FinalizationCliDisposition;
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
  /** Caller assertion made only after independently verifying the recorded PR merge. */
  mergeConfirmed?: unknown;
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
  if (
    body.mergeConfirmed !== undefined &&
    typeof body.mergeConfirmed !== 'boolean'
  ) {
    return {
      ok: false,
      message:
        'mergeConfirmed must be a boolean and may be true only after independently verifying the recorded PR merge.',
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeFinalizationBlockers(
  value: unknown
): FinalizationCliBlocker[] | null {
  if (!Array.isArray(value)) return null;
  const blockers: FinalizationCliBlocker[] = [];
  for (const valueBlocker of value) {
    const blocker = asRecord(valueBlocker);
    if (
      blocker === null ||
      typeof blocker.code !== 'string' ||
      typeof blocker.message !== 'string'
    ) {
      return null;
    }
    const archiveBlocker = asRecord(blocker.archiveBlocker);
    blockers.push({
      code: blocker.code,
      message: blocker.message,
      ...(typeof blocker.expected === 'string'
        ? { expected: blocker.expected }
        : {}),
      ...(typeof blocker.actual === 'string' ? { actual: blocker.actual } : {}),
      ...(typeof blocker.fix === 'string' ? { fix: blocker.fix } : {}),
      ...(archiveBlocker === null ? {} : { archiveBlocker }),
    });
  }
  return blockers;
}

export function decodeFinalizationDisposition(
  payload: Record<string, unknown> | null
): FinalizationCliDisposition | null {
  const archive = asRecord(payload?.archive);
  const finalization = asRecord(archive?.finalization);
  if (
    finalization === null ||
    !['complete', 'blocked', 'recoverable', 'abort-required'].includes(
      String(finalization.status)
    )
  ) {
    return null;
  }
  const blockers = decodeFinalizationBlockers(finalization.blockers);
  if (blockers === null) return null;
  const manualRecoveryAction = asRecord(finalization.manualRecoveryAction);
  return {
    status: finalization.status as FinalizationCliDisposition['status'],
    blockers,
    ...(typeof finalization.recoveryCommand === 'string'
      ? { recoveryCommand: finalization.recoveryCommand }
      : {}),
    ...(typeof finalization.abortCommand === 'string'
      ? { abortCommand: finalization.abortCommand }
      : {}),
    ...(manualRecoveryAction === null ? {} : { manualRecoveryAction }),
  };
}

function blockerArchiveCode(blocker: FinalizationCliBlocker): string | null {
  const archiveCode = blocker.archiveBlocker?.['code'];
  return typeof archiveCode === 'string' ? archiveCode : null;
}

function isSoleMergeConfirmationBlocker(
  blockers: readonly FinalizationCliBlocker[]
): boolean {
  return (
    blockers.length === 1 &&
    (blockers[0]?.code === ARCHIVE_MERGE_CONFIRMATION_BLOCKER_CODE ||
      blockerArchiveCode(blockers[0]!) ===
        ARCHIVE_MERGE_CONFIRMATION_BLOCKER_CODE)
  );
}

export interface FinalizationPreviewBlockerInspection {
  readonly blockers: readonly FinalizationCliBlocker[];
  readonly applicable: boolean;
  readonly mergeBlockerAdmitted: boolean;
}

export function inspectFinalizationPreviewBlockers(
  value: unknown,
  mergeConfirmed: unknown
): FinalizationPreviewBlockerInspection | null {
  const blockers = decodeFinalizationBlockers(value);
  if (blockers === null) return null;
  const mergeBlockerAdmitted =
    isSoleMergeConfirmationBlocker(blockers) && mergeConfirmed === true;
  return {
    blockers,
    applicable: blockers.length === 0 || mergeBlockerAdmitted,
    mergeBlockerAdmitted,
  };
}

/**
 * Decodes both the top-level CLI failure envelope and the Store finalization
 * result nested under `archive.finalization`.
 */
function cliDiagnostic(
  payload: Record<string, unknown> | null,
  stderr: string
): {
  code: string;
  message: string;
  finalization?: FinalizationCliDisposition;
} {
  const finalization = decodeFinalizationDisposition(payload);
  if (finalization !== null && finalization.status !== 'complete') {
    const first = finalization.blockers[0];
    return {
      code:
        (first === undefined ? null : blockerArchiveCode(first)) ??
        first?.code ??
        `archive_${finalization.status.replace('-', '_')}`,
      message:
        first?.message ??
        `Finalization did not complete (${finalization.status}).`,
      finalization,
    };
  }
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
      // A blocked saved preview is still a structured plan response. Parse it
      // before using the process exit code so the one runtime-satisfiable merge
      // assertion can be evaluated without weakening any other blocker.
      const previewPayload = parseJsonPayload(preview.stdout);
      const archive = asRecord(previewPayload?.archive);
      const plan = asRecord(archive?.finalizationPlan);
      const previewInspection = inspectFinalizationPreviewBlockers(
        plan?.blockers,
        body.mergeConfirmed
      );
      if (
        archive === null ||
        typeof archive.planToken !== 'string' ||
        plan === null ||
        typeof plan.changeInstanceId !== 'string' ||
        previewInspection === null
      ) {
        if (preview.exitCode !== 0) {
          const diagnostic = cliDiagnostic(previewPayload, preview.stderr);
          return {
            ok: false,
            status: 422,
            code: diagnostic.code,
            message: diagnostic.message,
            ...(preview.exitCode === null
              ? {}
              : { cliExitCode: preview.exitCode }),
            stderr: preview.stderr,
            ...(diagnostic.finalization === undefined
              ? {}
              : { finalization: diagnostic.finalization }),
          };
        }
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

      const previewBlockers = previewInspection.blockers;
      const soleMergeBlocker =
        isSoleMergeConfirmationBlocker(previewBlockers);
      const mergeBlockerAdmitted =
        previewInspection.mergeBlockerAdmitted &&
        preview.exitCode !== null;
      if (previewBlockers.length > 0 && !mergeBlockerAdmitted) {
        const first = previewBlockers[0]!;
        const disposition: FinalizationCliDisposition = {
          status: 'blocked',
          blockers: previewBlockers,
        };
        return {
          ok: false,
          status: 422,
          code: blockerArchiveCode(first) ?? first.code,
          message:
            soleMergeBlocker && body.mergeConfirmed !== true
              ? `${first.message} Set mergeConfirmed to true only after independently verifying the recorded PR merge.`
              : first.message,
          ...(preview.exitCode === null
            ? {}
            : { cliExitCode: preview.exitCode }),
          stderr: preview.stderr,
          finalization: disposition,
        };
      }
      if (preview.exitCode !== 0 && !mergeBlockerAdmitted) {
        const diagnostic = cliDiagnostic(previewPayload, preview.stderr);
        return {
          ok: false,
          status: 422,
          code: diagnostic.code,
          message: diagnostic.message,
          ...(preview.exitCode === null
            ? {}
            : { cliExitCode: preview.exitCode }),
          stderr: preview.stderr,
          ...(diagnostic.finalization === undefined
            ? {}
            : { finalization: diagnostic.finalization }),
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
      const appliedPayload = parseJsonPayload(applied.stdout);
      const appliedDisposition =
        decodeFinalizationDisposition(appliedPayload);
      if (
        applied.exitCode !== 0 ||
        (appliedDisposition !== null &&
          appliedDisposition.status !== 'complete')
      ) {
        const diagnostic = cliDiagnostic(appliedPayload, applied.stderr);
        return {
          ok: false,
          status: 422,
          code: diagnostic.code,
          message: diagnostic.message,
          ...(applied.exitCode === null
            ? {}
            : { cliExitCode: applied.exitCode }),
          stderr: applied.stderr,
          ...(diagnostic.finalization === undefined
            ? {}
            : { finalization: diagnostic.finalization }),
        };
      }
      const result = asRecord(asRecord(appliedPayload?.archive)?.finalization) as
        | (FinalizeChangeResponse['finalization'] & { status?: unknown })
        | null;
      if (
        result === null ||
        result.status !== 'complete' ||
        typeof result.publishedEntry !== 'string'
      ) {
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
