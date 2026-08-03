import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  authorizeControlledPreE1DraftPr,
  freezeParentDeliveryCandidate,
  recordControlledPreE1DraftPr,
} from '../../../scripts/session-cache-acceptance/parent-delivery.mjs';
import {
  readPreE1DraftPr,
} from '../../../scripts/session-cache-acceptance/protocol.mjs';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const temporaryRoots: string[] = [];

function temporaryDirectory(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(directory);
  return fs.realpathSync.native(directory);
}

function git(repositoryRoot: string, args: string[]) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function createRepository() {
  const repositoryRoot = temporaryDirectory('rasen-pre-e1-repository-');
  const workDir = temporaryDirectory('rasen-pre-e1-evidence-');
  git(repositoryRoot, ['init']);
  git(repositoryRoot, ['config', 'user.name', 'Rasen Test']);
  git(repositoryRoot, ['config', 'user.email', 'rasen@example.invalid']);
  git(repositoryRoot, ['checkout', '-b', 'feat/session-cache-optimization']);
  git(repositoryRoot, [
    'remote',
    'add',
    'origin',
    'https://github.com/example/repository.git',
  ]);
  for (const relative of ['bin', 'dist']) {
    fs.mkdirSync(path.join(repositoryRoot, relative), { recursive: true });
  }
  fs.writeFileSync(path.join(repositoryRoot, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(repositoryRoot, 'bin', 'rasen.js'), 'export {};\n');
  fs.writeFileSync(path.join(repositoryRoot, 'dist', 'index.js'), 'export {};\n');
  git(repositoryRoot, ['add', 'package.json', 'bin/rasen.js', 'dist/index.js']);
  git(repositoryRoot, ['commit', '-m', 'test: create baseline']);

  const deliveryPath =
    'rasen/changes/session-cache-optimization/planning-context.md';
  fs.mkdirSync(path.dirname(path.join(repositoryRoot, deliveryPath)), {
    recursive: true,
  });
  fs.writeFileSync(path.join(repositoryRoot, deliveryPath), '# Portfolio\n');
  git(repositoryRoot, ['add', deliveryPath]);

  const ownershipManifestPath = path.join(workDir, 'ownership.json');
  const deliveryManifestPath = path.join(workDir, 'delivery.json');
  fs.writeFileSync(ownershipManifestPath, '[]\n');
  fs.writeFileSync(
    deliveryManifestPath,
    `${JSON.stringify([deliveryPath], null, 2)}\n`
  );
  return {
    repositoryRoot,
    workDir,
    ownershipManifestPath,
    deliveryManifestPath,
    deliveryPath,
  };
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    await cleanupTempPathAsync(temporaryRoots.pop()!);
  }
});

describe('controlled parent draft PR delivery', () => {
  it('authorizes one review-only Draft PR and records its exact frozen tree', async () => {
    const fixture = createRepository();
    const common = {
      repositoryRoot: fixture.repositoryRoot,
      workDir: fixture.workDir,
      ownershipManifestPath: fixture.ownershipManifestPath,
      deliveryManifestPath: fixture.deliveryManifestPath,
    };
    const frozen = await freezeParentDeliveryCandidate(common);
    expect(authorizeControlledPreE1DraftPr({
      ...common,
      authorizer: 'portfolio-owner',
      baseBranch: 'dev/0.2.0',
    })).toMatchObject({
      state: 'authorized',
      remoteMutationAllowed: true,
      branch: 'feat/session-cache-optimization',
      baseBranch: 'dev/0.2.0',
      candidateFingerprint: frozen.candidate.contentFingerprint,
      frozenTreeOid: frozen.candidate.treeOid,
    });

    git(fixture.repositoryRoot, ['commit', '-m', 'docs: finalize portfolio']);
    const headSha = git(fixture.repositoryRoot, ['rev-parse', 'HEAD']);
    expect(recordControlledPreE1DraftPr({
      ...common,
      deliverySha: headSha,
      prNumber: 132,
      prUrl: 'https://github.com/example/repository/pull/132',
    })).toMatchObject({
      state: 'published',
      remoteMutationAllowed: false,
      isDraft: true,
      headSha,
    });
    expect(readPreE1DraftPr(fixture.workDir)).toMatchObject({
      state: 'published',
      headSha,
    });
  });
});
