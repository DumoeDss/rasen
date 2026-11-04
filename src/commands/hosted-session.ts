import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { ownVersion, spawnDaemonDetached } from './daemon.js';
import {
  readDaemonState,
  type DaemonState,
} from '../core/management-api/daemon-state.js';
import {
  probeDaemon,
  resolveDefaultDaemonPort,
} from '../core/management-api/daemon-probe.js';

const MAX_PROMPT_BYTES = 2 * 1024 * 1024;
const SESSION_CLI_BACKENDS = new Set(['claude']);
const SESSION_INIT_TIMEOUT_MS = 30_000;
const SESSION_NO_OUTPUT_TIMEOUT_MS = 120_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LocalDaemonEndpoint {
  port: number;
  token: string;
}

export interface HostedSessionExecOptions {
  backend: string;
  promptFile: string;
  cwd: string;
  session?: string;
  requestId?: string;
  timeoutMs: string;
  json?: boolean;
}

class HostedSessionCommandError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'HostedSessionCommandError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stateMatchesLive(
  state: DaemonState | null,
  live: { port: number; version: string; pid: number }
): state is DaemonState {
  return Boolean(
    state &&
      state.port === live.port &&
      state.version === live.version &&
      state.pid === live.pid &&
      typeof state.token === 'string' &&
      state.token.length >= 32
  );
}

/** Adopt or start only a positively identified same-version daemon. */
export async function ensureLocalDaemonForSession(): Promise<LocalDaemonEndpoint> {
  const version = ownVersion();
  const state = readDaemonState();
  const discovered = await probeDaemon(resolveDefaultDaemonPort(), state?.port);
  if (discovered.result.kind === 'foreign') {
    throw new HostedSessionCommandError(
      'foreign-listener',
      `Port ${discovered.port} is owned by a non-Rasen process; refusing hosted Session control.`
    );
  }
  if (discovered.result.kind === 'rasen-daemon') {
    if (discovered.result.version !== version) {
      throw new HostedSessionCommandError(
        'daemon-version-mismatch',
        `Hosted Session control requires daemon ${version}, but ${discovered.result.version} is running.`
      );
    }
    if (
      !stateMatchesLive(state, {
        port: discovered.port,
        version: discovered.result.version,
        pid: discovered.result.pid,
      })
    ) {
      throw new HostedSessionCommandError(
        'daemon-identity-mismatch',
        'The live daemon identity does not match its authenticated state file.'
      );
    }
    return { port: state.port, token: state.token };
  }

  const port = resolveDefaultDaemonPort();
  const spawned = await spawnDaemonDetached(port, version);
  if (!spawned.ok) {
    throw new HostedSessionCommandError(spawned.reason, spawned.message);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const fresh = readDaemonState();
    if (
      stateMatchesLive(fresh, {
        port: spawned.port,
        version: spawned.version,
        pid: spawned.pid,
      })
    ) {
      return { port: fresh.port, token: fresh.token };
    }
    await sleep(25);
  }
  throw new HostedSessionCommandError(
    'daemon-identity-mismatch',
    'The newly started daemon did not publish matching authenticated state.'
  );
}

function localJsonRequest(
  endpoint: LocalDaemonEndpoint,
  method: 'GET' | 'POST',
  requestPath: string,
  body?: unknown
): Promise<{ status: number; value: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        method,
        path: requestPath,
        agent: false,
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({
              status: response.statusCode ?? 0,
              value: text ? (JSON.parse(text) as unknown) : undefined,
            });
          } catch {
            reject(
              new HostedSessionCommandError(
                'invalid-daemon-response',
                'Daemon returned invalid JSON.'
              )
            );
          }
        });
      }
    );
    request.setTimeout(35_000, () =>
      request.destroy(new Error('daemon request timeout'))
    );
    request.on('error', reject);
    request.end(payload);
  });
}

function output(value: unknown, json: boolean, text: string): void {
  console.log(json ? JSON.stringify(value) : text);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function responseSessionId(value: unknown): string | undefined {
  const session = objectValue(objectValue(value)?.session);
  return typeof session?.sessionId === 'string' ? session.sessionId : undefined;
}

function responseSessionCount(value: unknown): number {
  const sessions = objectValue(value)?.sessions;
  return Array.isArray(sessions) ? sessions.length : 0;
}

function fail(error: unknown, json: boolean): void {
  const code =
    error instanceof HostedSessionCommandError
      ? error.code
      : 'session-command-failed';
  const message = error instanceof Error ? error.message : String(error);
  const receipt = { ok: false, code, message };
  if (json) console.log(JSON.stringify(receipt));
  else console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function parseTimeout(value: string): number {
  const timeout = Number(value);
  if (
    !Number.isInteger(timeout) ||
    timeout <= 0 ||
    timeout > 24 * 60 * 60 * 1000
  ) {
    throw new HostedSessionCommandError(
      'invalid-input',
      '--timeout-ms must be a positive integer no greater than 86400000.'
    );
  }
  return timeout;
}

function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new HostedSessionCommandError(
      'invalid-input',
      `${label} must be a UUID.`
    );
  }
  return value;
}

export async function runHostedSessionExec(
  options: HostedSessionExecOptions
): Promise<void> {
  const json = options.json ?? false;
  try {
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(options.backend) ||
      !SESSION_CLI_BACKENDS.has(options.backend)
    ) {
      throw new HostedSessionCommandError(
        'invalid-input',
        '--backend must name a supported hosted backend.'
      );
    }
    const requestId = requireUuid(
      options.requestId ?? randomUUID(),
      '--request-id'
    );
    const sessionId = options.session
      ? requireUuid(options.session, '--session')
      : undefined;
    const timeoutMs = parseTimeout(options.timeoutMs);
    const promptPath = path.resolve(options.promptFile);
    let promptStat: fs.Stats;
    try {
      promptStat = fs.statSync(promptPath);
    } catch (error) {
      throw new HostedSessionCommandError(
        'invalid-input',
        `--prompt-file is unavailable (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`
      );
    }
    if (
      !promptStat.isFile() ||
      promptStat.size <= 0 ||
      promptStat.size > MAX_PROMPT_BYTES
    ) {
      throw new HostedSessionCommandError(
        'invalid-input',
        `--prompt-file must be a non-empty file no larger than ${MAX_PROMPT_BYTES} bytes.`
      );
    }
    let cwdStat: fs.Stats;
    try {
      cwdStat = fs.statSync(options.cwd);
    } catch (error) {
      throw new HostedSessionCommandError(
        'invalid-input',
        `--cwd is unavailable (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`
      );
    }
    if (!cwdStat.isDirectory()) {
      throw new HostedSessionCommandError(
        'invalid-input',
        '--cwd must be a directory.'
      );
    }
    let input: string;
    let canonicalCwd: string;
    try {
      input = fs.readFileSync(promptPath, 'utf8');
    } catch (error) {
      throw new HostedSessionCommandError(
        'invalid-input',
        `--prompt-file cannot be read (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`
      );
    }
    try {
      canonicalCwd = fs.realpathSync.native(options.cwd);
    } catch (error) {
      throw new HostedSessionCommandError(
        'invalid-input',
        `--cwd cannot be canonicalized (${(error as NodeJS.ErrnoException).code ?? 'unknown'}).`
      );
    }
    const endpoint = await ensureLocalDaemonForSession();
    const response = await localJsonRequest(
      endpoint,
      'POST',
      '/api/v1/hosted-sessions/execute',
      {
        requestId,
        ...(sessionId ? { sessionId } : {}),
        backend: options.backend,
        cwd: canonicalCwd,
        input,
        limits: {
          timeoutMs,
          initTimeoutMs: Math.min(timeoutMs, SESSION_INIT_TIMEOUT_MS),
          noOutputTimeoutMs: Math.min(timeoutMs, SESSION_NO_OUTPUT_TIMEOUT_MS),
          overallTimeoutMs: timeoutMs,
          maxInputBytes: MAX_PROMPT_BYTES,
          maxOutputBytes: 256 * 1024,
          maxLineBytes: 256 * 1024,
          maxDiagnosticBytes: 4096,
        },
      }
    );
    const ok = objectValue(response.value)?.ok === true;
    output(
      response.value,
      json,
      ok
        ? `Hosted Session ${responseSessionId(response.value) ?? 'unknown'} settled request ${requestId}.`
        : `Hosted Session request failed (${response.status}).`
    );
    if (!ok) process.exitCode = 1;
  } catch (error) {
    fail(error, json);
  }
}

export async function runHostedSessionRead(
  operation: 'list' | 'inspect',
  sessionId: string | undefined,
  json: boolean
): Promise<void> {
  try {
    const endpoint = await ensureLocalDaemonForSession();
    const requestPath =
      operation === 'list'
        ? '/api/v1/hosted-sessions'
        : `/api/v1/hosted-sessions/${requireUuid(sessionId ?? '', 'session id')}`;
    const response = await localJsonRequest(endpoint, 'GET', requestPath);
    output(
      response.value,
      json,
      operation === 'list'
        ? `${responseSessionCount(response.value)} hosted Session(s).`
        : `Hosted Session ${responseSessionId(response.value) ?? 'not found'}.`
    );
    if (response.status >= 400) process.exitCode = 1;
  } catch (error) {
    fail(error, json);
  }
}

export async function runHostedSessionControl(
  operation: 'cancel' | 'restart' | 'retire',
  sessionId: string,
  reason: string | undefined,
  json: boolean
): Promise<void> {
  try {
    requireUuid(sessionId, 'session id');
    const endpoint = await ensureLocalDaemonForSession();
    const response = await localJsonRequest(
      endpoint,
      'POST',
      `/api/v1/hosted-sessions/${sessionId}/${operation}`,
      operation === 'restart'
        ? {}
        : { reason: reason?.trim() || `cli-${operation}` }
    );
    output(
      response.value,
      json,
      `Hosted Session ${sessionId}: ${operation} ${
        response.status < 400 ? 'accepted' : 'failed'
      }.`
    );
    if (response.status >= 400) process.exitCode = 1;
  } catch (error) {
    fail(error, json);
  }
}
