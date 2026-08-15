import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { runCLI } from '../helpers/run-cli.js';
import { createOpenSpecRoot, writeSpec } from '../helpers/rasen-fixtures.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

const JOURNEY_TIMEOUT_MS = 30_000;

/**
 * Capstone persona journeys (6.1). Journey 1 (fresh team) lives in
 * store-lifecycle.test.ts; journey 4 (cold-start agent) runs as a
 * headless dogfood outside vitest. These are journeys 2 and 3.
 */
describe('capstone persona journeys (6.1)', () => {
  let tempDir: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-capstone-'))
    );
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });
  });

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  it('journey 2 — layered flow: app-repo agent discovers, cites, designs locally', async () => {
    // Requirements live in a store.
    const storeRoot = path.join(tempDir, 'product-requirements');
    createOpenSpecRoot(storeRoot);
    writeSpec(
      storeRoot,
      'billing-rules',
      '## Purpose\n\nAll invoices are immutable after issue.\n'
    );
    await registerStore({
      id: 'product-requirements',
      localPath: storeRoot,
      globalDataDir,
    });

    // The app repo has its OWN root and declares the reference.
    const appRepo = path.join(tempDir, 'billing-service');
    createOpenSpecRoot(appRepo);
    fs.writeFileSync(
      path.join(appRepo, 'rasen', 'config.yaml'),
      'schema: spec-driven\nreferences:\n  - product-requirements\n'
    );

    // Discovery: the relationship comes from config, not insider
    // knowledge — instructions and context both surface it.
    const contextResult = await runCLI(['context', '--json'], { cwd: appRepo, env });
    expect(contextResult.exitCode).toBe(0);
    const member = JSON.parse(contextResult.stdout).members[0];
    expect(member).toEqual(
      expect.objectContaining({
        role: 'referenced_store',
        id: 'product-requirements',
        path: storeRoot,
        fetch: 'rasen show <spec-id> --type spec --store product-requirements',
      })
    );

    // Citation: the agent follows the fetch recipe verbatim.
    const fetch = member.fetch.replace('<spec-id>', 'billing-rules').split(' ').slice(1);
    const cited = await runCLI(fetch, { cwd: appRepo, env });
    expect(cited.exitCode).toBe(0);
    expect(cited.stdout).toContain('All invoices are immutable after issue.');

    // Low-level design lands in the app repo's own root, not the store.
    const created = await runCLI(
      ['new', 'change', 'implement-invoice-immutability', '--json'],
      { cwd: appRepo, env }
    );
    expect(created.exitCode).toBe(0);
    const changeDir = path.join(
      appRepo,
      'rasen',
      'changes',
      'implement-invoice-immutability'
    );
    expect(fs.existsSync(changeDir)).toBe(true);
    expect(
      fs.existsSync(path.join(storeRoot, 'rasen', 'changes', 'implement-invoice-immutability'))
    ).toBe(false);

    // The store stayed read-only context throughout.
    const storeChanges = fs.readdirSync(path.join(storeRoot, 'rasen', 'changes'));
    expect(storeChanges.filter((name) => name !== 'archive' && name !== '.gitkeep')).toEqual([]);
  }, JOURNEY_TIMEOUT_MS);

  /**
   * Journey 3, rewritten for task 10b.3 of `store-layout-v2-migration`.
   *
   * The premise is unchanged — a code repo with no local planning root drives
   * the whole lifecycle from its own directory — but a legacy flat Store now
   * refuses every planning write (`legacy_flat_store_requires_migration`), so
   * the journey MIGRATES the Store and then runs the lifecycle rather than
   * being converted into a refusal assertion. "Without --store" is now the
   * stronger claim it always meant to be: the pointer plus the recorded
   * planning binding supply Store, project AND target line, so not one
   * selector appears on any command below.
   *
   * The lifecycle stops at `finalization_outcome_required`: finalization has
   * landed (`store-finalization-outcomes-v2`) and its first gate is that a
   * Store v2 Change ends in exactly ONE explicitly declared outcome. The full
   * finalize-and-assert-the-record journey lives in
   * `test/commands/store-v2-finalization-journey.test.ts`.
   */
  it('journey 3 — externalized planning: pointer repo runs the lifecycle without --store', async () => {
    const storeId = 'team-planning';
    const projectId = 'api-server';
    const targetLine = 'line-main';
    const mappingFile = 'rasen/migration-mapping.yaml';
    const storeRoot = path.join(tempDir, 'team-planning');
    const gitEnv = { ...process.env, ...env, ...isolatedGitEnv(tempDir) };
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', ['-C', cwd, ...args], {
        env: gitEnv,
        encoding: 'utf-8',
        stdio: 'pipe',
        windowsHide: true,
      });
    const cliEnv = { ...env, ...isolatedGitEnv(tempDir) };

    // The team's existing flat Store, with one member project that owns its
    // planning content. Written directly because the product can no longer
    // produce it: creation and adoption both refuse a legacy flat Store.
    createOpenSpecRoot(storeRoot);
    execFileSync('git', ['init', '-b', 'main', storeRoot], {
      env: gitEnv,
      stdio: 'pipe',
      windowsHide: true,
    });
    const storeUid = randomUUID();
    write(
      path.join(storeRoot, '.rasen-store', 'store.yaml'),
      `version: 2\nuid: ${storeUid}\nid: ${storeId}\n`
    );
    write(
      path.join(storeRoot, '.rasen-store', 'projects', `${projectId}.yaml`),
      [
        'version: 1',
        `projectId: ${projectId}`,
        'roles:',
        '  planning: true',
        '  knowledge: true',
        'adoption:',
        '  specs:',
        '    - throttling',
        '  changes: []',
        "  adoptedAt: '2026-01-02T03:04:05.000Z'",
        '',
      ].join('\n')
    );
    writeSpec(storeRoot, 'throttling', '## Purpose\n\nThrottling is per API key.\n');
    write(
      path.join(storeRoot, mappingFile),
      [
        'version: 1',
        `defaultTargetLine: ${targetLine}`,
        'targetLines:',
        `  ${targetLine}:`,
        '    storeRef: refs/heads/main',
        '    projects:',
        `      ${projectId}:`,
        '        codeRef: refs/heads/main',
        '',
      ].join('\n')
    );
    git(storeRoot, 'add', '-A');
    git(storeRoot, 'commit', '-m', 'seed the legacy flat store');
    await registerStore({ id: storeId, localPath: storeRoot, globalDataDir });

    // Migrate, then retire the flat tree, then commit — the two-commit shape
    // `store migrate-layout` prints suggestions for.
    const applied = await runCLI(
      ['store', 'migrate-layout', storeId, '--mapping', mappingFile, '--apply', '--json'],
      { cwd: storeRoot, env: cliEnv }
    );
    expect(applied.exitCode, applied.stdout + applied.stderr).toBe(0);
    const retired = await runCLI(
      ['store', 'migrate-layout', storeId, '--retire-flat', '--json'],
      { cwd: storeRoot, env: cliEnv }
    );
    expect(retired.exitCode).toBe(0);
    git(storeRoot, 'add', '-A');
    git(storeRoot, 'commit', '-m', 'migrate planning to layout v2');

    // The planning line is a linked worktree of the Store; the integration
    // checkout stays read-only.
    const planningRoot = path.join(tempDir, 'team-planning-line');
    git(storeRoot, 'worktree', 'add', '-b', 'planning-line-main', planningRoot);
    const planningCheckout = fs.realpathSync.native(planningRoot);

    // The planning worktree's own marker. `store-planning-worktree-bindings`
    // requires BOTH halves of the pair to declare themselves: the old gate was
    // satisfied by `association?.planningRoot || marker?.planningRoot`, so an
    // execution checkout with a stale association and a planning worktree with
    // a stale marker were indistinguishable from a bound pair (design.md,
    // Context). The capability now states it directly — a mutation is
    // authorized only by a worktree "whose marker declares the resolved Store,
    // project, and target line" — and the proposal records it as a deliberate
    // behavior tightening, under which "a healthy hand-assembled pair keeps
    // working". This fixture assembles the healthy pair by hand, which is what
    // it always meant to describe; it previously got away with half of one.
    write(
      path.join(planningCheckout, '.rasen', 'planning-line.json'),
      JSON.stringify(
        {
          version: 1,
          storeUid,
          storeId,
          projectId,
          targetLineId: targetLine,
          executionRoot: path.join(tempDir, 'api-server'),
        },
        null,
        2
      ) + '\n'
    );

    // A code repo with NO local planning root, only the declaration and the
    // binding its adoption recorded.
    const codeRepo = path.join(tempDir, 'api-server');
    write(
      path.join(codeRepo, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\nstore:\n  uid: ${storeUid}\n  id: ${storeId}\n`
    );
    write(
      path.join(codeRepo, '.rasen', 'planning-binding.json'),
      JSON.stringify(
        {
          version: 1,
          storeUid,
          storeId,
          projectId,
          targetLineId: targetLine,
          planningWorktree: planningCheckout,
          executionRoot: codeRepo,
        },
        null,
        2
      ) + '\n'
    );

    // The whole lifecycle from the code repo, zero selectors of any kind.
    const created = await runCLI(
      ['new', 'change', 'add-rate-limits', '--schema', 'spec-driven', '--json'],
      { cwd: codeRepo, env: cliEnv }
    );
    expect(created.exitCode, created.stdout + created.stderr).toBe(0);
    // Spelled out literally rather than read back from the payload: the
    // destination is the contract under test.
    const changeDir = path.join(
      planningCheckout,
      'rasen',
      'projects',
      projectId,
      'changes',
      'add-rate-limits'
    );
    expect(JSON.parse(created.stdout).change.path).toBe(changeDir);
    expect(fs.existsSync(changeDir)).toBe(true);
    // No root-level Store namespace was resurrected; retirement removed both.
    expect(fs.existsSync(path.join(planningCheckout, 'rasen', 'specs'))).toBe(false);
    expect(fs.existsSync(path.join(planningCheckout, 'rasen', 'changes'))).toBe(false);

    const status = await runCLI(['status', '--change', 'add-rate-limits', '--json'], {
      cwd: codeRepo,
      env: cliEnv,
    });
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).changeName).toBe('add-rate-limits');

    const instructions = await runCLI(
      ['instructions', 'proposal', '--change', 'add-rate-limits', '--json'],
      { cwd: codeRepo, env: cliEnv }
    );
    expect(instructions.exitCode).toBe(0);

    // Work the change: write every artifact the schema requires. The
    // instructions outputPath is change-relative (specs is a glob), so
    // resolve concretely under the change dir.
    const artifacts = JSON.parse(status.stdout).artifacts as Array<{ id: string }>;
    for (const artifact of artifacts) {
      const artifactStatus = await runCLI(
        ['instructions', artifact.id, '--change', 'add-rate-limits', '--json'],
        { cwd: codeRepo, env: cliEnv }
      );
      expect(artifactStatus.exitCode).toBe(0);
      const target =
        artifact.id === 'specs'
          ? path.join(changeDir, 'specs', 'api', 'spec.md')
          : path.join(changeDir, `${artifact.id}.md`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        artifact.id === 'specs'
          ? '## ADDED Requirements\n\n### Requirement: Rate limits\nThe API SHALL rate-limit.\n\n#### Scenario: Limit hit\n- **WHEN** the limit is exceeded\n- **THEN** requests are rejected\n'
          : `# ${artifact.id}\n\nDone.\n`
      );
    }

    // Everything written landed inside the project partition's change dir.
    const writtenArtifacts = fs.readdirSync(changeDir).sort();
    expect(writtenArtifacts).toEqual(['.openspec.yaml', 'design.md', 'proposal.md', 'specs', 'tasks.md']);

    const validated = await runCLI(['validate', 'add-rate-limits', '--json'], {
      cwd: codeRepo,
      env: cliEnv,
    });
    expect(validated.exitCode).toBe(0);
    expect(JSON.parse(validated.stdout).items[0]).toMatchObject({
      id: 'add-rate-limits',
      valid: true,
    });

    // The migrated canonical spec is readable from the same place, still
    // without a selector.
    const specs = await runCLI(['list', '--specs', '--json'], { cwd: codeRepo, env: cliEnv });
    expect(specs.exitCode).toBe(0);
    expect(JSON.parse(specs.stdout).specs.map((spec: { id: string }) => spec.id)).toContain(
      'throttling'
    );

    const archived = await runCLI(
      ['archive', 'add-rate-limits', '--yes', '--skip-specs', '--json'],
      { cwd: codeRepo, env: cliEnv }
    );
    expect(archived.exitCode).toBe(1);
    expect(JSON.parse(archived.stdout).status[0].code).toBe(
      'finalization_outcome_required'
    );
    expect(fs.existsSync(changeDir)).toBe(true);

    // The code repo never grew planning state.
    expect(fs.readdirSync(path.join(codeRepo, 'rasen'))).toEqual(['config.yaml']);
  }, 120_000);
});
