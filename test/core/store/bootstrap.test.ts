import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every process launch this file's imports can reach, recorded. Bootstrap runs
 * no version-control operation, and the honest way to prove that is to watch
 * the launcher rather than to read the two files it was written in.
 */
const { childProcessCalls } = vi.hoisted(() => ({ childProcessCalls: [] as string[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const record =
    (name: string, fn: unknown) =>
    (...args: unknown[]): unknown => {
      childProcessCalls.push(`${name} ${String(args[0])}`);
      return (fn as (...inner: unknown[]) => unknown)(...args);
    };
  return {
    ...actual,
    spawn: record('spawn', actual.spawn),
    spawnSync: record('spawnSync', actual.spawnSync),
    exec: record('exec', actual.exec),
    execSync: record('execSync', actual.execSync),
    execFile: record('execFile', actual.execFile),
    execFileSync: record('execFileSync', actual.execFileSync),
    fork: record('fork', actual.fork),
  };
});

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import {
  appendStoreMembershipHint,
  updateProjectConfigKey,
} from '../../../src/core/project-config.js';
import {
  allBootstrapDiagnostics,
  buildBootstrapReport,
  classifyBootstrapStore,
  computeBootstrapEndState,
  declaredRemoteResolver,
  deriveSafeLocationName,
  isMutatingRepair,
  selectBootstrapLocation,
  type BootstrapRemoteResolver,
  type BootstrapReport,
  type BootstrapStoreEntry,
} from '../../../src/core/store/bootstrap.js';
import {
  getStoreMetadataPath,
  getStoreRegistryPath,
  readOptionalStoreMetadataState,
  storeMetadataUid,
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { registerExistingStore } from '../../../src/core/store/operations.js';
import {
  getStoreProjectRecordPath,
  writeStoreProjectRecord,
} from '../../../src/core/store/project-records.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { sourceFiles, withoutComments } from '../../helpers/source-guards.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PROJECT_ID = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';
const OTHER_PROJECT_ID = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const ABSENT_UID = '99999999-9999-4999-8999-999999999999';

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

function entryFor(report: BootstrapReport, selector: string): BootstrapStoreEntry {
  const entry = report.stores.find(
    (candidate) => candidate.selector === selector || candidate.id === selector
  );
  expect(entry, `no entry for ${selector} in ${JSON.stringify(report.stores)}`).toBeDefined();
  return entry as BootstrapStoreEntry;
}

/** Every distinct command this entry would have bootstrap print. */
function commandsIn(entry: BootstrapStoreEntry): string[] {
  return [
    ...new Set(
      [...entry.repair, ...entry.membership.repair]
        .filter((repair) => repair.kind === 'command')
        .map((repair) => (repair as { command: string }).command)
    ),
  ];
}

describe('bootstrap classification and end state (pure)', () => {
  it('maps every branch of the tri-state onto a report class', () => {
    expect(classifyBootstrapStore({ resolution: { kind: 'resolved' } })).toEqual({
      class: 'verified',
    });

    expect(
      classifyBootstrapStore({
        resolution: { kind: 'unavailable', reason: 'not-registered' },
        presentAt: path.join('C:', 'stores', 'team'),
      })
    ).toEqual({ class: 'present-unregistered', reason: 'not-registered' });

    expect(
      classifyBootstrapStore({
        resolution: { kind: 'unavailable', reason: 'not-registered' },
        remote: 'https://example.test/team-store.git',
      })
    ).toEqual({ class: 'absent-with-remote', reason: 'not-registered' });

    expect(
      classifyBootstrapStore({ resolution: { kind: 'unavailable', reason: 'not-registered' } })
    ).toEqual({ class: 'absent-without-remote', reason: 'not-registered' });

    // The remaining reasons are NOT a matter of obtaining the Store: they are
    // the arm where it cannot be resolved or read at all.
    for (const reason of [
      'metadata-missing',
      'uid-mismatch',
      'root-unhealthy',
      'alias-ambiguous',
      'pointer-malformed',
    ] as const) {
      expect(
        classifyBootstrapStore({
          resolution: { kind: 'unavailable', reason },
          remote: 'https://example.test/team-store.git',
        }),
        reason
      ).toEqual({ class: 'unresolvable', reason });
    }
  });

  it('a supplied location decides present-unregistered, which the reason cannot', () => {
    // The landed `not-registered` reason is identical in both calls; only the
    // derived presence tells them apart. This is the distinction no landed
    // surface provides.
    const resolution = { kind: 'unavailable', reason: 'not-registered' } as const;
    expect(classifyBootstrapStore({ resolution, presentAt: '/somewhere' }).class).toBe(
      'present-unregistered'
    );
    expect(classifyBootstrapStore({ resolution }).class).toBe('absent-without-remote');
  });

  it('computes each of the three end states', () => {
    const confirmed = { state: 'confirmed' as const, repair: [] };

    expect(
      computeBootstrapEndState({
        stores: [{ class: 'verified', membership: confirmed }],
        projects: [],
        problems: [],
        diagnostics: [],
      })
    ).toBe('complete');

    expect(
      computeBootstrapEndState({
        stores: [{ class: 'absent-with-remote', membership: confirmed }],
        projects: [],
        problems: [],
        diagnostics: [],
      })
    ).toBe('degraded');

    expect(
      computeBootstrapEndState({
        stores: [{ class: 'verified', membership: { state: 'not-recorded', repair: [] } }],
        projects: [],
        problems: [],
        diagnostics: [],
      })
    ).toBe('degraded');

    expect(
      computeBootstrapEndState({
        stores: [{ class: 'unresolvable', membership: confirmed }],
        projects: [],
        problems: [],
        diagnostics: [],
      })
    ).toBe('blocked');

    expect(
      computeBootstrapEndState({ stores: [], projects: [], problems: [{}], diagnostics: [] })
    ).toBe('blocked');

    expect(
      computeBootstrapEndState({
        stores: [],
        projects: [{ presence: 'obtainable' }],
        problems: [],
        diagnostics: [],
      })
    ).toBe('degraded');
  });

  it('never reports complete over an error-severity diagnostic', () => {
    // The rule stated once, on the pure function: a report that looks entirely
    // healthy by its returned values is still not `complete` if something it
    // read degraded to an error diagnostic.
    const confirmed = { state: 'confirmed' as const, repair: [] };
    const healthy = {
      stores: [{ class: 'verified' as const, membership: confirmed }],
      projects: [],
      problems: [],
    };

    expect(computeBootstrapEndState({ ...healthy, diagnostics: [] })).toBe('complete');
    expect(
      computeBootstrapEndState({
        ...healthy,
        diagnostics: [
          { severity: 'warning', code: 'store_pointer_legacy', message: 'advisory' },
        ],
      })
    ).toBe('complete');
    expect(
      computeBootstrapEndState({
        ...healthy,
        diagnostics: [
          { severity: 'error', code: 'invalid_store_project_record', message: 'unreadable' },
        ],
      })
    ).toBe('degraded');
  });
});

describe('previewed location selection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bootstrap-loc-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lets an explicitly supplied path win over every other candidate', () => {
    const explicit = path.join(tempDir, 'explicit');
    const location = selectBootstrapLocation({
      suppliedPath: explicit,
      parentDirectory: path.join(tempDir, 'parent'),
      nameSource: { remote: 'https://example.test/team/team-store.git', id: 'team-store' },
    });
    expect(location).toEqual({ kind: 'usable', path: explicit, source: 'supplied-path' });
  });

  it('uses a supplied parent plus a safe derived name next', () => {
    const parent = path.join(tempDir, 'parent');
    fs.mkdirSync(parent, { recursive: true });
    const location = selectBootstrapLocation({
      parentDirectory: parent,
      nameSource: { remote: 'https://example.test/team/Team_Store.git' },
    });
    expect(location).toEqual({
      kind: 'usable',
      path: path.join(fs.realpathSync.native(parent), 'team-store'),
      source: 'parent-and-derived-name',
    });
  });

  it('demands a location rather than inventing one, and names no candidate', () => {
    const location = selectBootstrapLocation({
      nameSource: { remote: 'https://example.test/team/team-store.git', id: 'team-store' },
    });
    expect(location).toEqual({ kind: 'required', because: 'no-location-supplied' });
    expect(JSON.stringify(location)).not.toContain('team-store');
  });

  it('reports a location that already has contents as refused', () => {
    const occupied = path.join(tempDir, 'occupied');
    fs.mkdirSync(occupied, { recursive: true });
    fs.writeFileSync(path.join(occupied, 'notes.md'), 'hello');

    expect(selectBootstrapLocation({ suppliedPath: occupied, nameSource: {} })).toEqual({
      kind: 'refused',
      path: fs.realpathSync.native(occupied),
      source: 'supplied-path',
      because: 'not-empty',
    });
  });

  it('reports a location that already holds a checkout as refused', () => {
    const checkout = path.join(tempDir, 'checkout');
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });

    expect(selectBootstrapLocation({ suppliedPath: checkout, nameSource: {} })).toEqual({
      kind: 'refused',
      path: fs.realpathSync.native(checkout),
      source: 'supplied-path',
      because: 'existing-checkout',
    });
  });

  it('treats the same location written two ways as one location', () => {
    const checkout = path.join(tempDir, 'checkout');
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });

    // Separator form, and (on Windows) drive-letter case, differ; the
    // canonical comparison must still hit the refusal.
    const rewritten = checkout.split(path.sep).join('/');
    const swapped = /^[A-Za-z]:/u.test(rewritten)
      ? rewritten[0] === rewritten[0]?.toLowerCase()
        ? rewritten[0]?.toUpperCase() + rewritten.slice(1)
        : rewritten[0]?.toLowerCase() + rewritten.slice(1)
      : rewritten;

    const location = selectBootstrapLocation({
      suppliedPath: swapped as string,
      nameSource: {},
    });
    expect(location.kind).toBe('refused');
    expect(location.kind === 'refused' ? location.because : '').toBe('existing-checkout');
    expect(location.kind === 'refused' ? location.path : '').toBe(
      fs.realpathSync.native(checkout)
    );
  });

  it('derives a name that is safe on every platform, or none at all', () => {
    expect(deriveSafeLocationName({ remote: 'https://example.test/team/team-store.git' })).toBe(
      'team-store'
    );
    expect(deriveSafeLocationName({ remote: 'git@github.com:org/Team_Store.git' })).toBe(
      'team-store'
    );
    expect(deriveSafeLocationName({ id: 'team-store' })).toBe('team-store');

    // No separator, no traversal, no name a filesystem reserves.
    expect(deriveSafeLocationName({ remote: 'https://example.test/a/../b/con.git' })).toBeNull();
    expect(deriveSafeLocationName({ id: 'CON' })).toBeNull();
    expect(deriveSafeLocationName({ id: 'lpt1' })).toBeNull();
    expect(deriveSafeLocationName({ id: '///' })).toBeNull();
    expect(deriveSafeLocationName({})).toBeNull();

    for (const candidate of ['a/b', 'a\\b', '..']) {
      const derived = deriveSafeLocationName({ id: candidate });
      // Either refused outright, or normalized into something that cannot
      // escape the parent directory it would be joined to.
      if (derived !== null) {
        expect(derived, candidate).not.toMatch(/[\\/]|\.\./u);
        expect(path.join('parent', derived), candidate).toBe(path.join('parent', derived));
      }
    }
  });

  it('reports that no safe name can be derived rather than inventing one', () => {
    expect(
      selectBootstrapLocation({
        parentDirectory: tempDir,
        nameSource: { id: 'con' },
      })
    ).toEqual({ kind: 'required', because: 'no-safe-name' });
  });

  it('takes no recorded path at all, so one cannot influence the choice', () => {
    // The inputs are the whole surface: there is nowhere to pass a path
    // another machine wrote. A legacy absolute path is therefore inert by
    // construction, not by a filter that could be forgotten.
    const legacy = path.join(tempDir, 'from-another-machine');
    fs.mkdirSync(legacy, { recursive: true });
    const location = selectBootstrapLocation({
      parentDirectory: tempDir,
      nameSource: { id: 'team-store', remote: 'https://example.test/team/team-store.git' },
    });
    expect(location.kind === 'usable' ? location.path : '').not.toContain(
      'from-another-machine'
    );
  });
});

describe('bootstrap report', () => {
  let tempDir: string;
  let globalDataDir: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bootstrap-'));
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    globalDataDir = getGlobalDataDir({ env: process.env });
  });

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function makeProject(name: string, projectId = PROJECT_ID): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    updateProjectConfigKey(root, 'projectId', projectId);
    return root;
  }

  /** A Store checkout on disk, registered or not, with a permanent identity. */
  async function makeStoreCheckout(
    name: string,
    options: { register?: boolean; id?: string; remote?: string } = {}
  ): Promise<{ root: string; uid: string; id: string }> {
    const id = options.id ?? name;
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);

    // The identity is written first so registration adopts it rather than
    // leaving the checkout on legacy metadata.
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, {
      version: 2,
      uid,
      id,
      ...(options.remote !== undefined ? { remote: options.remote } : {}),
    });

    if (options.register ?? true) {
      await registerStore({
        id,
        localPath: root,
        globalDataDir,
        ...(options.remote !== undefined ? { remote: options.remote } : {}),
      });
    }

    expect(storeMetadataUid(await readOptionalStoreMetadataState(root)), name).toBe(uid);
    return { root, uid, id };
  }

  async function record(storeRoot: string, projectId: string, remote?: string): Promise<void> {
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId,
      roles: { planning: true, knowledge: true },
      ...(remote !== undefined ? { remote } : {}),
    });
  }

  describe('project-first: every declared Store classified in one result', () => {
    it('reports the whole gap at once from a project clone alone', async () => {
      const project = makeProject('project');
      await appendStoreMembershipHint(project, {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });
      await appendStoreMembershipHint(project, {
        uid: '88888888-8888-4888-8888-888888888888',
        id: 'design-store',
      });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      // Both missing Stores in ONE result, not one per invocation.
      expect(report.stores).toHaveLength(2);
      expect(report.state).toBe('degraded');
      expect(entryFor(report, 'team-store').class).toBe('absent-with-remote');
      expect(entryFor(report, 'design-store').class).toBe('absent-without-remote');
      for (const entry of report.stores) {
        expect(entry.repair.length, entry.selector).toBeGreaterThan(0);
      }
    });

    it('reports an available, verified, recorded Store as complete with no repair', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      expect(report.state).toBe('complete');
      const entry = entryFor(report, 'team-store');
      expect(entry.class).toBe('verified');
      expect(entry.repair).toEqual([]);
      expect(entry.membership).toEqual({ state: 'confirmed', repair: [] });
    });

    it('reports a present but unregistered Store with registration as its repair', async () => {
      const store = await makeStoreCheckout('team-store', { register: false });
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
        paths: new Map([['team-store', store.root]]),
      });

      const entry = entryFor(report, 'team-store');
      expect(entry.class).toBe('present-unregistered');
      // ONE repair, naming the path that makes the Store usable — not the
      // resolver's `<path>` placeholder, which bootstrap can now fill in.
      expect(commandsIn(entry)).toEqual([
        `rasen store register ${fs.realpathSync.native(store.root)}`,
      ]);
      expect(entry.root).toBe(fs.realpathSync.native(store.root));
    });

    it('finds a present but unregistered Store under a supplied parent directory too', async () => {
      // The parent plus the derived name is the second priority branch, and
      // it is the branch a user hits when they cloned everything into one
      // folder without naming each Store.
      const clones = path.join(tempDir, 'clones');
      fs.mkdirSync(clones, { recursive: true });
      const store = await makeStoreCheckout(path.join('clones', 'team-store'), {
        register: false,
        id: 'team-store',
      });
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
        into: clones,
      });

      const entry = entryFor(report, 'team-store');
      expect(entry.class).toBe('present-unregistered');
      expect(commandsIn(entry)).toEqual([
        `rasen store register ${fs.realpathSync.native(store.root)}`,
      ]);
    });

    it('does not call a location it cannot read absent, which would print a clone', async () => {
      // The third answer at a supplied location: something is there, and its
      // Store identity will not parse. "Absent" would print `git clone` over a
      // directory that may hold the very Store being looked for.
      const store = await makeStoreCheckout('team-store', { register: false });
      fs.writeFileSync(getStoreMetadataPath(store.root), 'version: [unclosed\n  id: {\n');
      const project = makeProject('project');
      await appendStoreMembershipHint(project, {
        uid: store.uid,
        id: store.id,
        remote: 'https://example.test/team/team-store.git',
      });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
        paths: new Map([['team-store', store.root]]),
      });
      const entry = entryFor(report, 'team-store');

      expect(entry.class).toBe('unresolvable');
      expect(report.state).toBe('blocked');
      expect(entry.diagnostics.some((d) => d.severity === 'error')).toBe(true);
      expect(commandsIn(entry).join(' ')).not.toContain('git clone');
    });

    it('does not mistake a different Store at the supplied location for this one', async () => {
      const other = await makeStoreCheckout('other-store', { register: false });
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: ABSENT_UID, id: 'team-store' });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
        paths: new Map([['team-store', other.root]]),
      });

      // A checkout is at the supplied path, but it is not the declared Store.
      expect(entryFor(report, 'team-store').class).toBe('absent-without-remote');
      expect(entryFor(report, 'team-store').root).toBeUndefined();
    });

    it('reports an unreadable store registry as blocked, writing nothing', async () => {
      // The broken-machine case the command exists to diagnose. It must be
      // REPORTED as `blocked` — not thrown, which would leave the one state a
      // user runs bootstrap to be told about as the one state it cannot report.
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: ABSENT_UID, id: 'team-store' });
      const registryPath = getStoreRegistryPath({ globalDataDir });
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, 'version: 2\nstores: {oops\n  broken: [\n');

      const before = [snapshot(project), snapshot(globalDataDir)];
      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });
      const after = [snapshot(project), snapshot(globalDataDir)];

      expect(report.state).toBe('blocked');
      expect(report.problems.map((problem) => problem.kind)).toEqual(['unreadable-state']);
      expect(report.problems[0]?.path).toBe(registryPath);
      expect(report.problems[0]?.repair).toEqual([
        { kind: 'command', command: 'rasen doctor' },
      ]);
      expect(report.problems[0]?.diagnostics.length).toBeGreaterThan(0);
      // A corrupt registry is NOT an empty machine: no Store is claimed to be
      // absent, because no Store question could be answered at all.
      expect(report.stores).toEqual([]);
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toEqual(before[1]);
    });

    it('reports an unreadable registry as blocked in preview mode too', async () => {
      const project = makeProject('project');
      updateProjectConfigKey(project, 'store', { uid: ABSENT_UID, id: 'team-store' });
      const registryPath = getStoreRegistryPath({ globalDataDir });
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(registryPath, 'stores: {oops\n');

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
        into: path.join(tempDir, 'clones'),
      });

      expect(report.state).toBe('blocked');
      expect(report.problems.map((problem) => problem.kind)).toEqual(['unreadable-state']);
      expect(fs.existsSync(path.join(tempDir, 'clones'))).toBe(false);
    });

    it('collapses a durable hint and an alias-form pointer naming one unavailable Store', async () => {
      // Neither declaration resolves, so neither can key on the Store's root:
      // the hint keys `uid:` and the pointer keys `id:`. Without the identity
      // match they would be reported as two Stores with two repair blocks.
      const project = makeProject('project');
      await appendStoreMembershipHint(project, {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });
      updateProjectConfigKey(project, 'store', 'team-store');

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      expect(report.stores).toHaveLength(1);
      const entry = report.stores[0] as BootstrapStoreEntry;
      expect(entry.sources).toContain('planning');
      expect(entry.sources).toContain('hint');
      // The merged entry keeps both halves of the identity, so its selector is
      // still unambiguous.
      expect(entry.uid).toBe(ABSENT_UID);
      expect(entry.id).toBe('team-store');
    });

    it('collapses an alias-form hint and a durable pointer naming one unavailable Store', async () => {
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { id: 'team-store' });
      updateProjectConfigKey(project, 'store', {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      expect(report.stores).toHaveLength(1);
      expect(report.stores[0]?.sources).toContain('planning');
      expect(report.stores[0]?.sources).toContain('hint');
    });

    it('reports an absent Store with a remote as obtainable, naming the remote', async () => {
      const project = makeProject('project');
      await appendStoreMembershipHint(project, {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      const entry = entryFor(report, 'team-store');
      expect(entry.class).toBe('absent-with-remote');
      expect(entry.remote).toBe('https://example.test/team/team-store.git');
    });

    it('demands a path for an absent Store with no remote, and infers no location', async () => {
      const project = makeProject('project');
      // A sibling directory that a display-name guess would land on, and a
      // path recorded by another machine, both present and both ignored.
      fs.mkdirSync(path.join(tempDir, 'team-store'), { recursive: true });
      await appendStoreMembershipHint(project, { uid: ABSENT_UID, id: 'team-store' });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
      });

      const entry = entryFor(report, 'team-store');
      expect(entry.class).toBe('absent-without-remote');
      expect(entry.repair.some((repair) => repair.kind === 'supply-path')).toBe(true);
      expect(entry.location).toEqual({ kind: 'required', because: 'no-location-supplied' });
      // No candidate location is named anywhere in the entry.
      expect(JSON.stringify(entry)).not.toContain(path.join(tempDir, 'team-store'));
      expect(entry.root).toBeUndefined();
    });

    it('includes the planning declaration when it is not among the membership hints', async () => {
      const planning = await makeStoreCheckout('planning-store');
      const hinted = await makeStoreCheckout('knowledge-store');
      const project = makeProject('project');
      await record(planning.root, PROJECT_ID);
      await record(hinted.root, PROJECT_ID);
      updateProjectConfigKey(project, 'store', { uid: planning.uid, id: planning.id });
      await appendStoreMembershipHint(project, { uid: hinted.uid, id: hinted.id });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      expect(report.stores.map((entry) => entry.id).sort()).toEqual([
        'knowledge-store',
        'planning-store',
      ]);
      expect(entryFor(report, 'planning-store').sources).toContain('planning');
    });

    it('collapses a hint and the planning pointer naming one Store into one entry', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      updateProjectConfigKey(project, 'store', { uid: store.uid, id: store.id });
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      expect(report.stores).toHaveLength(1);
      // One entry carrying every reason it is expected, not one entry per
      // reason: the pointer and the hint collapse on the same identity key.
      expect(report.stores[0]?.sources).toContain('planning');
      expect(report.stores[0]?.sources).toContain('hint');
    });

    it('reads a planning declaration written in the earlier form', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      updateProjectConfigKey(project, 'store', store.id);

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      expect(report.project?.declaresStore).toBe(true);
      expect(entryFor(report, 'team-store').class).toBe('verified');
    });

    it('reports a declaration it cannot understand as blocked, never as absent', async () => {
      const project = makeProject('project');
      fs.appendFileSync(path.join(project, 'rasen', 'config.yaml'), 'store: [not, a, store]\n');

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      expect(report.state).toBe('blocked');
      const problem = report.problems.find((entry) => entry.kind === 'declaration-malformed');
      expect(problem).toBeDefined();
      expect(problem?.path).toBe(path.join(project, 'rasen', 'config.yaml'));
      expect(problem?.reason).toBe('pointer-malformed');
      expect(report.project?.declaresStore).toBe(false);
    });

    it('makes a missing secondary membership hint diagnosable from the report', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      // Recorded by the Store, declared by nothing in the project: it works
      // here and breaks on the next machine.

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
      });

      const entry = entryFor(report, 'team-store');
      expect(entry.sources).toEqual(['record']);
      expect(
        entry.diagnostics.map((diagnostic) => diagnostic.code)
      ).toContain('project_membership_locator_missing');
    });
  });

  describe('membership: confirmed, not recorded, or unverifiable here', () => {
    it('confirms a member the Store itself records', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      expect(entryFor(report, 'team-store').membership.state).toBe('confirmed');
    });

    it('degrades and names the repair when an available Store records nothing', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      const entry = entryFor(report, 'team-store');

      expect(report.state).toBe('degraded');
      expect(entry.membership.state).toBe('not-recorded');
      expect(entry.membership.repair).toEqual([
        { kind: 'command', command: `rasen store add-project ${project} --to team-store` },
      ]);
    });

    it('reports an UNREADABLE record as unverifiable, never as one the Store lacks', async () => {
      // Manifestation A. The Store is here and healthy; the record for this
      // project exists and will not parse. `resolveProjectMembership` returns
      // null for that, exactly as it does for "no record" — and answering
      // "this Store does not record the project" is a claim about the user's
      // data that was never established.
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      fs.writeFileSync(
        getStoreProjectRecordPath(store.root, PROJECT_ID),
        'projectId: [unclosed\n  roles: {\n'
      );
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const before = [snapshot(store.root), snapshot(globalDataDir)];
      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      const entry = entryFor(report, 'team-store');

      expect(entry.membership.state).toBe('unverifiable-here');
      // The evidence that something was unreadable must reach the report.
      expect(entry.diagnostics.length).toBeGreaterThan(0);
      expect(allBootstrapDiagnostics(report).some((d) => d.severity === 'error')).toBe(true);
      // And the result must not claim the project is missing from the Store.
      expect(JSON.stringify(report)).not.toContain('store_project_record_missing');
      expect(report.state).toBe('degraded');
      expect(snapshot(store.root)).toEqual(before[0]);
      expect(snapshot(globalDataDir)).toEqual(before[1]);
    });

    it('offers no state-changing repair on a membership it could not read', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      fs.writeFileSync(
        getStoreProjectRecordPath(store.root, PROJECT_ID),
        'projectId: [unclosed\n'
      );
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      const entry = entryFor(report, 'team-store');

      // The rule, not the instance: nothing that changes state may be printed
      // on an unknown premise.
      for (const repair of [...entry.repair, ...entry.membership.repair]) {
        expect(isMutatingRepair(repair), JSON.stringify(repair)).toBe(false);
      }
      expect(commandsIn(entry).join(' ')).not.toContain('rasen store add-project');
    });

    it('still reports a genuinely missing record as not-recorded, with its repair', async () => {
      // The counterpart: the unknown arm must not swallow the real answer.
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      const entry = entryFor(report, 'team-store');

      expect(entry.membership.state).toBe('not-recorded');
      expect(entry.membership.repair.some(isMutatingRepair)).toBe(true);
    });

    it('reports an unavailable Store as unverifiable, never as one lacking the project', async () => {
      const project = makeProject('project');
      await appendStoreMembershipHint(project, {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      const entry = entryFor(report, 'team-store');

      expect(entry.membership.state).toBe('unverifiable-here');
      // What would make it verifiable travels with the answer.
      expect(entry.membership.repair.length).toBeGreaterThan(0);
      // And nothing anywhere in the report claims the project is absent from it.
      expect(
        report.stores.some((candidate) => candidate.membership.state === 'not-recorded')
      ).toBe(false);
      expect(JSON.stringify(report)).not.toContain('store_project_record_missing');
    });
  });

  describe('Store-first: the projects a Store records', () => {
    it('lists each recorded project as already present or as obtainable', async () => {
      const store = await makeStoreCheckout('team-store');
      const local = makeProject('local-project', PROJECT_ID);
      await registerExistingStore({
        path: local,
        id: 'local-project',
        allowCreateIdentity: true,
        type: 'project',
      });
      await record(store.root, PROJECT_ID);
      await record(store.root, OTHER_PROJECT_ID, 'https://example.test/team/other.git');

      const report = await buildBootstrapReport({
        cwd: store.root,
        mode: 'check',
        globalDataDir,
      });

      expect(report.origin).toBe('store');
      expect(report.store?.id).toBe('team-store');
      expect(
        report.projects.map((entry) => [entry.projectId, entry.presence])
      ).toEqual([
        [PROJECT_ID, 'present'],
        [OTHER_PROJECT_ID, 'obtainable'],
      ]);
      expect(report.state).toBe('degraded');
    });

    it('obtains nothing and writes nothing, however many projects it records', async () => {
      const store = await makeStoreCheckout('team-store');
      for (const id of [
        PROJECT_ID,
        OTHER_PROJECT_ID,
        '11111111-2222-4333-8444-555555555555',
        '66666666-7777-4888-8999-aaaaaaaaaaaa',
      ]) {
        await record(store.root, id, `https://example.test/team/${id}.git`);
      }

      // Both modes, from the Store entry point: the whole tree is compared,
      // not "the writer was not called".
      for (const mode of ['check', 'preview'] as const) {
        const before = [snapshot(store.root), snapshot(globalDataDir), snapshot(tempDir)];
        const report = await buildBootstrapReport({
          cwd: store.root,
          mode,
          globalDataDir,
          into: path.join(tempDir, 'clones'),
        });
        const after = [snapshot(store.root), snapshot(globalDataDir), snapshot(tempDir)];

        expect(report.projects, mode).toHaveLength(4);
        expect(after[0], mode).toEqual(before[0]);
        expect(after[1], mode).toEqual(before[1]);
        expect(after[2], mode).toEqual(before[2]);
        expect(fs.existsSync(path.join(tempDir, 'clones')), mode).toBe(false);
      }
    });

    it('never reports complete over a project record it could not read', async () => {
      // Manifestation B. The diagnostic was already printed here; the headline
      // said `complete` anyway, and `state` is the field the spec makes
      // normative — so a JSON consumer was told nothing was missing.
      const store = await makeStoreCheckout('team-store');
      await record(store.root, PROJECT_ID);
      fs.writeFileSync(
        getStoreProjectRecordPath(store.root, PROJECT_ID),
        'projectId: [unclosed\n  roles: {\n'
      );

      const before = snapshot(store.root);
      const report = await buildBootstrapReport({
        cwd: store.root,
        mode: 'check',
        globalDataDir,
      });

      expect(report.state).not.toBe('complete');
      expect(report.state).toBe('degraded');
      // The record that could not be read is named in the result.
      expect(allBootstrapDiagnostics(report).some((d) => d.severity === 'error')).toBe(true);
      expect(snapshot(store.root)).toEqual(before);
    });

    it('reports a project whose registered identity cannot be read as undetermined', async () => {
      // A registered project with an unreadable config has an UNKNOWN identity,
      // so "not on this machine" is not a conclusion the enumeration may draw —
      // and that conclusion prints an obtain suggestion for something that may
      // already be checked out here.
      const store = await makeStoreCheckout('team-store');
      await record(store.root, PROJECT_ID, 'https://example.test/team/p.git');
      const broken = makeProject('broken-project', OTHER_PROJECT_ID);
      fs.writeFileSync(path.join(broken, 'rasen', 'config.yaml'), 'schema: [unclosed\n');
      await registerExistingStore({
        path: broken,
        id: 'broken-project',
        allowCreateIdentity: true,
        type: 'project',
      });

      const report = await buildBootstrapReport({
        cwd: store.root,
        mode: 'check',
        globalDataDir,
      });

      expect(report.projects).toHaveLength(1);
      expect(report.projects[0]?.presence).toBe('unknown');
      expect(report.state).toBe('degraded');
    });

    it('distinguishes corrupt Store metadata from a directory that is not a Store', async () => {
      const store = await makeStoreCheckout('team-store');
      fs.writeFileSync(getStoreMetadataPath(store.root), 'id: [unclosed\n  version: {\n');

      const before = snapshot(store.root);
      const report = await buildBootstrapReport({
        cwd: store.root,
        mode: 'check',
        globalDataDir,
      });

      expect(report.state).toBe('blocked');
      // "This is not a store checkout" would be a false statement about a
      // Store whose identity file merely needs correcting.
      expect(report.problems.map((problem) => problem.kind)).toEqual(['unreadable-state']);
      expect(report.problems[0]?.path).toBe(getStoreMetadataPath(store.root));
      expect(snapshot(store.root)).toEqual(before);
    });

    it('reports a checkout that does not verify as the Store it claims, writing nothing', async () => {
      const store = await makeStoreCheckout('team-store');
      // The registry says this root is `team-store`; the checkout now says
      // otherwise. Neither is silently preferred.
      await writeStoreMetadataState(store.root, {
        version: 2,
        uid: ABSENT_UID,
        id: 'someone-elses-store',
      });

      const before = [snapshot(store.root), snapshot(globalDataDir)];
      const report = await buildBootstrapReport({
        cwd: store.root,
        mode: 'check',
        globalDataDir,
      });
      const after = [snapshot(store.root), snapshot(globalDataDir)];

      expect(report.state).toBe('blocked');
      expect(report.problems.map((problem) => problem.kind)).toEqual([
        'store-identity-mismatch',
      ]);
      expect(report.projects).toEqual([]);
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toEqual(before[1]);
    });
  });

  describe('check and preview are separate promises', () => {
    async function twoMachineProject(): Promise<string> {
      const project = makeProject('project');
      await appendStoreMembershipHint(project, {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });
      updateProjectConfigKey(project, 'store', { uid: ABSENT_UID, id: 'team-store' });
      return project;
    }

    it('writes nothing in check mode, on a machine missing every Store', async () => {
      const project = await twoMachineProject();
      const before = [snapshot(project), snapshot(globalDataDir), snapshot(tempDir)];

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
        paths: new Map([['team-store', path.join(tempDir, 'would-be-here')]]),
      });

      const after = [snapshot(project), snapshot(globalDataDir), snapshot(tempDir)];
      expect(report.state).toBe('degraded');
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toEqual(before[1]);
      expect(after[2]).toEqual(before[2]);
      expect(fs.existsSync(path.join(tempDir, 'would-be-here'))).toBe(false);
    });

    it('writes nothing in preview mode either, and still names the exact path', async () => {
      const project = await twoMachineProject();
      const target = path.join(tempDir, 'clones');
      fs.mkdirSync(target, { recursive: true });
      const before = [snapshot(project), snapshot(globalDataDir), snapshot(tempDir)];

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
        into: target,
      });

      const after = [snapshot(project), snapshot(globalDataDir), snapshot(tempDir)];
      expect(entryFor(report, 'team-store').location).toEqual({
        kind: 'usable',
        path: path.join(fs.realpathSync.native(target), 'team-store'),
        source: 'parent-and-derived-name',
      });
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toEqual(before[1]);
      expect(after[2]).toEqual(before[2]);
      expect(fs.existsSync(path.join(target, 'team-store'))).toBe(false);
    });

    it('never reaches the remote seam in check mode, and does reach it in preview', async () => {
      const project = await twoMachineProject();
      const calls: string[] = [];
      const spy: BootstrapRemoteResolver = {
        async resolve(request) {
          calls.push(request.remote ?? '');
          return declaredRemoteResolver.resolve(request);
        },
      };

      // Asserted AT THE SEAM: check mode's resolver throws when reached, so a
      // completed run is itself proof, and the spy records nothing.
      const checked = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
        remotes: spy,
      });
      expect(calls).toEqual([]);
      expect(entryFor(checked, 'team-store').class).toBe('absent-with-remote');

      await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
        remotes: spy,
      });
      expect(calls).toContain('https://example.test/team/team-store.git');
    });

    it('fills the exact location into the repair it prints beside it', async () => {
      // Preview has just computed where the Store would go. A repair still
      // carrying `<path>` next to a line naming the exact path is not
      // pasteable, which is what the requirement this change took verbatim
      // forbids.
      const project = await twoMachineProject();
      const target = path.join(tempDir, 'clones');
      fs.mkdirSync(target, { recursive: true });

      const preview = await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
        into: target,
      });
      const entry = entryFor(preview, 'team-store');
      const expected = path.join(fs.realpathSync.native(target), 'team-store');

      expect(entry.location).toEqual({
        kind: 'usable',
        path: expected,
        source: 'parent-and-derived-name',
      });
      for (const command of commandsIn(entry)) {
        expect(command, command).not.toContain('<path>');
      }
      expect(commandsIn(entry).join(' ')).toContain(expected);

      // Check mode names no location, so its repair keeps the placeholder
      // rather than inventing a path the user was never shown.
      const checked = await buildBootstrapReport({
        cwd: project,
        mode: 'check',
        globalDataDir,
        into: target,
      });
      expect(commandsIn(entryFor(checked, 'team-store')).join(' ')).toContain('<path>');
    });

    it('leaves the placeholder alone when the previewed location is refused', async () => {
      const project = await twoMachineProject();
      const occupied = path.join(tempDir, 'occupied');
      fs.mkdirSync(occupied, { recursive: true });
      fs.writeFileSync(path.join(occupied, 'notes.md'), 'x');

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
        paths: new Map([['team-store', occupied]]),
      });
      const entry = entryFor(report, 'team-store');

      expect(entry.location?.kind).toBe('refused');
      // Naming a location bootstrap has just refused would be worse than a
      // placeholder.
      expect(commandsIn(entry).join(' ')).toContain('<path>');
      expect(commandsIn(entry).join(' ')).not.toContain(occupied);
    });

    it('quotes a substituted path that would otherwise split into two arguments', async () => {
      const project = await twoMachineProject();
      const spaced = path.join(tempDir, 'Program Files', 'team-store');

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
        paths: new Map([['team-store', spaced]]),
      });
      const entry = entryFor(report, 'team-store');

      expect(entry.location?.kind).toBe('usable');
      expect(commandsIn(entry).join(' ')).toContain(`"${path.resolve(spaced)}"`);
    });

    it('reports a previewed location it would refuse as refused, not as usable', async () => {
      const project = await twoMachineProject();
      const occupied = path.join(tempDir, 'occupied');
      fs.mkdirSync(path.join(occupied, '.git'), { recursive: true });

      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'preview',
        globalDataDir,
        paths: new Map([['team-store', occupied]]),
      });

      expect(entryFor(report, 'team-store').location).toEqual({
        kind: 'refused',
        path: fs.realpathSync.native(occupied),
        source: 'supplied-path',
        because: 'existing-checkout',
      });
    });
  });

  describe('every hint bootstrap prints can be pasted', () => {
    it('names the display name when it matches only that Store', async () => {
      const store = await makeStoreCheckout('team-store');
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: store.uid, id: store.id });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      expect(entryFor(report, 'team-store').selector).toBe('team-store');
      expect(commandsIn(entryFor(report, 'team-store')).join(' ')).toContain('--to team-store');
    });

    it('names the permanent identity when the display name matches two Stores', async () => {
      const first = await makeStoreCheckout('shared-a', { id: 'shared' });
      await makeStoreCheckout('shared-b', { id: 'shared' });
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: first.uid, id: 'shared' });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      const entry = entryFor(report, first.uid);

      expect(entry.selector).toBe(first.uid);
      const commands = commandsIn(entry);
      expect(commands.join(' ')).toContain(first.uid);
      // Pasting it resolves to exactly that Store: no command names the
      // ambiguous display name as a selector.
      for (const command of commands) {
        expect(command.split(' '), command).not.toContain('shared');
      }
    });

    it('rewrites an ambiguous display name inside a landed repair command', async () => {
      const first = await makeStoreCheckout('shared-a', { id: 'shared' });
      await makeStoreCheckout('shared-b', { id: 'shared' });
      // Break the first Store's root so the landed resolver produces its
      // `rasen store doctor <id>` repair, which names the display alias.
      fs.rmSync(path.join(first.root, 'rasen'), { recursive: true, force: true });

      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: first.uid, id: 'shared' });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      const entry = entryFor(report, first.uid);

      expect(entry.class).toBe('unresolvable');
      expect(commandsIn(entry)).toContain(`rasen store doctor ${first.uid}`);
      expect(commandsIn(entry)).not.toContain('rasen store doctor shared');
    });

    it('never tells the user to run bootstrap to fix anything', async () => {
      const project = makeProject('project');
      await appendStoreMembershipHint(project, { uid: ABSENT_UID, id: 'team-store' });
      updateProjectConfigKey(project, 'store', { uid: ABSENT_UID, id: 'team-store' });

      const report = await buildBootstrapReport({ cwd: project, mode: 'check', globalDataDir });
      for (const entry of report.stores) {
        for (const command of commandsIn(entry)) {
          expect(command, command).not.toMatch(/\brasen bootstrap\b/u);
        }
      }
    });
  });

  describe('a second machine, from a project clone alone', () => {
    it('reports the complete gap with an empty machine data directory', async () => {
      // Machine one: a Store, a project, a recorded membership.
      const store = await makeStoreCheckout('team-store', {
        remote: 'https://example.test/team/team-store.git',
      });
      const project = makeProject('project');
      await record(store.root, PROJECT_ID);
      updateProjectConfigKey(project, 'store', {
        uid: store.uid,
        id: store.id,
        remote: 'https://example.test/team/team-store.git',
      });
      await appendStoreMembershipHint(project, {
        uid: store.uid,
        id: store.id,
        remote: 'https://example.test/team/team-store.git',
      });

      // Machine two: the project clone, and nothing else at all.
      const secondMachine = path.join(tempDir, 'machine-two');
      const clone = path.join(secondMachine, 'project');
      fs.cpSync(project, clone, { recursive: true });
      const emptyDataDir = path.join(secondMachine, 'data');
      fs.mkdirSync(emptyDataDir, { recursive: true });

      const before = [snapshot(clone), snapshot(emptyDataDir)];
      const report = await buildBootstrapReport({
        cwd: clone,
        mode: 'check',
        globalDataDir: emptyDataDir,
      });
      const after = [snapshot(clone), snapshot(emptyDataDir)];

      // Every declared Store is classified, and nothing is missing from the
      // report itself: the plan is complete even though the machine is not.
      expect(report.stores).toHaveLength(1);
      const entry = entryFor(report, 'team-store');
      expect(entry.class).toBe('absent-with-remote');
      expect(entry.remote).toBe('https://example.test/team/team-store.git');
      expect(entry.membership.state).toBe('unverifiable-here');
      expect(entry.sources).toContain('planning');
      expect(entry.sources).toContain('hint');
      expect(report.state).toBe('degraded');
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toEqual(before[1]);
    });
  });
});

describe('bootstrap runs no version-control operation', () => {
  it('spawns no child process while producing a report, in either mode', async () => {
    // The strong form of the promise: the process-launching surface itself is
    // instrumented, so a version-control call reached through ANY transitive
    // dependency would be recorded — not just one written in these two files.
    childProcessCalls.length = 0;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bootstrap-spawn-'));
    const savedXdg = process.env.XDG_DATA_HOME;
    const savedHome = process.env.RASEN_HOME;
    try {
      delete process.env.RASEN_HOME;
      process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
      const project = path.join(tempDir, 'project');
      createOpenSpecRoot(project);
      updateProjectConfigKey(project, 'projectId', PROJECT_ID);
      updateProjectConfigKey(project, 'store', {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });
      await appendStoreMembershipHint(project, {
        uid: ABSENT_UID,
        id: 'team-store',
        remote: 'https://example.test/team/team-store.git',
      });

      for (const mode of ['check', 'preview'] as const) {
        await buildBootstrapReport({
          cwd: project,
          mode,
          globalDataDir: path.join(tempDir, 'data', 'rasen'),
          into: path.join(tempDir, 'clones'),
        });
      }
      expect(childProcessCalls).toEqual([]);
    } finally {
      if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = savedXdg;
      if (savedHome === undefined) delete process.env.RASEN_HOME;
      else process.env.RASEN_HOME = savedHome;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('names no process-launching API in either new file', () => {
    const files = ['src/core/store/bootstrap.ts', 'src/commands/bootstrap.ts'];
    for (const file of files) {
      const source = withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf-8'));
      for (const banned of [
        'child_process',
        'spawn',
        'exec',
        'execFile',
        'simple-git',
      ]) {
        expect(source, `${file} must not reach for ${banned}`).not.toContain(banned);
      }
    }
    // And the guard itself is live: the files exist and are in the source set.
    const known = new Set(sourceFiles(repoRoot));
    for (const file of files) expect(known.has(file), file).toBe(true);
  });
});
