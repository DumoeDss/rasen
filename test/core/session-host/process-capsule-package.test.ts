import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PROCESS_CAPSULE_PROTOCOL_VERSION,
  resolvePackagedProcessCapsule,
} from '../../../src/core/session-host/process-capsule/resolver.js';

const roots: string[] = [];

function capabilities(platform: NodeJS.Platform = process.platform): string[] {
  return [
    'opaque-ref',
    'publish-before-activate',
    'exact-process-birth',
    'root-exit-scope-empty-v2',
    ...(platform === 'win32' ? ['unnamed-job-kill-on-close'] : []),
    ...(platform === 'linux' ? ['pidfd', 'process-group'] : []),
    ...(platform === 'darwin' ? ['proc-unique-birth', 'process-group'] : []),
  ];
}

function fixture(): { root: string; helper: string; manifest: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-process-capsule-package-'));
  roots.push(root);
  const platformArch = `${process.platform}-${process.arch}`;
  const directory = path.join(root, 'native', 'process-capsule', platformArch);
  fs.mkdirSync(directory, { recursive: true });
  const helper = path.join(directory, process.platform === 'win32' ? 'rasen-process-capsule.exe' : 'rasen-process-capsule');
  fs.writeFileSync(helper, 'source-built-helper');
  fs.chmodSync(helper, 0o700);
  const manifest = path.join(root, 'native', 'process-capsule', 'manifest.json');
  return { root, helper, manifest };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('packaged ProcessCapsule resolver', () => {
  it('builds helpers from pinned source on the release OS matrix without install-time fallback', () => {
    const build = fs.readFileSync('scripts/build-process-capsule.mjs', 'utf8');
    const release = fs.readFileSync('.github/workflows/release.yml', 'utf8');
    const postinstall = fs.readFileSync('scripts/postinstall.js', 'utf8');
    const toolchain = fs.readFileSync('rust-toolchain.toml', 'utf8');

    expect(build).toContain("'--locked'");
    expect(build).toContain("'--release'");
    expect(build).toContain('sourceSha256');
    expect(toolchain).toContain('channel = "1.88.0"');
    expect(release).toContain('ubuntu-latest, windows-latest, macos-latest');
    expect(release).toContain('RASEN_PROCESS_CAPSULE_EXPORT_DIR');
    expect(release).toContain('.native-helper-staging');
    expect(postinstall).not.toMatch(/cargo|rustc|process-capsule|download|https?:/i);
  });

  it('keeps PID and shell control outside the host/backend ProcessScope boundary', () => {
    const files = [
      'src/core/session-host/host.ts',
      'src/core/session-host/backend.ts',
      'src/core/session-host/claude-backend.ts',
      'src/core/session-host/ownership.ts',
      'src/core/agent-cli-process.ts',
    ];
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/processAdmission|killProcessTree|taskkill|powershell/i);
    expect(source).not.toMatch(/rootPid|processInstanceId/);
  });

  it('accepts only an adjacent exact platform/arch/protocol/length/hash artifact', () => {
    const item = fixture();
    const bytes = fs.readFileSync(item.helper);
    fs.writeFileSync(item.manifest, JSON.stringify({
      schema: 'rasen-process-capsule-manifest/1',
      protocolVersion: PROCESS_CAPSULE_PROTOCOL_VERSION,
      artifacts: [{
        platform: process.platform,
        arch: process.arch,
        path: path.relative(item.root, item.helper).split(path.sep).join('/'),
        length: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        capabilities: capabilities(),
        provenance: 'build-inputs',
        compiler: 'rustc test fixture',
        sourceSha256: 'a'.repeat(64),
      }],
    }));

    expect(resolvePackagedProcessCapsule({ packageRoot: item.root })).toMatchObject({
      helperPath: fs.realpathSync.native(item.helper),
      protocolVersion: PROCESS_CAPSULE_PROTOCOL_VERSION,
    });
  });

  it.each([
    ['missing helper', (item: ReturnType<typeof fixture>) => fs.rmSync(item.helper)],
    ['wrong hash', (item: ReturnType<typeof fixture>) => fs.writeFileSync(item.helper, 'mutated')],
    ['wrong protocol', (_item: ReturnType<typeof fixture>, manifest: Record<string, unknown>) => { manifest.protocolVersion = 999; }],
    ['wrong platform', (_item: ReturnType<typeof fixture>, manifest: Record<string, unknown>) => {
      (manifest.artifacts as Array<Record<string, unknown>>)[0].platform = process.platform === 'win32' ? 'linux' : 'win32';
    }],
    ['wrong architecture', (_item: ReturnType<typeof fixture>, manifest: Record<string, unknown>) => {
      (manifest.artifacts as Array<Record<string, unknown>>)[0].arch = 'foreign';
    }],
    ['wrong capability', (_item: ReturnType<typeof fixture>, manifest: Record<string, unknown>) => {
      (manifest.artifacts as Array<Record<string, unknown>>)[0].capabilities = ['opaque-ref'];
    }],
    ['wrong length', (_item: ReturnType<typeof fixture>, manifest: Record<string, unknown>) => {
      const artifact = (manifest.artifacts as Array<Record<string, unknown>>)[0];
      artifact.length = Number(artifact.length) + 1;
    }],
    ['non-regular helper', (item: ReturnType<typeof fixture>) => {
      fs.rmSync(item.helper);
      fs.mkdirSync(item.helper);
    }],
    ['symlink escape', (item: ReturnType<typeof fixture>) => {
      const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-process-capsule-external-'));
      roots.push(externalRoot);
      fs.writeFileSync(path.join(externalRoot, path.basename(item.helper)), 'source-built-helper');
      const platformDirectory = path.dirname(item.helper);
      fs.rmSync(platformDirectory, { recursive: true, force: true });
      fs.symlinkSync(externalRoot, platformDirectory, 'junction');
    }],
  ])('rejects %s without PATH/download/shell fallback', (_label, mutate) => {
    const item = fixture();
    const bytes = fs.readFileSync(item.helper);
    const manifest: Record<string, unknown> = {
      schema: 'rasen-process-capsule-manifest/1',
      protocolVersion: PROCESS_CAPSULE_PROTOCOL_VERSION,
      artifacts: [{
        platform: process.platform,
        arch: process.arch,
        path: path.relative(item.root, item.helper).split(path.sep).join('/'),
        length: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        capabilities: capabilities(),
        provenance: 'build-inputs',
        compiler: 'rustc test fixture',
        sourceSha256: 'a'.repeat(64),
      }],
    };
    mutate(item, manifest);
    fs.writeFileSync(item.manifest, JSON.stringify(manifest));
    expect(() => resolvePackagedProcessCapsule({ packageRoot: item.root })).toThrow();
  });

  it('contains no runtime compiler, download, PATH, shell, PowerShell, PID-tree, or sampled-birth fallback', () => {
    const resolver = fs.readFileSync('src/core/session-host/process-capsule/resolver.ts', 'utf8');
    const runtime = fs.readFileSync('src/core/session-host/process-capsule/native-process-scope.ts', 'utf8');
    const postinstall = fs.readFileSync('scripts/postinstall.js', 'utf8');

    expect(resolver).not.toMatch(/child_process|(?:process|env)\.env?\.PATH|https?:|download|powershell|cargo|rustc|ps\s+lstart/i);
    expect(runtime).not.toMatch(/taskkill|powershell|killProcessTree|ps\s+lstart|shell:\s*true/i);
    expect(runtime).toMatch(/shell:\s*false/g);
    expect(postinstall).not.toMatch(/child_process|process-capsule|cargo|rustc|https?:|download/i);
  });
});
