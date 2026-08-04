import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSystemUtils } from '../../utils/file-system.js';
import { BoundedUtf8Capture, sanitizeAgentDiagnostic } from '../agent-diagnostics.js';
import {
  DEFAULT_AGENT_STDIN_LIMIT_BYTES,
  endAgentCliStdin,
  spawnAgentCli,
  validateAgentCliStdinPayload,
} from '../agent-cli-process.js';
import { killProcessTree } from '../management-api/kill-tree.js';
import {
  workerContractJsonSchema,
  type WorkerContract,
} from '../worker-contracts.js';
import { extractThreadId } from './exec-events.js';
import {
  buildCodexExecInvocation,
  type CodexSandboxMode,
} from './invocation.js';
import { findRolloutPath } from './rollout.js';
import {
  codexFailureReceipt,
  parseCodexLastMessage,
  type CodexDispatchReceipt,
  type CodexFailureReceipt,
} from './result.js';
import {
  claimCodexThreadWriter,
  bindCodexThreadState,
  CodexThreadBusyError,
  CodexThreadCwdMismatchError,
  type CodexThreadStateOptions,
  type CodexThreadWriterClaim,
} from './thread-state.js';
import type { LeafEffort } from '../pipeline-registry/types.js';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const DEFAULT_LAST_MESSAGE_LIMIT_BYTES = 256 * 1024;

export interface RunCodexExecOptions {
  binary: string;
  prompt: string;
  contract: WorkerContract;
  sandbox: CodexSandboxMode;
  cwd: string;
  model?: string;
  effort?: LeafEffort;
  resumeThreadId?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxStdinBytes?: number;
  maxLastMessageBytes?: number;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawnAgentCli;
  threadStateDir?: string;
  scratchParent?: string;
  codexHome?: string;
}

interface ScratchFiles {
  dir: string;
  schema: string;
  lastMessage: string;
}

async function createScratch(
  parent: string,
  contract: WorkerContract
): Promise<ScratchFiles> {
  const dir = await fs.promises.mkdtemp(path.join(parent, 'rasen-codex-'));
  const schema = path.join(dir, 'output-schema.json');
  const lastMessage = path.join(dir, 'last-message.json');
  await fs.promises.writeFile(
    schema,
    `${JSON.stringify(workerContractJsonSchema(contract))}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  );
  return { dir, schema, lastMessage };
}

async function cleanupScratch(scratch: ScratchFiles): Promise<string | undefined> {
  const failures: string[] = [];
  for (const file of [scratch.schema, scratch.lastMessage]) {
    try {
      await fs.promises.rm(file, { force: true, maxRetries: 3, retryDelay: 40 });
    } catch (error) {
      failures.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    await fs.promises.rmdir(scratch.dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      failures.push(`scratch directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures.length > 0 ? failures.join('; ') : undefined;
}

function diagnostics(
  stdout: string,
  stderr: string,
  exitCode?: number | null,
  signal?: NodeJS.Signals | null
): CodexFailureReceipt['diagnostics'] {
  return {
    ...(typeof exitCode === 'number' ? { exitCode } : {}),
    ...(signal ? { signal } : {}),
    ...(stdout ? { stdout: sanitizeAgentDiagnostic(stdout) } : {}),
    ...(stderr ? { stderr: sanitizeAgentDiagnostic(stderr) } : {}),
  };
}

async function readLastMessageBounded(
  file: string,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; kind: 'last-message-missing' | 'output-limit'; message: string }> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return { ok: false, kind: 'last-message-missing', message: 'Codex did not write the requested last-message file.' };
  }
  if (!stat.isFile() || stat.size === 0) {
    return { ok: false, kind: 'last-message-missing', message: 'Codex last-message file is absent or empty.' };
  }
  if (stat.size > maxBytes) {
    return { ok: false, kind: 'output-limit', message: `Codex last message exceeded the ${maxBytes}-byte limit.` };
  }
  return { ok: true, text: await fs.promises.readFile(file, 'utf8') };
}

function claimFailure(
  contract: WorkerContract,
  error: unknown,
  threadId: string,
  cwd: string
): CodexDispatchReceipt {
  if (error instanceof CodexThreadBusyError) {
    return codexFailureReceipt(contract, 'thread-busy', error.message, { threadId, cwd });
  }
  if (error instanceof CodexThreadCwdMismatchError) {
    return codexFailureReceipt(contract, 'resume-cwd-mismatch', error.message, {
      threadId,
      cwd,
      diagnostics: { lastMessage: `recorded cwd: ${error.recordedCwd}` },
    });
  }
  return codexFailureReceipt(
    contract,
    'spawn-failed',
    error instanceof Error ? error.message : String(error),
    { threadId, cwd }
  );
}

function attachCleanup(receipt: CodexDispatchReceipt, cleanup: string | undefined): void {
  if (!cleanup) return;
  const warning = `Codex scratch cleanup was incomplete: ${cleanup}`;
  if (receipt.ok) receipt.warnings = [...(receipt.warnings ?? []), warning];
  else receipt.diagnostics = { ...(receipt.diagnostics ?? {}), cleanup: sanitizeAgentDiagnostic(cleanup) };
}

/** Runs one bounded Codex exec turn and returns exactly one structured receipt. */
export async function runCodexExec(options: RunCodexExecOptions): Promise<CodexDispatchReceipt> {
  const canonicalCwd = FileSystemUtils.canonicalizeExistingPath(options.cwd);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  const maxStdinBytes = options.maxStdinBytes ?? DEFAULT_AGENT_STDIN_LIMIT_BYTES;
  const maxLastMessageBytes = options.maxLastMessageBytes ?? DEFAULT_LAST_MESSAGE_LIMIT_BYTES;
  const stateOptions: CodexThreadStateOptions = {
    env: options.env ?? process.env,
    ...(options.threadStateDir ? { stateDir: options.threadStateDir } : {}),
  };

  let claim: CodexThreadWriterClaim | undefined;
  if (options.resumeThreadId) {
    try {
      claim = await claimCodexThreadWriter(options.resumeThreadId, canonicalCwd, stateOptions);
    } catch (error) {
      return claimFailure(options.contract, error, options.resumeThreadId, canonicalCwd);
    }
  }

  let scratch: ScratchFiles;
  try {
    scratch = await createScratch(options.scratchParent ?? os.tmpdir(), options.contract);
  } catch (error) {
    await claim?.release();
    return codexFailureReceipt(
      options.contract,
      'spawn-failed',
      `Unable to prepare Codex structured-output files: ${error instanceof Error ? error.message : String(error)}`,
      { ...(options.resumeThreadId ? { threadId: options.resumeThreadId } : {}), cwd: canonicalCwd }
    );
  }

  const invocation = buildCodexExecInvocation({
    prompt: options.prompt,
    outputLastMessagePath: scratch.lastMessage,
    outputSchemaPath: scratch.schema,
    sandbox: options.sandbox,
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.resumeThreadId ? { resume: { threadId: options.resumeThreadId } } : {}),
  });
  try {
    // Bound the fully assembled payload (including the flat-hierarchy guard),
    // not merely the caller's prompt file, before any child is spawned.
    validateAgentCliStdinPayload(invocation.prompt, maxStdinBytes);
  } catch (error) {
    await claim?.release();
    const failure = codexFailureReceipt(
      options.contract,
      'invalid-input',
      error instanceof Error ? error.message : String(error),
      {
        ...(options.resumeThreadId ? { threadId: options.resumeThreadId } : {}),
        cwd: canonicalCwd,
        ...(!options.resumeThreadId ? { sandbox: options.sandbox } : {}),
        warnings: invocation.warnings,
      }
    );
    attachCleanup(failure, await cleanupScratch(scratch));
    return failure;
  }

  // Resume-time --sandbox is only a required CLI input; Codex ignores it.
  // Report the persisted creation-time value when known and omit the field for
  // legacy records rather than fabricating metadata from the current request.
  const receiptSandbox = options.resumeThreadId ? claim?.sandbox : options.sandbox;

  const receipt = await new Promise<CodexDispatchReceipt>((resolve) => {
    let child: ChildProcess;
    const stdoutCapture = new BoundedUtf8Capture(maxOutputBytes);
    const stderrCapture = new BoundedUtf8Capture(maxOutputBytes);
    let timedOut = false;
    let outputExceeded = false;
    let setupError: unknown;
    let spawnError: Error | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let killCancel: (() => void) | undefined;
    let terminationStarted = false;
    let stdinWrite: Promise<void> | undefined;

    const terminate = (graceMs = 250) => {
      if (terminationStarted || typeof child?.pid !== 'number') return;
      terminationStarted = true;
      killCancel = killProcessTree(child.pid, { graceMs }).cancel;
    };

    const finish = async (value: CodexDispatchReceipt) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (!terminationStarted) killCancel?.();
      await claim?.release();
      resolve(value);
    };

    try {
      child = (options.spawn ?? spawnAgentCli)(options.binary, invocation.spawnArgs, {
        cwd: canonicalCwd,
        env: options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      void finish(codexFailureReceipt(
        options.contract,
        'spawn-failed',
        error instanceof Error ? error.message : String(error),
        { ...(options.resumeThreadId ? { threadId: options.resumeThreadId } : {}), cwd: canonicalCwd, warnings: invocation.warnings }
      ));
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutCapture.append(chunk);
      if (stdoutCapture.exceeded && !outputExceeded) {
        outputExceeded = true;
        terminate();
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrCapture.append(chunk);
      if (stderrCapture.exceeded && !outputExceeded) {
        outputExceeded = true;
        terminate();
      }
    });
    child.on('error', (error) => {
      spawnError = error;
      terminate();
    });
    child.on('close', async (code, signal) => {
      // Stdin errors can race child close. Observe the shared writer result
      // before classifying the turn so EOF/EPIPE is one spawn-failed receipt.
      await stdinWrite?.catch(() => undefined);
      const stdout = stdoutCapture.finish();
      const stderr = stderrCapture.finish();
      const emittedThreadId = extractThreadId(stdout)?.trim() || undefined;
      const threadId = options.resumeThreadId ?? emittedThreadId;
      if (!options.resumeThreadId && emittedThreadId) {
        try {
          // A fresh Codex thread exists as soon as its durable identity is
          // emitted, even when the turn later times out or fails its result
          // contract. Persist creation metadata before classifying the turn so
          // an exact recovery resume never has to guess its sandbox.
          await bindCodexThreadState(
            emittedThreadId,
            canonicalCwd,
            options.sandbox,
            stateOptions
          );
        } catch (error) {
          setupError ??= error;
        }
      }
      const metadata = {
        ...(threadId ? { threadId } : {}),
        cwd: canonicalCwd,
        ...(receiptSandbox ? { sandbox: receiptSandbox } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.effort ? { effort: options.effort } : {}),
        warnings: invocation.warnings,
      };
      if (setupError || spawnError) {
        const failureError = setupError ?? spawnError;
        await finish(codexFailureReceipt(
          options.contract,
          'spawn-failed',
          failureError instanceof Error ? failureError.message : String(failureError),
          { ...metadata, diagnostics: diagnostics(stdout, stderr, code, signal) }
        ));
        return;
      }
      if (timedOut) {
        await finish(codexFailureReceipt(options.contract, 'timeout', `Codex worker exceeded the ${timeoutMs}ms timeout.`, {
          ...metadata,
          diagnostics: diagnostics(stdout, stderr, code, signal),
        }));
        return;
      }
      if (outputExceeded) {
        await finish(codexFailureReceipt(options.contract, 'output-limit', `Codex worker output exceeded the ${maxOutputBytes}-byte capture limit.`, {
          ...metadata,
          diagnostics: diagnostics(stdout, stderr, code, signal),
        }));
        return;
      }
      if (code !== 0) {
        await finish(codexFailureReceipt(options.contract, 'nonzero-exit', `Codex worker exited with code ${String(code)}${signal ? ` (${signal})` : ''}.`, {
          ...metadata,
          diagnostics: diagnostics(stdout, stderr, code, signal),
        }));
        return;
      }
      if (!options.resumeThreadId && !emittedThreadId) {
        await finish(codexFailureReceipt(options.contract, 'thread-id-missing', 'Codex fresh dispatch did not emit a non-empty thread.started.thread_id.', {
          ...metadata,
          diagnostics: diagnostics(stdout, stderr, code, signal),
        }));
        return;
      }
      if (options.resumeThreadId && emittedThreadId && emittedThreadId !== options.resumeThreadId) {
        await finish(codexFailureReceipt(options.contract, 'thread-id-mismatch', `Codex resume emitted thread "${emittedThreadId}" instead of requested thread "${options.resumeThreadId}".`, {
          ...metadata,
          diagnostics: diagnostics(stdout, stderr, code, signal),
        }));
        return;
      }
      const lastMessage = await readLastMessageBounded(scratch.lastMessage, maxLastMessageBytes);
      if (!lastMessage.ok) {
        await finish(codexFailureReceipt(options.contract, lastMessage.kind, lastMessage.message, {
          ...metadata,
          diagnostics: diagnostics(stdout, stderr, code, signal),
        }));
        return;
      }
      const exactThreadId = threadId!;
      const transcript = findRolloutPath(exactThreadId, {
        ...(options.codexHome ? { codexHome: options.codexHome } : {}),
      });
      await finish(parseCodexLastMessage(lastMessage.text, options.contract, {
        ...metadata,
        threadId: exactThreadId,
        cwd: canonicalCwd,
        ...(transcript ? { transcript } : {}),
      }));
    });

    try {
      if (claim) {
        if (typeof child.pid !== 'number') throw new Error('Codex worker did not expose a process-tree root PID.');
        claim.bindWorker(child.pid);
      }
      // Attach the bounded writer's error listener before releasing any prompt
      // bytes. The claim remains bound-before-release for exact resumes.
      stdinWrite = endAgentCliStdin(child, invocation.prompt, maxStdinBytes);
      void stdinWrite.catch((error) => {
        setupError ??= error;
        child.stdin?.destroy();
        terminate(0);
      });
    } catch (error) {
      setupError = error;
      child.stdin?.destroy();
      child.stdout?.resume();
      child.stderr?.resume();
      terminate(0);
    }
  });

  attachCleanup(receipt, await cleanupScratch(scratch));
  return receipt;
}
