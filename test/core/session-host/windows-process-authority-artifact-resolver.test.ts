import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WINDOWS_PROCESS_AUTHORITY_ARTIFACT_SCHEMA,
  inspectWindowsProcessAuthorityArtifact,
  inspectWindowsProcessAuthorityArtifactForTesting,
  resolveWindowsProcessAuthorityArtifact,
  resolveWindowsProcessAuthorityArtifactForTesting,
} from '../../../src/core/session-host/process-authority/windows/artifact-resolver.js';
import {
  WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES,
  type WindowsProcessAuthorityBuildIdentity,
} from '../../../src/core/session-host/process-authority/windows/build-authority.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const HELPER_RELATIVE = 'dist/native/win32-x64/rasen-windows-process-authority-helper.exe';
const COMPILER = 'rustc 1.88.0 (6b00bc388 2025-06-23)';
const MACHINE_BY_ARCH = Object.freeze({ x64: 0x86_64, arm64: 0xaa_64 });

const roots: string[] = [];

/** A minimally valid PE image: MZ stub, PE signature, machine, characteristics. */
function portableExecutable(arch: 'x64' | 'arm64', payload = 'rasen'): Buffer {
  const headerOffset = 0x80;
  const bytes = Buffer.alloc(headerOffset + 64, 0);
  bytes.write('MZ', 0, 'ascii');
  bytes.writeUInt32LE(headerOffset, 0x3c);
  bytes.write('PE\0\0', headerOffset, 'latin1');
  bytes.writeUInt16LE(MACHINE_BY_ARCH[arch], headerOffset + 4);
  bytes.writeUInt16LE(0x0002, headerOffset + 22);
  bytes.write(payload, headerOffset + 32, 'ascii');
  return bytes;
}

interface StagedArtifact {
  readonly packageRoot: string;
  readonly helperPath: string;
  readonly manifestPath: string;
  readonly authority: WindowsProcessAuthorityBuildIdentity;
}

function stage(
  overrides: Record<string, unknown> = {},
  options: { readonly arch?: 'x64' | 'arm64'; readonly relative?: string } = {}
): StagedArtifact {
  const arch = options.arch ?? 'x64';
  const relative = options.relative ?? HELPER_RELATIVE;
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-windows-artifact-'));
  roots.push(packageRoot);
  const helperPath = path.join(packageRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(helperPath), { recursive: true });
  const bytes = portableExecutable(arch);
  fs.writeFileSync(helperPath, bytes);
  const manifest = {
    schema: WINDOWS_PROCESS_AUTHORITY_ARTIFACT_SCHEMA,
    platform: 'win32',
    arch,
    mode: 'job-object',
    providerId: 'rasen.windows.job-object',
    capabilityId: 'rasen-recursive-process-scope/1',
    protocolVersion: 1,
    providerReferenceVersion: 1,
    artifactFile: path.basename(helperPath),
    machine: MACHINE_BY_ARCH[arch],
    length: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceSha256: 'd'.repeat(64),
    compiler: COMPILER,
    ...overrides,
  };
  const manifestPath = `${helperPath}.manifest.json`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  return {
    packageRoot,
    helperPath,
    manifestPath,
    authority: {
      artifactPath: relative,
      arch: manifest.arch as 'x64' | 'arm64',
      mode: 'job-object',
      providerId: 'rasen.windows.job-object',
      protocolVersion: 1,
      providerReferenceVersion: 1,
      length: manifest.length as number,
      sha256: manifest.sha256 as string,
      sourceSha256: manifest.sourceSha256 as string,
      compiler: manifest.compiler as string,
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupTempPath(root);
});

const HOST_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const FOREIGN_ARCH = HOST_ARCH === 'x64' ? 'arm64' : 'x64';

/**
 * Runs a body as if the process were on another platform or architecture.
 *
 * This exists so the non-Windows and foreign-architecture branches are
 * *asserted* rather than assumed. Gating them behind the real platform would
 * make them silently vanish on whichever host happened to run the suite, which
 * is the failure mode where a whole class of "passing" means nothing. Both
 * branches therefore execute on every host, and neither is ever skipped.
 */
function onSimulatedRuntime<T>(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  body: () => T
): T {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')!;
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
  Object.defineProperty(process, 'arch', { ...archDescriptor, value: arch });
  try {
    return body();
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    Object.defineProperty(process, 'arch', archDescriptor);
  }
}

describe('Windows process-authority artifact resolution', () => {
  it('resolves an adjacent helper whose manifest and build authority agree exactly', () => {
    const staged = stage();
    const inspection = inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, staged.authority);
    expect(inspection.evidenceClassification).toBe('package-integrity');
    expect(inspection.helperPath).toBe(fs.realpathSync.native(staged.helperPath));
    expect(inspection.artifact.machine).toBe(MACHINE_BY_ARCH.x64);
  });

  it('becomes actual-Windows runtime authority on a Windows runtime', () => {
    const staged = stage({}, { arch: HOST_ARCH });
    const resolved = onSimulatedRuntime('win32', HOST_ARCH, () =>
      resolveWindowsProcessAuthorityArtifactForTesting({
        packageRoot: staged.packageRoot,
        artifactPath: HELPER_RELATIVE,
      }, staged.authority));
    expect(resolved.evidenceClassification).toBe('actual-windows-runtime');
    expect(resolved.executableInode).toMatch(/^\d+$/u);
  });

  it.each(['linux', 'darwin'] as const)(
    'never promotes a cross-built artifact to authority on a %s runtime',
    (platform) => {
      const staged = stage({}, { arch: HOST_ARCH });
      // Inspecting it stays legal everywhere — it is build evidence.
      expect(inspectWindowsProcessAuthorityArtifactForTesting({
        packageRoot: staged.packageRoot,
        artifactPath: HELPER_RELATIVE,
        arch: HOST_ARCH,
      }, staged.authority).evidenceClassification).toBe('package-integrity');
      // Promoting it to runtime authority off Windows is not.
      expect(() => onSimulatedRuntime(platform, HOST_ARCH, () =>
        resolveWindowsProcessAuthorityArtifactForTesting({
          packageRoot: staged.packageRoot,
          artifactPath: HELPER_RELATIVE,
        }, staged.authority)))
        .toThrow(/cannot become authority outside an actual Windows runtime/u);
    }
  );

  it('refuses a foreign-architecture artifact, keeping it build evidence only', () => {
    const staged = stage({}, { arch: FOREIGN_ARCH });
    // Inspecting it as build evidence for its own architecture is allowed.
    expect(inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: FOREIGN_ARCH,
    }, staged.authority).artifact.arch).toBe(FOREIGN_ARCH);
    // Promoting it to runtime authority on a host of the other architecture is not.
    expect(() => onSimulatedRuntime('win32', HOST_ARCH, () =>
      resolveWindowsProcessAuthorityArtifactForTesting({
        packageRoot: staged.packageRoot,
        artifactPath: HELPER_RELATIVE,
      }, staged.authority)))
      .toThrow(/manifest identity or bounds differ/u);
  });

  it('refuses a runtime architecture the provider does not support', () => {
    const staged = stage({}, { arch: HOST_ARCH });
    expect(() => onSimulatedRuntime('win32', 'ia32', () =>
      resolveWindowsProcessAuthorityArtifactForTesting({
        packageRoot: staged.packageRoot,
        artifactPath: HELPER_RELATIVE,
      }, staged.authority)))
      .toThrow(/runtime architecture is unsupported/u);
  });

  it.each([
    ['foreign platform', { platform: 'linux' }],
    ['wrong architecture', { arch: 'arm64' }],
    ['future protocol', { protocolVersion: 2 }],
    ['future reference version', { providerReferenceVersion: 2 }],
    ['wrong mode', { mode: 'broker' }],
    ['wrong capability', { capabilityId: 'rasen-process-group/1' }],
    ['wrong provider', { providerId: 'rasen.linux.user-pidns' }],
    ['wrong schema', { schema: 'rasen-linux-process-authority-artifact/1' }],
    ['wrong machine', { machine: MACHINE_BY_ARCH.arm64 }],
    ['non-executable artifact name', { artifactFile: 'helper' }],
    ['unknown manifest field', { unexpected: 1 }],
  ])('fails closed on a manifest with a %s', (_name, overrides) => {
    const staged = stage(overrides);
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, staged.authority)).toThrow(/Windows process-authority artifact/u);
  });

  it('fails closed when the helper length, hash or source provenance differs', () => {
    const wrongLength = stage({ length: 4 });
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: wrongLength.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, wrongLength.authority)).toThrow(/length differs/u);

    const wrongHash = stage();
    fs.writeFileSync(wrongHash.helperPath, portableExecutable('x64', 'other'));
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: wrongHash.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, wrongHash.authority)).toThrow(/hash differs/u);

    const staged = stage();
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, { ...staged.authority, sourceSha256: 'e'.repeat(64) }))
      .toThrow(/build-pinned authority does not bind/u);
  });

  it('fails closed when the artifact is not a portable executable image', () => {
    const staged = stage();
    const bytes = Buffer.alloc(512, 0);
    bytes.write('ZM', 0, 'ascii');
    fs.writeFileSync(staged.helperPath, bytes);
    const authority = {
      ...staged.authority,
      length: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    fs.writeFileSync(staged.manifestPath, `${JSON.stringify({
      ...JSON.parse(fs.readFileSync(staged.manifestPath, 'utf8')) as object,
      length: bytes.byteLength,
      sha256: authority.sha256,
    })}\n`);
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, authority)).toThrow(/not a portable executable/u);
  });

  it('fails closed when the artifact is a library rather than an executable image', () => {
    const staged = stage();
    const bytes = portableExecutable('x64');
    bytes.writeUInt16LE(0x2002, 0x80 + 22);
    fs.writeFileSync(staged.helperPath, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(staged.manifestPath, `${JSON.stringify({
      ...JSON.parse(fs.readFileSync(staged.manifestPath, 'utf8')) as object,
      sha256,
    })}\n`);
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, { ...staged.authority, sha256 })).toThrow(/not an executable image/u);
  });

  it.each([
    ['absolute path', 'C:\\Windows\\System32\\cmd.exe'],
    ['parent escape', '../outside/helper.exe'],
    ['embedded parent escape', 'dist/../../helper.exe'],
    ['posix absolute path', '/usr/bin/helper'],
    ['empty path', ''],
  ])('refuses an artifact path that is a %s', (_name, artifactPath) => {
    const staged = stage();
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath,
      arch: 'x64',
    }, staged.authority)).toThrow(/Windows process-authority artifact/u);
  });

  it('refuses a helper reached through a reparse point that leaves the package root', () => {
    const staged = stage();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-windows-outside-'));
    roots.push(outside);
    fs.copyFileSync(staged.helperPath, path.join(outside, path.basename(staged.helperPath)));
    fs.copyFileSync(staged.manifestPath, path.join(outside, path.basename(staged.manifestPath)));
    const junctionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-windows-junction-'));
    roots.push(junctionRoot);
    const linked = path.join(junctionRoot, 'native');
    fs.symlinkSync(outside, linked, 'junction');
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: junctionRoot,
      artifactPath: `native/${path.basename(staged.helperPath)}`,
      arch: 'x64',
    }, { ...staged.authority, artifactPath: `native/${path.basename(staged.helperPath)}` }))
      .toThrow(/Windows process-authority artifact/u);
  });

  it('fails closed when the helper or its adjacent manifest is missing', () => {
    const missingHelper = stage();
    fs.rmSync(missingHelper.helperPath);
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: missingHelper.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, missingHelper.authority)).toThrow(/helper is missing/u);

    const missingManifest = stage();
    fs.rmSync(missingManifest.manifestPath);
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: missingManifest.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, missingManifest.authority)).toThrow(/manifest is missing/u);
  });

  it('refuses a non-canonical manifest encoding', () => {
    const staged = stage();
    const manifest = JSON.parse(fs.readFileSync(staged.manifestPath, 'utf8')) as object;
    fs.writeFileSync(staged.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => inspectWindowsProcessAuthorityArtifactForTesting({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: 'x64',
    }, staged.authority)).toThrow(/not closed and canonical/u);
  });

  it('has an empty production build-authority table until packaging generates one', () => {
    expect(WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES).toEqual([]);
    const staged = stage();
    expect(() => inspectWindowsProcessAuthorityArtifact({
      packageRoot: staged.packageRoot,
      artifactPath: HELPER_RELATIVE,
      arch: HOST_ARCH,
    })).toThrow(/build-pinned authority does not bind/u);
    expect(() => onSimulatedRuntime('win32', HOST_ARCH, () =>
      resolveWindowsProcessAuthorityArtifact({
        packageRoot: staged.packageRoot,
        artifactPath: HELPER_RELATIVE,
      }))).toThrow(/build-pinned authority does not bind/u);
  });

  it('never compiles, downloads, searches PATH, or invokes a shell to resolve', () => {
    const source = fs.readFileSync(
      path.resolve('src/core/session-host/process-authority/windows/artifact-resolver.ts'),
      'utf8'
    );
    for (const forbidden of [
      'child_process',
      'node:http',
      'node:https',
      'fetch(',
      'execSync',
      'spawnSync',
      'process.env.PATH',
      'delimiter',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
