import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveLocalPath } from './local-path-resolver.js';
import type {
  ChooseLocalPathRequest,
  ChooseLocalPathResponse,
} from './wire-types.js';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const WINDOWS_CHOOSER_OUTPUT_ENCODING_SCRIPT =
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8';
const WINDOWS_DIRECTORY_SCRIPT = [
  WINDOWS_CHOOSER_OUTPUT_ENCODING_SCRIPT,
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = "Select a server-local directory"',
  'if ($env:RASEN_CHOOSER_INITIAL) { $dialog.SelectedPath = $env:RASEN_CHOOSER_INITIAL }',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
  '  [Console]::Out.Write($dialog.SelectedPath)',
  '} else { [Console]::Out.Write("__RASEN_CANCELLED__") }',
].join('; ');
const WINDOWS_FILE_SCRIPT = [
  WINDOWS_CHOOSER_OUTPUT_ENCODING_SCRIPT,
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
  '$dialog.Title = "Select a server-local file"',
  '$dialog.CheckFileExists = $true',
  '$dialog.Multiselect = $false',
  '$dialog.Filter = "Rasen packages (*.rasenpkg)|*.rasenpkg|All files (*.*)|*.*"',
  'if ($env:RASEN_CHOOSER_INITIAL) { $dialog.InitialDirectory = $env:RASEN_CHOOSER_INITIAL }',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
  '  [Console]::Out.Write($dialog.FileName)',
  '} else { [Console]::Out.Write("__RASEN_CANCELLED__") }',
].join('; ');
const MAC_DIRECTORY_SCRIPT =
  'POSIX path of (choose folder with prompt "Select a server-local directory")';
const MAC_FILE_SCRIPT =
  'POSIX path of (choose file with prompt "Select a server-local file")';

type ChooserUnavailableReason = Extract<
  ChooseLocalPathResponse,
  { status: 'unavailable' }
>['reason'];

export type ChooseLocalPathResult =
  | { ok: true; response: ChooseLocalPathResponse }
  | { ok: false; status: number; code: string; message: string };

export interface NativeChooserCommand {
  adapter: 'windows-powershell' | 'macos-osascript' | 'linux-zenity' | 'linux-kdialog';
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface LocalPathChooser {
  choose(body: unknown): Promise<ChooseLocalPathResult>;
  shutdown(): Promise<void>;
}

export interface LocalPathChooserOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  spawnOverride?: typeof spawn;
  executableExistsOverride?: (candidate: string) => boolean;
}

function unavailable(reason: ChooserUnavailableReason): ChooseLocalPathResult {
  return { ok: true, response: { status: 'unavailable', reason } };
}

function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
  exists: (candidate: string) => boolean
): string | null {
  const pathValue = env.PATH ?? env.Path ?? '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Fixed per-platform command table. Only the initial directory is request-derived, through env/argv. */
export function buildNativeChooserCommand(
  request: ChooseLocalPathRequest,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  executableExists: (candidate: string) => boolean
): NativeChooserCommand | ChooserUnavailableReason {
  const childEnv = {
    ...env,
    RASEN_CHOOSER_INITIAL: request.initialDirectory ?? '',
  };
  if (platform === 'win32') {
    const systemRoot = env.SystemRoot ?? env.WINDIR;
    if (!systemRoot) return 'missing-utility';
    const executable = path.win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    if (!executableExists(executable)) return 'missing-utility';
    return {
      adapter: 'windows-powershell',
      executable,
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        request.kind === 'directory' ? WINDOWS_DIRECTORY_SCRIPT : WINDOWS_FILE_SCRIPT,
      ],
      env: childEnv,
    };
  }
  if (platform === 'darwin') {
    const executable = '/usr/bin/osascript';
    if (!executableExists(executable)) return 'missing-utility';
    return {
      adapter: 'macos-osascript',
      executable,
      args: ['-e', request.kind === 'directory' ? MAC_DIRECTORY_SCRIPT : MAC_FILE_SCRIPT],
      env: childEnv,
    };
  }
  if (platform === 'linux') {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return 'headless';
    const zenity = findExecutable('zenity', env, executableExists);
    if (zenity) {
      const args = ['--file-selection'];
      if (request.kind === 'directory') args.push('--directory');
      if (request.kind === 'file' && request.filter === 'rasen-package') {
        args.push('--file-filter=Rasen packages | *.rasenpkg');
      }
      if (request.initialDirectory) {
        args.push(`--filename=${path.join(request.initialDirectory, path.sep)}`);
      }
      return { adapter: 'linux-zenity', executable: zenity, args, env: childEnv };
    }
    const kdialog = findExecutable('kdialog', env, executableExists);
    if (kdialog) {
      return {
        adapter: 'linux-kdialog',
        executable: kdialog,
        args:
          request.kind === 'directory'
            ? ['--getexistingdirectory', request.initialDirectory ?? path.parse(process.cwd()).root]
            : [
                '--getopenfilename',
                request.initialDirectory ?? path.parse(process.cwd()).root,
                request.filter === 'rasen-package'
                  ? '*.rasenpkg|Rasen packages'
                  : '*|All files',
              ],
        env: childEnv,
      };
    }
    return 'missing-utility';
  }
  return 'unsupported';
}

function validateRequest(
  body: unknown
): ChooseLocalPathRequest | { ok: false; status: number; code: string; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'Chooser body must be an object.' };
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set(['kind', 'initialDirectory', 'filter']);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'Chooser body contains an unsupported field.',
    };
  }
  if (record.kind !== 'directory' && record.kind !== 'file') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: "kind must be 'directory' or 'file'.",
    };
  }
  if (record.initialDirectory !== undefined && typeof record.initialDirectory !== 'string') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'initialDirectory must be a string.',
    };
  }
  if (record.filter !== undefined && record.filter !== 'rasen-package') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: "filter must be 'rasen-package'.",
    };
  }
  if (record.kind === 'directory' && record.filter !== undefined) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'filter is supported only for file choice.',
    };
  }
  return {
    kind: record.kind,
    ...(record.initialDirectory === undefined
      ? {}
      : { initialDirectory: record.initialDirectory as string }),
    ...(record.filter === undefined ? {} : { filter: record.filter }),
  };
}

function isCancellation(
  command: NativeChooserCommand,
  code: number | null,
  selected: string,
  stderr: string
): boolean {
  if (command.adapter === 'windows-powershell') {
    return code === 0 && selected === '__RASEN_CANCELLED__';
  }
  if (command.adapter === 'macos-osascript') {
    return code === 1 && /(?:User canceled|\(-128\))/i.test(stderr);
  }
  // Zenity and KDialog document status 1 for user cancellation. A diagnostic
  // on stderr is evidence that the utility/display failed to initialize.
  return code === 1 && stderr.trim().length === 0;
}

export function createLocalPathChooser(
  options: LocalPathChooserOptions = {}
): LocalPathChooser {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spawnProcess = options.spawnOverride ?? spawn;
  const executableExists =
    options.executableExistsOverride ??
    ((candidate: string) => {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  let activeChild: ChildProcessWithoutNullStreams | null = null;
  let busy = false;
  let shuttingDown = false;

  async function choose(body: unknown): Promise<ChooseLocalPathResult> {
    const parsed = validateRequest(body);
    if ('ok' in parsed) return parsed;
    if (shuttingDown) return unavailable('launch-failed');
    if (busy) {
      return {
        ok: false,
        status: 409,
        code: 'chooser_busy',
        message: 'Another native path chooser is already open.',
      };
    }
    // Reserve the singleton slot before resolving the optional initial path;
    // otherwise two requests can both cross that await and launch dialogs.
    busy = true;

    let request = parsed;
    if (request.initialDirectory !== undefined) {
      const initial = await resolveLocalPath(request.initialDirectory, 'directory');
      if (!initial.ok) {
        busy = false;
        return initial;
      }
      request = { ...request, initialDirectory: initial.response.path };
    }
    if (shuttingDown) {
      busy = false;
      return unavailable('launch-failed');
    }
    const command = buildNativeChooserCommand(request, platform, env, executableExists);
    if (typeof command === 'string') {
      busy = false;
      return unavailable(command);
    }

    return new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnProcess(command.executable, command.args, {
          env: command.env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stdin.end();
      } catch {
        busy = false;
        resolve(unavailable('launch-failed'));
        return;
      }
      activeChild = child;
      let stdout = '';
      let stderr = '';
      let settled = false;
      let killTimer: NodeJS.Timeout | null = null;
      const finish = (result: ChooseLocalPathResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          if (activeChild === child) child.kill('SIGKILL');
        }, 1_000);
        killTimer.unref?.();
        finish(unavailable('timeout'));
      }, timeoutMs);
      timer.unref?.();
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      child.on('error', () => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (activeChild === child) activeChild = null;
        busy = false;
        finish(unavailable('launch-failed'));
      });
      child.on('close', async (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (activeChild === child) activeChild = null;
        if (settled) {
          busy = false;
          return;
        }
        const selected = stdout.trim();
        if (isCancellation(command, code, selected, stderr)) {
          busy = false;
          finish({ ok: true, response: { status: 'cancelled' } });
          return;
        }
        if (code !== 0 || selected === '') {
          busy = false;
          finish(unavailable('launch-failed'));
          return;
        }
        const resolved = await resolveLocalPath(selected, request.kind);
        busy = false;
        if (!resolved.ok) {
          finish(resolved);
        } else {
          finish({
            ok: true,
            response: {
              status: 'selected',
              ...resolved.response,
            },
          });
        }
      });
    });
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    const child = activeChild;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 1_000);
      timer.unref?.();
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  return { choose, shutdown };
}
