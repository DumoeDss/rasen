import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const runtimeScript = path.join(
  repositoryRoot,
  'scripts',
  'local-version',
  'local-runtime.mjs',
);
const codexLauncher = path.join(
  repositoryRoot,
  'scripts',
  'local-version',
  'start-codex-local.ps1',
);
const claudeLauncher = path.join(
  repositoryRoot,
  'scripts',
  'local-version',
  'start-claude-local.ps1',
);
const rasenLauncher = path.join(
  repositoryRoot,
  'scripts',
  'local-version',
  'rasen-local.ps1',
);
const temporaryRoots: string[] = [];

function makeTemporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-local-version-'));
  temporaryRoots.push(root);
  return root;
}

function isWithinExistingPath(parent: string, candidate: string): boolean {
  const normalize = (value: string) => {
    const realPath = fs.realpathSync.native(value);
    return process.platform === 'win32' ? realPath.toLowerCase() : realPath;
  };
  const relative = path.relative(normalize(parent), normalize(candidate));
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createPackableSource(sourceRoot: string, version = '0.2.0-fixture.1'): void {
  writeJson(path.join(sourceRoot, 'package.json'), {
    name: '@atelierai/rasen',
    version,
    type: 'module',
    bin: { rasen: './bin/rasen.js' },
    files: ['bin', 'dist'],
  });
  fs.mkdirSync(path.join(sourceRoot, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'bin', 'rasen.js'),
    [
      '#!/usr/bin/env node',
      `if (process.argv.includes('--version')) console.log('${version}');`,
      "if (process.argv.includes('--fail-fixture')) process.exit(17);",
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(sourceRoot, 'dist', 'core', 'config-api'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'dist', 'core', 'config-api', 'ui-package.js'),
    [
      "import path from 'node:path';",
      "import { createRequire } from 'node:module';",
      'const require = createRequire(import.meta.url);',
      'export function resolveUiPackageDir() {',
      "  const manifest = require.resolve('@atelierai/rasen-ui/package.json');",
      "  return path.join(path.dirname(manifest), 'dist');",
      '}',
      '',
    ].join('\n'),
  );

  const uiRoot = path.join(sourceRoot, 'packages', 'ui');
  writeJson(path.join(uiRoot, 'package.json'), {
    name: '@atelierai/rasen-ui',
    version,
    files: ['dist'],
  });
  fs.mkdirSync(path.join(uiRoot, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(uiRoot, 'dist', 'index.html'), '<main>fixture UI</main>\n');
}

function runPrepare(
  sourceRoot: string,
  projectRoot: string,
  cacheRoot: string,
  scriptPath = runtimeScript,
) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      'prepare',
      '--source',
      sourceRoot,
      '--project',
      projectRoot,
      '--json',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        RASEN_LOCAL_HARNESS_ROOT: cacheRoot,
      },
    },
  );
}

function runPrepareAsync(sourceRoot: string, projectRoot: string, cacheRoot: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        runtimeScript,
        'prepare',
        '--source',
        sourceRoot,
        '--project',
        projectRoot,
        '--json',
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, RASEN_LOCAL_HARNESS_ROOT: cacheRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('local version prepare command', () => {
  test('rejects a mismatched CLI/UI version before materializing a runtime', () => {
    const root = makeTemporaryRoot();
    const sourceRoot = path.join(root, 'source with spaces');
    const projectRoot = path.join(root, 'empty project');
    const cacheRoot = path.join(root, 'cache');
    fs.mkdirSync(projectRoot, { recursive: true });
    writeJson(path.join(sourceRoot, 'package.json'), {
      name: '@atelierai/rasen',
      version: '0.2.0-test.1',
    });
    writeJson(path.join(sourceRoot, 'packages', 'ui', 'package.json'), {
      name: '@atelierai/rasen-ui',
      version: '0.2.0-test.2',
    });

    const result = runPrepare(sourceRoot, projectRoot, cacheRoot);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    const diagnostic = JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1)!);
    expect(diagnostic).toMatchObject({
      error: {
        code: 'VERSION_MISMATCH',
        phase: 'resolve',
      },
    });
    expect(fs.existsSync(cacheRoot)).toBe(false);
  });

  test('runs prepare when the runtime entrypoint is reached through a directory alias', () => {
    const root = makeTemporaryRoot();
    const sourceRoot = path.join(root, 'mismatched source');
    const projectRoot = path.join(root, 'empty project');
    const cacheRoot = path.join(root, 'cache');
    const scriptAlias = path.join(root, 'runtime script alias');
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.symlinkSync(
      path.dirname(runtimeScript),
      scriptAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    writeJson(path.join(sourceRoot, 'package.json'), {
      name: '@atelierai/rasen',
      version: '0.2.0-test.1',
    });
    writeJson(path.join(sourceRoot, 'packages', 'ui', 'package.json'), {
      name: '@atelierai/rasen-ui',
      version: '0.2.0-test.2',
    });

    const result = runPrepare(
      sourceRoot,
      projectRoot,
      cacheRoot,
      path.join(scriptAlias, 'local-runtime.mjs'),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1)!)).toMatchObject({
      error: { code: 'VERSION_MISMATCH', phase: 'resolve' },
    });
  });

  test('reports a failed source build with stable command diagnostics', () => {
    const root = makeTemporaryRoot();
    const sourceRoot = path.join(root, 'failing source');
    const projectRoot = path.join(root, 'empty project');
    const cacheRoot = path.join(root, 'cache');
    createPackableSource(sourceRoot);
    const manifestPath = path.join(sourceRoot, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    writeJson(manifestPath, {
      ...manifest,
      scripts: { build: 'node -e "process.exit(7)"' },
    });
    fs.mkdirSync(projectRoot, { recursive: true });

    const result = runPrepare(sourceRoot, projectRoot, cacheRoot);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    const diagnostic = JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1)!);
    expect(diagnostic).toMatchObject({
      error: {
        code: 'COMMAND_FAILED',
        phase: 'build',
        exitCode: 7,
      },
    });
    expect(fs.existsSync(path.join(cacheRoot, 'runtimes'))).toBe(false);
  }, 30_000);

  test('materializes a paired runtime without mutating the target and reuses it warm', () => {
    const root = makeTemporaryRoot();
    const sourceRoot = path.join(root, 'source with spaces');
    const projectRoot = path.join(root, 'non node project with spaces');
    const cacheRoot = path.join(root, 'cache with spaces');
    createPackableSource(sourceRoot);
    fs.mkdirSync(path.join(projectRoot, 'node_modules'), { recursive: true });
    const protectedFiles = new Map([
      [path.join(projectRoot, 'package.json'), '{"private":true}\n'],
      [path.join(projectRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n'],
      [path.join(projectRoot, 'node_modules', 'sentinel.txt'), 'keep me\n'],
    ]);
    for (const [filePath, contents] of protectedFiles) {
      fs.writeFileSync(filePath, contents);
    }

    const copiedRuntime = path.join(sourceRoot, 'scripts', 'local-version', 'local-runtime.mjs');
    fs.mkdirSync(path.dirname(copiedRuntime), { recursive: true });
    fs.copyFileSync(runtimeScript, copiedRuntime);

    const cold = spawnSync(process.execPath, [copiedRuntime, 'prepare', '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, RASEN_LOCAL_HARNESS_ROOT: cacheRoot },
    });

    expect(cold.status, cold.stderr).toBe(0);
    const coldResult = JSON.parse(cold.stdout);
    expect(coldResult).toMatchObject({
      schemaVersion: 1,
      version: '0.2.0-fixture.1',
      cache: 'built',
      sourceRoot: fs.realpathSync.native(sourceRoot),
      projectRoot: fs.realpathSync.native(projectRoot),
    });
    expect(fs.existsSync(coldResult.rasenExecutable)).toBe(true);
    expect(fs.existsSync(coldResult.uiAssetsDir)).toBe(true);
    expect(coldResult.rasenHome.startsWith(cacheRoot)).toBe(true);
    expect(coldResult.daemonPort).toBeGreaterThanOrEqual(20000);
    expect(coldResult.daemonPort).toBeLessThanOrEqual(59999);
    for (const [filePath, contents] of protectedFiles) {
      expect(fs.readFileSync(filePath, 'utf8')).toBe(contents);
    }

    const warm = runPrepare(sourceRoot, projectRoot, cacheRoot);

    expect(warm.status, warm.stderr).toBe(0);
    expect(JSON.parse(warm.stdout)).toMatchObject({
      cache: 'hit',
      fingerprint: coldResult.fingerprint,
      runtimeRoot: coldResult.runtimeRoot,
      rasenHome: coldResult.rasenHome,
      daemonPort: coldResult.daemonPort,
    });

    const sourceAlias = path.join(root, 'source junction');
    const projectAlias = path.join(root, 'project junction');
    fs.symlinkSync(sourceRoot, sourceAlias, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(projectRoot, projectAlias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliased = runPrepare(sourceAlias, projectAlias, cacheRoot);
    expect(aliased.status, aliased.stderr).toBe(0);
    expect(JSON.parse(aliased.stdout)).toMatchObject({
      cache: 'hit',
      sourceRoot: fs.realpathSync.native(sourceRoot),
      projectRoot: fs.realpathSync.native(projectRoot),
      runtimeRoot: coldResult.runtimeRoot,
      rasenHome: coldResult.rasenHome,
    });

    const otherProject = path.join(root, 'second empty project');
    fs.mkdirSync(otherProject);
    const other = runPrepare(sourceRoot, otherProject, cacheRoot);
    expect(other.status, other.stderr).toBe(0);
    const otherResult = JSON.parse(other.stdout);
    expect(otherResult.runtimeRoot).toBe(coldResult.runtimeRoot);
    expect(otherResult.rasenHome).not.toBe(coldResult.rasenHome);
    expect(fs.readdirSync(otherProject)).toEqual([]);

    fs.appendFileSync(path.join(sourceRoot, 'bin', 'rasen.js'), '// dirty source edit\n');
    const rebuilt = runPrepare(sourceRoot, projectRoot, cacheRoot);
    expect(rebuilt.status, rebuilt.stderr).toBe(0);
    const rebuiltResult = JSON.parse(rebuilt.stdout);
    expect(rebuiltResult.cache).toBe('built');
    expect(rebuiltResult.fingerprint).not.toBe(coldResult.fingerprint);
    expect(rebuiltResult.runtimeRoot).not.toBe(coldResult.runtimeRoot);

    fs.rmSync(path.join(rebuiltResult.uiAssetsDir, 'index.html'));
    const repaired = runPrepare(sourceRoot, projectRoot, cacheRoot);
    expect(repaired.status, repaired.stderr).toBe(0);
    expect(JSON.parse(repaired.stdout)).toMatchObject({
      cache: 'built',
      fingerprint: rebuiltResult.fingerprint,
      runtimeRoot: rebuiltResult.runtimeRoot,
    });
    expect(fs.existsSync(path.join(rebuiltResult.uiAssetsDir, 'index.html'))).toBe(true);
  }, 30_000);

  test('converges concurrent cold callers on one published runtime', async () => {
    const root = makeTemporaryRoot();
    const sourceRoot = path.join(root, 'concurrent source');
    const projectRoot = path.join(root, 'concurrent project');
    const cacheRoot = path.join(root, 'concurrent cache');
    createPackableSource(sourceRoot);
    fs.mkdirSync(projectRoot, { recursive: true });

    const results = await Promise.all([
      runPrepareAsync(sourceRoot, projectRoot, cacheRoot),
      runPrepareAsync(sourceRoot, projectRoot, cacheRoot),
    ]);

    for (const result of results) expect(result.status, result.stderr).toBe(0);
    const prepared = results.map((result) => JSON.parse(result.stdout));
    expect(prepared.map((result) => result.cache).sort()).toEqual(['built', 'hit']);
    expect(new Set(prepared.map((result) => result.runtimeRoot)).size).toBe(1);
    expect(new Set(prepared.map((result) => result.fingerprint)).size).toBe(1);
  }, 30_000);

  test.runIf(process.platform === 'win32')(
    'forwards Rasen arguments, stdio, and exit codes through the PowerShell launcher',
    () => {
      const root = makeTemporaryRoot();
      const sourceRoot = path.join(root, 'source with spaces');
      const projectRoot = path.join(root, 'project with spaces');
      const cacheRoot = path.join(root, 'cache with spaces');
      createPackableSource(sourceRoot);
      fs.mkdirSync(projectRoot, { recursive: true });
      const baseArguments = [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        rasenLauncher,
        '-Source',
        sourceRoot,
        '-Project',
        projectRoot,
      ];
      const options = {
        cwd: root,
        encoding: 'utf8' as const,
        env: { ...process.env, RASEN_LOCAL_HARNESS_ROOT: cacheRoot },
      };

      const version = spawnSync('powershell.exe', [...baseArguments, '--version'], options);
      expect(version.status, version.stderr).toBe(0);
      expect(version.stdout.trim()).toBe('0.2.0-fixture.1');

      const failure = spawnSync('powershell.exe', [...baseArguments, '--fail-fixture'], options);
      expect(failure.status).toBe(17);
    },
    30_000,
  );

  test.runIf(process.platform === 'win32')(
    'launches profile-defined Codex and Claude with local bare rasen and restores parent scope',
    () => {
      const root = makeTemporaryRoot();
      const sourceRoot = path.join(root, 'source with spaces');
      const projectRoot = path.join(root, 'empty project with spaces');
      const cacheRoot = path.join(root, 'cache with spaces');
      const hostScript = path.join(root, 'launcher host.ps1');
      const outputPath = path.join(root, 'launcher result.json');
      createPackableSource(sourceRoot);
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(
        hostScript,
        [
          'param($Launcher, $Source, $Project, $Output)',
          "$env:RASEN_HOME = 'parent-home'",
          "$env:RASEN_DAEMON_PORT = '12345'",
          "$env:RASEN_TELEMETRY = 'parent-telemetry'",
          '$originalPath = $env:Path',
          '$originalLocation = (Get-Location).Path',
          'function global:codex {',
          '  $command = Get-Command rasen -ErrorAction Stop',
          '  $version = (& rasen --version | Select-Object -Last 1)',
          '  $script:child = @{',
          '    Arguments = @($args)',
          '    Command = $command.Source',
          '    Version = $version',
          '    Home = $env:RASEN_HOME',
          '    Port = $env:RASEN_DAEMON_PORT',
          '    Telemetry = $env:RASEN_TELEMETRY',
          '    WorkingDirectory = (Get-Location).Path',
          '  }',
          '  $global:LASTEXITCODE = 23',
          '}',
          'function global:claude { codex @args }',
          ". $Launcher -Source $Source -Project $Project 'alpha' '--flag=value'",
          '$result = @{',
          '  Child = $script:child',
          '  ExitCode = $LASTEXITCODE',
          '  PathRestored = $env:Path -ceq $originalPath',
          "  Home = $env:RASEN_HOME",
          "  Port = $env:RASEN_DAEMON_PORT",
          "  Telemetry = $env:RASEN_TELEMETRY",
          '  LocationRestored = (Get-Location).Path -ceq $originalLocation',
          '}',
          '[IO.File]::WriteAllText($Output, ($result | ConvertTo-Json -Depth 5))',
          '',
        ].join('\n'),
      );

      for (const launcher of [codexLauncher, claudeLauncher]) {
        const launched = spawnSync(
          'powershell.exe',
          [
            '-NoLogo',
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            hostScript,
            '-Launcher',
            launcher,
            '-Source',
            sourceRoot,
            '-Project',
            projectRoot,
            '-Output',
            outputPath,
          ],
          {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, RASEN_LOCAL_HARNESS_ROOT: cacheRoot },
          },
        );

        expect(launched.status, launched.stderr).toBe(0);
        const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        expect(result).toMatchObject({
          ExitCode: 23,
          PathRestored: true,
          Home: 'parent-home',
          Port: '12345',
          Telemetry: 'parent-telemetry',
          LocationRestored: true,
          Child: {
            Arguments: ['alpha', '--flag=value'],
            Version: '0.2.0-fixture.1',
            Telemetry: '0',
            WorkingDirectory: fs.realpathSync.native(projectRoot),
          },
        });
        expect(isWithinExistingPath(cacheRoot, result.Child.Home)).toBe(true);
        expect(Number(result.Child.Port)).toBeGreaterThanOrEqual(20_000);
        expect(isWithinExistingPath(cacheRoot, result.Child.Command)).toBe(true);
      }
      expect(fs.readdirSync(projectRoot)).toEqual([]);
    },
    30_000,
  );
});
