import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { parsePipeline, PipelineValidationError } from '../../../src/core/pipeline-registry/pipeline.js';
import {
  preflightPreparedDefinitionExecution,
  validatePipelineForExecution,
} from '../../../src/core/pipeline-registry/execution-validation.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
  type PreparedDefinition,
} from '../../../src/core/pipeline-registry/definition.js';

// A real, always-enabled core skill (see builtins.ts) so the pre-existing
// skill-presence/enablement checks pass and these tests exercise only the
// runtime preflight added by this change.
const KNOWN_SKILL = 'rasen-propose';
const CLAUDE_HOST = { runtime: 'claude', source: 'claude-code' } as const;
const CODEX_HOST = { runtime: 'codex', source: 'codex-thread-id' } as const;
const UNKNOWN_HOST = { runtime: 'unknown', source: 'unknown' } as const;

function pipeline(yaml: string) {
  return parsePipeline(yaml);
}

function writePipeline(dir: string, name: string, content: string): void {
  const pipelineDir = path.join(dir, name);
  fs.mkdirSync(pipelineDir, { recursive: true });
  fs.writeFileSync(path.join(pipelineDir, 'pipeline.yaml'), content);
}

function prepareForExecution(source: unknown): PreparedDefinition {
  const result = EcpDefinitionModule.prepare(
    source,
    createCapabilityCatalogSnapshot([])
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('pipeline-registry prepared Definition launch guard', () => {
  it('keeps a valid v2 plan visible but refuses every launch path with the stable server reason', () => {
    const prepared = prepareForExecution({
      version: 2,
      id: 'not-yet-executable',
      sourceId: 'fixture:not-yet-executable',
      name: 'not-yet-executable',
      inputs: [],
      artifacts: [],
      outcomes: ['done'],
      declarations: [],
      root: {
        nodes: [{ id: 'finish', kind: 'Finish', outcome: 'done' }],
        connections: [],
      },
    });

    expect(prepared.capability).toEqual({
      definitionValid: true,
      planAvailable: true,
      executable: false,
      executionMode: 'unavailable',
      unavailableReason: 'ecp_v2_runtime_unavailable',
    });
    expect(() => preflightPreparedDefinitionExecution(prepared)).toThrow(
      expect.objectContaining({
        code: 'ecp_v2_runtime_unavailable',
      })
    );
  });

  it('returns only the explicit legacy execution selection for authored v1', () => {
    const prepared = prepareForExecution({
      version: 1,
      name: 'legacy-still-owned',
      stages: [{ id: 'apply', skill: KNOWN_SKILL }],
    });

    expect(prepared.capability).toEqual({
      definitionValid: true,
      planAvailable: true,
      executable: true,
      executionMode: 'legacy',
    });
    const selection = preflightPreparedDefinitionExecution(prepared);
    expect(selection).toEqual({
      mode: 'legacy',
      pipeline: prepared.authoredSource,
    });
    expect(selection).not.toHaveProperty('reconciler');
  });
});

describe('pipeline-registry/execution-validation runtime preflight', () => {
  // Project-local pipeline files only — the machine-root global config stays
  // on the vitest-global RASEN_HOME isolation net (vitest.setup.ts) so
  // resolvePipelineExecutionSkillSets() sees a clean, ff-free catalog rather
  // than a real developer machine's ~/.rasen config.
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(
      os.tmpdir(),
      `rasen-execution-validation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes a codex-required pipeline when the injected prober reports available', async () => {
    const p = pipeline(`
name: codex-stage
stages:
  - id: a
    skill: ${KNOWN_SKILL}
    runtime: codex
`);
    const probeCodex = vi.fn(() => true);
    await validatePipelineForExecution(p, undefined, { probeCodex, host: CLAUDE_HOST });
    expect(probeCodex).toHaveBeenCalledTimes(1);
  });

  it('fails before dispatch, naming both remedies, when codex is required but unavailable', async () => {
    const p = pipeline(`
name: codex-stage
stages:
  - id: a
    skill: ${KNOWN_SKILL}
    runtime: codex
`);
    const probeCodex = vi.fn(() => false);
    try {
      await validatePipelineForExecution(p, undefined, { probeCodex, host: CLAUDE_HOST });
      expect.fail('expected validatePipelineForExecution to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineValidationError);
      expect(error).toMatchObject({ code: 'pipeline_runtime_unavailable' });
      const message = (error as Error).message;
      expect(message).toMatch(/claude/);
      expect(message).toMatch(/install/i);
      expect(message).toMatch(/codex/i);
    }
  });

  it('covers a decompose child stage whose runtime resolves to codex', async () => {
    const projectRoot = path.join(tempDir, 'project');
    writePipeline(
      path.join(projectRoot, 'rasen', 'pipelines'),
      'codex-child',
      `
name: codex-child
stages:
  - id: only
    skill: ${KNOWN_SKILL}
    runtime: codex
`
    );

    const p = pipeline(`
name: decomposer
stages:
  - id: fanout
    kind: decompose
    childPipeline: codex-child
`);

    const probeCodex = vi.fn(() => false);
    await expect(
      validatePipelineForExecution(p, projectRoot, { probeCodex, host: CLAUDE_HOST })
    ).rejects.toThrow(PipelineValidationError);
    expect(probeCodex).toHaveBeenCalledTimes(1);
  });

  it('never probes a pure-default (non-codex) pipeline', async () => {
    const p = pipeline(`
name: pure-claude
stages:
  - id: a
    skill: ${KNOWN_SKILL}
  - id: b
    skill: ${KNOWN_SKILL}
    requires: [a]
`);
    const probeCodex = vi.fn(() => false);
    await validatePipelineForExecution(p, undefined, { probeCodex, host: CLAUDE_HOST });
    expect(probeCodex).not.toHaveBeenCalled();
  });

  it('probes at most once for a pipeline with several codex stages', async () => {
    const p = pipeline(`
name: several-codex
stages:
  - id: a
    skill: ${KNOWN_SKILL}
    runtime: codex
  - id: b
    skill: ${KNOWN_SKILL}
    runtime: codex
    requires: [a]
`);
    const probeCodex = vi.fn(() => true);
    await validatePipelineForExecution(p, undefined, { probeCodex, host: CLAUDE_HOST });
    expect(probeCodex).toHaveBeenCalledTimes(1);
  });

  it('defaults to the real probeCodexAvailability when no prober is injected', async () => {
    // No stage resolves to codex, so the default prober is never invoked and
    // this must not attempt to spawn a real codex process.
    const p = pipeline(`
name: no-codex
stages:
  - id: a
    skill: ${KNOWN_SKILL}
`);
    await validatePipelineForExecution(p, undefined, { host: CLAUDE_HOST });
  });

  it('does not probe the external CLI for Codex-native stages', async () => {
    const p = pipeline(`
name: codex-native
stages:
  - id: a
    skill: ${KNOWN_SKILL}
`);
    const probeCodex = vi.fn(() => false);
    await validatePipelineForExecution(p, undefined, {
      probeCodex,
      host: CODEX_HOST,
    });
    expect(probeCodex).not.toHaveBeenCalled();
  });

  it('rejects Codex-host to Claude-target before dispatch with a stable code', async () => {
    const p = pipeline(`
name: unsupported-route
stages:
  - id: a
    skill: ${KNOWN_SKILL}
    role: planner
    runtime: claude
`);
    const probeCodex = vi.fn(() => true);
    await expect(
      validatePipelineForExecution(p, undefined, { probeCodex, host: CODEX_HOST })
    ).rejects.toMatchObject({ code: 'pipeline_runtime_route_unsupported' });
    expect(probeCodex).not.toHaveBeenCalled();
  });

  it('keeps unknown-host compatibility and emits an actionable notice', async () => {
    const p = pipeline(`
name: unknown-host
stages:
  - id: a
    skill: ${KNOWN_SKILL}
`);
    const notices: unknown[] = [];
    await validatePipelineForExecution(p, undefined, {
      host: UNKNOWN_HOST,
      reporter: (notice) => notices.push(notice),
    });
    expect(notices).toContainEqual({
      kind: 'unknown-host-runtime',
      override: 'RASEN_AGENT_RUNTIME',
    });
  });

  it('validates persisted per-role runtime instances instead of ignoring configuration', async () => {
    const projectRoot = path.join(tempDir, 'configured-project');
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      [
        'schema: spec-driven',
        'pipelines:',
        '  configured-preflight:',
        '    runtimes:',
        '      planner: claude',
        '',
      ].join('\n')
    );
    const p = pipeline(`
name: configured-preflight
stages:
  - id: propose
    skill: ${KNOWN_SKILL}
    role: planner
`);
    await expect(
      validatePipelineForExecution(p, projectRoot, { host: CODEX_HOST })
    ).rejects.toMatchObject({ code: 'pipeline_runtime_route_unsupported' });
  });

  it('lets a run-local role override rescue a persisted unsupported route before rejection', async () => {
    const projectRoot = path.join(tempDir, 'run-local-rescue-project');
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      [
        'schema: spec-driven',
        'pipelines:',
        '  run-local-rescue:',
        '    runtimes:',
        '      planner: claude',
        '',
      ].join('\n')
    );
    const p = pipeline(`
name: run-local-rescue
stages:
  - id: propose
    skill: ${KNOWN_SKILL}
    role: planner
`);
    const probeCodex = vi.fn(() => false);

    await validatePipelineForExecution(p, projectRoot, {
      host: CODEX_HOST,
      roleRuntimeOverrides: { planner: 'codex' },
      probeCodex,
    });

    expect(probeCodex).not.toHaveBeenCalled();
  });
});

describe('pipeline-registry/execution-validation stale-id guard (review-routed addition)', () => {
  // A stored profile can list a retired workflow id (e.g. `ff`, removed by
  // remove-ff) that the catalog no longer recognizes.
  // resolveWorkflowSelection stays strict by design, so the boundary that
  // reads persisted config must pre-filter through filterKnownWorkflowRoots
  // (the same pattern update.ts/init.ts already use) rather than let a stale
  // id reach the strict resolver as an uncaught WorkflowSelectionError.
  //
  // This suite points RASEN_HOME at its own fresh temp directory per test
  // (never deleting it — the vitest-global isolation net in vitest.setup.ts
  // always keeps SOME isolated RASEN_HOME so the real developer ~/.rasen is
  // never read) so it can write a config.json containing an unknown id
  // without touching the real machine config.
  let tempHome: string;
  let originalRasenHome: string | undefined;

  beforeEach(() => {
    tempHome = path.join(
      os.tmpdir(),
      `rasen-execution-validation-stale-id-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempHome, { recursive: true });
    originalRasenHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = tempHome;
  });

  afterEach(() => {
    process.env.RASEN_HOME = originalRasenHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('warns and filters a stale workflow id from a stored profile instead of throwing', async () => {
    fs.writeFileSync(
      path.join(tempHome, 'config.json'),
      JSON.stringify({
        profile: 'custom',
        workflows: [KNOWN_SKILL.replace(/^rasen-/, ''), 'ff'],
      })
    );

    const p = pipeline(`
name: stale-id-guard
stages:
  - id: a
    skill: ${KNOWN_SKILL}
`);

    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await validatePipelineForExecution(p);
      const warned = logSpy.mock.calls.some(([line]) =>
        typeof line === 'string' && line.includes('ff')
      );
      expect(warned).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('pipeline-registry/execution-validation expert leniency preflight (review-round Major fix)', () => {
  // Post-6b, an expert can legitimately be part of the catalog but NOT part
  // of the resolved install set (a lean `core`/`custom` profile once
  // `expertSelectionExplicit` is true). Before this fix,
  // resolvePipelineExecutionSkillSets() unioned in every expert name
  // unconditionally, so a stage naming a not-installed expert passed
  // preflight cleanly and only failed later, at dispatch time, with a raw
  // skill-loading error instead of the clean `pipeline_skill_disabled`
  // message `validatePipelineSkills` exists to produce.
  let tempHome: string;
  let originalRasenHome: string | undefined;

  beforeEach(() => {
    tempHome = path.join(
      os.tmpdir(),
      `rasen-execution-validation-expert-leniency-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempHome, { recursive: true });
    originalRasenHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = tempHome;
  });

  afterEach(() => {
    process.env.RASEN_HOME = originalRasenHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('a lean, explicit profile without an expert fails preflight cleanly for a stage naming it', async () => {
    fs.writeFileSync(
      path.join(tempHome, 'config.json'),
      JSON.stringify({
        profile: 'custom',
        workflows: [KNOWN_SKILL.replace(/^rasen-/, ''), 'review'],
        expertSelectionExplicit: true,
      })
    );

    const p = pipeline(`
name: lean-profile-codex
stages:
  - id: a
    skill: rasen-codex
`);

    try {
      await validatePipelineForExecution(p);
      expect.fail('expected validatePipelineForExecution to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineValidationError);
      expect(error).toMatchObject({ code: 'pipeline_skill_disabled' });
    }
  });

  it('the same lean profile still enables an expert it explicitly selected', async () => {
    fs.writeFileSync(
      path.join(tempHome, 'config.json'),
      JSON.stringify({
        profile: 'custom',
        workflows: [KNOWN_SKILL.replace(/^rasen-/, ''), 'review'],
        expertSelectionExplicit: true,
      })
    );

    const p = pipeline(`
name: lean-profile-review
stages:
  - id: a
    skill: rasen-review
`);

    await validatePipelineForExecution(p);
  });

  it('a legacy machine (marker absent) keeps every expert enabled regardless of profile', async () => {
    fs.writeFileSync(
      path.join(tempHome, 'config.json'),
      JSON.stringify({
        profile: 'custom',
        workflows: [KNOWN_SKILL.replace(/^rasen-/, '')],
      })
    );

    const p = pipeline(`
name: legacy-codex
stages:
  - id: a
    skill: rasen-codex
`);

    await validatePipelineForExecution(p);
  });
});

describe('pipeline-registry/execution-validation per-project expert-selection ack (review-round 2 Major fix)', () => {
  // The global expertSelectionExplicit marker can flip to `true` from an
  // action against a completely different project (the Blocker fix in
  // update.ts/init.ts). Preflight must mirror that same per-project gate:
  // a project that has never been through its own acknowledgment must still
  // see every expert enabled, matching what `update` actually keeps
  // installed for it during the one-run delay window — otherwise preflight
  // produces a false-positive `pipeline_skill_disabled` for an expert that
  // is genuinely still on disk.
  let tempHome: string;
  let tempDataHome: string;
  let originalRasenHome: string | undefined;
  let originalXdgData: string | undefined;
  let projectRoot: string;

  beforeEach(() => {
    tempHome = path.join(
      os.tmpdir(),
      `rasen-execution-validation-ack-config-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempHome, { recursive: true });
    tempDataHome = path.join(
      os.tmpdir(),
      `rasen-execution-validation-ack-data-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(tempDataHome, { recursive: true });
    originalRasenHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = tempHome;
    originalXdgData = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = tempDataHome;

    projectRoot = path.join(
      os.tmpdir(),
      `rasen-execution-validation-ack-project-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    process.env.RASEN_HOME = originalRasenHome;
    process.env.XDG_DATA_HOME = originalXdgData;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempDataHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('the global marker true but no per-project acknowledgment for THIS project still enables every expert (false-positive fix)', async () => {
    // The global marker is true (as if flipped by an unrelated project's
    // fresh init), but this project (projectRoot) has never been registered
    // or acknowledged — resolveProjectHome(projectRoot, { ensure: false })
    // resolves to null, so the effective flag must fall back to "not
    // acknowledged," not the raw global marker.
    fs.writeFileSync(
      path.join(tempHome, 'config.json'),
      JSON.stringify({
        profile: 'custom',
        workflows: [KNOWN_SKILL.replace(/^rasen-/, ''), 'review'],
        expertSelectionExplicit: true,
      })
    );

    const p = pipeline(`
name: unacknowledged-project-codex
stages:
  - id: a
    skill: rasen-codex
`);

    // A stage naming a not-installed-by-profile expert must NOT fail
    // preflight for a project that was never itself acknowledged.
    await validatePipelineForExecution(p, projectRoot);
  });

  it('a project WITH its own acknowledgment still fails preflight for a not-installed expert', async () => {
    fs.writeFileSync(
      path.join(tempHome, 'config.json'),
      JSON.stringify({
        profile: 'custom',
        workflows: [KNOWN_SKILL.replace(/^rasen-/, ''), 'review'],
        expertSelectionExplicit: true,
      })
    );

    // resolveProjectHome's ensure:true path mints a projectId into an
    // EXISTING rasen/config.yaml (it never creates one) — write a minimal
    // one, mirroring what `rasen init` would have left behind.
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    const { resolveProjectHome } = await import('../../../src/core/project-home.js');
    const { writeExpertSelectionAck } = await import('../../../src/core/expert-selection-state.js');
    const home = await resolveProjectHome(projectRoot, { ensure: true });
    expect(home).not.toBeNull();
    writeExpertSelectionAck(home!.homeDir);

    const p = pipeline(`
name: acknowledged-project-codex
stages:
  - id: a
    skill: rasen-codex
`);

    try {
      await validatePipelineForExecution(p, projectRoot);
      expect.fail('expected validatePipelineForExecution to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PipelineValidationError);
      expect(error).toMatchObject({ code: 'pipeline_skill_disabled' });
    }
  });
});
