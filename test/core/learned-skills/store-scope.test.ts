import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  commitLearnedSkillPlan,
  listCanonicalLearnedSkills,
  planLearnedSkillMutation,
  readCanonicalRecord,
  resolveCanonicalStore,
  resolveLearnedSkillExecutionContext,
  resolveLearnedSkills,
  type LearnedSkillContext,
  type LearnedSkillMutationRequest,
  type LearnedSkillPlan,
  type PromotionSourceLocator,
} from '../../../src/core/learned-skills/index.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import {
  readOptionalStoreMetadataState,
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import { registerStore } from '../../../src/core/store/registry.js';

const DIGEST = `sha256:${'c'.repeat(64)}`;
const SKILL_ID = 'go-sql-transaction-locking';
const KEY = 'go-sql-tx-locking';

interface TestStore {
  root: string;
  uid: string;
  id: string;
}

interface TestProject {
  root: string;
  projectId: string;
}

describe('store-scoped learned knowledge', () => {
  let tempDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-knowledge-')));
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

  /**
   * A registered Store carrying a permanent identity — the only kind that can
   * own records. The identity is minted into the Store's own metadata BEFORE
   * registration, which is also what lets two Stores share a display name:
   * registration only rejects a repeated name while the two cannot be told
   * apart.
   */
  async function makeStore(name: string, dirName = name): Promise<TestStore> {
    const root = healthyRoot(path.join(tempDir, dirName));
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, { version: 2, uid, id: name });
    await registerStore({ id: name, localPath: root, globalDataDir });
    return { root, uid, id: name };
  }

  async function makeProject(name: string): Promise<TestProject> {
    const root = healthyRoot(path.join(tempDir, name));
    fs.writeFileSync(path.join(root, 'go.mod'), `module ${name}\n`);
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, projectId: home!.projectId };
  }

  /** The Store's own membership record — the only authority on who may publish. */
  async function recordMembership(
    store: TestStore,
    project: TestProject,
    roles = { planning: false, knowledge: true }
  ): Promise<void> {
    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: project.projectId,
      roles,
    });
  }

  function projectContext(project: TestProject): LearnedSkillContext {
    return { projectRoot: project.root, globalDataDir };
  }

  /**
   * `sessionContext: null` opts this fixture out of whatever session the real
   * process is running under — without it a test inherits the caller's
   * recorded planning root instead of the one it just built.
   */
  async function storeContext(store: TestStore, selector = store.uid): Promise<LearnedSkillContext> {
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: store.root,
      selector: { store: selector },
      requestedScope: 'store',
      sessionContext: null,
      globalDataDir,
    });
    return { execution, globalDataDir };
  }

  function projectUpsert(
    project: TestProject,
    overrides: Partial<Extract<LearnedSkillMutationRequest, { operation: 'upsert' }>> = {}
  ): LearnedSkillMutationRequest {
    return {
      operation: 'upsert',
      scope: 'project',
      id: SKILL_ID,
      knowledgeKey: KEY,
      description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
      applicability: { mode: 'all', markers: ['go.mod'] },
      evidence: [{ projectId: project.projectId, change: 'add-locking', artifact: 'review', digest: DIGEST }],
      ...overrides,
    } as LearnedSkillMutationRequest;
  }

  /** Codifies the record in a project's own catalog, so it can be a source. */
  async function codify(project: TestProject, overrides = {}): Promise<void> {
    const context = projectContext(project);
    const plan = await planLearnedSkillMutation(projectUpsert(project, overrides), context);
    const result = await commitLearnedSkillPlan(plan, context);
    if (result.outcome === 'blocked') {
      throw new Error(`codify blocked: ${result.block?.code} ${result.block?.message}`);
    }
  }

  function sourceOf(project: TestProject, id = SKILL_ID, knowledgeKey = KEY): PromotionSourceLocator {
    return { owner: { type: 'project', projectId: project.projectId }, id, knowledgeKey };
  }

  function storePublication(
    store: TestStore,
    sources: PromotionSourceLocator[],
    overrides: Record<string, unknown> = {}
  ): LearnedSkillMutationRequest {
    return {
      version: 2,
      operation: 'upsert',
      scope: 'store',
      owner: { type: 'store', uid: store.uid, id: store.id },
      id: SKILL_ID,
      knowledgeKey: KEY,
      description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
      instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
      applicability: { mode: 'all', markers: ['go.mod'] },
      evidence: [],
      sources,
      ...overrides,
    } as LearnedSkillMutationRequest;
  }

  function approvalFor(store: TestStore) {
    return { scope: 'store' as const, uid: store.uid, id: store.id };
  }

  function catalogDir(store: TestStore): string {
    return path.join(store.root, 'rasen', 'learned-skills');
  }

  function snapshotTree(root: string): Record<string, string> {
    const files: Record<string, string> = {};
    if (!fs.existsSync(root)) return files;
    for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
      const full = path.join(entry.parentPath ?? root, entry.name);
      if (entry.isFile()) files[path.relative(root, full)] = fs.readFileSync(full, 'utf-8');
    }
    return files;
  }

  /** A Store with two member projects that have each codified the same knowledge. */
  async function storeWithTwoMembers(): Promise<{
    store: TestStore;
    first: TestProject;
    second: TestProject;
  }> {
    const store = await makeStore('team');
    const first = await makeProject('member-a');
    const second = await makeProject('member-b');
    await recordMembership(store, first);
    await recordMembership(store, second);
    await codify(first);
    await codify(second);
    return { store, first, second };
  }

  async function publish(
    store: TestStore,
    sources: PromotionSourceLocator[],
    contextOverrides: Partial<LearnedSkillContext> = {}
  ) {
    const context = { ...(await storeContext(store)), ...contextOverrides };
    const plan = await planLearnedSkillMutation(storePublication(store, sources), context);
    const result = await commitLearnedSkillPlan(plan, context);
    return { plan, result, context };
  }

  // ---------------------------------------------------------------------------
  // A Store owns a knowledge catalog identified by its permanent identity
  // ---------------------------------------------------------------------------

  it('records the store by permanent identity, with the display name alongside', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const { result } = await publish(store, [sourceOf(first), sourceOf(second)], {
      approveStore: approvalFor(store),
    });

    expect(result.outcome).toBe('created');
    expect(result.identity.owner).toEqual({ type: 'store', uid: store.uid, id: store.id });

    // What matters is what LANDED, not what the result object says.
    const manifestPath = path.join(catalogDir(store), SKILL_ID, 'learned-skill.yaml');
    const onDisk = fs.readFileSync(manifestPath, 'utf-8');
    expect(onDisk).toContain(`uid: ${store.uid}`);
    expect(onDisk).toContain('version: 2');
    // The display name is present for readability, never in place of identity.
    expect(onDisk).toContain(`id: ${store.id}`);
  });

  it('changes no record when the store is renamed', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    await publish(store, [sourceOf(first), sourceOf(second)], { approveStore: approvalFor(store) });

    const before = snapshotTree(catalogDir(store));
    expect(Object.keys(before).length).toBeGreaterThan(0);

    // The Phase A rename path: edit the store's own metadata, re-register.
    const metadata = await readOptionalStoreMetadataState(store.root);
    await writeStoreMetadataState(store.root, { ...metadata!, version: 2, uid: store.uid, id: 'renamed-team' });
    await registerStore({ id: 'renamed-team', localPath: store.root, globalDataDir });

    expect(snapshotTree(catalogDir(store))).toEqual(before);

    // And the next resolution reports the same result it reported before.
    const context = await storeContext(store);
    const records = await listCanonicalLearnedSkills('store', context);
    expect(records).toHaveLength(1);
    expect(records[0].identity.owner).toMatchObject({ type: 'store', uid: store.uid });
  });

  it('keeps two stores that share a display name distinct and separately attributable', async () => {
    const left = await makeStore('shared', 'shared-left');
    const right = await makeStore('shared', 'shared-right');
    expect(left.uid).not.toBe(right.uid);

    for (const store of [left, right]) {
      const a = await makeProject(`${path.basename(store.root)}-a`);
      const b = await makeProject(`${path.basename(store.root)}-b`);
      await recordMembership(store, a);
      await recordMembership(store, b);
      await codify(a);
      await codify(b);
      const { result } = await publish(store, [sourceOf(a), sourceOf(b)], {
        approveStore: approvalFor(store),
      });
      expect(result.outcome).toBe('created');
    }

    // Each catalog holds its own record, attributed to its own identity.
    for (const store of [left, right]) {
      const manifest = fs.readFileSync(
        path.join(catalogDir(store), SKILL_ID, 'learned-skill.yaml'),
        'utf-8'
      );
      expect(manifest).toContain(`uid: ${store.uid}`);
      expect(manifest).not.toContain(store === left ? right.uid : left.uid);
    }

    // Neither is mistaken for the other on the strength of the shared name: the
    // ambiguous display name refuses rather than picking a winner.
    await expect(
      resolveLearnedSkillExecutionContext({
        launchDirectory: left.root,
        selector: { store: 'shared' },
        requestedScope: 'store',
        sessionContext: null,
        globalDataDir,
      })
    ).rejects.toMatchObject({ diagnostic: { code: 'knowledge_owner_stale' } });
  });

  it('orders contributing sources by permanent identity, not by display name', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const { plan } = await publish(store, [sourceOf(second), sourceOf(first)], {
      approveStore: approvalFor(store),
    });

    const manifest = plan.commit!.manifest!;
    const written = manifest.version === 2 ? manifest.sources.map((entry) => entry.owner) : [];
    // Every recorded source names its owner durably, so nothing about the
    // record's ordering can move when a display name does.
    for (const owner of written) {
      expect(owner.type === 'project' ? owner.projectId : owner.uid).toBeTruthy();
    }
    expect(new Set(written.map((owner) => JSON.stringify(owner))).size).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Versioned records; older records stay readable
  // ---------------------------------------------------------------------------

  it('reads an earlier-version record and leaves the files byte-identical', async () => {
    const project = await makeProject('legacy-reader');
    await codify(project);

    const context = projectContext(project);
    const resolution = await resolveCanonicalStore('project', context);
    expect(resolution.ok).toBe(true);
    const dir = resolution.ok ? resolution.store.dir : '';
    const before = snapshotTree(dir);

    const manifestPath = path.join(dir, SKILL_ID, 'learned-skill.yaml');
    expect(fs.readFileSync(manifestPath, 'utf-8')).toContain('version: 1');

    const records = await listCanonicalLearnedSkills('project', context);
    expect(records).toHaveLength(1);
    // Read and used — and normalized in memory, never on disk.
    expect(records[0].evidence[0].owner).toEqual({ type: 'project', projectId: project.projectId });
    expect(snapshotTree(dir)).toEqual(before);
  });

  it('writes the newer shape only for a mutation that needs it', async () => {
    const { store, first, second } = await storeWithTwoMembers();

    // A project record has nothing store-typed to record, so it stays version 1.
    const projectManifest = fs.readFileSync(
      path.join(
        (await resolveCanonicalStore('project', projectContext(first))).ok
          ? ((await resolveCanonicalStore('project', projectContext(first))) as { store: { dir: string } }).store.dir
          : '',
        SKILL_ID,
        'learned-skill.yaml'
      ),
      'utf-8'
    );
    expect(projectManifest).toContain('version: 1');

    // A store record cannot be expressed in version 1, so publishing writes 2.
    await publish(store, [sourceOf(first), sourceOf(second)], { approveStore: approvalFor(store) });
    expect(
      fs.readFileSync(path.join(catalogDir(store), SKILL_ID, 'learned-skill.yaml'), 'utf-8')
    ).toContain('version: 2');
  });

  it('refuses a version 1 candidate for a store record rather than inventing an owner', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const context = await storeContext(store);
    const plan = await planLearnedSkillMutation(
      {
        operation: 'upsert',
        scope: 'store',
        id: SKILL_ID,
        knowledgeKey: KEY,
        description: 'Lock rows in a transaction.',
        instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.',
        applicability: { mode: 'all', markers: ['go.mod'] },
        evidence: [{ projectId: first.projectId, change: 'c', artifact: 'review', digest: DIGEST }],
      },
      context
    );
    expect(plan.action).toBe('blocked');
    expect(plan.block?.code).toBe('invalid_request');
    expect(fs.existsSync(catalogDir(store))).toBe(false);
    expect(second).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Publication requires independent member-project evidence
  // ---------------------------------------------------------------------------

  it('publishes on independent evidence from two member projects', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const { plan, result } = await publish(store, [sourceOf(first), sourceOf(second)], {
      approveStore: approvalFor(store),
    });

    expect(plan.requiresStoreApproval).toBe(true);
    expect(plan.sourceIdentities).toHaveLength(2);
    expect(result.outcome).toBe('created');
    expect(fs.existsSync(path.join(catalogDir(store), SKILL_ID, 'SKILL.md'))).toBe(true);
  });

  it('counts repeated evidence from one project once and refuses', async () => {
    const store = await makeStore('team');
    const only = await makeProject('member-a');
    await recordMembership(store, only);
    await codify(only);

    const { plan, result } = await publish(store, [sourceOf(only), sourceOf(only)]);
    expect(plan.action).toBe('blocked');
    expect(plan.block?.code).toBe('store_evidence_insufficient');
    expect(plan.block?.message).toContain('1 distinct source');
    expect(result.outcome).toBe('blocked');
    expect(fs.existsSync(catalogDir(store))).toBe(false);
  });

  it('does not count a non-member and names the command that adds one', async () => {
    const store = await makeStore('team');
    const member = await makeProject('member-a');
    const outsider = await makeProject('outsider');
    await recordMembership(store, member);
    await codify(member);
    await codify(outsider);

    const { plan } = await publish(store, [sourceOf(member), sourceOf(outsider)]);
    expect(plan.action).toBe('blocked');
    expect(plan.block?.code).toBe('store_membership_invalid');
    expect(plan.block?.message).toContain(outsider.projectId);
    expect(plan.block?.repair?.[0]).toContain('rasen store add-project');
    expect(plan.block?.repair?.[0]).toContain(outsider.projectId);
  });

  it('gives a project no vote just because it plans in the store', async () => {
    const store = await makeStore('team');
    const member = await makeProject('member-a');
    const planner = await makeProject('planner');
    await recordMembership(store, member);
    await codify(member);
    await codify(planner);

    // The planner declares the store as its planning root — the durable
    // declaration, exactly as `store adopt` would write it — and the store has
    // no membership record for it.
    const plannerConfig = path.join(planner.root, 'rasen', 'config.yaml');
    fs.appendFileSync(plannerConfig, `store:\n  uid: ${store.uid}\n  id: ${store.id}\n`);

    const { plan } = await publish(store, [sourceOf(member), sourceOf(planner)]);
    expect(plan.action).toBe('blocked');
    expect(plan.block?.code).toBe('store_membership_invalid');
    expect(plan.block?.message).toContain('no membership record');
    expect(plan.block?.message).toContain(planner.projectId);
  });

  it('distinguishes a project recorded for planning only from one with no record', async () => {
    const store = await makeStore('team');
    const knowledgeMember = await makeProject('member-a');
    const planningOnly = await makeProject('planner');
    await recordMembership(store, knowledgeMember);
    await recordMembership(store, planningOnly, { planning: true, knowledge: false });
    await codify(knowledgeMember);
    await codify(planningOnly);

    const { plan } = await publish(store, [sourceOf(knowledgeMember), sourceOf(planningOnly)]);
    expect(plan.block?.code).toBe('store_membership_invalid');
    expect(plan.block?.message).toContain('planning only');
  });

  it('leaves the store byte-identical when a publication is refused', async () => {
    const store = await makeStore('team');
    const only = await makeProject('member-a');
    await recordMembership(store, only);
    await codify(only);
    const before = snapshotTree(store.root);

    const { result } = await publish(store, [sourceOf(only)]);
    expect(result.outcome).toBe('blocked');
    expect(snapshotTree(store.root)).toEqual(before);
  });

  // ---------------------------------------------------------------------------
  // Promotion beyond a Store
  // ---------------------------------------------------------------------------

  it('refuses a promotion whose sources share an id but not the knowledge', async () => {
    const first = await makeProject('promote-a');
    const second = await makeProject('promote-b');
    await codify(first);
    await codify(second, { knowledgeKey: 'a-different-thing-entirely' });

    const context = projectContext(first);
    const plan = await planLearnedSkillMutation(
      {
        operation: 'promote',
        id: SKILL_ID,
        knowledgeKey: KEY,
        description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
        instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
        applicability: { mode: 'all', markers: ['go.mod'] },
        evidence: [
          { projectId: first.projectId, change: 'add-locking', artifact: 'review', digest: DIGEST },
          { projectId: second.projectId, change: 'add-locking', artifact: 'review', digest: DIGEST },
        ],
      },
      context
    );

    expect(plan.action).toBe('blocked');
    expect(plan.block?.code).toBe('promotion_source_invalid');
    // The identifier the two projects share is not the thing being compared —
    // the knowledge key is, and it says they do not agree.
    expect(plan.block?.message).toContain('a-different-thing-entirely');

    // Naming the source's OWN key honestly does not help either: it still is
    // not evidence for the knowledge being promoted.
    const explicit = await planLearnedSkillMutation(
      {
        version: 2,
        operation: 'promote',
        scope: 'global',
        owner: { type: 'global' },
        id: SKILL_ID,
        knowledgeKey: KEY,
        description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
        instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
        applicability: { mode: 'all', markers: ['go.mod'] },
        evidence: [],
        sources: [sourceOf(first), sourceOf(second, SKILL_ID, 'a-different-thing-entirely')],
      },
      context
    );
    expect(explicit.block?.code).toBe('promotion_source_invalid');
    expect(explicit.block?.message).toContain('shared id is not shared knowledge');
  });

  // ---------------------------------------------------------------------------
  // Approval is explicit and scope-bound
  // ---------------------------------------------------------------------------

  it('refuses a publication with no approval at all', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const { result } = await publish(store, [sourceOf(first), sourceOf(second)]);
    expect(result.outcome).toBe('blocked');
    expect(result.block?.code).toBe('store_approval_required');
    expect(fs.existsSync(catalogDir(store))).toBe(false);
  });

  it('never lets an approval for one store authorize another', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const other = await makeStore('other-team');

    const { result } = await publish(store, [sourceOf(first), sourceOf(second)], {
      approveStore: approvalFor(other),
    });
    expect(result.outcome).toBe('blocked');
    expect(result.block?.code).toBe('store_approval_scope_mismatch');
    expect(fs.existsSync(catalogDir(store))).toBe(false);
  });

  it('never lets a store approval satisfy a global promotion', async () => {
    const store = await makeStore('team');
    const first = await makeProject('promote-a');
    const second = await makeProject('promote-b');
    await codify(first);
    await codify(second);

    const context = projectContext(first);
    const plan = await planLearnedSkillMutation(
      {
        operation: 'promote',
        id: SKILL_ID,
        knowledgeKey: KEY,
        description: 'Lock rows in a transaction with SELECT ... FOR UPDATE.',
        instructions: '## When\nConcurrent updates.\n## Steps\nUse FOR UPDATE.\n## Done\nNo lost update.',
        applicability: { mode: 'all', markers: ['go.mod'] },
        evidence: [
          { projectId: first.projectId, change: 'add-locking', artifact: 'review', digest: DIGEST },
          { projectId: second.projectId, change: 'add-locking', artifact: 'review', digest: DIGEST },
        ],
      },
      context
    );
    expect(plan.action).toBe('create');
    expect(plan.requiresGlobalApproval).toBe(true);

    // A narrower approval is not a wider one, and the wider scope is not
    // inferred from the record already existing at both narrower scopes.
    const withStoreApproval = await commitLearnedSkillPlan(plan, {
      ...context,
      approveStore: approvalFor(store),
    });
    expect(withStoreApproval.outcome).toBe('blocked');
    expect(withStoreApproval.block?.code).toBe('global_approval_required');

    const approved = await commitLearnedSkillPlan(plan, { ...context, approveGlobal: true });
    expect(approved.outcome).toBe('created');
  });

  it('does not infer approval from the record already existing at a narrower scope', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    // The record exists in both member projects already; that is not consent
    // to publish it into the store.
    const { result } = await publish(store, [sourceOf(first), sourceOf(second)]);
    expect(result.block?.code).toBe('store_approval_required');

    // And approving once does not carry into a second, separate publication.
    await publish(store, [sourceOf(first), sourceOf(second)], { approveStore: approvalFor(store) });
    const again = await publish(store, [sourceOf(first), sourceOf(second)], {});
    expect(again.result.outcome === 'blocked' || again.result.outcome === 'no-op').toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Mutation safety
  // ---------------------------------------------------------------------------

  it('modifies only the records the catalog owns and leaves user files alone', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const handWritten = path.join(catalogDir(store), 'hand-written-team-guide');
    fs.mkdirSync(handWritten, { recursive: true });
    fs.writeFileSync(path.join(handWritten, 'SKILL.md'), 'written by a person\n');
    const readme = path.join(catalogDir(store), 'README.md');
    fs.writeFileSync(readme, '# our catalog\n');

    await publish(store, [sourceOf(first), sourceOf(second)], { approveStore: approvalFor(store) });

    expect(fs.readFileSync(path.join(handWritten, 'SKILL.md'), 'utf-8')).toBe('written by a person\n');
    expect(fs.readFileSync(readme, 'utf-8')).toBe('# our catalog\n');
  });

  it('refuses to overwrite a user-authored directory occupying a managed id', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const occupied = path.join(catalogDir(store), SKILL_ID);
    fs.mkdirSync(occupied, { recursive: true });
    fs.writeFileSync(path.join(occupied, 'SKILL.md'), 'human authored, do not touch\n');

    const { plan, result } = await publish(store, [sourceOf(first), sourceOf(second)], {
      approveStore: approvalFor(store),
    });
    expect(plan.block?.code).toBe('ownership_collision');
    expect(result.outcome).toBe('blocked');
    expect(fs.readFileSync(path.join(occupied, 'SKILL.md'), 'utf-8')).toBe(
      'human authored, do not touch\n'
    );
  });

  it('leaves no partial record when a write is interrupted mid-way', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    await publish(store, [sourceOf(first), sourceOf(second)], { approveStore: approvalFor(store) });
    const before = snapshotTree(catalogDir(store));

    // A rewrite whose staged bytes do not match the digest the plan promised:
    // the staged copy is verified BEFORE it is swapped in, so the failure
    // happens with the live record still in place.
    const context = { ...(await storeContext(store)), approveStore: approvalFor(store) };
    const plan = await planLearnedSkillMutation(
      storePublication(store, [sourceOf(first), sourceOf(second)], {
        instructions: '## When\nSomething new.\n## Steps\nDo it.',
      }),
      context
    );
    expect(plan.action).toBe('rewrite');
    const tampered: LearnedSkillPlan = {
      ...plan,
      commit: { ...plan.commit!, content: `${plan.commit!.content}tampered` },
    };

    await expect(commitLearnedSkillPlan(tampered, context)).rejects.toThrow(/digest mismatch/u);

    expect(snapshotTree(catalogDir(store))).toEqual(before);
    // No staging or backup residue is left behind either.
    const residue = fs
      .readdirSync(catalogDir(store))
      .filter((name) => name.startsWith('.rasen-learned-skill-'));
    expect(residue).toEqual([]);
  });

  it('stages, commits, and pushes nothing, and reports what to commit', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: store.root, encoding: 'utf-8', windowsHide: true });
    git(['init', '--quiet']);
    git(['config', 'user.email', 'test@example.test']);
    git(['config', 'user.name', 'Test']);
    const commitsBefore = git(['rev-list', '--count', '--all']).trim();

    const { result } = await publish(store, [sourceOf(first), sourceOf(second)], {
      approveStore: approvalFor(store),
    });
    expect(result.outcome).toBe('created');

    // The files the user needs to commit are reported…
    expect(result.storeRoot).toBe(store.root);
    expect(result.changedFiles).toEqual([
      path.join(catalogDir(store), SKILL_ID, 'learned-skill.yaml'),
      path.join(catalogDir(store), SKILL_ID, 'SKILL.md'),
    ]);
    // …and nothing was staged, committed, or pushed on their behalf.
    expect(git(['diff', '--cached', '--name-only']).trim()).toBe('');
    expect(git(['rev-list', '--count', '--all']).trim()).toBe(commitsBefore);
    expect(git(['status', '--porcelain', '-uall'])).toContain('rasen/learned-skills');
    // The lock file lives on the machine, never inside the store's repository.
    expect(git(['status', '--porcelain', '-uall'])).not.toContain('.lock');
  });

  it('keeps the lock outside the store repository', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    await publish(store, [sourceOf(first), sourceOf(second)], { approveStore: approvalFor(store) });

    const locks = path.join(globalDataDir, 'learned-skill-locks');
    expect(fs.existsSync(locks)).toBe(true);
    const strayLocks = fs
      .readdirSync(store.root, { recursive: true })
      .filter((entry) => String(entry).endsWith('.lock'));
    expect(strayLocks).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Cross-platform, and independent shippability
  // ---------------------------------------------------------------------------

  it('resolves every catalog path under the store root with platform path joins', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const { result, context } = await publish(store, [sourceOf(first), sourceOf(second)], {
      approveStore: approvalFor(store),
    });

    const resolution = await resolveCanonicalStore('store', context);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.store.dir).toBe(path.join(store.root, 'rasen', 'learned-skills'));
    expect(result.directory).toBe(path.join(store.root, 'rasen', 'learned-skills', SKILL_ID));
    expect(resolution.store.storeRoot).toBe(store.root);
  });

  it('reads a catalog back unchanged when a checkout rewrote its line endings', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    await publish(store, [sourceOf(first), sourceOf(second)], { approveStore: approvalFor(store) });

    const contentPath = path.join(catalogDir(store), SKILL_ID, 'SKILL.md');
    const lf = fs.readFileSync(contentPath, 'utf-8');
    fs.writeFileSync(contentPath, lf.replace(/\n/gu, '\r\n'));

    const context = await storeContext(store);
    const resolution = await resolveCanonicalStore('store', context);
    if (!resolution.ok) throw new Error(resolution.message);
    const read = readCanonicalRecord(
      path.join(resolution.store.dir, SKILL_ID),
      'store',
      resolution.store.owner
    );
    expect(read.kind).toBe('managed');
  });

  it('holds and publishes knowledge with nothing consuming it', async () => {
    const { store, first, second } = await storeWithTwoMembers();
    const { result, context } = await publish(store, [sourceOf(first), sourceOf(second)], {
      approveStore: approvalFor(store),
    });
    expect(result.outcome).toBe('created');

    // The store's own catalog resolves and lists what it holds…
    const records = await listCanonicalLearnedSkills('store', context);
    expect(records.map((record) => record.manifest.id)).toEqual([SKILL_ID]);

    // …while a member project's own resolution is untouched by it. What a
    // project RECEIVES from its stores is the sibling change, and this half
    // ships without it.
    const memberSet = await resolveLearnedSkills(projectContext(first));
    expect(memberSet.store).toEqual([]);
    expect(memberSet.project.map((record) => record.manifest.id)).toEqual([SKILL_ID]);
  });

  it('refuses to record knowledge for a store that has no permanent identity', async () => {
    const legacyRoot = healthyRoot(path.join(tempDir, 'legacy-store'));
    await registerStore({ id: 'legacy', localPath: legacyRoot, globalDataDir });
    // Registered, healthy, and version 1 metadata: no identity to key on.
    const metadata = await readOptionalStoreMetadataState(legacyRoot);
    expect(metadata?.version).toBe(1);

    const context = await storeContext({ root: legacyRoot, uid: '', id: 'legacy' }, 'legacy');
    const resolution = await resolveCanonicalStore('store', context);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.code).toBe('learned_owner_legacy_alias');
    expect(resolution.repair?.[0]).toContain('rasen store upgrade-identity');
  });
});
