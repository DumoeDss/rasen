import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { parsePipeline, PipelineValidationError } from '../../../src/core/pipeline-registry/pipeline.js';
import { validatePipelineForExecution } from '../../../src/core/pipeline-registry/execution-validation.js';

// A real, always-enabled core skill (see builtins.ts) so the pre-existing
// skill-presence/enablement checks pass and these tests exercise only the
// runtime preflight added by this change.
const KNOWN_SKILL = 'rasen-propose';

function pipeline(yaml: string) {
  return parsePipeline(yaml);
}

function writePipeline(dir: string, name: string, content: string): void {
  const pipelineDir = path.join(dir, name);
  fs.mkdirSync(pipelineDir, { recursive: true });
  fs.writeFileSync(path.join(pipelineDir, 'pipeline.yaml'), content);
}

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

  it('passes a codex-required pipeline when the injected prober reports available', () => {
    const p = pipeline(`
name: codex-stage
stages:
  - id: a
    skill: ${KNOWN_SKILL}
    runtime: codex
`);
    const probeCodex = vi.fn(() => true);
    expect(() => validatePipelineForExecution(p, undefined, { probeCodex })).not.toThrow();
    expect(probeCodex).toHaveBeenCalledTimes(1);
  });

  it('fails before dispatch, naming both remedies, when codex is required but unavailable', () => {
    const p = pipeline(`
name: codex-stage
stages:
  - id: a
    skill: ${KNOWN_SKILL}
    runtime: codex
`);
    const probeCodex = vi.fn(() => false);
    try {
      validatePipelineForExecution(p, undefined, { probeCodex });
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

  it('covers a decompose child stage whose runtime resolves to codex', () => {
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
    expect(() =>
      validatePipelineForExecution(p, projectRoot, { probeCodex })
    ).toThrow(PipelineValidationError);
    expect(probeCodex).toHaveBeenCalledTimes(1);
  });

  it('never probes a pure-default (non-codex) pipeline', () => {
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
    expect(() => validatePipelineForExecution(p, undefined, { probeCodex })).not.toThrow();
    expect(probeCodex).not.toHaveBeenCalled();
  });

  it('probes at most once for a pipeline with several codex stages', () => {
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
    expect(() => validatePipelineForExecution(p, undefined, { probeCodex })).not.toThrow();
    expect(probeCodex).toHaveBeenCalledTimes(1);
  });

  it('defaults to the real probeCodexAvailability when no prober is injected', () => {
    // No stage resolves to codex, so the default prober is never invoked and
    // this must not attempt to spawn a real codex process.
    const p = pipeline(`
name: no-codex
stages:
  - id: a
    skill: ${KNOWN_SKILL}
`);
    expect(() => validatePipelineForExecution(p)).not.toThrow();
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

  it('warns and filters a stale workflow id from a stored profile instead of throwing', () => {
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

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(() => validatePipelineForExecution(p)).not.toThrow();
      const warned = logSpy.mock.calls.some(([line]) =>
        typeof line === 'string' && line.includes('ff')
      );
      expect(warned).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
