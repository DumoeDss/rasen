/**
 * Install-set matrix (design.md, concept-coherence-expert-install-flip):
 * exercises the real `rasen init`/`rasen update` flow end to end (real
 * filesystem, real global config, isolated via XDG_CONFIG_HOME/XDG_DATA_HOME
 * per the RASEN_HOME test-isolation convention — never delete RASEN_HOME,
 * only redirect it) against the enumerated scenarios in design.md's table.
 * Rows 1-3 and 14 are the non-regression guarantee: an existing (legacy,
 * marker-absent) install must never lose an expert. Rows 4-11 are the
 * flipped semantics once the marker is set. Row 13 is the qa-only -> qa
 * sidecar alias under selection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

import { InitCommand } from '../../src/core/init.js';
import { UpdateCommand } from '../../src/core/update.js';
import { getGlobalConfig, saveGlobalConfig } from '../../src/core/global-config.js';
import { ALL_EXPERTS, ALL_WORKFLOWS, QUALITY_FLOOR_EXPERTS } from '../../src/core/profiles.js';
import { getExpertSkillDefinitions } from '../../src/core/workflow-registry/index.js';
import { resolveProjectHome } from '../../src/core/project-home.js';
import { EXPERT_SELECTION_ACK_FILE_NAME } from '../../src/core/expert-selection-state.js';

/**
 * A fresh init always writes its OWN project's expert-selection
 * acknowledgment immediately (zero pre-existing risk — see init.ts). Tests
 * that reset the global marker afterward to simulate a genuinely pre-flip
 * legacy install (predating this acknowledgment mechanism entirely) must
 * also clear that project's own ack file, or the simulation is incomplete.
 */
async function clearExpertSelectionAck(projectDir: string): Promise<void> {
  const home = await resolveProjectHome(projectDir, { ensure: false });
  if (!home) return;
  await fs.rm(path.join(home.homeDir, EXPERT_SELECTION_ACK_FILE_NAME), { force: true });
}

const EXPERT_DIR_BY_ID = new Map(
  getExpertSkillDefinitions().map((expert) => [expert.id, expert.dirName])
);

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function installedExpertIds(testDir: string): Promise<string[]> {
  const installed: string[] = [];
  for (const [id, dirName] of EXPERT_DIR_BY_ID) {
    const skillFile = path.join(testDir, '.claude', 'skills', dirName, 'SKILL.md');
    if (await fileExists(skillFile)) installed.push(id);
  }
  return installed.sort();
}

describe('expert install-set matrix (6b)', () => {
  let testDir: string;
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-expert-flip-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    originalEnv = { ...process.env };
    // Never delete RASEN_HOME — redirect config/data resolution via XDG so
    // resolution reads this isolated location, not the real ~/.rasen
    // (durable finding: tests calling resolution must set RASEN_HOME or an
    // equivalent override, never delete it).
    delete process.env.RASEN_HOME;
    configTempDir = path.join(os.tmpdir(), `rasen-expert-flip-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(configTempDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = configTempDir;
    dataTempDir = path.join(os.tmpdir(), `rasen-expert-flip-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataTempDir, { recursive: true });
    process.env.XDG_DATA_HOME = dataTempDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.rm(configTempDir, { recursive: true, force: true });
    await fs.rm(dataTempDir, { recursive: true, force: true });
  });

  it('row 1: existing full install, update — legacy marker resolves to all 21 experts, none removed', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'full', delivery: 'both' });
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());

    // A fresh (non-extend) init is itself an explicit-write path (design.md
    // D4) — reset the marker to simulate a config that predates expert
    // selection entirely, then confirm `update` alone changes nothing.
    saveGlobalConfig({ ...getGlobalConfig(), expertSelectionExplicit: undefined });
    await new UpdateCommand({ force: true }).execute(testDir);
    expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());
    expect(getGlobalConfig().expertSelectionExplicit).not.toBe(true);
  });

  it('row 2: existing core install (legacy, marker absent), update — all 21 experts, key non-regression', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both' });
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    // Fresh init is an explicit-write path; simulate a genuinely legacy
    // (pre-flip) install by clearing the marker before the update under test.
    saveGlobalConfig({ ...getGlobalConfig(), expertSelectionExplicit: undefined });

    await new UpdateCommand({ force: true }).execute(testDir);

    expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());
  });

  it('row 3: existing custom install (legacy, marker absent, no expert ids), update — all 21 experts, key non-regression', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['propose', 'explore', 'apply', 'archive'],
    });
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    saveGlobalConfig({ ...getGlobalConfig(), expertSelectionExplicit: undefined });

    await new UpdateCommand({ force: true }).execute(testDir);

    expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());
  });

  it('row 14: legacy update prints the one-time "experts now selectable" notice and removes nothing', async () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both' });
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    saveGlobalConfig({ ...getGlobalConfig(), expertSelectionExplicit: undefined });

    // Pinned so this assertion is deterministic regardless of the host
    // machine's OS locale (locale-diagnostic-reporter wired this notice to
    // a locale-aware reporter).
    process.env.RASEN_LANG = 'en';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await new UpdateCommand({ force: true }).execute(testDir);
      const allWarnings = warnSpy.mock.calls.map((args) => String(args[0])).join('\n');
      expect(allWarnings).toContain('experts are now individually selectable');
    } finally {
      warnSpy.mockRestore();
    }
    expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());
  });

  it('row 4/D2: fresh init, default full — marker set by init, WF(full)+all21', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    expect(getGlobalConfig().expertSelectionExplicit).toBe(true);
    expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());
  });

  it('row 5: fresh init with --profile core — marker set, lean floor-only expert set (benchmark via profile default, not closure)', async () => {
    await new InitCommand({ tools: 'claude', force: true, profile: 'core' }).execute(testDir);

    expect(getGlobalConfig().expertSelectionExplicit).toBe(true);
    expect(await installedExpertIds(testDir)).toEqual([...QUALITY_FLOOR_EXPERTS].sort());
  });

  it('row 7/11: explicit custom=[auto-command] pulls only the closure-required "review" expert', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['auto-command'],
      expertSelectionExplicit: true,
    });

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    expect(await installedExpertIds(testDir)).toEqual(['review']);
  });

  it('row 12 interplay: verify-enhanced-command closure pulls review, cso, qa, qa-only, design-review', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['verify-enhanced-command'],
      expertSelectionExplicit: true,
    });

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    expect(await installedExpertIds(testDir)).toEqual(
      ['cso', 'design-review', 'qa', 'qa-only', 'review'].sort()
    );
  });

  it('row 9: post-flip picker unchecking a non-floor, unreferenced expert (tdd) prunes it on update', async () => {
    // Start from a full install (marker set by fresh init: WF(full)+all21).
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    expect(await installedExpertIds(testDir)).toContain('tdd');

    // Simulate the picker persisting a `custom` selection matching
    // full-minus-tdd (applyProfileState's write shape): every workflow +
    // every expert except `tdd`, marker already set from the fresh init above.
    const prunedSelection = [...ALL_WORKFLOWS, ...ALL_EXPERTS].filter((id) => id !== 'tdd');
    saveGlobalConfig({
      ...getGlobalConfig(),
      profile: 'custom',
      workflows: prunedSelection,
    });
    expect(getGlobalConfig().expertSelectionExplicit).toBe(true);

    await new UpdateCommand({ force: true }).execute(testDir);

    expect(await installedExpertIds(testDir)).not.toContain('tdd');
    expect(await installedExpertIds(testDir)).toHaveLength(20);
  });

  it('cross-project regression (review-round Blocker fix): an unrelated project B\'s fresh init must never prune project A, which has no explicit expert-selection acknowledgment of its own', async () => {
    // Project A: a genuinely legacy install (marker absent), all 21 experts on disk.
    saveGlobalConfig({ featureFlags: {}, profile: 'core', delivery: 'both' });
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);
    saveGlobalConfig({ ...getGlobalConfig(), expertSelectionExplicit: undefined });
    // Fresh init always writes its own project's ack immediately (zero
    // pre-existing risk); clear it here so A genuinely simulates a project
    // that predates the expert-selection mechanism entirely.
    await clearExpertSelectionAck(testDir);
    // With the marker reset, a plain legacy `update` installs every missing
    // expert (mirroring rows 2/14's already-established baseline) — the
    // "already has all 21 experts on disk" starting point a genuinely
    // pre-flip install would have. This update must not (and does not)
    // write A's ack: the marker is not explicit at this point.
    await new UpdateCommand({ force: true }).execute(testDir);
    expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());

    // Project B: a completely unrelated project. A plain fresh `rasen init`
    // (no picker touched, no profile command run) is one of design.md D4's
    // authorized marker-write paths, so this alone flips the marker
    // machine-wide.
    const testDirB = path.join(
      os.tmpdir(),
      `rasen-expert-flip-test-b-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDirB, { recursive: true });
    try {
      await new InitCommand({ tools: 'claude', force: true }).execute(testDirB);
      expect(getGlobalConfig().expertSelectionExplicit).toBe(true);

      // Project A's own `update` must still keep every expert: A has never
      // had its own explicit expert-selection acknowledgment, regardless of
      // what just happened in B.
      await new UpdateCommand({ force: true }).execute(testDir);
      expect(await installedExpertIds(testDir)).toEqual([...ALL_EXPERTS].sort());

      // The first post-flip `update` records A's own acknowledgment (a
      // one-run grace, mirroring the existing migration-notice mechanism),
      // so a SECOND `update` on A now applies profile-default narrowing
      // (`core` -> the quality floor) — a genuine transition surfaced to A's
      // own user via two of A's own commands, not a side effect of B alone.
      await new UpdateCommand({ force: true }).execute(testDir);
      expect(await installedExpertIds(testDir)).toEqual([...QUALITY_FLOOR_EXPERTS].sort());
    } finally {
      await fs.rm(testDirB, { recursive: true, force: true });
    }
  });

  it('row 13: a custom selection naming qa-only installs it (with the qa sidecar materialized)', async () => {
    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      delivery: 'both',
      workflows: ['propose', 'qa-only'],
      expertSelectionExplicit: true,
    });

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const qaOnlySkill = path.join(testDir, '.claude', 'skills', 'rasen-qa-only', 'SKILL.md');
    expect(await fileExists(qaOnlySkill)).toBe(true);
    // qa-only borrows qa's sidecar tree (sidecarSourceId: 'qa') — the
    // reference doc should have materialized alongside SKILL.md.
    const sidecarFile = path.join(testDir, '.claude', 'skills', 'rasen-qa-only', 'references', 'issue-taxonomy.md');
    expect(await fileExists(sidecarFile)).toBe(true);
  });
});
