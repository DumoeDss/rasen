#!/usr/bin/env node

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  deriveDeliveryTree,
  inspectRepositoryChangeSet,
  readPathManifest,
} from './delivery-candidate.mjs';
import {
  auditAcceptanceOwnership,
  isAcceptanceOwnedPath,
} from './protocol.mjs';

const KNOWN_EXCLUDED_UNTRACKED = new Set([
  'packages/ui/package-lock.json',
]);
const PARENT_OWNED_DELIVERY_PATHS = new Set([
  'rasen/changes/session-cache-optimization/.openspec.yaml',
  'rasen/changes/session-cache-optimization/decomposition-plan.md',
  'rasen/changes/session-cache-optimization/planning-context.md',
]);

function samePaths(left, right) {
  return [...left].sort().join('\0') === [...right].sort().join('\0');
}

export function auditRepositoryOwnership(input) {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const ownershipPaths = readPathManifest(input.ownershipManifestPath);
  const deliveryPaths = readPathManifest(input.deliveryManifestPath);
  const changes = inspectRepositoryChangeSet(
    repositoryRoot,
    input.baselineRef ?? 'HEAD'
  );
  const forbiddenStaged = changes.staged.filter(
    (candidate) =>
      KNOWN_EXCLUDED_UNTRACKED.has(candidate)
      || !deliveryPaths.includes(candidate)
  );
  if (forbiddenStaged.length > 0) {
    throw new Error(
      `ownership_forbidden_staged_path:${forbiddenStaged.join(',')}`
    );
  }
  const excludedUntracked = changes.untracked.filter((candidate) =>
    KNOWN_EXCLUDED_UNTRACKED.has(candidate)
  );
  const actualChanged = [
    ...new Set([
      ...changes.trackedWorktree,
      ...changes.untracked.filter(
        (candidate) => !KNOWN_EXCLUDED_UNTRACKED.has(candidate)
      ),
    ]),
  ].sort();
  if (!samePaths(actualChanged, deliveryPaths)) {
    throw new Error('ownership_delivery_manifest_changed_set_mismatch');
  }
  const derivedOwnershipPaths = deliveryPaths.filter(isAcceptanceOwnedPath);
  const unclassified = deliveryPaths.filter(
    (candidate) =>
      !isAcceptanceOwnedPath(candidate)
      && !PARENT_OWNED_DELIVERY_PATHS.has(candidate)
  );
  if (unclassified.length > 0) {
    throw new Error(`ownership_unclassified_delivery_path:${unclassified.join(',')}`);
  }
  if (!samePaths(derivedOwnershipPaths, ownershipPaths)) {
    throw new Error('ownership_manifest_exact_set_mismatch');
  }
  auditAcceptanceOwnership(ownershipPaths);
  const delivery = deriveDeliveryTree({
    repositoryRoot,
    baselineRef: changes.baselineSha,
    changedPaths: deliveryPaths,
  });
  return {
    ok: true,
    baselineSha: changes.baselineSha,
    treeOid: delivery.treeOid,
    contentFingerprint: delivery.contentFingerprint,
    deliveryManifestFingerprint: delivery.deliveryManifestFingerprint,
    ownershipPaths,
    deliveryPaths,
    excludedUntracked,
  };
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
  const repositoryRoot = path.resolve(option('--repository-root', process.cwd()));
  const changeRoot = path.join(
    repositoryRoot,
    'rasen',
    'changes',
    'session-cache-optimization-acceptance-evidence'
  );
  const result = auditRepositoryOwnership({
    repositoryRoot,
    baselineRef: option('--baseline-ref', 'HEAD'),
    ownershipManifestPath: option(
      '--ownership-manifest',
      path.join(changeRoot, 'ownership-manifest.json')
    ),
    deliveryManifestPath: option(
      '--delivery-manifest',
      path.join(changeRoot, 'delivery-manifest.json')
    ),
  });
  process.stdout.write(
    `${JSON.stringify({
      schema: 'rasen-session-cache-ownership-audit/2',
      ok: result.ok,
      baselineSha: result.baselineSha,
      treeOid: result.treeOid,
      ownershipPathCount: result.ownershipPaths.length,
      deliveryPathCount: result.deliveryPaths.length,
      excludedUntracked: result.excludedUntracked,
    })}\n`
  );
}
