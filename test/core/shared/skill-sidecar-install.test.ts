import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { InitCommand } from '../../../src/core/init.js';
import { UpdateCommand } from '../../../src/core/update.js';

// init prompts must be mocked so `execute` runs non-interactively.
const { confirmMock, showWelcomeScreenMock, searchableMultiSelectMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  showWelcomeScreenMock: vi.fn().mockResolvedValue(undefined),
  searchableMultiSelectMock: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({ confirm: confirmMock }));
vi.mock('../../../src/ui/welcome-screen.js', () => ({ showWelcomeScreen: showWelcomeScreenMock }));
vi.mock('../../../src/prompts/searchable-multi-select.js', () => ({
  searchableMultiSelect: searchableMultiSelectMock,
}));

/**
 * Real-run coverage for phase0d-sidecar-install: drive `rasen init` then
 * `rasen update` against a temp project and assert expert-skill sidecars land
 * alongside SKILL.md and that update is idempotent.
 */
describe('skill sidecar install (init + update real run)', () => {
  let testDir: string;
  let configTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  const skillsRoot = () => path.join(testDir, '.claude', 'skills');
  const investigateSidecar = () =>
    path.join(skillsRoot(), 'rasen-investigate', 'scripts', 'hitl-loop.template.sh');
  const reviewSidecar = () =>
    path.join(skillsRoot(), 'rasen-review', 'checklist.md');

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-sidecar-run-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    configTempDir = path.join(os.tmpdir(), `rasen-sidecar-cfg-${randomUUID()}`);
    await fs.mkdir(configTempDir, { recursive: true });
    // The global vitest safety net (vitest.setup.ts) sets RASEN_HOME, which
    // outranks XDG_CONFIG_HOME — clear it so this suite's XDG isolation
    // actually resolves into configTempDir.
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = configTempDir;

    vi.spyOn(console, 'log').mockImplementation(() => {});
    confirmMock.mockReset();
    confirmMock.mockResolvedValue(true);
    showWelcomeScreenMock.mockClear();
    searchableMultiSelectMock.mockReset();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('installs sidecars on init and stays idempotent on update', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    // Expert skills are always installed regardless of profile; their sidecars must land.
    expect(existsSync(investigateSidecar())).toBe(true);
    expect(existsSync(reviewSidecar())).toBe(true);

    // Re-run update (force) — idempotent: no throw, same sidecars present.
    await new UpdateCommand({ force: true }).execute(testDir);

    expect(existsSync(investigateSidecar())).toBe(true);
    expect(existsSync(reviewSidecar())).toBe(true);
  });
});
