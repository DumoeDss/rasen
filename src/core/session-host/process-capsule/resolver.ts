import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { ProcessScopeError } from '../process-scope.js';

export const PROCESS_CAPSULE_PROTOCOL_VERSION = 2 as const;
export const PROCESS_CAPSULE_PROTOCOL_CAPABILITY = 'root-exit-scope-empty-v2' as const;
export const PROCESS_CAPSULE_MANIFEST_SCHEMA = 'rasen-process-capsule-manifest/1' as const;
const REQUIRED_CAPABILITIES = [
  'opaque-ref',
  'publish-before-activate',
  'exact-process-birth',
  PROCESS_CAPSULE_PROTOCOL_CAPABILITY,
] as const;

interface ProcessCapsuleArtifact {
  platform: NodeJS.Platform;
  arch: string;
  path: string;
  length: number;
  sha256: string;
  capabilities: string[];
  provenance: 'build-inputs';
  compiler: string;
  sourceSha256: string;
}

interface ProcessCapsuleManifest {
  schema: typeof PROCESS_CAPSULE_MANIFEST_SCHEMA;
  protocolVersion: typeof PROCESS_CAPSULE_PROTOCOL_VERSION;
  artifacts: ProcessCapsuleArtifact[];
  generatedBy?: string;
}

export interface ResolvedProcessCapsule {
  helperPath: string;
  protocolVersion: typeof PROCESS_CAPSULE_PROTOCOL_VERSION;
  artifact: Readonly<ProcessCapsuleArtifact>;
}

export interface ResolvePackagedProcessCapsuleOptions {
  packageRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

function defaultPackageRoot(): string {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(directory, '..', '..', '..', '..');
}

function fail(message: string): never {
  throw new ProcessScopeError('helper-integrity-failed', message);
}

function parseManifest(content: string): ProcessCapsuleManifest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new ProcessScopeError('helper-integrity-failed', 'ProcessCapsule manifest is malformed.', {
      cause: error,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ProcessCapsule manifest is invalid.');
  const manifest = value as Partial<ProcessCapsuleManifest>;
  if (
    manifest.schema !== PROCESS_CAPSULE_MANIFEST_SCHEMA ||
    manifest.protocolVersion !== PROCESS_CAPSULE_PROTOCOL_VERSION ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length === 0 ||
    manifest.artifacts.length > 8 ||
    Object.keys(value).some((key) => !['schema', 'protocolVersion', 'generatedBy', 'artifacts'].includes(key))
  ) {
    fail('ProcessCapsule manifest schema or protocol does not match this runtime.');
  }
  const identities = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      fail('ProcessCapsule artifact declaration is invalid.');
    }
    if (Object.keys(artifact).some((key) => ![
      'platform', 'arch', 'path', 'length', 'sha256', 'capabilities', 'compiler', 'sourceSha256',
      'provenance',
    ].includes(key))) {
      fail('ProcessCapsule artifact declaration contains unknown fields.');
    }
    const item = artifact as ProcessCapsuleArtifact;
    const identity = `${item.platform}-${item.arch}`;
    if (
      !['win32', 'linux', 'darwin'].includes(item.platform) ||
      !['x64', 'arm64'].includes(item.arch) ||
      identities.has(identity) ||
      item.provenance !== 'build-inputs' ||
      typeof item.compiler !== 'string' ||
      item.compiler.length === 0 ||
      !/^[a-f0-9]{64}$/.test(item.sourceSha256)
    ) {
      fail('ProcessCapsule artifact identity or provenance is invalid.');
    }
    identities.add(identity);
  }
  return manifest as ProcessCapsuleManifest;
}

export function resolvePackagedProcessCapsule(
  options: ResolvePackagedProcessCapsuleOptions = {}
): ResolvedProcessCapsule {
  const packageRoot = fs.realpathSync.native(path.resolve(options.packageRoot ?? defaultPackageRoot()));
  const sourceNativeRoot = path.join(packageRoot, 'native', 'process-capsule');
  const builtNativeRoot = path.join(packageRoot, 'dist', 'native', 'process-capsule');
  const nativeRoot = fs.existsSync(path.join(sourceNativeRoot, 'manifest.json'))
    ? sourceNativeRoot
    : builtNativeRoot;
  const manifestPath = path.join(nativeRoot, 'manifest.json');
  let manifest: ProcessCapsuleManifest;
  try {
    if (fs.lstatSync(manifestPath).isSymbolicLink()) {
      fail('ProcessCapsule manifest must not be a symbolic link.');
    }
    manifest = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error instanceof ProcessScopeError) throw error;
    throw new ProcessScopeError('helper-integrity-failed', 'Packaged ProcessCapsule manifest is unavailable.', {
      cause: error,
    });
  }
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const artifact = manifest.artifacts.find((item) => item.platform === platform && item.arch === arch);
  if (!artifact) fail(`No packaged ProcessCapsule exists for ${platform}-${arch}.`);
  if (
    typeof artifact.path !== 'string' ||
    path.isAbsolute(artifact.path) ||
    !Number.isInteger(artifact.length) ||
    artifact.length <= 0 ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !Array.isArray(artifact.capabilities) ||
    artifact.capabilities.some((capability) => typeof capability !== 'string') ||
    REQUIRED_CAPABILITIES.some((capability) => !artifact.capabilities.includes(capability)) ||
    (platform === 'win32' && !artifact.capabilities.includes('unnamed-job-kill-on-close')) ||
    (platform === 'linux' && (!artifact.capabilities.includes('pidfd') || !artifact.capabilities.includes('process-group'))) ||
    (platform === 'darwin' && (!artifact.capabilities.includes('proc-unique-birth') || !artifact.capabilities.includes('process-group')))
  ) {
    fail('ProcessCapsule artifact declaration is invalid or lacks required capabilities.');
  }
  const declared = path.resolve(packageRoot, ...artifact.path.split('/'));
  const relative = path.relative(nativeRoot, declared);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('ProcessCapsule artifact escapes its adjacent package directory.');
  let helperPath: string;
  let stat: fs.Stats;
  try {
    const declaredStat = fs.lstatSync(declared);
    if (declaredStat.isSymbolicLink()) fail('ProcessCapsule artifact must not be a symbolic link.');
    helperPath = fs.realpathSync.native(declared);
    const realNativeRoot = fs.realpathSync.native(nativeRoot);
    const realRelative = path.relative(realNativeRoot, helperPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      fail('ProcessCapsule artifact resolves outside its adjacent package directory.');
    }
    stat = fs.statSync(helperPath);
  } catch (error) {
    if (error instanceof ProcessScopeError) throw error;
    throw new ProcessScopeError('helper-integrity-failed', 'Packaged ProcessCapsule artifact is unavailable.', {
      cause: error,
    });
  }
  if (!stat.isFile() || stat.size !== artifact.length) fail('ProcessCapsule artifact length does not match its manifest.');
  const digest = createHash('sha256').update(fs.readFileSync(helperPath)).digest('hex');
  if (digest !== artifact.sha256) fail('ProcessCapsule artifact hash does not match its manifest.');
  return { helperPath, protocolVersion: PROCESS_CAPSULE_PROTOCOL_VERSION, artifact };
}
