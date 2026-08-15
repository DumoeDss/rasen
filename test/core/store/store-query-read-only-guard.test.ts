/**
 * The source guard for this change's two Modules.
 *
 * `src/core/store/query/**` must have NO write surface at all, and neither it
 * nor `src/core/store/issues/**` may reach a Git verb that writes. Both claims
 * are asserted over the real sources rather than left to convention, in the
 * shape children 2, 3, and 4 established.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { STORE_QUERY_GIT_VERBS } from '../../../src/core/store/query/dependencies.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const QUERY_DIR = path.join(REPO_ROOT, 'src', 'core', 'store', 'query');
const ISSUES_DIR = path.join(REPO_ROOT, 'src', 'core', 'store', 'issues');

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

/**
 * Every Git verb with an effect. Absent on purpose from both Modules: this
 * change's Git write verb set is EMPTY.
 */
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

describe('The aggregate query Module has no write surface', () => {
  const files = sourceFiles(QUERY_DIR);

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('imports no spec-application, archive-transaction, or archive-engine function', () => {
    for (const file of files) {
      const text = code(read(file));
      for (const forbidden of [
        'specs-apply',
        'archive-engine',
        'archive-accounting',
        'buildUpdatedSpec',
        'applySpecActions',
        'syncSpecs',
      ]) {
        expect(text, `${path.relative(REPO_ROOT, file)} must not reach ${forbidden}`).not.toContain(
          forbidden
        );
      }
    }
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
        'fs.rm(',
      ]) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not call ${forbidden}`
        ).not.toContain(forbidden);
      }
    }
  });

  it('declares a read-only filesystem Interface with no write method', () => {
    const dependencies = read(path.join(QUERY_DIR, 'dependencies.ts'));
    const interfaceBody = /export interface StoreQueryFileSystem \{([\s\S]*?)\n\}/u.exec(
      dependencies
    )?.[1];
    expect(interfaceBody).toBeDefined();
    expect(interfaceBody).toContain('readText');
    expect(interfaceBody).toContain('listNames');
    for (const method of ['write', 'mkdir', 'remove', 'rename', 'delete', 'create']) {
      expect(interfaceBody?.toLowerCase()).not.toContain(method);
    }
  });

  it('spawns no Git verb outside its declared read set', () => {
    expect([...STORE_QUERY_GIT_VERBS].sort()).toEqual(
      ['for-each-ref', 'ls-tree', 'rev-parse', 'show'].sort()
    );
    for (const file of files) {
      const text = code(read(file));
      for (const verb of FORBIDDEN_GIT_VERBS) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not name the '${verb}' Git verb`
        ).not.toMatch(new RegExp(`['"\`]${verb}['"\`]`, 'u'));
      }
    }
  });
});

describe('The Issue Module makes no Git write of any kind', () => {
  const files = sourceFiles(ISSUES_DIR);

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('names no Git verb with an effect', () => {
    for (const file of files) {
      const text = code(read(file));
      for (const verb of FORBIDDEN_GIT_VERBS) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not name the '${verb}' Git verb`
        ).not.toMatch(new RegExp(`['"\`]${verb}['"\`]`, 'u'));
      }
    }
  });

  it('reaches no archive-engine, spec-apply, or accounting function', () => {
    for (const file of files) {
      const text = code(read(file));
      for (const forbidden of [
        'specs-apply',
        'archive-engine',
        'archive-accounting',
        'buildUpdatedSpec',
        'serializeArchiveV2',
      ]) {
        expect(text, `${path.relative(REPO_ROOT, file)} must not reach ${forbidden}`).not.toContain(
          forbidden
        );
      }
    }
  });

  it('never spawns a process itself', () => {
    for (const file of files) {
      const text = code(read(file));
      for (const forbidden of ['child_process', 'execFile', 'spawn(']) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not spawn a process`
        ).not.toContain(forbidden);
      }
    }
  });

  /**
   * The production checkout adapter delegates TWO read calls to the workspace
   * Module's Git implementation, which can also create and remove worktrees.
   * The guard against that is the narrow Interface plus this assertion, not a
   * claim that the writing methods are unreachable through the import graph —
   * so both are pinned rather than one being assumed.
   */
  it('reaches only the two read methods of the workspace Git implementation', () => {
    const dependencies = read(path.join(ISSUES_DIR, 'dependencies.ts'));
    const interfaceBody = /export interface IssueCheckoutGit \{([\s\S]*?)\n\}/u.exec(
      dependencies
    )?.[1];
    expect(interfaceBody).toBeDefined();
    expect(interfaceBody).toContain('checkedOutRef');
    expect(interfaceBody).toContain('worktreeRoots');
    for (const method of ['addWorktree', 'removeWorktree', 'pruneWorktrees']) {
      expect(interfaceBody).not.toContain(method);
    }
    for (const file of files) {
      const text = code(read(file));
      for (const method of ['addWorktree', 'removeWorktree', 'pruneWorktrees']) {
        expect(
          text,
          `${path.relative(REPO_ROOT, file)} must not call ${method}`
        ).not.toContain(method);
      }
    }
    // Exactly one file may name the workspace Git implementation at all.
    const namingIt = files.filter(file => code(read(file)).includes('nodeWorkspaceGit'));
    expect(namingIt.map(file => path.basename(file))).toEqual(['dependencies.ts']);
  });
});
