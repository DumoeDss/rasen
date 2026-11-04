/**
 * The source guard for `src/core/issue-execution/**`, in the
 * `store-query-read-only-guard` family, plus the behavioral half: a launch
 * binding and the widened status projection mutate NOTHING on disk — Issue
 * records, plan revisions, run-state files, the workspace index, and the
 * execution root's `.rasen/planning-binding.json` stay byte-identical across
 * the read.
 *
 * The binding is derived at read time from the plan revision, Store
 * membership, and the workspace index; the moment it writes anything it
 * becomes a second mutable truth beside them, which is exactly the failure
 * mode the "no second mutable truth" requirement exists to prevent. Asserted
 * over the real sources AND over real bytes, so neither claim survives by
 * convention.
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
import { resolveIssueLaunchBinding } from '../../../src/core/issue-execution/index.js';
import type { WorkspaceIndexEntry, WorkspaceIndexSide } from '../../../src/core/store/workspace/registry.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const ISSUE_EXECUTION_DIR = path.join(REPO_ROOT, 'src', 'core', 'issue-execution');
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

/** Every Git verb with an effect. These modules' Git verb sets are EMPTY. */
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

describe('The issue-execution Module has no write surface', () => {
  const files = sourceFiles(ISSUE_EXECUTION_DIR);

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
        'writeWorkspaceIndexEntry',
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

  it('imports the frozen modules read-only: the pipeline resolver and the index reader, never a writer', () => {
    for (const file of files) {
      const text = code(read(file));
      const pipelineImports = /from\s+'\.\.\/pipeline-registry\/([a-z-]+)\.js'/gu;
      for (const match of text.matchAll(pipelineImports)) {
        // `resolver.js` exposes the pipeline catalog readers; the run-state
        // writers stay excluded.
        expect(['resolver', 'run-state', 'portfolio-state']).toContain(match[1]);
      }
      const workspaceImports = /from\s+'\.\.\/store\/workspace\/([a-z-]+)\.js'/gu;
      for (const match of text.matchAll(workspaceImports)) {
        expect(['registry']).toContain(match[1]);
      }
    }
  });

  it('keeps the widened issue-status Module write-free on its new imports (C1\'s guard carries the full verb list over the same directory)', () => {
    for (const file of sourceFiles(ISSUE_STATUS_DIR)) {
      const text = code(read(file));
      for (const forbidden of ['writeFile', 'writeText', 'writeJson', 'mkdir', 'unlink']) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not call ${forbidden}`
        ).not.toContain(forbidden);
      }
      const workspaceImports = /from\s+'\.\.\/store\/workspace\/([a-z-]+)\.js'/gu;
      for (const match of text.matchAll(workspaceImports)) {
        expect(['registry']).toContain(match[1]);
      }
    }
  });
});

describe('A launch binding and a widened projection mutate nothing on disk', () => {
  let f: StoreWorkspaceFixture;
  const NOW = '2026-08-17T00:00:00.000Z';
  const LINE = 'main';
  const PROJECT = 'app-a';
  const ISSUE = 'iss-exec-guard';
  let execRoot: string;
  let instanceId: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-issue-exec-guard-',
      projects: [PROJECT],
      lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
    });
    execRoot = f.beside('exec-guard');
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

  it('leaves the store, run-state, index, and planning-binding byte-identical', async () => {
    const seeded = f.seedChange({
      root: f.storeRoot,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-a',
      instanceSeed: 'a1'.repeat(16),
    });
    instanceId = seeded.instanceId;
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
        changeInstanceId: instanceId,
        changeAlias: 'child-a',
        dependsOn: [],
      },
    ];
    await issues.publishPlan({ ...scope, issueId: ISSUE, nodes });
    f.git(f.storeRoot, ['add', '-A']);
    f.git(f.storeRoot, ['commit', '-m', 'issue + plan']);

    // Real run-state in an indexed execution root, the machine index document
    // `apply` writes, and the association file it drops into the root.
    writeRunState(ephemeraDir(execRoot, 'child-a'), {
      pipeline: 'small-feature',
      stages: { propose: { status: 'done' }, apply: { status: 'in_progress' } },
    });
    const scopeId = f.planningScopeId(PROJECT, LINE);
    const side = (root: string): WorkspaceIndexSide => ({
      root,
      repositoryIdentity: 'repo',
      worktreeInstanceId: `wt-${path.basename(root)}`,
      ref: 'refs/heads/main',
      headOid: 'a'.repeat(40),
    });
    const entry: WorkspaceIndexEntry = {
      version: 1,
      planningScopeId: scopeId,
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: PROJECT,
      targetLineId: LINE,
      changeId: 'child-a',
      changeInstanceId: instanceId,
      planning: side(f.storeRoot),
      execution: side(execRoot),
      planId: 'plan-1',
      phase: 'bound',
      recordedAt: NOW,
      updatedAt: NOW,
    };
    const indexDir = path.join(f.globalDataDir, 'planning-workspaces', 'index');
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(
      path.join(indexDir, `${scopeId}.json`),
      `${JSON.stringify({ version: 1, planningScopeId: scopeId, entries: [entry] }, null, 2)}\n`,
      'utf8'
    );
    fs.mkdirSync(path.join(execRoot, '.rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(execRoot, '.rasen', 'planning-binding.json'),
      `${JSON.stringify({ version: 1, changeInstanceId: instanceId }, null, 2)}\n`,
      'utf8'
    );

    const storeBefore = digestTree(path.join(f.storeRoot, 'rasen'));
    const execBefore = digestTree(path.join(execRoot, '.rasen'));
    const indexBefore = digestTree(path.join(f.globalDataDir, 'planning-workspaces'));

    const detail = await new StoreQueryModuleImpl().showIssue({ ...scope, issueId: ISSUE });
    const status = await projectIssueStatus({
      detail,
      storeRoot: f.storeRoot,
      workspaceEntries: [entry],
      workDirFor: async () => null,
    });
    // The widened projection really located the run-state through the index,
    // so the guard is not vacuous.
    expect(status.nodes[0].observation).toBe('in-flight');
    expect(status.nodes[0].locatedBy).toBe('workspace-index');

    // The pair route must need no machine project registry at all: the
    // injected composition throwing proves route 1 answered before route 2.
    const result = await resolveIssueLaunchBinding({
      detail,
      status,
      workspaceEntries: [entry],
      launchContextFor: async () => {
        throw new Error('the workspace-pair route must not consult a launch composition');
      },
      nodeId: 'g-001',
      storeId: f.storeId,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding.launch?.form).toBe('workspace-pair');
      expect(result.binding.launch?.cwd).toBe(execRoot);
      expect(result.binding.mode).toBe('already-running');
      expect(result.binding.pipeline).toBe('small-feature');
    }

    expect(digestTree(path.join(f.storeRoot, 'rasen'))).toEqual(storeBefore);
    expect(digestTree(path.join(execRoot, '.rasen'))).toEqual(execBefore);
    expect(digestTree(path.join(f.globalDataDir, 'planning-workspaces'))).toEqual(indexBefore);
  });
});
