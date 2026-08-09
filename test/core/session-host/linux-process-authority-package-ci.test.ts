import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const roots: string[] = [];
const SCRIPT = path.resolve('scripts/build-linux-process-authority.mjs');
const WORKFLOW = path.resolve('.github/workflows/linux-process-authority.yml');
const CRATE = path.resolve('native/linux-process-authority');

function posix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function sourceFiles(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(posix(relative));
    }
  }
  return files;
}

function sourceDigest(): string {
  const files = [
    'Cargo.lock',
    'Cargo.toml',
    'THIRD_PARTY.md',
    ...sourceFiles(path.join(CRATE, 'src'), 'src'),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(CRATE, ...file.split('/'))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

type FixtureArch = 'x64' | 'arm64';

function targetFor(arch: FixtureArch): string {
  return arch === 'x64'
    ? 'x86_64-unknown-linux-gnu'
    : 'aarch64-unknown-linux-gnu';
}

function elfFixture(arch: FixtureArch, marker: string): Buffer {
  const bytes = Buffer.alloc(64 + Buffer.byteLength(marker));
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(arch === 'x64' ? 62 : 183, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.write(marker, 64, 'utf8');
  return bytes;
}

function releaseBuild(
  arch: FixtureArch,
  helper: Buffer,
  brokerClient: Buffer
): Record<string, unknown> {
  return {
    platform: 'linux',
    arch,
    target: targetFor(arch),
    directory: `linux-${arch}`,
    evidenceClassification: 'native-build-non-runtime',
    sourceSha256: sourceDigest(),
    executableMode: '0755',
    compiler: 'rustc 1.88.0 (6b00bc388 2025-06-23)',
    cargo: 'cargo 1.88.0 (873a06493 2025-05-10)',
    rustcExecutableSha256: 'a'.repeat(64),
    cargoExecutableSha256: 'b'.repeat(64),
    cargoConfigSha256: 'c'.repeat(64),
    environmentSha256: 'd'.repeat(64),
    linker: {
      executableSha256: 'e'.repeat(64),
      version: 'fixture-linker 1',
    },
    artifacts: [
      {
        file: 'rasen-linux-process-authority-helper',
        length: helper.byteLength,
        sha256: createHash('sha256').update(helper).digest('hex'),
        elfClass: 64,
        elfData: 'little-endian',
        elfMachine: arch === 'x64' ? 62 : 183,
      },
      {
        file: 'rasen-linux-process-authority-broker-client',
        length: brokerClient.byteLength,
        sha256: createHash('sha256').update(brokerClient).digest('hex'),
        elfClass: 64,
        elfData: 'little-endian',
        elfMachine: arch === 'x64' ? 62 : 183,
      },
    ],
  };
}

function fixture(architectures: readonly FixtureArch[] = ['x64']): {
  root: string;
  staging: string;
  output: string;
  exported: string;
  releaseInput: string;
  helper: Buffer;
  brokerClient: Buffer;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-package-ci-'));
  roots.push(root);
  const staging = path.join(root, 'staging');
  const output = path.join(root, 'output');
  const exported = path.join(root, 'export');
  const releaseInput = path.join(root, 'trusted-release-input.json');
  const builds: Record<string, unknown>[] = [];
  let primaryHelper = Buffer.alloc(0);
  let primaryBrokerClient = Buffer.alloc(0);
  for (const arch of architectures) {
    const directory = path.join(staging, `linux-${arch}`);
    fs.mkdirSync(directory, { recursive: true });
    const helper = elfFixture(arch, `${arch} source-owned Linux authority fixture`);
    const brokerClient = elfFixture(arch, `${arch} source-owned Linux broker client fixture`);
    if (arch === architectures[0]) {
      primaryHelper = helper;
      primaryBrokerClient = brokerClient;
    }
    fs.writeFileSync(
      path.join(directory, 'rasen-linux-process-authority-helper'),
      helper,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      path.join(directory, 'rasen-linux-process-authority-broker-client'),
      brokerClient,
      { mode: 0o755 }
    );
    const build = releaseBuild(arch, helper, brokerClient);
    builds.push(build);
    fs.writeFileSync(path.join(directory, 'provenance.json'), canonical({
      schema: 'rasen-linux-process-authority-build-provenance/2',
      releaseInputSha256: 'filled-after-release-input-is-written',
      build,
    }));
  }
  fs.writeFileSync(releaseInput, canonical({
    schema: 'rasen-linux-process-authority-release-input/1',
    builds,
  }));
  const releaseInputSha256 = createHash('sha256')
    .update(fs.readFileSync(releaseInput))
    .digest('hex');
  for (const build of builds) {
    const directory = path.join(staging, String(build.directory));
    fs.writeFileSync(path.join(directory, 'provenance.json'), canonical({
      schema: 'rasen-linux-process-authority-build-provenance/2',
      releaseInputSha256,
      build,
    }));
  }
  return {
    root,
    staging,
    output,
    exported,
    releaseInput,
    helper: primaryHelper,
    brokerClient: primaryBrokerClient,
  };
}

function assemble(
  item: ReturnType<typeof fixture>,
  releaseInputSha256 = createHash('sha256').update(fs.readFileSync(item.releaseInput)).digest('hex')
): string {
  return execFileSync(process.execPath, [SCRIPT, '--assemble-staged-only'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      RASEN_LINUX_PROCESS_AUTHORITY_BUILD_ROOT: item.output,
      RASEN_LINUX_PROCESS_AUTHORITY_STAGING_DIR: item.staging,
      RASEN_LINUX_PROCESS_AUTHORITY_EXPORT_DIR: item.exported,
      RASEN_LINUX_PROCESS_AUTHORITY_RELEASE_INPUT: item.releaseInput,
      RASEN_LINUX_PROCESS_AUTHORITY_RELEASE_INPUT_SHA256: releaseInputSha256,
    },
  });
}

function rewriteReleaseInput(
  item: ReturnType<typeof fixture>,
  mutate: (release: { builds: Array<Record<string, unknown>> }) => void
): void {
  const release = JSON.parse(fs.readFileSync(item.releaseInput, 'utf8')) as {
    builds: Array<Record<string, unknown>>;
  };
  mutate(release);
  fs.writeFileSync(item.releaseInput, canonical(release));
  const releaseInputSha256 = createHash('sha256')
    .update(fs.readFileSync(item.releaseInput))
    .digest('hex');
  for (const build of release.builds) {
    fs.writeFileSync(
      path.join(item.staging, String(build.directory), 'provenance.json'),
      canonical({
        schema: 'rasen-linux-process-authority-build-provenance/2',
        releaseInputSha256,
        build,
      })
    );
  }
}

function npmPacklist(packageRoot: string): string[] {
  const installedNpmCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npm-cli.js'
  );
  const command = fs.existsSync(installedNpmCli) ? process.execPath : 'npm';
  const prefix = fs.existsSync(installedNpmCli) ? [installedNpmCli] : [];
  const receipt = JSON.parse(execFileSync(command, [...prefix,
    'pack',
    '--dry-run',
    '--json',
    '--ignore-scripts',
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_ignore_scripts: 'true',
    },
  })) as Array<{ files: Array<{ path: string }> }>;
  return receipt[0]?.files.map((entry) => entry.path) ?? [];
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

describe('Linux process-authority package and CI boundary', () => {
  it('gives Nix a dereferenced pinned Rust sysroot without inherited stdenv selectors', () => {
    const flake = fs.readFileSync('flake.nix', 'utf8');
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(flake).toContain('rust-overlay.overlays.default');
    expect(flake).toContain('pkgs.rustPlatform.importCargoLock');
    expect(flake).toMatch(/lockFile = \.\/native\/linux-process-authority\/Cargo\.lock;/);
    expect(flake).toContain('rustToolchainSource = pkgs.rust-bin.stable."1.88.0".minimal');
    expect(flake).toMatch(/pkgs\.runCommand "rust-toolchain-1\.88\.0-exact"/);
    expect(flake).toMatch(/cp -RL "\$\{rustToolchainSource\}\/\." "\$out\/"/);
    expect(flake).toMatch(/chmod u\+w "\$out\/bin" "\$out\/bin\/cargo" "\$out\/bin\/rustc"/);
    expect(flake).toMatch(/wrapProgram "\$out\/bin\/cargo"[\s\S]*?--add-flags '--offline'/);
    expect(flake).toContain('source.crates-io.replace-with=\\"vendored-sources\\"');
    expect(flake).toContain('source.vendored-sources.directory=\\"${cargoVendor}\\"');
    expect(flake).toMatch(/wrapProgram "\$out\/bin\/rustc" --add-flags "--sysroot \$out"/);
    expect(flake).toMatch(/nativeBuildInputs = with pkgs; \[[\s\S]*?\brustToolchain\b[\s\S]*?\];/);
    expect(flake).toMatch(/nativeBuildInputs = with pkgs; \[[\s\S]*?\bwhich\b[\s\S]*?\];/);
    expect(flake).toMatch(/unset AR CC CXX LD\s+pnpm run build/s);
    expect(script).toMatch(/build-affecting environment override is forbidden/);
    expect(script).toMatch(/!stat\.isFile\(\) \|\| stat\.isSymbolicLink\(\)/);
  });

  // Parked-provider subject (locked decision 13): the win32 refusal is the one live claim on this host.
  it.runIf(process.platform === 'win32')('refuses authoritative assembly on win32', () => {
    const item = fixture();
    expect(() => assemble(item)).toThrow(/POSIX|0755|authoritative assembly/i);
  });

  // Parked-provider subject (locked decision 13): assembly machinery is upgrade-path; skipped, not passed, on win32.
  it.skipIf(process.platform === 'win32')('assembles locked staged input into deterministic adjacent package authority', () => {
    const item = fixture();
    const firstLog = assemble(item);
    const nativeRoot = path.join(item.output, 'dist', 'native');
    const helperPath = path.join(
      nativeRoot,
      'linux-x64',
      'rasen-linux-process-authority-helper'
    );
    const manifestPath = `${helperPath}.manifest.json`;
    const brokerClientPath = path.join(
      nativeRoot,
      'linux-x64',
      'rasen-linux-process-authority-broker-client'
    );
    const brokerClientManifestPath = `${brokerClientPath}.manifest.json`;
    const providersPath = path.join(
      nativeRoot,
      'linux-process-authority',
      'providers-linux-x64.json'
    );
    const buildAuthorityPath = path.join(
      item.output,
      'dist',
      'core',
      'session-host',
      'process-authority',
      'linux',
      'build-authority.js'
    );
    const expectedHash = createHash('sha256').update(item.helper).digest('hex');
    const expectedBrokerClientHash = createHash('sha256')
      .update(item.brokerClient)
      .digest('hex');

    expect(firstLog).toContain('package-integrity-non-runtime');
    expect(fs.readFileSync(helperPath)).toEqual(item.helper);
    expect(fs.readFileSync(brokerClientPath)).toEqual(item.brokerClient);
    expect(fs.statSync(helperPath).mode & 0o777).toBe(0o755);
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))).toEqual({
      schema: 'rasen-linux-process-authority-artifact/1',
      platform: 'linux',
      arch: 'x64',
      mode: 'user-pidns',
      providerId: 'rasen.linux.user-pidns',
      capabilityId: 'rasen-recursive-process-scope/1',
      protocolVersion: 1,
      providerReferenceVersion: 1,
      artifactFile: 'rasen-linux-process-authority-helper',
      executableMode: '0755',
      length: item.helper.byteLength,
      sha256: expectedHash,
      sourceSha256: sourceDigest(),
      compiler: 'rustc 1.88.0 (6b00bc388 2025-06-23)',
    });
    expect(JSON.parse(fs.readFileSync(brokerClientManifestPath, 'utf8'))).toEqual({
      schema: 'rasen-linux-process-authority-artifact/1',
      platform: 'linux',
      arch: 'x64',
      mode: 'broker-pidns-cgroupv2',
      providerId: 'rasen.linux.broker-pidns-cgroupv2',
      capabilityId: 'rasen-recursive-process-scope/1',
      protocolVersion: 1,
      providerReferenceVersion: 1,
      artifactFile: 'rasen-linux-process-authority-broker-client',
      executableMode: '0755',
      length: item.brokerClient.byteLength,
      sha256: expectedBrokerClientHash,
      sourceSha256: sourceDigest(),
      compiler: 'rustc 1.88.0 (6b00bc388 2025-06-23)',
    });
    expect(JSON.parse(fs.readFileSync(providersPath, 'utf8'))).toEqual({
      schema: 'rasen-process-authority-providers/1',
      providers: [
        {
          providerId: 'rasen.linux.user-pidns',
          capabilityId: 'rasen-recursive-process-scope/1',
          protocolVersion: 1,
          commonContractVersion: 1,
          providerReferenceVersion: 1,
          semantics: [
            'forked-descendant-non-escape',
            'root-exit-distinct',
            'natural-exact-empty',
            'recursive-terminate',
            'recursive-abort',
            'bounded-controls',
            'identity-drift-detection',
            'event-completeness',
          ],
          artifactPath: 'dist/native/linux-x64/rasen-linux-process-authority-helper',
        },
        {
          providerId: 'rasen.linux.broker-pidns-cgroupv2',
          capabilityId: 'rasen-recursive-process-scope/1',
          protocolVersion: 1,
          commonContractVersion: 1,
          providerReferenceVersion: 1,
          semantics: [
            'forked-descendant-non-escape',
            'root-exit-distinct',
            'natural-exact-empty',
            'recursive-terminate',
            'recursive-abort',
            'bounded-controls',
            'identity-drift-detection',
            'event-completeness',
          ],
          artifactPath: 'dist/native/linux-x64/rasen-linux-process-authority-broker-client',
        },
      ],
    });
    expect(fs.readFileSync(buildAuthorityPath, 'utf8')).toContain(expectedHash);
    expect(fs.readFileSync(buildAuthorityPath, 'utf8')).toContain(
      'rasen.linux.broker-pidns-cgroupv2'
    );
    expect(fs.readFileSync(buildAuthorityPath, 'utf8')).toContain(expectedBrokerClientHash);

    const first = new Map<string, Buffer>();
    for (const file of [
      helperPath,
      manifestPath,
      brokerClientPath,
      brokerClientManifestPath,
      providersPath,
      buildAuthorityPath,
    ]) {
      first.set(file, fs.readFileSync(file));
    }
    assemble(item);
    for (const [file, bytes] of first) expect(fs.readFileSync(file)).toEqual(bytes);

    const exported = path.join(item.exported, 'staging', 'linux-x64');
    expect(fs.readFileSync(path.join(
      exported,
      'rasen-linux-process-authority-helper'
    ))).toEqual(item.helper);
    expect(fs.readFileSync(path.join(
      exported,
      'rasen-linux-process-authority-broker-client'
    ))).toEqual(item.brokerClient);
    expect(fs.existsSync(path.join(
      exported,
      'rasen-linux-process-authority-broker'
    ))).toBe(false);
    expect(JSON.parse(fs.readFileSync(
      path.join(item.exported, 'release-input.json'),
      'utf8'
    ))).toHaveProperty('schema', 'rasen-linux-process-authority-release-input/1');
  });

  it('keeps npm/package installation unprivileged and rejects implicit fallback seams', () => {
    const item = fixture();
    if (process.platform !== 'win32') assemble(item);
    const packageMetadata = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      files: string[];
    };
    const postinstall = fs.readFileSync('scripts/postinstall.js', 'utf8');
    const resolver = fs.readFileSync(
      'src/core/session-host/process-authority/linux/artifact-resolver.ts',
      'utf8'
    );

    expect(packageMetadata.files).toContain('dist');
    expect(postinstall).not.toMatch(
      /linux-process-authority|broker|cargo|rustc|sudo|systemctl|cgroup|download|https?:/i
    );
    expect(resolver).not.toMatch(
      /child_process|process\.env\.PATH|spawn\(|exec\(|fetch\(|https\.request|cargo build|process-capsule/i
    );

    const packageRoot = path.join(item.root, 'packlist');
    const distRoot = path.join(packageRoot, 'dist', 'native', 'linux-x64');
    fs.mkdirSync(distRoot, { recursive: true });
    const packMetadata = { ...packageMetadata } as typeof packageMetadata & {
      scripts?: Record<string, string>;
    };
    delete packMetadata.scripts;
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify(packMetadata, null, 2)}\n`
    );
    for (const name of [
      'rasen-linux-process-authority-broker',
      'broker.key',
      'broker.sock',
      'broker.state',
      'broker-state.json',
      'rasen-linux-process-authority.service',
    ]) {
      fs.writeFileSync(path.join(distRoot, name), 'must never be packed');
    }
    fs.mkdirSync(path.join(distRoot, 'leases'), { recursive: true });
    fs.writeFileSync(path.join(distRoot, 'leases', 'active.json'), '{}');
    fs.mkdirSync(path.join(distRoot, 'guardian-construction'), { recursive: true });
    fs.writeFileSync(path.join(distRoot, 'guardian-construction', 'active.json'), '{}');
    fs.writeFileSync(path.join(distRoot, 'rasen-linux-process-authority-helper'), 'safe');
    const packlist = npmPacklist(packageRoot);
    expect(packlist).toContain('dist/native/linux-x64/rasen-linux-process-authority-helper');
    expect(packlist.join('\n')).not.toMatch(
      /rasen-linux-process-authority-broker(?:\.exe)?$|broker\.key|broker\.sock|broker[.-]state|leases|guardian-construction|\.service$/i
    );
  });

  // Parked-provider subject (locked decision 13): staging validation is upgrade-path; skipped, not passed, on win32.
  it.skipIf(process.platform === 'win32')('rejects empty or cross-built staged bytes before pinning package authority', () => {
    const empty = fixture();
    fs.writeFileSync(path.join(
      empty.staging,
      'linux-x64',
      'rasen-linux-process-authority-helper'
    ), Buffer.alloc(0));
    expect(() => assemble(empty)).toThrow(/artifact|helper|length|empty/i);

    const missingClient = fixture();
    fs.unlinkSync(path.join(
      missingClient.staging,
      'linux-x64',
      'rasen-linux-process-authority-broker-client'
    ));
    expect(() => assemble(missingClient)).toThrow(/broker|client|artifact|missing/i);

    const cross = fixture();
    const provenancePath = path.join(cross.staging, 'linux-x64', 'provenance.json');
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8')) as {
      evidenceClassification: string;
    };
    provenance.evidenceClassification = 'cross-build-non-runtime';
    fs.writeFileSync(provenancePath, canonical(provenance));
    expect(() => assemble(cross)).toThrow(/native Linux build|provenance/i);
  });

  // Parked-provider subject (locked decision 13): release-input binding is upgrade-path; skipped, not passed, on win32.
  it.skipIf(process.platform === 'win32')('binds staged bytes to trusted release input and exact target ELF identity', () => {
    const replacedRelease = fixture();
    const pinnedReleaseSha256 = createHash('sha256')
      .update(fs.readFileSync(replacedRelease.releaseInput))
      .digest('hex');
    rewriteReleaseInput(replacedRelease, (release) => {
      release.builds[0]!.environmentSha256 = 'f'.repeat(64);
    });
    expect(() => assemble(replacedRelease, pinnedReleaseSha256)).toThrow(
      /trusted release.*hash|release input.*SHA-256/i
    );

    const tampered = fixture();
    const helperPath = path.join(
      tampered.staging,
      'linux-x64',
      'rasen-linux-process-authority-helper'
    );
    const helper = fs.readFileSync(helperPath);
    helper[helper.length - 1] ^= 0xff;
    fs.writeFileSync(helperPath, helper, { mode: 0o755 });
    expect(() => assemble(tampered)).toThrow(/trusted release|hash|length|artifact/i);

    const foreignMachine = fixture();
    const foreignPath = path.join(
      foreignMachine.staging,
      'linux-x64',
      'rasen-linux-process-authority-helper'
    );
    const foreignBytes = fs.readFileSync(foreignPath);
    foreignBytes.writeUInt16LE(183, 18);
    fs.writeFileSync(foreignPath, foreignBytes, { mode: 0o755 });
    rewriteReleaseInput(foreignMachine, (release) => {
      const artifacts = release.builds[0]?.artifacts as Array<Record<string, unknown>>;
      const helperArtifact = artifacts.find((artifact) =>
        artifact.file === 'rasen-linux-process-authority-helper');
      if (!helperArtifact) throw new Error('missing fixture helper release entry');
      helperArtifact.sha256 = createHash('sha256').update(foreignBytes).digest('hex');
    });
    expect(() => assemble(foreignMachine)).toThrow(/ELF|machine|target/i);
  });

  // Parked-provider subject (locked decision 13): manifest emission is upgrade-path; skipped, not passed, on win32.
  it.skipIf(process.platform === 'win32')('emits architecture-correct manifests for arm64-only and dual-architecture input', () => {
    const arm64 = fixture(['arm64']);
    assemble(arm64);
    const armManifest = JSON.parse(fs.readFileSync(path.join(
      arm64.output,
      'dist',
      'native',
      'linux-process-authority',
      'providers-linux-arm64.json'
    ), 'utf8')) as { providers: Array<{ artifactPath: string }> };
    expect(armManifest.providers.map((provider) => provider.artifactPath)).toEqual([
      'dist/native/linux-arm64/rasen-linux-process-authority-helper',
      'dist/native/linux-arm64/rasen-linux-process-authority-broker-client',
    ]);

    const dual = fixture(['x64', 'arm64']);
    assemble(dual);
    const advertised: string[] = [];
    for (const arch of ['x64', 'arm64']) {
      const manifest = JSON.parse(fs.readFileSync(path.join(
        dual.output,
        'dist',
        'native',
        'linux-process-authority',
        `providers-linux-${arch}.json`
      ), 'utf8')) as { providers: Array<{ artifactPath: string }> };
      advertised.push(...manifest.providers.map((provider) => provider.artifactPath));
    }
    expect(new Set(advertised).size).toBe(4);
    for (const relative of advertised) {
      expect(fs.existsSync(path.join(dual.output, ...relative.split('/')))).toBe(true);
    }
  });

  // Parked-provider subject (locked decision 13): assembly-tree hygiene is upgrade-path; skipped, not passed, on win32.
  it.skipIf(process.platform === 'win32')('replaces owned assembly/export trees and removes stale privileged inventory', () => {
    const item = fixture();
    const stalePackageRoot = path.join(item.output, 'dist', 'native', 'linux-x64');
    const staleForeignRoot = path.join(item.output, 'dist', 'native', 'linux-arm64');
    const staleUnknownArchitectureRoot = path.join(
      item.output,
      'dist',
      'native',
      'linux-foreign'
    );
    const staleManifestRoot = path.join(
      item.output,
      'dist',
      'native',
      'linux-process-authority'
    );
    const staleExportRoot = path.join(item.exported, 'staging', 'linux-x64');
    fs.mkdirSync(stalePackageRoot, { recursive: true });
    fs.mkdirSync(staleForeignRoot, { recursive: true });
    fs.mkdirSync(staleUnknownArchitectureRoot, { recursive: true });
    fs.mkdirSync(staleManifestRoot, { recursive: true });
    fs.mkdirSync(staleExportRoot, { recursive: true });
    fs.writeFileSync(path.join(staleForeignRoot, 'foreign-helper'), 'stale');
    fs.writeFileSync(path.join(staleUnknownArchitectureRoot, 'foreign-helper'), 'stale');
    fs.writeFileSync(path.join(staleManifestRoot, 'providers-foreign.json'), '{}');
    for (const destination of [stalePackageRoot, staleExportRoot]) {
      fs.writeFileSync(path.join(destination, 'rasen-linux-process-authority-broker'), 'stale');
      fs.writeFileSync(path.join(destination, 'broker.key'), 'stale');
    }
    assemble(item);
    expect(fs.existsSync(path.join(
      stalePackageRoot,
      'rasen-linux-process-authority-broker'
    ))).toBe(false);
    expect(fs.existsSync(path.join(stalePackageRoot, 'broker.key'))).toBe(false);
    expect(fs.existsSync(staleForeignRoot)).toBe(false);
    expect(fs.existsSync(staleUnknownArchitectureRoot)).toBe(false);
    expect(fs.existsSync(path.join(
      staleManifestRoot,
      'providers-foreign.json'
    ))).toBe(false);
    expect(fs.existsSync(path.join(
      staleExportRoot,
      'rasen-linux-process-authority-broker'
    ))).toBe(false);
    expect(fs.existsSync(path.join(staleExportRoot, 'broker.key'))).toBe(false);
  });

  it('uses host path APIs and labels Windows cross-target checking non-runtime', () => {
    const plan = JSON.parse(execFileSync(process.execPath, [
      SCRIPT,
      '--plan',
      '--target',
      'x86_64-unknown-linux-gnu',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    })) as Record<string, unknown>;

    expect(plan).toMatchObject({
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      artifactPath: 'dist/native/linux-x64/rasen-linux-process-authority-helper',
      runtimeAccepted: false,
    });
    expect(plan.evidenceClassification).toBe(
      process.platform === 'linux'
        ? 'native-build-non-runtime'
        : 'cross-build-non-runtime'
    );
    expect(fs.readFileSync(SCRIPT, 'utf8')).toContain('path.join');
  });

  it('rejects compiler overrides and builds from a digest-bound isolated source snapshot', () => {
    const override = spawnSync(process.execPath, [
      SCRIPT,
      '--check-only',
      '--target',
      'x86_64-unknown-linux-gnu',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        RUSTC_WRAPPER: path.join(os.tmpdir(), 'untrusted-rustc-wrapper'),
      },
    });
    expect(override.status).not.toBe(0);
    expect(`${override.stdout}\n${override.stderr}`).toMatch(
      /build-affecting environment override|RUSTC_WRAPPER/i
    );

    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).toMatch(/source snapshot/i);
    expect(script).toMatch(/sourceSha256Before/);
    expect(script).toMatch(/sourceSha256After/);
    expect(script).toMatch(/CARGO_HOME/);
    expect(script).toMatch(/cargoConfigSha256/);
    expect(script).toMatch(/--print', 'sysroot'/);
    expect(script).toMatch(/exact-sysroot-binaries/);
    expect(script).toMatch(/targetLinkerPath, \['-flavor', 'gnu', '--version'\]/);
    expect(script).toMatch(/RASEN_LINUX_PROCESS_AUTHORITY_ZIG/);
    expect(script).toMatch(/hostLinkerCommandSha256/);
    expect(script).toMatch(/targetLinkerSha256/);
    expect(script).not.toMatch(/cwd:\s*root,\s*stdio:\s*'inherit'/u);
  });

  // Parked-provider subject (locked decision 13): snapshot immutability is upgrade-path; skipped, not passed, on win32.
  it.skipIf(process.platform === 'win32')('fails closed when live source changes after the immutable snapshot starts', () => {
    const item = fixture();
    const copiedRoot = path.join(item.root, 'copied-source');
    const copiedScript = path.join(copiedRoot, 'scripts', 'build-linux-process-authority.mjs');
    const copiedCrate = path.join(copiedRoot, 'native', 'linux-process-authority');
    const fakeSysroot = path.join(item.root, 'fake-toolchain');
    const fakeBin = path.join(fakeSysroot, 'bin');
    const buildTemp = path.join(item.root, 'isolated-build-temp');
    fs.mkdirSync(path.dirname(copiedScript), { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(buildTemp, { recursive: true });
    fs.mkdirSync(copiedCrate, { recursive: true });
    fs.copyFileSync(SCRIPT, copiedScript);
    for (const file of ['Cargo.lock', 'Cargo.toml', 'THIRD_PARTY.md']) {
      fs.copyFileSync(path.join(CRATE, file), path.join(copiedCrate, file));
    }
    fs.cpSync(path.join(CRATE, 'src'), path.join(copiedCrate, 'src'), { recursive: true });
    const rustc = path.join(fakeBin, 'rustc');
    const cargo = path.join(fakeBin, 'cargo');
    const mutationPath = path.join(copiedCrate, 'src', 'lib.rs')
      .replaceAll("'", "'\\''");
    fs.writeFileSync(rustc, [
      '#!/bin/sh',
      'if [ "$1" = "--print" ] && [ "$2" = "sysroot" ]; then',
      `  echo '${fakeSysroot.replaceAll("'", "'\\''")}'`,
      '  exit 0',
      'fi',
      "echo 'rustc 1.88.0 (6b00bc388 2025-06-23)'",
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(cargo, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      "  echo 'cargo 1.88.0 (873a06493 2025-05-10)'",
      '  exit 0',
      'fi',
      'previous=',
      'manifest=',
      'for argument in "$@"; do',
      '  if [ "$previous" = "--manifest-path" ]; then manifest="$argument"; break; fi',
      '  previous="$argument"',
      'done',
      'test -n "$manifest"',
      'if printf "\\n// forbidden snapshot mutation\\n" >> "$(dirname "$manifest")/src/lib.rs" 2>/dev/null; then',
      '  exit 91',
      'fi',
      "echo 'snapshot-readonly-ok'",
      `printf '\\n// concurrent mutation\\n' >> '${mutationPath}'`,
      'exit 0',
      '',
    ].join('\n'), { mode: 0o755 });
    fs.chmodSync(rustc, 0o755);
    fs.chmodSync(cargo, 0o755);

    const result = spawnSync(process.execPath, [
      copiedScript,
      '--check-only',
      '--target',
      'x86_64-unknown-linux-gnu',
    ], {
      cwd: copiedRoot,
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
        RASEN_LINUX_PROCESS_AUTHORITY_TEMP_ROOT: buildTemp,
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('snapshot-readonly-ok');
    expect(`${result.stdout}\n${result.stderr}`).toMatch(
      /source.*changed|source digest changed/i
    );
  });

  it('keeps primary CI unprivileged and privileged broker wiring manual-only', () => {
    const document = parse(fs.readFileSync(WORKFLOW, 'utf8')) as {
      on: Record<string, unknown>;
      permissions: Record<string, string>;
      jobs: Record<string, Record<string, unknown>>;
    };
    const primary = document.jobs['linux-provider-primary'];
    const policy = document.jobs['linux-primary-namespace-policy'];
    const actualRuntime = document.jobs['linux-provider-primary-actual-runtime'];
    const windows = document.jobs['windows-linux-target-shape'];
    const broker = document.jobs['broker-privileged-manual'];

    expect(document.permissions).toEqual({ contents: 'read' });
    expect(document.on).toHaveProperty('pull_request');
    expect(document.on).toHaveProperty('workflow_dispatch');
    expect(JSON.stringify(primary)).not.toMatch(/sudo|broker\.key|systemctl/i);
    expect(JSON.stringify(primary)).toMatch(/1\.88\.0|--locked|build|package/i);
    expect(JSON.stringify(primary)).not.toMatch(/linux_primary_contract/);
    expect(JSON.stringify(primary)).toMatch(
      /--skip primary::construction_matrix_tests::partial_construction_failure_matrix/
    );
    expect(JSON.stringify(policy)).toMatch(/state=open|GITHUB_OUTPUT|namespace-policy/i);
    expect(String(actualRuntime.if)).toBe(
      "needs.linux-primary-namespace-policy.outputs.state == 'available'"
    );
    expect(JSON.stringify(actualRuntime)).toMatch(/linux_primary_contract/);
    expect(JSON.stringify(actualRuntime)).toMatch(
      /primary::construction_matrix_tests::partial_construction_failure_matrix/
    );
    expect(JSON.stringify(actualRuntime)).not.toMatch(/actual-runtime-gate\.json|exit 1/);
    expect(String(actualRuntime.name)).toMatch(/actual.*runtime.*gate/i);
    expect(JSON.stringify(windows)).toMatch(/windows-latest|--check-only|non-runtime/i);
    expect(String(broker.if)).toContain("github.event_name == 'workflow_dispatch'");
    expect(String(broker.if)).toContain("github.repository == 'DumoeDss/rasen'");
    expect(String(broker.if)).toContain("'writable-cgroup-v2+sudo'");
    expect(broker.environment).toBe('linux-process-authority-broker');
    expect(broker['runs-on']).toEqual([
      'self-hosted',
      'linux',
      'x64',
      'rasen-cgroup-v2-broker',
    ]);
    expect(JSON.stringify(broker)).toMatch(/sudo -n|cgroup\.kill|cgroup\.events/i);
    expect(JSON.stringify(broker)).toMatch(
      /usr\/libexec\/rasen\/rasen-linux-process-authority-broker/
    );
    expect(JSON.stringify(broker)).toMatch(
      /broker-public-key\.manifest|broker\.sock|var\/lib\/rasen\/linux-process-authority/
    );
    expect(JSON.stringify(broker)).toMatch(
      /rustc --version.*rustc 1\.88\.0|cargo --version.*cargo 1\.88\.0/s
    );
    expect(JSON.stringify(broker)).not.toMatch(/dtolnay\/rust-toolchain/);
    const brokerUses = (broker.steps as Array<{ uses?: string }>)
      .flatMap((step) => step.uses ? [step.uses] : []);
    expect(brokerUses.length).toBeGreaterThan(0);
    expect(brokerUses.every((use) => /@[a-f0-9]{40}$/u.test(use))).toBe(true);
  });
});
