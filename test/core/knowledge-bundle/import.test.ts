import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  KnowledgeBundleImportError,
  importKnowledgeBundle,
  type ImportKnowledgeBundleOptions,
} from '../../../src/core/knowledge-bundle/import.js';
import {
  acquireOwnerAwareFileLock,
  releaseOwnerAwareFileLock,
} from '../../../src/core/file-state.js';
import { exportKnowledgeBundle } from '../../../src/core/knowledge-bundle/export.js';
import {
  createKnowledgeBundle,
  createKnowledgeBundleRecord,
  type KnowledgeBundle,
} from '../../../src/core/knowledge-bundle/schema.js';
import {
  digestContent,
  readCanonicalRecord,
  serializeManifest,
} from '../../../src/core/learned-skills/catalog.js';
import {
  commitLearnedSkillPlan,
  planLearnedSkillMutation,
  resolveCanonicalStore,
  resolveLearnedSkillExecutionContext,
} from '../../../src/core/learned-skills/index.js';
import type {
  LearnedSkillContext,
  LearnedSkillManifestV1,
  LearnedSkillManifestV2,
  LearnedSkillMutationRequest,
  NormalizedEvidenceReference,
  PromotionSourceLocator,
} from '../../../src/core/learned-skills/types.js';
import type { ResolvedStore } from '../../../src/core/learned-skills/stores.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import { registerStore } from '../../../src/core/store/registry.js';

const PROJECT_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_PROJECT_ID = '99999999-9999-4999-8999-999999999999';
const CREATED_AT = '2026-07-27T00:00:00.000Z';
const BASE_COMMIT = 'a'.repeat(40);

interface TreeEntry {
  path: string;
  type: 'directory' | 'file';
  bytes?: string;
}

function snapshotTree(root: string): TreeEntry[] {
  if (!fs.existsSync(root)) return [];
  const entries: TreeEntry[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) {
        entries.push({ path: relative, type: 'directory' });
        visit(full);
      } else {
        entries.push({
          path: relative,
          type: 'file',
          bytes: fs.readFileSync(full).toString('base64'),
        });
      }
    }
  };
  visit(root);
  return entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

function identity(target: string): string {
  const stat = fs.lstatSync(target, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.mode}`;
}

function content(id: string, body = 'Use portable guidance.'): string {
  return `---\nname: ${id}\n---\n\n${body}\n`;
}

describe('project knowledge bundle import', () => {
  let tempRoot: string;
  let checkout: string;
  let machineData: string;
  let bundleDirectory: string;
  let store: ResolvedStore;

  beforeEach(() => {
    tempRoot = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundle-import-'))
    );
    checkout = path.join(tempRoot, 'checkout');
    machineData = path.join(tempRoot, 'machine-data');
    bundleDirectory = path.join(tempRoot, 'transport-store', 'rasen', 'knowledge-bundles');
    fs.mkdirSync(checkout, { recursive: true });
    fs.mkdirSync(bundleDirectory, { recursive: true });
    store = {
      root: path.join(machineData, 'project-knowledge', PROJECT_ID),
      dir: path.join(
        machineData,
        'project-knowledge',
        PROJECT_ID,
        'learned-skills'
      ),
      owner: { type: 'project', projectId: PROJECT_ID },
      projectId: PROJECT_ID,
      lockPath: path.join(machineData, 'learned-skill-locks', 'project.lock'),
    };
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function manifest(
    id: string,
    overrides: Partial<LearnedSkillManifestV2> = {}
  ): LearnedSkillManifestV2 {
    const canonical = content(id);
    return {
      version: 2,
      scope: 'project',
      owner: { type: 'project', projectId: PROJECT_ID },
      id,
      knowledgeKey: `${id}-key`,
      status: 'active',
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(canonical),
      description: `Portable guidance for ${id}.`,
      applicability: { mode: 'all', markers: ['package.json'] },
      evidence: [],
      sources: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...overrides,
    };
  }

  function record(
    id: string,
    overrides: Partial<LearnedSkillManifestV2> = {},
    body = 'Use portable guidance.'
  ): KnowledgeBundle['records'][number] {
    const canonical = content(id, body);
    const managed = manifest(id, {
      contentDigest: digestContent(canonical),
      ...overrides,
    });
    return createKnowledgeBundleRecord({
      id,
      knowledgeKey: managed.knowledgeKey,
      contentDigest: managed.contentDigest,
      manifest: managed,
      content: canonical,
    });
  }

  function writeBundle(
    records: KnowledgeBundle['records'],
    projectId = PROJECT_ID,
    fileName = `${randomUUID()}.json`
  ): string {
    const bundle = createKnowledgeBundle({
      bundleId: randomUUID(),
      projectId,
      createdAt: CREATED_AT,
      baseProjectCommit: BASE_COMMIT,
      records,
    });
    const file = path.join(bundleDirectory, fileName);
    fs.writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
    return file;
  }

  function writeLocal(
    id: string,
    overrides: Partial<LearnedSkillManifestV2> = {},
    body = 'Use portable guidance.',
    lineEnding: '\n' | '\r\n' = '\n'
  ): string {
    const directory = path.join(store.dir, id);
    const canonical = content(id, body);
    const managed = manifest(id, {
      contentDigest: digestContent(canonical),
      ...overrides,
    });
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'learned-skill.yaml'),
      serializeManifest(managed)
    );
    fs.writeFileSync(
      path.join(directory, 'SKILL.md'),
      canonical.replaceAll('\n', lineEnding)
    );
    return directory;
  }

  function options(
    bundle: string,
    overrides: ImportKnowledgeBundleOptions['dependencies'] = {}
  ): ImportKnowledgeBundleOptions {
    return {
      bundle,
      project: PROJECT_ID,
      dependencies: {
        resolveProject: async (selector) =>
          selector === PROJECT_ID || selector === checkout
            ? {
                root: checkout,
                ref: {
                  projectId: PROJECT_ID,
                  name: 'portable-project',
                  root: checkout,
                },
              }
            : null,
        resolveProjectStore: async () => ({ ok: true, store }),
        ...overrides,
      },
    };
  }

  function healthyRoot(root: string): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, 'rasen', 'config.yaml'),
      'schema: spec-driven\n'
    );
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
    return fs.realpathSync.native(root);
  }

  it('imports every new record atomically in deterministic identifier order', async () => {
    const bundle = writeBundle([
      record('portable-zeta-routing'),
      record('portable-alpha-routing'),
    ]);
    const beforeCheckout = snapshotTree(checkout);
    const beforeTransport = snapshotTree(path.join(tempRoot, 'transport-store'));

    const result = await importKnowledgeBundle(options(bundle));

    expect(result).toMatchObject({
      state: 'imported',
      projectId: PROJECT_ID,
      changed: true,
      refused: false,
      added: [
        { id: 'portable-alpha-routing' },
        { id: 'portable-zeta-routing' },
      ],
      alreadyPresent: [],
      conflicts: [],
    });
    expect(snapshotTree(checkout)).toEqual(beforeCheckout);
    expect(snapshotTree(path.join(tempRoot, 'transport-store'))).toEqual(beforeTransport);
    for (const id of ['portable-alpha-routing', 'portable-zeta-routing']) {
      const read = readCanonicalRecord(path.join(store.dir, id), 'project', store.owner);
      expect(read).toMatchObject({
        kind: 'managed',
        record: {
          manifest: {
            version: 2,
            scope: 'project',
            owner: { type: 'project', projectId: PROJECT_ID },
            sources: [],
          },
        },
      });
    }
  });

  it('moves project-owned records between two machine homes and treats a cloned Store as transport only', async () => {
    const machineAData = path.join(tempRoot, 'machine-a-data');
    const machineBData = path.join(tempRoot, 'machine-b-data');
    const checkoutA = path.join(tempRoot, 'machine-a-checkout');
    const checkoutB = path.join(tempRoot, 'machine-b-checkout');
    const carry = path.join(tempRoot, 'carry');
    const transportStore = path.join(tempRoot, 'cloned-team-store');
    for (const directory of [checkoutA, checkoutB, carry, transportStore]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    const machineAHome = resolveProjectKnowledgeHome(PROJECT_ID, {
      globalDataDir: machineAData,
    });
    const machineBHome = resolveProjectKnowledgeHome(PROJECT_ID, {
      globalDataDir: machineBData,
    });
    const machineBStore: ResolvedStore = {
      root: machineBHome.root,
      dir: machineBHome.catalogDir,
      owner: { type: 'project', projectId: PROJECT_ID },
      projectId: PROJECT_ID,
      lockPath: path.join(machineBData, 'learned-skill-locks', 'project.lock'),
    };
    const writeMachineARecord = (id: string): void => {
      const canonical = content(id);
      const directory = path.join(machineAHome.catalogDir, id);
      const managed = manifest(id, {
        owner: { type: 'project', projectId: PROJECT_ID },
        contentDigest: digestContent(canonical),
        sources: [
          {
            owner: { type: 'project', projectId: PROJECT_ID },
            id: 'portable-source-routing',
            knowledgeKey: 'portable-source-routing-key',
          },
        ],
      });
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'learned-skill.yaml'),
        serializeManifest(managed)
      );
      fs.writeFileSync(path.join(directory, 'SKILL.md'), canonical);
    };
    const exportOptions = (to: string) => ({
      project: PROJECT_ID,
      to,
      dependencies: {
        resolveProject: async () => ({
          root: checkoutA,
          ref: {
            projectId: PROJECT_ID,
            name: 'portable-project',
            root: checkoutA,
          },
        }),
        resolveKnowledgeHome: () => machineAHome,
        readBaseProjectCommit: async () => BASE_COMMIT,
        bundleId: randomUUID,
        now: () => new Date(CREATED_AT),
      },
    });
    const importOnMachineB = (bundlePath: string) =>
      importKnowledgeBundle({
        bundle: bundlePath,
        project: checkoutB,
        dependencies: {
          resolveProject: async () => ({
            root: checkoutB,
            ref: {
              projectId: PROJECT_ID,
              name: 'portable-project',
              root: checkoutB,
            },
          }),
          resolveProjectStore: async () => ({ ok: true, store: machineBStore }),
        },
      });

    writeMachineARecord('portable-machine-routing');
    const directBundle = path.join(carry, 'direct.bundle.json');
    await exportKnowledgeBundle(exportOptions(directBundle));
    const directResult = await importOnMachineB(directBundle);
    expect(directResult.added.map((entry) => entry.id)).toEqual([
      'portable-machine-routing',
    ]);
    expect(
      readCanonicalRecord(
        path.join(machineBStore.dir, 'portable-machine-routing'),
        'project',
        machineBStore.owner
      )
    ).toMatchObject({
      kind: 'managed',
      record: {
        manifest: {
          owner: { type: 'project', projectId: PROJECT_ID },
          sources: [],
        },
      },
    });

    writeMachineARecord('portable-store-route');
    fs.mkdirSync(path.join(transportStore, '.git'), { recursive: true });
    fs.writeFileSync(path.join(transportStore, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(transportStore, '.git', 'index'), 'index sentinel');
    fs.writeFileSync(path.join(transportStore, '.git', 'config'), 'remote sentinel');
    const userBundle = path.join(carry, 'store-route.bundle.json');
    const transported = await exportKnowledgeBundle({
      ...exportOptions(userBundle),
      toStore: 'team-store',
      dependencies: {
        ...exportOptions(userBundle).dependencies,
        resolveStore: async () => ({
          kind: 'resolved' as const,
          store: {
            type: 'store' as const,
            uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            id: 'team-store',
            root: transportStore,
          },
          pointer: { form: 'alias' as const, id: 'team-store' },
          resolvedBy: 'alias' as const,
          diagnostics: [],
        }),
      },
    });
    expect(transported.transport).toBeDefined();
    const beforeStoreImport = snapshotTree(transportStore);

    const storeResult = await importOnMachineB(transported.transport!.destination);

    expect(storeResult).toMatchObject({
      added: [{ id: 'portable-store-route' }],
      alreadyPresent: [{ id: 'portable-machine-routing' }],
    });
    expect(snapshotTree(transportStore)).toEqual(beforeStoreImport);
    const imported = readCanonicalRecord(
      path.join(machineBStore.dir, 'portable-store-route'),
      'project',
      machineBStore.owner
    );
    expect(imported.kind).toBe('managed');
    if (imported.kind !== 'managed') return;
    expect(imported.record.manifest).toMatchObject({
      owner: { type: 'project', projectId: PROJECT_ID },
      sources: [],
    });
  });

  it('preserves evidence facts but records no transport or publication source', async () => {
    const evidence: NormalizedEvidenceReference[] = [
      {
        owner: { type: 'project', projectId: OTHER_PROJECT_ID },
        change: 'source-change',
        artifact: 'design',
        digest: `sha256:${'b'.repeat(64)}`,
      },
      {
        owner: { type: 'store', uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        change: 'store-source-change',
        artifact: 'review',
        digest: `sha256:${'c'.repeat(64)}`,
      },
    ];
    const bundle = writeBundle([
      record('portable-evidence-routing', {
        evidence,
        sources: [
          {
            owner: { type: 'project', projectId: OTHER_PROJECT_ID },
            id: 'portable-source-routing',
            knowledgeKey: 'portable-source-routing-key',
          },
          {
            owner: { type: 'store', uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
            id: 'portable-store-routing',
            knowledgeKey: 'portable-store-routing-key',
          },
        ],
      }),
    ]);

    await importKnowledgeBundle(options(bundle));
    const read = readCanonicalRecord(
      path.join(store.dir, 'portable-evidence-routing'),
      'project',
      store.owner
    );

    expect(read.kind).toBe('managed');
    if (read.kind !== 'managed') return;
    expect(read.record.manifest).toMatchObject({
      owner: { type: 'project', projectId: PROJECT_ID },
      evidence,
      sources: [],
    });
    expect(read.record.evidence).toEqual(evidence);
  });

  it('normalizes version-1 evidence while preserving its original project owner', async () => {
    const id = 'portable-v1-evidence-routing';
    const canonical = content(id);
    const source: LearnedSkillManifestV1 = {
      version: 1,
      scope: 'project',
      id,
      knowledgeKey: `${id}-key`,
      status: 'active',
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(canonical),
      description: `Portable guidance for ${id}.`,
      applicability: { mode: 'all', markers: ['package.json'] },
      evidence: [
        {
          projectId: OTHER_PROJECT_ID,
          change: 'source-change',
          artifact: 'review',
          digest: `sha256:${'d'.repeat(64)}`,
        },
      ],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    };
    const bundle = writeBundle([
      createKnowledgeBundleRecord({
        id,
        knowledgeKey: source.knowledgeKey,
        contentDigest: source.contentDigest,
        manifest: source,
        content: canonical,
      }),
    ]);

    await importKnowledgeBundle(options(bundle));
    const read = readCanonicalRecord(path.join(store.dir, id), 'project', store.owner);

    expect(read.kind).toBe('managed');
    if (read.kind !== 'managed') return;
    expect(read.record.manifest).toMatchObject({
      version: 2,
      owner: { type: 'project', projectId: PROJECT_ID },
      sources: [],
      evidence: [
        {
          owner: { type: 'project', projectId: OTHER_PROJECT_ID },
          change: 'source-change',
          artifact: 'review',
          digest: `sha256:${'d'.repeat(64)}`,
        },
      ],
    });
  });

  it('earns no evidence, membership, or approval grant from arrival by import', async () => {
    const importedRoot = healthyRoot(path.join(tempRoot, 'imported-project'));
    const importedHome = await resolveProjectHome(importedRoot, {
      globalDataDir: machineData,
    });
    expect(importedHome).not.toBeNull();
    if (importedHome === null) return;
    const importedStore = await resolveCanonicalStore('project', {
      projectRoot: importedRoot,
      globalDataDir: machineData,
    });
    expect(importedStore.ok).toBe(true);
    if (!importedStore.ok) return;

    const id = 'portable-publication-gate';
    const importedBundle = writeBundle(
      [
        record(id, {
          owner: {
            type: 'project',
            projectId: importedHome.projectId,
          },
        }),
      ],
      importedHome.projectId,
      'publication-gate.json'
    );
    await importKnowledgeBundle({
      bundle: importedBundle,
      project: importedHome.projectId,
      context: { globalDataDir: machineData },
      dependencies: {
        resolveProject: async () => ({
          root: importedRoot,
          ref: {
            projectId: importedHome.projectId,
            name: 'imported-project',
            root: importedRoot,
          },
        }),
        resolveProjectStore: async () => importedStore,
      },
    });

    const secondRoot = healthyRoot(path.join(tempRoot, 'second-project'));
    const secondHome = await resolveProjectHome(secondRoot, {
      globalDataDir: machineData,
    });
    expect(secondHome).not.toBeNull();
    if (secondHome === null) return;
    const secondContext: LearnedSkillContext = {
      projectRoot: secondRoot,
      globalDataDir: machineData,
    };
    const secondPlan = await planLearnedSkillMutation(
      {
        operation: 'upsert',
        scope: 'project',
        id,
        knowledgeKey: `${id}-key`,
        description: 'Portable publication gate.',
        instructions: 'Keep project knowledge scoped until publication is earned.',
        applicability: { mode: 'all', markers: ['package.json'] },
        evidence: [
          {
            projectId: secondHome.projectId,
            change: 'second-source',
            artifact: 'review',
            digest: `sha256:${'e'.repeat(64)}`,
          },
        ],
      },
      secondContext
    );
    const secondCommit = await commitLearnedSkillPlan(secondPlan, secondContext);
    expect(secondCommit.outcome).toBe('created');

    const transportStoreRoot = healthyRoot(path.join(tempRoot, 'publication-store'));
    const transportStoreUid = mintStoreUid();
    const transportStoreId = 'portable-publication-store';
    await writeStoreMetadataState(transportStoreRoot, {
      version: 2,
      uid: transportStoreUid,
      id: transportStoreId,
    });
    await registerStore({
      id: transportStoreId,
      localPath: transportStoreRoot,
      globalDataDir: machineData,
    });
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: transportStoreRoot,
      selector: { store: transportStoreUid },
      requestedScope: 'store',
      sessionContext: null,
      globalDataDir: machineData,
    });
    const storeContext: LearnedSkillContext = {
      execution,
      globalDataDir: machineData,
    };
    const importedSource: PromotionSourceLocator = {
      owner: {
        type: 'project',
        projectId: importedHome.projectId,
      },
      id,
      knowledgeKey: `${id}-key`,
    };
    const secondSource: PromotionSourceLocator = {
      owner: {
        type: 'project',
        projectId: secondHome.projectId,
      },
      id,
      knowledgeKey: `${id}-key`,
    };
    const publication = (
      sources: PromotionSourceLocator[]
    ): LearnedSkillMutationRequest =>
      ({
        version: 2,
        operation: 'upsert',
        scope: 'store',
        owner: {
          type: 'store',
          uid: transportStoreUid,
          id: transportStoreId,
        },
        id,
        knowledgeKey: `${id}-key`,
        description: 'Portable publication gate.',
        instructions: 'Keep project knowledge scoped until publication is earned.',
        applicability: { mode: 'all', markers: ['package.json'] },
        evidence: [],
        sources,
      }) as LearnedSkillMutationRequest;

    const insufficient = await planLearnedSkillMutation(
      publication([importedSource]),
      storeContext
    );
    expect(insufficient).toMatchObject({
      action: 'blocked',
      block: { code: 'store_evidence_insufficient' },
    });

    const withoutMembership = await planLearnedSkillMutation(
      publication([importedSource, secondSource]),
      storeContext
    );
    expect(withoutMembership).toMatchObject({
      action: 'blocked',
      block: { code: 'store_membership_invalid' },
    });

    await writeStoreProjectRecord(transportStoreRoot, {
      version: 1,
      projectId: importedHome.projectId,
      roles: { planning: false, knowledge: true },
    });
    await writeStoreProjectRecord(transportStoreRoot, {
      version: 1,
      projectId: secondHome.projectId,
      roles: { planning: false, knowledge: true },
    });
    const requiresApproval = await planLearnedSkillMutation(
      publication([importedSource, secondSource]),
      storeContext
    );
    expect(requiresApproval).toMatchObject({
      action: 'create',
      requiresStoreApproval: true,
    });
    const refusedCommit = await commitLearnedSkillPlan(
      requiresApproval,
      storeContext
    );
    expect(refusedCommit).toMatchObject({
      outcome: 'blocked',
      block: { code: 'store_approval_required' },
    });
    expect(
      fs.existsSync(path.join(transportStoreRoot, 'rasen', 'learned-skills'))
    ).toBe(false);
  });

  it('dry-run reports every class and creates no lock, directory, file, or debris', async () => {
    writeLocal('portable-identical-routing', {}, 'Use portable guidance.', '\r\n');
    writeLocal('portable-content-routing', {}, 'Local divergent guidance.');
    writeLocal('portable-status-routing', { status: 'active' });
    const occupied = path.join(store.dir, 'portable-occupied-routing');
    fs.mkdirSync(occupied, { recursive: true });
    fs.writeFileSync(path.join(occupied, 'foreign.txt'), 'foreign bytes');
    const bundle = writeBundle([
      record('portable-new-routing'),
      record('portable-identical-routing'),
      record('portable-content-routing', {}, 'Bundle divergent guidance.'),
      record('portable-status-routing', {
        status: 'retired',
        retiredAt: CREATED_AT,
        retirementReason: 'Retired on the exporting machine.',
      }),
      record('portable-occupied-routing'),
    ]);
    const before = snapshotTree(tempRoot);
    let lockAttempts = 0;

    const result = await importKnowledgeBundle({
      ...options(bundle, {
        acquireLock: async () => {
          lockAttempts += 1;
          throw new Error('dry-run must not acquire');
        },
      }),
      dryRun: true,
    });

    expect(result).toMatchObject({
      state: 'previewed',
      changed: false,
      added: [{ id: 'portable-new-routing' }],
      alreadyPresent: [{ id: 'portable-identical-routing' }],
      conflicts: [
        { id: 'portable-content-routing', reason: 'content-differs' },
        { id: 'portable-occupied-routing', reason: 'target-occupied' },
        { id: 'portable-status-routing', reason: 'lifecycle-differs' },
      ],
    });
    expect(lockAttempts).toBe(0);
    expect(snapshotTree(tempRoot)).toEqual(before);
  });

  it('applies exactly the valid new and already-present decisions from an unchanged preview', async () => {
    writeLocal('portable-preview-present');
    const bundle = writeBundle([
      record('portable-preview-new'),
      record('portable-preview-present'),
    ]);
    const beforePreview = snapshotTree(tempRoot);

    const preview = await importKnowledgeBundle({
      ...options(bundle),
      dryRun: true,
    });

    expect(preview).toMatchObject({
      state: 'previewed',
      refused: false,
      changed: false,
    });
    expect(snapshotTree(tempRoot)).toEqual(beforePreview);

    const applied = await importKnowledgeBundle(options(bundle));

    expect(applied.state).toBe('imported');
    expect(applied.changed).toBe(true);
    expect(applied.added).toEqual(preview.added);
    expect(applied.alreadyPresent).toEqual(preview.alreadyPresent);
    expect(applied.added.map((entry) => entry.id)).toEqual([
      'portable-preview-new',
    ]);
    expect(applied.alreadyPresent.map((entry) => entry.id)).toEqual([
      'portable-preview-present',
    ]);
  });

  it('classifies a target read exception as occupied without changing the catalog', async () => {
    const id = 'portable-unreadable-routing';
    const bundle = writeBundle([record(id)]);
    const before = snapshotTree(store.root);

    const result = await importKnowledgeBundle({
      ...options(bundle, {
        readRecord: (directory, scope, owner) => {
          if (path.basename(directory) === id) {
            throw new Error('injected unreadable target');
          }
          return readCanonicalRecord(directory, scope, owner);
        },
      }),
      dryRun: true,
    });

    expect(result).toMatchObject({
      state: 'previewed',
      changed: false,
      refused: true,
      conflicts: [
        {
          id,
          reason: 'target-occupied',
          local: {
            kind: 'occupied',
            description: expect.stringContaining('injected unreadable target'),
          },
        },
      ],
    });
    expect(snapshotTree(store.root)).toEqual(before);
  });

  it('one conflict among five blocks every record and leaves the catalog byte-identical', async () => {
    writeLocal('portable-conflict-routing', {}, 'Local content.');
    writeLocal('portable-unrelated-routing');
    const bundle = writeBundle([
      record('portable-first-routing'),
      record('portable-second-routing'),
      record('portable-conflict-routing', {}, 'Bundle content.'),
      record('portable-fourth-routing'),
      record('portable-fifth-routing'),
    ]);
    const before = snapshotTree(store.root);
    let lockAttempts = 0;

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          acquireLock: async () => {
            lockAttempts += 1;
            throw new Error('conflict must refuse before lock');
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_conflict',
      changed: false,
      plan: {
        conflicts: [{ id: 'portable-conflict-routing' }],
      },
    });

    expect(lockAttempts).toBe(0);
    expect(snapshotTree(store.root)).toEqual(before);

    fs.rmSync(path.join(store.dir, 'portable-conflict-routing'), {
      recursive: true,
    });
    const retry = await importKnowledgeBundle(options(bundle));
    expect(retry).toMatchObject({
      changed: true,
      added: [
        { id: 'portable-conflict-routing' },
        { id: 'portable-fifth-routing' },
        { id: 'portable-first-routing' },
        { id: 'portable-fourth-routing' },
        { id: 'portable-second-routing' },
      ],
      conflicts: [],
    });
    expect(
      readCanonicalRecord(
        path.join(store.dir, 'portable-unrelated-routing'),
        'project',
        store.owner
      ).kind
    ).toBe('managed');
  });

  it('rolls back all earlier publications when the second published record fails verification', async () => {
    const bundle = writeBundle([
      record('portable-first-routing'),
      record('portable-second-routing'),
      record('portable-third-routing'),
    ]);
    const before = snapshotTree(store.root);

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          io: {
            beforePublishedVerify: (_id, index) => {
              if (index === 1) throw new Error('injected second verification failure');
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_transaction_failed',
      changed: false,
    });

    expect(snapshotTree(store.root)).toEqual(before);
    expect(
      fs.existsSync(path.join(machineData, 'project-knowledge', PROJECT_ID))
    ).toBe(false);
  });

  it.each([
    ['stage write', 'write'],
    ['stage verification', 'verify'],
  ] as const)(
    'leaves no catalog or staging debris after an injected %s failure',
    async (_label, failurePoint) => {
      const bundle = writeBundle([
        record('portable-first-routing'),
        record('portable-second-routing'),
      ]);
      const projectKnowledgeRoot = path.join(machineData, 'project-knowledge');
      const before = snapshotTree(projectKnowledgeRoot);

      await expect(
        importKnowledgeBundle(
          options(bundle, {
            io:
              failurePoint === 'write'
                ? {
                    beforeStageWrite: (_id, index) => {
                      if (index === 1) throw new Error('injected stage write failure');
                    },
                  }
                : {
                    beforeStageVerify: (_id, index) => {
                      if (index === 0) {
                        throw new Error('injected stage verification failure');
                      }
                    },
                  },
          })
        )
      ).rejects.toMatchObject({
        code: 'knowledge_bundle_import_transaction_failed',
        changed: false,
      });

      expect(snapshotTree(projectKnowledgeRoot)).toEqual(before);
      expect(fs.existsSync(store.root)).toBe(false);
    }
  );

  it.each([
    ['catalog parent', 'null'],
    ['catalog parent', 'throw'],
    ['private staging', 'null'],
    ['private staging', 'throw'],
  ] as const)(
    'registers %s ownership before an injected post-create identity %s',
    async (creationKind, failureKind) => {
      const bundle = writeBundle([record('portable-identity-probe-routing')]);
      const projectKnowledgeRoot = path.join(machineData, 'project-knowledge');
      const before = snapshotTree(projectKnowledgeRoot);
      let injected = false;
      const injectedIdentity = (target: string): string | null => {
        const exists = fs.existsSync(target);
        const isInjectionTarget =
          creationKind === 'catalog parent'
            ? path.resolve(target) === path.resolve(store.root)
            : path.basename(target).startsWith(
                '.rasen-knowledge-bundle-import-'
              );
        if (!injected && exists && isInjectionTarget) {
          injected = true;
          if (failureKind === 'throw') {
            throw new Error('injected post-create identity failure');
          }
          return null;
        }
        if (!exists) return null;
        return identity(target);
      };

      await expect(
        importKnowledgeBundle(
          options(bundle, {
            io: { pathIdentity: injectedIdentity },
          })
        )
      ).rejects.toMatchObject({
        code: 'knowledge_bundle_import_transaction_failed',
        changed: false,
      });

      expect(injected).toBe(true);
      expect(snapshotTree(projectKnowledgeRoot)).toEqual(before);
      expect(fs.existsSync(store.root)).toBe(false);
    }
  );

  it('never replaces an empty target that appears in the final publication window', async () => {
    fs.mkdirSync(store.dir, { recursive: true });
    const id = 'portable-final-window-routing';
    const target = path.join(store.dir, id);
    const bundle = writeBundle([record(id)]);

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          io: {
            createDirectoryExclusive: (directory) => {
              if (path.resolve(directory) === path.resolve(target)) {
                fs.mkdirSync(target);
              }
              fs.mkdirSync(directory, { mode: 0o700 });
              return identity(directory);
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_transaction_failed',
      changed: false,
    });

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readdirSync(target)).toEqual([]);
    expect(
      fs.existsSync(path.join(target, 'learned-skill.yaml'))
    ).toBe(false);
    expect(
      fs.readdirSync(store.dir).some((name) =>
        name.startsWith('.rasen-knowledge-bundle-import-')
      )
    ).toBe(false);
  });

  it('rolls back when an injected exclusive file publication links and then throws', async () => {
    const bundle = writeBundle([
      record('portable-first-routing'),
      record('portable-second-routing'),
    ]);
    const before = snapshotTree(store.root);
    let publications = 0;
    const linkedIdentities: Array<[string, string]> = [];

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          io: {
            publishStagedFileExclusive: (stagedFile, targetFile) => {
              fs.linkSync(stagedFile, targetFile);
              linkedIdentities.push([
                identity(stagedFile),
                identity(targetFile),
              ]);
              publications += 1;
              if (publications === 3) {
                throw new Error('injected post-publication failure');
              }
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_transaction_failed',
    });

    expect(publications).toBe(3);
    expect(linkedIdentities.every(([staged, target]) => staged === target)).toBe(
      true
    );
    expect(snapshotTree(store.root)).toEqual(before);
  });

  it('retains an external same-byte file that wins the exclusive-link race', async () => {
    fs.mkdirSync(store.dir, { recursive: true });
    const id = 'portable-same-byte-eexist';
    const target = path.join(store.dir, id);
    const bundle = writeBundle([record(id)]);
    let stagedIdentity = '';
    let externalIdentity = '';
    let expectedBytes = '';

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          io: {
            publishStagedFileExclusive: (stagedFile, targetFile) => {
              expectedBytes = fs.readFileSync(stagedFile, 'utf8');
              fs.copyFileSync(
                stagedFile,
                targetFile,
                fs.constants.COPYFILE_EXCL
              );
              stagedIdentity = identity(stagedFile);
              externalIdentity = identity(targetFile);
              fs.linkSync(stagedFile, targetFile);
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_rollback_failed',
      changed: 'unknown',
      retainedPaths: [target],
    });

    expect(externalIdentity).not.toBe(stagedIdentity);
    expect(fs.readFileSync(path.join(target, 'learned-skill.yaml'), 'utf8')).toBe(
      expectedBytes
    );
    expect(
      fs.readdirSync(store.root).some((name) =>
        name.startsWith('.rasen-knowledge-bundle-import-')
      )
    ).toBe(false);
  });

  it('retains a successful link replaced by a distinct same-byte inode before rollback', async () => {
    fs.mkdirSync(store.dir, { recursive: true });
    const id = 'portable-same-byte-replacement';
    const target = path.join(store.dir, id);
    const bundle = writeBundle([record(id)]);
    const stagedFiles = new Map<string, string>();
    let linkedIdentity = '';
    let replacementIdentity = '';

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          io: {
            publishStagedFileExclusive: (stagedFile, targetFile) => {
              fs.linkSync(stagedFile, targetFile);
              stagedFiles.set(path.basename(targetFile), stagedFile);
            },
            beforePublishedVerify: () => {
              const name = 'learned-skill.yaml';
              const stagedFile = stagedFiles.get(name);
              if (stagedFile === undefined) {
                throw new Error('missing staged manifest injection path');
              }
              const targetFile = path.join(target, name);
              const replacement = path.join(target, 'external-replacement.tmp');
              const expected = fs.readFileSync(stagedFile, 'utf8');
              linkedIdentity = identity(targetFile);
              fs.writeFileSync(replacement, expected, {
                encoding: 'utf8',
                flag: 'wx',
              });
              replacementIdentity = identity(replacement);
              fs.unlinkSync(targetFile);
              fs.renameSync(replacement, targetFile);
              throw new Error('injected same-byte inode replacement');
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_rollback_failed',
      changed: 'unknown',
      retainedPaths: [target],
      details: {
        rollback: expect.stringContaining('contents changed; retained'),
      },
    });

    expect(replacementIdentity).not.toBe(linkedIdentity);
    expect(identity(path.join(target, 'learned-skill.yaml'))).toBe(
      replacementIdentity
    );
    expect(
      fs.readdirSync(store.root).some((name) =>
        name.startsWith('.rasen-knowledge-bundle-import-')
      )
    ).toBe(false);
  });

  it('retains a transaction target whose contents changed before rollback', async () => {
    const bundle = writeBundle([record('portable-ambiguous-routing')]);
    const target = path.join(store.dir, 'portable-ambiguous-routing');

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          io: {
            beforePublishedVerify: () => {
              fs.writeFileSync(path.join(target, 'foreign.txt'), 'external occupant');
              throw new Error('injected failure after external target mutation');
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_rollback_failed',
      changed: 'unknown',
      retainedPaths: expect.arrayContaining([target]),
      details: {
        rollback: expect.stringContaining('contents changed; retained'),
      },
    });

    expect(fs.readFileSync(path.join(target, 'foreign.txt'), 'utf8')).toBe(
      'external occupant'
    );
  });

  it('returns imported facts with a warning when only empty staging cleanup is deferred', async () => {
    const bundle = writeBundle([record('portable-cleanup-routing')]);
    let stagingPath = '';

    const result = await importKnowledgeBundle(
      options(bundle, {
        io: {
          createPrivateStagingDirectory: (parent) => {
            stagingPath = fs.mkdtempSync(path.join(parent, '.rasen-knowledge-bundle-import-'));
            return { path: stagingPath, identity: identity(stagingPath) };
          },
          removeOwnedDirectory: (directory) => {
            if (directory === stagingPath) throw new Error('injected cleanup failure');
            fs.rmSync(directory, { recursive: true, force: true });
          },
        },
      })
    );

    expect(result).toMatchObject({
      state: 'imported',
      changed: true,
      added: [{ id: 'portable-cleanup-routing' }],
      warnings: [
        { code: 'base_project_commit_provenance' },
        { code: 'staging_cleanup_deferred' },
      ],
    });
    expect(
      readCanonicalRecord(
        path.join(store.dir, 'portable-cleanup-routing'),
        'project',
        store.owner
      ).kind
    ).toBe('managed');
    expect(fs.existsSync(stagingPath)).toBe(true);
    expect(fs.readdirSync(stagingPath)).toEqual(['portable-cleanup-routing']);
  });

  it('a second import is a byte-identical no-op and acquires no write authority', async () => {
    const bundle = writeBundle([record('portable-repeat-routing')]);
    await importKnowledgeBundle(options(bundle));
    const before = snapshotTree(store.root);
    let lockAttempts = 0;

    const result = await importKnowledgeBundle(
      options(bundle, {
        acquireLock: async () => {
          lockAttempts += 1;
          throw new Error('no-op must not acquire');
        },
      })
    );

    expect(result).toMatchObject({
      state: 'imported',
      changed: false,
      added: [],
      alreadyPresent: [{ id: 'portable-repeat-routing' }],
    });
    expect(lockAttempts).toBe(0);
    expect(snapshotTree(store.root)).toEqual(before);
  });

  it('recomputes target classification under the same canonical owner lock', async () => {
    const id = 'portable-drift-routing';
    const bundle = writeBundle([record(id)]);
    let lockedSnapshot: TreeEntry[] = [];
    let stagingAttempts = 0;
    let publicationAttempts = 0;

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          acquireLock: async (lockOptions) => {
            const lock = await acquireOwnerAwareFileLock(lockOptions);
            writeLocal(id, {}, 'Concurrent local content.');
            lockedSnapshot = snapshotTree(store.root);
            return lock;
          },
          io: {
            createPrivateStagingDirectory: () => {
              stagingAttempts += 1;
              throw new Error('drift must refuse before staging');
            },
            beforePublish: () => {
              publicationAttempts += 1;
            },
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_conflict',
      changed: false,
      plan: {
        added: [],
        conflicts: [{ id, reason: 'content-differs' }],
      },
    });
    expect(stagingAttempts).toBe(0);
    expect(publicationAttempts).toBe(0);
    expect(snapshotTree(store.root)).toEqual(lockedSnapshot);
    expect(
      readCanonicalRecord(path.join(store.dir, id), 'project', store.owner)
    ).toMatchObject({
      kind: 'managed',
      record: { content: content(id, 'Concurrent local content.') },
    });
  });

  it('refuses when the canonical store proves a different identity than the selector', async () => {
    const bundle = writeBundle([record('portable-identity-drift-routing')]);
    const otherStore: ResolvedStore = {
      root: path.join(machineData, 'project-knowledge', OTHER_PROJECT_ID),
      dir: path.join(
        machineData,
        'project-knowledge',
        OTHER_PROJECT_ID,
        'learned-skills'
      ),
      owner: { type: 'project', projectId: OTHER_PROJECT_ID },
      projectId: OTHER_PROJECT_ID,
      lockPath: path.join(
        machineData,
        'learned-skill-locks',
        'other-project.lock'
      ),
    };

    await expect(
      importKnowledgeBundle(
        options(bundle, {
          resolveProjectStore: async () => ({ ok: true, store: otherStore }),
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_catalog_drift',
      changed: false,
      details: {
        targetProjectId: PROJECT_ID,
        catalogProjectId: OTHER_PROJECT_ID,
      },
    });
    expect(snapshotTree(otherStore.root)).toEqual([]);
    expect(snapshotTree(store.root)).toEqual([]);
  });

  it('wraps a thrown project resolver as a typed non-writing refusal', async () => {
    const bundle = writeBundle([record('portable-project-reader-routing')]);
    let storeResolutions = 0;
    let stagingAttempts = 0;
    let publicationAttempts = 0;
    const before = snapshotTree(store.root);

    const promise = importKnowledgeBundle(
      options(bundle, {
        resolveProject: async () => {
          throw new Error('machine project registry could not be parsed');
        },
        resolveProjectStore: async () => {
          storeResolutions += 1;
          return { ok: true, store };
        },
        io: {
          createPrivateStagingDirectory: () => {
            stagingAttempts += 1;
            throw new Error('staging unexpectedly started');
          },
          publishStagedFileExclusive: () => {
            publicationAttempts += 1;
          },
        },
      })
    );

    await expect(promise).rejects.toBeInstanceOf(KnowledgeBundleImportError);
    await expect(promise).rejects.toMatchObject({
      code: 'knowledge_bundle_import_project_unavailable',
      changed: false,
      details: {
        selector: PROJECT_ID,
        reason: 'project_resolver_threw',
        diagnostic: 'machine project registry could not be parsed',
        repair: expect.stringContaining('project registry'),
      },
    });
    expect(storeResolutions).toBe(0);
    expect(stagingAttempts).toBe(0);
    expect(publicationAttempts).toBe(0);
    expect(snapshotTree(store.root)).toEqual(before);
  });

  it('wraps an initially thrown project Store resolver as a catalog refusal', async () => {
    const bundle = writeBundle([record('portable-initial-store-reader-routing')]);
    let lockAttempts = 0;
    let stagingAttempts = 0;
    let publicationAttempts = 0;
    const before = snapshotTree(store.root);

    const promise = importKnowledgeBundle(
      options(bundle, {
        resolveProjectStore: async () => {
          throw new Error('canonical project home is unreadable');
        },
        acquireLock: async () => {
          lockAttempts += 1;
          throw new Error('lock unexpectedly acquired');
        },
        io: {
          createPrivateStagingDirectory: () => {
            stagingAttempts += 1;
            throw new Error('staging unexpectedly started');
          },
          publishStagedFileExclusive: () => {
            publicationAttempts += 1;
          },
        },
      })
    );

    await expect(promise).rejects.toBeInstanceOf(KnowledgeBundleImportError);
    await expect(promise).rejects.toMatchObject({
      code: 'knowledge_bundle_import_catalog_unavailable',
      changed: false,
      details: {
        reason: 'resolver_threw',
        diagnostic: 'canonical project home is unreadable',
        repair: expect.stringContaining('canonical project knowledge home'),
      },
    });
    expect(lockAttempts).toBe(0);
    expect(stagingAttempts).toBe(0);
    expect(publicationAttempts).toBe(0);
    expect(snapshotTree(store.root)).toEqual(before);
  });

  it('wraps a project Store resolver throw under the lock before staging', async () => {
    const bundle = writeBundle([record('portable-locked-store-reader-routing')]);
    let storeResolutions = 0;
    let stagingAttempts = 0;
    let publicationAttempts = 0;
    const before = snapshotTree(store.root);

    const promise = importKnowledgeBundle(
      options(bundle, {
        resolveProjectStore: async () => {
          storeResolutions += 1;
          if (storeResolutions === 1) return { ok: true, store };
          throw new Error('project catalog registry changed into invalid data');
        },
        io: {
          createPrivateStagingDirectory: () => {
            stagingAttempts += 1;
            throw new Error('staging unexpectedly started');
          },
          publishStagedFileExclusive: () => {
            publicationAttempts += 1;
          },
        },
      })
    );

    await expect(promise).rejects.toBeInstanceOf(KnowledgeBundleImportError);
    await expect(promise).rejects.toMatchObject({
      code: 'knowledge_bundle_import_catalog_unavailable',
      changed: false,
      details: {
        reason: 'resolver_threw',
        diagnostic: 'project catalog registry changed into invalid data',
        repair: expect.stringContaining('canonical project knowledge home'),
      },
    });
    expect(storeResolutions).toBe(2);
    expect(stagingAttempts).toBe(0);
    expect(publicationAttempts).toBe(0);
    expect(fs.existsSync(store.lockPath)).toBe(false);
    expect(snapshotTree(store.root)).toEqual(before);
  });

  it('names a wrong canonical project and rejects an invalid final record before catalog resolution', async () => {
    const wrongProject = writeBundle(
      [
        record('portable-project-routing', {
          owner: { type: 'project', projectId: OTHER_PROJECT_ID },
        }),
      ],
      OTHER_PROJECT_ID,
      'wrong-project.json'
    );
    let storeResolutions = 0;

    await expect(
      importKnowledgeBundle(
        options(wrongProject, {
          resolveProjectStore: async () => {
            storeResolutions += 1;
            return { ok: true, store };
          },
        })
      )
    ).rejects.toMatchObject({
      code: 'knowledge_bundle_import_project_mismatch',
      details: {
        bundleProjectId: OTHER_PROJECT_ID,
        targetProjectId: PROJECT_ID,
      },
    });

    const invalidLast = writeBundle(
      [record('portable-valid-routing')],
      PROJECT_ID,
      'invalid-last.json'
    );
    const raw = JSON.parse(fs.readFileSync(invalidLast, 'utf8')) as {
      records: Array<{ content: string }>;
    };
    raw.records.push({
      ...(raw.records[0] as object),
      content: 'tampered final content',
    } as { content: string });
    fs.writeFileSync(invalidLast, JSON.stringify(raw));
    const before = snapshotTree(tempRoot);

    const refusalFacts: Array<{
      code: string;
      message: string;
      details: Readonly<Record<string, string>>;
      issues: readonly { recordId?: string; field?: string; reason: string }[];
    }> = [];
    for (const dryRun of [true, false]) {
      try {
        await importKnowledgeBundle({ ...options(invalidLast), dryRun });
        throw new Error('invalid bundle unexpectedly imported');
      } catch (error) {
        expect(error).toBeInstanceOf(KnowledgeBundleImportError);
        const refusal = error as KnowledgeBundleImportError;
        expect(refusal).toMatchObject({
          code: 'knowledge_bundle_import_bundle_invalid',
          changed: false,
        });
        refusalFacts.push({
          code: refusal.code,
          message: refusal.message,
          details: refusal.details,
          issues: refusal.issues,
        });
      }
    }
    expect(refusalFacts[1]).toEqual(refusalFacts[0]);
    expect(storeResolutions).toBe(0);
    expect(snapshotTree(tempRoot)).toEqual(before);
  });

  it('rejects portable identifier collisions and reports every identifier issue', async () => {
    const first = record('portable-case-routing');
    const second = record('Portable-case-routing');
    const bundle = writeBundle([first, second]);

    await expect(importKnowledgeBundle(options(bundle))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof KnowledgeBundleImportError &&
        error.code === 'knowledge_bundle_import_record_id_collision' &&
        error.issues.some((issue) => issue.reason.includes('lowercase')) &&
        error.issues.some((issue) => issue.reason.includes('collides with'))
    );
    expect(snapshotTree(store.root)).toEqual([]);
  });

  describe('owner-aware import lock (B5)', () => {
    it('waits rather than stealing when the lock is held by a live process', async () => {
      const bundle = writeBundle([record('portable-lock-wait-routing')]);

      // Pre-acquire the import lock so the importer cannot proceed. The lock
      // content (PID + nonce) identifies the TEST as the live owner.
      const blocking = await acquireOwnerAwareFileLock({
        lockPath: store.lockPath,
        errorFor: () => new Error('test-blocking-lock'),
      });

      const started = Date.now();
      await expect(
        importKnowledgeBundle(
          options(bundle, {
            // Use a short deadline so the test doesn't wait 5 seconds.
            acquireLock: (lockOpts) =>
              acquireOwnerAwareFileLock({ ...lockOpts, deadlineMs: 400, pollMs: 50 }),
          })
        )
      ).rejects.toMatchObject({
        code: 'knowledge_bundle_import_lock_failed',
        details: { reason: 'timeout' },
      });
      const elapsed = Date.now() - started;

      // Timed out near the 400 ms deadline — NOT after the OLD 30 s mtime
      // threshold. The whole point of B5 is that a live owner is never stolen.
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(5_000);

      // Lock was NOT stolen: our token is still on disk byte-for-byte.
      expect(fs.readFileSync(store.lockPath, 'utf-8')).toBe(blocking.token);

      // Release and retry — import succeeds.
      await releaseOwnerAwareFileLock(blocking);
      const result = await importKnowledgeBundle(options(bundle));
      expect(result.state).toBe('imported');
      expect(result.changed).toBe(true);

      // Lock file cleaned up after a successful import.
      expect(fs.existsSync(store.lockPath)).toBe(false);
    });

    it('serializes two concurrent imports so both records survive', async () => {
      const bundleA = writeBundle([record('portable-concurrent-a')]);
      const bundleB = writeBundle([record('portable-concurrent-b')]);

      const [a, b] = await Promise.all([
        importKnowledgeBundle(options(bundleA)),
        // Small stagger so A wins the first acquire; B then waits.
        (async () => {
          await new Promise((r) => setTimeout(r, 10));
          return importKnowledgeBundle(options(bundleB));
        })(),
      ]);

      expect(a.state).toBe('imported');
      expect(b.state).toBe('imported');

      // BOTH records present — no silent loss from a stale-steal race.
      const readA = readCanonicalRecord(
        path.join(store.dir, 'portable-concurrent-a'),
        'project',
        store.owner
      );
      const readB = readCanonicalRecord(
        path.join(store.dir, 'portable-concurrent-b'),
        'project',
        store.owner
      );
      expect(readA).toMatchObject({ kind: 'managed' });
      expect(readB).toMatchObject({ kind: 'managed' });
    });

    it('cleans up the lock file on a transactional rollback', async () => {
      const bundle = writeBundle([record('portable-rollback-lock-routing')]);

      // Force a rollback by making publishStagedFileExclusive throw.
      await expect(
        importKnowledgeBundle(
          options(bundle, {
            io: {
              publishStagedFileExclusive: () => {
                throw new Error('injected publish failure');
              },
            },
          })
        )
      ).rejects.toMatchObject({
        code: 'knowledge_bundle_import_transaction_failed',
      });

      // Lock file is gone — release ran in the finally block even on rollback.
      expect(fs.existsSync(store.lockPath)).toBe(false);
    });
  });
});
