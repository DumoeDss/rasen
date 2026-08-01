import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BANNED_LIVE_TOKENS = [
  'rasen-freeze',
  'rasen-guard',
  'rasen-unfreeze',
  'check-freeze.sh',
  'freeze-dir.txt',
  'rasen agent edit-boundary',
  'EDIT_BOUNDARY_GUIDANCE',
  'resolveEditBoundaryEnforcement',
] as const;

const SCAN_ROOTS = ['src', 'docs', 'skills', path.join('test', 'fixtures')] as const;
const ALLOWED_MIGRATION_FILES = new Set([
  path.normalize(path.join('src', 'core', 'retired-edit-boundary.ts')),
  path.normalize(path.join('src', 'core', 'legacy-cleanup.ts')),
  path.normalize(path.join('docs', 'runtime-edit-boundary-retirement.md')),
]);

function filesUnder(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (
        target.includes(path.join('docs', 'architecture')) ||
        target.includes(path.join('docs', 'audits')) ||
        target.includes(path.join('docs', 'handoff'))
      ) {
        return [];
      }
      return filesUnder(target);
    }
    return entry.isFile() ? [target] : [];
  });
}

describe('retired edit-boundary vocabulary guard', () => {
  it('keeps live source, docs, fixtures, and packaged skills free of retired dependencies', () => {
    const violations: string[] = [];
    for (const file of SCAN_ROOTS.flatMap((root) => filesUnder(root))) {
      const normalized = path.normalize(file);
      if (ALLOWED_MIGRATION_FILES.has(normalized)) continue;
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }
      for (const token of BANNED_LIVE_TOKENS) {
        if (content.includes(token)) violations.push(`${normalized}: ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('has no live boundary modules, command surface, or public exports', () => {
    expect(fs.existsSync(path.join('src', 'core', 'edit-boundary.ts'))).toBe(false);
    expect(fs.existsSync(path.join('src', 'core', 'edit-boundary-hooks.ts'))).toBe(
      false
    );
    for (const file of [
      path.join('src', 'commands', 'agent.ts'),
      path.join('src', 'cli', 'index.ts'),
      path.join('src', 'core', 'completions', 'command-registry.ts'),
      path.join('src', 'core', 'runtime-adapters.ts'),
      path.join('src', 'core', 'index.ts'),
    ]) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content, file).not.toContain('edit-boundary');
      expect(content, file).not.toContain('EditBoundary');
    }
  });

  it('keeps generic managed-execution controls independent of retirement cleanup', () => {
    const contracts = fs.readFileSync(
      path.join('src', 'core', 'change-run', 'contracts.ts'),
      'utf-8'
    );
    expect(contracts).toContain("access: z.enum(['none', 'read', 'write'])");
    expect(contracts).toContain('sandbox: z.string().min(1).max(128)');
    expect(contracts).toContain("kind: z.literal('workspace-reservation')");
    expect(contracts).toContain('Other-worktree views cannot expose controls');

    const agentCommand = fs.readFileSync(
      path.join('src', 'commands', 'agent.ts'),
      'utf-8'
    );
    expect(agentCommand).toContain(
      'options.sandbox !== \'read-only\' && options.sandbox !== \'workspace-write\''
    );

    for (const file of [
      path.join('src', 'core', 'change-run', 'contracts.ts'),
      path.join('src', 'core', 'change-run', 'internal', 'reservations.ts'),
      path.join('src', 'core', 'change-run', 'internal', 'workspace.ts'),
      path.join('src', 'core', 'change-run', 'internal', 'workspace-git.ts'),
      path.join('src', 'core', 'pipeline-registry', 'profile-resolver.ts'),
      path.join('src', 'commands', 'agent.ts'),
      path.join('src', 'core', 'claude', 'invocation.ts'),
      path.join('src', 'core', 'codex', 'invocation.ts'),
      path.join('src', 'core', 'pipeline-registry', 'run-state.ts'),
    ]) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content, file).not.toContain('edit-boundary');
      expect(content, file).not.toContain('retired-edit-boundary');
    }
  });
});
