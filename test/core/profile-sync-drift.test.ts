import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  hasProjectConfigDrift,
  WORKFLOW_TO_SKILL_DIR,
} from '../../src/core/profile-sync-drift.js';
import { ALL_WORKFLOWS, CORE_WORKFLOWS } from '../../src/core/profiles.js';
import { saveNamedProfile } from '../../src/core/named-profiles.js';
import { InitCommand } from '../../src/core/init.js';
import { getGlobalConfig, saveGlobalConfig } from '../../src/core/global-config.js';
import { resolveCurrentProfileState } from '../../src/commands/profile-editor.js';
import { loadWorkflowCatalog, resolveWorkflowSelection } from '../../src/core/workflow-registry/index.js';

function writeSkill(projectDir: string, workflowId: string): void {
  // Resolve via the catalog (covers both task workflows and experts) rather
  // than WORKFLOW_TO_SKILL_DIR, which only maps task workflows.
  const definition = loadWorkflowCatalog().get(workflowId);
  if (!definition) throw new Error(`Unknown workflow/expert id in test fixture: ${workflowId}`);
  const skillDirName = definition.skill.dirName;
  const skillPath = path.join(projectDir, '.claude', 'skills', skillDirName, 'SKILL.md');
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, `name: ${skillDirName}\n`);
}

/**
 * Installs the skill directories for the experts a workflow selection's
 * dependency closure pulls in (e.g. `verify-enhanced-command` requires
 * review/cso/qa/design-review/qa-only) but that are not already in
 * `workflows` — matching what a real install actually puts on disk, now
 * that drift detection is closure-aware.
 */
function setupClosureExperts(projectDir: string, workflows: readonly string[]): void {
  const catalog = loadWorkflowCatalog();
  const closureIds = resolveWorkflowSelection(catalog, [...workflows], { includeSkillDependencies: true }).map(
    (definition) => definition.id
  );
  for (const id of closureIds) {
    if (workflows.includes(id)) continue;
    writeSkill(projectDir, id);
  }
}

function setupCoreSkills(projectDir: string): void {
  for (const workflow of CORE_WORKFLOWS) {
    writeSkill(projectDir, workflow);
  }
}

function setupFullSkills(projectDir: string): void {
  for (const workflow of ALL_WORKFLOWS) {
    writeSkill(projectDir, workflow);
  }
}

describe('WORKFLOW_TO_SKILL_DIR', () => {
  it('maps the goal-loop workflow family to their rasen-goal* skill directories', () => {
    expect(WORKFLOW_TO_SKILL_DIR['goal-plan']).toBe('rasen-goal-plan');
    expect(WORKFLOW_TO_SKILL_DIR['goal-iterate']).toBe('rasen-goal-iterate');
    expect(WORKFLOW_TO_SKILL_DIR['goal-report']).toBe('rasen-goal-report');
    expect(WORKFLOW_TO_SKILL_DIR['goal-command']).toBe('rasen-goal');
  });
});

describe('profile sync drift detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `rasen-profile-sync-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(tempDir, 'rasen'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects drift when required profile skill files are missing', () => {
    writeSkill(tempDir, 'explore');

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS);
    expect(hasDrift).toBe(true);
  });

  it('returns false when project skill files match the core profile', () => {
    setupCoreSkills(tempDir);
    // CORE_WORKFLOWS includes `auto-command`, whose dependency closure
    // requires the `review` expert skill — closure-aware drift detection
    // now forward-requires it too, matching what a real install puts on
    // disk.
    setupClosureExperts(tempDir, CORE_WORKFLOWS);

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS);
    expect(hasDrift).toBe(false);
  });

  it('detects drift when extra workflows are installed', () => {
    setupCoreSkills(tempDir);
    writeSkill(tempDir, 'new');

    const hasDrift = hasProjectConfigDrift(tempDir, CORE_WORKFLOWS);
    expect(hasDrift).toBe(true);
  });

  it('returns false for the full profile after a clean install, including the skill-only goal-loop stage workflows', () => {
    setupFullSkills(tempDir);
    // ALL_WORKFLOWS's closure requires review/cso/qa/design-review/qa-only
    // (pulled in by verify-enhanced-command and auto-command) — install
    // them too so the closure-aware forward-required check is satisfied,
    // matching a real install.
    setupClosureExperts(tempDir, ALL_WORKFLOWS);

    const hasDrift = hasProjectConfigDrift(tempDir, ALL_WORKFLOWS);
    expect(hasDrift).toBe(false);
  });
});

describe('profile sync drift detection with a project profile lock (init-profile-lock)', () => {
  const LOCKED_WORKFLOWS = ['propose', 'explore'];

  let tempDir: string;
  let homeDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-drift-lock-project-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-drift-lock-home-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = homeDir;
    fs.mkdirSync(path.join(tempDir, 'rasen'), { recursive: true });
    saveNamedProfile('teamdrift', { version: 1, workflows: [...LOCKED_WORKFLOWS] });
    fs.writeFileSync(
      path.join(tempDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprofile: teamdrift\n'
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('reports no drift when the installed set matches the locked profile closure while the passed (global) selection differs', () => {
    for (const workflow of LOCKED_WORKFLOWS) {
      writeSkill(tempDir, workflow);
    }
    setupClosureExperts(tempDir, LOCKED_WORKFLOWS);

    // The caller passes the user-wide core selection; the lock must win.
    expect(hasProjectConfigDrift(tempDir, CORE_WORKFLOWS)).toBe(false);
  });

  it('still reports drift against the locked profile when an extra workflow is installed', () => {
    for (const workflow of LOCKED_WORKFLOWS) {
      writeSkill(tempDir, workflow);
    }
    setupClosureExperts(tempDir, LOCKED_WORKFLOWS);
    writeSkill(tempDir, 'new');

    expect(hasProjectConfigDrift(tempDir, CORE_WORKFLOWS)).toBe(true);
  });

  it('falls back to the passed selection when the locked profile does not exist', () => {
    fs.writeFileSync(
      path.join(tempDir, 'rasen', 'config.yaml'),
      'schema: spec-driven\nprofile: no-such-profile\n'
    );
    setupCoreSkills(tempDir);
    setupClosureExperts(tempDir, CORE_WORKFLOWS);

    expect(hasProjectConfigDrift(tempDir, CORE_WORKFLOWS)).toBe(false);
  });
});

describe('profile sync drift detection through the production caller (profile-editor.ts:maybeWarnProjectConfigDrift)', () => {
  // A `custom` profile whose stored workflow selection does not list the
  // experts a selected pipeline workflow pulls in via its dependency
  // closure (`verify-enhanced-command` requires review/cso/qa/design-review/
  // qa-only). Reproduces the regression: `resolveCurrentProfileState`
  // returns the raw, un-expanded selection — exactly what
  // `profile-editor.ts:299` passes to `hasProjectConfigDrift` — while the
  // closure experts are genuinely installed on disk.
  const CUSTOM_WORKFLOWS = ['propose', 'verify-enhanced-command'];

  let testDir: string;
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-profile-editor-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
    originalEnv = { ...process.env };
    configTempDir = path.join(os.tmpdir(), `rasen-profile-editor-drift-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(configTempDir, { recursive: true });
    dataTempDir = path.join(os.tmpdir(), `rasen-profile-editor-drift-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(dataTempDir, { recursive: true });
    // Never delete RASEN_HOME; the global vitest safety net sets it, and it
    // outranks XDG — redirect both config and data resolution via XDG so
    // InitCommand's machine-home project registration lands here, not the
    // real ~/.rasen (expert-install-flip.test.ts convention).
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = configTempDir;
    process.env.XDG_DATA_HOME = dataTempDir;

    saveGlobalConfig({
      featureFlags: {},
      profile: 'custom',
      workflows: [...CUSTOM_WORKFLOWS],
      expertSelectionExplicit: true,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.rmSync(configTempDir, { recursive: true, force: true });
    fs.rmSync(dataTempDir, { recursive: true, force: true });
  });

  it('reports no drift for a custom profile whose closure-required experts are on disk but unlisted', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const state = resolveCurrentProfileState(getGlobalConfig());
    // The raw stored selection must NOT already contain the closure experts
    // — otherwise this test would not reproduce the bug.
    expect(state.workflows).toEqual(CUSTOM_WORKFLOWS);
    const catalog = loadWorkflowCatalog();
    for (const expert of ['cso', 'design-review', 'qa', 'qa-only', 'review']) {
      expect(state.workflows).not.toContain(expert);
      const dirName = catalog.get(expert)!.skill.dirName;
      expect(fs.existsSync(path.join(testDir, '.claude', 'skills', dirName))).toBe(true);
    }

    expect(hasProjectConfigDrift(testDir, state.workflows)).toBe(false);
  });

  it('still reports drift when a genuinely orphaned expert is installed', async () => {
    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const state = resolveCurrentProfileState(getGlobalConfig());
    expect(hasProjectConfigDrift(testDir, state.workflows)).toBe(false);

    // `benchmark` is neither in the stored selection nor required by
    // `verify-enhanced-command`'s dependency closure — a lingering install
    // of it is a real deselection, not a closure artifact.
    writeSkill(testDir, 'benchmark');
    expect(hasProjectConfigDrift(testDir, state.workflows)).toBe(true);
  });
});
