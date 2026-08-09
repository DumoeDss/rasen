import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

import { Command } from 'commander';

import {
  decodeRunAction,
  type RunAction,
} from '../core/change-run/index.js';
import { getCliLocale } from '../core/cli-locale.js';
import {
  probeDaemon,
  resolveDefaultDaemonPort,
} from '../core/management-api/daemon-probe.js';
import { readDaemonState } from '../core/management-api/daemon-state.js';
import {
  createReusableSessionService,
  type ReusableSessionService,
} from '../core/management-api/reusable-session-api.js';
import { createSessionRegistry } from '../core/management-api/session-registry.js';
import {
  createAgentCliResolver,
  createSessionSupervisor,
} from '../core/management-api/supervisor.js';
import {
  decodeReusableSessionApiResponse,
  REUSABLE_SESSION_API_SCHEMA,
  type ReusableSessionApiFailure,
  type ReusableSessionApiResponse,
  type ReusableSessionApiResponseExpectation,
  type ReusableSessionOwnerShutdownDiagnosticWire,
  type ReusableSessionWakeRequest,
} from '../core/management-api/wire-types.js';
import {
  formatLocaleMessage,
  getLocaleCatalog,
} from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

const require = createRequire(import.meta.url);
const { version: OWN_VERSION } = require('../../package.json') as {
  version: string;
};

const SESSION_COMMAND_SCHEMA = 'rasen-session-command/1' as const;
const MAX_ACTION_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DAEMON_REQUEST_TIMEOUT_MS = 31 * 60 * 1000;
const RUN_ID_PATTERN = /^run:[0-9a-f]{64}$/u;
const SESSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_MESSAGE_ID_LENGTH = 512;

type SessionCommandName = 'exec' | 'list' | 'retire';
type OwnerMode = 'daemon' | 'foreground';

interface SessionMessages {
  foregroundNotice: string;
  completed: string;
  duplicateCompleted: string;
  duplicatePreDeliveryFailed: string;
  duplicateUncertain: string;
  listedHeading: string;
  listEmpty: string;
  sessionLine: string;
  retired: string;
  failure: string;
  shutdownDiagnostic: string;
  sharedOwner: string;
  daemonForeign: string;
  daemonVersionMismatch: string;
  daemonIdentityAmbiguous: string;
  transportUncertain: string;
}

interface ExecOptions {
  run?: string;
  session?: string;
  action?: string;
  cwd?: string;
  messageId?: string;
  touch?: string;
  touchDeadline?: string;
  maxTouches?: string;
  deadlineAction?: string;
  json?: boolean;
}

interface ListOptions {
  run?: string;
  json?: boolean;
}

interface RetireOptions {
  run?: string;
  session?: string;
  reason?: string;
  json?: boolean;
}

export type SessionOwnerSelection =
  | {
      ok: true;
      mode: 'daemon';
      port: number;
      token: string;
      pid: number;
      version: string;
    }
  | {
      ok: true;
      mode: 'foreground';
      service: ReusableSessionService;
    }
  | {
      ok: false;
      code:
        | 'daemon_foreign'
        | 'daemon_version_mismatch'
        | 'daemon_identity_ambiguous';
      message: string;
    };

function messages(): SessionMessages {
  return getLocaleCatalog(getCliLocale()).session.messages as SessionMessages;
}

function outcomeMessage(code: string): string {
  const outcomes = getLocaleCatalog(getCliLocale()).session.outcomes as Record<
    string,
    string
  >;
  return outcomes[code] ?? outcomes.generic;
}

function parsePositiveInteger(
  value: string | undefined,
  label: string
): number | { error: string } {
  if (value === undefined) return { error: `${label} is required.` };
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : { error: `${label} must be a positive integer.` };
}

function readBoundedActionStream(
  stream: Readable,
  destroyOnFinish: boolean
): Promise<Buffer | { error: string }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('aborted', onAborted);
    };
    const finish = (value: Buffer | { error: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (destroyOnFinish) {
        stream.destroy();
      } else {
        stream.pause();
      }
      resolve(value);
    };
    const onData = (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = MAX_ACTION_BYTES + 1 - total;
      if (remaining <= 0) return;
      const accepted =
        chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
      chunks.push(accepted);
      total += accepted.byteLength;
      if (total > MAX_ACTION_BYTES) {
        finish({
          error: `The action document exceeds ${MAX_ACTION_BYTES} bytes.`,
        });
      }
    };
    const onEnd = () => finish(Buffer.concat(chunks, total));
    const onAborted = () => {
      finish({ error: 'The action document stream was aborted.' });
    };
    const onError = (error: Error) => {
      finish({ error: error.message });
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('aborted', onAborted);
    stream.on('error', onError);
  });
}

export async function readSessionActionSource(
  source: string,
  stdin: Readable = process.stdin
): Promise<RunAction | { error: string }> {
  try {
    let stream: Readable;
    let destroyOnFinish = false;
    if (source === '-') {
      stream = stdin;
    } else {
      const actionPath = path.resolve(source);
      const stat = fs.statSync(actionPath);
      if (stat.isFile() && stat.size > MAX_ACTION_BYTES) {
        return {
          error: `The action document exceeds ${MAX_ACTION_BYTES} bytes.`,
        };
      }
      stream = fs.createReadStream(actionPath);
      destroyOnFinish = true;
    }
    const raw = await readBoundedActionStream(stream, destroyOnFinish);
    if ('error' in raw) return raw;
    return decodeRunAction(JSON.parse(raw.toString('utf-8')));
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'The action document could not be decoded.',
    };
  }
}

function canonicalCommandCwd(value: string): string | { error: string } {
  try {
    const resolved = path.resolve(value);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { error: 'The execution directory must be a real directory.' };
    }
    return fs.realpathSync.native(resolved);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'The execution directory could not be resolved.',
    };
  }
}

function localFailure(
  operation: ReusableSessionApiFailure['operation'],
  code: string,
  message: string,
  runId?: string,
  sessionKey?: string,
  failures?: ReusableSessionOwnerShutdownDiagnosticWire[]
): ReusableSessionApiFailure {
  return {
    schema: REUSABLE_SESSION_API_SCHEMA,
    ok: false,
    operation,
    code,
    message,
    ...(runId !== undefined ? { runId } : {}),
    ...(sessionKey !== undefined ? { sessionKey } : {}),
    ...(failures !== undefined ? { failures } : {}),
  };
}

function daemonRequest(
  port: number,
  token: string,
  expectedPid: number,
  expectedVersion: string,
  expectation: ReusableSessionApiResponseExpectation,
  requestPath: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<ReusableSessionApiResponse> {
  return new Promise((resolve) => {
    const operation = expectation.operation;
    let settled = false;
    const finish = (response: ReusableSessionApiResponse) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const bytes =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf-8');
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method,
        agent: false,
        timeout: DAEMON_REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(bytes !== undefined
            ? {
                'Content-Type': 'application/json',
                'Content-Length': String(bytes.byteLength),
              }
            : {}),
        },
      },
      (response) => {
        if (
          response.headers['x-rasen-daemon'] !== expectedVersion
          || Number(response.headers['x-rasen-pid']) !== expectedPid
        ) {
          finish(
            localFailure(
              operation,
              'transport_uncertain',
              'The daemon identity changed after the request could have been admitted.'
            )
          );
          response.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer) => {
          if (settled) return;
          total += chunk.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            finish(
              localFailure(
                operation,
                'transport_uncertain',
                'The daemon response exceeded the protocol limit.'
              )
            );
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(
              Buffer.concat(chunks).toString('utf-8')
            );
            const decoded = decodeReusableSessionApiResponse(
              parsed,
              expectation
            );
            finish(
              decoded
                ? decoded
                : localFailure(
                    operation,
                    'transport_uncertain',
                    'The daemon returned an invalid reusable-session response.'
                  )
            );
          } catch {
            finish(
              localFailure(
                operation,
                'transport_uncertain',
                'The daemon response ended without a complete protocol document.'
              )
            );
          }
        });
        response.on('error', () => {
          finish(
            localFailure(
              operation,
              'transport_uncertain',
              'The daemon response was interrupted after possible admission.'
            )
          );
        });
        response.on('aborted', () => {
          finish(
            localFailure(
              operation,
              'transport_uncertain',
              'The daemon response was aborted after possible admission.'
            )
          );
        });
        response.on('close', () => {
          if (response.complete) return;
          finish(
            localFailure(
              operation,
              'transport_uncertain',
              'The daemon response closed before a complete protocol document arrived.'
            )
          );
        });
      }
    );
    request.on('timeout', () => {
      finish(
        localFailure(
          operation,
          'transport_uncertain',
          'The daemon request timed out after possible admission.'
        )
      );
      request.destroy();
    });
    request.on('error', () => {
      finish(
        localFailure(
          operation,
          'transport_uncertain',
          'The daemon request failed after possible admission.'
        )
      );
    });
    request.on('close', () => {
      if (settled) return;
      finish(
        localFailure(
          operation,
          'transport_uncertain',
          'The daemon request closed after possible admission.'
        )
      );
    });
    if (bytes !== undefined) request.write(bytes);
    request.end();
  });
}

function recordedDaemonPidIsProvenDead(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export async function selectSessionOwner(): Promise<SessionOwnerSelection> {
  const state = readDaemonState();
  const { port, result } = await probeDaemon(
    resolveDefaultDaemonPort(),
    state?.port
  );
  if (result.kind === 'no-listener') {
    if (
      result.reason !== 'connection-refused'
      || (state !== null && !recordedDaemonPidIsProvenDead(state.pid))
    ) {
      return {
        ok: false,
        code: 'daemon_identity_ambiguous',
        message: messages().daemonIdentityAmbiguous,
      };
    }
    const supervisor = createSessionSupervisor({
      registry: createSessionRegistry(),
      resolveAgentCli: createAgentCliResolver(),
    });
    return {
      ok: true,
      mode: 'foreground',
      service: createReusableSessionService({ supervisor }),
    };
  }
  if (result.kind === 'foreign') {
    return {
      ok: false,
      code: 'daemon_foreign',
      message: messages().daemonForeign,
    };
  }
  if (result.version !== OWN_VERSION) {
    return {
      ok: false,
      code: 'daemon_version_mismatch',
      message: formatLocaleMessage(messages().daemonVersionMismatch, {
        expected: OWN_VERSION,
        actual: result.version,
      }),
    };
  }
  if (
    state === null
    || state.port !== port
    || state.pid !== result.pid
    || state.version !== result.version
    || state.token.length === 0
  ) {
    return {
      ok: false,
      code: 'daemon_identity_ambiguous',
      message: messages().daemonIdentityAmbiguous,
    };
  }
  return {
    ok: true,
    mode: 'daemon',
    port,
    token: state.token,
    pid: state.pid,
    version: state.version,
  };
}

export function sessionCommandExitCode(
  response: ReusableSessionApiResponse
): 0 | 1 | 2 | 3 | 4 | 5 {
  if (response.ok) {
    if (
      response.disposition === 'duplicate'
      && response.terminalDisposition === 'delivery_uncertain'
    ) {
      return 5;
    }
    if (
      response.disposition === 'duplicate'
      && response.terminalDisposition === 'pre_delivery_failed'
    ) {
      return 1;
    }
    return 0;
  }
  if (
    response.code === 'transport_uncertain'
    || response.code === 'delivery_uncertain'
    || response.code === 'turn_timeout'
    || response.code === 'no_output_timeout'
  ) {
    return 5;
  }
  if (
    response.code === 'wake_busy'
    || response.code === 'host_busy'
    || response.code === 'busy'
    || response.code === 'idempotency_capacity_exhausted'
    || response.code === 'registry_lock_timeout'
    || response.code === 'wake_lock_timeout'
  ) {
    return 3;
  }
  if (
    response.code === 'session_not_found'
    || response.code === 'session_retired'
    || response.code === 'session_stale'
    || response.code === 'session_unrecoverable'
    || response.code === 'host_not_found'
    || response.code === 'host_retired'
    || response.code === 'host_unrecoverable'
    || response.code === 'registry_absent'
    || response.code === 'conditional_wake_stale'
  ) {
    return 4;
  }
  if (
    response.code === 'invalid_request'
    || response.code === 'invalid_action'
    || response.code === 'bad_request'
    || response.code === 'payload_too_large'
    || response.code === 'run_not_found'
    || response.code === 'run_identity_mismatch'
    || response.code === 'run_directory_invalid'
    || response.code === 'run_mismatch'
    || response.code === 'session_conflict'
    || response.code === 'invalid_transition'
  ) {
    return 2;
  }
  return 1;
}

function commandEnvelope(
  command: SessionCommandName,
  ownerMode: OwnerMode | undefined,
  response: ReusableSessionApiResponse,
  runId: string,
  sessionKey?: string
): Record<string, unknown> {
  const exit = sessionCommandExitCode(response);
  return {
    schema: SESSION_COMMAND_SCHEMA,
    command,
    ok: exit === 0,
    ...(ownerMode !== undefined ? { ownerMode } : {}),
    runId,
    ...(sessionKey !== undefined ? { sessionKey } : {}),
    outcome: {
      code: response.code,
      ...(response.ok && response.disposition !== undefined
        ? { disposition: response.disposition }
        : {}),
      ...(response.ok && response.terminalDisposition !== undefined
        ? { terminalDisposition: response.terminalDisposition }
        : {}),
      ...(!response.ok ? { message: response.message } : {}),
      ...(!response.ok && response.failures !== undefined
        ? { failures: response.failures }
        : {}),
    },
    ...(response.ok && response.session !== undefined
      ? { session: response.session }
      : {}),
    ...(response.ok && response.sessions !== undefined
      ? { sessions: response.sessions }
      : {}),
  };
}

function printHuman(
  command: SessionCommandName,
  response: ReusableSessionApiResponse,
  ownerMode: OwnerMode | undefined
): void {
  const copy = messages();
  if (!response.ok) {
    console.error(
      formatLocaleMessage(copy.failure, {
        code: response.code,
        message: outcomeMessage(response.code),
      })
    );
    for (const diagnostic of response.failures ?? []) {
      console.error(
        formatLocaleMessage(copy.shutdownDiagnostic, {
          run: diagnostic.runId ?? copy.sharedOwner,
          code: diagnostic.code,
          message: diagnostic.message,
        })
      );
    }
    return;
  }
  if (ownerMode === 'foreground') {
    console.log(copy.foregroundNotice);
  }
  if (command === 'exec') {
    if (response.disposition === 'duplicate') {
      const key =
        response.terminalDisposition === 'completed'
          ? 'duplicateCompleted'
          : response.terminalDisposition === 'delivery_uncertain'
            ? 'duplicateUncertain'
            : 'duplicatePreDeliveryFailed';
      console.log(copy[key]);
    } else {
      console.log(copy.completed);
    }
    return;
  }
  if (command === 'retire') {
    console.log(copy.retired);
    return;
  }
  const sessions = response.sessions ?? [];
  if (sessions.length === 0) {
    console.log(copy.listEmpty);
    return;
  }
  console.log(
    formatLocaleMessage(copy.listedHeading, { count: sessions.length })
  );
  for (const session of sessions) {
    console.log(
      formatLocaleMessage(copy.sessionLine, {
        session: session.sessionKey,
        role: session.role,
        status: session.status,
        cwd: session.cwd,
      })
    );
  }
}

function emitCommandResponse(
  command: SessionCommandName,
  response: ReusableSessionApiResponse,
  runId: string,
  sessionKey: string | undefined,
  json: boolean | undefined,
  ownerMode?: OwnerMode
): void {
  if (json) {
    console.log(
      JSON.stringify(
        commandEnvelope(command, ownerMode, response, runId, sessionKey)
      )
    );
  } else {
    printHuman(command, response, ownerMode);
  }
  process.exitCode = sessionCommandExitCode(response);
}

async function callWithOwner(
  command: SessionCommandName,
  runId: string,
  sessionKey: string | undefined,
  json: boolean | undefined,
  invokeForeground: (
    service: ReusableSessionService
  ) => Promise<ReusableSessionApiResponse>,
  daemon: {
    path: string;
    method: 'GET' | 'POST';
    body?: unknown;
  },
  ownerSelector: () => Promise<SessionOwnerSelection>
): Promise<void> {
  const owner = await ownerSelector();
  if (!owner.ok) {
    const response = localFailure(
      command === 'exec' ? 'wake' : command,
      owner.code,
      owner.message,
      runId,
      sessionKey
    );
    emitCommandResponse(command, response, runId, sessionKey, json);
    return;
  }

  let response: ReusableSessionApiResponse;
  if (owner.mode === 'daemon') {
    const operation = command === 'exec' ? 'wake' : command;
    const expectation: ReusableSessionApiResponseExpectation =
      operation === 'list'
        ? { operation, runId }
        : {
            operation,
            runId,
            sessionKey: sessionKey ?? '',
          };
    response = await daemonRequest(
      owner.port,
      owner.token,
      owner.pid,
      owner.version,
      expectation,
      daemon.path,
      daemon.method,
      daemon.body
    );
  } else {
    try {
      response = await invokeForeground(owner.service);
    } catch (error) {
      response = localFailure(
        command === 'exec' ? 'wake' : command,
        'owner_operation_failed',
        error instanceof Error
          ? error.message
          : 'The foreground reusable-session operation failed.',
        runId,
        sessionKey
      );
    } finally {
      try {
        const shutdown = await owner.service.ownerShutdown();
        if (!shutdown.ok) {
          response = localFailure(
            command === 'exec' ? 'wake' : command,
            'owner_shutdown_failed',
            shutdown.message,
            runId,
            sessionKey,
            shutdown.failures
          );
        }
      } catch {
        response = localFailure(
          command === 'exec' ? 'wake' : command,
          'owner_shutdown_failed',
          'The foreground owner failed to shut down.',
          runId,
          sessionKey
        );
      }
    }
  }
  emitCommandResponse(
    command,
    response,
    runId,
    sessionKey,
    json,
    owner.mode
  );
}

async function runExec(
  options: ExecOptions,
  ownerSelector: () => Promise<SessionOwnerSelection>
): Promise<void> {
  const runId = options.run ?? '';
  const sessionKey = options.session ?? '';
  if (
    options.run === undefined
    || options.session === undefined
    || options.action === undefined
    || options.cwd === undefined
  ) {
    emitCommandResponse(
      'exec',
      localFailure(
        'wake',
        'invalid_request',
        'Exec requires --run, --session, --action, and --cwd.',
        runId,
        sessionKey || undefined
      ),
      runId,
      sessionKey || undefined,
      options.json
    );
    return;
  }
  const selectedRunId = options.run;
  const selectedSessionKey = options.session;
  const actionSource = options.action;
  const requestedCwd = options.cwd;
  const action = await readSessionActionSource(actionSource);
  if ('error' in action) {
    const response = localFailure(
      'wake',
      'invalid_action',
      action.error,
      options.run,
      options.session
    );
    if (options.json) {
      console.log(
        JSON.stringify(
          commandEnvelope(
            'exec',
            undefined,
            response,
            options.run,
            options.session
          )
        )
      );
    } else {
      printHuman('exec', response, undefined);
    }
    process.exitCode = 2;
    return;
  }
  if (
    action.kind !== 'agent'
    || action.runId !== options.run
    || !RUN_ID_PATTERN.test(options.run)
    || !SESSION_KEY_PATTERN.test(options.session)
    || (
      options.messageId !== undefined
      && (
        options.messageId.length === 0
        || options.messageId.length > MAX_MESSAGE_ID_LENGTH
      )
    )
  ) {
    const response = localFailure(
      'wake',
      'invalid_action',
      'The action must be an agent action for the selected exact Run.',
      options.run,
      options.session
    );
    if (options.json) {
      console.log(
        JSON.stringify(
          commandEnvelope(
            'exec',
            undefined,
            response,
            options.run,
            options.session
          )
        )
      );
    } else {
      printHuman('exec', response, undefined);
    }
    process.exitCode = 2;
    return;
  }
  const cwd = canonicalCommandCwd(requestedCwd);
  if (typeof cwd !== 'string') {
    const response = localFailure(
      'wake',
      'invalid_action',
      cwd.error,
      options.run,
      options.session
    );
    if (options.json) {
      console.log(JSON.stringify(commandEnvelope(
        'exec',
        undefined,
        response,
        options.run,
        options.session
      )));
    } else {
      printHuman('exec', response, undefined);
    }
    process.exitCode = 2;
    return;
  }
  const touch = options.touch ?? 'never';
  const deadlineAction = options.deadlineAction ?? 'stop';
  if (
    (touch !== 'auto' && touch !== 'never')
    || (
      deadlineAction !== 'stop'
      && deadlineAction !== 'retire-silent'
    )
  ) {
    const response = localFailure(
      'wake',
      'invalid_action',
      'The touch mode or deadline action is invalid.',
      options.run,
      options.session
    );
    if (options.json) {
      console.log(
        JSON.stringify(
          commandEnvelope(
            'exec',
            undefined,
            response,
            options.run,
            options.session
          )
        )
      );
    } else {
      printHuman('exec', response, undefined);
    }
    process.exitCode = 2;
    return;
  }
  let maxTouches = 0;
  if (touch === 'auto') {
    const parsed = parsePositiveInteger(options.maxTouches, '--max-touches');
    if (typeof parsed !== 'number') {
      const response = localFailure(
        'wake',
        'invalid_action',
        parsed.error,
        options.run,
        options.session
      );
      if (options.json) {
        console.log(
          JSON.stringify(
            commandEnvelope(
              'exec',
              undefined,
              response,
              options.run,
              options.session
            )
          )
        );
      } else {
        printHuman('exec', response, undefined);
      }
      process.exitCode = 2;
      return;
    }
    maxTouches = parsed;
    const deadline =
      options.touchDeadline === undefined
        ? undefined
        : new Date(options.touchDeadline);
    if (
      deadline === undefined
      || !Number.isFinite(deadline.valueOf())
      || deadline.toISOString() !== options.touchDeadline
      || deadline.valueOf() <= Date.now()
    ) {
      const response = localFailure(
        'wake',
        'invalid_action',
        'Auto touch mode requires a future ISO-8601 UTC --touch-deadline.',
        options.run,
        options.session
      );
      if (options.json) {
        console.log(JSON.stringify(commandEnvelope(
          'exec',
          undefined,
          response,
          options.run,
          options.session
        )));
      } else {
        printHuman('exec', response, undefined);
      }
      process.exitCode = 2;
      return;
    }
  } else if (
    options.touchDeadline !== undefined
    || options.maxTouches !== undefined
  ) {
    const response = localFailure(
      'wake',
      'invalid_action',
      'A never touch policy cannot carry --touch-deadline or --max-touches.',
      options.run,
      options.session
    );
    if (options.json) {
      console.log(
        JSON.stringify(
          commandEnvelope(
            'exec',
            undefined,
            response,
            options.run,
            options.session
          )
        )
      );
    } else {
      printHuman('exec', response, undefined);
    }
    process.exitCode = 2;
    return;
  }
  const request: ReusableSessionWakeRequest = {
    schema: REUSABLE_SESSION_API_SCHEMA,
    op: 'wake',
    kind: 'interactive',
    runId: selectedRunId,
    sessionKey: selectedSessionKey,
    action,
    cwd,
    ...(options.messageId !== undefined
      ? { messageId: options.messageId }
      : {}),
    touchPolicy: {
      mode: touch,
      ...(options.touchDeadline !== undefined
        ? { deadlineAt: options.touchDeadline }
        : {}),
      maxTouches,
      deadlineAction,
    },
  };
  await callWithOwner(
    'exec',
    selectedRunId,
    selectedSessionKey,
    options.json,
    (service) => service.wake(request),
    {
      path: '/api/v1/reusable-sessions/wake',
      method: 'POST',
      body: request,
    },
    ownerSelector
  );
}

async function runList(
  options: ListOptions,
  ownerSelector: () => Promise<SessionOwnerSelection>
): Promise<void> {
  const runId = options.run ?? '';
  if (options.run === undefined) {
    emitCommandResponse(
      'list',
      localFailure(
        'list',
        'invalid_request',
        'List requires --run.',
        runId
      ),
      runId,
      undefined,
      options.json
    );
    return;
  }
  const selectedRunId = options.run;
  if (!RUN_ID_PATTERN.test(selectedRunId)) {
    const response = localFailure(
      'list',
      'invalid_request',
      'List requires one exact canonical Run id.',
      selectedRunId
    );
    if (options.json) {
      console.log(JSON.stringify(commandEnvelope(
        'list',
        undefined,
        response,
        selectedRunId
      )));
    } else {
      printHuman('list', response, undefined);
    }
    process.exitCode = 2;
    return;
  }
  await callWithOwner(
    'list',
    selectedRunId,
    undefined,
    options.json,
    (service) => service.list({ runId: selectedRunId }),
    {
      path: `/api/v1/reusable-sessions?runId=${encodeURIComponent(selectedRunId)}`,
      method: 'GET',
    },
    ownerSelector
  );
}

async function runRetire(
  options: RetireOptions,
  ownerSelector: () => Promise<SessionOwnerSelection>
): Promise<void> {
  const runId = options.run ?? '';
  const sessionKey = options.session ?? '';
  if (options.run === undefined || options.session === undefined) {
    emitCommandResponse(
      'retire',
      localFailure(
        'retire',
        'invalid_request',
        'Retire requires --run and --session.',
        runId,
        sessionKey || undefined
      ),
      runId,
      sessionKey || undefined,
      options.json
    );
    return;
  }
  const selectedRunId = options.run;
  const selectedSessionKey = options.session;
  const reason = options.reason ?? 'user-requested';
  if (
    !RUN_ID_PATTERN.test(selectedRunId)
    || !SESSION_KEY_PATTERN.test(selectedSessionKey)
    || reason.length === 0
    || reason.length > 512
  ) {
    const response = localFailure(
      'retire',
      'invalid_request',
      'Retire requires an exact Run id, a bounded session key, and a bounded reason.',
      selectedRunId,
      selectedSessionKey
    );
    if (options.json) {
      console.log(JSON.stringify(commandEnvelope(
        'retire',
        undefined,
        response,
        selectedRunId,
        selectedSessionKey
      )));
    } else {
      printHuman('retire', response, undefined);
    }
    process.exitCode = 2;
    return;
  }
  const request = {
    schema: REUSABLE_SESSION_API_SCHEMA,
    op: 'retire' as const,
    runId: selectedRunId,
    sessionKey: selectedSessionKey,
    reason,
  };
  await callWithOwner(
    'retire',
    selectedRunId,
    selectedSessionKey,
    options.json,
    (service) => service.retire(request),
    {
      path: '/api/v1/reusable-sessions/retire',
      method: 'POST',
      body: request,
    },
    ownerSelector
  );
}

export interface SessionCommandDependencies {
  selectOwner?: () => Promise<SessionOwnerSelection>;
}

export function registerSessionCommand(
  program: Command,
  locale: CliLocale = getCliLocale(),
  dependencies: SessionCommandDependencies = {}
): void {
  const examples = getLocaleCatalog(locale).session.examples;
  const ownerSelector = dependencies.selectOwner ?? selectSessionOwner;
  const session = program.command('session').description('');

  session
    .command('exec')
    .description('')
    .option('--run <run-id>', '')
    .option('--session <session-key>', '')
    .option('--action <file|->', '')
    .option('--cwd <path>', '')
    .option('--message-id <id>', '')
    .option('--touch <mode>', '')
    .option('--touch-deadline <timestamp>', '')
    .option('--max-touches <n>', '')
    .option('--deadline-action <action>', '')
    .option('--json', '')
    .addHelpText('after', `\n${examples.exec}`)
    .action(async (options: ExecOptions) => {
      await runExec(options, ownerSelector);
    });

  session
    .command('list')
    .description('')
    .option('--run <run-id>', '')
    .option('--json', '')
    .addHelpText('after', `\n${examples.list}`)
    .action(async (options: ListOptions) => {
      await runList(options, ownerSelector);
    });

  session
    .command('retire')
    .description('')
    .option('--run <run-id>', '')
    .option('--session <session-key>', '')
    .option('--reason <text>', '')
    .option('--json', '')
    .addHelpText('after', `\n${examples.retire}`)
    .action(async (options: RetireOptions) => {
      await runRetire(options, ownerSelector);
    });
}
