import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  planDeclaredKnowledgeBundles,
  resolveDeclaredKnowledgeBundle,
  type DeclaredKnowledgeBundleInput,
} from '../../../src/core/knowledge-bundle/declaration.js';

describe('declared portable knowledge bundle paths', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-declaration-'))
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves a repository-relative file and reports a missing file exactly', () => {
    const bundle = path.join(root, 'carry', 'project.bundle.json');
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    fs.writeFileSync(bundle, '{}\n');

    expect(
      resolveDeclaredKnowledgeBundle(root, path.join('carry', 'project.bundle.json'))
    ).toMatchObject({
      availability: 'usable',
      resolvedPath: path.resolve(bundle),
      canonicalPath: fs.realpathSync.native(bundle),
    });
    expect(
      resolveDeclaredKnowledgeBundle(root, path.join('carry', 'missing.bundle.json'))
    ).toMatchObject({
      availability: 'missing',
      resolvedPath: path.resolve(root, 'carry', 'missing.bundle.json'),
      repair: {
        kind: 'restore-file',
        path: path.resolve(root, 'carry', 'missing.bundle.json'),
      },
    });
  });

  it.each([
    ['Windows drive', String.raw`C:\carry\project.bundle.json`],
    ['Windows network share', String.raw`\\server\share\project.bundle.json`],
    ['POSIX absolute', '/carry/project.bundle.json'],
  ])('rejects %s absolute syntax on every host', (_label, locator) => {
    expect(resolveDeclaredKnowledgeBundle(root, locator)).toMatchObject({
      availability: 'unsafe',
      reason: 'absolute-locator',
    });
  });

  it('rejects lexical parent traversal', () => {
    expect(
      resolveDeclaredKnowledgeBundle(root, path.join('..', 'outside.bundle.json'))
    ).toMatchObject({
      availability: 'unsafe',
      reason: 'parent-escape',
    });
  });

  it('reports a non-file target as unreadable', () => {
    fs.mkdirSync(path.join(root, 'bundle-directory'));

    expect(resolveDeclaredKnowledgeBundle(root, 'bundle-directory')).toMatchObject({
      availability: 'unreadable',
      reason: 'not-a-file',
      repair: {
        kind: 'edit-declaration',
        path: path.resolve(root, 'bundle-directory'),
      },
    });
  });

  it('rejects an existing symlink target that escapes the owner root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-outside-'));
    const target = path.join(outside, 'outside.bundle.json');
    fs.writeFileSync(target, '{}\n');
    const link = path.join(root, 'linked.bundle.json');
    try {
      fs.symlinkSync(target, link, 'file');
    } catch {
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }

    expect(resolveDeclaredKnowledgeBundle(root, 'linked.bundle.json')).toMatchObject({
      availability: 'unsafe',
      reason: 'symlink-escape',
    });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('de-duplicates one canonical path, retains both sources, and gives it project trust', () => {
    const storeRoot = path.join(root, 'stores', 'team');
    fs.mkdirSync(storeRoot, { recursive: true });
    const bundle = path.join(storeRoot, 'carry.bundle.json');
    fs.writeFileSync(bundle, '{}\n');
    const projectId = '88888888-8888-4888-8888-888888888888';
    const declarations: DeclaredKnowledgeBundleInput[] = [
      {
        projectId,
        projectRoot: root,
        source: {
          kind: 'project-config',
          declarationPath: path.join(root, 'rasen', 'config.yaml'),
          ownerRoot: root,
          locator: path.join('stores', 'team', 'carry.bundle.json'),
        },
      },
      {
        projectId,
        projectRoot: root,
        source: {
          kind: 'store-record',
          declarationPath: path.join(storeRoot, '.rasen-store', 'projects', `${projectId}.yaml`),
          ownerRoot: storeRoot,
          locator: 'carry.bundle.json',
          storeId: 'team',
        },
      },
    ];

    const actions = planDeclaredKnowledgeBundles(declarations);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      projectId,
      trust: 'project-config',
      availability: 'usable',
    });
    expect(actions[0].sources.map((source) => source.kind)).toEqual([
      'project-config',
      'store-record',
    ]);
  });

  it('keeps different paths separate and collapses duplicate Store records deterministically', () => {
    const projectId = '88888888-8888-4888-8888-888888888888';
    for (const name of ['a.bundle.json', 'b.bundle.json']) {
      fs.writeFileSync(path.join(root, name), '{}\n');
    }
    const storeSource = (storeId: string, locator: string): DeclaredKnowledgeBundleInput => ({
      projectId,
      projectRoot: root,
      source: {
        kind: 'store-record',
        declarationPath: path.join(root, '.rasen-store', 'projects', `${storeId}.yaml`),
        ownerRoot: root,
        locator,
        storeId,
      },
    });

    const actions = planDeclaredKnowledgeBundles([
      storeSource('store-b', 'a.bundle.json'),
      storeSource('store-a', path.join('.', 'a.bundle.json')),
      storeSource('store-c', 'b.bundle.json'),
    ]);

    expect(actions).toHaveLength(2);
    expect(actions[0].sources).toHaveLength(2);
    expect(actions[0].sources.map((source) => source.kind === 'store-record' && source.storeId)).toEqual([
      'store-a',
      'store-b',
    ]);
    expect(actions[1].resolvedPath).toBe(path.resolve(root, 'b.bundle.json'));
  });

  it('uses the declaration file as the repair target for an unsafe locator', () => {
    const declarationPath = path.join(root, 'rasen', 'config.yaml');
    const [action] = planDeclaredKnowledgeBundles([
      {
        projectId: '88888888-8888-4888-8888-888888888888',
        projectRoot: root,
        source: {
          kind: 'project-config',
          declarationPath,
          ownerRoot: root,
          locator: '../outside.bundle.json',
        },
      },
    ]);

    expect(action).toMatchObject({
      availability: 'unsafe',
      repair: [{ kind: 'edit-declaration', path: declarationPath }],
    });
  });

  it('collapses case-equivalent paths on case-insensitive Windows filesystems', () => {
    if (process.platform !== 'win32') return;
    const bundleName = 'Portable-Case.bundle.json';
    fs.writeFileSync(path.join(root, bundleName), '{}\n');
    const projectId = '88888888-8888-4888-8888-888888888888';
    const source = (storeId: string, locator: string): DeclaredKnowledgeBundleInput => ({
      projectId,
      projectRoot: root,
      source: {
        kind: 'store-record',
        declarationPath: path.join(root, `${storeId}.yaml`),
        ownerRoot: root,
        locator,
        storeId,
      },
    });

    expect(
      planDeclaredKnowledgeBundles([
        source('store-a', bundleName),
        source('store-b', bundleName.toLowerCase()),
      ])
    ).toHaveLength(1);
  });
});
