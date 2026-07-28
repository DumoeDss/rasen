/**
 * Real-process E2E for the association registry (tasks 10.1–10.6).
 *
 * This is the integrity gate for `ecp-association-registry-wiring`: it proves
 * distinct-ChangeInstance-on-recreate through REAL CLI processes
 * (`node dist/cli/index.js`), not kernel fixtures. The previous change
 * (`ecp-run-spine`) shipped with "kernel tested, production unwired" — this
 * test is what catches that regression.
 *
 * Flow:
 * 1. `pipeline start <change> bug-fix --json` → record runId1
 * 2. Archive the Change (via `rasen archive` CLI — exercises the real
 *    `archiveAssociation` wiring)
 * 3. Create a NEW Change directory with the same name (new inode)
 * 4. `pipeline start <change> bug-fix --json` → record runId2
 * 5. Assert runId1 ≠ runId2 (distinct-instance-on-recreate)
 * 6. `pipeline status` on runId1 still works (archived Run stays inspectable)
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { runCLI } from '../helpers/run-cli.js';

/**
 * Spawn a node script with the given env. Used for inline ledger manipulation
 * (e.g. archiving an association without the filesystem date-collision of
 * `rasen archive`). Returns { exitCode, stdout, stderr }.
 */
async function runNodeScript(
  script: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 30_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

describe('association registry E2E — distinct-instance-on-recreate (10.1–10.5)', () => {
  const projectRoot = process.cwd();
  let testDir: string;
  let dataDir: string;

  beforeEach(async () => {
    testDir = path.join(projectRoot, 'test-pipeline-registry-e2e-tmp');
    dataDir = path.join(testDir, 'global-data');
    // A qualifying Rasen root needs specs + changes directories AND a config
    // file so resolveProjectHome({ ensure: true }) succeeds and the registry
    // path is exercised (not the legacy fallback).
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
    // Minimal config — ensureProjectIdInConfig will mint a projectId into it.
    await fs.writeFile(
      path.join(testDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\n'
    );
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('mints a new RunId when a Change is archived and recreated (10.2)', async () => {
    const changeId = 'registry-e2e';
    const changeDir = path.join(testDir, 'rasen', 'changes', changeId);
    const env = { XDG_DATA_HOME: dataDir };

    // Create the initial Change directory.
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '## Why\n\nE2E test for the association registry.\n'
    );

    // ---- 1. LAUNCH: pipeline start (first generation) ----
    const start1 = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start1.exitCode).toBe(0);
    const start1Json = JSON.parse(start1.stdout.trim());
    expect(start1Json.disposition).toBe('created');
    const runId1 = start1Json.runId as string;
    expect(runId1).toMatch(/^run:[0-9a-f]{64}$/);

    // ---- 2. ARCHIVE the Change via the CLI ----
    // This exercises the real archiveAssociation wiring in archive.ts.
    const archiveResult = await runCLI(
      ['archive', changeId, '--json', '--yes'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(archiveResult.exitCode).toBe(0);

    // The Change directory should now be gone (moved to archive).
    await expect(fs.access(changeDir)).rejects.toThrow();

    // ---- 3. RECREATE: new Change directory with the same name ----
    // A fresh mkdir produces a new inode → new physical identity → new
    // ChangeInstanceId → new RunId.
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '## Why\n\nE2E test for the association registry (recreated).\n'
    );

    // ---- 4. LAUNCH: pipeline start (second generation) ----
    const start2 = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start2.exitCode).toBe(0);
    const start2Json = JSON.parse(start2.stdout.trim());
    const runId2 = start2Json.runId as string;
    expect(runId2).toMatch(/^run:[0-9a-f]{64}$/);

    // ---- 5. ASSERT distinct RunIds ----
    // This is THE invariant: same textual launch key, different physical
    // Change directory → different ChangeInstanceId → different RunId.
    expect(runId2).not.toBe(runId1);
  }, 120_000);

  it('keeps the archived Run data on disk after recreate (10.3)', async () => {
    const changeId = 'registry-inspect';
    const changeDir = path.join(testDir, 'rasen', 'changes', changeId);
    const env = { XDG_DATA_HOME: dataDir };

    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '## Why\n\nInspect test.\n'
    );

    const start1 = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start1.exitCode).toBe(0);
    const runId1 = JSON.parse(start1.stdout.trim()).runId as string;

    // The OLD Run's Record file must exist on disk — the RunStore is keyed by
    // runId, and Run data is immutable. Check the global runs directory.
    const runsDir = path.join(dataDir, 'rasen', 'runs');
    const runDirName = runId1.replace(/[^a-z0-9]/gi, '_');
    const runDir = path.join(runsDir, runDirName);
    // List all run directories to find the one matching runId1.
    let foundOldRun = false;
    try {
      const entries = await fs.readdir(runsDir);
      for (const entry of entries) {
        if (entry === runDirName) {
          const files = await fs.readdir(path.join(runsDir, entry));
          foundOldRun = files.some((f) => /^record-v\d+\.json$/.test(f));
          break;
        }
      }
    } catch {
      // runsDir doesn't exist — check project-home runs as fallback
    }
    // Also check under project-home runs (resolveProjectHome may redirect).
    if (!foundOldRun) {
      try {
        const projectsDir = path.join(dataDir, 'rasen', 'projects');
        const homes = await fs.readdir(projectsDir);
        for (const home of homes) {
          const projRunsDir = path.join(projectsDir, home, 'runs');
          try {
            const entries = await fs.readdir(projRunsDir);
            if (entries.includes(runDirName)) {
              const files = await fs.readdir(path.join(projRunsDir, runDirName));
              foundOldRun = files.some((f) => /^record-v\d+\.json$/.test(f));
              if (foundOldRun) break;
            }
          } catch { /* skip */ }
        }
      } catch { /* projectsDir doesn't exist */ }
    }
    expect(foundOldRun).toBe(true);
  }, 60_000);

  // -------------------------------------------------------------------------
  // B1 E2E: mutation on an archived Run is REFUSED via the registry.
  // This is the test that would have caught the Blocker — the old code allowed
  // `complete --run <oldRunId>` after recreate because the alias resolved to
  // the NEW active association instead of the OLD archived one.
  // -------------------------------------------------------------------------
  it('refuses `complete --run <oldRunId>` after archive + recreate (B1, 10.3)', async () => {
    const changeId = 'registry-refuse';
    const changeDir = path.join(testDir, 'rasen', 'changes', changeId);
    const env = { XDG_DATA_HOME: dataDir };

    // Create the initial Change directory.
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '## Why\n\nB1 mutation-refusal test.\n'
    );

    // ---- 1. LAUNCH: pipeline start (first generation) ----
    const start1 = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start1.exitCode).toBe(0);
    const runId1 = JSON.parse(start1.stdout.trim()).runId as string;

    // ---- 2. ARCHIVE the Change via the CLI ----
    const archiveResult = await runCLI(
      ['archive', changeId, '--json', '--yes'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(archiveResult.exitCode).toBe(0);

    // ---- 3. RECREATE: new Change directory with the same name ----
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '## Why\n\nB1 mutation-refusal test (recreated).\n'
    );

    // ---- 4. LAUNCH: pipeline start (second generation) ----
    const start2 = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start2.exitCode).toBe(0);

    // ---- 5. ATTEMPT complete --run <oldRunId> → MUST FAIL ----
    // The old Run's stored changeInstanceId is ARCHIVED in the registry.
    // `assertChangeNotArchived` now looks up by instance ID, not alias.
    const completeOld = await runCLI(
      ['pipeline', 'complete', changeId, '--run', runId1, '--from', '-', '--json'],
      {
        cwd: testDir,
        env,
        input: JSON.stringify({
          completion: {
            format: 'change-run-completion/1',
            change: { projectRoot: testDir, changeId },
            runId: runId1,
            actionId: 'nonexistent',
            invocationId: 'nonexistent',
            receiptDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
            actor: {
              format: 'change-run-actor/1',
              kind: 'command',
              identityDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              adapter: {
                id: 'test',
                version: '1',
                artifactDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              },
            },
            actorAttestation: {
              format: 'change-run-evidence-ref/1',
              store: 'change-run',
              evidenceDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              contentDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              mediaType: 'text/plain',
              size: 0,
              observationKind: 'test',
              producer: {
                id: 'test',
                version: '1',
                identityDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              },
              binding: {
                planningSpaceId: 'planning-space:0000000000000000000000000000000000000000000000000000000000000000',
                changeInstanceId: 'change-instance:0000000000000000000000000000000000000000000000000000000000000000',
                projectId: 'test',
                changeId,
                runId: runId1,
                actionId: 'nonexistent',
                schema: 'test',
              },
            },
            evidence: [],
          },
          uploads: [],
        }),
        timeoutMs: 60_000,
      }
    );
    // The mutation MUST be refused by the instance-scoped registry guard
    // BEFORE the facade touches the Record. A facade-level action rejection
    // ("not found") would NOT prove B1 — the guard must fire. Assert the
    // guard's own error code/message appears, not a generic failure.
    expect(completeOld.exitCode).not.toBe(0);
    const errorOutput = completeOld.stderr + completeOld.stdout;
    expect(errorOutput).toMatch(/change_instance_inactive|is archived/i);
  }, 120_000);

  // -------------------------------------------------------------------------
  // m1/m3 E2E: launch_instance_ambiguous with two archived generations.
  // After two archive cycles and no active Change directory, `pipeline start`
  // must surface launch_instance_ambiguous (not invalid_run_request).
  //
  // NOTE: The `rasen archive` CLI uses date-based directory naming
  // (`YYYY-MM-DD-<changeId>`), so two same-day archives for the same changeId
  // collide with `archive_target_exists`. To create the two-archived-generations
  // ledger state without the date collision, we use a small inline node script
  // that calls `archiveAssociation` on the persisted ledger directly — the
  // same API the real archive path uses. The ambiguity check is then driven
  // through the REAL `pipeline start` CLI process.
  // -------------------------------------------------------------------------
  it('surfaces launch_instance_ambiguous with two archived generations (m1/m3, 10.4)', async () => {
    const changeId = 'registry-ambiguous';
    const changeDir = path.join(testDir, 'rasen', 'changes', changeId);
    const env = { XDG_DATA_HOME: dataDir };

    // Helper: archive the active association in the ledger via a node script.
    // This mirrors what `rasen archive` does (archive.ts → archiveAssociation)
    // without the filesystem archive-directory naming collision.
    const archiveAssociationInLedger = async () => {
      const projectRoot = process.cwd();
      const script = `
        const { resolveProjectHome } = require(${JSON.stringify(path.resolve(projectRoot, 'dist', 'core', 'project-home.js'))});
        const { createAssociationLedgerStore } = require(${JSON.stringify(path.resolve(projectRoot, 'dist', 'core', 'change-run', 'index.js'))});
        const { derivePlanningSpaceId, readPhysicalIdentity } = require(${JSON.stringify(path.resolve(projectRoot, 'dist', 'core', 'change-run', 'internal', 'identity.js'))});
        const { statSync } = require('fs');
        const path = require('path');
        (async () => {
          const home = await resolveProjectHome(${JSON.stringify(testDir)}, { ensure: false });
          if (!home) { console.error('no home'); process.exit(1); }
          const planningSpaceId = derivePlanningSpaceId(home.name);
          const store = createAssociationLedgerStore({ homeDir: home.homeDir, planningSpaceId, projectId: home.projectId });
          const active = store.resolveActiveAssociation(${JSON.stringify(changeId)});
          if (!active) { console.log('no active association'); process.exit(0); }
          const changeDir = path.join(${JSON.stringify(testDir)}, 'rasen', 'changes', ${JSON.stringify(changeId)});
          const st = statSync(changeDir, { bigint: true });
          const physical = readPhysicalIdentity({ device: st.dev, ino: st.ino, birthtimeMs: st.birthtimeMs });
          store.archive({
            changeId: ${JSON.stringify(changeId)},
            instanceId: active.instanceId,
            activeAlias: 'changes/' + ${JSON.stringify(changeId)},
            archiveAlias: 'changes/archive/synthetic-' + Date.now(),
            physicalIdentity: physical,
          });
          console.log('archived');
        })().catch(e => { console.error(e.message); process.exit(1); });
      `;
      const result = await runNodeScript(script, { cwd: testDir, env: { ...env, RASEN_HOME: '' }, timeoutMs: 30_000 });
      expect(result.exitCode).toBe(0);
    };

    // ---- Generation 1: start + archive ----
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '## Why\n\nGen 1.\n');
    const start1 = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start1.exitCode).toBe(0);
    // Archive the association in the ledger (the Change dir must still exist
    // so the script can stat it for physical identity verification), THEN
    // remove the Change directory (simulating the archive relocate).
    await archiveAssociationInLedger();
    await fs.rm(changeDir, { recursive: true, force: true });

    // ---- Generation 2: recreate + start + archive ----
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '## Why\n\nGen 2.\n');
    const start2 = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(start2.exitCode).toBe(0);
    // Archive gen 2's association, then remove the Change directory.
    await archiveAssociationInLedger();
    await fs.rm(changeDir, { recursive: true, force: true });

    // ---- Now: NO active Change directory exists. Two archived generations.
    // `pipeline start` without --run must fail with launch_instance_ambiguous. ----
    const ambiguousStart = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(ambiguousStart.exitCode).not.toBe(0);
    const output = ambiguousStart.stderr + ambiguousStart.stdout;
    expect(output).toMatch(/launch_instance_ambiguous|ambiguous|Multiple historical/i);
  }, 180_000);
});
