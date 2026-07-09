import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Inject a deterministic single-file copy failure without touching the rest of
// fs. When `copyFailSuffix` is set, only the matching destination throws; every
// other fs call (and every other test) uses the real implementation.
const fsMock = vi.hoisted(() => ({ copyFailSuffix: null as string | null }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const copyFileSync: typeof actual.copyFileSync = (src, dest, mode) => {
    if (
      fsMock.copyFailSuffix &&
      typeof dest === 'string' &&
      dest.split('\\').join('/').endsWith(fsMock.copyFailSuffix)
    ) {
      throw new Error('EACCES: simulated copy failure');
    }
    return actual.copyFileSync(src, dest, mode);
  };
  return { ...actual, default: actual, copyFileSync };
});

import {
  migrateWorkspace,
  hasLegacyWorkspace,
  hasRasenWorkspace,
  formatMigrationSummary,
} from '../../src/core/workspace-migration.js';

/**
 * Copy-only migration contract (spec: workspace-migration):
 * copies openspec/{specs,changes(+archive),config.yaml} into rasen/, never
 * modifies the source, never overwrites existing destinations, tolerates
 * per-file failure, is idempotent, and builds every path with path.join.
 */
describe('workspace migration (copy-only)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-migrate-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeFile(rel: string, content: string): void {
    const full = path.join(tempDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }

  function read(rel: string): string {
    return fs.readFileSync(path.join(tempDir, rel), 'utf-8');
  }

  function seedLegacyWorkspace(): void {
    writeFile(path.join('openspec', 'config.yaml'), 'schema: spec-driven\n');
    writeFile(path.join('openspec', 'specs', 'auth', 'spec.md'), '# auth\n');
    writeFile(
      path.join('openspec', 'changes', 'add-thing', 'proposal.md'),
      '# add-thing\n'
    );
    // Nested archive with a dated change directory.
    writeFile(
      path.join('openspec', 'changes', 'archive', '2026-01-01-old', 'proposal.md'),
      '# archived\n'
    );
  }

  it('copies specs, changes (with nested archive), and config into rasen/', () => {
    seedLegacyWorkspace();

    const summary = migrateWorkspace(tempDir);

    expect(summary.legacyMissing).toBe(false);
    expect(summary.failed).toEqual([]);
    expect(hasRasenWorkspace(tempDir)).toBe(true);

    expect(read(path.join('rasen', 'config.yaml'))).toBe('schema: spec-driven\n');
    expect(read(path.join('rasen', 'specs', 'auth', 'spec.md'))).toBe('# auth\n');
    expect(
      read(path.join('rasen', 'changes', 'add-thing', 'proposal.md'))
    ).toBe('# add-thing\n');
    // Nested archive path round-trips.
    expect(
      read(path.join('rasen', 'changes', 'archive', '2026-01-01-old', 'proposal.md'))
    ).toBe('# archived\n');

    // Copied set uses POSIX-form relative paths.
    expect(summary.copied).toContain('config.yaml');
    expect(summary.copied).toContain('changes/archive/2026-01-01-old/proposal.md');
  });

  it('leaves the source openspec/ workspace byte-for-byte unchanged', () => {
    seedLegacyWorkspace();
    const before = read(path.join('openspec', 'specs', 'auth', 'spec.md'));

    migrateWorkspace(tempDir);

    // Source still present and unmodified.
    expect(hasLegacyWorkspace(tempDir)).toBe(true);
    expect(read(path.join('openspec', 'specs', 'auth', 'spec.md'))).toBe(before);
    expect(read(path.join('openspec', 'config.yaml'))).toBe('schema: spec-driven\n');
  });

  it('is idempotent and never overwrites an existing destination', () => {
    seedLegacyWorkspace();
    // A pre-existing rasen file that differs from the source must be preserved.
    writeFile(path.join('rasen', 'config.yaml'), 'user-edited: true\n');

    const summary = migrateWorkspace(tempDir);

    // Existing file skipped, not overwritten.
    expect(read(path.join('rasen', 'config.yaml'))).toBe('user-edited: true\n');
    expect(summary.skipped).toContain('config.yaml');

    // Re-run copies nothing new (everything already present).
    const rerun = migrateWorkspace(tempDir);
    expect(rerun.copied).toEqual([]);
    expect(read(path.join('rasen', 'config.yaml'))).toBe('user-edited: true\n');
  });

  it('reports legacyMissing when there is no openspec/ workspace', () => {
    const summary = migrateWorkspace(tempDir);
    expect(summary.legacyMissing).toBe(true);
    expect(hasRasenWorkspace(tempDir)).toBe(false);
    expect(formatMigrationSummary(summary)).toMatch(/nothing to migrate/i);
  });

  it('continues past a single-file copy failure and lists it in the summary', () => {
    seedLegacyWorkspace();

    // Fail the copy of exactly one file; every other file copies normally.
    fsMock.copyFailSuffix = 'rasen/specs/auth/spec.md';

    let summary;
    try {
      // Migration must NOT throw even though one file fails.
      summary = migrateWorkspace(tempDir);
    } finally {
      fsMock.copyFailSuffix = null;
    }

    // The failing file is reported (POSIX-form relative path) with its error.
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].path).toBe('specs/auth/spec.md');
    expect(summary.failed[0].error).toMatch(/simulated copy failure/);

    // The run still completed the other files.
    expect(summary.copied).toContain('config.yaml');
    expect(summary.copied).toContain('changes/add-thing/proposal.md');
    expect(read(path.join('rasen', 'config.yaml'))).toBe('schema: spec-driven\n');

    // Summary text surfaces the failure count and the path.
    const text = formatMigrationSummary(summary);
    expect(text).toMatch(/failed:\s*1/);
    expect(text).toContain('specs/auth/spec.md');
  });
});
