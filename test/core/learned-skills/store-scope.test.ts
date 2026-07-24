import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const renameMock = vi.hoisted(() => ({
  failOnceForNewPath: null as string | null,
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync: typeof actual.renameSync = (oldPath, newPath) => {
    if (
      renameMock.failOnceForNewPath &&
      path.resolve(String(newPath)) === renameMock.failOnceForNewPath
    ) {
      renameMock.failOnceForNewPath = null;
      throw new Error('injected EBUSY-class rename failure');
    }
    return actual.renameSync(oldPath, newPath);
  };
  return { ...actual, default: actual, renameSync };
});

import { appendStoreReference } from '../../../src/core/project-config.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { commitStoreRegistration, registerStore } from '../../../src/core/store/registry.js';
import {
  getStoreMetadataPath,
  readStoreRegistryState,
  writeStoreRegistryState,
} from '../../../src/core/store/foundation.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import {
  commitLearnedSkillPlan,
  listCanonicalLearnedSkills,
  planLearnedSkillMutation,
  queryStoreMemberProjects,
  resolveLearnedSkillExecutionContext,
  type EvidenceReference,
  type LearnedSkillContext,
} from '../../../src/core/learned-skills/index.js';

const ID = 'go-sql-transaction-locking';
const KEY = 'go-sql-tx-locking';
const DIGEST = `sha256:${'c'.repeat(64)}`;

describe('store-scoped learned-skill persistence and authority', () => {
  let tempDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    renameMock.failOnceForNewPath = null;
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-learned-store-'))
    );
    globalDataDir = path.join(tempDir, 'data');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function healthyRoot(name: string): string {
    const root = path.join(tempDir, name);
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    return fs.realpathSync.native(root);
  }

  async function project(alias: string): Promise<{
    id: string;
    root: string;
    context: LearnedSkillContext;
  }> {
    const root = healthyRoot(alias);
    const home = await resolveProjectHome(root, { globalDataDir });
    await commitStoreRegistration({
      id: alias,
      type: 'project',
      backend: { type: 'git', local_path: root },
      writeMetadataIfMissing: true,
      globalDataDir,
    });
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: root,
      selector: { project: alias },
      requestedScope: 'project',
      globalDataDir,
    });
    return { id: home!.projectId, root, context: { execution, globalDataDir } };
  }

  async function store(name: string): Promise<{
    root: string;
    context: LearnedSkillContext;
  }> {
    const root = healthyRoot(name);
    await registerStore({ id: name, localPath: root, globalDataDir });
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: root,
      selector: { store: name },
      requestedScope: 'store',
      globalDataDir,
    });
    return { root, context: { execution, globalDataDir } };
  }

  const evidence = (projectId: string): EvidenceReference => ({
    projectId,
    change: 'add-locking',
    artifact: 'proposal',
    digest: DIGEST,
  });

  async function createProjectSource(projectId: string, context: LearnedSkillContext) {
    const request = {
      version: 1 as const,
      operation: 'upsert' as const,
      scope: 'project' as const,
      id: ID,
      knowledgeKey: KEY,
      description: 'Lock rows in a transaction.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.',
      applicability: { mode: 'all' as const, markers: ['go.mod'] },
      evidence: [evidence(projectId)],
    };
    return commitLearnedSkillPlan(
      await planLearnedSkillMutation(request, context),
      context
    );
  }

  function storeRequest(projectIds: string[], storeId = 'team') {
    return {
      version: 2 as const,
      operation: 'upsert' as const,
      scope: 'store' as const,
      owner: { type: 'store' as const, id: storeId },
      id: ID,
      knowledgeKey: KEY,
      description: 'Lock rows in a transaction.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.',
      applicability: { mode: 'all' as const, markers: ['go.mod'] },
      evidence: [],
      sources: projectIds.map((id) => ({
        owner: { type: 'project' as const, id },
        id: ID,
        knowledgeKey: KEY,
      })),
    };
  }

  async function rebindStore(storeId: string, replacementRoot: string): Promise<LearnedSkillContext> {
    fs.mkdirSync(path.dirname(getStoreMetadataPath(replacementRoot)), { recursive: true });
    fs.writeFileSync(
      getStoreMetadataPath(replacementRoot),
      `version: 1\nid: ${storeId}\n`
    );
    const registry = await readStoreRegistryState({ globalDataDir });
    await writeStoreRegistryState(
      {
        version: 1,
        stores: {
          ...(registry?.stores ?? {}),
          [storeId]: {
            backend: { type: 'git', local_path: replacementRoot },
          },
        },
      },
      { globalDataDir }
    );
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: replacementRoot,
      selector: { store: storeId },
      requestedScope: 'store',
      globalDataDir,
    });
    return { execution, globalDataDir };
  }

  it('publishes one typed v2 record under the selected store after verified approval', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'project-b', { type: 'project' });
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);

    const members = await queryStoreMemberProjects(team.context);
    expect(members.members.map((member) => member.owner.id).sort()).toEqual(
      [first.id, second.id].sort()
    );

    const plan = await planLearnedSkillMutation(
      storeRequest([first.id, second.id]),
      team.context
    );
    expect(plan.action).toBe('create');
    expect(plan.identity).toEqual({
      owner: { type: 'store', id: 'team' },
      id: ID,
    });
    expect(plan.sourceIdentities).toHaveLength(2);
    expect(plan.requiresStoreApproval).toBe(true);

    const refused = await commitLearnedSkillPlan(plan, team.context);
    expect(refused).toMatchObject({
      outcome: 'blocked',
      block: { code: 'store_approval_required' },
    });

    const result = await commitLearnedSkillPlan(plan, {
      ...team.context,
      approveStore: true,
    });
    expect(result).toMatchObject({
      outcome: 'created',
      identity: { owner: { type: 'store', id: 'team' }, id: ID },
      storeRoot: team.root,
    });
    expect(result.changedFiles).toEqual([
      path.join(team.root, 'rasen', 'learned-skills', ID, 'learned-skill.yaml'),
      path.join(team.root, 'rasen', 'learned-skills', ID, 'SKILL.md'),
    ]);
    const [record] = await listCanonicalLearnedSkills('store', team.context);
    expect(record.manifest).toMatchObject({
      version: 2,
      scope: 'store',
      owner: { type: 'store', id: 'team' },
    });
    const catalogEntries = fs.readdirSync(path.join(team.root, 'rasen', 'learned-skills'));
    expect(catalogEntries).toEqual([ID]);
    expect(
      fs.readdirSync(team.root, { recursive: true }).some((entry) =>
        String(entry).endsWith('.lock')
      )
    ).toBe(false);
  });

  it('blocks an unwritable store and rolls a failed same-parent replacement back cleanly', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'project-b', { type: 'project' });
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);

    const catalog = path.join(team.root, 'rasen', 'learned-skills');
    fs.mkdirSync(catalog, { recursive: true });
    const writable = vi.spyOn(FileSystemUtils, 'canWriteFile').mockResolvedValueOnce(false);
    const blocked = await planLearnedSkillMutation(
      storeRequest([first.id, second.id]),
      team.context
    );
    writable.mockRestore();
    expect(blocked).toMatchObject({
      action: 'blocked',
      block: { code: 'store_unwritable' },
    });

    const created = await commitLearnedSkillPlan(
      await planLearnedSkillMutation(
        storeRequest([first.id, second.id]),
        team.context
      ),
      { ...team.context, approveStore: true }
    );
    expect(created.outcome).toBe('created');
    const directory = path.join(catalog, ID);
    const originalManifest = fs.readFileSync(
      path.join(directory, 'learned-skill.yaml')
    );
    const originalContent = fs.readFileSync(path.join(directory, 'SKILL.md'));

    const rewrite = await planLearnedSkillMutation(
      {
        ...storeRequest([first.id, second.id]),
        description: 'A deliberately changed description.',
      },
      team.context
    );
    expect(rewrite.action).toBe('rewrite');
    renameMock.failOnceForNewPath = path.resolve(directory);
    await expect(
      commitLearnedSkillPlan(rewrite, { ...team.context, approveStore: true })
    ).rejects.toThrow('injected EBUSY-class rename failure');

    expect(fs.readFileSync(path.join(directory, 'learned-skill.yaml'))).toEqual(
      originalManifest
    );
    expect(fs.readFileSync(path.join(directory, 'SKILL.md'))).toEqual(originalContent);
    expect(fs.readdirSync(catalog)).toEqual([ID]);
  });

  it('rejects fabricated sources and membership drift without changing the target', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'project-b', { type: 'project' });
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);

    const fabricated = await planLearnedSkillMutation(
      storeRequest([first.id, 'fabricated-project']),
      team.context
    );
    expect(fabricated).toMatchObject({
      action: 'blocked',
      block: { code: 'promotion_source_invalid' },
    });

    const plan = await planLearnedSkillMutation(
      storeRequest([first.id, second.id]),
      team.context
    );
    expect(plan.action).toBe('create');
    fs.writeFileSync(
      path.join(team.root, 'rasen', 'config.yaml'),
      'schema: spec-driven\nreferences:\n  - project:project-a\n'
    );
    const drifted = await commitLearnedSkillPlan(plan, {
      ...team.context,
      approveStore: true,
    });
    expect(drifted).toMatchObject({
      outcome: 'blocked',
      block: { code: 'promotion_source_drift' },
    });
    expect(fs.existsSync(path.join(team.root, 'rasen', 'learned-skills', ID))).toBe(false);
  });

  it('rejects store create when the authoritative registry root drifts after planning', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'project-b', { type: 'project' });
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);
    const plan = await planLearnedSkillMutation(
      storeRequest([first.id, second.id]),
      team.context
    );
    const replacementRoot = healthyRoot('replacement-team');
    const rebound = await rebindStore('team', replacementRoot);

    const result = await commitLearnedSkillPlan(plan, {
      ...rebound,
      approveStore: true,
    });
    expect(result).toMatchObject({
      outcome: 'blocked',
      block: { code: 'typed_owner_mismatch' },
    });
    expect(fs.existsSync(path.join(team.root, 'rasen', 'learned-skills', ID))).toBe(
      false
    );
    expect(
      fs.existsSync(path.join(replacementRoot, 'rasen', 'learned-skills', ID))
    ).toBe(false);
  });

  it('rejects store rewrite and retire when the authoritative registry root drifts', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'project-b', { type: 'project' });
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation(
        storeRequest([first.id, second.id]),
        team.context
      ),
      { ...team.context, approveStore: true }
    );
    const rewrite = await planLearnedSkillMutation(
      {
        ...storeRequest([first.id, second.id]),
        description: 'Changed only in the stale plan.',
      },
      team.context
    );
    const retire = await planLearnedSkillMutation(
      { operation: 'retire', scope: 'store', id: ID },
      team.context
    );
    const manifestPath = path.join(
      team.root,
      'rasen',
      'learned-skills',
      ID,
      'learned-skill.yaml'
    );
    const before = fs.readFileSync(manifestPath);
    const replacementRoot = healthyRoot('replacement-team');
    const rebound = await rebindStore('team', replacementRoot);

    for (const plan of [rewrite, retire]) {
      const result = await commitLearnedSkillPlan(plan, {
        ...rebound,
        approveStore: true,
      });
      expect(result).toMatchObject({
        outcome: 'blocked',
        block: { code: 'typed_owner_mismatch' },
      });
    }
    expect(fs.readFileSync(manifestPath)).toEqual(before);
  });

  it('binds store and global sources to the promotion target knowledge key', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'project-b', { type: 'project' });
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);

    const storeMismatch = await planLearnedSkillMutation(
      {
        ...storeRequest([first.id, second.id]),
        knowledgeKey: 'different-target-key',
      },
      team.context
    );
    expect(storeMismatch).toMatchObject({
      action: 'blocked',
      block: { code: 'promotion_source_invalid' },
    });

    const globalExecution = await resolveLearnedSkillExecutionContext({
      launchDirectory: first.root,
      requestedScope: 'global',
      globalDataDir,
    });
    const globalMismatch = await planLearnedSkillMutation(
      {
        version: 2,
        operation: 'promote',
        owner: { type: 'global' },
        id: ID,
        knowledgeKey: 'different-target-key',
        description: 'Wrong target key.',
        instructions: '## When\nNever.\n## Steps\nNever.',
        applicability: { mode: 'all', markers: ['go.mod'] },
        evidence: [],
        sources: storeRequest([first.id, second.id]).sources,
      },
      { execution: globalExecution, globalDataDir }
    );
    expect(globalMismatch).toMatchObject({
      action: 'blocked',
      block: { code: 'promotion_source_invalid' },
    });
  });

  it('rejects project aliases and repeated store owners after canonical resolution', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);
    const globalExecution = await resolveLearnedSkillExecutionContext({
      launchDirectory: first.root,
      requestedScope: 'global',
      globalDataDir,
    });
    const globalContext = { execution: globalExecution, globalDataDir };
    const base = {
      version: 2 as const,
      operation: 'promote' as const,
      owner: { type: 'global' as const },
      id: ID,
      knowledgeKey: KEY,
      description: 'Lock rows in a transaction.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.',
      applicability: { mode: 'all' as const, markers: ['go.mod'] },
      evidence: [],
    };
    const canonicalPlan = await planLearnedSkillMutation(
      {
        ...base,
        sources: [
          {
            owner: { type: 'project' as const, id: 'project-a' },
            id: ID,
            knowledgeKey: KEY,
          },
          {
            owner: { type: 'project' as const, id: 'project-b' },
            id: ID,
            knowledgeKey: KEY,
          },
        ],
      },
      globalContext
    );
    expect(canonicalPlan.commit?.manifest).toMatchObject({
      version: 2,
      sources: [
        {
          owner: { type: 'project', id: first.id },
          id: ID,
          knowledgeKey: KEY,
        },
        {
          owner: { type: 'project', id: second.id },
          id: ID,
          knowledgeKey: KEY,
        },
      ],
    });
    const aliasPlan = await planLearnedSkillMutation(
      {
        ...base,
        sources: [
          {
            owner: { type: 'project' as const, id: 'project-a' },
            id: ID,
            knowledgeKey: KEY,
          },
          {
            owner: { type: 'project' as const, id: first.id },
            id: ID,
            knowledgeKey: KEY,
          },
        ],
      },
      globalContext
    );
    expect(aliasPlan).toMatchObject({
      action: 'blocked',
      block: { code: 'global_evidence_insufficient' },
    });

    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'project-b', { type: 'project' });
    await commitLearnedSkillPlan(
      await planLearnedSkillMutation(
        storeRequest([first.id, second.id]),
        team.context
      ),
      { ...team.context, approveStore: true }
    );
    const repeatedStoreLocator = {
      owner: { type: 'store' as const, id: 'team' },
      id: ID,
      knowledgeKey: KEY,
    };
    const storeAliasPlan = await planLearnedSkillMutation(
      {
        ...base,
        sources: [repeatedStoreLocator, repeatedStoreLocator],
      },
      globalContext
    );
    expect(storeAliasPlan).toMatchObject({
      action: 'blocked',
      block: { code: 'global_evidence_insufficient' },
    });
  });

  it('counts only explicit project references and never expands store references transitively', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    const nested = await store('nested');
    appendStoreReference(nested.root, 'project-b', { type: 'project' });
    const team = await store('team');
    appendStoreReference(team.root, 'project-a', { type: 'project' });
    appendStoreReference(team.root, 'nested');

    const members = await queryStoreMemberProjects(team.context);
    expect(members.members).toEqual([
      { owner: { type: 'project', id: first.id }, root: first.root },
    ]);
    expect(members.members.some((member) => member.owner.id === second.id)).toBe(false);
  });

  it('promotes two verified store records globally and rejects mixed project/store sources', async () => {
    const first = await project('project-a');
    const second = await project('project-b');
    await createProjectSource(first.id, first.context);
    await createProjectSource(second.id, second.context);

    const sourceStores = [];
    for (const name of ['team-a', 'team-b']) {
      const current = await store(name);
      appendStoreReference(current.root, 'project-a', { type: 'project' });
      appendStoreReference(current.root, 'project-b', { type: 'project' });
      const result = await commitLearnedSkillPlan(
        await planLearnedSkillMutation(
          storeRequest([first.id, second.id], name),
          current.context
        ),
        { ...current.context, approveStore: true }
      );
      expect(result.outcome).toBe('created');
      sourceStores.push({ name, context: current.context });
    }

    const globalExecution = await resolveLearnedSkillExecutionContext({
      launchDirectory: first.root,
      requestedScope: 'global',
      globalDataDir,
    });
    const globalContext: LearnedSkillContext = {
      execution: globalExecution,
      globalDataDir,
    };
    const storeSources = sourceStores.map(({ name }) => ({
      owner: { type: 'store' as const, id: name },
      id: ID,
      knowledgeKey: KEY,
    }));
    const promotion = {
      version: 2 as const,
      operation: 'promote' as const,
      owner: { type: 'global' as const },
      id: ID,
      knowledgeKey: KEY,
      description: 'Lock rows in a transaction.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.',
      applicability: { mode: 'all' as const, markers: ['go.mod'] },
      evidence: [],
      sources: storeSources,
    };

    const plan = await planLearnedSkillMutation(promotion, globalContext);
    expect(plan).toMatchObject({
      action: 'create',
      scope: 'global',
      requiresGlobalApproval: true,
      sourceIdentities: [
        { owner: { type: 'store', id: 'team-a' }, id: ID },
        { owner: { type: 'store', id: 'team-b' }, id: ID },
      ],
    });
    const result = await commitLearnedSkillPlan(plan, {
      ...globalContext,
      approveGlobal: true,
    });
    expect(result).toMatchObject({
      outcome: 'created',
      identity: { owner: { type: 'global' }, id: ID },
    });

    const mixed = await planLearnedSkillMutation(
      {
        ...promotion,
        id: 'go-sql-mixed-locking',
        sources: [
          storeSources[0],
          {
            owner: { type: 'project' as const, id: first.id },
            id: ID,
            knowledgeKey: KEY,
          },
        ],
      },
      globalContext
    );
    expect(mixed).toMatchObject({
      action: 'blocked',
      block: { code: 'promotion_source_mixed' },
    });
  });

  it('refuses a copied v2 record whose typed owner names another store', async () => {
    const team = await store('team');
    const directory = path.join(team.root, 'rasen', 'learned-skills', ID);
    fs.mkdirSync(directory, { recursive: true });
    const content = '---\nname: copied\n---\n\nCopied.\n';
    const { digestContent } = await import('../../../src/core/learned-skills/index.js');
    fs.writeFileSync(path.join(directory, 'SKILL.md'), content);
    fs.writeFileSync(
      path.join(directory, 'learned-skill.yaml'),
      [
        'version: 2',
        `id: ${ID}`,
        `knowledgeKey: ${KEY}`,
        'scope: store',
        'owner:',
        '  type: store',
        '  id: other-team',
        'status: active',
        'generatedBy: rasen-learned-skill',
        `contentDigest: ${digestContent(content)}`,
        'description: Copied',
        'applicability:',
        '  mode: all',
        '  markers:',
        '    - go.mod',
        'evidence: []',
        'sources: []',
        'createdAt: 2026-07-25T00:00:00.000Z',
        'updatedAt: 2026-07-25T00:00:00.000Z',
        '',
      ].join('\n')
    );
    expect(await listCanonicalLearnedSkills('store', team.context)).toEqual([]);
    const plan = await planLearnedSkillMutation(
      { operation: 'retire', scope: 'store', id: ID },
      team.context
    );
    expect(plan).toMatchObject({
      action: 'blocked',
      block: { code: 'not_managed' },
    });
  });

  it('keeps a valid v1 project manifest byte-stable across typed reads', async () => {
    const first = await project('project-a');
    const created = await createProjectSource(first.id, first.context);
    const manifestPath = path.join(created.directory!, 'learned-skill.yaml');
    const before = fs.readFileSync(manifestPath);
    const [record] = await listCanonicalLearnedSkills('project', first.context);
    expect(record.identity).toEqual({
      owner: { type: 'project', id: first.id },
      id: ID,
    });
    expect(record.evidence[0].owner).toEqual({ type: 'project', id: first.id });
    expect(fs.readFileSync(manifestPath)).toEqual(before);
  });
});
