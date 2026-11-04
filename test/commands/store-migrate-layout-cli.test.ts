/**
 * Task 9.6 — the `rasen store migrate-layout` command surface.
 *
 * The Module's own suites prove the algorithm; this proves the COMMAND: that
 * the flags parse, that the default is a preview and not a publication, that
 * the JSON and human renderings say the same things, that the apply gate's
 * refusal reaches the operator with its reasons, and that both commit
 * suggestions are printed and nothing is staged or committed.
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
const PROJECT_ID = 'elftia';
const TARGET_LINE = 'line-0.2';
const MAPPING = 'rasen/migration-mapping.yaml';

describe('rasen store migrate-layout (CLI)', () => {
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
    const target = path.join(storeRoot, relative.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
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
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-migrate-cli-'))
    );
    env = {
      ...isolatedGitEnv(tempDir),
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    storeUid = randomUUID();
    storeRoot = path.join(tempDir, STORE_ID);
    fs.mkdirSync(storeRoot, { recursive: true });
    execFileSync('git', ['init', '-b', 'main', storeRoot], {
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: 'pipe',
    });

    write('rasen/config.yaml', 'schema: spec-driven\n');
    write('.rasen-store/store.yaml', `version: 2\nuid: ${storeUid}\nid: ${STORE_ID}\n`);
    write(
      `.rasen-store/projects/${PROJECT_ID}.yaml`,
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
        '    - fix-a',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n')
    );
    write('rasen/specs/billing/spec.md', '# billing\n');
    write('rasen/changes/fix-a/proposal.md', '# fix-a\n');
    write(
      MAPPING,
      [
        'version: 1',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        '',
      ].join('\n')
    );
    git('add', '-A');
    git('commit', '-m', 'seed legacy flat store');

    const registered = await runCLI(['store', 'register', storeRoot, '--json'], { env });
    expect(registered.exitCode).toBe(0);
  }, 120_000);

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  it('previews by default: no --apply, no publication, and a clean worktree afterwards', async () => {
    const preview = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--json'],
      { env, cwd: storeRoot }
    );

    expect(preview.exitCode).toBe(0);
    const plan = parseJson(preview);
    expect(plan.applicable).toBe(true);
    // The whole inventory, membership record included, in one table.
    expect(plan.items.map((item: { name: string }) => item.name).sort()).toEqual([
      'billing',
      `${PROJECT_ID}.yaml`,
      'fix-a',
    ]);
    // A mistyped invocation cannot publish: the flat tree and the declaration
    // are both untouched.
    expect(git('status', '--porcelain').trim()).toBe('');
    expect(
      fs.readFileSync(path.join(storeRoot, '.rasen-store', 'store.yaml'), 'utf-8')
    ).not.toContain('layoutVersion: 2');
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'projects'))).toBe(false);
    // `--dry-run` is the documented spelling of the same default.
    const dryRun = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--dry-run', '--json'],
      { env, cwd: storeRoot }
    );
    expect(dryRun.exitCode).toBe(0);
    expect(parseJson(dryRun).applicable).toBe(true);
    expect(git('status', '--porcelain').trim()).toBe('');
  }, 120_000);

  it('renders the same item table in human and JSON output', async () => {
    // Task 9.4 names six components — states, reasons, destinations, other flat
    // refs, retained design docs, untracked-file warnings. Three of them were
    // absent from the fixture entirely, so "identical in content" was being
    // proved against names alone: a renderer that dropped the state column, or
    // rendered every item as `resolved`, kept this test green while the
    // operator's only pre-apply view of the blockers went quiet.
    write('rasen/design-docs/cross-cutting.md', '# cross-cutting\n');
    git('add', '-A');
    git('commit', '-m', 'add a Store-level design doc');
    git('branch', 'legacy-ref');
    fs.writeFileSync(
      path.join(storeRoot, 'rasen', 'changes', 'fix-a', 'scratch.md'),
      '# wip\n',
      'utf-8'
    );

    // `--include-untracked` is what lets the untracked file be reported as a
    // warning on an APPLICABLE plan rather than blocking the preview outright.
    const flags = ['--mapping', MAPPING, '--include-untracked'];
    const json = parseJson(
      await runCLI(['store', 'migrate-layout', STORE_ID, ...flags, '--json'], {
        env,
        cwd: storeRoot,
      })
    );
    const human = await runCLI(['store', 'migrate-layout', STORE_ID, ...flags], {
      env,
      cwd: storeRoot,
    });

    expect(human.exitCode).toBe(0);
    expect(json.items.length).toBeGreaterThan(0);
    for (const item of json.items as Array<{
      name: string;
      state: string;
      reason: string;
      repair: string;
      destination?: string;
      targetLine?: string;
      untracked?: string[];
    }>) {
      expect(human.stdout, `human output omits ${item.name}`).toContain(item.name);
      expect(human.stdout, `human output omits the state of ${item.name}`).toContain(
        `[${item.state}]`
      );
      expect(human.stdout, `human output omits the reason for ${item.name}`).toContain(
        item.reason
      );
      if (item.destination !== undefined) {
        expect(human.stdout, `human output omits the destination of ${item.name}`).toContain(
          item.destination
        );
      }
      if (item.targetLine !== undefined) {
        expect(human.stdout).toContain(item.targetLine);
      }
      for (const untracked of item.untracked ?? []) {
        expect(human.stdout, `human output omits the untracked file ${untracked}`).toContain(
          untracked
        );
      }
    }

    // The three components the old fixture never produced, now produced and
    // asserted in both renderings rather than assumed.
    expect(json.retainedDesignDocs.length).toBeGreaterThan(0);
    for (const doc of json.retainedDesignDocs as string[]) {
      expect(human.stdout).toContain(doc);
    }
    expect(json.otherFlatRefs.map((ref: { ref: string }) => ref.ref)).toContain(
      'refs/heads/legacy-ref'
    );
    for (const ref of json.otherFlatRefs as Array<{ ref: string }>) {
      expect(human.stdout).toContain(ref.ref);
    }
    expect(
      (json.items as Array<{ untracked?: string[] }>).some(
        (item) => (item.untracked ?? []).length > 0
      ),
      'the fixture produced no untracked warning to compare'
    ).toBe(true);

    expect(human.stdout).toContain(TARGET_LINE);
    expect(human.stdout).toContain(PROJECT_ID);
  }, 120_000);

  it('reports the no-plan continuation identically in human and JSON previews', async () => {
    write('rasen/changes/release-coordinator/proposal.md', '# coordinator\n');
    write(
      MAPPING,
      [
        'version: 2',
        `defaultTargetLine: ${TARGET_LINE}`,
        'targetLines:',
        `  ${TARGET_LINE}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${PROJECT_ID}:`,
        '        codeRef: refs/heads/main',
        'changes:',
        '  release-coordinator:',
        '    kind: store-issue',
        '    issueId: release-coordinator',
        '    title: Coordinate the release',
        '',
      ].join('\n')
    );
    git('add', '-A');
    git('commit', '-m', 'declare coordinator conversion');

    const json = parseJson(
      await runCLI(['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--json'], {
        env,
        cwd: storeRoot,
      })
    );
    const human = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING],
      { env, cwd: storeRoot }
    );
    const coordinator = json.items.find(
      (item: { name: string }) => item.name === 'release-coordinator'
    );
    expect(coordinator.continuation).toEqual({
      code: 'migration_issue_plan_absent',
      message: 'no plan supplied; no nodes invented',
      command:
        `rasen store issue plan release-coordinator --store ${STORE_ID} --from-file <path>`,
    });
    expect(human.stdout).toContain('migration_issue_plan_absent');
    expect(human.stdout).toContain(coordinator.continuation.message);
    expect(human.stdout).toContain(coordinator.continuation.command);
  }, 180_000);

  it('refuses to apply an unresolved plan, exits non-zero, and lists the blocker', async () => {
    write('rasen/changes/mystery-change/proposal.md', '# mystery\n');
    git('add', '-A');
    git('commit', '-m', 'add an unattributable change');

    const json = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--apply', '--json'],
      { env, cwd: storeRoot }
    );
    expect(json.exitCode).toBe(1);
    // `--apply` on a plan that cannot be applied refuses with a NAMED reason
    // instead of reprinting the preview. Reprinting it was the defect: it
    // announced readiness the token could not back, then exited 1 with no
    // code, no message and no fix anywhere in the output. The structured
    // per-item blocker list stays on the preview path (no `--apply`), which
    // the item-table tests above cover; this path owes the operator a reason.
    const payload = parseJson(json);
    expect(payload.status).toHaveLength(1);
    const diagnostic = payload.status[0];
    expect(diagnostic.code).toBe('migration_plan_blocked');
    // The blocked item is still named, with its state, its reason and the
    // repair that actually works -- the point of the original assertion.
    expect(diagnostic.message).toContain('mystery-change');
    expect(diagnostic.message).toContain('unresolved:unknown-owner');
    expect(diagnostic.message).toContain('changes.mystery-change.project');
    expect(diagnostic.fix).toContain('no --force');

    const human = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--apply'],
      { env, cwd: storeRoot }
    );
    expect(human.exitCode).toBe(1);
    const humanOut = `${human.stdout}${human.stderr}`;
    expect(humanOut).toContain('mystery-change');
    expect(humanOut).toContain('migration_plan_blocked');
    expect(humanOut).toContain('changes.mystery-change.project');
    expect(humanOut).toContain('no --force');
    // The preview is not reprinted on the refusal path.
    expect(humanOut).not.toContain('Ready to apply');

    // Nothing was published, and the Store is still flat.
    expect(git('status', '--porcelain').trim()).toBe('');
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'projects'))).toBe(false);
  }, 120_000);

  it('prints one commit suggestion for the publication and another for the retirement, and commits nothing', async () => {
    const commitsBefore = git('rev-list', '--count', 'HEAD').trim();

    const applied = parseJson(
      await runCLI(
        ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--apply', '--json'],
        { env, cwd: storeRoot }
      )
    );
    expect(applied.phase).toBe('published');
    expect(applied.suggestedCommits).toHaveLength(1);
    expect(applied.suggestedCommits[0].message).toContain('migrate');
    expect(applied.suggestedCommits[0].pathspecs).toEqual(['rasen', '.rasen-store']);

    const retired = parseJson(
      await runCLI(['store', 'migrate-layout', STORE_ID, '--retire-flat', '--json'], {
        env,
        cwd: storeRoot,
      })
    );
    expect(retired.phase).toBe('retired');
    expect(retired.suggestedCommits).toHaveLength(1);
    expect(retired.suggestedCommits[0].message).toContain('retire');

    // Two SUGGESTIONS, zero commits: the command stages, commits, fetches and
    // pushes nothing.
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe(commitsBefore);
    expect(git('status', '--porcelain').trim()).not.toBe('');
  }, 180_000);

  it('reports run state through --status without changing it', async () => {
    const before = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--status', '--json'],
      { env, cwd: storeRoot }
    );
    expect(before.exitCode).toBe(0);
    expect(parseJson(before).publicationComplete).toBe(false);

    await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--apply', '--json'],
      { env, cwd: storeRoot }
    );

    const after = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--status', '--json'],
      { env, cwd: storeRoot }
    );
    expect(after.exitCode).toBe(0);
    const status = parseJson(after);
    expect(status.phase).toBe('published');
    expect(status.publicationComplete).toBe(true);
    expect(status.receiptPath).toContain('receipts');
  }, 180_000);

  it('refuses --retire-flat before a publication rather than deleting the flat tree', async () => {
    const retired = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--retire-flat', '--json'],
      { env, cwd: storeRoot }
    );

    expect(retired.exitCode).toBe(1);
    expect(parseJson(retired).status[0].code).toBe('migration_run_missing');
    const human = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--retire-flat'],
      { env, cwd: storeRoot }
    );
    expect(`${human.stdout}${human.stderr}`).toContain('migration_run_missing');
    expect(fs.existsSync(path.join(storeRoot, 'rasen', 'specs', 'billing'))).toBe(true);
  }, 120_000);

  it('refuses a mapping file outside the Store worktree', async () => {
    const outside = path.join(tempDir, 'mapping.yaml');
    fs.writeFileSync(outside, 'version: 1\n', 'utf-8');

    const result = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', outside, '--json'],
      { env, cwd: storeRoot }
    );

    expect(result.exitCode).toBe(1);
    expect(parseJson(result).status[0].code).toBe('migration_mapping_outside_store');
    const human = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', outside],
      { env, cwd: storeRoot }
    );
    expect(`${human.stdout}${human.stderr}`).toContain('migration_mapping_outside_store');
  }, 120_000);

  it('refuses to run from outside the Store worktree', async () => {
    const elsewhere = path.join(tempDir, 'elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });

    const result = await runCLI(
      ['store', 'migrate-layout', STORE_ID, '--mapping', MAPPING, '--json'],
      { env, cwd: elsewhere }
    );

    expect(result.exitCode).toBe(1);
    expect(parseJson(result).status[0].code).toBe('migration_not_checked_out');
  }, 120_000);
});
