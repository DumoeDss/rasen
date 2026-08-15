import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'child_process';
import { promises as fs, realpathSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { runCLI } from '../helpers/run-cli.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const execFileAsync = promisify(execFile);

/**
 * Slice 1.3 journey: prove the Store lifecycle end to end across two simulated
 * machines (separate XDG homes). Machine A sets up a store, migrates it to
 * planning layout v2, and works a change in the project partition; machine B
 * clones, registers, reads the partition, and authors its own change in it.
 *
 * Task 10b.3 (`store-layout-v2-migration`): this journey used to run the whole
 * lifecycle against the Store's flat `rasen/changes` namespace. That namespace
 * is now read-only (`legacy_flat_store_requires_migration`), so the journey
 * MIGRATES and then runs the lifecycle rather than asserting the refusal and
 * stopping — the point of deferring the refusal into the slice that ships the
 * migration was to keep a live end-to-end gate over externalized planning.
 * The refusal itself is proved once, on the way past, in case 3.
 *
 * Finalization has since landed (`store-finalization-outcomes-v2`), so where
 * the lifecycle stops here is now a product fact rather than a deferral:
 * `rasen archive` against a migrated Store requires ONE explicitly declared
 * outcome and refuses with `finalization_outcome_required` without it. The
 * journey asserts that, which keeps it a real gate. The complete
 * finalize-and-assert-the-record journey lives in
 * `test/commands/store-v2-finalization-journey.test.ts`.
 *
 * Git config is fully isolated so user gitconfig (signing, hooks, identity)
 * cannot leak in; identity comes from explicit env vars.
 */

const STORE_ID = 'team-context';
const PROJECT_ID = 'app-repo';
const TARGET_LINE = 'line-main';
const MAPPING_FILE = 'rasen/migration-mapping.yaml';
const JOURNEY_TIMEOUT_MS = 90_000;

let base: string;
let storeRoot: string;
let cloneRoot: string;
let projectDir: string;
let emptyGitConfig: string;

let machineA: NodeJS.ProcessEnv;
let machineB: NodeJS.ProcessEnv;

let projectSnapshot: Map<string, string>;

/** Filled in as the journey proceeds; each case depends on the previous ones. */
let storeUid: string;
let storeBranch: string;
let planningRootA: string;
let planningRootB: string;

function machineEnv(home: string, gitConfigGlobal: string): NodeJS.ProcessEnv {
  return {
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_STATE_HOME: path.join(home, 'state'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    RASEN_TELEMETRY: '0',
    GIT_CONFIG_GLOBAL: gitConfigGlobal,
    GIT_CONFIG_SYSTEM: emptyGitConfig,
    GIT_AUTHOR_NAME: 'Journey Tester',
    GIT_AUTHOR_EMAIL: 'journey@example.com',
    GIT_COMMITTER_NAME: 'Journey Tester',
    GIT_COMMITTER_EMAIL: 'journey@example.com',
  };
}

// Same canonicalization the product uses (expands Windows 8.3 short names).
function canonical(target: string): string {
  return realpathSync.native(target);
}

async function git(cwd: string, env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, ...env },
  });
  return stdout;
}

async function snapshotDirectory(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        snapshot.set(`${relative}/`, '');
        await walk(absolute);
      } else {
        snapshot.set(relative, await fs.readFile(absolute, 'utf-8'));
      }
    }
  }

  await walk(root);
  return snapshot;
}

async function listRelativeEntries(root: string, skipDirs: Set<string>): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        found.push(`${relative}/`);
        await walk(absolute);
      } else {
        found.push(relative);
      }
    }
  }

  await walk(root);
  return found.sort();
}

async function writeCompletedChangeArtifacts(
  changeDir: string,
  capability: string
): Promise<void> {
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'proposal.md'),
    [
      '# Proposal',
      '',
      '## Why',
      '',
      'Prove the store lifecycle end to end.',
      '',
      '## What Changes',
      '',
      `- Add the ${capability} capability.`,
      '',
      '## Capabilities',
      '',
      '### New Capabilities',
      '',
      `- \`${capability}\`: lifecycle proof capability.`,
      '',
      '### Modified Capabilities',
      '',
      '(none)',
      '',
      '## Impact',
      '',
      '- Test-only.',
      '',
    ].join('\n'),
    'utf-8'
  );

  await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'specs', capability, 'spec.md'),
    [
      `# ${capability} Spec Delta`,
      '',
      '## ADDED Requirements',
      '',
      `### Requirement: ${capability} SHALL work`,
      '',
      `The system SHALL support ${capability}.`,
      '',
      '#### Scenario: It works',
      '',
      '- **WHEN** the lifecycle runs',
      '- **THEN** the capability exists',
      '',
    ].join('\n'),
    'utf-8'
  );

  await fs.writeFile(
    path.join(changeDir, 'design.md'),
    '# Design\n\nMinimal journey design.\n',
    'utf-8'
  );

  await fs.writeFile(
    path.join(changeDir, 'tasks.md'),
    '# Tasks\n\n## 1. Work\n\n- [x] 1.1 Do the work\n',
    'utf-8'
  );
}

/** The `.rasen/planning-line.json` marker that makes a linked worktree a planning checkout. */
async function writePlanningLineMarker(worktree: string): Promise<void> {
  await fs.mkdir(path.join(worktree, '.rasen'), { recursive: true });
  await fs.writeFile(
    path.join(worktree, '.rasen', 'planning-line.json'),
    JSON.stringify(
      {
        version: 1,
        storeUid,
        storeId: STORE_ID,
        projectId: PROJECT_ID,
        targetLineId: TARGET_LINE,
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );
}

function partitionChangeDir(planningCheckout: string, changeId: string): string {
  // Spelled out literally rather than computed through the layout contract
  // under test: asking the code where it put something proves nothing.
  return path.join(
    planningCheckout,
    'rasen',
    'projects',
    PROJECT_ID,
    'changes',
    changeId
  );
}

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(tmpdir(), 'rasen-store-lifecycle-'));
  storeRoot = path.join(base, 'machine-a', 'team-context');
  cloneRoot = path.join(base, 'machine-b', 'team-context');
  projectDir = path.join(base, 'machine-a', 'app-repo');
  planningRootA = path.join(base, 'machine-a', 'planning-line');
  planningRootB = path.join(base, 'machine-b', 'planning-line');
  emptyGitConfig = path.join(base, 'empty-gitconfig');

  await fs.writeFile(emptyGitConfig, '', 'utf-8');
  machineA = machineEnv(path.join(base, 'machine-a', 'home'), emptyGitConfig);
  machineB = machineEnv(path.join(base, 'machine-b', 'home'), emptyGitConfig);

  await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
  await fs.writeFile(path.join(projectDir, 'README.md'), '# app\n', 'utf-8');
  await fs.writeFile(path.join(projectDir, 'src', 'main.ts'), 'export {};\n', 'utf-8');
  projectSnapshot = await snapshotDirectory(projectDir);
}, 120_000);

afterAll(async () => {
  cleanupTempPath(base);
});

describe('store lifecycle journey', () => {
  it('machine A: setup produces a committed, clonable repo', async () => {
    const result = await runCLI(
      ['store', 'setup', STORE_ID, '--path', storeRoot, '--json'],
      { env: machineA }
    );

    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.git).toEqual({
      is_repository: true,
      initialized: true,
      committed: true,
    });
    expect(payload.created_files).toEqual(
      expect.arrayContaining([
        'rasen/config.yaml',
        'rasen/specs/.gitkeep',
        'rasen/changes/archive/.gitkeep',
        '.rasen-store/store.yaml',
      ])
    );

    const log = await git(storeRoot, machineA, ['log', '--format=%s']);
    expect(log.trim().split('\n')).toHaveLength(1);
    expect(log).toContain(`Initialize Rasen store ${STORE_ID}`);

    const committedFiles = await git(storeRoot, machineA, [
      'show',
      '--name-only',
      '--format=',
      'HEAD',
    ]);
    expect(committedFiles).toContain('.rasen-store/store.yaml');
    expect(committedFiles).toContain('rasen/specs/.gitkeep');
    expect(committedFiles).toContain('rasen/changes/archive/.gitkeep');

    const status = await git(storeRoot, machineA, ['status', '--porcelain']);
    expect(status.trim()).toBe('');

    const metadata = await fs.readFile(
      path.join(storeRoot, '.rasen-store', 'store.yaml'),
      'utf-8'
    );
    storeUid = /^uid:\s*(\S+)$/m.exec(metadata)?.[1] as string;
    expect(storeUid).toBeTruthy();
    storeBranch = (
      await git(storeRoot, machineA, ['rev-parse', '--abbrev-ref', 'HEAD'])
    ).trim();
  });

  it('machine A: doctor and list see a healthy store with git facts', async () => {
    const list = await runCLI(['store', 'list', '--json'], { env: machineA });
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout).stores).toHaveLength(1);

    const doctor = await runCLI(['store', 'doctor', STORE_ID, '--json'], {
      env: machineA,
    });
    expect(doctor.exitCode).toBe(0);
    const store = JSON.parse(doctor.stdout).stores[0];
    expect(store.openspec_root.healthy).toBe(true);
    expect(store.git).toEqual({
      is_repository: true,
      has_commits: true,
      has_uncommitted_changes: false,
      has_remote: false,
      origin_url: null,
    });
    expect(store.status).toEqual([]);

    // Human output surfaces the same Git facts.
    const humanDoctor = await runCLI(['store', 'doctor', STORE_ID], { env: machineA });
    expect(humanDoctor.exitCode).toBe(0);
    expect(humanDoctor.stdout).toContain(
      'Git: repository detected (commits: yes, uncommitted changes: no, remote: none)'
    );
  });

  it('machine A: the legacy flat planning tree is read-only until it is migrated', async () => {
    // The Store carries a member project and planning content from before
    // layout v2. It has to be written directly: `rasen new change --store` and
    // `rasen store adopt` both refuse a legacy flat Store now, which is exactly
    // the capability loss `proposal.md`'s second BREAKING bullet declares — and
    // exactly what the rest of this journey proves is survivable.
    await fs.mkdir(path.join(storeRoot, '.rasen-store', 'projects'), { recursive: true });
    await fs.writeFile(
      path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
      [
        'version: 1',
        `projectId: ${PROJECT_ID}`,
        'roles:',
        '  planning: true',
        '  knowledge: true',
        'adoption:',
        '  specs:',
        '    - billing',
        '  changes:',
        '    - add-billing',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n'),
      'utf-8'
    );

    await fs.mkdir(path.join(storeRoot, 'rasen', 'specs', 'billing'), { recursive: true });
    await fs.writeFile(
      path.join(storeRoot, 'rasen', 'specs', 'billing', 'spec.md'),
      '# billing\n\n## Purpose\n\nBilling rules the team already agreed on.\n',
      'utf-8'
    );
    await writeCompletedChangeArtifacts(
      path.join(storeRoot, 'rasen', 'changes', 'add-billing'),
      'billing'
    );
    await git(storeRoot, machineA, ['add', '-A']);
    await git(storeRoot, machineA, ['commit', '-m', 'Existing flat planning content']);

    // Both halves of task 10b.1, through the real CLI, against the real Store.
    const created = await runCLI(
      ['new', 'change', 'add-invoicing', '--store', STORE_ID, '--json'],
      { env: machineA, cwd: projectDir }
    );
    expect(created.exitCode).toBe(1);
    expect(JSON.parse(created.stdout).status[0]).toMatchObject({
      code: 'legacy_flat_store_requires_migration',
      fix: `Run 'rasen store migrate-layout ${STORE_ID}' to migrate this Store, then retry.`,
    });

    const archived = await runCLI(
      ['archive', 'add-billing', '--store', STORE_ID, '--yes', '--json'],
      { env: machineA, cwd: projectDir }
    );
    expect(archived.exitCode).toBe(1);
    expect(JSON.parse(archived.stdout).status[0]).toMatchObject({
      code: 'legacy_flat_store_requires_migration',
    });

    // Refused before writing, moving, or deleting anything.
    expect(await git(storeRoot, machineA, ['status', '--porcelain'])).toBe('');
    await expect(
      fs.access(path.join(storeRoot, 'rasen', 'changes', 'add-billing', 'proposal.md'))
    ).resolves.toBeUndefined();
    expect(
      await fs.readdir(path.join(storeRoot, 'rasen', 'changes', 'archive'))
    ).toEqual(['.gitkeep']);
  }, JOURNEY_TIMEOUT_MS);

  it('machine A: migrating publishes the project partition and retires the flat tree', async () => {
    await fs.writeFile(
      path.join(storeRoot, MAPPING_FILE),
      [
        'version: 1',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        `    storeRef: refs/heads/${storeBranch}`,
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        '',
      ].join('\n'),
      'utf-8'
    );
    await git(storeRoot, machineA, ['add', '-A']);
    await git(storeRoot, machineA, ['commit', '-m', 'Declare the migration mapping']);

    const preview = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING_FILE, '--json'],
      { env: machineA, cwd: storeRoot }
    );
    expect(preview.exitCode).toBe(0);
    const plan = JSON.parse(preview.stdout);
    expect(plan.blockers).toEqual([]);
    expect(plan.applicable).toBe(true);
    // Preview is read-only.
    expect(await git(storeRoot, machineA, ['status', '--porcelain'])).toBe('');

    const applied = await runCLI(
      [
        'store',
        'migrate-layout',
        STORE_ID,
        '--mapping',
        MAPPING_FILE,
        '--apply',
        '--json',
      ],
      { env: machineA, cwd: storeRoot }
    );
    expect(applied.exitCode).toBe(0);

    const partition = path.join(storeRoot, 'rasen', 'projects', PROJECT_ID);
    await expect(
      fs.readFile(path.join(partition, 'specs', 'billing', 'spec.md'), 'utf-8')
    ).resolves.toContain('Billing rules the team already agreed on.');
    await expect(
      fs.readFile(path.join(partition, 'changes', 'add-billing', 'proposal.md'), 'utf-8')
    ).resolves.toContain('Add the billing capability.');
    await expect(
      fs.readFile(
        path.join(storeRoot, '.rasen-store', 'target-lines', `${TARGET_LINE}.yaml`),
        'utf-8'
      )
    ).resolves.toContain(`id: ${TARGET_LINE}`);
    const catalog = await fs.readFile(
      path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_ID}.yaml`),
      'utf-8'
    );
    expect(catalog).toContain('version: 2');
    expect(catalog).toContain('state: bound');
    await expect(
      fs.readFile(path.join(storeRoot, '.rasen-store', 'store.yaml'), 'utf-8')
    ).resolves.toContain('layoutVersion: 2');

    const retired = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--retire-flat', '--json'],
      { env: machineA, cwd: storeRoot }
    );
    expect(retired.exitCode).toBe(0);
    // Retirement removes the whole flat namespace, including the empty archive
    // shell `store setup` created.
    await expect(fs.access(path.join(storeRoot, 'rasen', 'specs'))).rejects.toThrow();
    await expect(fs.access(path.join(storeRoot, 'rasen', 'changes'))).rejects.toThrow();

    await git(storeRoot, machineA, ['add', '-A']);
    await git(storeRoot, machineA, ['commit', '-m', 'Migrate planning to layout v2']);
  }, JOURNEY_TIMEOUT_MS);

  it('machine A: works a change in the migrated project partition', async () => {
    const changeId = 'add-invoicing';

    // Store v2 Change creation requires a verified planning worktree; the
    // integration checkout is read-only (child 2's guard).
    await git(storeRoot, machineA, [
      'worktree',
      'add',
      '-b',
      'planning-line-main',
      planningRootA,
    ]);
    planningRootA = canonical(planningRootA);
    await writePlanningLineMarker(planningRootA);

    const selectors = [
      '--store',
      STORE_ID,
      '--project',
      PROJECT_ID,
      '--target-line',
      TARGET_LINE,
    ];

    const created = await runCLI(
      ['new', 'change', changeId, '--json', ...selectors],
      { env: machineA, cwd: planningRootA }
    );
    expect(created.exitCode).toBe(0);
    const createdPayload = JSON.parse(created.stdout);
    // The established compatibility fields are unchanged. `scope` is additive
    // and REQUIRED: root JSON must identify whether the result is standalone,
    // legacy Store, Store aggregate, or Store project scope
    // (specs/store-planning-scope-routing "Machine-readable context describes
    // scope without granting authority").
    expect(createdPayload.root).toMatchObject({
      path: planningRootA,
      source: 'store',
      store_id: STORE_ID,
      scope: {
        kind: 'store-project',
        ref: {
          mode: 'store-project',
          storeUid,
          storeId: STORE_ID,
          projectId: PROJECT_ID,
          targetLineId: TARGET_LINE,
        },
      },
    });
    expect(Object.keys(createdPayload.root).sort()).toEqual([
      'path',
      'scope',
      'source',
      'store_id',
    ]);
    expect(createdPayload.change.path).toBe(partitionChangeDir(planningRootA, changeId));
    // The retired flat namespace is not resurrected by creation.
    await expect(fs.access(path.join(planningRootA, 'rasen', 'specs'))).rejects.toThrow();
    await expect(fs.access(path.join(planningRootA, 'rasen', 'changes'))).rejects.toThrow();

    const status = await runCLI(
      ['status', '--change', changeId, ...selectors],
      { env: machineA, cwd: planningRootA }
    );
    expect(status.exitCode).toBe(0);
    expect(status.stderr).toContain(`Using Rasen root: ${STORE_ID}`);

    const instructions = await runCLI(
      ['instructions', 'proposal', '--change', changeId, ...selectors],
      { env: machineA, cwd: planningRootA }
    );
    expect(instructions.exitCode).toBe(0);
    expect(instructions.stdout).toContain(
      path.join(partitionChangeDir(planningRootA, changeId), 'proposal.md')
    );

    // The test acts as the agent and writes the artifacts.
    await writeCompletedChangeArtifacts(
      partitionChangeDir(planningRootA, changeId),
      'invoicing'
    );

    const validated = await runCLI(
      ['validate', changeId, ...selectors],
      { env: machineA, cwd: planningRootA }
    );
    expect(validated.exitCode).toBe(0);
    expect(validated.stdout).toContain('is valid');

    const listed = await runCLI(['list', '--json', ...selectors], {
      env: machineA,
      cwd: planningRootA,
    });
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).changes.map((c: { name: string }) => c.name)).toContain(
      changeId
    );

    const shown = await runCLI(['show', changeId, ...selectors], {
      env: machineA,
      cwd: planningRootA,
    });
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain('# Proposal');

    // The Store-level reads resolve from the code repo too, and leave it alone.
    const specs = await runCLI(['list', '--specs', '--json', ...selectors], {
      env: machineA,
      cwd: projectDir,
    });
    expect(specs.exitCode).toBe(0);
    expect(JSON.parse(specs.stdout).specs.map((spec: { id: string }) => spec.id)).toContain(
      'billing'
    );
    const shownSpec = await runCLI(['show', 'billing', ...selectors], {
      env: machineA,
      cwd: projectDir,
    });
    expect(shownSpec.exitCode).toBe(0);
    expect(shownSpec.stdout).toContain('Billing rules the team already agreed on.');

    // `store-finalization-outcomes-v2` lifted the deferral this case used to
    // assert. What a migrated Store's archiving reports now is the real gate:
    // a Change ends in exactly ONE explicitly declared outcome, and there is no
    // default — because an implicit outcome would be an implicit spec sync.
    // The refusal happens before any filesystem or Git access, which is what
    // the untouched-partition assertions below are checking.
    const archived = await runCLI(
      ['archive', changeId, '--yes', '--json', ...selectors],
      { env: machineA, cwd: planningRootA }
    );
    expect(archived.exitCode).toBe(1);
    const archivedStatus = JSON.parse(archived.stdout).status;
    expect(archivedStatus).toHaveLength(1);
    // L6-port note: with the finalization slice (L3+L5) not yet ported, the
    // refusal this line reports first is the execution-authority gate, not
    // `finalization_outcome_required` — 0.1.7's archive runs the outcome
    // diagnostics BEFORE the execution guard. When the finalization module
    // lands, this assertion and the outcome-name loop below flip back.
    expect(archivedStatus[0]).toMatchObject({
      severity: 'error',
      code: 'execution_authority_required',
    });
    // Refused without touching the partition, and without resurrecting a
    // root-level flat namespace.
    await expect(
      fs.access(path.join(partitionChangeDir(planningRootA, changeId), 'proposal.md'))
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(planningRootA, 'rasen', 'specs'))).rejects.toThrow();
    await expect(fs.access(path.join(planningRootA, 'rasen', 'changes'))).rejects.toThrow();
  }, JOURNEY_TIMEOUT_MS);

  it('machine A: the project repo is byte-identical after the lifecycle', async () => {
    const after = await snapshotDirectory(projectDir);
    expect(after).toEqual(projectSnapshot);
  });

  it('machine B: a clone registers without ceremony and reads the migrated partition', async () => {
    await fs.mkdir(path.dirname(cloneRoot), { recursive: true });
    await git(path.dirname(cloneRoot), machineB, ['clone', storeRoot, cloneRoot]);

    const commitsBeforeRegister = (
      await git(cloneRoot, machineB, ['rev-list', '--count', 'HEAD'])
    ).trim();

    const registered = await runCLI(
      ['store', 'register', cloneRoot, '--json'],
      { env: machineB }
    );
    expect(registered.exitCode).toBe(0);
    const payload = JSON.parse(registered.stdout);
    expect(payload.store.id).toBe(STORE_ID);
    expect(payload.created_files).toEqual([]);

    // Register never commits.
    const commitsAfterRegister = (
      await git(cloneRoot, machineB, ['rev-list', '--count', 'HEAD'])
    ).trim();
    expect(commitsAfterRegister).toBe(commitsBeforeRegister);

    const doctor = await runCLI(['store', 'doctor', STORE_ID, '--json'], {
      env: machineB,
    });
    expect(doctor.exitCode).toBe(0);
    expect(JSON.parse(doctor.stdout).stores[0].openspec_root.healthy).toBe(true);

    const selectors = [
      '--store',
      STORE_ID,
      '--project',
      PROJECT_ID,
      '--target-line',
      TARGET_LINE,
    ];
    const specs = await runCLI(['list', '--specs', '--json', ...selectors], {
      env: machineB,
      cwd: base,
    });
    expect(specs.exitCode).toBe(0);
    const specsPayload = JSON.parse(specs.stdout);
    expect(specsPayload.specs.map((spec: { id: string }) => spec.id)).toContain('billing');
    expect(specsPayload.root.store_id).toBe(STORE_ID);
    expect(specsPayload.root.path).toBe(canonical(cloneRoot));

    const shownSpec = await runCLI(['show', 'billing', ...selectors], {
      env: machineB,
      cwd: base,
    });
    expect(shownSpec.exitCode).toBe(0);
    expect(shownSpec.stdout).toContain('Billing rules the team already agreed on.');

    // The Change machine A migrated came across with the clone.
    const changes = await runCLI(['list', '--json', ...selectors], {
      env: machineB,
      cwd: base,
    });
    expect(changes.exitCode).toBe(0);
    expect(JSON.parse(changes.stdout).changes.map((c: { name: string }) => c.name)).toEqual([
      'add-billing',
    ]);
  }, JOURNEY_TIMEOUT_MS);

  it('machine B: authors its own change in the clone project partition', async () => {
    const changeId = 'add-reporting';

    await git(cloneRoot, machineB, [
      'worktree',
      'add',
      '-b',
      'planning-line-main-b',
      planningRootB,
    ]);
    planningRootB = canonical(planningRootB);
    await writePlanningLineMarker(planningRootB);

    const selectors = [
      '--store',
      STORE_ID,
      '--project',
      PROJECT_ID,
      '--target-line',
      TARGET_LINE,
    ];

    const created = await runCLI(['new', 'change', changeId, ...selectors], {
      env: machineB,
      cwd: planningRootB,
    });
    expect(created.exitCode).toBe(0);
    expect(created.stderr).toContain(`Using Rasen root: ${STORE_ID}`);
    expect(created.stdout).toContain(`--project ${PROJECT_ID}`);
    expect(created.stdout).toContain(`--target-line ${TARGET_LINE}`);

    await writeCompletedChangeArtifacts(
      partitionChangeDir(planningRootB, changeId),
      'reporting'
    );

    const status = await runCLI(['status', '--change', changeId, ...selectors], {
      env: machineB,
      cwd: planningRootB,
    });
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain('All artifacts complete!');

    const validated = await runCLI(['validate', changeId, ...selectors], {
      env: machineB,
      cwd: planningRootB,
    });
    expect(validated.exitCode).toBe(0);
    expect(validated.stdout).toContain('is valid');

    // Same gate as machine A, reached from the second machine. L6-port note:
    // reports the execution-authority refusal until the finalization slice
    // (L3+L5) lands; then this flips back to `finalization_outcome_required`.
    const archived = await runCLI(
      ['archive', changeId, '--yes', '--json', ...selectors],
      { env: machineB, cwd: planningRootB }
    );
    expect(archived.exitCode).toBe(1);
    expect(JSON.parse(archived.stdout).status[0].code).toBe(
      'execution_authority_required'
    );
    await expect(
      fs.access(path.join(partitionChangeDir(planningRootB, changeId), 'proposal.md'))
    ).resolves.toBeUndefined();
  }, JOURNEY_TIMEOUT_MS);

  it('end state is just normal Rasen files in both checkouts', async () => {
    for (const [root, env] of [
      [storeRoot, machineA],
      [cloneRoot, machineB],
    ] as const) {
      // `.rasen/` is machine-local run state (migration staging), never
      // committed — asserted directly below rather than pattern-matched.
      const entries = await listRelativeEntries(root, new Set(['.git', '.rasen']));

      for (const entry of entries) {
        expect(entry).toMatch(/^(\.rasen-store(\/.*)?|rasen(\/.*)?)$/);
        expect(entry).not.toMatch(/initiative|workspace/i);
      }

      expect(entries).toContain('.rasen-store/store.yaml');
      expect(entries).toContain(`.rasen-store/projects/${PROJECT_ID}.yaml`);
      expect(entries).toContain(`.rasen-store/target-lines/${TARGET_LINE}.yaml`);
      expect(entries).toContain('rasen/config.yaml');
      expect(entries).toContain(
        `rasen/projects/${PROJECT_ID}/specs/billing/spec.md`
      );

      const tracked = (await git(root, env, ['ls-files'])).split('\n');
      expect(tracked.filter((file) => file.startsWith('.rasen/'))).toEqual([]);
    }

    // Global state holds only registry/config metadata, never planning files.
    //
    // DELIBERATE CHANGE (task 6.5): registry self-healing and version warnings
    // are now constrained to a real standalone/execution project, so selecting
    // a Store no longer registers the STORE CHECKOUT as a project. The single
    // machine home this test used to require was exactly that side effect —
    // its old comment named it "the machine-home directory for the resolved
    // store root". A Store checkout is a planning locator, not a project.
    for (const env of [machineA, machineB]) {
      const dataEntries = await listRelativeEntries(
        path.join(env.XDG_DATA_HOME as string, 'rasen'),
        new Set()
      );
      // `planning-workspaces/` is the ONE machine-root family
      // `store-planning-worktree-bindings` adds — the workspace plans, the
      // binding index, and the locks — declared in that change's proposal
      // Impact section. It belongs here rather than in either Git repository
      // precisely because neither repository may store a plan, a token, a
      // lock, or an index entry, which the checkout loop above still enforces.
      // It is named as a family rather than admitted by widening the pattern,
      // so an unexpected fourth family still fails.
      for (const entry of dataEntries) {
        expect(entry).toMatch(
          /^(stores\/(registry\.yaml)?|projects\/(registry\.json)?|projects\/[a-z0-9-]+\/|store-layout-migration(\/.*)?|planning-workspaces(\/.*)?)$/
        );
      }
      // ...and inside that family, only the three documented kinds. The
      // listing emits directories with a trailing slash, so the family's own
      // entry is `planning-workspaces/` and is not itself a member.
      for (const entry of dataEntries.filter(
        (candidate) =>
          candidate.startsWith('planning-workspaces/') &&
          candidate !== 'planning-workspaces/'
      )) {
        expect(entry).toMatch(/^planning-workspaces\/(index|plans|locks)(\/.*)?$/);
      }
      expect(dataEntries).toContain('stores/');
      expect(dataEntries).toContain('stores/registry.yaml');
      // Regression guard: if scope selection ever re-registers a Store
      // checkout as a project, a machine home reappears here and this fails.
      expect(dataEntries.filter((entry) => /^projects\/[a-z0-9-]+\/$/.test(entry))).toHaveLength(0);
    }
  });

  it('setup fails before creating anything when Git identity is missing', async () => {
    const strictConfig = path.join(base, 'strict-gitconfig');
    await fs.writeFile(strictConfig, '[user]\n\tuseConfigOnly = true\n', 'utf-8');

    const noIdentity: NodeJS.ProcessEnv = {
      ...machineEnv(path.join(base, 'machine-c', 'home'), strictConfig),
      GIT_AUTHOR_NAME: '',
      GIT_AUTHOR_EMAIL: '',
      GIT_COMMITTER_NAME: '',
      GIT_COMMITTER_EMAIL: '',
    };
    const target = path.join(base, 'machine-c', 'no-identity-store');

    const result = await runCLI(
      ['store', 'setup', 'no-identity', '--path', target, '--json'],
      { env: noIdentity }
    );
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout);
    expect(payload.status[0].code).toBe('store_git_identity_missing');
    expect(payload.status[0].fix).toContain('git config --global user.name');

    await expect(fs.access(target)).rejects.toThrow();

    // --no-init-git needs no identity and creates no repo.
    const optOut = await runCLI(
      ['store', 'setup', 'no-identity', '--path', target, '--no-init-git', '--json'],
      { env: noIdentity }
    );
    expect(optOut.exitCode).toBe(0);
    const optOutPayload = JSON.parse(optOut.stdout);
    expect(optOutPayload.git).toEqual({
      is_repository: false,
      initialized: false,
      committed: false,
    });
    await expect(fs.access(path.join(target, '.git'))).rejects.toThrow();
  });
});
