#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const crate = path.join(root, 'native', 'process-capsule');
const buildRoot = process.env.RASEN_PROCESS_CAPSULE_BUILD_ROOT
  ? path.resolve(process.env.RASEN_PROCESS_CAPSULE_BUILD_ROOT)
  : root;
const outputRoot = path.join(buildRoot, 'dist', 'native', 'process-capsule');
const stagingRoot = path.join(root, '.native-helper-staging');
const includeStaging = buildRoot === root;
const executableName = process.platform === 'win32'
  ? 'rasen-process-capsule.exe'
  : 'rasen-process-capsule';
const platformArch = `${process.platform}-${process.arch}`;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-process-capsule-build-'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceDigest() {
  const files = [
    'Cargo.toml',
    'Cargo.lock',
    ...fs.readdirSync(path.join(crate, 'src')).map((name) => `src/${name}`),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(crate, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function artifactEntry(helperPath, platform = process.platform, arch = process.arch, extra = {}) {
  const bytes = fs.readFileSync(helperPath);
  return {
    ...extra,
    platform,
    arch,
    path: `dist/native/process-capsule/${platform}-${arch}/${path.basename(helperPath)}`,
    length: bytes.length,
    sha256: sha256(bytes),
    provenance: 'build-inputs',
    capabilities: [
      'opaque-ref',
      'publish-before-activate',
      'exact-process-birth',
      'root-exit-scope-empty-v2',
      ...(platform === 'win32' ? ['unnamed-job-kill-on-close'] : []),
      ...(platform === 'linux' ? ['pidfd', 'process-group'] : []),
      ...(platform === 'darwin' ? ['proc-unique-birth', 'process-group'] : []),
    ],
  };
}

try {
  const rustc = execFileSync('rustc', ['--version', '--verbose'], { encoding: 'utf8' }).trim();
  execFileSync('cargo', [
    'build',
    '--locked',
    '--release',
    '--manifest-path',
    path.join(crate, 'Cargo.toml'),
    '--target-dir',
    tempRoot,
  ], { stdio: 'inherit', cwd: root });
  const built = path.join(tempRoot, 'release', executableName);
  const destinationDirectory = path.join(outputRoot, platformArch);
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, executableName);
  fs.copyFileSync(built, destination);
  if (process.platform !== 'win32') fs.chmodSync(destination, 0o755);

  const artifacts = [artifactEntry(destination, process.platform, process.arch, {
    compiler: rustc.split('\n')[0],
    sourceSha256: sourceDigest(),
  })];

  if (includeStaging && fs.existsSync(stagingRoot)) {
    for (const directory of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const match = /^(win32|linux|darwin)-(x64|arm64)$/.exec(directory.name);
      if (!match || directory.name === platformArch) continue;
      const stagedName = match[1] === 'win32'
        ? 'rasen-process-capsule.exe'
        : 'rasen-process-capsule';
      const staged = path.join(stagingRoot, directory.name, stagedName);
      if (!fs.statSync(staged).isFile()) throw new Error(`invalid staged helper ${staged}`);
      const targetDirectory = path.join(outputRoot, directory.name);
      fs.mkdirSync(targetDirectory, { recursive: true });
      const target = path.join(targetDirectory, stagedName);
      fs.copyFileSync(staged, target);
      if (match[1] !== 'win32') fs.chmodSync(target, 0o755);
      const provenancePath = path.join(stagingRoot, directory.name, 'provenance.json');
      const provenance = fs.existsSync(provenancePath)
        ? JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
        : {};
      if (
        typeof provenance.compiler !== 'string' ||
        provenance.sourceSha256 !== sourceDigest()
      ) {
        throw new Error(`invalid staged helper provenance ${provenancePath}`);
      }
      artifacts.push(artifactEntry(target, match[1], match[2], {
        compiler: provenance.compiler,
        sourceSha256: provenance.sourceSha256,
      }));
    }
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
    schema: 'rasen-process-capsule-manifest/1',
    protocolVersion: 2,
    generatedBy: 'scripts/build-process-capsule.mjs',
    artifacts: artifacts.sort((a, b) =>
      `${a.platform}-${a.arch}`.localeCompare(`${b.platform}-${b.arch}`)),
  }, null, 2)}\n`);

  const exportRoot = process.env.RASEN_PROCESS_CAPSULE_EXPORT_DIR;
  if (exportRoot) {
    const exportDirectory = path.resolve(root, exportRoot, platformArch);
    fs.mkdirSync(exportDirectory, { recursive: true });
    fs.copyFileSync(destination, path.join(exportDirectory, executableName));
    fs.writeFileSync(path.join(exportDirectory, 'provenance.json'), `${JSON.stringify({
      compiler: rustc.split('\n')[0],
      sourceSha256: sourceDigest(),
    }, null, 2)}\n`);
  }
  console.log(`built ProcessCapsule ${platformArch} (${artifacts[0].sha256})`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
