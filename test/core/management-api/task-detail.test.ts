import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { handleTaskDetail } from '../../../src/core/management-api/task-detail.js';

const PROPOSAL = '# Proposal\n\n## Why\n\nBecause.\n\n## What Changes\n\n- Thing.\n';

function writeChange(root: string, name: string, files: Record<string, string>): void {
  const dir = path.join(root, 'rasen', 'changes', name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(dir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function writeArchived(root: string, datedName: string, files: Record<string, string>): void {
  const dir = path.join(root, 'rasen', 'changes', 'archive', datedName);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

describe('management-api task-detail handler (design D1)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-task-detail-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-task-detail-proj-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes', 'archive'), { recursive: true });
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

  it('errors project_required when no root resolves', async () => {
    const result = await handleTaskDetail(undefined, null, 'anything');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('project_required');
    }
  });

  it('rejects a junk id with 400 invalid_input', async () => {
    const result = await handleTaskDetail(projectRoot, null, 'Not Valid Id');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('invalid_input');
    }
  });

  it('404s an id that names no active, archived, or portfolio Task', async () => {
    writeChange(projectRoot, 'something-else', { 'proposal.md': PROPOSAL });
    const result = await handleTaskDetail(projectRoot, null, 'ghost-task');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.code).toBe('task_not_found');
    }
  });

  it('resolves a bare change as a single-item Task with its checklist items', async () => {
    writeChange(projectRoot, 'fix-login', {
      'proposal.md': PROPOSAL,
      'tasks.md': '- [x] 1.1 Reproduce\n- [ ] 1.2 Patch\n',
    });

    const result = await handleTaskDetail(projectRoot, null, 'fix-login');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.task).toEqual({ id: 'fix-login', kind: 'single', label: 'fix-login' });
    expect(result.response.children).toHaveLength(1);
    const child = result.response.children[0]!;
    expect(child.name).toBe('fix-login');
    expect(child.archived).toBe(false);
    expect(child.taskProgress).toEqual({ total: 2, completed: 1 });
    expect(child.tasks).toEqual([
      { text: '1.1 Reproduce', done: true },
      { text: '1.2 Patch', done: false },
    ]);
    expect(child.summary).not.toBeNull();
    expect(child.dependsOn).toEqual([]);
  });

  it('assembles a portfolio roster of active and archived children with dependency hints', async () => {
    writeChange(projectRoot, 'redesign', {
      'planning-context.md': '# Planning\n',
      'portfolio-run.json': JSON.stringify({
        parent: 'redesign',
        children: [
          { id: 'redesign-api', pipeline: 'small-feature', dependsOn: [], status: 'in_progress' },
          { id: 'redesign-shell', pipeline: 'small-feature', dependsOn: ['redesign-api'], status: 'pending' },
        ],
      }),
    });
    writeChange(projectRoot, 'redesign-api', {
      'proposal.md': PROPOSAL,
      'tasks.md': '- [x] 1.1 A\n- [ ] 1.2 B\n',
    });
    writeChange(projectRoot, 'redesign-shell', { 'proposal.md': PROPOSAL });
    writeArchived(projectRoot, '2026-01-01-redesign-groundwork', {
      'proposal.md': PROPOSAL,
      'tasks.md': '- [x] 1.1 Done\n',
    });

    const result = await handleTaskDetail(projectRoot, null, 'redesign');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.response.task.kind).toBe('portfolio');
    const names = result.response.children.map((c) => c.name);
    // Active children first (in getActiveChangeIds order), archived last.
    expect(names).toEqual(['redesign-api', 'redesign-shell', 'redesign-groundwork']);

    const api = result.response.children.find((c) => c.name === 'redesign-api')!;
    expect(api.archived).toBe(false);
    expect(api.summary).not.toBeNull();
    expect(api.taskProgress).toEqual({ total: 2, completed: 1 });
    expect(api.portfolioStatus).toBe('in_progress');

    const shell = result.response.children.find((c) => c.name === 'redesign-shell')!;
    expect(shell.dependsOn).toEqual(['redesign-api']);
    expect(shell.portfolioStatus).toBe('pending');

    const archived = result.response.children.find((c) => c.name === 'redesign-groundwork')!;
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).toBe('2026-01-01');
    expect(archived.summary).toBeNull();
    expect(archived.run).toBeNull();
    expect(archived.taskProgress).toEqual({ total: 1, completed: 1 });
  });

  it('degrades to empty dependency hints when no portfolio-run.json exists (no error)', async () => {
    writeChange(projectRoot, 'redesign', { 'planning-context.md': '# Planning\n' });
    writeChange(projectRoot, 'redesign-api', { 'proposal.md': PROPOSAL });

    const result = await handleTaskDetail(projectRoot, null, 'redesign');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.errors).toEqual([]);
    for (const child of result.response.children) {
      expect(child.dependsOn).toEqual([]);
      expect(child.portfolioStatus).toBeUndefined();
    }
  });

  it('reports a portfolio whose children are all archived', async () => {
    writeChange(projectRoot, 'redesign', { 'planning-context.md': '# Planning\n' });
    writeArchived(projectRoot, '2026-02-02-redesign-api', { 'proposal.md': PROPOSAL });

    const result = await handleTaskDetail(projectRoot, null, 'redesign');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.task.kind).toBe('portfolio');
    expect(result.response.children.map((c) => c.name)).toEqual(['redesign-api']);
    expect(result.response.children[0]!.archived).toBe(true);
  });

  it('prefers portfolio for a container carrying BOTH planning-context.md and proposal.md, including itself as a child', async () => {
    writeChange(projectRoot, 'redesign', {
      'planning-context.md': '# Planning\n',
      'proposal.md': PROPOSAL,
    });
    writeChange(projectRoot, 'redesign-api', { 'proposal.md': PROPOSAL });

    const result = await handleTaskDetail(projectRoot, null, 'redesign');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.task.kind).toBe('portfolio');
    // The self-named change is one of its own children (portfolioOf('redesign') === 'redesign').
    expect(result.response.children.map((c) => c.name).sort()).toEqual(['redesign', 'redesign-api']);
  });

  it('degrades an active child with an unresolvable schema into loadError + errors, still listing it', async () => {
    writeChange(projectRoot, 'redesign', { 'planning-context.md': '# Planning\n' });
    writeChange(projectRoot, 'redesign-api', { 'proposal.md': PROPOSAL });
    writeChange(projectRoot, 'redesign-broken', {
      'proposal.md': PROPOSAL,
      '.openspec.yaml': 'schema: does-not-exist\n',
    });

    const result = await handleTaskDetail(projectRoot, null, 'redesign');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const broken = result.response.children.find((c) => c.name === 'redesign-broken')!;
    expect(broken.summary).toBeNull();
    expect(broken.loadError).toContain('does-not-exist');
    expect(result.response.errors.map((e) => e.name)).toContain('redesign-broken');
  });

  it('creates no files (read-only red line)', async () => {
    writeChange(projectRoot, 'redesign', { 'planning-context.md': '# Planning\n' });
    writeChange(projectRoot, 'redesign-api', { 'proposal.md': PROPOSAL, 'tasks.md': '- [ ] 1.1 A\n' });

    const changesDir = path.join(projectRoot, 'rasen', 'changes');
    const snapshot = (dir: string): string[] =>
      fs.existsSync(dir)
        ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).map((d) => path.join(d.parentPath ?? d.path, d.name)).sort()
        : [];
    const before = snapshot(changesDir);

    await handleTaskDetail(projectRoot, null, 'redesign');

    expect(snapshot(changesDir)).toEqual(before);
  });
});
