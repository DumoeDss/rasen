/**
 * Task 11.1 — the layout v2 migration journey, driven end to end through the
 * real CLI.
 *
 * A fixture Store with two member projects, a single-owner spec, a spec two
 * projects contributed to, active Changes, a legacy Archive entry, a
 * Store-level design doc and a SECOND flat ref, taken through inventory ->
 * mapping -> plan -> apply -> retirement, and then through adopt and eject
 * against the partitions the migration produced.
 *
 * Everything runs as a subprocess against the built CLI: the Module's own
 * suites prove the algorithm, and this proves the product — a kernel that
 * passes while the command cannot reach it is the failure mode this exists to
 * catch.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const STORE_ID = 'team-store';
const OWNER_PROJECT = 'elftia';
const OTHER_PROJECT = 'scene-bridge';
const TARGET_LINE = 'line-0.2';
const MAPPING_FILE = 'rasen/migration-mapping.yaml';

describe('store layout v2 migration journey (CLI)', () => {
  let tempDir: string;
  let storeRoot: string;
  let storeUid: string;
  let env: NodeJS.ProcessEnv;

  function git(...args: string[]): string {
    return execFileSync('git', ['-C', storeRoot, ...args], {
      env: { ...process.env, ...env },
      windowsHide: true,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  }

  function write(relative: string, content: string): void {
    const target = path.join(storeRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  }

  function ls(...segments: string[]): string[] {
    try {
      return fs.readdirSync(path.join(storeRoot, ...segments)).sort();
    } catch {
      return [];
    }
  }

  function parseJson(result: RunCLIResult): any {
    try {
      return JSON.parse(result.stdout);
    } catch (error) {
      throw new Error(
        `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
      );
    }
  }

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-v2-migration-'))
    );
    env = {
      ...isolatedGitEnv(tempDir),
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    storeUid = randomUUID();
    storeRoot = path.join(tempDir, 'team-store');

    fs.mkdirSync(storeRoot, { recursive: true });
    execFileSync('git', ['init', '-b', 'main', storeRoot], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: 'pipe',
    });

    // A legacy flat Store that already carries a permanent identity, which is
    // what every Store created since 0.1.5 looks like.
    write('rasen/config.yaml', 'schema: spec-driven\n');
    write(
      '.rasen-store/store.yaml',
      `version: 2\nuid: ${storeUid}\nid: ${STORE_ID}\n`
    );

    // Two member projects: one with adoption evidence, one roster-only.
    write(
      `.rasen-store/projects/${OWNER_PROJECT}.yaml`,
      [
        'version: 1',
        `projectId: ${OWNER_PROJECT}`,
        'roles:',
        '  planning: true',
        '  knowledge: true',
        'adoption:',
        '  specs:',
        '    - billing',
        '  changes:',
        '    - fix-a',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n')
    );
    write(
      `.rasen-store/projects/${OTHER_PROJECT}.yaml`,
      [
        'version: 1',
        `projectId: ${OTHER_PROJECT}`,
        'roles:',
        '  planning: false',
        '  knowledge: true',
        '',
      ].join('\n')
    );

    // Flat planning content: one single-owner spec, one two-contributor spec.
    write('rasen/specs/billing/spec.md', '# billing\n');
    write('rasen/specs/telemetry/spec.md', '# telemetry\n');
    write('rasen/changes/fix-a/proposal.md', '# fix-a\n');
    write('rasen/changes/fix-a/specs/telemetry/spec.md', '# delta\n');
    write('rasen/changes/fix-b/proposal.md', '# fix-b\n');
    write('rasen/changes/fix-b/specs/telemetry/spec.md', '# delta\n');
    write('rasen/changes/archive/2026-07-01-old-thing/proposal.md', '# archived\n');
    write('rasen/design-docs/cross-cutting.md', '# cross-cutting\n');

    // The operator's committed declarations.
    write(
      MAPPING_FILE,
      [
        'version: 1',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${OWNER_PROJECT}:`,
        '        codeRef: refs/heads/main',
        `      ${OTHER_PROJECT}:`,
        '        codeRef: refs/heads/main',
        'changes:',
        '  fix-b:',
        `    project: ${OTHER_PROJECT}`,
        'archive:',
        '  2026-07-01-old-thing:',
        `    project: ${OWNER_PROJECT}`,
        'specs:',
        '  telemetry:',
        `    owner: ${OWNER_PROJECT}`,
        '',
      ].join('\n')
    );

    git('add', '-A');
    git('commit', '-m', 'seed legacy flat store');
    // A second flat ref, which the survey must report and never migrate.
    git('branch', 'release');

    const registered = await runCLI(['store', 'register', storeRoot, '--json'], { env });
    expect(registered.exitCode).toBe(0);
  }, 120_000);

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  it('previews, applies, retires, and then serves adopt and eject', async () => {
    // --- Preview: read-only, complete, and applicable ---------------------
    const preview = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING_FILE, '--json'],
      { env, cwd: storeRoot }
    );
    expect(preview.exitCode).toBe(0);
    const plan = parseJson(preview);
    expect(plan.blockers).toEqual([]);
    expect(plan.applicable).toBe(true);
    // The other flat ref is reported, and migrating this one does not migrate it.
    expect(JSON.stringify(plan.otherFlatRefs)).toContain('refs/heads/release');
    // Preview writes nothing: the Store is still flat and still clean.
    expect(git('status', '--porcelain').trim()).toBe('');

    // --- Apply -------------------------------------------------------------
    const applied = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING_FILE, '--apply', '--json'],
      { env, cwd: storeRoot }
    );
    expect(applied.exitCode).toBe(0);

    // Every partition address is the layout v2 one, spelled out here rather
    // than computed through the contract under test.
    expect(ls('rasen', 'projects', OWNER_PROJECT, 'specs')).toEqual(['billing', 'telemetry']);
    expect(ls('rasen', 'projects', OWNER_PROJECT, 'changes')).toContain('fix-a');
    expect(ls('rasen', 'projects', OTHER_PROJECT, 'changes')).toContain('fix-b');
    expect(
      ls('rasen', 'projects', OWNER_PROJECT, 'changes', 'archive', TARGET_LINE)
    ).toEqual(['2026-07-01-old-thing']);
    // The legacy Archive entry keeps its directory name and its bytes.
    expect(
      fs.readFileSync(
        path.join(
          storeRoot,
          'rasen/projects',
          OWNER_PROJECT,
          'changes/archive',
          TARGET_LINE,
          '2026-07-01-old-thing/proposal.md'
        ),
        'utf-8'
      )
    ).toBe('# archived\n');
    // The Store-level design doc is RETAINED, not distributed.
    expect(ls('rasen', 'design-docs')).toEqual(['cross-cutting.md']);
    // The layout flip and the target-line catalog landed.
    expect(fs.readFileSync(path.join(storeRoot, '.rasen-store/store.yaml'), 'utf-8')).toContain(
      'layoutVersion: 2'
    );
    expect(ls('.rasen-store', 'target-lines')).toEqual([`${TARGET_LINE}.yaml`]);
    // The v1 records became v2 catalogs: adoption evidence binds, membership
    // alone does not.
    const ownerCatalog = fs.readFileSync(
      path.join(storeRoot, '.rasen-store/projects', `${OWNER_PROJECT}.yaml`),
      'utf-8'
    );
    expect(ownerCatalog).toContain('version: 2');
    expect(ownerCatalog).toContain('state: bound');
    expect(ownerCatalog).not.toContain('adoption');
    expect(
      fs.readFileSync(
        path.join(storeRoot, '.rasen-store/projects', `${OTHER_PROJECT}.yaml`),
        'utf-8'
      )
    ).toContain('state: unbound');
    // The receipt preserves what the catalogs dropped.
    const receipts = ls('.rasen-store', 'migration', 'receipts');
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(storeRoot, '.rasen-store/migration/receipts', receipts[0] as string),
        'utf-8'
      )
    );
    expect(JSON.stringify(receipt)).toContain('billing');
    // The flat tree is still readable until retirement is asked for.
    expect(ls('rasen', 'specs')).toEqual(['billing', 'telemetry']);

    // --- Retire ------------------------------------------------------------
    const retired = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--retire-flat', '--json'],
      { env, cwd: storeRoot }
    );
    expect(retired.exitCode).toBe(0);
    expect(ls('rasen', 'specs')).toEqual([]);
    expect(ls('rasen', 'changes').filter((name) => name !== 'archive')).toEqual([]);
    // Retirement is idempotent.
    const retiredAgain = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--retire-flat', '--json'],
      { env, cwd: storeRoot }
    );
    expect(retiredAgain.exitCode).toBe(0);

    // --- The migrated Store serves adopt and eject -------------------------
    git('add', '-A');
    git('commit', '-m', 'migrate to layout v2');

    const projectRoot = path.join(tempDir, 'new-app');
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'specs', 'invoicing'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\n'
    );
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'specs', 'invoicing', 'spec.md'),
      '# invoicing\n'
    );

    const adopted = await runCLI(
      [
        'store',
        'adopt',
        projectRoot,
        '--to',
        STORE_ID,
        '--target-line',
        TARGET_LINE,
        '--json',
      ],
      { env, cwd: tempDir }
    );
    expect(adopted.exitCode).toBe(0);
    const adoptedProjectId = parseJson(adopted).adopt.project_id as string;
    expect(adoptedProjectId).toBeTruthy();
    expect(ls('rasen', 'projects', adoptedProjectId, 'specs')).toEqual(['invoicing']);

    const ejected = await runCLI(
      ['store', 'eject', adoptedProjectId, '--from', STORE_ID, '--json'],
      { env, cwd: projectRoot }
    );
    expect(ejected.exitCode).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, 'rasen', 'specs', 'invoicing'))).toBe(true);
    expect(
      fs.existsSync(path.join(storeRoot, 'rasen', 'projects', adoptedProjectId))
    ).toBe(false);
  }, 180_000);
});
