/**
 * ECP-5 Section 1 — engine selection policy (delta spec `ecp-change-run-runtime`,
 * "Engine selection is explicit, defaulted, and reversible").
 *
 * These are REAL fresh-process CLI runs against the built `dist/`, not kernel
 * fixtures. The whole point of D1 is that the policy is enforced in the CLI
 * rather than in prompt text: a prompt can be asked to honor config but cannot
 * be PROVEN to, and `pipeline start` is the only door that creates canonical
 * Runs. A kernel-level test of the resolver would prove nothing about that door
 * — this portfolio has already paid for "kernel green, production path broken"
 * five times.
 *
 * `resolveRunsEnginePolicy`'s precedence is additionally unit-tested at the
 * bottom, because the CLI can only exercise a few layers per process.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runCLI } from '../../helpers/run-cli.js';
import { resolveRunsEnginePolicy } from '../../../src/core/project-config.js';
import type { ProjectConfig } from '../../../src/core/project-config.js';

const BASE_CONFIG = 'schema: spec-driven\n';

/**
 * A v1 pipeline the reconciler cannot own: no review-loop, no parallel group,
 * and not the exact bug-fix shape, so `analyzeReconcilerSupport` reports
 * `unsupported_pipeline_shape` BEFORE any Run is created.
 */
const UNSUPPORTED_PIPELINE = `version: 1
name: engine-policy-unsupported
description: Two plain stages - not a shape the reconciler engine can own
stages:
  - id: propose
    skill: rasen-propose
    role: planner
    requires: []
  - id: apply
    skill: rasen-apply-change
    role: implementer
    requires: [propose]
`;

describe('ECP-5: engine selection policy (real CLI)', () => {
  const repoRoot = process.cwd();
  let testDir: string;
  let dataDir: string;
  let env: NodeJS.ProcessEnv;

  const changeId = 'engine-policy-change';
  const changeDir = () => path.join(testDir, 'rasen', 'changes', changeId);
  const configPath = () => path.join(testDir, 'rasen', 'config.yaml');

  /** Every canonical Run Record on disk under the isolated data home. */
  async function runRecordCount(): Promise<number> {
    const runsDir = path.join(dataDir, 'rasen', 'runs');
    try {
      const entries = await fs.readdir(runsDir, { recursive: true });
      return entries.filter((entry) =>
        String(entry).endsWith('.json')
      ).length;
    } catch {
      return 0;
    }
  }

  beforeEach(async () => {
    testDir = path.join(repoRoot, 'test-engine-policy-tmp');
    await fs.rm(testDir, { recursive: true, force: true });
    dataDir = path.join(testDir, 'global-data');
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
    await fs.writeFile(configPath(), BASE_CONFIG);
    await fs.mkdir(changeDir(), { recursive: true });
    await fs.writeFile(
      path.join(changeDir(), 'proposal.md'),
      '## Why\n\nEngine-selection policy E2E.\n'
    );
    env = { XDG_DATA_HOME: dataDir };
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('default `auto` selects the reconciler for a supported pipeline', async () => {
    const result = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.engine).toBe('reconciler');
    // The receipt names the deciding layer, not just the outcome.
    expect(payload.enginePolicy).toBe('auto');
    expect(payload.engineSource).toBe('default');
    expect(payload.disposition).toBe('created');
  }, 120_000);

  it('configured `legacy` refuses with engine_disabled_by_config and creates no Record', async () => {
    await fs.writeFile(configPath(), `${BASE_CONFIG}runs:\n  engine: legacy\n`);
    expect(await runRecordCount()).toBe(0);

    const result = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain('engine_disabled_by_config');
    // The refusal names the deciding configuration layer (spec: "an
    // `engine_disabled_by_config` error that names the deciding configuration
    // layer").
    expect(output).toContain('project');

    // "no canonical Run Record SHALL be created" — the off-switch must leave
    // nothing behind, which is why the refusal happens before the runtime is
    // resolved at all.
    expect(await runRecordCount()).toBe(0);
  }, 120_000);

  it('`--engine reconciler` overrides a configured `legacy`', async () => {
    await fs.writeFile(configPath(), `${BASE_CONFIG}runs:\n  engine: legacy\n`);

    const result = await runCLI(
      ['pipeline', 'start', changeId, 'bug-fix', '--engine', 'reconciler', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.engine).toBe('reconciler');
    expect(payload.enginePolicy).toBe('reconciler');
    // Attributed to the flag, not to the config it overrode.
    expect(payload.engineSource).toBe('flag');
  }, 120_000);

  it('forced `reconciler` on an unsupported pipeline fails with the support reason', async () => {
    // Project-local pipelines live at
    // <root>/rasen/pipelines/<name>/pipeline.yaml (see getProjectPipelinesDir).
    const pipelineDir = path.join(
      testDir,
      'rasen',
      'pipelines',
      'engine-policy-unsupported'
    );
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, 'pipeline.yaml'),
      UNSUPPORTED_PIPELINE
    );

    const result = await runCLI(
      [
        'pipeline',
        'start',
        changeId,
        'engine-policy-unsupported',
        '--engine',
        'reconciler',
        '--json',
      ],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    // The SUPPORT REASON, not a generic failure — no silent fallback to legacy
    // when the user asked for the engine by name.
    expect(output).toContain('unsupported_pipeline_shape');
    expect(output).toContain('reconciler (flag)');
    expect(await runRecordCount()).toBe(0);
  }, 120_000);

  it('leaves a legacy-run-state change on the legacy resume path under any policy', async () => {
    // A change with ONLY legacy run-state and `runs.engine: legacy` set: the
    // policy must not migrate, adopt, or block it — legacy recovery is
    // untouched by engine selection, which applies at LAUNCH only.
    await fs.writeFile(configPath(), `${BASE_CONFIG}runs:\n  engine: legacy\n`);
    await fs.writeFile(
      path.join(changeDir(), 'auto-run.json'),
      JSON.stringify(
        {
          pipeline: 'bug-fix',
          classification: 'bug-fix',
          tier: 'A',
          stages: { propose: { status: 'done' } },
        },
        null,
        2
      )
    );

    const result = await runCLI(
      ['pipeline', 'resume', changeId, '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.hasRunState).toBe(true);
    expect(payload.completed).toContain('propose');
  }, 120_000);

  it('reports the resolved policy on `pipeline show --json`', async () => {
    await fs.writeFile(configPath(), `${BASE_CONFIG}runs:\n  engine: legacy\n`);
    const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
      cwd: testDir,
      env,
      timeoutMs: 60_000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.enginePolicy).toMatchObject({
      configured: 'legacy',
      source: 'project',
      effectiveEngine: 'legacy',
    });
  }, 120_000);
});

describe('ECP-5: resolveRunsEnginePolicy precedence', () => {
  const withEngine = (engine: string | undefined): ProjectConfig =>
    ({ runs: engine === undefined ? {} : { engine } }) as ProjectConfig;

  it('resolves flag > project > store > global > default', () => {
    expect(
      resolveRunsEnginePolicy(
        withEngine('legacy'),
        'reconciler',
        { runs: { engine: 'legacy' } },
        withEngine('legacy')
      )
    ).toEqual({ effective: 'reconciler', source: 'flag' });

    expect(
      resolveRunsEnginePolicy(
        withEngine('reconciler'),
        undefined,
        { runs: { engine: 'legacy' } },
        withEngine('legacy')
      )
    ).toEqual({ effective: 'reconciler', source: 'project' });

    expect(
      resolveRunsEnginePolicy(
        withEngine(undefined),
        undefined,
        { runs: { engine: 'legacy' } },
        withEngine('reconciler')
      )
    ).toEqual({ effective: 'reconciler', source: 'store' });

    expect(
      resolveRunsEnginePolicy(
        withEngine(undefined),
        undefined,
        { runs: { engine: 'legacy' } },
        withEngine(undefined)
      )
    ).toEqual({ effective: 'legacy', source: 'global' });

    expect(resolveRunsEnginePolicy(null, undefined, null, null)).toEqual({
      effective: 'auto',
      source: 'default',
    });
  });

  it('rejects an unknown --engine value rather than silently defaulting', () => {
    expect(() =>
      resolveRunsEnginePolicy(null, 'turbo', null, null)
    ).toThrow(/Invalid --engine value "turbo"/);
  });

  it('falls through an invalid stored value instead of failing resolution', () => {
    // A hand-edited config must never brick engine resolution: an unusable
    // value at one layer falls to the next, exactly like `autopilot.gates`.
    expect(
      resolveRunsEnginePolicy(
        withEngine('turbo'),
        undefined,
        { runs: { engine: 'reconciler' } },
        null
      )
    ).toEqual({ effective: 'reconciler', source: 'global' });
  });
});
