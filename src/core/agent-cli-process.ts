/**
 * Shell-free, cross-platform agent CLI process primitives.
 *
 * Windows npm `.cmd` shims require `cmd.exe`, including a second layer of
 * metacharacter escaping because the shim re-expands `%*`. Native executables
 * and POSIX binaries are always spawned directly. Callers may provide a
 * bounded stdin payload; it is written once and followed by EOF.
 */
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
} from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

export const DEFAULT_AGENT_STDIN_LIMIT_BYTES = 2 * 1024 * 1024;
const WINDOWS_SHIM_NEWLINE = /[\r\n]/;

interface CmdEscape {
  command(arg: string): string;
  argument(arg: string, doubleEscapeMetaChars?: boolean): string;
}

let cachedCmdEscape: CmdEscape | undefined;
function cmdEscape(): CmdEscape {
  if (cachedCmdEscape === undefined) {
    const require = createRequire(import.meta.url);
    cachedCmdEscape = require('cross-spawn/lib/util/escape') as CmdEscape;
  }
  return cachedCmdEscape;
}

export interface AgentCliResolutionOptions {
  envVar?: string;
  binaryName?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function candidateNames(binaryName: string, platform: NodeJS.Platform): string[] {
  return platform === 'win32'
    ? [`${binaryName}.exe`, `${binaryName}.cmd`, binaryName]
    : [binaryName];
}

export function resolveAgentCliBinary(
  options: AgentCliResolutionOptions = {}
): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const envVar = options.envVar ?? 'RASEN_CLAUDE_BIN';
  const binaryName = options.binaryName ?? 'claude';
  const override = env[envVar]?.trim();
  if (override) return override;

  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of candidateNames(binaryName, platform)) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Keep scanning.
      }
    }
  }
  return null;
}

export function createAgentCliResolver(
  options: AgentCliResolutionOptions = {}
): () => Promise<string | null> {
  let cached: string | null | undefined;
  return async () => {
    if (cached !== undefined) return cached;
    cached = resolveAgentCliBinary(options);
    return cached;
  };
}

export interface PreparedAgentCliSpawn {
  command: string;
  args: string[];
  windowsOptions: {
    shell: false;
    windowsHide: true;
    windowsVerbatimArguments?: true;
  };
}

export function prepareAgentCliSpawn(
  binary: string,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): PreparedAgentCliSpawn {
  if (platform === 'win32' && ['.cmd', '.bat'].includes(path.extname(binary).toLowerCase())) {
    if (argv.some((arg) => WINDOWS_SHIM_NEWLINE.test(arg))) {
      throw new Error(
        'Multi-line argument text is not supported when the agent CLI is a Windows .cmd/.bat shim; transport multi-line content through stdin.'
      );
    }
    const escape = cmdEscape();
    const escapedBinary = escape.command(path.normalize(binary));
    const escapedArgs = argv.map((arg) => escape.argument(arg, true));
    const commandLine = [escapedBinary, ...escapedArgs].join(' ');
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      windowsOptions: {
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    };
  }
  return {
    command: binary,
    args: [...argv],
    windowsOptions: { shell: false, windowsHide: true },
  };
}

export interface SpawnAgentCliOptions extends SpawnOptions {
  stdinPayload?: string | Buffer;
  maxStdinBytes?: number;
  platform?: NodeJS.Platform;
}

function validateStdinPayload(
  payload: string | Buffer | undefined,
  maxBytes: number
): void {
  if (payload === undefined) return;
  const bytes = Buffer.isBuffer(payload) ? payload.byteLength : Buffer.byteLength(payload, 'utf8');
  if (bytes > maxBytes) {
    throw new Error(`Agent CLI stdin payload is ${bytes} bytes; limit is ${maxBytes} bytes.`);
  }
}

export function spawnAgentCli(
  binary: string,
  argv: readonly string[],
  options: SpawnAgentCliOptions = {}
): ChildProcess {
  const {
    stdinPayload,
    maxStdinBytes = DEFAULT_AGENT_STDIN_LIMIT_BYTES,
    platform = process.platform,
    ...spawnOptions
  } = options;
  validateStdinPayload(stdinPayload, maxStdinBytes);
  const prepared = prepareAgentCliSpawn(binary, argv, platform, spawnOptions.env ?? process.env);
  const child = spawn(prepared.command, prepared.args, {
    ...spawnOptions,
    ...prepared.windowsOptions,
    windowsHide: true,
  });
  if (stdinPayload !== undefined) {
    if (!child.stdin) {
      child.kill();
      throw new Error('Agent CLI stdin is not writable; spawn with stdin set to pipe.');
    }
    child.stdin.end(stdinPayload);
  }
  return child;
}

export interface SpawnAgentCliSyncOptions extends SpawnSyncOptions {
  platform?: NodeJS.Platform;
}

export function spawnAgentCliSync(
  binary: string,
  argv: readonly string[],
  options: SpawnAgentCliSyncOptions = {}
) {
  const { platform = process.platform, ...spawnOptions } = options;
  const prepared = prepareAgentCliSpawn(binary, argv, platform, spawnOptions.env ?? process.env);
  return spawnSync(prepared.command, prepared.args, {
    ...spawnOptions,
    ...prepared.windowsOptions,
    windowsHide: true,
  });
}
