import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  digestContent,
  renderManagedDocument,
  resolveEffectiveLearnedSkillPlan,
  resolveLearnedSkillExecutionContext,
  serializeManifest,
  type EffectiveLearnedSkillPlan,
} from '../../src/core/learned-skills/index.js';
import {
  reconcileGlobalLearnedSkillsForTool,
  reconcileProjectLearnedSkillsForTool,
} from '../../src/core/learned-skill-materialization.js';
import {
  getProjectLearnedLedgerPath,
  migrateProjectLearnedLedger,
  readProjectLearnedLedger,
  collectProjectLearnedStores,
} from '../../src/core/project-learned-skill-ledger.js';
import {
  getGlobalLearnedLedgerPath,
  readGlobalLearnedArtifacts,
} from '../../src/core/global-learned-skill-ledger.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { resolveProjectKnowledgeHome } from '../../src/core/project-knowledge-home.js';
import { writeStoreMetadataState } from '../../src/core/store/foundation.js';
import { mintStoreUid } from '../../src/core/store/identity-types.js';
import { writeStoreProjectRecord } from '../../src/core/store/project-records.js';
import { registerStore } from '../../src/core/store/registry.js';

const ID = 'typescript-cli-routing';
const KEY = 'typescript-cli-routing-key';
const BODY = '---\nname: shared\n---\n\nUse the shared route.\n';

describe('learned ownership records', () => {
  let tempDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ledger-')));
    globalDataDir = path.join(tempDir, 'data');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  function healthyRoot(root: string): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    return fs.realpathSync.native(root);
  }

  async function makeStore(name: string, dirName = name) {
    const root = healthyRoot(path.join(tempDir, dirName));
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, { version: 2, uid, id: name });
    await registerStore({ id: name, localPath: root, globalDataDir });
    return { root, uid, id: name };
  }

  async function makeProject(name: string) {
    const root = healthyRoot(path.join(tempDir, name));
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n');
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, projectId: home!.projectId };
  }

  function writeStoreCatalogRecord(
    store: { root: string; uid: string; id: string },
    body = BODY
  ): void {
    const directory = path.join(store.root, 'rasen', 'learned-skills', ID);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'learned-skill.yaml'),
      serializeManifest({
        version: 2,
        scope: 'store',
        owner: { type: 'store', uid: store.uid, id: store.id },
        id: ID,
        knowledgeKey: KEY,
        status: 'active',
        generatedBy: 'rasen-learned-skill',
        contentDigest: digestContent(body),
        description: 'Route TypeScript CLI diagnostics.',
        applicability: { mode: 'all', markers: ['package.json'] },
        evidence: [],
        sources: [],
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      })
    );
    fs.writeFileSync(path.join(directory, 'SKILL.md'), body);
  }

  /** Writes a record straight into the project's CANONICAL knowledge home. */
  function writeProjectCatalogRecord(projectId: string, body = BODY): void {
    const directory = path.join(
      resolveProjectKnowledgeHome(projectId, { globalDataDir }).catalogDir,
      ID
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'learned-skill.yaml'),
      serializeManifest({
        version: 2,
        scope: 'project',
        owner: { type: 'project', projectId },
        id: ID,
        knowledgeKey: KEY,
        status: 'active',
        generatedBy: 'rasen-learned-skill',
        contentDigest: digestContent(body),
        description: 'Route TypeScript CLI diagnostics.',
        applicability: { mode: 'all', markers: ['package.json'] },
        evidence: [],
        sources: [],
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      })
    );
    fs.writeFileSync(path.join(directory, 'SKILL.md'), body);
  }

  async function planFor(projectRoot: string): Promise<EffectiveLearnedSkillPlan> {
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: projectRoot,
      requestedScope: 'mixed',
      globalDataDir,
      sessionContext: null,
    });
    return resolveEffectiveLearnedSkillPlan({
      execution,
      previousStores: collectProjectLearnedStores(projectRoot),
    });
  }

  function reconcile(projectRoot: string, plan: EffectiveLearnedSkillPlan) {
    return reconcileProjectLearnedSkillsForTool({
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot: path.join(projectRoot, '.claude', 'skills'),
      plan,
    });
  }

  const targetFile = (projectRoot: string): string =>
    path.join(projectRoot, '.claude', 'skills', ID, 'SKILL.md');

  // ---------------------------------------------------------------------------
  // Version 2 shape and durable ownership
  // ---------------------------------------------------------------------------

  it('records Store sources and Store facts by permanent identity, never by display name', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    await writeStoreProjectRecord(team.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    writeStoreCatalogRecord(team);

    const result = reconcile(project.root, await planFor(project.root));
    expect(result.created.map((entry) => entry.id)).toEqual([ID]);

    const ledger = readProjectLearnedLedger(project.root)!;
    expect(ledger.version).toBe(2);
    // The map is keyed on the permanent identity; the alias is a convenience.
    expect(Object.keys(ledger.stores)).toEqual([team.uid]);
    expect(ledger.stores[team.uid]).toMatchObject({ lastMembership: 'member', id: 'team' });
    expect(ledger.tools.claude?.learned[ID]?.sources).toEqual([
      { owner: { type: 'store', uid: team.uid, id: 'team' }, id: ID },
    ]);
    expect(ledger.tools.claude?.learned[ID]?.resolutionSchemaVersion).toBe(2);
  });

  it('records one winner with every contributing Store when two hold identical copies', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    const platform = await makeStore('platform');
    for (const store of [team, platform]) {
      await writeStoreProjectRecord(store.root, {
        version: 1,
        projectId: project.projectId,
        roles: { planning: false, knowledge: true },
      });
      writeStoreCatalogRecord(store);
    }

    const result = reconcile(project.root, await planFor(project.root));

    expect(result.deduplicated.map((entry) => entry.id)).toEqual([ID]);
    const sources = readProjectLearnedLedger(project.root)!.tools.claude!.learned[ID]!.sources;
    expect(
      sources
        .map((source) => (source.owner.type === 'store' ? source.owner.uid : ''))
        .sort()
    ).toEqual([team.uid, platform.uid].sort());
  });

  it('leaves the record byte-identical when nothing changed, and reports a no-op', async () => {
    const project = await makeProject('web');
    writeProjectCatalogRecord(project.projectId);
    reconcile(project.root, await planFor(project.root));
    const before = fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8');

    const second = reconcile(project.root, await planFor(project.root));

    expect(second.noOp).toBe(true);
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.migrated).toEqual([]);
    expect(fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8')).toBe(before);
  });

  it('survives a Store rename with no change to any digest or ownership entry', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    await writeStoreProjectRecord(team.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    writeStoreCatalogRecord(team);
    reconcile(project.root, await planFor(project.root));
    const digestBefore = readProjectLearnedLedger(project.root)!.tools.claude!.learned[ID]!
      .resolutionDigest;

    // Rename the Store — its permanent identity is untouched.
    await writeStoreMetadataState(team.root, { version: 2, uid: team.uid, id: 'renamed-team' });
    await registerStore({ id: 'renamed-team', localPath: team.root, globalDataDir });
    writeStoreCatalogRecord({ ...team, id: 'renamed-team' });

    const after = reconcile(project.root, await planFor(project.root));

    expect(after.updated).toEqual([]);
    expect(after.migrated).toEqual([]);
    expect(
      readProjectLearnedLedger(project.root)!.tools.claude!.learned[ID]!.resolutionDigest
    ).toBe(digestBefore);
    // Still exactly one Store fact, keyed on the identity that did not move.
    expect(Object.keys(readProjectLearnedLedger(project.root)!.stores)).toEqual([team.uid]);
  });

  // ---------------------------------------------------------------------------
  // Version 1 → version 2
  // ---------------------------------------------------------------------------

  function writeLegacyLedger(projectRoot: string, storeAlias: string): void {
    const ledgerPath = getProjectLearnedLedgerPath(projectRoot);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.writeFileSync(
      ledgerPath,
      `${JSON.stringify(
        {
          version: 1,
          stores: { [storeAlias]: { lastMembership: 'member', relevant: true } },
          tools: {
            claude: {
              learned: {
                [ID]: {
                  effectiveScope: 'store',
                  sources: [{ owner: { type: 'store', id: storeAlias }, id: ID }],
                  canonicalContentDigest: digestContent(BODY),
                  resolutionDigest: digestContent('v1-identity'),
                  file: {
                    scope: 'project',
                    path: `.claude/skills/${ID}/SKILL.md`,
                    sha256: digestContent('whatever'),
                  },
                },
              },
            },
          },
        },
        null,
        2
      )}\n`
    );
  }

  it('refuses to read a version 1 record as ownership and names the migration', async () => {
    const project = await makeProject('web');
    writeLegacyLedger(project.root, 'team');

    expect(() => readProjectLearnedLedger(project.root)).toThrowError(
      /names its sources by a Store's display name/u
    );
    try {
      readProjectLearnedLedger(project.root);
    } catch (error) {
      expect((error as { code?: string }).code).toBe('learned_owner_legacy_alias');
      expect((error as { repair?: string[] }).repair).toContain('rasen knowledge migrate');
    }
  });

  it('previews the ownership upgrade without touching the file', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    writeLegacyLedger(project.root, 'team');
    const before = fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8');

    const preview = await migrateProjectLearnedLedger(project.root, {
      globalDataDir,
      dryRun: true,
    });

    expect(preview.status).toBe('ready');
    expect(preview.mappings).toEqual([{ alias: 'team', uid: team.uid, candidates: [expect.anything()] }]);
    expect(preview.entries).toEqual([{ toolId: 'claude', id: ID }]);
    expect(fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8')).toBe(before);
  });

  it('upgrades an unambiguous display name onto its permanent identity', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    writeLegacyLedger(project.root, 'team');

    const result = await migrateProjectLearnedLedger(project.root, { globalDataDir });

    expect(result.status).toBe('applied');
    const ledger = readProjectLearnedLedger(project.root)!;
    expect(Object.keys(ledger.stores)).toEqual([team.uid]);
    expect(ledger.stores[team.uid]?.id).toBe('team');
    expect(ledger.tools.claude!.learned[ID]!.sources).toEqual([
      { owner: { type: 'store', uid: team.uid, id: 'team' }, id: ID },
    ]);
    // Carried forward as scheme 1: the identity changed, so the next
    // reconciliation must be able to call the rewrite a migration.
    expect(ledger.tools.claude!.learned[ID]!.resolutionSchemaVersion).toBe(1);
  });

  it('BLOCKS an ambiguous display name and drops no recorded source', async () => {
    const project = await makeProject('web');
    await makeStore('team', 'team-one');
    await makeStore('team', 'team-two');
    writeLegacyLedger(project.root, 'team');
    const before = fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8');

    const result = await migrateProjectLearnedLedger(project.root, { globalDataDir });

    expect(result.status).toBe('blocked');
    expect(result.blocking.map((entry) => entry.problem)).toEqual(['ambiguous']);
    expect(result.diagnostics[0]?.code).toBe('store_alias_ambiguous');
    // Nothing written, nothing dropped.
    expect(fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8')).toBe(before);
  });

  it('stops reconciliation and names the migration when ownership is still alias-keyed', async () => {
    const project = await makeProject('web');
    await makeStore('team');
    writeProjectCatalogRecord(project.projectId);
    writeLegacyLedger(project.root, 'team');
    const before = fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8');

    const result = reconcile(project.root, await planFor(project.root));

    expect(result.created).toEqual([]);
    expect(result.errors[0]?.code).toBe('learned_owner_legacy_alias');
    expect(result.errors[0]?.repair).toContain('rasen knowledge migrate');
    // Nothing generated, and the record it could not trust is untouched.
    expect(fs.existsSync(targetFile(project.root))).toBe(false);
    expect(fs.readFileSync(getProjectLearnedLedgerPath(project.root), 'utf8')).toBe(before);
  });

  it('BLOCKS a display name that names no registered Store rather than dropping it', async () => {
    const project = await makeProject('web');
    writeLegacyLedger(project.root, 'never-registered');

    const result = await migrateProjectLearnedLedger(project.root, { globalDataDir });

    expect(result.status).toBe('blocked');
    expect(result.blocking.map((entry) => entry.problem)).toEqual(['unknown']);
  });

  it('reports the identity-scheme rewrite as a migration, not as edited content', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    await writeStoreProjectRecord(team.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    writeStoreCatalogRecord(team);
    // Materialize once, then rewind the record to the old identity scheme, as
    // an upgraded version 1 ledger would leave it.
    reconcile(project.root, await planFor(project.root));
    const ledgerPath = getProjectLearnedLedgerPath(project.root);
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    ledger.tools.claude.learned[ID].resolutionSchemaVersion = 1;
    ledger.tools.claude.learned[ID].resolutionDigest = digestContent('v1-identity');
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

    const result = reconcile(project.root, await planFor(project.root));

    expect(result.migrated.map((entry) => entry.id)).toEqual([ID]);
    expect(result.updated).toEqual([]);
    expect(
      readProjectLearnedLedger(project.root)!.tools.claude!.learned[ID]!.resolutionSchemaVersion
    ).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Exact ownership
  // ---------------------------------------------------------------------------

  it('leaves a generated file whose content no longer matches, and reports it', async () => {
    const project = await makeProject('web');
    writeProjectCatalogRecord(project.projectId);
    reconcile(project.root, await planFor(project.root));
    const edited = '---\nname: edited\n---\n\nthe user changed this\n';
    fs.writeFileSync(targetFile(project.root), edited);

    // A canonical rewrite would normally refresh the copy.
    writeProjectCatalogRecord(project.projectId, '---\nname: shared\n---\n\nrevised guidance\n');
    const result = reconcile(project.root, await planFor(project.root));

    expect(result.updated).toEqual([]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['collision']);
    expect(fs.readFileSync(targetFile(project.root), 'utf-8')).toBe(edited);
  });

  it('never claims a user-authored file at a generated path', async () => {
    const project = await makeProject('web');
    writeProjectCatalogRecord(project.projectId);
    const human = '---\nname: mine\n---\n\nhuman authored\n';
    fs.mkdirSync(path.dirname(targetFile(project.root)), { recursive: true });
    fs.writeFileSync(targetFile(project.root), human);

    const result = reconcile(project.root, await planFor(project.root));

    expect(result.created).toEqual([]);
    expect(fs.readFileSync(targetFile(project.root), 'utf-8')).toBe(human);
    expect(readProjectLearnedLedger(project.root)?.tools.claude?.learned[ID]).toBeUndefined();
  });

  it('writes no file and no ownership record at all when Stores conflict without a project winner', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    const platform = await makeStore('platform');
    for (const store of [team, platform]) {
      await writeStoreProjectRecord(store.root, {
        version: 1,
        projectId: project.projectId,
        roles: { planning: false, knowledge: true },
      });
    }
    writeStoreCatalogRecord(team, '---\nname: shared\n---\n\none version\n');
    writeStoreCatalogRecord(platform, '---\nname: shared\n---\n\nanother version\n');

    const plan = await planFor(project.root);
    expect(plan.status).toBe('blocked');
    const result = reconcile(project.root, plan);

    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual(['effective']);
    expect(result.created).toEqual([]);
    expect(fs.existsSync(targetFile(project.root))).toBe(false);
    expect(fs.existsSync(getProjectLearnedLedgerPath(project.root))).toBe(false);
  });

  it('defers a removal rather than deleting what an unreachable Store provided', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    await writeStoreProjectRecord(team.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    writeStoreCatalogRecord(team);
    reconcile(project.root, await planFor(project.root));
    expect(fs.existsSync(targetFile(project.root))).toBe(true);

    // The Store goes away: its metadata is removed, so it no longer resolves.
    // It is still DECLARED, so it is still relevant.
    fs.writeFileSync(
      path.join(project.root, 'rasen', 'config.yaml'),
      [
        'schema: spec-driven',
        `projectId: ${project.projectId}`,
        'storeMemberships:',
        `  - uid: ${team.uid}`,
        '    id: team',
        '',
      ].join('\n')
    );
    fs.rmSync(path.join(team.root, '.rasen-store'), { recursive: true, force: true });
    fs.rmSync(path.join(team.root, 'rasen'), { recursive: true, force: true });

    const plan = await planFor(project.root);
    expect(plan.status).toBe('degraded');
    const result = reconcile(project.root, plan);

    // The file the unreachable Store provided is STILL THERE.
    expect(result.removed).toEqual([]);
    expect(result.deferred.map((entry) => entry.action)).toEqual(['remove']);
    expect(fs.existsSync(targetFile(project.root))).toBe(true);
    expect(readProjectLearnedLedger(project.root)?.tools.claude?.learned[ID]).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Machine-wide home
  // ---------------------------------------------------------------------------

  it('gives a machine-wide tool home no project or Store knowledge at all', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    await writeStoreProjectRecord(team.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    writeStoreCatalogRecord(team);
    const hermes = path.join(tempDir, 'hermes-skills');

    const plan = await planFor(project.root);
    const result = reconcileGlobalLearnedSkillsForTool({
      toolId: 'hermes',
      toolLabel: 'Hermes',
      skillsRoot: hermes,
      globalRecords: plan.globalRecords,
      localRecords: plan.skills,
      plan,
      globalDataDir,
    });

    expect(result.created).toEqual([]);
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['global-only-home']);
    expect(fs.existsSync(path.join(hermes, ID))).toBe(false);
    expect(readGlobalLearnedArtifacts(globalDataDir, 'hermes')).toEqual({});
  });

  it('reads a version 1 machine-wide record without rewriting it on a read', async () => {
    const ledgerPath = getGlobalLearnedLedgerPath(globalDataDir);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    const target = path.join(tempDir, 'hermes-skills', ID, 'SKILL.md');
    const legacy = `${JSON.stringify(
      {
        version: 1,
        tools: {
          hermes: {
            learned: {
              [ID]: {
                contentDigest: digestContent(BODY),
                path: target,
                sha256: digestContent(BODY),
              },
            },
          },
        },
      },
      null,
      2
    )}\n`;
    fs.writeFileSync(ledgerPath, legacy);

    const entries = readGlobalLearnedArtifacts(globalDataDir, 'hermes');

    expect(entries[ID]?.effectiveScope).toBe('global');
    expect(entries[ID]?.sources).toEqual([{ owner: { type: 'global' }, id: ID }]);
    expect(entries[ID]?.resolutionSchemaVersion).toBe(1);
    // A read is not a migration.
    expect(fs.readFileSync(ledgerPath, 'utf8')).toBe(legacy);
  });

  it('renders the managed document the identity was computed over', () => {
    const document = renderManagedDocument(
      {
        id: ID,
        effectiveScope: 'store',
        sources: [{ owner: { type: 'store', uid: 'u-1', id: 'team' }, id: ID }],
        canonicalContentDigest: digestContent(BODY),
        description: 'Route TypeScript CLI diagnostics.',
        body: 'Use the shared route.',
      },
      ['  resolutionDigest: "sha256:deadbeef"']
    );
    // The sources line carries the durable key, never the display alias.
    expect(document).toContain('learnedSkillSources: "store:u-1/typescript-cli-routing"');
    expect(document).not.toContain('team');
    expect(document).toContain('resolutionDigest: "sha256:deadbeef"');
  });
});
