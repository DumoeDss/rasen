#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  assertCommitMatchesDeliveryTree,
} from './delivery-candidate.mjs';
import { auditRepositoryOwnership } from './ownership-audit.mjs';
import {
  hashExactFileSet,
  sha256File,
} from './physical-preflight.mjs';
import {
  authorizeParentDelivery,
  finalizeAcceptanceAttempt,
  readAttemptIntent,
  readJsonBounded,
  recordParentDelivery,
  writeJsonAtomic,
} from './protocol.mjs';

const FREEZE_SCHEMA = 'rasen-session-cache-delivery-freeze/1';

function runGit(repositoryRoot, args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  }).trim();
}

function binaryFiles(repositoryRoot) {
  const files = ['bin/rasen.js', 'package.json'];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.relative(repositoryRoot, absolute).replace(/\\/gu, '/'));
      }
    }
  };
  walk(path.join(repositoryRoot, 'dist'));
  return files.sort();
}

function normalizeGithubRemote(remote) {
  let host;
  let repository;
  if (/^git@[^:]+:.+\.git$/u.test(remote)) {
    const match = /^git@([^:]+):(.+)$/u.exec(remote);
    host = match?.[1];
    repository = match?.[2]?.replace(/\.git$/u, '');
  } else {
    const parsed = new URL(remote);
    if (!['https:', 'ssh:'].includes(parsed.protocol)) {
      throw new Error('delivery_remote_protocol_invalid');
    }
    host = parsed.hostname;
    repository = parsed.pathname.replace(/^\/|\.git$/gu, '');
  }
  if (
    typeof host !== 'string'
    || typeof repository !== 'string'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
  ) {
    throw new Error('delivery_remote_identity_invalid');
  }
  return {
    repository,
    githubOrigin: `https://${host}`,
  };
}

function freezePath(workDir) {
  return path.join(path.resolve(workDir), 'delivery-freeze.json');
}

function deriveControlledState(input) {
  const repositoryRoot = fs.realpathSync.native(
    path.resolve(input.repositoryRoot)
  );
  const audit = auditRepositoryOwnership({
    repositoryRoot,
    baselineRef: input.baselineRef ?? 'HEAD',
    ownershipManifestPath: fs.realpathSync.native(
      path.resolve(input.ownershipManifestPath)
    ),
    deliveryManifestPath: fs.realpathSync.native(
      path.resolve(input.deliveryManifestPath)
    ),
  });
  const ownershipManifestPath = fs.realpathSync.native(
    path.resolve(input.ownershipManifestPath)
  );
  const deliveryManifestPath = fs.realpathSync.native(
    path.resolve(input.deliveryManifestPath)
  );
  const listedBinaryFiles = binaryFiles(repositoryRoot);
  const candidate = {
    contentFingerprint: audit.contentFingerprint,
    binaryFingerprint: hashExactFileSet(repositoryRoot, listedBinaryFiles),
    repositoryRoot,
    createdAt: input.candidateCreatedAt ?? new Date().toISOString(),
    baselineSha: audit.baselineSha,
    treeOid: audit.treeOid,
    deliveryManifestFingerprint: audit.deliveryManifestFingerprint,
  };
  return {
    audit,
    candidate,
    binaryFiles: listedBinaryFiles,
    controlledInputs: {
      repositoryRoot,
      baselineSha: audit.baselineSha,
      ownershipManifestPath,
      ownershipManifestFingerprint: sha256File(ownershipManifestPath),
      deliveryManifestPath,
      deliveryManifestFileFingerprint: sha256File(deliveryManifestPath),
    },
  };
}

function sameCandidateIdentity(left, right) {
  return (
    left.contentFingerprint === right.contentFingerprint
    && left.binaryFingerprint === right.binaryFingerprint
    && fs.realpathSync.native(path.resolve(left.repositoryRoot))
      === fs.realpathSync.native(path.resolve(right.repositoryRoot))
    && left.baselineSha === right.baselineSha
    && left.treeOid === right.treeOid
    && left.deliveryManifestFingerprint
      === right.deliveryManifestFingerprint
    && left.createdAt === right.createdAt
  );
}

export async function freezeParentDeliveryCandidate(input) {
  const workDir = path.resolve(input.workDir);
  fs.mkdirSync(workDir, { recursive: true });
  const existing = fs.existsSync(freezePath(workDir))
    ? readJsonBounded(freezePath(workDir), 1024 * 1024)
    : null;
  const derived = deriveControlledState({
    ...input,
    candidateCreatedAt:
      existing?.candidate?.createdAt ?? input.candidateCreatedAt,
  });
  const record = {
    schema: FREEZE_SCHEMA,
    candidate: derived.candidate,
    ownershipPaths: derived.audit.ownershipPaths,
    deliveryPaths: derived.audit.deliveryPaths,
    excludedUntracked: derived.audit.excludedUntracked,
    binaryFiles: derived.binaryFiles,
    controlledInputs: derived.controlledInputs,
    frozenAt: new Date().toISOString(),
  };
  if (existing !== null) {
    if (!sameCandidateIdentity(existing.candidate, record.candidate)) {
      throw new Error('delivery_freeze_already_exists');
    }
    return existing;
  }
  writeJsonAtomic(freezePath(workDir), record);
  return record;
}

export function finalizeControlledAcceptanceAttempt(input) {
  const { frozen } = assertControlledFreezeUnchanged(input);
  const intent = readAttemptIntent(input.workDir, input.attemptId);
  if (!sameCandidateIdentity(intent.candidate, frozen.candidate)) {
    throw new Error('selected_attempt_candidate_mismatch');
  }
  return finalizeAcceptanceAttempt(input.workDir, input.attemptId);
}

function assertControlledFreezeUnchanged(input) {
  const frozen = readJsonBounded(freezePath(input.workDir), 1024 * 1024);
  if (frozen?.schema !== FREEZE_SCHEMA) {
    throw new Error('delivery_freeze_record_invalid');
  }
  if (
    frozen.controlledInputs === null
    || typeof frozen.controlledInputs !== 'object'
    || fs.realpathSync.native(path.resolve(input.repositoryRoot))
      !== frozen.controlledInputs.repositoryRoot
    || (
      input.ownershipManifestPath !== undefined
      && fs.realpathSync.native(path.resolve(input.ownershipManifestPath))
        !== frozen.controlledInputs.ownershipManifestPath
    )
    || (
      input.deliveryManifestPath !== undefined
      && fs.realpathSync.native(path.resolve(input.deliveryManifestPath))
        !== frozen.controlledInputs.deliveryManifestPath
    )
    || (
      input.baselineRef !== undefined
      && runGit(frozen.controlledInputs.repositoryRoot, [
        'rev-parse',
        '--verify',
        input.baselineRef,
      ]) !== frozen.controlledInputs.baselineSha
    )
  ) {
    throw new Error('delivery_freeze_controlled_input_mismatch');
  }
  const derived = deriveControlledState({
    repositoryRoot: frozen.controlledInputs.repositoryRoot,
    baselineRef: frozen.controlledInputs.baselineSha,
    ownershipManifestPath: frozen.controlledInputs.ownershipManifestPath,
    deliveryManifestPath: frozen.controlledInputs.deliveryManifestPath,
    candidateCreatedAt: frozen.candidate.createdAt,
  });
  if (
    !sameCandidateIdentity(derived.candidate, frozen.candidate)
    || JSON.stringify(derived.controlledInputs)
      !== JSON.stringify(frozen.controlledInputs)
    || JSON.stringify(derived.binaryFiles)
      !== JSON.stringify(frozen.binaryFiles)
    || JSON.stringify(derived.audit.ownershipPaths)
      !== JSON.stringify(frozen.ownershipPaths)
    || JSON.stringify(derived.audit.deliveryPaths)
      !== JSON.stringify(frozen.deliveryPaths)
  ) {
    throw new Error('repository_changed_after_freeze');
  }
  return { frozen, derived };
}

export function authorizeControlledParentDelivery(input) {
  const { frozen } = assertControlledFreezeUnchanged(input);
  const remote = normalizeGithubRemote(
    runGit(path.resolve(input.repositoryRoot), ['remote', 'get-url', 'origin'])
  );
  return authorizeParentDelivery(input.workDir, {
    authorizer: input.authorizer,
    deliveryMode: input.deliveryMode,
    frozenTreeFingerprint: frozen.candidate.contentFingerprint,
    frozenTreeOid: frozen.candidate.treeOid,
    repository: remote.repository,
    githubOrigin: remote.githubOrigin,
  });
}

export function recordControlledParentDelivery(input) {
  const { frozen } = assertControlledFreezeUnchanged(input);
  assertCommitMatchesDeliveryTree(
    input.repositoryRoot,
    input.deliverySha,
    frozen.candidate.treeOid
  );
  return recordParentDelivery(input.workDir, {
    currentTreeFingerprint: frozen.candidate.contentFingerprint,
    currentTreeOid: frozen.candidate.treeOid,
    deliveredSha: input.deliverySha,
  });
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required ${name}`);
  }
  if (index + 1 >= process.argv.length) throw new Error(`Missing value for ${name}`);
  return process.argv[index + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.RASEN_SESSION_CACHE_PARENT_CONTROLLED !== '1') {
    throw new Error(
      'Set RASEN_SESSION_CACHE_PARENT_CONTROLLED=1 for the parent-only delivery entrypoint.'
    );
  }
  const repositoryRoot = path.resolve(option('--repository-root', process.cwd()));
  const changeRoot = path.join(
    repositoryRoot,
    'rasen',
    'changes',
    'session-cache-optimization-acceptance-evidence'
  );
  const common = {
    repositoryRoot,
    workDir: path.resolve(option('--work-dir')),
    ownershipManifestPath: path.resolve(
      option('--ownership-manifest', path.join(changeRoot, 'ownership-manifest.json'))
    ),
    deliveryManifestPath: path.resolve(
      option('--delivery-manifest', path.join(changeRoot, 'delivery-manifest.json'))
    ),
  };
  let result;
  if (process.argv.includes('--freeze')) {
    result = await freezeParentDeliveryCandidate({
      ...common,
      baselineRef: option('--baseline-ref', 'HEAD'),
    });
  } else if (process.argv.includes('--authorize')) {
    result = authorizeControlledParentDelivery({
      ...common,
      authorizer: option('--authorizer'),
      deliveryMode: option('--delivery-mode'),
    });
  } else if (process.argv.includes('--record-delivery')) {
    result = recordControlledParentDelivery({
      ...common,
      deliverySha: option('--delivery-sha'),
    });
  } else if (process.argv.includes('--finalize-attempt')) {
    result = finalizeControlledAcceptanceAttempt({
      ...common,
      attemptId: option('--attempt-id'),
    });
  } else {
    throw new Error(
      'Choose exactly one of --freeze, --finalize-attempt, --authorize, --record-delivery.'
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      schema: 'rasen-session-cache-parent-delivery-command/1',
      candidateFingerprint:
        result.candidate?.contentFingerprint
        ?? result.authorization?.frozenTreeFingerprint,
      state:
        result.selectedAttemptId === undefined
          ? result.authorization?.state ?? 'frozen'
          : 'physical_finalized',
      selectedAttemptId: result.selectedAttemptId ?? null,
    })}\n`
  );
}
