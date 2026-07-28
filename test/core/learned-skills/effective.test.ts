import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  digestContent,
  resolveEffectiveLearnedSkillPlan,
  resolveEffectiveLearnedSkillRecords,
  resolveLearnedSkillExecutionContext,
  serializeManifest,
  type CanonicalLearnedSkill,
  type DurableKnowledgeOwnerRef,
  type LearnedSkillScope,
} from '../../../src/core/learned-skills/index.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import { registerStore } from '../../../src/core/store/registry.js';

const ID = 'typescript-cli-routing';
const KEY = 'typescript-cli-routing-key';

interface TestStore {
  root: string;
  uid: string;
  id: string;
  owner: DurableKnowledgeOwnerRef;
}

describe('effective learned-knowledge resolution', () => {
  let tempDir: string;
  let globalDataDir: string;
  let evaluationRoot: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-effective-')));
    globalDataDir = path.join(tempDir, 'data');
    evaluationRoot = path.join(tempDir, 'checkout');
    fs.mkdirSync(evaluationRoot, { recursive: true });
    fs.writeFileSync(path.join(evaluationRoot, 'package.json'), '{}\n');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Pure record fixtures
  // ---------------------------------------------------------------------------

  function record(input: {
    scope: LearnedSkillScope;
    owner: DurableKnowledgeOwnerRef;
    id?: string;
    key?: string;
    body?: string;
    marker?: string;
    status?: 'active' | 'retired';
    description?: string;
  }): CanonicalLearnedSkill {
    const id = input.id ?? ID;
    const content = input.body ?? '---\nname: effective\n---\n\nUse the stable route.\n';
    return {
      identity: { owner: input.owner, id },
      scope: input.scope,
      directory: path.join(tempDir, input.scope, id),
      content,
      evidence: [],
      manifest: {
        version: 2,
        scope: input.scope,
        owner: input.owner,
        id,
        knowledgeKey: input.key ?? KEY,
        status: input.status ?? 'active',
        generatedBy: 'rasen-learned-skill',
        contentDigest: digestContent(content),
        description: input.description ?? 'Route TypeScript CLI diagnostics.',
        applicability: { mode: 'all', markers: [input.marker ?? 'package.json'] },
        evidence: [],
        sources: [],
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
    };
  }

  const uidOf = (seed: string): string =>
    `${seed.repeat(8).slice(0, 8)}-0000-4000-8000-000000000000`;

  const projectRecord = (extra: Partial<Parameters<typeof record>[0]> = {}) =>
    record({ scope: 'project', owner: { type: 'project', projectId: 'p-web' }, ...extra });
  const storeRecord = (
    seed: string,
    alias: string,
    extra: Partial<Parameters<typeof record>[0]> = {}
  ) =>
    record({ scope: 'store', owner: { type: 'store', uid: uidOf(seed), id: alias }, ...extra });
  const globalRecord = (extra: Partial<Parameters<typeof record>[0]> = {}) =>
    record({ scope: 'global', owner: { type: 'global' }, ...extra });

  function resolve(
    projectRecords: CanonicalLearnedSkill[],
    storeRecords: CanonicalLearnedSkill[],
    globalRecords: CanonicalLearnedSkill[]
  ) {
    return resolveEffectiveLearnedSkillRecords({
      evaluationRoot,
      projectRecords,
      storeRecords,
      globalRecords,
    });
  }

  // ---------------------------------------------------------------------------
  // Applicability, precedence, equivalence, conflict
  // ---------------------------------------------------------------------------

  it('filters applicability before any precedence is considered', () => {
    expect(
      resolve([projectRecord()], [storeRecord('a', 'team')], [globalRecord()]).skills[0]
        ?.effectiveScope
    ).toBe('project');
    expect(
      resolve(
        [projectRecord({ marker: 'missing-project' })],
        [storeRecord('a', 'team')],
        [globalRecord()]
      ).skills[0]?.effectiveScope
    ).toBe('store');
    expect(
      resolve(
        [projectRecord({ marker: 'missing-project' })],
        [storeRecord('a', 'team', { status: 'retired' })],
        [globalRecord()]
      ).skills[0]?.effectiveScope
    ).toBe('global');
    // Inapplicable knowledge cannot win at ANY scope.
    expect(
      resolve(
        [projectRecord({ marker: 'nope' })],
        [storeRecord('a', 'team', { marker: 'nope' })],
        [globalRecord({ marker: 'nope' })]
      ).skills
    ).toEqual([]);
  });

  it('collapses byte-identical Store copies into one winner recording every source', () => {
    const platform = storeRecord('b', 'platform');
    const team = storeRecord('a', 'team');
    const first = resolve([], [team, platform], []);
    const second = resolve([], [platform, team], []);

    expect(first.blocked).toBe(false);
    expect(first.skills).toHaveLength(1);
    expect(first.skills[0]?.effectiveScope).toBe('store');
    expect(first.skills[0]?.sources.map((source) => source.owner)).toEqual([
      { type: 'store', uid: uidOf('a'), id: 'team' },
      { type: 'store', uid: uidOf('b'), id: 'platform' },
    ]);
    // Considering the same Stores in the other order produces the same answer.
    expect(second.skills[0]?.resolutionDigest).toBe(first.skills[0]?.resolutionDigest);
    expect(second.skills[0]?.sources).toEqual(first.skills[0]?.sources);
  });

  it('never treats a shared knowledge key alone as sameness', () => {
    const result = resolve(
      [],
      [storeRecord('a', 'team'), storeRecord('b', 'platform', { body: 'different bytes\n' })],
      []
    );
    expect(result.blocked).toBe(true);
    expect(result.skills).toEqual([]);
    expect(result.conflicts[0]?.kind).toBe('effective');
  });

  it('reports a complete, order-independent conflict and chooses no winner', () => {
    const variants = [
      storeRecord('a', 'alpha'),
      storeRecord('b', 'bravo', { body: 'different bytes\n' }),
      storeRecord('c', 'charlie', { key: 'different-key' }),
    ];
    const first = resolve([], variants, []);
    const second = resolve([], [...variants].reverse(), []);

    expect(first.blocked).toBe(true);
    expect(first.conflicts).toEqual(second.conflicts);
    expect(first.conflicts[0]?.participants.map((item) => item.source.owner)).toEqual([
      { type: 'store', uid: uidOf('a'), id: 'alpha' },
      { type: 'store', uid: uidOf('b'), id: 'bravo' },
      { type: 'store', uid: uidOf('c'), id: 'charlie' },
    ]);
  });

  it('keeps a project winner and records Store divergence beneath it as latent', () => {
    const result = resolve(
      [projectRecord()],
      [storeRecord('a', 'alpha'), storeRecord('b', 'bravo', { body: 'different bytes\n' })],
      [globalRecord()]
    );

    expect(result.blocked).toBe(false);
    expect(result.skills[0]?.effectiveScope).toBe('project');
    expect(result.conflicts).toMatchObject([{ id: ID, kind: 'latent' }]);
  });

  it('never breaks a tie by display-name order', () => {
    // `zulu` carries the LOWEST permanent identity and `alpha` the highest, so
    // an alphabetical tie-break on the display name would order them the other
    // way round. Both orders must produce the same recorded source list.
    const zulu = storeRecord('1', 'zulu');
    const alpha = storeRecord('9', 'alpha');
    const result = resolve([], [alpha, zulu], []);
    expect(result.skills[0]?.sources.map((source) => source.id)).toEqual([ID, ID]);
    expect(
      result.skills[0]?.sources.map((source) =>
        source.owner.type === 'store' ? source.owner.uid : ''
      )
    ).toEqual([uidOf('1'), uidOf('9')]);
  });

  // ---------------------------------------------------------------------------
  // Content identity (Gate 4)
  // ---------------------------------------------------------------------------

  it('computes an identity a Store rename cannot change', () => {
    const before = resolve([], [storeRecord('a', 'team'), storeRecord('b', 'platform')], []);
    // Same Stores, same content, both renamed.
    const after = resolve(
      [],
      [storeRecord('a', 'renamed-team'), storeRecord('b', 'renamed-platform')],
      []
    );
    expect(after.skills[0]?.resolutionDigest).toBe(before.skills[0]?.resolutionDigest);
  });

  it('computes an identity that does not depend on the order sources arrive in', () => {
    const forwards = resolve(
      [],
      [storeRecord('a', 'team'), storeRecord('b', 'platform'), storeRecord('c', 'infra')],
      []
    );
    const backwards = resolve(
      [],
      [storeRecord('c', 'infra'), storeRecord('b', 'platform'), storeRecord('a', 'team')],
      []
    );
    expect(backwards.skills[0]?.resolutionDigest).toBe(forwards.skills[0]?.resolutionDigest);
  });

  it('computes the same identity for content that differs only in line endings', () => {
    const lf = resolve([], [storeRecord('a', 'team', { body: 'line one\nline two\n' })], []);
    const crlf = resolve([], [storeRecord('a', 'team', { body: 'line one\r\nline two\r\n' })], []);
    expect(crlf.skills[0]?.resolutionDigest).toBe(lf.skills[0]?.resolutionDigest);
  });

  it('enforces the active-description budget after precedence and deduplication', () => {
    const large = 'x'.repeat(4097);
    // A shadowed record's description does not count — precedence runs first.
    const shadowed = resolve(
      [],
      [storeRecord('a', 'team'), storeRecord('b', 'platform')],
      [globalRecord({ description: large })]
    );
    expect(shadowed.budgetFailure).toBeUndefined();

    const overflow = resolve(
      [projectRecord({ description: large })],
      [storeRecord('a', 'team')],
      [globalRecord()]
    );
    expect(overflow.blocked).toBe(true);
    expect(overflow.budgetFailure?.name).toBe('LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET');
    expect(overflow.budgetFailure?.ids).toEqual([ID]);
  });

  // ---------------------------------------------------------------------------
  // Plan-level: eligibility, relevance, outages
  // ---------------------------------------------------------------------------

  function healthyRoot(root: string): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    return fs.realpathSync.native(root);
  }

  /** A registered Store carrying a permanent identity — the only kind that can own records. */
  async function makeStore(name: string, dirName = name): Promise<TestStore> {
    const root = healthyRoot(path.join(tempDir, dirName));
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, { version: 2, uid, id: name });
    await registerStore({ id: name, localPath: root, globalDataDir });
    return { root, uid, id: name, owner: { type: 'store', uid, id: name } };
  }

  async function makeProject(name: string, marker = 'package.json'): Promise<{ root: string; projectId: string }> {
    const root = healthyRoot(path.join(tempDir, name));
    fs.writeFileSync(path.join(root, marker), '{}\n');
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, projectId: home!.projectId };
  }

  function writeStoreCatalogRecord(store: TestStore, body: string, key = KEY): void {
    const directory = path.join(store.root, 'rasen', 'learned-skills', ID);
    fs.mkdirSync(directory, { recursive: true });
    const manifest = {
      version: 2 as const,
      scope: 'store' as const,
      owner: { type: 'store' as const, uid: store.uid, id: store.id },
      id: ID,
      knowledgeKey: key,
      status: 'active' as const,
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(body),
      description: 'Route TypeScript CLI diagnostics.',
      applicability: { mode: 'all' as const, markers: ['package.json'] },
      evidence: [],
      sources: [],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    };
    fs.writeFileSync(path.join(directory, 'learned-skill.yaml'), serializeManifest(manifest));
    fs.writeFileSync(path.join(directory, 'SKILL.md'), body);
  }

  async function planFor(
    projectRoot: string,
    extra: Parameters<typeof resolveEffectiveLearnedSkillPlan>[0]['previousStores'] = []
  ) {
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: projectRoot,
      requestedScope: 'mixed',
      globalDataDir,
      sessionContext: null,
    });
    return resolveEffectiveLearnedSkillPlan({ execution, previousStores: extra });
  }

  it('draws eligibility from the Stores that record this project, never from the planning pointer', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    const platform = await makeStore('platform');
    const planning = await makeStore('planning');
    // The project PLANS in `planning` and shares knowledge with the other two.
    fs.writeFileSync(
      path.join(project.root, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${project.projectId}\nstore: planning\n`
    );
    await writeStoreProjectRecord(team.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    await writeStoreProjectRecord(platform.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    const body = '---\nname: shared\n---\n\nUse the shared route.\n';
    writeStoreCatalogRecord(team, body);
    writeStoreCatalogRecord(platform, body);
    writeStoreCatalogRecord(planning, '---\nname: other\n---\n\nPlanning-only content.\n');

    const plan = await planFor(project.root);

    expect(plan.project.id).toBe(project.projectId);
    // Both knowledge members contributed; the planning Store did not, and its
    // divergent copy therefore causes no conflict at all.
    expect(plan.skills).toHaveLength(1);
    expect(plan.skills[0]?.effectiveScope).toBe('store');
    expect(
      plan.skills[0]?.sources.map((source) =>
        source.owner.type === 'store' ? source.owner.uid : ''
      ).sort()
    ).toEqual([team.uid, platform.uid].sort());
    expect(plan.conflicts).toEqual([]);
    // The planning Store is not even CONSIDERED: planning where a project's
    // work lives is a different relation from sharing knowledge with it, so its
    // divergent copy causes no conflict and gets no priority.
    expect(plan.stores.some((fact) => fact.store.uid === planning.uid)).toBe(false);
    expect(plan.status).toBe('ready');
  });

  it('records a Store that names the project without the knowledge role as not a member', async () => {
    const project = await makeProject('web');
    const roster = await makeStore('roster');
    await writeStoreProjectRecord(roster.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: true, knowledge: false },
    });
    writeStoreCatalogRecord(roster, '---\nname: shared\n---\n\nRoster-only content.\n');

    const plan = await planFor(project.root);

    expect(plan.stores.find((fact) => fact.store.uid === roster.uid)?.status).toBe('not-member');
    // Recorded, but its catalog contributes nothing.
    expect(plan.skills).toEqual([]);
    expect(plan.status).toBe('ready');
  });

  it('carries the three roots apart: storage, evaluation, and the project record', async () => {
    const project = await makeProject('web');
    const plan = await planFor(project.root);
    const home = resolveProjectKnowledgeHome(project.projectId, { globalDataDir });

    expect(plan.canonicalOwnerRoot).toBe(home.root);
    expect(plan.canonicalOwnerRoot).not.toBe(plan.evaluationRoot);
    expect(plan.evaluationRoot).toBe(project.root);
    // Expected paths are composed, never spelled out with a separator.
    expect(home.catalogDir).toBe(path.join(home.root, 'learned-skills'));
  });

  it('reports an unreachable relevant Store as degraded and never as an empty one', async () => {
    const project = await makeProject('web');
    const team = await makeStore('team');
    await writeStoreProjectRecord(team.root, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    writeStoreCatalogRecord(team, '---\nname: shared\n---\n\nUse the shared route.\n');
    // The project DECLARES a second Store that is not on this machine at all.
    const missingUid = mintStoreUid();
    fs.writeFileSync(
      path.join(project.root, 'rasen', 'config.yaml'),
      [
        'schema: spec-driven',
        `projectId: ${project.projectId}`,
        'storeMemberships:',
        `  - uid: ${missingUid}`,
        '    id: elsewhere',
        '',
      ].join('\n')
    );

    const plan = await planFor(project.root);

    expect(plan.status).toBe('degraded');
    expect(plan.unavailableStores).toHaveLength(1);
    const outage = plan.unavailableStores[0]!;
    expect(outage.store.uid).toBe(missingUid);
    expect(outage.relevant).toBe(true);
    expect(outage.relevance).toContain('declared');
    expect(outage.repair.length).toBeGreaterThan(0);
    // The reachable Store's knowledge still resolves: an unrelated outage does
    // not stop the rest of the answer.
    expect(plan.skills.map((skill) => skill.id)).toEqual([ID]);
  });

  it('treats a Store named only by the previous ownership record as relevant', async () => {
    const project = await makeProject('web');
    const goneUid = mintStoreUid();

    const plan = await planFor(project.root, [{ type: 'store', uid: goneUid, id: 'gone' }]);
    // Nothing declares it and nothing records it, so it is not eligible — but a
    // Store the previous ownership record named is still RELEVANT, which is what
    // stops its former contribution being deleted while it is unreachable.
    expect(plan.stores.some((fact) => fact.store.uid === goneUid)).toBe(false);

    // Declared as well: now it is eligible, unreachable, and relevant by BOTH
    // routes — the ownership record alone is enough for the second.
    fs.writeFileSync(
      path.join(project.root, 'rasen', 'config.yaml'),
      [
        'schema: spec-driven',
        `projectId: ${project.projectId}`,
        'storeMemberships:',
        `  - uid: ${goneUid}`,
        '',
      ].join('\n')
    );
    const declared = await planFor(project.root, [{ type: 'store', uid: goneUid, id: 'gone' }]);
    expect(declared.unavailableStores[0]?.relevance).toEqual(
      expect.arrayContaining(['declared', 'previous-source'])
    );
  });

  it('refuses to guess a member project from a direct Store owner', async () => {
    const store = await makeStore('team');
    await expect(
      resolveEffectiveLearnedSkillPlan({
        execution: {
          owner: { type: 'store', id: store.id, uid: store.uid, root: store.root },
          source: 'direct-store',
          globalDataDir,
        },
      })
    ).rejects.toMatchObject({ code: 'project_owner_required' });
  });

  it('refuses a Store with no permanent identity rather than attributing records to its name', async () => {
    const project = await makeProject('web');
    const legacy = healthyRoot(path.join(tempDir, 'legacy-store'));
    await registerStore({ id: 'legacy', localPath: legacy, globalDataDir });
    await writeStoreProjectRecord(legacy, {
      version: 1,
      projectId: project.projectId,
      roles: { planning: false, knowledge: true },
    });
    writeStoreCatalogRecord(
      { root: legacy, uid: mintStoreUid(), id: 'legacy', owner: { type: 'global' } },
      '---\nname: shared\n---\n\nlegacy\n'
    );

    const plan = await planFor(project.root);
    const fact = plan.stores.find((entry) => entry.store.id === 'legacy');
    expect(fact?.status).toBe('unavailable');
    expect(plan.skills).toEqual([]);
    expect(
      plan.unavailableStores.some((store) =>
        store.repair.some((command) => command.includes('upgrade-identity'))
      )
    ).toBe(true);
  });
});
