import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  inspectLinuxProcessAuthorityArtifact as inspectProductionArtifact,
  inspectLinuxProcessAuthorityArtifactForTesting,
  resolveLinuxProcessAuthorityArtifact as resolveProductionArtifact,
  resolveLinuxProcessAuthorityArtifactForTesting,
} from '../../../src/core/session-host/process-authority/linux/artifact-resolver.js';
import type { LinuxProcessAuthorityBuildIdentity } from
  '../../../src/core/session-host/process-authority/linux/build-authority.js';
import { cleanupTempPath } from '../../helpers/temp-cleanup.js';

const tempRoots: string[] = [];
const fixtureAuthorities = new Map<string, LinuxProcessAuthorityBuildIdentity>();

function fixtureAuthority(packageRoot: string): LinuxProcessAuthorityBuildIdentity {
  const authority = fixtureAuthorities.get(packageRoot);
  if (!authority) throw new Error('fixture build authority is absent');
  return authority;
}

function inspectLinuxProcessAuthorityArtifact(
  options: Parameters<typeof inspectProductionArtifact>[0]
) {
  return inspectLinuxProcessAuthorityArtifactForTesting(
    options,
    fixtureAuthority(options.packageRoot)
  );
}

function resolveLinuxProcessAuthorityArtifact(
  options: Parameters<typeof resolveProductionArtifact>[0]
) {
  return resolveLinuxProcessAuthorityArtifactForTesting(
    options,
    fixtureAuthority(options.packageRoot)
  );
}

function fixture(mode: 'user-pidns' | 'broker-pidns-cgroupv2' = 'user-pidns') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-linux-artifact-'));
  tempRoots.push(root);
  const artifactPath = path.join('native', 'linux-x64', mode === 'user-pidns'
    ? 'rasen-linux-process-authority-helper'
    : 'rasen-linux-process-authority-broker-client');
  const helperPath = path.join(root, artifactPath);
  fs.mkdirSync(path.dirname(helperPath), { recursive: true });
  const bytes = Buffer.from(`ELF-fixture:${mode}`);
  fs.writeFileSync(helperPath, bytes, { mode: 0o755 });
  const manifest = {
    schema: 'rasen-linux-process-authority-artifact/1',
    platform: 'linux',
    arch: 'x64',
    mode,
    providerId: mode === 'user-pidns'
      ? 'rasen.linux.user-pidns'
      : 'rasen.linux.broker-pidns-cgroupv2',
    capabilityId: 'rasen-recursive-process-scope/1',
    protocolVersion: 1,
    providerReferenceVersion: 1,
    artifactFile: path.basename(helperPath),
    executableMode: '0755',
    length: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceSha256: 'a'.repeat(64),
    compiler: 'rustc 1.88.0 (6b00bc388 2025-06-23)',
  };
  fs.writeFileSync(`${helperPath}.manifest.json`, `${JSON.stringify(manifest)}\n`);
  const trustPath = path.join(root, 'rasen-linux-process-authority.trust.json');
  const trust = {
    schema: 'rasen-linux-process-authority-trust/1',
    artifacts: [{
      artifactPath: artifactPath.split(path.sep).join('/'),
      arch: 'x64',
      mode,
      providerId: manifest.providerId,
      protocolVersion: 1,
      providerReferenceVersion: 1,
      length: manifest.length,
      sha256: manifest.sha256,
      sourceSha256: manifest.sourceSha256,
      compiler: manifest.compiler,
    }],
  };
  fs.writeFileSync(trustPath, `${JSON.stringify(trust)}\n`);
  const buildAuthority: LinuxProcessAuthorityBuildIdentity = Object.freeze({
    ...trust.artifacts[0],
  });
  fixtureAuthorities.set(root, buildAuthority);
  return { root, artifactPath, helperPath, manifest, trustPath, trust, buildAuthority };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fixtureAuthorities.delete(root);
    cleanupTempPath(root);
  }
});

describe('adjacent Linux process-authority artifact resolver', () => {
  it('inspects the exact adjacent primary helper as package evidence', () => {
    const item = fixture();
    expect(inspectLinuxProcessAuthorityArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toEqual({
      evidenceClassification: 'package-integrity',
      helperPath: fs.realpathSync.native(item.helperPath),
      manifestPath: fs.realpathSync.native(`${item.helperPath}.manifest.json`),
      artifact: item.manifest,
    });
  });

  it('inspects an exact broker client without contacting or installing a broker service', () => {
    const item = fixture('broker-pidns-cgroupv2');
    expect(inspectLinuxProcessAuthorityArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'broker-pidns-cgroupv2',
      arch: 'x64',
    })).toMatchObject({
      evidenceClassification: 'package-integrity',
      artifact: {
        mode: 'broker-pidns-cgroupv2',
        providerId: 'rasen.linux.broker-pidns-cgroupv2',
      },
    });
  });

  it('keeps production unavailable until authenticated build identities are compiled in', () => {
    const item = fixture();
    expect(() => inspectProductionArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow(/build-pinned|authority/i);
    expect(() => resolveProductionArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
    })).toThrow(/actual Linux runtime|build-pinned|authority/i);
  });

  it('pins the verified Linux helper handle so a later pathname swap cannot change execution bytes', () => {
    if (process.platform !== 'linux') return;
    const item = fixture();
    const resolved = resolveLinuxProcessAuthorityArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
    });
    const displaced = `${item.helperPath}.displaced`;
    fs.renameSync(item.helperPath, displaced);
    fs.writeFileSync(item.helperPath, 'replacement-after-verification', { mode: 0o755 });
    const pinned = Buffer.alloc(item.manifest.length);
    fs.readSync(resolved.executableFd, pinned, 0, pinned.byteLength, 0);
    fs.closeSync(resolved.executableFd);
    expect(pinned).toEqual(fs.readFileSync(displaced));
    expect(pinned).not.toEqual(fs.readFileSync(item.helperPath));
  });

  it('rejects setuid, setgid, and sticky helper mode bits instead of masking them away', () => {
    if (process.platform !== 'linux') return;
    const item = fixture();
    fs.chmodSync(item.helperPath, 0o4755);
    expect(() => resolveLinuxProcessAuthorityArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
    })).toThrow(/mode|0755/i);
  });

  it.each([
    ['future schema', (manifest: Record<string, unknown>) => { manifest.schema = 'rasen-linux-process-authority-artifact/2'; }],
    ['foreign platform', (manifest: Record<string, unknown>) => { manifest.platform = 'win32'; }],
    ['wrong architecture', (manifest: Record<string, unknown>) => { manifest.arch = 'arm64'; }],
    ['wrong mode', (manifest: Record<string, unknown>) => { manifest.mode = 'broker-pidns-cgroupv2'; }],
    ['wrong provider', (manifest: Record<string, unknown>) => { manifest.providerId = 'rasen.linux.other'; }],
    ['wrong capability', (manifest: Record<string, unknown>) => { manifest.capabilityId = 'pidfd-process-group'; }],
    ['future protocol', (manifest: Record<string, unknown>) => { manifest.protocolVersion = 2; }],
    ['future reference', (manifest: Record<string, unknown>) => { manifest.providerReferenceVersion = 2; }],
    ['wrong executable mode', (manifest: Record<string, unknown>) => { manifest.executableMode = '0644'; }],
    ['wrong length', (manifest: Record<string, unknown>) => { manifest.length = 1; }],
    ['wrong hash', (manifest: Record<string, unknown>) => { manifest.sha256 = '0'.repeat(64); }],
    ['different valid source', (manifest: Record<string, unknown>) => { manifest.sourceSha256 = 'b'.repeat(64); }],
    ['unknown field', (manifest: Record<string, unknown>) => { manifest.downloadUrl = 'https://invalid.example/helper'; }],
  ])('rejects %s before returning an artifact', (_name, mutate) => {
    const item = fixture();
    mutate(item.manifest as Record<string, unknown>);
    fs.writeFileSync(`${item.helperPath}.manifest.json`, `${JSON.stringify(item.manifest)}\n`);
    expect(() => inspectLinuxProcessAuthorityArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow(/artifact|manifest|helper/i);
  });

  it('rejects a self-consistent replacement helper and companion manifest against package trust', () => {
    const item = fixture();
    const replacement = Buffer.from('replacement-ELF-controlled-by-caller');
    fs.writeFileSync(item.helperPath, replacement, { mode: 0o755 });
    item.manifest.length = replacement.byteLength;
    item.manifest.sha256 = createHash('sha256').update(replacement).digest('hex');
    item.manifest.sourceSha256 = 'b'.repeat(64);
    fs.writeFileSync(`${item.helperPath}.manifest.json`, `${JSON.stringify(item.manifest)}\n`);

    expect(() => inspectLinuxProcessAuthorityArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow(/trust|integrity|source|artifact/i);
  });

  it('rejects helper, manifest, and mutable package trust rewritten as one valid self-signed set', () => {
    const item = fixture();
    const replacement = Buffer.from('replacement-helper-with-self-signed-package-trust');
    const replacementHash = createHash('sha256').update(replacement).digest('hex');
    fs.writeFileSync(item.helperPath, replacement, { mode: 0o755 });
    Object.assign(item.manifest, {
      length: replacement.byteLength,
      sha256: replacementHash,
      sourceSha256: 'b'.repeat(64),
      compiler: 'rustc 9.99.0 attacker-controlled',
    });
    fs.writeFileSync(`${item.helperPath}.manifest.json`, `${JSON.stringify(item.manifest)}\n`);
    Object.assign(item.trust.artifacts[0], {
      length: replacement.byteLength,
      sha256: replacementHash,
      sourceSha256: 'b'.repeat(64),
      compiler: 'rustc 9.99.0 attacker-controlled',
    });
    fs.writeFileSync(item.trustPath, `${JSON.stringify(item.trust)}\n`);

    expect(() => inspectLinuxProcessAuthorityArtifact({
      packageRoot: item.root,
      artifactPath: item.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow(/build-pinned|authority|identity/i);
  });

  it('rejects missing, non-canonical, escaping, and symlinked artifact identities', () => {
    const missing = fixture();
    fs.unlinkSync(missing.helperPath);
    expect(() => inspectLinuxProcessAuthorityArtifact({
      packageRoot: missing.root,
      artifactPath: missing.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow();

    const noncanonical = fixture();
    const text = JSON.stringify(noncanonical.manifest, null, 2);
    fs.writeFileSync(`${noncanonical.helperPath}.manifest.json`, text);
    expect(() => inspectLinuxProcessAuthorityArtifact({
      packageRoot: noncanonical.root,
      artifactPath: noncanonical.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow(/canonical|manifest/i);

    const escaping = fixture();
    expect(() => inspectLinuxProcessAuthorityArtifact({
      packageRoot: escaping.root,
      artifactPath: path.join('..', path.basename(escaping.helperPath)),
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow(/path|escape|artifact/i);

    const linked = fixture();
    const target = `${linked.helperPath}.real`;
    fs.renameSync(linked.helperPath, target);
    fs.symlinkSync(target, linked.helperPath, 'file');
    expect(() => inspectLinuxProcessAuthorityArtifact({
      packageRoot: linked.root,
      artifactPath: linked.artifactPath,
      mode: 'user-pidns',
      arch: 'x64',
    })).toThrow(/symlink|artifact/i);
  });

  it('contains no PATH, shell, download, compiler, or legacy ProcessCapsule fallback', () => {
    const source = fs.readFileSync(
      path.resolve('src/core/session-host/process-authority/linux/artifact-resolver.ts'),
      'utf8'
    );
    for (const forbidden of [
      'process.env.PATH',
      'child_process',
      'spawn(',
      'exec(',
      'fetch(',
      'https.request',
      'cargo build',
      'process-capsule',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
