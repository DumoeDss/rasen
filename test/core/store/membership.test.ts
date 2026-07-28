import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import {
  appendStoreMembershipHint,
  readProjectConfig,
  updateProjectConfigKey,
} from '../../../src/core/project-config.js';
import {
  applyMembershipMutation,
  listProjectStoreCandidates,
  listStoreMembers,
  membershipHintFor,
  planMembershipMutation,
  resolveProjectMembership,
  unambiguousStoreSelector,
  writeMembershipRecord,
} from '../../../src/core/store/membership.js';
import {
  getStoreProjectRecordPath,
  readStoreProjectRecord,
  writeStoreProjectRecord,
} from '../../../src/core/store/project-records.js';
import {
  acquireOwnerAwareFileLock,
  machineLockPath,
  releaseOwnerAwareFileLock,
} from '../../../src/core/file-state.js';
import { upsertAdoptionEntry } from '../../../src/core/store/migration.js';
import { appendStoreReference } from '../../../src/core/project-config.js';
import { registerExistingStore } from '../../../src/core/store/operations.js';
import type { ResolvedStoreRef } from '../../../src/core/store/identity-types.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';

const PROJECT_A = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';
const PROJECT_B = 'aa11bb22-cc33-4d44-8e55-ff6677889900';

/** Every file under `dir` with its bytes, for a zero-writes assertion. */
function snapshot(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.set(path.relative(dir, full), fs.readFileSync(full, 'utf-8'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

describe('store membership provider', () => {
  let tempDir: string;
  let globalDataDir: string;
  let storeRoot: string;
  let store: ResolvedStoreRef;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-membership-'));
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });

    storeRoot = path.join(tempDir, 'team-store');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team-store', localPath: storeRoot, globalDataDir });
    store = { type: 'store', id: 'team-store', root: storeRoot };
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeProject(name: string, projectId: string): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    updateProjectConfigKey(root, 'projectId', projectId);
    return root;
  }

  describe('one answer across every provenance', () => {
    it('reports a current record with its roles and provenance', async () => {
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        id: 'elftia',
        roles: { planning: true, knowledge: true },
      });

      const listing = await listStoreMembers(store, { globalDataDir });
      expect(listing.members).toHaveLength(1);
      expect(listing.members[0]).toMatchObject({
        projectId: PROJECT_A,
        id: 'elftia',
        roles: { planning: true, knowledge: true },
        provenance: 'v2-record',
      });
    });

    it('normalizes legacy adoption data as planning-only, labelled inferred', async () => {
      await upsertAdoptionEntry(storeRoot, PROJECT_A, {
        specs: ['billing'],
        changes: ['add-thing'],
        timestamp: '2026-07-25T10:00:00Z',
      });

      const listing = await listStoreMembers(store, { globalDataDir });
      expect(listing.members[0]).toMatchObject({
        projectId: PROJECT_A,
        provenance: 'legacy-adoption',
        // An adoption proves planning membership and proves NOTHING about
        // knowledge; inventing it would widen what a later change materializes.
        roles: { planning: true, knowledge: false },
      });
      expect(listing.members[0]?.adoption).toEqual({
        specs: ['billing'],
        changes: ['add-thing'],
        adoptedAt: '2026-07-25T10:00:00Z',
      });
      expect(
        listing.members[0]?.diagnostics.map((diagnostic) => diagnostic.code)
      ).toContain('store_membership_roles_inferred');
    });

    it('normalizes a legacy project reference through the machine namespace', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      await registerExistingStore({ path: projectRoot, allowCreateIdentity: true, type: 'project' });
      appendStoreReference(storeRoot, 'elftia', { type: 'project' });

      const listing = await listStoreMembers(store, { globalDataDir });
      expect(listing.members).toHaveLength(1);
      expect(listing.members[0]).toMatchObject({
        projectId: PROJECT_A,
        provenance: 'legacy-reference',
        // The reference indexes the project's specs into the store's
        // instructions — that is a knowledge relation, not a planning one.
        roles: { planning: false, knowledge: true },
      });
    });

    it('reports an unmappable legacy reference rather than dropping or guessing it', async () => {
      appendStoreReference(storeRoot, 'never-registered', { type: 'project' });

      const listing = await listStoreMembers(store, { globalDataDir });
      expect(listing.members).toEqual([]);
      const codes = listing.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toContain('store_legacy_reference_unresolved');
      const finding = listing.diagnostics.find(
        (diagnostic) => diagnostic.code === 'store_legacy_reference_unresolved'
      );
      expect(finding?.message).toContain('never-registered');
      expect(finding?.fix).toBeTruthy();
    });

    it('lets a current record win over legacy data without producing a second member', async () => {
      await upsertAdoptionEntry(storeRoot, PROJECT_A, {
        specs: ['old'],
        changes: [],
        sourcePath: path.join(tempDir, 'somewhere-else'),
        timestamp: '2020-01-01T00:00:00Z',
      });
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        roles: { planning: true, knowledge: true },
        adoption: { specs: ['current'], changes: [], adoptedAt: '2026-07-25T10:00:00Z' },
      });

      const listing = await listStoreMembers(store, { globalDataDir });
      expect(listing.members).toHaveLength(1);
      expect(listing.members[0]?.provenance).toBe('v2-record');
      expect(listing.members[0]?.adoption?.specs).toEqual(['current']);
    });

    it('reports a machine path left in git-shared legacy data', async () => {
      await upsertAdoptionEntry(storeRoot, PROJECT_A, {
        specs: [],
        changes: [],
        sourcePath: path.join(tempDir, 'machine-a', 'elftia'),
        timestamp: '2026-07-25T10:00:00Z',
      });

      const listing = await listStoreMembers(store, { globalDataDir });
      const codes = listing.members[0]?.diagnostics.map((diagnostic) => diagnostic.code) ?? [];
      expect(codes).toContain('shared_metadata_contains_local_path');
      expect(listing.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'store_membership_legacy_manifest'
      );
    });

    it('answers one project the same way, narrowed', async () => {
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        roles: { planning: false, knowledge: true },
      });

      expect(await resolveProjectMembership(store, PROJECT_A, { globalDataDir })).toMatchObject({
        projectId: PROJECT_A,
        roles: { planning: false, knowledge: true },
      });
      expect(await resolveProjectMembership(store, PROJECT_B, { globalDataDir })).toBeNull();
    });

    it('writes nothing on any read path, including a legacy-only store', async () => {
      await upsertAdoptionEntry(storeRoot, PROJECT_A, {
        specs: ['billing'],
        changes: [],
        sourcePath: '/machine-a/elftia',
        timestamp: '2026-07-25T10:00:00Z',
      });
      appendStoreReference(storeRoot, 'never-registered', { type: 'project' });
      const before = snapshot(tempDir);

      await listStoreMembers(store, { globalDataDir });
      await resolveProjectMembership(store, PROJECT_A, { globalDataDir });

      expect(snapshot(tempDir)).toEqual(before);
    });
  });

  describe('two-machine sharding (why one file per project)', () => {
    it('writes two different files for two different projects', async () => {
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        roles: { planning: true, knowledge: false },
      });
      const afterFirst = snapshot(storeRoot);

      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_B,
        roles: { planning: false, knowledge: true },
      });

      const afterSecond = snapshot(storeRoot);
      const firstFile = path.relative(storeRoot, getStoreProjectRecordPath(storeRoot, PROJECT_A));
      const secondFile = path.relative(storeRoot, getStoreProjectRecordPath(storeRoot, PROJECT_B));

      expect(firstFile).not.toBe(secondFile);
      // The second addition touched no file the first wrote: merging the two
      // requires no conflict resolution.
      expect(afterSecond.get(firstFile)).toBe(afterFirst.get(firstFile));
      expect([...afterSecond.keys()].filter((key) => !afterFirst.has(key))).toEqual([secondFile]);
    });

    it('keeps two projects that share a display name as two records', async () => {
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        id: 'elftia',
        roles: { planning: true, knowledge: false },
      });
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_B,
        id: 'elftia',
        roles: { planning: false, knowledge: true },
      });

      const listing = await listStoreMembers(store, { globalDataDir });
      expect(listing.members.map((member) => member.projectId).sort()).toEqual(
        [PROJECT_A, PROJECT_B].sort()
      );
      expect(new Set(listing.members.map((member) => member.id))).toEqual(new Set(['elftia']));
    });
  });

  describe('eligibility union (design D5)', () => {
    it('unions declared hints with locally recorded members', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      const otherRoot = path.join(tempDir, 'knowledge-store');
      createOpenSpecRoot(otherRoot);
      await registerStore({ id: 'knowledge-store', localPath: otherRoot, globalDataDir });

      // Declared hint for one store...
      await appendStoreMembershipHint(projectRoot, { id: 'knowledge-store' });
      // ...and a record in ANOTHER store, with no hint for it.
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        roles: { planning: false, knowledge: true },
      });

      const listing = await listProjectStoreCandidates(projectRoot, { globalDataDir });
      expect(listing.candidates.map((candidate) => candidate.id).sort()).toEqual([
        'knowledge-store',
        'team-store',
      ]);

      const recorded = listing.candidates.find((candidate) => candidate.id === 'team-store');
      expect(recorded?.sources).toEqual(['record']);
      expect(recorded?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'project_membership_locator_missing'
      );
    });

    it('returns an unavailable declared store marked, never dropped or empty', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      await appendStoreMembershipHint(projectRoot, {
        uid: '99999999-9999-4999-8999-999999999999',
        id: 'somewhere-else',
      });

      const listing = await listProjectStoreCandidates(projectRoot, { globalDataDir });
      const missing = listing.candidates.find((candidate) => candidate.id === 'somewhere-else');
      expect(missing).toBeDefined();
      expect(missing?.unavailable?.reason).toBe('not-registered');
      expect(missing?.unavailable?.repair.length).toBeGreaterThan(0);
      expect(missing?.membership).toBeUndefined();
      expect(missing?.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'project_membership_unverified'
      );
    });

    it('does not report a hint alone as membership', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      await appendStoreMembershipHint(projectRoot, { id: 'team-store' });

      const listing = await listProjectStoreCandidates(projectRoot, { globalDataDir });
      const candidate = listing.candidates.find((entry) => entry.id === 'team-store');
      expect(candidate?.sources).toEqual(['hint']);
      expect(candidate?.membership).toBeUndefined();
    });

    it('reports both sources when the hint and the record agree', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      await appendStoreMembershipHint(projectRoot, { id: 'team-store' });
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        roles: { planning: false, knowledge: true },
      });

      const listing = await listProjectStoreCandidates(projectRoot, { globalDataDir });
      const candidate = listing.candidates.find((entry) => entry.id === 'team-store');
      expect(candidate?.sources.sort()).toEqual(['hint', 'record']);
      expect(candidate?.membership?.roles).toEqual({ planning: false, knowledge: true });
    });
  });

  describe('planning binding and membership are independent', () => {
    it('lets a project plan in A while being a knowledge member of B', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      const planningRoot = path.join(tempDir, 'planning-store');
      createOpenSpecRoot(planningRoot);
      await registerStore({ id: 'planning-store', localPath: planningRoot, globalDataDir });

      updateProjectConfigKey(projectRoot, 'store', 'planning-store');
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: PROJECT_A,
        roles: { planning: false, knowledge: true },
      });

      const membership = await resolveProjectMembership(store, PROJECT_A, { globalDataDir });
      expect(membership?.roles).toEqual({ planning: false, knowledge: true });
      // The planning binding is untouched by the membership record.
      expect(readProjectConfig(projectRoot)?.store).toBe('planning-store');
    });
  });

  describe('unambiguous selectors', () => {
    it('names the permanent identity when a display name matches two stores', () => {
      const entries = [
        {
          id: 'shared',
          type: 'store' as const,
          uid: '11111111-1111-4111-8111-111111111111',
          backend: { type: 'git' as const, local_path: '/one' },
        },
        {
          id: 'shared',
          type: 'store' as const,
          uid: '22222222-2222-4222-8222-222222222222',
          backend: { type: 'git' as const, local_path: '/two' },
        },
      ];
      expect(
        unambiguousStoreSelector(
          { id: 'shared', uid: '11111111-1111-4111-8111-111111111111' },
          entries
        )
      ).toBe('11111111-1111-4111-8111-111111111111');
      expect(unambiguousStoreSelector({ id: 'solo' }, entries)).toBe('solo');
    });
  });

  describe('two-repository mutation (design D6)', () => {
    function mutationInput(projectRoot: string) {
      return {
        projectRoot,
        projectId: PROJECT_A,
        projectDisplayId: 'elftia',
        store,
        roles: { planning: false, knowledge: true },
        globalDataDir,
      };
    }

    it('previews every file it would write and changes nothing', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      const before = snapshot(tempDir);

      const plan = await planMembershipMutation(mutationInput(projectRoot));
      expect(plan.storeWrites).toEqual([getStoreProjectRecordPath(storeRoot, PROJECT_A)]);
      expect(plan.projectWrites).toEqual([path.join(projectRoot, 'rasen', 'config.yaml')]);
      expect(snapshot(tempDir)).toEqual(before);
    });

    it('degrades to a null base commit for a non-git root rather than blocking', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      const plan = await planMembershipMutation(mutationInput(projectRoot));
      expect(plan.projectBaseCommit).toBeNull();
      expect(plan.storeBaseCommit).toBeNull();

      const result = await applyMembershipMutation(mutationInput(projectRoot));
      expect(result.applied).toBe(true);
    });

    it('writes and verifies the store record before the project hint', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      const result = await applyMembershipMutation(mutationInput(projectRoot));

      expect(result.storeRecordWritten).toBe(true);
      expect(result.projectHintWritten).toBe(true);
      expect(result.repairNeeded).toEqual([]);
      expect((await readStoreProjectRecord(storeRoot, PROJECT_A)).record).toMatchObject({
        projectId: PROJECT_A,
        roles: { planning: false, knowledge: true },
      });
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([{ id: 'team-store' }]);
    });

    it('keeps the store record standing when the project write fails', async () => {
      // A project with no config file at all: the hint has nowhere to go.
      const projectRoot = path.join(tempDir, 'no-config');
      fs.mkdirSync(projectRoot, { recursive: true });

      const result = await applyMembershipMutation(mutationInput(projectRoot));

      expect((await readStoreProjectRecord(storeRoot, PROJECT_A)).record).not.toBeNull();
      expect(result.repairNeeded).toHaveLength(1);
      expect(result.repairNeeded[0]?.code).toBe('project_membership_locator_missing');
      expect(result.repairNeeded[0]?.repair).toContain('rasen store add-project');
    });

    it('is diagnosable and repairable after an interrupted mutation', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      // Simulate the interruption: the store record landed, the hint did not.
      await writeMembershipRecord(mutationInput(projectRoot));
      expect(readProjectConfig(projectRoot)?.storeMemberships).toBeUndefined();

      const diagnosed = await listProjectStoreCandidates(projectRoot, { globalDataDir });
      expect(
        diagnosed.candidates[0]?.diagnostics.map((diagnostic) => diagnostic.code)
      ).toContain('project_membership_locator_missing');

      // Re-running completes it without rewriting the record.
      const repaired = await applyMembershipMutation(mutationInput(projectRoot));
      expect(repaired.storeRecordWritten).toBe(false);
      expect(repaired.projectHintWritten).toBe(true);
      expect(repaired.repairNeeded).toEqual([]);
    });

    it('renders a path-scoped commit suggestion per repository and runs neither', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      const before = fs.existsSync(path.join(projectRoot, '.git'));

      const result = await applyMembershipMutation(mutationInput(projectRoot));

      expect(result.suggestedCommits).toHaveLength(2);
      for (const commit of result.suggestedCommits) {
        expect(commit.command).toContain('git ');
        expect(commit.command).toContain('add');
      }
      // No git index was created anywhere by the mutation.
      expect(fs.existsSync(path.join(projectRoot, '.git'))).toBe(before);
      expect(fs.existsSync(path.join(storeRoot, '.git'))).toBe(false);
    });

    it('writes no machine path into either repository', async () => {
      const projectRoot = makeProject('elftia', PROJECT_A);
      await applyMembershipMutation({
        ...mutationInput(projectRoot),
        storeRemote: 'git@github.com:org/team-store.git',
      });

      const hints = readProjectConfig(projectRoot)?.storeMemberships ?? [];
      for (const hint of hints) {
        for (const value of Object.values(hint)) {
          if (typeof value === 'string') expect(path.isAbsolute(value)).toBe(false);
        }
      }

      const record = (await readStoreProjectRecord(storeRoot, PROJECT_A)).record;
      for (const value of Object.values(record ?? {})) {
        if (typeof value === 'string') expect(path.isAbsolute(value)).toBe(false);
      }
    });

    it('builds the hint from identity, alias, and remote only', () => {
      expect(
        membershipHintFor(
          { type: 'store', id: 'team-store', root: '/machine/local/path', uid: 'u' },
          'git@github.com:org/team-store.git'
        )
      ).toEqual({ uid: 'u', id: 'team-store', remote: 'git@github.com:org/team-store.git' });
    });
  });

  describe('concurrent membership record writes (M7 owner-aware lock)', () => {
    const KNOWLEDGE_PROJECT = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
    const ADOPTION_PROJECT = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';

    /** Removes the machineLockPath lock file for a given absolute record path. */
    function cleanMachineLock(absolutePath: string): void {
      const lockPath = machineLockPath(absolutePath);
      fs.rmSync(lockPath, { force: true });
    }

    afterEach(() => {
      // Clean any lock files left by tests in this block.
      cleanMachineLock(path.resolve(getStoreProjectRecordPath(storeRoot, KNOWLEDGE_PROJECT)));
      cleanMachineLock(path.resolve(getStoreProjectRecordPath(storeRoot, ADOPTION_PROJECT)));
    });

    it('preserves both fields when two concurrent writes target different fields of the same record', async () => {
      // Seed a base record.
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: KNOWLEDGE_PROJECT,
        roles: { planning: true, knowledge: false },
      });

      const recordPath = path.resolve(
        getStoreProjectRecordPath(storeRoot, KNOWLEDGE_PROJECT)
      );
      const lockPath = machineLockPath(recordPath);

      // Pre-acquire the lock so BOTH writes queue against it deterministically.
      // This forces real read-modify-write overlap rather than relying on
      // scheduler timing.
      const block = await acquireOwnerAwareFileLock({
        lockPath,
        errorFor: () => new Error('test-block'),
      });

      const promise = Promise.all([
        writeMembershipRecord({
          projectRoot: tempDir,
          projectId: KNOWLEDGE_PROJECT,
          store,
          // Adds knowledge role; planning stays as-is.
          roles: { planning: false, knowledge: true },
          globalDataDir,
        }),
        writeMembershipRecord({
          projectRoot: tempDir,
          projectId: KNOWLEDGE_PROJECT,
          store,
          // Sets an adoption; roles unchanged.
          roles: { planning: false, knowledge: false },
          adoption: {
            specs: ['billing'],
            changes: [],
            adoptedAt: '2026-07-27T00:00:00Z',
          },
          globalDataDir,
        }),
      ]);

      // Give both a moment to hit the lock, then release.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await releaseOwnerAwareFileLock(block);

      const [r1, r2] = await promise;
      expect(r1.changed).toBe(true);
      expect(r2.changed).toBe(true);

      // BOTH non-overlapping updates are present. Without the lock, the
      // second writer's composeRecord() would read the pre-first-write base
      // and the second write would clobber the first's field.
      const final = (await readStoreProjectRecord(storeRoot, KNOWLEDGE_PROJECT)).record;
      expect(final?.roles).toEqual({ planning: true, knowledge: true });
      expect(final?.adoption).toEqual({
        specs: ['billing'],
        changes: [],
        adoptedAt: '2026-07-27T00:00:00Z',
      });

      // Lock file cleaned up by the last writer's release.
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('does not serialize concurrent writes targeting different projects', async () => {
      // Different projectIds → different absolute record paths → different
      // lock paths → no mutual exclusion.
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: KNOWLEDGE_PROJECT,
        roles: { planning: false, knowledge: false },
      });
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId: ADOPTION_PROJECT,
        roles: { planning: false, knowledge: false },
      });

      const started = Date.now();
      await Promise.all([
        writeMembershipRecord({
          projectRoot: tempDir,
          projectId: KNOWLEDGE_PROJECT,
          store,
          roles: { planning: true, knowledge: false },
          globalDataDir,
        }),
        writeMembershipRecord({
          projectRoot: tempDir,
          projectId: ADOPTION_PROJECT,
          store,
          roles: { planning: false, knowledge: true },
          globalDataDir,
        }),
      ]);
      const elapsed = Date.now() - started;

      // Both finished quickly — no contention because they locked different
      // paths. The assertion guards against accidentally over-locking at the
      // Store-dir level.
      expect(elapsed).toBeLessThan(3_000);
    });
  });
});
