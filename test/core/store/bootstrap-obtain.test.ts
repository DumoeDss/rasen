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
  allBootstrapDiagnostics,
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
    // In the staging-dir design (B3), the clone goes into a staging sibling,
    // the clone fails, the staging is cleaned up, and the target (empty
    // pre-existing dir) is NEVER touched at any step.
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
    // THE guard assertion: the pre-existing directory survives untouched.
    expect(fs.existsSync(target)).toBe(true);
    // No staging dir is left behind.
    const siblings = fs.readdirSync(path.dirname(target));
    expect(siblings.some((s) => s.includes('.rasen-stage.'))).toBe(false);
  });

  it('guard cleans up the staging dir when the clone fails, target is never created', async () => {
    // Converse of the preservation test: when the target did NOT exist before
    // this run, the clone goes into a staging sibling, the clone fails, and
    // the staging dir is removed. The target is NEVER created — only the
    // staging existed, and it is cleaned up.
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'fail-store',
      remote: path.join(tempDir, 'nonexistent-remote'),
    });

    // Target does NOT exist.
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
    // THE guard assertion: the target was never created.
    expect(fs.existsSync(target)).toBe(false);
    // No staging dir is left behind.
    const parent = path.dirname(target);
    if (fs.existsSync(parent)) {
      const siblings = fs.readdirSync(parent);
      expect(siblings.some((s) => s.includes('.rasen-stage.'))).toBe(false);
    }
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

// -----------------------------------------------------------------------------
// Group 10: B4 — Store clone identity verification (fail-closed, zero-write)
// -----------------------------------------------------------------------------

describe('B4 — Store obtain identity verification', () => {
  it('fails closed when the cloned Store UID does not match the declared UID', async () => {
    // The project declares Store A (by UID), but the remote holds Store B.
    const wrongStore = await makeRemoteStore('wrong-identity-store');
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: '00000000-0000-4000-8000-000000000000',
      id: 'expected-store',
      remote: wrongStore.remote,
    });

    const target = path.join(tempDir, 'obtained');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['expected-store', target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, 'expected-store');
    expect(entry.action).toBe('obtain-failed');
    // Registry zero-write: no entry was committed.
    const registryPath = getStoreRegistryPath({ globalDataDir });
    const registryContent = fs.existsSync(registryPath)
      ? fs.readFileSync(registryPath, 'utf-8')
      : '';
    expect(registryContent).not.toContain(wrongStore.uid);
    expect(registryContent).not.toContain('expected-store');
    // Target was never created (no publish).
    expect(fs.existsSync(target)).toBe(false);
    // Diagnostic names the identity mismatch.
    expect(
      entry.diagnostics.some((d) => d.code === 'bootstrap_obtain_identity_mismatch')
    ).toBe(true);
    expect(
      entry.diagnostics.some((d) => d.code === 'bootstrap_obtain_clone_identity_unverified')
    ).toBe(true);
  });

  it('fails closed when the cloned Store has no metadata file at all (missing UID)', async () => {
    // Clone a repo that has no Store metadata.
    const bareRemoteRoot = path.join(tempDir, 'bare-remote');
    createOpenSpecRoot(bareRemoteRoot);
    await execFileAsync('git', ['init'], { cwd: bareRemoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: bareRemoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: bareRemoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: bareRemoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: bareRemoteRoot });

    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'expected-store',
      remote: bareRemoteRoot,
    });

    const target = path.join(tempDir, 'obtained');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['expected-store', target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, 'expected-store');
    expect(entry.action).toBe('obtain-failed');
    expect(fs.existsSync(target)).toBe(false);
    expect(
      entry.diagnostics.some((d) => d.code === 'bootstrap_obtain_identity_mismatch')
    ).toBe(true);
  });

  it('fails closed when the cloned Store metadata is unreadable (corrupt YAML)', async () => {
    // Create a remote with corrupt Store metadata.
    const corruptRemoteRoot = path.join(tempDir, 'corrupt-remote');
    createOpenSpecRoot(corruptRemoteRoot);
    // Write garbage at the modern metadata path.
    fs.mkdirSync(path.join(corruptRemoteRoot, '.rasen-store'), { recursive: true });
    fs.writeFileSync(
      path.join(corruptRemoteRoot, '.rasen-store', 'store.yaml'),
      'this: is: not: valid: yaml: ['
    );
    await execFileAsync('git', ['init'], { cwd: corruptRemoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: corruptRemoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: corruptRemoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: corruptRemoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: corruptRemoteRoot });

    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'expected-store',
      remote: corruptRemoteRoot,
    });

    const target = path.join(tempDir, 'obtained');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['expected-store', target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, 'expected-store');
    expect(entry.action).toBe('obtain-failed');
    expect(fs.existsSync(target)).toBe(false);
    expect(
      entry.diagnostics.some((d) => d.code === 'bootstrap_obtain_identity_mismatch')
    ).toBe(true);
  });

  it('succeeds when no expected UID is declared (alias-only bootstrap path)', async () => {
    // The alias-only path: a store hint provides a remote but no UID. The
    // identity check is skipped (entry.uid === undefined) and the clone
    // proceeds through register's own allowCreateIdentity gate.
    const remoteRoot = path.join(tempDir, 'alias-remote');
    createOpenSpecRoot(remoteRoot);
    await writeStoreMetadataState(remoteRoot, { version: 1, id: 'alias-store' });
    await execFileAsync('git', ['init'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: remoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: remoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: remoteRoot });

    // Declare by hint only (no UID) — use a file:// URL so the portability
    // guard accepts it.
    const project = makeProject('project');
    await appendStoreMembershipHint(project, {
      id: 'alias-store',
      remote: `file:///${remoteRoot.replace(/\\/g, '/')}`,
    });

    const target = path.join(tempDir, 'obtained');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['alias-store', target]]),
      consent: { blanket: false, confirm: async () => true },
    });

    const entry = entryFor(report, 'alias-store');
    expect(entry.action).toBe('obtained');
    expect(fs.existsSync(target)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Group 11: M1 — Project obtain identity verification (fail-closed)
// -----------------------------------------------------------------------------

describe('M1 — Project obtain identity verification', () => {
  async function makeRegisteredStoreForProj(
    name: string
  ): Promise<{ root: string; uid: string; id: string }> {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    const uid = mintStoreUid();
    await writeStoreMetadataState(root, { version: 2, uid, id: name });
    await registerStore({ id: name, localPath: root, globalDataDir });
    return { root, uid, id: name };
  }

  async function makeRemoteProjectWithId(
    storeRoot: string,
    projectId: string,
    options: { id?: string } = {}
  ): Promise<void> {
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
      remote: remoteRoot,
    });
  }

  it('fails closed when the cloned project ID does not match', async () => {
    const store = await makeRegisteredStoreForProj('m1-store');
    // The Store records project 'expected-proj-id', but the remote's project
    // declares itself as 'different-project-id'.
    const remoteRoot = path.join(tempDir, 'remotes', 'mismatched-project');
    createOpenSpecRoot(remoteRoot);
    updateProjectConfigKey(remoteRoot, 'projectId', 'different-project-id');
    await execFileAsync('git', ['init'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: remoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: remoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: remoteRoot });

    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: 'expected-proj-id',
      roles: { planning: true, knowledge: true },
      remote: remoteRoot,
    });

    const target = path.join(tempDir, 'obtained-proj');
    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['expected-proj-id', target]]),
      consent: blanketConsent,
    });

    const proj = report.projects.find((p) => p.projectId === 'expected-proj-id');
    expect(proj).toBeDefined();
    expect(proj!.action).toBe('obtain-failed');
    expect(fs.existsSync(target)).toBe(false);
    expect(
      proj!.diagnostics.some((d) => d.code === 'bootstrap_obtain_identity_mismatch')
    ).toBe(true);
  });

  it('fails closed when the cloned project has no projectId', async () => {
    const store = await makeRegisteredStoreForProj('m1-missing-store');
    // Create a remote with no projectId declared.
    const remoteRoot = path.join(tempDir, 'remotes', 'no-id-project');
    createOpenSpecRoot(remoteRoot);
    // No updateProjectConfigKey for projectId.
    await execFileAsync('git', ['init'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: remoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: remoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: remoteRoot });

    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: 'expected-proj-id',
      roles: { planning: true, knowledge: true },
      remote: remoteRoot,
    });

    const target = path.join(tempDir, 'obtained-proj');
    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['expected-proj-id', target]]),
      consent: blanketConsent,
    });

    const proj = report.projects.find((p) => p.projectId === 'expected-proj-id');
    expect(proj).toBeDefined();
    expect(proj!.action).toBe('obtain-failed');
    expect(fs.existsSync(target)).toBe(false);
    expect(
      proj!.diagnostics.some((d) => d.code === 'bootstrap_obtain_identity_mismatch')
    ).toBe(true);
  });

  it('fails closed when the cloned project config is unreadable', async () => {
    const store = await makeRegisteredStoreForProj('m1-unreadable-store');
    // Create a remote with corrupt config.
    const remoteRoot = path.join(tempDir, 'remotes', 'corrupt-config-project');
    createOpenSpecRoot(remoteRoot);
    // Write garbage to the config file.
    const configPath = path.join(remoteRoot, 'openspec', 'config.yaml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'this: is: not: valid: yaml: [');
    await execFileAsync('git', ['init'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: remoteRoot });
    await execFileAsync('git', ['config', 'user.email', 'test@test.test'], { cwd: remoteRoot });
    await execFileAsync('git', ['add', '-A'], { cwd: remoteRoot });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: remoteRoot });

    await writeStoreProjectRecord(store.root, {
      version: 1,
      projectId: 'corrupt-proj-id',
      roles: { planning: true, knowledge: true },
      remote: remoteRoot,
    });

    const target = path.join(tempDir, 'obtained-proj');
    const report = await buildBootstrapReport({
      cwd: store.root,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['corrupt-proj-id', target]]),
      consent: blanketConsent,
    });

    const proj = report.projects.find((p) => p.projectId === 'corrupt-proj-id');
    expect(proj).toBeDefined();
    expect(proj!.action).toBe('obtain-failed');
    expect(fs.existsSync(target)).toBe(false);
    expect(
      proj!.diagnostics.some((d) => d.code === 'bootstrap_obtain_identity_mismatch')
    ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Group 12: B3 — Cross-process same-target concurrent clone race
// -----------------------------------------------------------------------------

describe('B3 — concurrent clone race on the same absent target', () => {
  it('exactly one publish succeeds when two obtains race on the same target', async () => {
    // Two separate remotes, each with a distinct Store identity, but both
    // declared with the SAME target path. The staging-dir design ensures
    // exactly one fs.rename succeeds; the loser keeps its staging dir and
    // does NOT delete the winner's checkout.
    const sourceA = await makeRemoteStore('race-source-a');
    const sourceB = await makeRemoteStore('race-source-b');

    // Two separate projects, each declaring a different store but pointing at
    // the same target path.
    const projectA = makeProject('project-a');
    updateProjectConfigKey(projectA, 'store', {
      uid: sourceA.uid,
      id: sourceA.id,
      remote: sourceA.remote,
    });
    const projectB = makeProject('project-b');
    updateProjectConfigKey(projectB, 'store', {
      uid: sourceB.uid,
      id: sourceB.id,
      remote: sourceB.remote,
    });

    const target = path.join(tempDir, 'race-target');

    const inputA = {
      cwd: projectA,
      mode: 'apply' as const,
      globalDataDir,
      paths: new Map([[sourceA.id, target]]),
      consent: blanketConsent,
    };
    const inputB = {
      cwd: projectB,
      mode: 'apply' as const,
      globalDataDir,
      paths: new Map([[sourceB.id, target]]),
      consent: blanketConsent,
    };

    // Race two concurrent obtains on the same target.
    const [reportA, reportB] = await Promise.all([
      buildBootstrapReport(inputA),
      buildBootstrapReport(inputB),
    ]);

    const entryA = entryFor(reportA, sourceA.id);
    const entryB = entryFor(reportB, sourceB.id);

    // Exactly one must have succeeded.
    const aObtained = entryA.action === 'obtained';
    const bObtained = entryB.action === 'obtained';
    expect(aObtained || bObtained).toBe(true);
    expect(aObtained && bObtained).toBe(false);

    // The target exists (the winner published it).
    expect(fs.existsSync(target)).toBe(true);

    // The winner's target contains a valid git checkout.
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);

    // The loser did NOT delete the winner's checkout — target still exists
    // and is a valid checkout.
    const loserEntry = aObtained ? entryB : entryA;
    expect(loserEntry.action).toBe('obtain-failed');
  }, 30000);
});

// -----------------------------------------------------------------------------
// Group 13: B3 — Publish over a pre-existing EMPTY target directory
// -----------------------------------------------------------------------------
//
// `selectBootstrapLocation` accepts a pre-existing EMPTY directory as `usable`.
// On POSIX, `rename(2)` onto an empty directory silently replaces it, so the
// publish succeeds. On Windows, `fs.rename` onto ANY existing directory fails
// (EPERM from MoveFileEx's ERROR_ACCESS_DENIED, or EEXIST/ENOTEMPTY depending
// on the Windows + Node version) — without recovery the user would see a
// misleading "another process published first" warning even though no race
// occurred. This group pins the recovered behavior: the empty dir is cleared
// and the publish succeeds with no race-loser diagnostic.
describe('B3 — publish over a pre-existing empty target directory', () => {
  it('obtains successfully when target is a pre-existing empty directory', async () => {
    const source = await makeRemoteStore('empty-target-source');
    const project = makeProject('project-empty-target');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'preexisting-empty-target');
    // Pre-create the target as an EMPTY directory — the case
    // `selectBootstrapLocation` accepts as `usable`. On Windows, the publish
    // rename cannot replace this without the empty-dir recovery.
    fs.mkdirSync(target);

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('obtained');
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.rasen-store'))).toBe(true);

    // No false-positive "another process published first" warning was emitted.
    const lostRace = allBootstrapDiagnostics(report).find(
      (d) => d.code === 'bootstrap_obtain_publish_lost_race'
    );
    expect(lostRace, 'no race-loser diagnostic should fire for an empty pre-existing target').toBeUndefined();

    // No leftover staging directory.
    const stagingLeftover = fs
      .readdirSync(tempDir)
      .find((name) => name.startsWith('preexisting-empty-target.rasen-stage.'));
    expect(stagingLeftover, 'no staging directory should be left after a successful publish').toBeUndefined();
  }, 30000);

  it('still loses the race when target is a pre-existing NON-empty directory (refused before clone)', async () => {
    // selectBootstrapLocation refuses a non-empty target before the clone
    // runs, so this case never reaches publishStagedCheckout. Pinned here to
    // document that the empty-dir recovery does NOT weaken the refusal of a
    // directory with content.
    const source = await makeRemoteStore('nonempty-target-source');
    const project = makeProject('project-nonempty-target');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'preexisting-nonempty-target');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'do-not-delete.txt'), 'user content');

    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('not-acted');
    expect(
      entry.diagnostics.some((d) => d.code === 'bootstrap_obtain_target_refused')
    ).toBe(true);

    // The user's content is untouched.
    expect(fs.readFileSync(path.join(target, 'do-not-delete.txt'), 'utf-8')).toBe('user content');
  }, 30000);
});

// -----------------------------------------------------------------------------
// M9 — Credential-bearing remotes rejected before obtain
// -----------------------------------------------------------------------------

describe('M9 — credential-bearing remotes rejected before obtain', () => {
  it.each([
    ['https with userinfo', 'https://user:secret@host.example.com/repo.git', 'secret'],
    ['https with token-only userinfo', 'https://token@host.example.com/repo.git', 'token'],
    ['git+https with token', 'git+https://token@host.example.com/repo.git', 'token'],
    ['https with password only', 'https://:pass@host.example.com/repo.git', 'pass'],
  ])(
    'rejects %s before cloning — diagnostic carries the redacted form, never the raw credential',
    async (_label, remote, secret) => {
      const project = makeProject('project');
      updateProjectConfigKey(project, 'store', {
        uid: '11111111-2222-4333-8444-555555666666',
        id: 'cred-store',
        remote,
      });

      const target = path.join(tempDir, 'cred-target');
      const report = await buildBootstrapReport({
        cwd: project,
        mode: 'apply',
        globalDataDir,
        paths: new Map([['cred-store', target]]),
        consent: blanketConsent,
      });

      const entry = entryFor(report, 'cred-store');
      expect(entry.action).toBe('obtain-failed');

      // The diagnostic code for credential rejection.
      const cred_diag = entry.diagnostics.find((d) => d.code === 'store_remote_credentials');
      expect(cred_diag, 'credential rejection diagnostic should be present').toBeDefined();
      // The message MUST contain the redacted form.
      expect(cred_diag!.message).toContain('<redacted>');
      // The raw credential MUST NEVER appear in any diagnostic.
      for (const d of entry.diagnostics) {
        expect(d.message).not.toContain(secret);
      }

      // No staging dir was created — the credential check fires BEFORE the clone.
      expect(fs.existsSync(target)).toBe(false);
      const parent = path.dirname(target);
      if (fs.existsSync(parent)) {
        const siblings = fs.readdirSync(parent);
        expect(siblings.some((s) => s.includes('.rasen-stage.'))).toBe(false);
      }
    }
  );

  it('rejects credential-bearing Store remote and Store hint in the same report', async () => {
    const project = makeProject('project');
    // Store declaration with credentials.
    updateProjectConfigKey(project, 'store', {
      uid: '11111111-2222-4333-8444-555555666666',
      id: 'declared-store',
      remote: 'https://user:pass@host.example.com/repo.git',
    });

    const target = path.join(tempDir, 'multi-cred-target');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([['declared-store', target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, 'declared-store');
    expect(entry.action).toBe('obtain-failed');
    expect(
      entry.diagnostics.some((d) => d.code === 'store_remote_credentials')
    ).toBe(true);
    // The raw password never appears.
    for (const d of entry.diagnostics) {
      expect(d.message).not.toContain('pass');
    }
  });

  it('credential-free SSH remote still proceeds to clone (not rejected for credentials)', async () => {
    // ssh://git@host is the ordinary SSH form — the userinfo is an account
    // name, not a secret. assertCredentialFreeRemote explicitly allows it.
    const source = await makeRemoteStore('ssh-source');
    const project = makeProject('project');
    // Use a local file remote (not a real SSH remote) — the point is that
    // the credential gate does NOT fire for credential-free remotes. We
    // verify by using a local file:// remote that has no userinfo.
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'ssh-ok-target');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    // The entry was obtained (not rejected for credentials).
    expect(entry.action).toBe('obtained');
    expect(
      entry.diagnostics.some((d) => d.code === 'store_remote_credentials')
    ).toBe(false);
  });

  it('credential-free https remote still proceeds to clone', async () => {
    // A plain https remote without userinfo is credential-free and must
    // not be rejected. Use a local file:// path to avoid network dependency.
    const source = await makeRemoteStore('https-source');
    const project = makeProject('project');
    updateProjectConfigKey(project, 'store', {
      uid: source.uid,
      id: source.id,
      remote: source.remote,
    });

    const target = path.join(tempDir, 'https-ok-target');
    const report = await buildBootstrapReport({
      cwd: project,
      mode: 'apply',
      globalDataDir,
      paths: new Map([[source.id, target]]),
      consent: blanketConsent,
    });

    const entry = entryFor(report, source.id);
    expect(entry.action).toBe('obtained');
    expect(
      entry.diagnostics.some((d) => d.code === 'store_remote_credentials')
    ).toBe(false);
  });
});
