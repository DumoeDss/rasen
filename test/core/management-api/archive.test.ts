import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { handleArchive } from '../../../src/core/management-api/archive.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';

const PROPOSAL = '# Proposal\n\n## Why\n\nBecause.\n\n## What Changes\n\n- Thing.\n';

function writeInRepoArchived(root: string, datedName: string, files: Record<string, string>): void {
  const dir = path.join(root, 'rasen', 'changes', 'archive', datedName);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

function writeContainer(root: string, name: string): void {
  const dir = path.join(root, 'rasen', 'changes', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'planning-context.md'), '# Planning\n');
}

describe('management-api archive handler (design D1/D2)', () => {
  let tempConfigHome: string;
  let projectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-archive-home-'));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-archive-proj-'));
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
    const result = await handleArchive(undefined, null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('project_required');
    }
  });

  it('lists archived changes with un-dated name, date, portfolio membership, and progress', async () => {
    writeContainer(projectRoot, 'redesign');
    writeInRepoArchived(projectRoot, '2026-01-01-redesign-api', {
      'proposal.md': PROPOSAL,
      'tasks.md': '- [x] 1.1 A\n- [ ] 1.2 B\n',
    });
    writeInRepoArchived(projectRoot, '2026-02-02-fix-login', {
      'proposal.md': PROPOSAL,
      'tasks.md': '- [x] 1.1 Done\n',
    });

    const result = await handleArchive(projectRoot, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byName = new Map(result.response.changes.map((c) => [c.name, c]));
    const api = byName.get('redesign-api')!;
    expect(api.archivedAt).toBe('2026-01-01');
    expect(api.portfolio).toBe('redesign');
    expect(api.taskProgress).toEqual({ total: 2, completed: 1 });

    const fix = byName.get('fix-login')!;
    expect(fix.archivedAt).toBe('2026-02-02');
    expect(fix.portfolio).toBeUndefined();
    expect(fix.taskProgress).toEqual({ total: 1, completed: 1 });
  });

  it('unions the in-repo archive and the machine-home archive, de-duplicated by name', async () => {
    const home = await resolveProjectHome(projectRoot, { ensure: true });
    writeInRepoArchived(projectRoot, '2026-01-01-alpha', { 'proposal.md': PROPOSAL });
    const homeArchived = path.join(home!.archiveDir, '2026-03-03-beta');
    fs.mkdirSync(homeArchived, { recursive: true });
    fs.writeFileSync(path.join(homeArchived, 'proposal.md'), PROPOSAL);
    fs.writeFileSync(path.join(homeArchived, 'tasks.md'), '- [x] one\n- [x] two\n');

    const result = await handleArchive(projectRoot, home);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.response.changes.map((c) => c.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
    // beta lives only in the machine-home archive; its progress must resolve
    // there via the shared location probe, not the empty in-repo dir.
    const beta = result.response.changes.find((c) => c.name === 'beta')!;
    expect(beta.taskProgress).toEqual({ total: 2, completed: 2 });
  });

  it('yields an empty listing for a space with no archived changes (not an error)', async () => {
    const result = await handleArchive(projectRoot, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.changes).toEqual([]);
  });

  it('creates no files (read-only red line)', async () => {
    writeContainer(projectRoot, 'redesign');
    writeInRepoArchived(projectRoot, '2026-01-01-redesign-api', {
      'proposal.md': PROPOSAL,
      'tasks.md': '- [ ] 1.1 A\n',
    });

    const changesDir = path.join(projectRoot, 'rasen', 'changes');
    const snapshot = (dir: string): string[] =>
      fs.existsSync(dir)
        ? fs
            .readdirSync(dir, { recursive: true, withFileTypes: true })
            .map((d) => path.join(d.parentPath ?? d.path, d.name))
            .sort()
        : [];
    const before = snapshot(changesDir);

    await handleArchive(projectRoot, null);

    expect(snapshot(changesDir)).toEqual(before);
  });
});
