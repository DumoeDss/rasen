import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MAX_MANIFEST_BYTES = 256 * 1024;
const GIT_OID = /^[a-f0-9]{40,64}$/u;

function runGit(repositoryRoot, args, environment = process.env) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function normalizeRepositoryPath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (
    normalized.length === 0
    || path.posix.isAbsolute(normalized)
    || normalized.split('/').includes('..')
    || normalized.includes('\0')
  ) {
    throw new Error('delivery_manifest_path_invalid');
  }
  return normalized;
}

export function normalizePathManifest(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error('delivery_manifest_schema_invalid');
  }
  const normalized = values.map(normalizeRepositoryPath);
  if (
    new Set(normalized).size !== normalized.length
    || [...normalized].sort().join('\0') !== normalized.join('\0')
  ) {
    throw new Error('delivery_manifest_not_unique_sorted');
  }
  return normalized;
}

export function readPathManifest(filePath) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.size > MAX_MANIFEST_BYTES
    || fs.realpathSync.native(resolved) !== resolved
  ) {
    throw new Error('delivery_manifest_file_invalid');
  }
  return normalizePathManifest(JSON.parse(fs.readFileSync(resolved, 'utf8')));
}

function exactWorktreeFile(repositoryRoot, relativePath) {
  const absolute = path.resolve(repositoryRoot, relativePath);
  if (
    absolute === repositoryRoot
    || !absolute.startsWith(`${repositoryRoot}${path.sep}`)
  ) {
    throw new Error('delivery_manifest_path_escape');
  }
  const stat = fs.lstatSync(absolute);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || fs.realpathSync.native(absolute) !== absolute
  ) {
    throw new Error(`delivery_file_not_regular:${relativePath}`);
  }
  return { absolute, stat };
}

function parseNullPaths(value) {
  return value
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepositoryPath)
    .sort();
}

function baselineMode(repositoryRoot, baselineSha, relativePath) {
  const entry = runGit(
    repositoryRoot,
    ['ls-tree', baselineSha, '--', relativePath]
  ).trim();
  if (entry.length === 0) return '100644';
  const match = /^(100644|100755|120000|160000)\s+\S+\s+[a-f0-9]+\t/u.exec(entry);
  if (match === null || match[1] === '120000' || match[1] === '160000') {
    throw new Error(`delivery_baseline_mode_unsupported:${relativePath}`);
  }
  return match[1];
}

function parseTreeManifest(value) {
  return value
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755)\s+blob\s+([a-f0-9]{40,64})\t(.+)$/u.exec(
        entry
      );
      if (match === null) throw new Error('delivery_tree_entry_invalid');
      return {
        mode: match[1],
        oid: match[2],
        path: normalizeRepositoryPath(match[3]),
      };
    });
}

function fingerprintTreeManifest(entries) {
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.mode, 'utf8');
    hash.update('\0');
    hash.update(entry.oid, 'utf8');
    hash.update('\0');
    hash.update(entry.path, 'utf8');
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function inspectRepositoryChangeSet(repositoryRoot, baselineRef = 'HEAD') {
  const root = fs.realpathSync.native(path.resolve(repositoryRoot));
  const baselineSha = runGit(root, ['rev-parse', '--verify', baselineRef]).trim();
  if (!GIT_OID.test(baselineSha)) throw new Error('delivery_baseline_invalid');
  const trackedWorktree = parseNullPaths(
    runGit(root, ['diff', '--name-only', '-z', baselineSha])
  );
  const staged = parseNullPaths(
    runGit(root, ['diff', '--cached', '--name-only', '-z', baselineSha])
  );
  const untracked = parseNullPaths(
    runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  );
  return {
    repositoryRoot: root,
    baselineSha,
    trackedWorktree,
    staged,
    untracked,
  };
}

export function deriveDeliveryTree(input) {
  const repositoryRoot = fs.realpathSync.native(
    path.resolve(input.repositoryRoot)
  );
  const changedPaths = normalizePathManifest(input.changedPaths);
  const baselineSha = runGit(
    repositoryRoot,
    ['rev-parse', '--verify', input.baselineRef ?? 'HEAD']
  ).trim();
  const baselineTreeOid = runGit(
    repositoryRoot,
    ['rev-parse', `${baselineSha}^{tree}`]
  ).trim();
  if (!GIT_OID.test(baselineSha) || !GIT_OID.test(baselineTreeOid)) {
    throw new Error('delivery_baseline_invalid');
  }
  const actualStaged = parseNullPaths(
    runGit(repositoryRoot, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
      baselineSha,
    ])
  );
  const outsideManifest = actualStaged.filter(
    (entry) => !changedPaths.includes(entry)
  );
  if (outsideManifest.length > 0) {
    throw new Error(
      `staged_path_outside_delivery_manifest:${outsideManifest.join(',')}`
    );
  }

  const temporaryIndex = path.join(
    os.tmpdir(),
    `rasen-delivery-index-${process.pid}-${randomUUID()}`
  );
  const environment = {
    ...process.env,
    GIT_INDEX_FILE: temporaryIndex,
  };
  try {
    runGit(repositoryRoot, ['read-tree', baselineSha], environment);
    for (const relativePath of changedPaths) {
      const { absolute } = exactWorktreeFile(repositoryRoot, relativePath);
      const mode = baselineMode(repositoryRoot, baselineSha, relativePath);
      const oid = runGit(
        repositoryRoot,
        ['hash-object', '-w', '--path', relativePath, '--', absolute],
        environment
      ).trim();
      if (!GIT_OID.test(oid)) throw new Error('delivery_blob_oid_invalid');
      runGit(
        repositoryRoot,
        ['update-index', '--add', '--cacheinfo', `${mode},${oid},${relativePath}`],
        environment
      );
    }
    const treeOid = runGit(repositoryRoot, ['write-tree'], environment).trim();
    if (!GIT_OID.test(treeOid)) throw new Error('delivery_tree_oid_invalid');
    const actualChangedPaths = parseNullPaths(
      runGit(repositoryRoot, [
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        '-z',
        baselineTreeOid,
        treeOid,
      ])
    );
    if (actualChangedPaths.join('\0') !== changedPaths.join('\0')) {
      throw new Error('delivery_manifest_changed_set_mismatch');
    }
    const treeManifest = parseTreeManifest(
      runGit(repositoryRoot, ['ls-tree', '-r', '-z', treeOid])
    );
    const manifestByPath = new Map(
      treeManifest.map((entry) => [entry.path, entry])
    );
    const changedEntries = changedPaths.map((relativePath) => {
      const entry = manifestByPath.get(relativePath);
      if (entry === undefined) {
        throw new Error(`delivery_tree_entry_missing:${relativePath}`);
      }
      return entry;
    });
    return {
      repositoryRoot,
      baselineSha,
      baselineTreeOid,
      treeOid,
      contentFingerprint: fingerprintTreeManifest(treeManifest),
      deliveryManifestFingerprint: fingerprintTreeManifest(changedEntries),
      changedPaths,
      changedEntries,
      treeManifest,
    };
  } finally {
    try {
      fs.unlinkSync(temporaryIndex);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      fs.unlinkSync(`${temporaryIndex}.lock`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export function assertCommitMatchesDeliveryTree(
  repositoryRoot,
  deliverySha,
  expectedTreeOid
) {
  if (!GIT_OID.test(deliverySha) || !GIT_OID.test(expectedTreeOid)) {
    throw new Error('delivery_git_identity_invalid');
  }
  const root = fs.realpathSync.native(path.resolve(repositoryRoot));
  const deliveredTreeOid = runGit(
    root,
    ['rev-parse', '--verify', `${deliverySha}^{tree}`]
  ).trim();
  if (deliveredTreeOid !== expectedTreeOid) {
    throw new Error('delivered_commit_tree_mismatch');
  }
  return deliveredTreeOid;
}
