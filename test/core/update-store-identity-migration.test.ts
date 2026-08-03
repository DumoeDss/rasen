import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UpdateCommand } from '../../src/core/update.js';
import { _resetConfigDiagnosticDedup } from '../../src/core/config-diagnostics.js';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';

// Mock global config to isolate from the machine's real config.
const mockState = {
  config: { featureFlags: {}, profile: 'core' as const },
};
vi.mock('../../src/core/global-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/global-config.js')>();
  return {
    ...actual,
    getGlobalConfig: () => ({ ...mockState.config }),
    saveGlobalConfig: vi.fn(),
  };
});

// Mock multi-project-update so the interactive offer path is deterministic.
vi.mock('../../src/core/multi-project-update.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/multi-project-update.js')>();
  return {
    ...actual,
    enumerateBehindProjects: vi.fn(async () => []),
    updateMultipleProjects: vi.fn(async () => []),
    formatMultiProjectSummary: vi.fn(() => ''),
  };
});

vi.mock('../../src/utils/interactive.js', () => ({
  isInteractive: () => false,
}));

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  checkbox: vi.fn(),
}));

// Track the migration module so tests can assert call behavior. The mock
// returns a CANNED result (never delegates to the real implementation) so the
// test never touches the real machine's ~/.rasen registry or store metadata.
const migrationSpy = vi.hoisted(() => ({
  shouldThrow: false,
}));

vi.mock('../../src/core/store/identity-migration.js', () => ({
  migrateAllStoreIdentities: vi.fn(async () => {
    if (migrationSpy.shouldThrow) {
      throw new Error('mocked migration failure');
    }
    return {
      applied: true,
      stores: [],
      projects: [],
      registryRekeyed: true,
      registryBlockedBy: [],
      suggestedCommits: [],
    };
  }),
  formatStoreIdentityMigrationSummary: vi.fn(() => [
    'All registered stores carry a permanent identity.',
  ]),
}));

// Re-import after mock setup so the UpdateCommand uses the mocked module.
const { migrateAllStoreIdentities: mockedMigrate } = await import(
  '../../src/core/store/identity-migration.js'
);

describe('UpdateCommand store-identity migration hook', () => {
  let testDir: string;

  beforeEach(async () => {
    _resetConfigDiagnosticDedup();
    migrationSpy.shouldThrow = false;
    vi.mocked(mockedMigrate).mockClear();

    testDir = path.join(os.tmpdir(), `openspec-store-id-${randomUUID()}`);
    const rasenDir = path.join(testDir, 'rasen');
    await fs.mkdir(path.join(rasenDir, 'specs'), { recursive: true });
    await fs.mkdir(path.join(rasenDir, 'changes', 'archive'), { recursive: true });
    // Write a config with tools so the update flow does not short-circuit
    // at "No configured tools found" before reaching the migration hook.
    await fs.writeFile(
      path.join(rasenDir, 'config.yaml'),
      'schema: spec-driven\ntools:\n  - claude\n'
    );
  });

  afterEach(async () => {
    _resetConfigDiagnosticDedup();
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('calls migrateAllStoreIdentities with apply:true when onlyThis is false', async () => {
    const cmd = new UpdateCommand({ onlyThis: false });
    await cmd.execute(testDir);

    expect(mockedMigrate).toHaveBeenCalledWith(
      expect.objectContaining({ apply: true, projectRoot: testDir })
    );
  });

  it('does NOT call the migration when onlyThis is true', async () => {
    const cmd = new UpdateCommand({ onlyThis: true });
    await cmd.execute(testDir);

    expect(mockedMigrate).not.toHaveBeenCalled();
  });

  it('does not abort the update when the migration throws', async () => {
    migrationSpy.shouldThrow = true;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cmd = new UpdateCommand({ onlyThis: false });
    // Must NOT throw — best-effort.
    await cmd.execute(testDir);

    // A warning is printed, not a crash.
    const allOutput = [
      ...logSpy.mock.calls.map((c) => String(c[0])),
      ...warnSpy.mock.calls.map((c) => String(c[0])),
    ].join('\n');
    expect(allOutput).toContain('store identity migration could not complete');

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
