import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getGlobalDataDir, registerStore } from '../../../src/core/index.js';
import {
  appendStoreMembershipHint,
  updateProjectConfigKey,
} from '../../../src/core/project-config.js';
import {
  buildBootstrapReport,
  selectBootstrapLocation,
  type BootstrapConsent,
  type BootstrapReport,
  type BootstrapStoreEntry,
} from '../../../src/core/store/bootstrap.js';
import { cloneRepository } from '../../../src/core/store/git.js';
import {
  getStoreRegistryPath,
  readOptionalStoreMetadataState,
  storeMetadataUid,
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import {
  writeStoreProjectRecord,
} from '../../../src/core/store/project-records.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { withoutComments } from '../../helpers/source-guards.js';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const execFileAsync = promisify(execFile);

const PROJECT_ID = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';

/** Every file under `dir` with its bytes, for a byte-identical assertion. */
function snapshotTree(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string, base: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, base);
      else found.set(path.relative(base, full), fs.readFileSync(full, 'utf-8'));
    }
  };
  if (fs.existsSync(dir)) walk(dir, dir);
  return found;
}

function entryFor(report: BootstrapReport, selector: string): BootstrapStoreEntry {
  const entry = report.stores.find(
    (candidate) => candidate.selector === selector || candidate.id === selector
  );
  expect(entry, `no entry for ${selector}`).toBeDefined();
  return entry as BootstrapStoreEntry;
}

// -----------------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------------

let tempDir: string;
let globalDataDir: string;
let savedXdg: string | undefined;
let savedRasenHome: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bootstrap-obtain-'));
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

/**
 * A Store checkout that is ALSO a real git repository — the "remote" another
 * machine would clone from. The returned `remote` is the local file path,
 * which `git clone` accepts directly (a local file:// remote, never real
 * network).
 */
async function makeRemoteStore(
  name: string,
  options: { id?: string; recordProject?: boolean } = {}
): Promise<{ root: string; remote: string; uid: string; id: string }> {
  const id = options.id ?? name;
  const root = path.join(tempDir, name);
  createOpenSpecRoot(root);
  const uid = mintStoreUid();
  await writeStoreMetadataState(root, { version: 2, uid, id });
  if (options.recordProject) {
    await writeStoreProjectRecord(root, {
      version: 1,
      projectId: PROJECT_ID,
      roles: { planning: true, knowledge: true },
    });
  }
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
  await execFileAsync('git', ['add', '-A'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root });
  return { root, remote: root, uid, id };
}

const blanketConsent: BootstrapConsent = { blanket: true };

// -----------------------------------------------------------------------------
// Group 2: Clone capability
// -----------------------------------------------------------------------------

describe('clone capability (git.ts)', () => {
  it('clones successfully into a non-existent target from a local remote', async () => {
    const source = await makeRemoteStore('source');
    const target = path.join(tempDir, 'clone-target');

    await cloneRepository(source.remote, target);

    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
    // The Store metadata survived the clone.
    const metadata = await readOptionalStoreMetadataState(target);
    expect(metadata).toBeTruthy();
    expect(storeMetadataUid(metadata!)).toBe(source.uid);
  });

  it('fails with a clear error when the remote does not exist', async () => {
    const target = path.join(tempDir, 'bad-clone');
    await expect(cloneRepository(path.join(tempDir, 'nonexistent'), target)).rejects.toThrow(
      /Failed to clone/
    );
    // The target directory may or may not have been created by git — the
    // cleanup guard handles that. Here we just verify the error is clear.
  });

  it('uses execFile (argument vector), never a shell string', () => {
    // Source-level proof: git.ts routes through execFileAsync which calls
    // execFile, never exec. The module never imports exec.
    const source = withoutComments(
      fs.readFileSync(path.join(repoRoot, 'src', 'core', 'store', 'git.ts'), 'utf-8')
    );
    expect(source).toContain('execFile');
    expect(source).not.toMatch(/\bexec\b(?!File)/);
  });
});

// -----------------------------------------------------------------------------
// Group 3 + 4: Clone target enforcement and failed-retrieval cleanup
// -----------------------------------------------------------------------------

describe('clone target enforcement (design D5)', () => {
  it('refuses a non-empty directory and never clones into it', () => {
    const occupied = path.join(tempDir, 'occupied');
    fs.mkdirSync(occupied, { recursive: true });
    fs.writeFileSync(path.join(occupied, 'important.txt'), 'user data');

    const location = selectBootstrapLocation({ suppliedPath: occupied, nameSource: {} });
    expect(location.kind).toBe('refused');
    if (location.kind === 'refused') {
      expect(location.because).toBe('not-empty');
    }
    // The content is untouched.
    expect(fs.readFileSync(path.join(occupied, 'important.txt'), 'utf-8')).toBe('user data');
  });

  it('refuses an existing checkout', () => {
    const checkout = path.join(tempDir, 'checkout');
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });

    const location = selectBootstrapLocation({ suppliedPath: checkout, nameSource: {} });
    expect(location.kind).toBe('refused');
    if (location.kind === 'refused') {
      expect(location.because).toBe('existing-checkout');
    }
  });

  it('demands a location when none is supplied', () => {
    const location = selectBootstrapLocation({ nameSource: {} });
    expect(location.kind).toBe('required');
  });

  it('accepts a usable (non-existent) location', () => {
    const target = path.join(tempDir, 'fresh-target');
    const location = selectBootstrapLocation({ suppliedPath: target, nameSource: {} });
    expect(location.kind).toBe('usable');
  });
});

describe('failed-retrieval cleanup — THE data-destruction guard (design D2, D5)', () => {
  // These tests route through `buildBootstrapReport` (the full apply path),
  // which exercises `cloneWithCleanupGuard` via `obtainAbsentStore`. They do
  // NOT call `cloneRepository` directly — the guard's cleanup logic is the
  // code under test, and calling the raw primitive would bypass it entirely.

  it('THE CRITICAL TEST: pre-existing target WITH content survives through the full apply path', async () => {
    // Construct the exact scenario E's D5 fears: a target directory pre-exists
    // with known content → apply runs → content is byte-identical afterward.
    // The content survives because `selectBootstrapLocation` refuses a
    // non-empty directory — the clone never runs, and the user's data is safe.
    const source = await makeRemoteStore('origin-store');
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    // Pre-existing target with known content.
    const target = path.join(tempDir, 'precious');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'precious.txt'), 'do not delete this');
    fs.mkdirSync(path.join(target, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(target, 'subdir', 'nested.txt'), 'nested content');
    const before = snapshotTree(target);

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('not-acted'); // refused, not failed

    // THE assertion: byte-identical before and after.
    const after = snapshotTree(target);
    expect(after).toEqual(before);
    expect(fs.readFileSync(path.join(target, 'precious.txt'), 'utf-8')).toBe(
      'do not delete this'
    );
  });

  it('guard preserves a pre-existing EMPTY directory when the clone fails through the apply path', async () => {
    // An empty pre-existing directory passes `selectBootstrapLocation` (returns
    // `usable`), so the clone ACTUALLY RUNS through `cloneWithCleanupGuard`.
    // The guard records `targetExistedBefore = true`, the clone fails, and the
    // guard leaves the directory untouched. This is the guard's preservation
    // path — the test that proves it works end-to-end.
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'fail-store',
      remote: path.join(tempDir, 'nonexistent-remote'),
    });

    // Pre-existing EMPTY target — selectBootstrapLocation returns 'usable'.
    const target = path.join(tempDir, 'pre-existing-empty');
    fs.mkdirSync(target, { recursive: true });
    expect(fs.existsSync(target)).toBe(true);

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['fail-store', target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, 'fail-store');
    expect(entry.action).toBe('obtain-failed');
    // The guard pushed the "target pre-existed" warning — proof it ran.
    expect(
      entry.diagnostics.some((d) => d.code === 'bootstrap_obtain_target_preserved')
    ).toBe(true);
    // THE guard assertion: the pre-existing directory survives.
    expect(fs.existsSync(target)).toBe(true);
  });

  it('guard cleans up a self-created directory when the clone fails through the apply path', async () => {
    // Converse of the preservation test: when the target did NOT exist before
    // this run, the clone creates (or attempts to create) the directory, and
    // the guard removes it on failure — restoring the pre-run state.
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'fail-store',
      remote: path.join(tempDir, 'nonexistent-remote'),
    });

    // Target does NOT exist — guard records targetExistedBefore = false.
    const target = path.join(tempDir, 'self-created');
    expect(fs.existsSync(target)).toBe(false);

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['fail-store', target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, 'fail-store');
    expect(entry.action).toBe('obtain-failed');
    // THE guard assertion: no directory is left behind from the failed clone.
    // (If git created the directory before failing, the guard removed it.
    // If git didn't create it, it was never there. Either way: clean.)
    expect(fs.existsSync(target)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Group 5: Project-first obtain step
// -----------------------------------------------------------------------------

describe('project-first obtain step (design D3)', () => {
  it('obtains a declared Store from its remote during apply', async () => {
    const source = await makeRemoteStore('remote-store', { recordProject: true });
    const project = makeProject('project');
    // Declare the Store with a remote pointing to the source.
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });
    await appendStoreMembershipHint(project, { uid: source.uid, id: source.id });

    const target = path.join(tempDir, 'obtained-store');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('obtained');
    expect(entry.class).toBe('verified');
    // The checkout was created at the target.
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
  });

  it('requires consent before obtaining (interactive mode)', async () => {
    const source = await makeRemoteStore('remote-store', { recordProject: true });
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'obtained-store');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: { blanket: false, confirm: async () => false },
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('declined');
    // Nothing was cloned.
    expect(fs.existsSync(target)).toBe(false);
  });

  it('obtains declared Stores under --yes (blanket consent)', async () => {
    const source = await makeRemoteStore('remote-store', { recordProject: true });
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'obtained-store');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('obtained');
  });

  it('does not obtain a non-declared Store under --yes', async () => {
    const project = makeProject('project');
    // The Store is a hint (not declared by the project), so blanket consent
    // does NOT cover obtaining it. Use an HTTPS remote so the hint's
    // portability guard passes; the clone is never attempted because consent
    // is denied.
    await appendStoreMembershipHint(project, {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'hint-store',
      remote: 'https://example.test/hint-store.git',
    });

    let asked = false;
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      into: path.join(tempDir, 'clones'),
      consent: {
        blanket: true,
        confirm: async () => {
          asked = true;
          return false;
        },
      },
    });

    const entry = entryFor(report, 'hint-store');
    // The non-declared Store was asked about (blanket didn't cover it).
    expect(asked).toBe(true);
    expect(entry.action).toBe('declined');
  });

  it('reports a failed obtain without aborting the whole run', async () => {
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'bad-store',
      remote: path.join(tempDir, 'nonexistent-remote'),
    });

    const target = path.join(tempDir, 'failed-clone');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['bad-store', target]]),
      consent: blanketConsent,
    });

    expect(report.state).not.toBe('blocked');
    const entry = entryFor(report, 'bad-store');
    expect(entry.action).toBe('obtain-failed');
  });

  it('does not re-clone on rerun (idempotent)', async () => {
    const source = await makeRemoteStore('remote-store', { recordProject: true });
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'obtained-store');
    const input = {
      cwd: project,
      mode: 'apply' as const,
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    };

    // First run: obtains the Store.
    const report1 = await buildBootstrapReport(input);
    expect(entryFor(report1, source.id).action).toBe('obtained');

    // Second run: the Store is now registered → already-registered.
    const report2 = await buildBootstrapReport(input);
    const entry2 = entryFor(report2, source.id);
    expect(entry2.action === 'already-registered' || entry2.action === 'not-acted').toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Group 6: Store-first apply flow
// -----------------------------------------------------------------------------

describe('Store-first apply flow (design D4)', () => {
  async function makeRegisteredStore(
    name: string,
    options: { id?: string } = {}
  ): Promise<{ root: string; uid: string; id: string }> {
    const id = options.id ?? name;
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, { version: 2, uid, id });
    await registerStore({ id, localPath: root, globalDataDir });
    return { root, uid, id };
  }

  async function makeRemoteProject(
    storeRoot: string,
    projectId: string,
    options: { id?: string; remote?: string } = {}
  ): Promise<void> {
    // Record the project in the Store, with a remote pointing to a cloneable
    // git repo.
    const projectDirName = options.id ?? projectId;
    const remoteRoot = path.join(tempDir, 'remotes', projectDirName);
    createOpenSpecRoot(remoteRoot);
    updateProjectConfigKey(remoteRoot, 'projectId', projectId);
    await execFileAsync('git', ['init'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: remoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: remoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: remoteRoot });

    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId,
      roles: { planning: true, knowledge: true },
      ...(options.id !== undefined ? { id: options.id } : {}),
      ...(remoteRoot !== undefined ? { remote: remoteRoot } : {}),
    });
  }

  it('registers the Store checkout during apply', async () => {
    const store = await makeRegisteredStore('my-store');
    // Unregister it first so apply has something to do.
    const reg = fs.readFileSync(getStoreRegistryPath({ globalDataDir }), 'utf-8');
    const updated = reg.replace(
      new RegExp(`.*${store.root}.*\\n?`, 'g'),
      ''
    );
    fs.writeFileSync(getStoreRegistryPath({ globalDataDir }), updated, 'utf-8');

    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      consent: blanketConsent,
    });

    expect(report.store?.registered).toBe(true);
  });

  it('obtains a project selected via --path', async () => {
    const store = await makeRegisteredStore('my-store');
    await makeRemoteProject(store.root, 'proj-1', { id: 'proj-1' });

    const target = path.join(tempDir, 'obtained-proj');
    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['proj-1', target]]),
      consent: blanketConsent,
    });

    const project = report.projects.find((p) => p.projectId === 'proj-1');
    expect(project).toBeDefined();
    expect(project!.action).toBe('obtained');
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
  });

  it('obtains a project selected interactively', async () => {
    const store = await makeRegisteredStore('my-store');
    await makeRemoteProject(store.root, 'proj-1', { id: 'proj-1' });

    const target = path.join(tempDir, 'obtained-proj');
    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      into: path.dirname(target),
      consent: {
        blanket: false,
        confirm: async () => true,
        selectProjects: async (projects) =>
          projects.filter((p) => p.projectId === 'proj-1').map((p) => p.projectId),
      },
    });

    const project = report.projects.find((p) => p.projectId === 'proj-1');
    expect(project).toBeDefined();
    expect(project!.action).toBe('obtained');
  });

  it('leaves unselected projects unobtained', async () => {
    const store = await makeRegisteredStore('my-store');
    await makeRemoteProject(store.root, 'proj-1', { id: 'proj-1' });
    await makeRemoteProject(store.root, 'proj-2', { id: 'proj-2' });

    const target = path.join(tempDir, 'obtained-proj');
    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['proj-1', target]]),
      consent: {
        blanket: false,
        confirm: async () => true,
        selectProjects: async () => [], // select nothing
      },
    });

    const proj1 = report.projects.find((p) => p.projectId === 'proj-1');
    const proj2 = report.projects.find((p) => p.projectId === 'proj-2');
    expect(proj1!.action).toBe('obtained');
    expect(proj2!.action).toBe('not-selected');
  });
});

// -----------------------------------------------------------------------------
// Group 7: Never-harvest enforcement
// -----------------------------------------------------------------------------

describe('never-harvest enforcement (design D6)', () => {
  async function makeRegisteredStore(
    name: string
  ): Promise<{ root: string; uid: string; id: string }> {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, { version: 2, uid, id: name });
    await registerStore({ id: name, localPath: root, globalDataDir });
    return { root, uid, id: name };
  }

  async function addRemoteProject(
    storeRoot: string,
    projectId: string
  ): Promise<void> {
    const remoteRoot = path.join(tempDir, 'remotes', projectId);
    createOpenSpecRoot(remoteRoot);
    updateProjectConfigKey(remoteRoot, 'projectId', projectId);
    await execFileAsync('git', ['init'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: remoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: remoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: remoteRoot });
    await writeStoreProjectRecord(storeRoot, {
      version: 1,
      projectId,
      roles: { planning: true, knowledge: true },
      remote: remoteRoot,
    });
  }

  it('obtains ZERO projects under --yes (Store-first never-harvest)', async () => {
    const store = await makeRegisteredStore('harvest-store');
    // Add 5 obtainable projects.
    for (let i = 1; i <= 5; i++) {
      await addRemoteProject(store.root, `proj-${i}`);
    }

    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      into: path.join(tempDir, 'clones'),
      consent: blanketConsent, // --yes
    });

    // Every project is not-selected, none obtained.
    expect(report.projects.length).toBeGreaterThanOrEqual(5);
    for (const project of report.projects) {
      expect(project.action).toBe('not-selected');
    }
    // No clone directory was created.
    expect(fs.existsSync(path.join(tempDir, 'clones'))).toBe(false);
  }, 30000); // 5 git repos take time on Windows

  it('does not prompt for projects under --yes', async () => {
    const store = await makeRegisteredStore('harvest-store');
    await addRemoteProject(store.root, 'proj-1');

    let selectCalled = false;
    await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      consent: {
        blanket: true,
        selectProjects: async () => {
          selectCalled = true;
          return [];
        },
      },
    });

    expect(selectCalled).toBe(false);
  });

  it('obtains declared Stores under --yes (project-first asymmetry)', async () => {
    const source = await makeRemoteStore('remote-store', { recordProject: true });
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'obtained');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    // Project-first --yes DOES obtain declared Stores (the asymmetry).
    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('obtained');
  });
});

// -----------------------------------------------------------------------------
// Group 9: Acceptance tests (E3 slice)
// -----------------------------------------------------------------------------

describe('acceptance: two-machine fixture with clone remotes', () => {
  it('a second machine bootstraps from a project clone and obtains declared Stores', async () => {
    // Machine 1: has the source Store repo (the "remote").
    const source = await makeRemoteStore('origin-store', { recordProject: true });

    // Machine 2: has only a project clone (no Store registered).
    const project = makeProject('fresh-project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'obtained-store');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('obtained');
    expect(entry.class).toBe('verified');
    expect(entry.membership.state).toBe('confirmed');
  });

  it('an occupied target is refused and the content is preserved', async () => {
    const source = await makeRemoteStore('origin-store');
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    // Pre-existing target with content.
    const target = path.join(tempDir, 'occupied');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'user-data.txt'), 'important');
    const before = snapshotTree(target);

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('not-acted');
    // Content is byte-identical.
    const after = snapshotTree(target);
    expect(after).toEqual(before);
  });

  it('the remote is passed as an argument vector (source-level)', () => {
    const source = withoutComments(
      fs.readFileSync(path.join(repoRoot, 'src', 'core', 'store', 'git.ts'), 'utf-8')
    );
    // cloneRepository uses execFileAsync with ['clone', '--', remote, target]
    expect(source).toContain("['clone', '--', remote, target]");
    // Never uses exec (shell).
    expect(source).not.toMatch(/\bexec\b(?!File)/);
  });
});
