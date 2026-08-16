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
import { projectIssueStatus } from '../../../src/core/issue-status/index.js';

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

    const issuesBefore = digestTree(path.join(f.storeRoot, 'rasen', 'issues'));
    const execBefore = digestTree(path.join(execRoot, '.rasen'));

    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope, issueId: ISSUE });
    const status = await projectIssueStatus({
      detail,
      executionRoot: execRoot,
      changesDir: path.join(execRoot, 'rasen', 'changes'),
      workDirFor: async () => null,
    });
    // The read reached the run-state, so the guard is not vacuous.
    expect(status.nodes[0].observation).toBe('in-flight');

    expect(digestTree(path.join(f.storeRoot, 'rasen', 'issues'))).toEqual(issuesBefore);
    expect(digestTree(path.join(execRoot, '.rasen'))).toEqual(execBefore);
    // And nothing new appeared anywhere under either tree.
    expect(fs.readdirSync(path.join(execRoot, '.rasen', 'changes'))).toEqual(['child-a']);
  });
});
