import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { runCLI } from '../helpers/run-cli.js';

const BUILTIN_NAMES = ['bug-fix', 'full-feature', 'small-feature'] as const;

describe('pipeline command', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-pipeline-command-tmp');
  const changesDir = path.join(testDir, 'openspec', 'changes');

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
      ]) {
        expect(Object.prototype.hasOwnProperty.call(stage, field)).toBe(true);
      }
      expect(stage.id).toBe('propose');
      expect(stage.skill).toBe('openspec-propose');
      expect(stage.gate).toBe(true);
      // build order length equals stage count
      expect(json.buildOrder.length).toBe(json.stages.length);
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
});
