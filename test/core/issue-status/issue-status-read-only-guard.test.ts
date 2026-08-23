/**
 * The source guard for `src/core/issue-status/**`, in the
 * `store-query-read-only-guard` family, plus the behavioral half of the claim:
 * a status projection mutates NOTHING on disk — Issue records, Execution Plan
 * revisions, and Change run-state files stay byte-identical across a read.
 *
 * The projection composes the Store query with machine-local run-state; the
 * moment it writes anything it becomes a second mutable truth, which is the
 * exact failure mode the "derived on read, persisted nowhere" requirement
 * exists to prevent. Asserted over the real sources AND over real bytes, so
 * neither claim survives by convention.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
  type ExecutionPlanNodeInput,
} from '../../../src/core/store/issues/index.js';
import { StoreQueryModuleImpl } from '../../../src/core/store/query/index.js';
import { writeRunState } from '../../../src/core/pipeline-registry/run-state.js';
import { ephemeraDir } from '../../../src/core/file-placement.js';
import { projectIssueStatus, deriveIssueReadySet, deriveIssueAttention, deriveIssueDeliveryEvidence } from '../../../src/core/issue-status/index.js';
import { readIssueAcceptanceFacts } from '../../../src/core/issue-acceptance/index.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const ISSUE_STATUS_DIR = path.join(REPO_ROOT, 'src', 'core', 'issue-status');

function sourceFiles(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(target));
    else if (entry.name.endsWith('.ts')) found.push(target);
  }
  return found.sort();
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

/** Strips block and line comments so a docblock naming a verb is not a hit. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

/** Every Git verb with an effect. The projection's Git verb set is EMPTY. */
const FORBIDDEN_GIT_VERBS: readonly string[] = [
  'worktree',
  'merge',
  'rebase',
  'reset',
  'checkout',
  'switch',
  'branch',
  'commit',
  'add',
  'fetch',
  'pull',
  'push',
  'clone',
  'tag',
  'stash',
  'update-ref',
];

describe('The issue-status Module has no write surface', () => {
  const files = sourceFiles(ISSUE_STATUS_DIR);

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('covers the ready-set derivation module (issue-ready-set-scheduling)', () => {
    // The derivation is a projection post-pass, so it inherits every scan
    // above only if it is actually IN the walked set — this row pins its
    // presence so a rename cannot quietly drop it out of the guard.
    expect(files.map(file => path.basename(file))).toContain('ready-set.ts');
  });

  it('covers the attention derivation module (issue-needs-attention)', () => {
    // Same reasoning as the ready-set row: the attention post-pass inherits
    // the write-surface scans only by being in the walked set.
    expect(files.map(file => path.basename(file))).toContain('attention.ts');
  });

  it('covers the delivery derivation module (issue-delivery-evidence-rollup)', () => {
    // Same reasoning again: the delivery post-pass inherits the write-surface
    // scans only by being in the walked set.
    expect(files.map(file => path.basename(file))).toContain('delivery.ts');
  });

  it('calls no filesystem write function', () => {
    for (const file of files) {
      const text = code(read(file));
      for (const forbidden of [
        'writeFile',
        'writeText',
        'appendFile',
        'mkdir',
        'mkdirp',
        'unlink',
        'rmdir',
        'rename',
        'copyFile',
        'writeJson',
        'writeRunState',
        'writePortfolioState',
        'fs.rm(',
        'rmSync',
        'truncate',
      ]) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not call ${forbidden}`
        ).not.toContain(forbidden);
      }
    }
  });

  it('names no Git verb with an effect and spawns no process', () => {
    for (const file of files) {
      const text = code(read(file));
      for (const verb of FORBIDDEN_GIT_VERBS) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not name the '${verb}' Git verb`
        ).not.toMatch(new RegExp(`['"\`]${verb}['"\`]`, 'u'));
      }
      for (const forbidden of ['child_process', 'execFile', 'spawn(']) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not spawn a process`
        ).not.toContain(forbidden);
      }
    }
  });

  it('imports the run-state readers read-only, never the writers', () => {
    for (const file of files) {
      const text = code(read(file));
      const pipelineImports = /from\s+'\.\.\/pipeline-registry\/([a-z-]+)\.js'/gu;
      for (const match of text.matchAll(pipelineImports)) {
        expect(['run-state', 'portfolio-state']).toContain(match[1]);
      }
      // The writer functions are the exact surface that would turn the
      // projection into a second mutable truth.
      expect(text).not.toMatch(/\bwriteRunState\b|\bwritePortfolioState\b/u);
    }
  });
});

describe('A status projection mutates nothing on disk', () => {
  let f: StoreWorkspaceFixture;
  const NOW = '2026-08-07T00:00:00.000Z';
  const LINE = 'main';
  const PROJECT = 'app-a';
  const ISSUE = 'iss-guard';

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-guard-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  /** sha256 of every file under a root, keyed by the path relative to it. */
  function digestTree(root: string): Map<string, string> {
    const digests = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(target);
        else {
          digests.set(
            path.relative(root, target),
            createHash('sha256').update(fs.readFileSync(target)).digest('hex')
          );
        }
      }
    };
    walk(root);
    return digests;
  }

  it('leaves Issue records, plan revisions, and run-state byte-identical', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-a',
      instanceSeed: 'a1'.repeat(16),
    });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'seed child-a']);

    const issues = new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
    const scope = {
      store: f.storeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
    };
    await issues.create({ ...scope, issueId: ISSUE, title: 'Guard issue' });
    const nodes: readonly ExecutionPlanNodeInput[] = [
      {
        nodeId: 'g-001',
        kind: 'change',
        projectId: PROJECT,
        targetLineId: LINE,
        changeInstanceId: seeded.instanceId,
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ];
    await issues.publishPlan({ ...scope, issueId: ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);

    const execRoot = f.beside('exec');
    writeRunState(ephemeraDir(execRoot, 'child-a'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });

    // Acceptance content present on disk too: a conditions revision the gate
    // reads back, and (on a second Issue) an accepted record. Reading status
    // over both must leave every acceptance byte identical — the projection's
    // acceptance block is a read, and the accept mutation's writes belong to
    // the mutation tests, not to this guard.
    await issues.publishAcceptance({
      ...scope,
      issueId: ISSUE,
      conditions: [{ id: 'cond-1', requirement: 'Guarded condition' }],
    });
    await issues.create({ ...scope, issueId: 'iss-guard-2', title: 'Accepted twin' });
    const twin = await issues.publishAcceptance({
      ...scope,
      issueId: 'iss-guard-2',
      conditions: [{ id: 'cond-1', requirement: 'Twin condition' }],
    });
    await issues.accept({
      ...scope,
      issueId: 'iss-guard-2',
      conditionsRevisionId: twin.revision.revisionId,
      conditionsSha256: twin.revision.contentSha256,
      gate: { completed: 0, total: 0, health: 'healthy', problemsStanding: 0 },
    });

    const issuesBefore = digestTree(path.join(f.storeRoot, 'rasen', 'issues'));
    const execBefore = digestTree(path.join(execRoot, '.rasen'));

    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope, issueId: ISSUE });
    const status = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir: path.join(execRoot, 'rasen', 'changes'),
      workDirFor: async () => null,
      acceptance: await readIssueAcceptanceFacts({ ...scope, issueId: ISSUE }),
    });
    // The read reached the run-state AND the acceptance content, so the guard
    // is not vacuous on either axis.
    expect(status.nodes[0].observation).toBe('in-flight');
    expect(status.acceptance?.conditions.revision?.revisionId).toBe('0001');
    expect(status.acceptance?.gate.eligible).toBe(false);

    // The ready-set derivation ran over the SAME read — an answer was
    // derived, so the byte checks below cover the scheduling surface too
    // (the CLI path's write-nothing receipt lives in the ready CLI suite).
    const ready = deriveIssueReadySet(status);
    expect(ready).not.toBeNull();
    expect(ready?.members).toEqual([]);
    expect(ready?.exits.map(exit => exit.nodeId)).toEqual(['g-001']);

    // The attention derivation ran over the same read too (the attention
    // CLI suite carries the CLI path's own write-nothing receipt): the
    // in-flight node contributes nothing — honestly unlisted, not unread.
    const attention = deriveIssueAttention(ISSUE, status);
    expect(attention).toEqual([]);

    // The delivery rollup derived over the same read as well: one change
    // node, not archived — the named absence, honestly counted (its own byte
    // suite pins the full read-discipline receipt).
    const delivery = deriveIssueDeliveryEvidence('0001', status);
    expect(delivery?.counts).toEqual({
      record: 0,
      'no-record': 0,
      'not-archived': 1,
      unreadable: 0,
      unattributed: 0,
    });

    const twinDetail = await new StoreQueryModuleImpl().showIssue({
      ...scope,
      issueId: 'iss-guard-2',
    });
    const twinStatus = await projectIssueStatus({
      detail: twinDetail,
      workDirFor: async () => null,
      acceptance: await readIssueAcceptanceFacts({ ...scope, issueId: 'iss-guard-2' }),
    });
    // The accepted twin read its record back — done from verified bytes.
    expect(twinStatus.phase).toBe('done');

    expect(digestTree(path.join(f.storeRoot, 'rasen', 'issues'))).toEqual(issuesBefore);
    expect(digestTree(path.join(execRoot, '.rasen'))).toEqual(execBefore);
    // And nothing new appeared anywhere under either tree.
    expect(fs.readdirSync(path.join(execRoot, '.rasen', 'changes'))).toEqual(['child-a']);
  });
});
