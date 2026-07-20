import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { handleChanges } from '../../../src/core/management-api/changes.js';

const PROPOSAL_TEMPLATE = '# Proposal\n\n## Why\n\nBecause.\n\n## What Changes\n\n- Thing.\n';

function writeChange(
  projectRoot: string,
  name: string,
  files: Record<string, string>
): void {
  const changeDir = path.join(projectRoot, 'rasen', 'changes', name);
  fs.mkdirSync(changeDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(changeDir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

describe('management-api changes handler (design D4)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mgmt-changes-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-mgmt-changes-proj-'));
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

  it('errors with project_required when no root resolves', async () => {
    const result = await handleChanges(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('project_required');
      expect(result.status).toBe(400);
    }
  });

  it('lists a change whose artifacts are all pending as not-complete with zero task progress', async () => {
    writeChange(projectRoot, 'wip-change', { 'proposal.md': PROPOSAL_TEMPLATE });

    const result = await handleChanges(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.changes).toHaveLength(1);
    const change = result.response.changes[0]!;
    expect(change.name).toBe('wip-change');
    expect(change.schemaName).toBe('spec-driven');
    expect(change.isComplete).toBe(false);
    expect(change.applyReady).toBe(false);
    expect(change.taskProgress).toEqual({ total: 0, completed: 0 });
    const proposalStatus = change.artifacts.find((a) => a.id === 'proposal');
    expect(proposalStatus?.status).toBe('done');
  });

  it('reports task progress from tasks.md checkboxes', async () => {
    writeChange(projectRoot, 'in-progress-change', {
      'proposal.md': PROPOSAL_TEMPLATE,
      'design.md': '# Design\n',
      'specs/foo/spec.md': '# foo\n\n## ADDED Requirements\n\n### Requirement: Foo\nFoo does a thing.\n\n#### Scenario: it works\n- **WHEN** x\n- **THEN** y\n',
      'tasks.md': '- [x] 1.1 Done thing\n- [ ] 1.2 Pending thing\n',
    });

    const result = await handleChanges(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const change = result.response.changes.find((c) => c.name === 'in-progress-change');
    expect(change).toBeDefined();
    expect(change!.taskProgress).toEqual({ total: 2, completed: 1 });
    // All artifacts (proposal/design/specs/tasks) are present, so artifact
    // completion is true — isComplete tracks artifacts, not task checkboxes.
    expect(change!.isComplete).toBe(true);
  });

  it('excludes archived changes from the listing', async () => {
    writeChange(projectRoot, 'active-change', { 'proposal.md': PROPOSAL_TEMPLATE });
    const archiveDir = path.join(projectRoot, 'rasen', 'changes', 'archive', '2026-01-01-archived-change');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, 'proposal.md'), PROPOSAL_TEMPLATE);

    const result = await handleChanges(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.changes.map((c) => c.name)).toEqual(['active-change']);
  });

  it('marks hasRunFiles true when auto-run.json exists in the change directory (legacy location)', async () => {
    writeChange(projectRoot, 'run-change', {
      'proposal.md': PROPOSAL_TEMPLATE,
      'auto-run.json': JSON.stringify({ pipeline: 'full-feature', stages: {} }),
    });

    const result = await handleChanges(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const change = result.response.changes.find((c) => c.name === 'run-change');
    expect(change!.hasRunFiles).toBe(true);
  });

  it('marks hasRunFiles false when no run-state files exist', async () => {
    writeChange(projectRoot, 'no-run-change', { 'proposal.md': PROPOSAL_TEMPLATE });

    const result = await handleChanges(projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const change = result.response.changes.find((c) => c.name === 'no-run-change');
    expect(change!.hasRunFiles).toBe(false);
  });
});
