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
  type KnowledgeOwnerRef,
  type LearnedSkillScope,
} from '../../../src/core/learned-skills/index.js';
import { appendStoreReference } from '../../../src/core/project-config.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { commitStoreRegistration, registerStore } from '../../../src/core/store/registry.js';
import { getStoreMetadataPath } from '../../../src/core/store/foundation.js';

const ID = 'typescript-cli-routing';

describe('effective learned-skill record resolution', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-effective-'));
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function record(input: {
    scope: LearnedSkillScope;
    owner: KnowledgeOwnerRef;
    id?: string;
    key?: string;
    body?: string;
    marker?: string;
    status?: 'active' | 'retired';
    description?: string;
  }): CanonicalLearnedSkill {
    const id = input.id ?? ID;
    const content = input.body ?? '---\nname: effective\n---\n\nUse the stable route.\n';
    const contentDigest = digestContent(content);
    return {
      identity: { owner: input.owner, id },
      scope: input.scope,
      directory: path.join(projectRoot, input.scope, id),
      content,
      evidence: [],
      manifest: {
        version: 2,
        scope: input.scope,
        owner: input.owner,
        id,
        knowledgeKey: input.key ?? 'typescript-cli-routing-key',
        status: input.status ?? 'active',
        generatedBy: 'rasen-learned-skill',
        contentDigest,
        description: input.description ?? 'Route TypeScript CLI diagnostics.',
        applicability: { mode: 'all', markers: [input.marker ?? 'package.json'] },
        evidence: [],
        sources: [],
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
      },
    };
  }

  const project = (extra: Partial<Parameters<typeof record>[0]> = {}) =>
    record({ scope: 'project', owner: { type: 'project', id: 'web' }, ...extra });
  const store = (id: string, extra: Partial<Parameters<typeof record>[0]> = {}) =>
    record({ scope: 'store', owner: { type: 'store', id }, ...extra });
  const global = (extra: Partial<Parameters<typeof record>[0]> = {}) =>
    record({ scope: 'global', owner: { type: 'global' }, ...extra });

  function resolve(
    projectRecords: CanonicalLearnedSkill[],
    storeRecords: CanonicalLearnedSkill[],
    globalRecords: CanonicalLearnedSkill[]
  ) {
    return resolveEffectiveLearnedSkillRecords({
      projectRoot,
      projectRecords,
      storeRecords,
      globalRecords,
    });
  }

  it('filters applicability before project > store > global precedence', () => {
    expect(resolve([project()], [store('team')], [global()]).skills[0]?.effectiveScope).toBe(
      'project'
    );
    expect(
      resolve([project({ marker: 'missing-project' })], [store('team')], [global()]).skills[0]
        ?.effectiveScope
    ).toBe('store');
    expect(
      resolve(
        [project({ marker: 'missing-project' })],
        [store('team', { status: 'retired' })],
        [global()]
      ).skills[0]?.effectiveScope
    ).toBe('global');
  });

  it('deduplicates exact stores without a winner and is permutation invariant', () => {
    const platform = store('platform');
    const team = store('team');
    const first = resolve([], [team, platform], []);
    const second = resolve([], [platform, team], []);

    expect(first.blocked).toBe(false);
    expect(first.skills).toHaveLength(1);
    expect(first.skills[0]?.sources.map((source) => source.owner)).toEqual([
      { type: 'store', id: 'platform' },
      { type: 'store', id: 'team' },
    ]);
    expect(second.skills[0]?.resolutionDigest).toBe(first.skills[0]?.resolutionDigest);
  });

  it('reports complete order-independent conflicts for key/content disagreement', () => {
    const variants = [
      store('a'),
      store('b', { body: 'different bytes\n' }),
      store('c', { key: 'different-key' }),
    ];
    const first = resolve([], variants, []);
    const second = resolve([], [...variants].reverse(), []);

    expect(first.blocked).toBe(true);
    expect(first.conflicts).toEqual(second.conflicts);
    expect(first.conflicts[0]?.kind).toBe('effective');
    expect(first.conflicts[0]?.participants.map((item) => item.source.owner)).toEqual([
      { type: 'store', id: 'a' },
      { type: 'store', id: 'b' },
      { type: 'store', id: 'c' },
    ]);
  });

  it('keeps a project winner and reports lower store divergence as latent', () => {
    const result = resolve(
      [project()],
      [store('a'), store('b', { body: 'different bytes\n' })],
      [global()]
    );

    expect(result.blocked).toBe(false);
    expect(result.skills[0]?.effectiveScope).toBe('project');
    expect(result.conflicts).toMatchObject([{ id: ID, kind: 'latent' }]);
  });

  it('enforces the active-description budget after precedence and deduplication', () => {
    const large = 'x'.repeat(4097);
    const shadowedLarge = global({ description: large });
    const deduplicated = resolve([], [store('a'), store('b')], [shadowedLarge]);
    expect(deduplicated.budgetFailure).toBeUndefined();

    const overflow = resolve([project({ description: large })], [store('a')], [global()]);
    expect(overflow.blocked).toBe(true);
    expect(overflow.budgetFailure?.name).toBe(
      'LEARNED_SKILL_ACTIVE_DESCRIPTION_BUDGET'
    );
    expect(overflow.budgetFailure?.ids).toEqual([ID]);
  });

  it('refuses to guess a member project from a direct store owner', async () => {
    await expect(
      resolveEffectiveLearnedSkillPlan({
        execution: {
          owner: { type: 'store', id: 'team', root: projectRoot },
          source: 'direct-store',
        },
      })
    ).rejects.toMatchObject({ code: 'project_owner_required' });
  });

  it('discovers every explicit member store without planning/pointer priority and degrades only relevant outages', async () => {
    const globalDataDir = path.join(projectRoot, 'machine-data');
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nstore: team\n'
    );
    const home = await resolveProjectHome(projectRoot, { globalDataDir });
    await commitStoreRegistration({
      id: 'web',
      type: 'project',
      backend: { type: 'git', local_path: projectRoot },
      writeMetadataIfMissing: true,
      globalDataDir,
    });

    const makeStore = async (id: string): Promise<string> => {
      const root = path.join(projectRoot, 'registered', id);
      fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
      fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
      fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      await registerStore({ id, localPath: root, globalDataDir });
      return fs.realpathSync.native(root);
    };
    const writeStoreRecord = (root: string, ownerId: string): void => {
      const content = '---\nname: shared\n---\n\nUse the shared route.\n';
      const directory = path.join(root, 'rasen', 'learned-skills', ID);
      fs.mkdirSync(directory, { recursive: true });
      const manifest = {
        version: 2 as const,
        scope: 'store' as const,
        owner: { type: 'store' as const, id: ownerId },
        id: ID,
        knowledgeKey: 'typescript-cli-routing-key',
        status: 'active' as const,
        generatedBy: 'rasen-learned-skill',
        contentDigest: digestContent(content),
        description: 'Route TypeScript CLI diagnostics.',
        applicability: { mode: 'all' as const, markers: ['package.json'] },
        evidence: [],
        sources: [],
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
      };
      fs.writeFileSync(path.join(directory, 'learned-skill.yaml'), serializeManifest(manifest));
      fs.writeFileSync(path.join(directory, 'SKILL.md'), content);
    };

    const team = await makeStore('team');
    const platform = await makeStore('platform');
    const planning = await makeStore('planning');
    const stale = await makeStore('stale');
    const sameBareProject = path.join(projectRoot, 'registered-project-team');
    fs.mkdirSync(path.join(sameBareProject, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(sameBareProject, 'rasen', 'changes', 'archive'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sameBareProject, 'rasen', 'config.yaml'),
      'schema: spec-driven\n'
    );
    await commitStoreRegistration({
      id: 'team',
      type: 'project',
      backend: { type: 'git', local_path: sameBareProject },
      writeMetadataIfMissing: true,
      globalDataDir,
    });
    appendStoreReference(team, 'web', { type: 'project' });
    appendStoreReference(platform, 'web', { type: 'project' });
    // Store-to-store references are deliberately not transitive membership.
    appendStoreReference(planning, 'team', { type: 'store' });
    writeStoreRecord(team, 'team');
    writeStoreRecord(platform, 'platform');
    fs.rmSync(getStoreMetadataPath(stale), { force: true });

    const resolved = await resolveLearnedSkillExecutionContext({
      launchDirectory: projectRoot,
      selector: { project: 'web' },
      requestedScope: 'project',
      globalDataDir,
    });
    const execution = {
      ...resolved,
      source: 'run-state' as const,
      planningRoot: { type: 'store' as const, id: 'planning', root: planning },
    };
    const plan = await resolveEffectiveLearnedSkillPlan({
      execution,
      previousStoreIds: ['stale'],
    });

    expect(home?.projectId).toBe(plan.project.id);
    expect(
      plan.stores.filter((fact) => fact.status === 'member').map((fact) => fact.store.id)
    ).toEqual(['platform', 'team']);
    expect(plan.stores.filter((fact) => fact.store.id === 'team')).toHaveLength(1);
    expect(plan.skills[0]?.sources.map((source) => source.owner)).toEqual([
      { type: 'store', id: 'platform' },
      { type: 'store', id: 'team' },
    ]);
    expect(plan.stores.find((fact) => fact.store.id === 'planning')?.status).toBe(
      'not-member'
    );
    expect(plan.status).toBe('degraded');
    expect(plan.unavailableStores).toMatchObject([
      {
        store: { type: 'store', id: 'stale' },
        relevant: true,
        relevance: ['previous-source'],
      },
    ]);
  });
});
