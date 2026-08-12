import { type ChildProcess, spawn } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..', '..');
const cliEntry = path.join(projectRoot, 'dist', 'cli', 'index.js');
const DEFAULT_CLI_TIMEOUT_MS = 30_000;
const CLI_BUILD_READY_ENV = 'RASEN_TEST_CLI_BUILD_READY';

// Isolate global-config / data reads from the developer's machine. Otherwise a
// spawned CLI reads ~/.config|%APPDATA%/rasen/config.json, so a local custom
// profile/delivery (e.g. `delivery: skills`) makes skill-generation e2e
// tests fail (skills only, no commands generated). XDG_CONFIG_HOME and
// XDG_DATA_HOME take precedence on all platforms (see getGlobalConfigDir), so
// pointing them at an empty temp dir yields the default config + built-in schemas.
const isolatedConfigHome = mkdtempSync(path.join(os.tmpdir(), 'rasen-test-config-'));

// Belt-and-suspenders (relocate-machine-home task 4.2): RASEN_HOME now
// outranks XDG_CONFIG_HOME/XDG_DATA_HOME. Blanking it here (a genuinely
// unset RASEN_HOME resolves to undefined, not the literal empty string)
// means an ambient RASEN_HOME in the developer's or CI's real environment
// can never leak into a spawned CLI and silently redirect it away from the
// XDG isolation above — while an individual test can still opt in to
// exercising RASEN_HOME by setting it explicitly in its own `options.env`,
// which is applied after (and so wins over) this default.
const BLANK_RASEN_HOME = '';

let buildPromise: Promise<void> | undefined;
const activeCliChildren = new Set<ChildProcess>();

interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface RunCLIOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

export interface RunCLIResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  command: string;
}

function runCommand(command: string, args: string[], options: RunCommandOptions = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        reject(new Error(`Command failed (${reason}): ${command} ${args.join(' ')}`));
      }
    });
  });
}

function mergeEnv(
  ...sources: Array<NodeJS.ProcessEnv | undefined>
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {};

  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;

      if (process.platform === 'win32') {
        const existingKey = Object.keys(merged).find(
          (candidate) => candidate.toLowerCase() === key.toLowerCase()
        );
        if (existingKey && existingKey !== key) {
          delete merged[existingKey];
        }
      }

      merged[key] = value;
    }
  }

  return merged;
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    }).on('error', () => {
      child.kill('SIGKILL');
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function formatOutputTail(output: string): string {
  const lines = output.trimEnd().split(/\r?\n/);
  return lines.slice(-20).join('\n');
}

export function terminateActiveCliChildren(): void {
  for (const child of activeCliChildren) {
    terminateProcessTree(child);
  }
}

export async function ensureCliBuilt() {
  // Vitest globalSetup verifies the build once in the main process, then worker
  // forks inherit this marker. The marker is only ever SET by this process
  // after `ensureCliBuildFresh()` proved the bundle current, so an ambient or
  // stale value cannot make a worker trust an unverified dist.
  if (process.env[CLI_BUILD_READY_ENV] === '1' && existsSync(cliEntry)) {
    return;
  }
  await ensureCliBuildFresh();
}

/**
 * Compile only when `dist/` does not match the current sources.
 *
 * `build.js --if-stale` compares a fingerprint of the compiler inputs against
 * `dist/.build-fingerprint.json` and returns without touching anything when
 * they agree; when they disagree it takes a cross-process build lock before
 * cleaning and recompiling. That closes the original staleness gap — an
 * unmarked or stale `dist/` is still never trusted — WITHOUT making every
 * Vitest invocation delete the `dist/` another Vitest process is executing.
 *
 * The env marker is ignored here on purpose: this is the check that earns it.
 */
export async function ensureCliBuildFresh(): Promise<void> {
  delete process.env[CLI_BUILD_READY_ENV];

  if (!buildPromise) {
    buildPromise = runCommand('pnpm', ['run', 'build:if-stale']).catch((error) => {
      buildPromise = undefined;
      throw error;
    });
  }

  await buildPromise;

  if (!existsSync(cliEntry)) {
    throw new Error('CLI entry point missing after build. Expected dist/cli/index.js');
  }
  process.env[CLI_BUILD_READY_ENV] = '1';
}

export async function runCLI(args: string[] = [], options: RunCLIOptions = {}): Promise<RunCLIResult> {
  await ensureCliBuilt();

  const finalArgs = Array.isArray(args) ? args : [args];
  const invocation = [cliEntry, ...finalArgs].join(' ');

  return new Promise<RunCLIResult>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
    const child = spawn(process.execPath, [cliEntry, ...finalArgs], {
      cwd: options.cwd ?? projectRoot,
      env: mergeEnv(
        process.env,
        {
          XDG_CONFIG_HOME: isolatedConfigHome,
          XDG_DATA_HOME: isolatedConfigHome,
          RASEN_HOME: BLANK_RASEN_HOME,
          RASEN_LANG: 'en',
          RASEN_TELEMETRY: '0',
          OPEN_SPEC_INTERACTIVE: '0',
        },
        options.env
      ),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    // Prevent child process from keeping the event loop alive
    child.unref();
    activeCliChildren.add(child);

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);

    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      activeCliChildren.delete(child);
      // Explicitly destroy streams to prevent hanging handles
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      activeCliChildren.delete(child);
      // Explicitly destroy streams to prevent hanging handles
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      if (timedOut) {
        reject(
          new Error(
            [
              `CLI command timed out after ${timeoutMs}ms: node ${invocation}`,
              stderr ? `stderr tail:\n${formatOutputTail(stderr)}` : '',
              stdout ? `stdout tail:\n${formatOutputTail(stdout)}` : '',
            ]
              .filter(Boolean)
              .join('\n\n')
          )
        );
        return;
      }
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        timedOut,
        command: `node ${invocation}`,
      });
    });

    if (options.input && child.stdin) {
      child.stdin.end(options.input);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}

export const cliProjectRoot = projectRoot;
