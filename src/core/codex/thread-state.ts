import * as fs from 'node:fs';
import * as path from 'node:path';
import { getGlobalDataDir } from '../global-config.js';
import { isNodeErrorCode } from '../file-state.js';
import {
  claimClaudeSessionWriter,
  bindClaudeSessionCwd,
  getClaudeSessionStatePaths,
  isClaudeSessionWriterClaimed,
  ClaudeSessionBusyError,
  ClaudeSessionCwdMismatchError,
  ClaudeSessionStateError,
  type ClaudeSessionStateOptions,
} from '../claude/session-state.js';
import type { CodexSandboxMode } from './invocation.js';

const CODEX_THREAD_METADATA_VERSION = 1;

interface CodexThreadMetadataRecord {
  version: typeof CODEX_THREAD_METADATA_VERSION;
  threadId: string;
  sandbox: CodexSandboxMode;
  createdAt: string;
}

export type CodexThreadStateOptions = ClaudeSessionStateOptions;

export interface CodexThreadWriterClaim {
  threadId: string;
  cwd: string;
  /** Absent for legacy thread records created before sandbox persistence. */
  sandbox?: CodexSandboxMode;
  bindWorker: (rootPid: number) => void;
  release: () => Promise<void>;
}

export class CodexThreadBusyError extends Error {
  constructor(threadId: string) {
    super(`Codex thread "${threadId}" already has an active writer.`);
    this.name = 'CodexThreadBusyError';
  }
}

export class CodexThreadCwdMismatchError extends Error {
  constructor(
    threadId: string,
    public readonly recordedCwd: string,
    public readonly requestedCwd: string
  ) {
    super(`Codex thread "${threadId}" was created in "${recordedCwd}", not "${requestedCwd}".`);
    this.name = 'CodexThreadCwdMismatchError';
  }
}

export class CodexThreadStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodexThreadStateError';
  }
}

function stateOptions(options: CodexThreadStateOptions): ClaudeSessionStateOptions {
  return {
    ...options,
    stateDir:
      options.stateDir ?? path.join(getGlobalDataDir({ env: options.env }), 'codex-threads'),
  };
}

function remapStateError(error: unknown, threadId: string): never {
  if (error instanceof ClaudeSessionBusyError) throw new CodexThreadBusyError(threadId);
  if (error instanceof ClaudeSessionCwdMismatchError) {
    throw new CodexThreadCwdMismatchError(
      threadId,
      error.recordedCwd,
      error.requestedCwd
    );
  }
  if (error instanceof CodexThreadStateError) throw error;
  throw new CodexThreadStateError(
    error instanceof ClaudeSessionStateError || error instanceof Error
      ? error.message.replaceAll('Claude session', 'Codex thread')
      : String(error),
    { cause: error }
  );
}

function metadataPath(
  threadId: string,
  options: CodexThreadStateOptions
): string {
  return `${getClaudeSessionStatePaths(threadId, stateOptions(options)).recordPath}.codex.json`;
}

function parseMetadataRecord(
  content: string,
  expectedThreadId: string
): CodexThreadMetadataRecord {
  try {
    const parsed = JSON.parse(content) as Partial<CodexThreadMetadataRecord>;
    if (
      parsed.version !== CODEX_THREAD_METADATA_VERSION ||
      parsed.threadId !== expectedThreadId ||
      (parsed.sandbox !== 'read-only' && parsed.sandbox !== 'workspace-write') ||
      typeof parsed.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.createdAt))
    ) {
      throw new Error('invalid record shape');
    }
    return parsed as CodexThreadMetadataRecord;
  } catch (error) {
    throw new CodexThreadStateError(
      `Codex thread metadata for "${expectedThreadId}" is invalid.`,
      { cause: error }
    );
  }
}

/** Returns no value for legacy thread records that predate sandbox metadata. */
export async function getCodexThreadSandbox(
  threadId: string,
  options: CodexThreadStateOptions = {}
): Promise<CodexSandboxMode | undefined> {
  try {
    const content = await fs.promises.readFile(metadataPath(threadId, options), 'utf8');
    return parseMetadataRecord(content, threadId).sandbox;
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined;
    return remapStateError(error, threadId);
  }
}

async function bindCodexThreadSandbox(
  threadId: string,
  sandbox: CodexSandboxMode,
  options: CodexThreadStateOptions
): Promise<CodexSandboxMode> {
  const recordPath = metadataPath(threadId, options);
  await fs.promises.mkdir(path.dirname(recordPath), { recursive: true, mode: 0o700 });
  const record: CodexThreadMetadataRecord = {
    version: CODEX_THREAD_METADATA_VERSION,
    threadId,
    sandbox,
    createdAt: new Date().toISOString(),
  };
  try {
    await fs.promises.writeFile(recordPath, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return sandbox;
  } catch (error) {
    if (!isNodeErrorCode(error, 'EEXIST')) return remapStateError(error, threadId);
  }

  const existing = parseMetadataRecord(
    await fs.promises.readFile(recordPath, 'utf8'),
    threadId
  );
  if (existing.sandbox !== sandbox) {
    throw new CodexThreadStateError(
      `Codex thread "${threadId}" was created with sandbox "${existing.sandbox}", not "${sandbox}".`
    );
  }
  return existing.sandbox;
}

export async function claimCodexThreadWriter(
  threadId: string,
  cwd: string,
  options: CodexThreadStateOptions = {}
): Promise<CodexThreadWriterClaim> {
  let claim: Awaited<ReturnType<typeof claimClaudeSessionWriter>> | undefined;
  try {
    claim = await claimClaudeSessionWriter(threadId, cwd, stateOptions(options));
    const sandbox = await getCodexThreadSandbox(threadId, options);
    return {
      threadId,
      cwd: claim.cwd,
      ...(sandbox ? { sandbox } : {}),
      bindWorker: claim.bindWorker,
      release: claim.release,
    };
  } catch (error) {
    await claim?.release();
    return remapStateError(error, threadId);
  }
}

export async function bindCodexThreadCwd(
  threadId: string,
  cwd: string,
  options: CodexThreadStateOptions = {}
): Promise<string> {
  try {
    return await bindClaudeSessionCwd(threadId, cwd, stateOptions(options));
  } catch (error) {
    return remapStateError(error, threadId);
  }
}

/**
 * Records fresh-thread creation metadata. Cwd is bound first so a partial
 * legacy-compatible record never fabricates a sandbox for the wrong cwd.
 */
export async function bindCodexThreadState(
  threadId: string,
  cwd: string,
  sandbox: CodexSandboxMode,
  options: CodexThreadStateOptions = {}
): Promise<{ cwd: string; sandbox: CodexSandboxMode }> {
  const canonicalCwd = await bindCodexThreadCwd(threadId, cwd, options);
  const recordedSandbox = await bindCodexThreadSandbox(threadId, sandbox, options);
  return { cwd: canonicalCwd, sandbox: recordedSandbox };
}

export async function isCodexThreadWriterClaimed(
  threadId: string,
  options: CodexThreadStateOptions = {}
): Promise<boolean> {
  return isClaudeSessionWriterClaimed(threadId, stateOptions(options));
}
