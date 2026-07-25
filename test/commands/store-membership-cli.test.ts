import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir, registerStore } from '../../src/core/index.js';
import { readProjectConfig, updateProjectConfigKey } from '../../src/core/project-config.js';
import { upsertAdoptionEntry } from '../../src/core/store/migration.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { snapshotDirectory as snapshot } from '../helpers/fs-snapshot.js';
import { createOpenSpecRoot, writeSpec } from '../helpers/rasen-fixtures.js';

const PROJECT_A = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';

/** Every diagnostic code a payload's `status`-shaped arrays report. */
function codesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) codesIn(entry, found);
    return found;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.code === 'string' && typeof record.message === 'string') {
      found.add(record.code);
    }
    for (const nested of Object.values(record)) codesIn(nested, found);
  }
  return found;
}

describe('store membership CLI surface', () => {
  let tempDir: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;
  let storeRoot: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-membership-cli-'));
    env = {
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });

    storeRoot = path.join(tempDir, 'team-context');
    createOpenSpecRoot(storeRoot);
    await registerStore({ id: 'team-context', localPath: storeRoot, globalDataDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function parseJson(result: RunCLIResult): any {
    return JSON.parse(result.stdout);
  }

  function makeProject(name = 'my-app'): string {
    const root = path.join(tempDir, name);
    createOpenSpecRoot(root);
    writeSpec(root, 'billing', '## Purpose\n\np\n\n## Requirements\n\n- r\n');
    return root;
  }

  describe('add-project --set-primary', () => {
    it('reports the binding separately from the membership, in both modes', async () => {
      const projectRoot = makeProject();

      const jsonRun = await runCLI(
        ['store', 'add-project', projectRoot, '--to', 'team-context', '--set-primary', '--json'],
        { cwd: tempDir, env }
      );
      expect(jsonRun.exitCode, jsonRun.stdout || jsonRun.stderr).toBe(0);
      const payload = parseJson(jsonRun);
      expect(payload.planning_binding).toMatchObject({ requested: true, changed: true });
      expect(payload.membership.roles).toEqual({ planning: true, knowledge: true });

      const humanRoot = makeProject('human-app');
      const humanRun = await runCLI(
        ['store', 'add-project', humanRoot, '--to', 'team-context', '--set-primary'],
        { cwd: tempDir, env }
      );
      expect(humanRun.exitCode, humanRun.stdout || humanRun.stderr).toBe(0);
      // The two relations are named as two distinct things in human output too.
      expect(humanRun.stdout).toContain('Membership');
      expect(humanRun.stdout).toContain('Planning store: changed');
    });

    it('refuses a rebind identically in human and JSON, and leaves membership standing', async () => {
      const otherRoot = path.join(tempDir, 'other-store');
      createOpenSpecRoot(otherRoot);
      await registerStore({ id: 'other-store', localPath: otherRoot, globalDataDir });

      const projectRoot = makeProject();
      updateProjectConfigKey(projectRoot, 'store', 'other-store');

      const jsonRun = await runCLI(
        ['store', 'add-project', projectRoot, '--to', 'team-context', '--set-primary', '--json'],
        { cwd: tempDir, env }
      );
      expect(jsonRun.exitCode, jsonRun.stdout || jsonRun.stderr).toBe(0);
      const payload = parseJson(jsonRun);
      expect(payload.planning_binding).toMatchObject({
        refused: true,
        changed: false,
        bound_to: 'other-store',
        requested_store: 'team-context',
      });
      const refusal = (payload.status as Array<{ code: string; fix?: string }>).find(
        (entry) => entry.code === 'project_planning_binding_refused'
      );
      expect(refusal).toBeDefined();
      expect(refusal?.fix).toBe(payload.planning_binding.rebind_command);
      // The membership this invocation established is still in place.
      expect(payload.membership.project_id).toBeTruthy();
      expect(
        fs.existsSync(
          path.join(
            storeRoot,
            '.rasen-store',
            'projects',
            `${payload.membership.project_id}.yaml`
          )
        )
      ).toBe(true);

      const humanRoot = makeProject('human-app');
      updateProjectConfigKey(humanRoot, 'store', 'other-store');
      const humanRun = await runCLI(
        ['store', 'add-project', humanRoot, '--to', 'team-context', '--set-primary'],
        { cwd: tempDir, env }
      );
      expect(humanRun.exitCode, humanRun.stdout || humanRun.stderr).toBe(0);
      expect(humanRun.stdout).toContain('REFUSED');
      expect(humanRun.stdout).toContain('other-store');
      expect(humanRun.stdout).toContain('team-context');
      // The same rebind command both modes report.
      expect(humanRun.stdout).toContain(payload.planning_binding.rebind_command);
    });

    it('previews both repositories and writes nothing', async () => {
      const projectRoot = makeProject();
      const before = snapshot(tempDir);

      const result = await runCLI(
        ['store', 'add-project', projectRoot, '--to', 'team-context', '--dry-run', '--json'],
        { cwd: tempDir, env }
      );

      expect(result.exitCode, result.stdout || result.stderr).toBe(0);
      const payload = parseJson(result);
      expect(payload.dry_run).toBe(true);
      expect(payload.membership.store_writes.length).toBeGreaterThan(0);
      expect(snapshot(tempDir)).toEqual(before);
    });
  });

  describe('migrate-membership', () => {
    async function seedLegacy(): Promise<void> {
      await upsertAdoptionEntry(storeRoot, PROJECT_A, {
        specs: ['billing'],
        changes: [],
        sourcePath: path.join(tempDir, 'machine-a', 'legacy-app'),
        timestamp: '2026-07-25T10:00:00Z',
      });
    }

    it('previews without writing and names the recovery commands when it would delete', async () => {
      await seedLegacy();
      const before = snapshot(tempDir);

      const human = await runCLI(['store', 'migrate-membership', 'team-context'], {
        cwd: tempDir,
        env,
      });

      expect(human.exitCode, human.stdout || human.stderr).toBe(0);
      expect(human.stdout).toContain('Mode: preview');
      // The one non-reversible step says, in the output itself, that the file
      // stays recoverable — with the commands that recover it.
      expect(human.stdout).toContain('git log --oneline -- .rasen-store/adoptions.yaml');
      expect(human.stdout).toContain('git show <commit>:.rasen-store/adoptions.yaml');
      expect(snapshot(tempDir)).toEqual(before);
    });

    it('applies, removes the legacy file, and reports the same facts in JSON', async () => {
      await seedLegacy();

      const result = await runCLI(
        ['store', 'migrate-membership', 'team-context', '--apply', '--json'],
        { cwd: tempDir, env }
      );

      expect(result.exitCode, result.stdout || result.stderr).toBe(0);
      const payload = parseJson(result);
      expect(payload.applied).toBe(true);
      expect(payload.converted).toHaveLength(1);
      expect(payload.converted[0].project_id).toBe(PROJECT_A);
      expect(payload.legacy_manifest_removed).toBe(true);
      expect(fs.existsSync(path.join(storeRoot, '.rasen-store', 'adoptions.yaml'))).toBe(false);

      const written = fs.readFileSync(
        path.join(storeRoot, '.rasen-store', 'projects', `${PROJECT_A}.yaml`),
        'utf-8'
      );
      expect(written).not.toContain('sourcePath');
      expect(written).not.toContain('machine-a');
    });

    it('reports nothing left to convert on a second apply', async () => {
      await seedLegacy();
      await runCLI(['store', 'migrate-membership', 'team-context', '--apply', '--json'], {
        cwd: tempDir,
        env,
      });
      const before = snapshot(tempDir);

      const second = await runCLI(['store', 'migrate-membership', 'team-context', '--apply'], {
        cwd: tempDir,
        env,
      });

      expect(second.exitCode, second.stdout || second.stderr).toBe(0);
      expect(second.stdout).toContain('Nothing left to convert');
      expect(snapshot(tempDir)).toEqual(before);
    });
  });

  /**
   * The requirement is per-SURFACE, not per-provider: the provider computed
   * every one of these correctly while both doctors dropped the field they
   * live in, so a green provider-level suite proved nothing. Every test here
   * drives the finding through the CLI.
   */
  describe('doctor reports membership read-only, with human/JSON parity', () => {
    interface Finding {
      severity: string;
      code: string;
      message: string;
      fix?: string;
    }

    /** The membership findings a `--json` doctor payload reports. */
    function findings(payload: any): Finding[] {
      return payload.membership?.diagnostics ?? [];
    }

    /** Every finding's message AND repair reached the human output verbatim. */
    function expectHumanParity(human: string, reported: Finding[]): void {
      expect(reported.length).toBeGreaterThan(0);
      for (const finding of reported) {
        expect(human, finding.code).toContain(finding.code);
        expect(human, finding.code).toContain(finding.message);
        if (finding.fix) expect(human, finding.code).toContain(finding.fix);
      }
    }

    /**
     * Warm up first: resolving a root in a not-yet-registered project registers
     * it and stamps `lastSeen`. That self-heal predates this change and is not
     * membership diagnosis — running once first isolates what DIAGNOSING writes
     * from what first contact writes.
     */
    async function warmUp(projectRoot: string): Promise<void> {
      await runCLI(['doctor', '--json'], { cwd: projectRoot, env });
    }

    it('reports a missing record for the planning store as an error, in both modes', async () => {
      const projectRoot = makeProject();
      // The project plans in team-context, and team-context holds nothing at
      // all for it — no record, and no legacy reference either. (A Store that
      // still carries a legacy `project:` reference DOES know the project; it
      // reports the inference and names the migration instead, which is a
      // different finding with a different repair.)
      updateProjectConfigKey(projectRoot, 'projectId', PROJECT_A);
      updateProjectConfigKey(projectRoot, 'store', 'team-context');
      await warmUp(projectRoot);

      const jsonRun = await runCLI(['doctor', '--json'], { cwd: projectRoot, env });
      const humanRun = await runCLI(['doctor'], { cwd: projectRoot, env });

      const payload = parseJson(jsonRun);
      const missing = findings(payload).find((f) => f.code === 'store_project_record_missing');
      expect(missing, JSON.stringify(findings(payload))).toBeDefined();
      expect(missing?.severity).toBe('error');
      expect(missing?.message).toContain('team-context');
      expect(missing?.message).toContain(PROJECT_A);
      expect(missing?.fix).toContain('rasen store add-project');
      expectHumanParity(humanRun.stdout, findings(payload));
    });

    it('reports a missing project-side hint as a warning with no planning binding at all', async () => {
      const projectRoot = makeProject();
      // The exact half-written state design D6 leaves standing and calls
      // recoverable: the Store's authority record exists, the project's
      // locator does not, and the project plans nowhere. Nothing else in
      // doctor looks at a project without a planning declaration, so this is
      // the state that reported nothing at all.
      await runCLI(['store', 'add-project', projectRoot, '--to', 'team-context', '--json'], {
        cwd: tempDir,
        env,
      });
      updateProjectConfigKey(projectRoot, 'storeMemberships', undefined);
      expect(readProjectConfig(projectRoot)?.store).toBeUndefined();

      await warmUp(projectRoot);
      const beforeProject = snapshot(projectRoot);
      const beforeStore = snapshot(storeRoot);

      const jsonRun = await runCLI(['doctor', '--json'], { cwd: projectRoot, env });
      const humanRun = await runCLI(['doctor'], { cwd: projectRoot, env });

      const payload = parseJson(jsonRun);
      const locator = findings(payload).find(
        (f) => f.code === 'project_membership_locator_missing'
      );
      expect(locator, JSON.stringify(findings(payload))).toBeDefined();
      // The repair names the Store by identity, so it still works when two
      // Stores share a display name.
      expect(locator?.fix).toContain('rasen store add-project');
      expectHumanParity(humanRun.stdout, findings(payload));

      // The roster still reports the membership itself, from the record.
      expect(payload.membership.stores.length).toBeGreaterThan(0);
      expect(humanRun.stdout).toContain('Store membership');
      expect(humanRun.stdout).toContain('roster and eligibility only');

      // Diagnosis writes nothing: not in the project, not in the store.
      expect(snapshot(projectRoot)).toEqual(beforeProject);
      expect(snapshot(storeRoot)).toEqual(beforeStore);
    });

    it('reports an unverifiable hint distinctly from a present store missing the record', async () => {
      const projectRoot = makeProject();
      await runCLI(['store', 'add-project', projectRoot, '--to', 'team-context', '--json'], {
        cwd: tempDir,
        env,
      });
      // A second Store the project declares but this machine has never seen.
      updateProjectConfigKey(projectRoot, 'storeMemberships', [
        { uid: '9f1d2c3b-4a5e-4f60-8123-abcdef012345', id: 'absent-store' },
      ]);
      await warmUp(projectRoot);

      const jsonRun = await runCLI(['doctor', '--json'], { cwd: projectRoot, env });
      const humanRun = await runCLI(['doctor'], { cwd: projectRoot, env });

      const payload = parseJson(jsonRun);
      const reported = findings(payload);
      const unverified = reported.find((f) => f.code === 'project_membership_unverified');
      expect(unverified, JSON.stringify(reported)).toBeDefined();
      // Distinct from the present-but-recordless case, which is a different
      // code with a different repair.
      expect(unverified?.code).not.toBe('store_project_record_missing');
      expectHumanParity(humanRun.stdout, reported);

      // An unavailable Store is reported, never dropped.
      const absent = (payload.membership.stores as Array<any>).find(
        (store) => store.id === 'absent-store'
      );
      expect(absent?.unavailable).toBeTruthy();
    });

    it('reports the same membership findings from store doctor', async () => {
      const projectRoot = makeProject();
      await runCLI(['store', 'add-project', projectRoot, '--to', 'team-context', '--json'], {
        cwd: tempDir,
        env,
      });
      updateProjectConfigKey(projectRoot, 'storeMemberships', undefined);
      await warmUp(projectRoot);

      const beforeProject = snapshot(projectRoot);
      const beforeStore = snapshot(storeRoot);

      const doctorJson = parseJson(
        await runCLI(['doctor', '--json'], { cwd: projectRoot, env })
      );
      const storeJson = parseJson(
        await runCLI(['store', 'doctor', '--json'], { cwd: projectRoot, env })
      );
      const storeHuman = await runCLI(['store', 'doctor'], { cwd: projectRoot, env });

      // The two commands answer from one provider, so they cannot disagree on
      // which findings exist or on how to repair them.
      expect(findings(storeJson).map((f) => f.code)).toEqual(
        findings(doctorJson).map((f) => f.code)
      );
      expect(findings(storeJson).map((f) => f.fix)).toEqual(findings(doctorJson).map((f) => f.fix));
      expect(findings(storeJson).length).toBeGreaterThan(0);
      expectHumanParity(storeHuman.stdout, findings(storeJson));

      // `store doctor` diagnoses; it does not repair.
      expect(snapshot(projectRoot)).toEqual(beforeProject);
      expect(snapshot(storeRoot)).toEqual(beforeStore);
    });

    it('reports no membership finding twice', async () => {
      const projectRoot = makeProject();
      await runCLI(
        ['store', 'add-project', projectRoot, '--to', 'team-context', '--set-primary', '--json'],
        { cwd: tempDir, env }
      );
      updateProjectConfigKey(projectRoot, 'storeMemberships', undefined);
      await warmUp(projectRoot);

      const payload = parseJson(await runCLI(['doctor', '--json'], { cwd: projectRoot, env }));
      // With a planning binding declared, the drift section used to raise the
      // same membership findings the membership section now owns; reporting
      // both would make one state look like two.
      const driftCodes = (payload.migrationDrift as Array<{ code: string }>).map((d) => d.code);
      for (const finding of findings(payload)) {
        expect(driftCodes, finding.code).not.toContain(finding.code);
      }
      expect(codesIn(payload)).toContain('project_membership_locator_missing');
    });
  });
});
