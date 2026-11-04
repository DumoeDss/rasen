import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('ProcessCapsule artifact integrity and build-input provenance', () => {
  it('exposes an isolated clean-build output seam without changing the production default', () => {
    const source = fs.readFileSync('scripts/build-process-capsule.mjs', 'utf8');
    expect(source).toContain('RASEN_PROCESS_CAPSULE_BUILD_ROOT');
    expect(source).toContain("path.join(buildRoot, 'dist', 'native', 'process-capsule')");
    expect(source).toContain('const includeStaging = buildRoot === root');
  });

  it('records two clean-build digests honestly while each artifact matches its own manifest', () => {
    const builds = [0, 1].map(() => {
      const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-capsule-clean-build-'));
      roots.push(buildRoot);
      execFileSync(process.execPath, ['scripts/build-process-capsule.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, RASEN_PROCESS_CAPSULE_BUILD_ROOT: buildRoot },
        stdio: 'pipe',
        timeout: 60_000,
      });
      const nativeRoot = path.join(buildRoot, 'dist', 'native', 'process-capsule');
      const manifest = JSON.parse(fs.readFileSync(path.join(nativeRoot, 'manifest.json'), 'utf8')) as {
        protocolVersion: number;
        artifacts: Array<{
          path: string;
          length: number;
          sha256: string;
          compiler: string;
          sourceSha256: string;
        }>;
      };
      expect(manifest.protocolVersion).toBe(2);
      expect(manifest.artifacts).toHaveLength(1);
      const artifact = manifest.artifacts[0];
      const helper = path.join(buildRoot, ...artifact.path.split('/'));
      const bytes = fs.readFileSync(helper);
      expect(bytes.length).toBe(artifact.length);
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
      expect(artifact.compiler).toMatch(/^rustc /);
      expect(artifact.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
      return artifact;
    });

    expect(builds[0].compiler).toBe(builds[1].compiler);
    expect(builds[0].sourceSha256).toBe(builds[1].sourceSha256);
    console.info(
      `ProcessCapsule clean-build digests: ${builds[0].sha256} ${builds[1].sha256} equal=${String(builds[0].sha256 === builds[1].sha256)}`,
    );
    const authoritative = [
      'docs/session-host.md',
      'scripts/build-process-capsule.mjs',
      'src/core/session-host/process-capsule/resolver.ts',
    ].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(authoritative).not.toMatch(
      /(?:guarantee|guaranteed|proves?|is|are).{0,50}(?:byte[- ]reproducible|reproducible bytes|deterministic(?:ally)? rebuild)/i,
    );
  }, 120_000);
});
