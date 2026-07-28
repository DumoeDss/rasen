import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { handleRuns } from '../../../src/core/management-api/runs.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { getProjectRegistryPath } from '../../../src/core/project-registry.js';

const PROPOSAL_TEMPLATE = '# Proposal\n\n## Why\n\nBecause.\n\n## What Changes\n\n- Thing.\n';

function writeChange(projectRoot: string, name: string, files: Record<string, string> = {}): string {
  const changeDir = path.join(projectRoot, 'rasen', 'changes', name);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), PROPOSAL_TEMPLATE);
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(changeDir, rel), content);
  }
  return changeDir;
}

describe('management-api runs handler (design D5)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mgmt-runs-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mgmt-runs-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempConfigHome;
    process.env.XDG_DATA_HOME = tempConfigHome;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempConfigHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reports a valid auto-run.json with its pipeline and stages', async () => {
    writeChange(projectRoot, 'active-run', {
      'auto-run.json': JSON.stringify({
        pipeline: 'full-feature',
        stages: { propose: { status: 'done' }, design: { status: 'in_progress' } },
      }),
    });

    const result = await handleRuns(projectRoot);
    const entry = result.runs.find((r) => r.name === 'active-run');
    expect(entry?.kind).toBe('ok');
    if (entry?.kind !== 'ok') return;
    expect(entry.autoRun.kind).toBe('ok');
    if (entry.autoRun.kind === 'ok') {
      expect(entry.autoRun.state.pipeline).toBe('full-feature');
      expect(entry.autoRun.state.stages?.propose?.status).toBe('done');
    }
  });

  it('surfaces a corrupt auto-run.json as invalid with a reason, without failing the request', async () => {
    writeChange(projectRoot, 'corrupt-run', { 'auto-run.json': '{ not valid json' });

    const result = await handleRuns(projectRoot);
    const entry = result.runs.find((r) => r.name === 'corrupt-run');
    expect(entry?.kind).toBe('ok');
    if (entry?.kind !== 'ok') return;
    expect(entry.autoRun.kind).toBe('invalid');
    if (entry.autoRun.kind === 'invalid') {
      expect(entry.autoRun.reason).toBeTruthy();
    }
  });

  it('reports absent when no run-state files exist for a change', async () => {
    writeChange(projectRoot, 'no-run');

    const result = await handleRuns(projectRoot);
    const entry = result.runs.find((r) => r.name === 'no-run');
    expect(entry?.kind).toBe('ok');
    if (entry?.kind !== 'ok') return;
    expect(entry.autoRun).toEqual({ kind: 'absent' });
    expect(entry.portfolio).toEqual({ kind: 'absent' });
    expect(entry.goalRun).toEqual({ kind: 'absent' });
  });

  it('reads portfolio-run.json and goal-run.json from the resolved directory', async () => {
    writeChange(projectRoot, 'portfolio-run', {
      'portfolio-run.json': JSON.stringify({ parent: 'portfolio-run', children: [] }),
      'goal-run.json': JSON.stringify({ round: 2, lastScore: 0.9 }),
    });

    const result = await handleRuns(projectRoot);
    const entry = result.runs.find((r) => r.name === 'portfolio-run');
    expect(entry?.kind).toBe('ok');
    if (entry?.kind !== 'ok') return;
    expect(entry.portfolio.kind).toBe('ok');
    if (entry.portfolio.kind === 'ok') {
      expect(entry.portfolio.state.parent).toBe('portfolio-run');
    }
    expect(entry.goalRun.kind).toBe('ok');
    if (entry.goalRun.kind === 'ok') {
      expect(entry.goalRun.state.raw).toEqual({ round: 2, lastScore: 0.9 });
    }
  });

  it('falls back to the changeDir legacy location for an unregistered project (ensure:false -> null home) without minting identity', async () => {
    writeChange(projectRoot, 'legacy-run', {
      'auto-run.json': JSON.stringify({ pipeline: 'bug-fix', stages: {} }),
    });
    // projectRoot has a projectId in config.yaml? No — leave it entirely
    // unregistered (no projectId ensured, no registry entry) so
    // resolveProjectHome({ ensure: false }) returns null.

    const result = await handleRuns(projectRoot);
    const entry = result.runs.find((r) => r.name === 'legacy-run');
    expect(entry?.kind).toBe('ok');
    if (entry?.kind !== 'ok') return;
    expect(entry.autoRun.kind).toBe('ok');

    // No registry file should have been created as a side effect.
    expect(fs.existsSync(getProjectRegistryPath())).toBe(false);
  });

  it('resolves from the workDir when the project is registered and workDir holds the file', async () => {
    // ensure: true (default) mints identity + registers, exactly like a
    // normal `rasen` command would before this read-only probe ever runs.
    const home = await resolveProjectHome(projectRoot);
    writeChange(projectRoot, 'work-dir-run'); // no auto-run.json in changeDir

    const workDir = home!.workDir('work-dir-run');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'auto-run.json'),
      JSON.stringify({ pipeline: 'full-feature', stages: {} })
    );

    const result = await handleRuns(projectRoot);
    const entry = result.runs.find((r) => r.name === 'work-dir-run');
    expect(entry?.kind).toBe('ok');
    if (entry?.kind !== 'ok') return;
    expect(entry.autoRun.kind).toBe('ok');
    if (entry.autoRun.kind === 'ok') {
      expect(entry.autoRun.state.pipeline).toBe('full-feature');
    }
  });
});
