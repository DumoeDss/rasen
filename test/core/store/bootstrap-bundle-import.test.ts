import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import {
  createKnowledgeBundle,
  createKnowledgeBundleRecord,
  type KnowledgeBundle,
} from '../../../src/core/knowledge-bundle/schema.js';
import { importKnowledgeBundle } from '../../../src/core/knowledge-bundle/import.js';
import {
  digestContent,
  readCanonicalRecord,
} from '../../../src/core/learned-skills/catalog.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';
import {
  appendStoreMembershipHint,
  updateProjectConfigKey,
} from '../../../src/core/project-config.js';
import {
  buildBootstrapReport,
  type BootstrapConsent,
  type BootstrapReport,
} from '../../../src/core/store/bootstrap.js';
import {
  readOptionalStoreMetadataState,
  storeMetadataUid,
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import type { LearnedSkillManifestV2 } from '../../../src/core/learned-skills/types.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';

const PROJECT_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_PROJECT_ID = '99999999-9999-4999-8999-999999999999';
const CREATED_AT = '2026-07-27T00:00:00.000Z';

function snapshot(root: string): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.set(path.relative(root, full), fs.readFileSync(full).toString('base64'));
    }
  };
  if (fs.existsSync(root)) visit(root);
  return found;
}

describe('bootstrap declared bundle integration', () => {
  let tempRoot: string;
  let globalDataDir: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(() => {
    tempRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bootstrap-bundle-'))
    );
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempRoot, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeProject(name: string, projectId = PROJECT_ID): string {
    const root = path.join(tempRoot, name);
    createOpenSpecRoot(root);
    updateProjectConfigKey(root, 'projectId', projectId);
    return root;
  }

  function canonicalContent(id: string, body = 'Use declared portable guidance.'): string {
    return `---\nname: ${id}\n---\n\n${body}\n`;
  }

  function bundleRecord(
    id: string,
    projectId = PROJECT_ID,
    body = 'Use declared portable guidance.'
  ): KnowledgeBundle['records'][number] {
    const content = canonicalContent(id, body);
    const manifest: LearnedSkillManifestV2 = {
      version: 2,
      id,
      knowledgeKey: `${id}-key`,
      scope: 'project',
      owner: { type: 'project', projectId },
      status: 'active',
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(content),
      description: `Portable guidance for ${id}.`,
      applicability: { mode: 'all', markers: ['package.json'] },
      evidence: [
        {
          owner: { type: 'project', projectId: OTHER_PROJECT_ID },
          change: 'source-change',
          artifact: 'design',
          digest: `sha256:${'b'.repeat(64)}`,
        },
      ],
      sources: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    return createKnowledgeBundleRecord({
      id,
      knowledgeKey: manifest.knowledgeKey,
      contentDigest: manifest.contentDigest,
      manifest,
      content,
    });
  }

  function writeBundle(
    filePath: string,
    records: KnowledgeBundle['records'] = [bundleRecord('declared-portable-routing')],
    projectId = PROJECT_ID
  ): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const bundle = createKnowledgeBundle({
      bundleId: randomUUID(),
      projectId,
      createdAt: CREATED_AT,
      baseProjectCommit: 'a'.repeat(40),
      records,
    });
    fs.writeFileSync(filePath, `${JSON.stringify(bundle, null, 2)}\n`);
  }

  async function makeStore(
    name: string,
    projectId = PROJECT_ID
  ): Promise<{ root: string; uid: string; id: string }> {
    const root = path.join(tempRoot, name);
    createOpenSpecRoot(root);
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, { version: 2, uid, id: name });
    await registerStore({ id: name, localPath: root, globalDataDir });
    expect(storeMetadataUid(await readOptionalStoreMetadataState(root))).toBe(uid);
    return { root, uid, id: name };
  }

  function importedRecord(id: string) {
    const home = resolveProjectKnowledgeHome(PROJECT_ID, { globalDataDir });
    return readCanonicalRecord(
      path.join(home.catalogDir, id),
      'project',
      { type: 'project', projectId: PROJECT_ID }
    );
  }

  it('no declaration in either origin lists no action and calls no import path', async () => {
    const project = makeProject('plain-project');
    const projectReport = await buildBootstrapReport({
      cwd: project,
      mode: 'check',
      globalDataDir,
    });
    expect(projectReport.bundleImports).toBeUndefined();
    expect(fs.existsSync(resolveProjectKnowledgeHome(PROJECT_ID, { globalDataDir }).root)).toBe(
      false
    );

    const store = await makeStore('plain-store');
    const storeReport = await buildBootstrapReport({
      cwd: store.root,
      mode: 'check',
      globalDataDir,
    });
    expect(storeReport.bundleImports).toBeUndefined();
  });

  it('lists a project declaration separately and blanket --yes imports it through F3', async () => {
    const project = makeProject('project-trusted');
    const bundle = path.join(project, 'carry', 'project.bundle.json');
    writeBundle(bundle);
    updateProjectConfigKey(
      project,
      'knowledgeBundle',
      path.join('carry', 'project.bundle.json')
    );

    const listed = await buildBootstrapReport({
      cwd: project,
      mode: 'check',
      globalDataDir,
    });
    expect(listed.bundleImports).toEqual([
      expect.objectContaining({
        trust: 'project-config',
        availability: 'usable',
        outcome: 'unconfirmed',
        changed: false,
      }),
    ]);
    expect(importedRecord('declared-portable-routing').kind).toBe('absent');

    const unconfirmed = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: false },
    });
    expect(unconfirmed.bundleImports?.[0]).toMatchObject({
      trust: 'project-config',
      outcome: 'unconfirmed',
      changed: false,
      added: [expect.objectContaining({ id: 'declared-portable-routing' })],
    });
    expect(importedRecord('declared-portable-routing').kind).toBe('absent');

    const applied = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(applied.knowledge).toBeDefined();
    expect(applied.bundleImports).toEqual([
      expect.objectContaining({
        trust: 'project-config',
        outcome: 'imported',
        changed: true,
        added: [expect.objectContaining({ id: 'declared-portable-routing' })],
        conflicts: [],
      }),
    ]);
    const read = importedRecord('declared-portable-routing');
    expect(read.kind).toBe('managed');
    if (read.kind !== 'managed') return;
    expect(read.record.manifest).toMatchObject({
      owner: { type: 'project', projectId: PROJECT_ID },
      sources: [],
      evidence: [
        expect.objectContaining({
          owner: { type: 'project', projectId: OTHER_PROJECT_ID },
        }),
      ],
    });
  });

  it('Store-only declarations remain unconfirmed under --yes, then import on explicit confirmation without Store mutation', async () => {
    const project = makeProject('store-declared-project');
    const store = await makeStore('team-store');
    const bundle = path.join(store.root, 'rasen', 'knowledge-bundles', 'carry.bundle.json');
    writeBundle(bundle);
    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: PROJECT_ID,
      knowledgeBundle: path.join('rasen', 'knowledge-bundles', 'carry.bundle.json'),
      roles: { planning: true, knowledge: true },
    });
    await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });
    execFileSync('git', ['init'], { cwd: store.root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: store.root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: store.root });
    execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/team-store.git'], {
      cwd: store.root,
    });
    execFileSync('git', ['add', '-A'], { cwd: store.root });
    execFileSync('git', ['commit', '-m', 'store declaration'], { cwd: store.root });
    const beforeHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: store.root,
      encoding: 'utf8',
    });
    const beforeRemotes = execFileSync('git', ['remote', '-v'], {
      cwd: store.root,
      encoding: 'utf8',
    });
    const beforeStore = snapshot(store.root);

    const blanket = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(blanket.bundleImports).toEqual([
      expect.objectContaining({
        trust: 'store-record-only',
        outcome: 'unconfirmed',
        added: [expect.objectContaining({ id: 'declared-portable-routing' })],
      }),
    ]);
    expect(importedRecord('declared-portable-routing').kind).toBe('absent');
    expect(snapshot(store.root)).toEqual(beforeStore);

    const requests: string[] = [];
    const explicit = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: {
        blanket: false,
        confirm: async (request) => {
          requests.push(request.action);
          return request.action === 'import-bundle';
        },
      },
    });
    expect(requests).toContain('import-bundle');
    expect(explicit.bundleImports?.[0]).toMatchObject({
      trust: 'store-record-only',
      outcome: 'imported',
      changed: true,
    });
    expect(importedRecord('declared-portable-routing').kind).toBe('managed');
    expect(snapshot(store.root)).toEqual(beforeStore);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: store.root,
      encoding: 'utf8',
    })).toBe(beforeHead);
    expect(execFileSync('git', ['remote', '-v'], {
      cwd: store.root,
      encoding: 'utf8',
    })).toBe(beforeRemotes);
  });

  it('missing, unreadable, unsafe, malformed, wrong-project, and conflicting actions degrade while hydration continues', async () => {
    const project = makeProject('degraded-project');

    updateProjectConfigKey(project, 'knowledgeBundle', 'missing.bundle.json');
    const missing = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(missing.state).toBe('degraded');
    expect(missing.knowledge).toBeDefined();
    expect(missing.bundleImports?.[0]).toMatchObject({
      availability: 'missing',
      outcome: 'unavailable',
      repair: [{
        kind: 'restore-file',
        path: path.join(project, 'missing.bundle.json'),
      }],
    });

    updateProjectConfigKey(project, 'knowledgeBundle', String.raw`C:\unsafe.bundle.json`);
    const unsafe = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(unsafe.bundleImports?.[0]).toMatchObject({
      availability: 'unsafe',
      outcome: 'unavailable',
      repair: [{
        kind: 'edit-declaration',
        path: path.join(project, 'rasen', 'config.yaml'),
      }],
    });

    fs.mkdirSync(path.join(project, 'unreadable.bundle.json'));
    updateProjectConfigKey(project, 'knowledgeBundle', 'unreadable.bundle.json');
    const unreadable = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(unreadable.bundleImports?.[0]).toMatchObject({
      availability: 'unreadable',
      outcome: 'unavailable',
      repair: [{
        kind: 'edit-declaration',
        path: path.join(project, 'rasen', 'config.yaml'),
      }],
    });

    fs.writeFileSync(path.join(project, 'malformed.bundle.json'), '{}\n');
    updateProjectConfigKey(project, 'knowledgeBundle', 'malformed.bundle.json');
    const malformed = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(malformed.bundleImports?.[0]).toMatchObject({
      outcome: 'refused',
      refusal: { code: 'knowledge_bundle_import_bundle_invalid' },
      changed: false,
    });

    writeBundle(
      path.join(project, 'wrong.bundle.json'),
      [bundleRecord('wrong-portable-routing', OTHER_PROJECT_ID)],
      OTHER_PROJECT_ID
    );
    updateProjectConfigKey(project, 'knowledgeBundle', 'wrong.bundle.json');
    const wrong = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(wrong.bundleImports?.[0]).toMatchObject({
      outcome: 'refused',
      refusal: { code: 'knowledge_bundle_import_project_mismatch' },
    });

    const firstBundle = path.join(project, 'conflict.bundle.json');
    writeBundle(firstBundle, [bundleRecord('conflicting-portable-routing')]);
    updateProjectConfigKey(project, 'knowledgeBundle', 'conflict.bundle.json');
    await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    writeBundle(firstBundle, [
      bundleRecord('conflicting-portable-routing', PROJECT_ID, 'Different portable guidance.'),
      bundleRecord('clean-portable-routing'),
    ]);
    const conflict = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });
    expect(conflict.bundleImports?.[0]).toMatchObject({
      outcome: 'refused',
      refusal: { code: 'knowledge_bundle_import_conflict' },
      changed: false,
      added: [expect.objectContaining({ id: 'clean-portable-routing' })],
      conflicts: [expect.objectContaining({ id: 'conflicting-portable-routing' })],
    });
    expect(importedRecord('clean-portable-routing').kind).toBe('absent');
  });

  it('reports an invalid project declaration in-band without an English console fallback', async () => {
    const project = makeProject('invalid-declaration');
    updateProjectConfigKey(project, 'knowledgeBundle', 42, { reporter: () => {} });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'check',
      globalDataDir,
    });

    expect(warning).not.toHaveBeenCalled();
    expect(report.state).toBe('degraded');
    expect(report.bundleImports).toEqual([
      expect.objectContaining({
        trust: 'project-config',
        locator: '',
        reason: 'invalid-declaration',
        availability: 'unsafe',
        outcome: 'unavailable',
        repair: [
          {
            kind: 'edit-declaration',
            path: path.join(project, 'rasen', 'config.yaml'),
          },
        ],
      }),
    ]);
    warning.mockRestore();
  });

  it('reports unknown change after an unexpected apply failure that may have written knowledge', async () => {
    const project = makeProject('unknown-apply');
    const bundle = path.join(project, 'carry.bundle.json');
    writeBundle(bundle);
    updateProjectConfigKey(project, 'knowledgeBundle', 'carry.bundle.json');
    const marker = path.join(
      resolveProjectKnowledgeHome(PROJECT_ID, { globalDataDir }).catalogDir,
      'unexpected-post-write-marker'
    );

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
      bundleImporter: async (options) => {
        if (options.dryRun === true) return importKnowledgeBundle(options);
        fs.mkdirSync(marker, { recursive: true });
        throw new Error('unexpected failure after an unverified write');
      },
    });

    expect(fs.existsSync(marker)).toBe(true);
    expect(report.state).toBe('degraded');
    expect(report.bundleImports?.[0]).toMatchObject({
      outcome: 'refused',
      changed: 'unknown',
      refusal: { code: 'knowledge_bundle_import_failed' },
      repair: [
        expect.objectContaining({
          kind: 'repair-import',
          code: 'knowledge_bundle_import_failed',
        }),
      ],
    });
  });

  it('registration failure keeps F3 behind the registered-project authority', async () => {
    const project = makeProject('registration-failure');
    const bundle = path.join(project, 'carry.bundle.json');
    writeBundle(bundle);
    updateProjectConfigKey(project, 'knowledgeBundle', 'carry.bundle.json');
    fs.mkdirSync(path.join(globalDataDir, 'projects', 'registry.json'), {
      recursive: true,
    });

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: { blanket: true },
    });

    expect(report.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(report.bundleImports?.[0]).toMatchObject({
      outcome: 'refused',
      changed: false,
      refusal: { code: 'knowledge_bundle_import_project_not_found' },
    });
    expect(importedRecord('declared-portable-routing').kind).toBe('absent');
  });

  it('one refused action does not stop an independently confirmed action', async () => {
    const project = makeProject('independent-actions');
    const store = await makeStore('independent-store');
    await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

    fs.writeFileSync(path.join(project, 'malformed.bundle.json'), '{}\n');
    updateProjectConfigKey(project, 'knowledgeBundle', 'malformed.bundle.json');
    const validBundle = path.join(store.root, 'valid.bundle.json');
    writeBundle(validBundle, [bundleRecord('independent-portable-routing')]);
    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: PROJECT_ID,
      knowledgeBundle: 'valid.bundle.json',
      roles: { planning: true, knowledge: true },
    });

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      consent: {
        blanket: true,
        confirm: async (request) => request.action === 'import-bundle',
      },
    });

    expect(report.bundleImports).toHaveLength(2);
    expect(report.bundleImports?.[0]).toMatchObject({
      trust: 'project-config',
      outcome: 'refused',
      refusal: { code: 'knowledge_bundle_import_bundle_invalid' },
    });
    expect(report.bundleImports?.[1]).toMatchObject({
      trust: 'store-record-only',
      outcome: 'imported',
      changed: true,
    });
    expect(importedRecord('independent-portable-routing').kind).toBe('managed');
  });

  it('an unreadable Store record degrades without hiding another declaration', async () => {
    const project = makeProject('unreadable-store-record');
    const bundle = path.join(project, 'project.bundle.json');
    writeBundle(bundle);
    updateProjectConfigKey(project, 'knowledgeBundle', 'project.bundle.json');
    const store = await makeStore('unreadable-record-store');
    await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });
    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: PROJECT_ID,
      roles: { planning: true, knowledge: true },
    });
    const recordPath = path.join(
      store.root,
      '.rasen-store',
      'projects',
      `${PROJECT_ID}.yaml`
    );
    fs.writeFileSync(recordPath, 'version: [invalid\n');

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'check',
      globalDataDir,
    });

    expect(report.state).toBe('degraded');
    expect(report.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(report.bundleImports).toEqual([
      expect.objectContaining({
        trust: 'project-config',
        outcome: 'unconfirmed',
        resolvedPath: bundle,
      }),
    ]);
  });

  it('Store-first lists a declaration for an absent project and explicitly imports it after obtain', async () => {
    const store = await makeStore('store-first');
    const remoteProject = makeProject('remote-project');
    execFileSync('git', ['init'], { cwd: remoteProject });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: remoteProject });
    execFileSync('git', ['config', 'user.email', 'test@example.test'], {
      cwd: remoteProject,
    });
    execFileSync('git', ['add', '-A'], { cwd: remoteProject });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: remoteProject });

    const bundle = path.join(store.root, 'rasen', 'knowledge-bundles', 'carry.bundle.json');
    writeBundle(bundle);
    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: PROJECT_ID,
      id: 'portable-project',
      remote: remoteProject,
      knowledgeBundle: path.join('rasen', 'knowledge-bundles', 'carry.bundle.json'),
      roles: { planning: true, knowledge: true },
    });

    const listed = await buildBootstrapReport({
      cwd: store.root,
      mode: 'check',
      globalDataDir,
    });
    expect(listed.bundleImports?.[0]).toMatchObject({
      projectId: PROJECT_ID,
      availability: 'project-unavailable',
      outcome: 'unavailable',
      repair: [expect.objectContaining({ kind: 'obtain-project' })],
    });

    const target = path.join(tempRoot, 'obtained-project');
    const consent: BootstrapConsent = {
      blanket: false,
      confirm: async (request) => request.action === 'import-bundle',
    };
    const applied = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[PROJECT_ID, target]]),
      consent,
    });

    expect(applied.projects[0]).toMatchObject({
      projectId: PROJECT_ID,
      presence: 'present',
      action: 'obtained',
      root: fs.realpathSync.native(target),
    });
    expect(applied.bundleImports?.[0]).toMatchObject({
      trust: 'store-record-only',
      availability: 'usable',
      outcome: 'imported',
      changed: true,
    });
    expect(importedRecord('declared-portable-routing').kind).toBe('managed');
  });

  it('same-path declarations become one project-trusted action while different paths remain separate', async () => {
    const project = makeProject('dedupe-project');
    const nestedStoreRoot = path.join(project, 'stores', 'nested-store');
    createOpenSpecRoot(nestedStoreRoot);
    const uid = mintStoreUid();
    await writeStoreMetadataState(nestedStoreRoot, {
      version: 2,
      uid,
      id: 'nested-store',
    });
    await registerStore({
      id: 'nested-store',
      localPath: nestedStoreRoot,
      globalDataDir,
    });
    await appendStoreMembershipHint(project, { uid, id: 'nested-store' });

    const shared = path.join(nestedStoreRoot, 'shared.bundle.json');
    const other = path.join(nestedStoreRoot, 'other.bundle.json');
    writeBundle(shared);
    writeBundle(other, [bundleRecord('other-portable-routing')]);
    updateProjectConfigKey(
      project,
      'knowledgeBundle',
      path.join('stores', 'nested-store', 'shared.bundle.json')
    );
    await writeStoreProjectRecord(nestedStoreRoot, {
      version: 1,
      projectId: PROJECT_ID,
      knowledgeBundle: 'shared.bundle.json',
      roles: { planning: true, knowledge: true },
    });

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'check',
      globalDataDir,
    });
    expect(report.bundleImports).toHaveLength(1);
    expect(report.bundleImports?.[0]).toMatchObject({
      trust: 'project-config',
      sources: [
        expect.objectContaining({ kind: 'project-config' }),
        expect.objectContaining({ kind: 'store-record' }),
      ],
    });

    await writeStoreProjectRecord(nestedStoreRoot, {
      version: 1,
      projectId: PROJECT_ID,
      knowledgeBundle: 'other.bundle.json',
      roles: { planning: true, knowledge: true },
    });
    const divergent = await buildBootstrapReport({
      cwd: project,
      mode: 'check',
      globalDataDir,
    });
    expect(divergent.bundleImports).toHaveLength(2);
  });
});
