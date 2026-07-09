import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { runCLI } from '../helpers/run-cli.js';

const BUILTIN_NAMES = ['bug-fix', 'full-feature', 'small-feature'] as const;

describe('pipeline command', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-pipeline-command-tmp');
  const changesDir = path.join(testDir, 'rasen', 'changes');

  beforeEach(async () => {
    await fs.mkdir(changesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('returns the built-in pipelines with source via --json', async () => {
      const result = await runCLI(['pipeline', 'list', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Array.isArray(json.pipelines)).toBe(true);

      const names = json.pipelines.map((p: any) => p.name);
      for (const name of BUILTIN_NAMES) {
        expect(names).toContain(name);
      }

      const bugFix = json.pipelines.find((p: any) => p.name === 'bug-fix');
      expect(bugFix).toBeDefined();
      expect(bugFix.source).toBe('package');
      expect(Array.isArray(bugFix.stages)).toBe(true);
      expect(bugFix.stages).toContain('propose');
      expect(typeof bugFix.description).toBe('string');
    });

    it('prints a human-readable table without --json', async () => {
      const result = await runCLI(['pipeline', 'list'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('bug-fix');
      expect(result.stdout).toContain('[package]');
    });
  });

  describe('show', () => {
    it('returns the DAG, buildOrder, and full stage fields via --json', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.name).toBe('bug-fix');
      expect(typeof json.description).toBe('string');
      expect(Array.isArray(json.buildOrder)).toBe(true);
      expect(json.buildOrder[0]).toBe('propose');

      // Every stage carries the full field set (defaults made explicit).
      const stage = json.stages[0];
      for (const field of [
        'id',
        'skill',
        'role',
        'requires',
        'gate',
        'loop',
        'parallelGroup',
        'condition',
        'leadReview',
        'verifyPolicy',
        'runtime',
        'runtimeSource',
        'sessionReuse',
        'sandbox',
        'model',
        'effort',
        'handoff',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(stage, field)).toBe(true);
      }
      // handoff is the fully-resolved config (built-in defaults when unset).
      expect(stage.handoff).toMatchObject({
        threshold: 0.5,
        maxRelays: 3,
        stallLimit: 2,
        source: 'default',
      });
      expect(stage.id).toBe('propose');
      expect(stage.skill).toBe('rasen-propose');
      expect(stage.gate).toBe(true);
      // build order length equals stage count
      expect(json.buildOrder.length).toBe(json.stages.length);
    });

    it('resolves role-level and stage-level Codex runtime choices via --json', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'codex-mix');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: codex-mix
agents:
  planner:
    runtime: codex
    sessionReuse: run-planner
    sandbox: workspace-write
  reviewer: claude
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: verify
    skill: rasen:review
    role: reviewer
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
    requires: [propose]
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'codex-mix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      const propose = json.stages.find((s: any) => s.id === 'propose');
      const verify = json.stages.find((s: any) => s.id === 'verify');

      expect(propose.runtime).toBe('codex');
      expect(propose.runtimeSource).toBe('agent');
      expect(propose.sessionReuse).toBe('run-planner');
      expect(propose.sandbox).toBe('workspace-write');
      expect(verify.runtime).toBe('codex');
      expect(verify.runtimeSource).toBe('stage');
      expect(verify.sessionReuse).toBe('review-thread');
      expect(verify.sandbox).toBe('read-only');
    });

    it('errors with available list on unknown name', async () => {
      const result = await runCLI(['pipeline', 'show', 'does-not-exist', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Pipeline 'does-not-exist' not found");
      expect(result.stderr).toContain('bug-fix');
    });

    it('surfaces a decompose stage with its kind and resolved childPipeline', async () => {
      const result = await runCLI(['pipeline', 'show', 'auto-decompose', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.buildOrder[0]).toBe('decompose');
      const dec = json.stages.find((s: any) => s.id === 'decompose');
      expect(dec.kind).toBe('decompose');
      expect(dec.childPipeline).toBe('small-feature');
      expect(dec.skill).toBeNull();
    });

    it('surfaces the resolved per-stage handoff config (stage > role > pipeline)', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'handoff-mix');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: handoff-mix
handoff:
  threshold: 0.4
  roles:
    reviewer: 0.65
  maxRelays: 4
  stallLimit: 3
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: review
    skill: rasen:review
    role: reviewer
    requires: [propose]
  - id: fix
    skill: rasen-apply-change
    role: fixer
    requires: [review]
    handoff:
      threshold: 0.8
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'handoff-mix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      const propose = json.stages.find((s: any) => s.id === 'propose');
      const review = json.stages.find((s: any) => s.id === 'review');
      const fix = json.stages.find((s: any) => s.id === 'fix');

      expect(propose.handoff).toMatchObject({ threshold: 0.4, maxRelays: 4, stallLimit: 3, source: 'pipeline' });
      expect(review.handoff).toMatchObject({ threshold: 0.65, source: 'role' });
      expect(fix.handoff).toMatchObject({ threshold: 0.8, maxRelays: 4, source: 'stage' });
    });

    it('surfaces the resolved reuse config at the top level (declared block)', async () => {
      const pipelineDir = path.join(testDir, 'rasen', 'pipelines', 'reuse-mix');
      await fs.mkdir(pipelineDir, { recursive: true });
      await fs.writeFile(
        path.join(pipelineDir, 'pipeline.yaml'),
        `
name: reuse-mix
reuse:
  planner: never
  threshold: 0.4
  roles:
    planner: 0.5
stages:
  - id: propose
    skill: rasen-propose
    role: planner
  - id: apply
    skill: rasen-apply-change
    role: implementer
    requires: [propose]
`,
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'show', 'reuse-mix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.reuse).toEqual({
        planner: 'never',
        implementer: 'auto',
        threshold: 0.4,
        roles: { planner: 0.5, implementer: 0.4 },
      });
    });

    it('surfaces the resolved reuse config as built-in defaults when no block is declared', async () => {
      const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.reuse).toEqual({
        planner: 'auto',
        implementer: 'auto',
        threshold: 0.25,
        roles: { planner: 0.25, implementer: 0.25 },
      });
    });

    // Goal-loop `pipeline show` human-readable rendering. goal-loop-core
    // generalized the meta line (pipeline.ts) to emit the goal-loop gate label,
    // but shipped no command test for the string. These assert the exact format.
    it('renders the goal-loop measure gate label in human-readable show', async () => {
      const result = await runCLI(['pipeline', 'show', 'goal-loop-measure'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      // The iterate stage meta line names the gate kind + both bounds.
      expect(result.stdout).toContain('loop=goal[measure](max 5, stall 2)');
      // And it must NOT degrade to the review-cycle label format.
      expect(result.stdout).not.toContain('loop=review-cycle');
    });

    it('renders the goal-loop evaluate gate label in human-readable show', async () => {
      const result = await runCLI(['pipeline', 'show', 'goal-loop-evaluate'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('loop=goal[evaluate](max 5, stall 2)');
      expect(result.stdout).not.toContain('loop=review-cycle');
    });

    // autopilot-gate-policy: define-goal's gate widened from true to 'vet'.
    // --json reports the exact string value; the human table surfaces it
    // distinctly as `gate(vet)` so an operator can tell it apart from an
    // ordinary skippable gate at a glance.
    it("reports define-goal gate as 'vet' in --json and renders gate(vet) in human-readable show", async () => {
      const jsonResult = await runCLI(['pipeline', 'show', 'goal-loop-measure', '--json'], {
        cwd: testDir,
      });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      const defineGoal = json.stages.find((s: any) => s.id === 'define-goal');
      expect(defineGoal.gate).toBe('vet');
      const ship = json.stages.find((s: any) => s.id === 'ship');
      expect(ship.gate).toBe(true);

      const humanResult = await runCLI(['pipeline', 'show', 'goal-loop-measure'], { cwd: testDir });
      expect(humanResult.exitCode).toBe(0);
      expect(humanResult.stdout).toContain('gate(vet)');
    });

    // Regression guard: the goal-loop generalization must not have changed the
    // review-cycle label on the existing built-in pipelines.
    it('still renders the review-cycle loop label for small-feature (no regression)', async () => {
      const result = await runCLI(['pipeline', 'show', 'small-feature'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('loop=review-cycle(max 3)');
      // The goal-loop bracket format must not appear on a review-cycle stage.
      expect(result.stdout).not.toContain('loop=goal[');
    });
  });

  describe('agents', () => {
    it('writes a project-local override and switches role runtimes', async () => {
      const result = await runCLI(
        ['pipeline', 'agents', 'small-feature', '--planner', 'codex', '--reviewer', 'codex', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.name).toBe('small-feature');
      expect(json.overridePath).toContain(path.join('rasen', 'pipelines', 'small-feature', 'pipeline.yaml'));
      expect(json.agents.planner).toBe('codex');
      expect(json.agents.reviewer).toBe('codex');
      expect(json.effectiveRoles.planner).toBe('codex');
      expect(json.effectiveRoles.implementer).toBe('claude');

      const overridePath = path.join(testDir, 'rasen', 'pipelines', 'small-feature', 'pipeline.yaml');
      await expect(fs.stat(overridePath)).resolves.toBeDefined();

      const show = await runCLI(['pipeline', 'show', 'small-feature', '--json'], { cwd: testDir });
      expect(show.exitCode).toBe(0);
      const shown = JSON.parse(show.stdout.trim());
      const propose = shown.stages.find((s: any) => s.id === 'propose');
      const verify = shown.stages.find((s: any) => s.id === 'verify');
      const apply = shown.stages.find((s: any) => s.id === 'apply');

      expect(propose.runtime).toBe('codex');
      expect(propose.runtimeSource).toBe('agent');
      expect(verify.runtime).toBe('codex');
      expect(verify.runtimeSource).toBe('agent');
      expect(apply.runtime).toBe('claude');
      expect(apply.runtimeSource).toBe('default');
    });

    it('prints current effective role runtimes when no updates are passed', async () => {
      const result = await runCLI(['pipeline', 'agents', 'bug-fix', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());

      expect(json.overridePath).toBeNull();
      expect(json.effectiveRoles).toEqual({
        planner: 'claude',
        implementer: 'claude',
        reviewer: 'claude',
        fixer: 'claude',
        shipper: 'claude',
      });
    });

    it('rejects invalid role runtime values', async () => {
      const result = await runCLI(['pipeline', 'agents', 'small-feature', '--planner', 'gemini', '--json'], {
        cwd: testDir,
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Invalid runtime 'gemini'");
    });
  });

  describe('classify', () => {
    it('maps bug-fix indicators', async () => {
      const result = await runCLI(
        ['pipeline', 'classify', 'fix the broken login crash', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('bug-fix');
      expect(json.matched).toContain('fix');
      expect(json.matched).toContain('broken');
      expect(json.matched).toContain('crash');
      expect(json.available).toContain('bug-fix');
    });

    it('maps full-feature indicators', async () => {
      const result = await runCLI(
        ['pipeline', 'classify', 'implement a new module for the subsystem', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('full-feature');
      expect(json.matched).toContain('implement');
      expect(json.matched).toContain('module');
    });

    it('defaults to small-feature with no matched indicators', async () => {
      const result = await runCLI(
        ['pipeline', 'classify', 'add a small toggle to the form', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('small-feature');
      expect(json.matched).toEqual([]);
    });

    it('prefers bug-fix over full-feature when both classes match', async () => {
      // "implement" (full) + "fix" (bug) — bug-fix takes precedence.
      const result = await runCLI(
        ['pipeline', 'classify', 'implement a fix for the module', '--json'],
        { cwd: testDir }
      );
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.suggested).toBe('bug-fix');
    });
  });

  describe('resume', () => {
    it('reports hasRunState:false when no auto-run.json exists', async () => {
      await fs.mkdir(path.join(changesDir, 'my-change'), { recursive: true });
      const result = await runCLI(['pipeline', 'resume', 'my-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.change).toBe('my-change');
      expect(json.hasRunState).toBe(false);
      expect(json.pipeline).toBeNull();
      expect(json.completed).toEqual([]);
      expect(json.next).toBeNull();
      expect(json.remaining).toEqual([]);
      expect(json.note).toContain('No run-state');
    });

    it('computes next/remaining from a synthesized auto-run.json', async () => {
      const changeDir = path.join(changesDir, 'wip-change');
      await fs.mkdir(changeDir, { recursive: true });
      // bug-fix build order: propose -> apply -> verify -> ship -> archive
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose', 'apply'] }, null, 2),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'wip-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.change).toBe('wip-change');
      expect(json.hasRunState).toBe(true);
      expect(json.pipeline).toBe('bug-fix');
      expect(json.completed).toEqual(['propose', 'apply']);
      expect(json.next).toBe('verify');
      expect(json.ready).toEqual(['verify']);
      expect(json.remaining).toEqual(['verify', 'ship', 'archive']);
    });

    // autopilot-gate-policy: resume reads the recorded gate policy so a
    // --no-gate run does not need to re-pass the flag on resume.
    it('surfaces the recorded gatePolicy in json and text output', async () => {
      const changeDir = path.join(changesDir, 'gated-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          gatePolicy: { effective: 'off', source: 'flag' },
          completed: ['propose'],
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'gated-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.gatePolicy).toEqual({ effective: 'off', source: 'flag' });

      const textResult = await runCLI(['pipeline', 'resume', 'gated-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Gate policy: off (flag)');
    });

    it('omits gatePolicy when the run-state predates this capability', async () => {
      const changeDir = path.join(changesDir, 'ungated-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose'] }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'ungated-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Object.prototype.hasOwnProperty.call(json, 'gatePolicy')).toBe(false);
    });

    it('surfaces per-stage warm-seed worker pointers (agentId/transcript)', async () => {
      const changeDir = path.join(changesDir, 'seeded-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          tier: 'A',
          stages: {
            propose: { status: 'done', worker: 'planner-1' }, // bare string → not warm-seedable
            apply: {
              status: 'done',
              worker: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'seeded-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.completed.sort()).toEqual(['apply', 'propose']);
      expect(json.next).toBe('verify');
      // Only the structured worker with a reusable pointer is surfaced.
      expect(json.workers).toEqual({
        apply: { role: 'implementer', agentId: 'imp-7', transcript: 'agent-imp-7.jsonl' },
      });
    });

    it('surfaces a reused worker\'s reusedFrom lineage and omits it when absent', async () => {
      const changeDir = path.join(changesDir, 'reused-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          tier: 'A',
          stages: {
            propose: {
              status: 'done',
              worker: { role: 'planner', agentId: 'plan-1', transcript: 'agent-plan-1.jsonl' },
            },
            apply: {
              status: 'done',
              worker: {
                role: 'implementer',
                agentId: 'imp-7',
                transcript: 'agent-imp-7.jsonl',
                reusedFrom: 'child-1',
              },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'reused-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.workers.apply.reusedFrom).toBe('child-1');
      // A worker without the marker does not gain a reusedFrom key.
      expect(Object.prototype.hasOwnProperty.call(json.workers.propose, 'reusedFrom')).toBe(false);
    });

    it('surfaces Codex threadId worker pointers for resume', async () => {
      const changeDir = path.join(changesDir, 'codex-thread-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            propose: {
              status: 'done',
              worker: {
                runtime: 'codex',
                role: 'planner',
                threadId: 'thread-propose-1',
                turnId: 'turn-1',
                sandbox: 'workspace-write',
              },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'codex-thread-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.workers).toEqual({
        propose: {
          runtime: 'codex',
          role: 'planner',
          threadId: 'thread-propose-1',
          turnId: 'turn-1',
          sandbox: 'workspace-write',
        },
      });
    });

    it('surfaces interrupted/escalated stages and open findings (P3)', async () => {
      const changeDir = path.join(changesDir, 'stalled-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'small-feature',
          stages: {
            propose: { status: 'done' },
            apply: { status: 'in_progress' },
            verify: { status: 'escalated' },
          },
          openFindings: [{ severity: 'major', summary: 'unhandled error path', stage: 'verify' }],
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'stalled-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.inProgressStages).toEqual(['apply']);
      expect(json.escalatedStages).toEqual(['verify']);
      expect(json.openFindings).toHaveLength(1);
      expect(json.openFindings[0].severity).toBe('major');
    });

    it('errors when the change does not exist', async () => {
      const result = await runCLI(['pipeline', 'resume', 'nope-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Change 'nope-change' not found");
    });

    it('surfaces sessionHandoff and per-stage latest handoff paths', async () => {
      const changeDir = path.join(changesDir, 'handoff-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          sessionHandoff: { path: 'handoff/lead-1.md', pct: 0.52, afterStage: 'apply' },
          stages: {
            propose: { status: 'done' },
            apply: {
              status: 'in_progress',
              handoffs: [
                { n: 1, path: 'handoff/implementer-1.md', reason: 'compaction' },
                { n: 2, path: 'handoff/implementer-2.md', reason: 'budget' },
              ],
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'handoff-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.sessionHandoff).toMatchObject({ path: 'handoff/lead-1.md', pct: 0.52, afterStage: 'apply' });
      // Latest handoff path per stage (highest n).
      expect(json.handoffs).toEqual({ apply: 'handoff/implementer-2.md' });
    });

    it('surfaces the sessionHandoff relay generation n in json and text output', async () => {
      const changeDir = path.join(changesDir, 'relay-gen-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          sessionHandoff: { path: 'handoff/lead-2.md', n: 2, pct: 0.55 },
          stages: { propose: { status: 'done' } },
        }),
        'utf-8'
      );

      const jsonResult = await runCLI(['pipeline', 'resume', 'relay-gen-change', '--json'], { cwd: testDir });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      expect(json.sessionHandoff).toMatchObject({ path: 'handoff/lead-2.md', n: 2 });

      const textResult = await runCLI(['pipeline', 'resume', 'relay-gen-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Session handoff (generation 2): handoff/lead-2.md');
    });

    it('reports generation 1 in text output when sessionHandoff has no n', async () => {
      const changeDir = path.join(changesDir, 'relay-gen1-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          sessionHandoff: { path: 'handoff/lead-1.md' },
          stages: { propose: { status: 'done' } },
        }),
        'utf-8'
      );

      const jsonResult = await runCLI(['pipeline', 'resume', 'relay-gen1-change', '--json'], { cwd: testDir });
      expect(jsonResult.exitCode).toBe(0);
      const json = JSON.parse(jsonResult.stdout.trim());
      expect(json.sessionHandoff.path).toBe('handoff/lead-1.md');
      expect(Object.prototype.hasOwnProperty.call(json.sessionHandoff, 'n')).toBe(false);

      const textResult = await runCLI(['pipeline', 'resume', 'relay-gen1-change'], { cwd: testDir });
      expect(textResult.exitCode).toBe(0);
      expect(textResult.stdout).toContain('Session handoff (generation 1): handoff/lead-1.md');
    });

    it('omits handoff keys entirely when a run recorded none', async () => {
      const changeDir = path.join(changesDir, 'no-handoff-change');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', completed: ['propose'] }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'no-handoff-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(Object.prototype.hasOwnProperty.call(json, 'sessionHandoff')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(json, 'handoffs')).toBe(false);
    });

    it('attaches a contextEstimate to a worker whose transcript is readable', async () => {
      const changeDir = path.join(changesDir, 'ctx-change');
      await fs.mkdir(changeDir, { recursive: true });
      // A real transcript on disk, referenced by absolute path from the worker.
      const transcriptPath = path.join(changeDir, 'agent-imp-7.jsonl');
      await fs.writeFile(
        transcriptPath,
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', model: 'claude-opus-4-8', usage: { input_tokens: 250000 } },
        }) + '\n',
        'utf-8'
      );
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({
          pipeline: 'bug-fix',
          stages: {
            apply: {
              status: 'done',
              worker: { role: 'implementer', agentId: 'imp-7', transcript: transcriptPath },
            },
            // A worker whose transcript does NOT exist → no contextEstimate, no failure.
            verify: {
              status: 'done',
              worker: { role: 'reviewer', agentId: 'rev-9', transcript: path.join(changeDir, 'missing.jsonl') },
            },
          },
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'ctx-change', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.workers.apply.contextEstimate).toEqual({
        contextTokens: 250000,
        limit: 1_000_000,
        pct: 0.25,
      });
      // Unreadable transcript: worker still present, estimate silently omitted.
      expect(json.workers.verify.agentId).toBe('rev-9');
      expect(json.workers.verify.contextEstimate).toBeUndefined();
    });

    it('resumes a decomposed parent from portfolio-run.json (frontier from the DAG)', async () => {
      const changeDir = path.join(changesDir, 'big-feature');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify(
          {
            parent: 'big-feature',
            children: [
              { id: 'big-feature-api', pipeline: 'small-feature', dependsOn: [], status: 'done' },
              { id: 'big-feature-ui', pipeline: 'full-feature', dependsOn: ['big-feature-api'], status: 'pending' },
              { id: 'big-feature-docs', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
            ],
          },
          null,
          2
        ),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'big-feature', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.isPortfolio).toBe(true);
      expect(json.complete).toBe(false);
      expect(json.completedChildren).toEqual(['big-feature-api']);
      // -ui unblocked (its prereq is done) and -docs is an independent root
      expect(json.runnableChildren).toEqual(['big-feature-docs', 'big-feature-ui']);
      expect(json.planner).toBeNull(); // no persistent planner recorded
    });

    it('surfaces interrupted and escalated children, not just the runnable frontier (P3)', async () => {
      const changeDir = path.join(changesDir, 'portfolio-mixed');
      await fs.mkdir(changeDir, { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'portfolio-run.json'),
        JSON.stringify({
          parent: 'portfolio-mixed',
          planner: { role: 'planner', agentId: 'plan-9', transcript: 'agent-plan-9.jsonl' },
          children: [
            { id: 'pm-a', pipeline: 'small-feature', dependsOn: [], status: 'done' },
            { id: 'pm-b', pipeline: 'small-feature', dependsOn: [], status: 'in_progress' },
            { id: 'pm-c', pipeline: 'small-feature', dependsOn: [], status: 'escalated' },
            { id: 'pm-d', pipeline: 'small-feature', dependsOn: [], status: 'pending' },
          ],
        }),
        'utf-8'
      );

      const result = await runCLI(['pipeline', 'resume', 'portfolio-mixed', '--json'], { cwd: testDir });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.runnableChildren).toEqual(['pm-d']); // only fresh pending + deps satisfied
      expect(json.interruptedChildren).toEqual(['pm-b']); // re-engage via warm-seed
      expect(json.escalatedChildren).toEqual(['pm-c']); // human attention
      // Run-level persistent planner pointer surfaced for warm-seed reuse.
      expect(json.planner).toEqual({ role: 'planner', agentId: 'plan-9', transcript: 'agent-plan-9.jsonl' });
    });
  });

  describe('resume with external work directory (design change-work-dir)', () => {
    function normalizePaths(str: string): string {
      return str.replace(/\\/g, '/');
    }

    /**
     * Mints machine identity for `testDir` (via the ensure surface,
     * `instructions`) and returns the resolved workDir for `changeName`.
     */
    async function mintWorkDir(changeName: string, globalDataDir: string): Promise<string> {
      await fs.writeFile(path.join(testDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      await fs.mkdir(path.join(changesDir, changeName), { recursive: true });
      await fs.writeFile(
        path.join(changesDir, changeName, 'proposal.md'),
        '## Why\nTest.\n\n## What Changes\n- test'
      );
      await runCLI(['instructions', 'proposal', '--change', changeName], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      const statusResult = await runCLI(['status', '--change', changeName, '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      const statusJson = JSON.parse(statusResult.stdout);
      expect(typeof statusJson.workDir).toBe('string');
      return statusJson.workDir as string;
    }

    it('resolves run-state from the work directory for a new-style change', async () => {
      const globalDataDir = path.join(testDir, 'global-data-new');
      const workDir = await mintWorkDir('new-style-change', globalDataDir);
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'new-style-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(normalizePaths(json.runStateDir)).toContain('new-style-change/work');
      expect(json.completed).toContain('propose');
    });

    it('falls back to legacy change-dir run-state when workDir has none, reporting runStateDir = change dir', async () => {
      const globalDataDir = path.join(testDir, 'global-data-legacy');
      await mintWorkDir('legacy-change', globalDataDir);
      const changeDir = path.join(changesDir, 'legacy-change');
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'legacy-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(normalizePaths(json.runStateDir)).toMatch(/legacy-change$/);
      expect(json.completed).toContain('propose');
    });

    it('prefers the work-dir copy when both workDir and changeDir have run-state', async () => {
      const globalDataDir = path.join(testDir, 'global-data-both');
      const workDir = await mintWorkDir('both-change', globalDataDir);
      const changeDir = path.join(changesDir, 'both-change');
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'auto-run.json'),
        JSON.stringify(
          { pipeline: 'bug-fix', stages: { propose: { status: 'done' }, implement: { status: 'done' } } },
          null,
          2
        )
      );
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'both-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(normalizePaths(json.runStateDir)).toContain('both-change/work');
      // Proves the workDir copy (2 stages done) won over the changeDir copy (1).
      expect(json.completed).toContain('implement');
    });

    it('portfolio-state resolution follows the same workDir-first/change-dir-fallback matrix', async () => {
      const globalDataDir = path.join(testDir, 'global-data-portfolio');
      const workDir = await mintWorkDir('portfolio-parent', globalDataDir);
      await fs.mkdir(workDir, { recursive: true });
      await fs.writeFile(
        path.join(workDir, 'portfolio-run.json'),
        JSON.stringify(
          {
            parent: 'portfolio-parent',
            children: [
              { id: 'child-a', pipeline: 'bug-fix', dependsOn: [], status: 'done' },
              { id: 'child-b', pipeline: 'bug-fix', dependsOn: ['child-a'], status: 'pending' },
            ],
          },
          null,
          2
        )
      );

      const result = await runCLI(['pipeline', 'resume', 'portfolio-parent', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.isPortfolio).toBe(true);
      expect(normalizePaths(json.runStateDir)).toContain('portfolio-parent/work');
      expect(json.runnableChildren).toEqual(['child-b']);
    });

    // Review finding F1: a corrupt machine-global registry.json must not
    // brick resume — it falls back to reading legacy run-state from the
    // change directory (workDir probe degrades to null, not a thrown error).
    it('falls back to legacy change-dir run-state (never throws) when registry.json is corrupt', async () => {
      const globalDataDir = path.join(testDir, 'global-data-corrupt-registry');
      await mintWorkDir('corrupt-registry-change', globalDataDir);
      const registryPath = path.join(globalDataDir, 'rasen', 'projects', 'registry.json');
      await fs.writeFile(registryPath, '{not valid json');

      const changeDir = path.join(changesDir, 'corrupt-registry-change');
      await fs.writeFile(
        path.join(changeDir, 'auto-run.json'),
        JSON.stringify({ pipeline: 'bug-fix', stages: { propose: { status: 'done' } } }, null, 2)
      );

      const result = await runCLI(['pipeline', 'resume', 'corrupt-registry-change', '--json'], {
        cwd: testDir,
        env: { XDG_DATA_HOME: globalDataDir },
      });
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.hasRunState).toBe(true);
      expect(normalizePaths(json.runStateDir)).toMatch(/corrupt-registry-change$/);
      expect(json.completed).toContain('propose');
    });
  });
});

// The pipeline command group resolves its root through the shared root-selection
// layer (parity with `validate --pipelines`): from a nested subdirectory it walks
// up to the nearest qualifying Rasen root rather than treating the cwd as root.
describe('pipeline command root selection (subdirectory)', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-pipeline-root-selection-tmp');
  const nestedDir = path.join(testDir, 'src', 'deeply', 'nested');
  const PROJECT_PIPELINE = 'proj-only-pipeline';

  beforeEach(async () => {
    // A planning shape (specs/ + changes/) makes testDir a qualifying root; a
    // bare openspec/pipelines/ dir alone does NOT qualify (see root-selection).
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
    const pipelineDir = path.join(testDir, 'rasen', 'pipelines', PROJECT_PIPELINE);
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, 'pipeline.yaml'),
      [
        `name: ${PROJECT_PIPELINE}`,
        'stages:',
        '  - id: propose',
        '    skill: rasen-propose',
        '    role: planner',
      ].join('\n'),
      'utf-8'
    );
    await fs.mkdir(nestedDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('resolves the ancestor root and lists the project pipeline from a subdirectory', async () => {
    const result = await runCLI(['pipeline', 'list', '--json'], { cwd: nestedDir });
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout.trim());
    const names = json.pipelines.map((p: any) => p.name);
    expect(names).toContain(PROJECT_PIPELINE);
    for (const name of BUILTIN_NAMES) {
      expect(names).toContain(name);
    }
    const proj = json.pipelines.find((p: any) => p.name === PROJECT_PIPELINE);
    expect(proj.source).toBe('project');
  });

  it('sees the same pipeline set as validate --pipelines from the same subdirectory', async () => {
    const listResult = await runCLI(['pipeline', 'list', '--json'], { cwd: nestedDir });
    expect(listResult.exitCode).toBe(0);
    const listNames = new Set<string>(
      JSON.parse(listResult.stdout.trim()).pipelines.map((p: any) => p.name)
    );

    const validateResult = await runCLI(['validate', '--pipelines', '--json'], { cwd: nestedDir });
    expect(validateResult.exitCode).toBe(0);
    const validateNames = new Set<string>(
      JSON.parse(validateResult.stdout.trim()).items
        .filter((i: any) => i.type === 'pipeline')
        .map((i: any) => i.id)
    );

    expect(listNames).toEqual(validateNames);
    expect(listNames.has(PROJECT_PIPELINE)).toBe(true);
  });
});
