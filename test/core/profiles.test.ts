import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ALL_EXPERTS,
  CORE_WORKFLOWS,
  ALL_WORKFLOWS,
  QUALITY_FLOOR_EXPERTS,
  getCurrentBuiltInWorkflowIds,
  getProfileWorkflows,
  resolveDesiredWorkflowSelection,
  resolveProjectWorkflowSelection,
  resolveUserWideProfileBase,
} from '../../src/core/profiles.js';
import { saveNamedProfile } from '../../src/core/named-profiles.js';
import {
  getExpertSkillDefinitions,
  loadWorkflowCatalog,
} from '../../src/core/workflow-registry/index.js';

describe('profiles', () => {
  describe('CORE_WORKFLOWS', () => {
    it('should contain the default core workflows', () => {
      expect(CORE_WORKFLOWS).toEqual(['propose', 'explore', 'apply', 'sync', 'archive', 'auto-command', 'help']);
    });

    it('should be a subset of ALL_WORKFLOWS', () => {
      for (const workflow of CORE_WORKFLOWS) {
        expect(ALL_WORKFLOWS).toContain(workflow);
      }
    });
  });

  describe('ALL_WORKFLOWS', () => {
    it('should contain all 23 workflows (11 base + 5 Rasen fusion + review-cycle + handoff + 4 goal-loop + audit)', () => {
      expect(ALL_WORKFLOWS).toHaveLength(23);
    });

    it('should contain expected workflow IDs', () => {
      const expected = [
        'propose', 'explore', 'new', 'continue', 'apply',
        'sync', 'archive', 'bulk-archive', 'verify', 'onboard', 'help',
        // Rasen fusion workflow commands
        'office-hours-command', 'verify-enhanced-command', 'ship-command',
        'retro-command', 'auto-command',
        // Iterative review loop (opt-in)
        'review-cycle',
        // Context handoff (opt-in)
        'handoff',
        // Goal-loop workflow family (opt-in)
        'goal-plan', 'goal-iterate', 'goal-report', 'goal-command',
        // Session token-spend audit (opt-in, diagnostic)
        'audit',
      ];
      expect([...ALL_WORKFLOWS]).toEqual(expected);
    });

    it('should NOT include audit in CORE_WORKFLOWS (opt-in diagnostic only)', () => {
      expect(ALL_WORKFLOWS).toContain('audit');
      expect([...CORE_WORKFLOWS]).not.toContain('audit');
    });

    it('should NOT include review-cycle in CORE_WORKFLOWS (opt-in only)', () => {
      expect(ALL_WORKFLOWS).toContain('review-cycle');
      expect([...CORE_WORKFLOWS]).not.toContain('review-cycle');
    });

    it('should include the goal-loop workflow family but NOT in CORE_WORKFLOWS (opt-in only)', () => {
      expect(ALL_WORKFLOWS).toContain('goal-plan');
      expect(ALL_WORKFLOWS).toContain('goal-iterate');
      expect(ALL_WORKFLOWS).toContain('goal-report');
      expect(ALL_WORKFLOWS).toContain('goal-command');
      expect([...CORE_WORKFLOWS]).not.toContain('goal-plan');
      expect([...CORE_WORKFLOWS]).not.toContain('goal-iterate');
      expect([...CORE_WORKFLOWS]).not.toContain('goal-report');
      expect([...CORE_WORKFLOWS]).not.toContain('goal-command');
    });
  });

  describe('ALL_EXPERTS / QUALITY_FLOOR_EXPERTS', () => {
    it('ALL_EXPERTS matches every built-in expert id (21)', () => {
      const expected = getExpertSkillDefinitions().map((expert) => expert.id);
      expect([...ALL_EXPERTS].sort()).toEqual(expected.sort());
      expect(ALL_EXPERTS).toHaveLength(21);
    });

    it('QUALITY_FLOOR_EXPERTS is the six quality-floor experts and a subset of ALL_EXPERTS', () => {
      expect([...QUALITY_FLOOR_EXPERTS].sort()).toEqual(
        ['benchmark', 'cso', 'design-review', 'qa', 'qa-only', 'review'].sort()
      );
      for (const expert of QUALITY_FLOOR_EXPERTS) {
        expect(ALL_EXPERTS).toContain(expert);
      }
    });
  });

  describe('getProfileWorkflows (design.md D2/D4 — the install-set matrix)', () => {
    describe('legacy (expertSelectionExplicit omitted/false) — profile-independent all-experts fallback', () => {
      it('full profile: ALL_WORKFLOWS + ALL_EXPERTS', () => {
        const result = getProfileWorkflows('full');
        expect([...result].sort()).toEqual([...ALL_WORKFLOWS, ...ALL_EXPERTS].sort());
      });

      it('full profile ignores customWorkflows', () => {
        const result = getProfileWorkflows('full', ['new', 'apply']);
        expect([...result].sort()).toEqual([...ALL_WORKFLOWS, ...ALL_EXPERTS].sort());
      });

      it('core profile: CORE_WORKFLOWS + ALL_EXPERTS (not just the quality floor — row 2 non-regression)', () => {
        const result = getProfileWorkflows('core');
        expect([...result].sort()).toEqual([...CORE_WORKFLOWS, ...ALL_EXPERTS].sort());
      });

      it('custom profile: customWorkflows + ALL_EXPERTS (row 3 non-regression)', () => {
        const customWorkflows = ['explore', 'new', 'apply', 'archive'];
        const result = getProfileWorkflows('custom', customWorkflows);
        expect([...result].sort()).toEqual([...customWorkflows, ...ALL_EXPERTS].sort());
      });

      it('custom profile with no customWorkflows: just ALL_EXPERTS', () => {
        const result = getProfileWorkflows('custom');
        expect([...result].sort()).toEqual([...ALL_EXPERTS].sort());
      });

      it('custom profile with empty customWorkflows: just ALL_EXPERTS', () => {
        const result = getProfileWorkflows('custom', []);
        expect([...result].sort()).toEqual([...ALL_EXPERTS].sort());
      });
    });

    describe('explicit (expertSelectionExplicit: true) — profile-default expert sets govern', () => {
      it('full profile: ALL_WORKFLOWS + ALL_EXPERTS (unchanged from legacy — row 1)', () => {
        const result = getProfileWorkflows('full', undefined, { expertSelectionExplicit: true });
        expect([...result].sort()).toEqual([...ALL_WORKFLOWS, ...ALL_EXPERTS].sort());
      });

      it('core profile: CORE_WORKFLOWS + QUALITY_FLOOR_EXPERTS only (row 5 — lean by design)', () => {
        const result = getProfileWorkflows('core', undefined, { expertSelectionExplicit: true });
        expect([...result].sort()).toEqual([...CORE_WORKFLOWS, ...QUALITY_FLOOR_EXPERTS].sort());
        for (const expert of ALL_EXPERTS) {
          if (!QUALITY_FLOOR_EXPERTS.includes(expert)) expect(result).not.toContain(expert);
        }
      });

      it('custom profile: exactly customWorkflows, verbatim (no expert auto-union)', () => {
        const customWorkflows = ['auto-command', 'review'];
        const result = getProfileWorkflows('custom', customWorkflows, { expertSelectionExplicit: true });
        expect(result).toEqual(customWorkflows);
      });

      it('custom profile with no customWorkflows: empty array', () => {
        const result = getProfileWorkflows('custom', undefined, { expertSelectionExplicit: true });
        expect(result).toEqual([]);
      });
    });
  });

  describe('getCurrentBuiltInWorkflowIds', () => {
    it('returns exactly the built-in workflow ids (no experts)', () => {
      const ids = getCurrentBuiltInWorkflowIds();
      expect([...ids].sort()).toEqual([...ALL_WORKFLOWS].sort());
      for (const expert of ALL_EXPERTS) {
        expect(ids).not.toContain(expert);
      }
    });

    it('includes the recently-added `audit` workflow', () => {
      expect(getCurrentBuiltInWorkflowIds()).toContain('audit');
    });
  });

  describe('frozen custom selection excludes a catalog-new built-in (root cause)', () => {
    // Simulate a selection saved before `audit` existed: the stored list is a
    // verbatim snapshot, so `audit` is absent and stays absent through the
    // shared install resolver — the exact silent-drop the change addresses.
    const storedBeforeAudit = ALL_WORKFLOWS.filter((id) => id !== 'audit');

    it('getProfileWorkflows returns the stored list verbatim, without audit', () => {
      const result = getProfileWorkflows('custom', [...storedBeforeAudit], {
        expertSelectionExplicit: true,
      });
      expect(result).not.toContain('audit');
      expect(result).toEqual(storedBeforeAudit);
    });

    it('resolveDesiredWorkflowSelection does not install the catalog-new workflow', () => {
      const { ids } = resolveDesiredWorkflowSelection(
        loadWorkflowCatalog(),
        'custom',
        [...storedBeforeAudit],
        true
      );
      expect(ids).not.toContain('audit');
    });
  });
});

describe('resolveProjectWorkflowSelection profile lock (init-profile-lock)', () => {
  let tempDir: string;
  let projectDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-profile-lock-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = path.join(tempDir, 'home');
    projectDir = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(projectDir, 'rasen'), { recursive: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeProjectConfig(content: string): void {
    fs.writeFileSync(path.join(projectDir, 'rasen', 'config.yaml'), content);
  }

  it('a locked named profile governs the project instead of the user-wide profile', () => {
    saveNamedProfile('team-web', { version: 1, workflows: ['propose', 'apply'] });
    writeProjectConfig('schema: spec-driven\nprofile: team-web\n');

    const result = resolveProjectWorkflowSelection(
      loadWorkflowCatalog(),
      projectDir,
      'full',
      undefined,
      true
    );

    expect(result.mode).toBe('locked-profile');
    expect(result.lockedProfile).toBe('team-web');
    expect(result.lockWarning).toBeUndefined();
    expect(result.ids).toContain('propose');
    expect(result.ids).toContain('apply');
    expect(result.ids).not.toContain('audit');
    expect(result.ids).not.toContain('explore');
  });

  it('a locked built-in profile resolves exactly like the user-wide path with the marker honored', () => {
    writeProjectConfig('schema: spec-driven\nprofile: core\n');
    const catalog = loadWorkflowCatalog();

    for (const expertSelectionExplicit of [true, false]) {
      const result = resolveProjectWorkflowSelection(
        catalog,
        projectDir,
        'full',
        undefined,
        expertSelectionExplicit
      );
      const expected = resolveDesiredWorkflowSelection(
        catalog,
        'core',
        undefined,
        expertSelectionExplicit
      );

      expect(result.mode).toBe('locked-profile');
      expect(result.lockedProfile).toBe('core');
      expect([...result.ids].sort()).toEqual([...expected.ids].sort());
    }
  });

  it('a workflows override shadows the lock with a warning', () => {
    saveNamedProfile('team-web', { version: 1, workflows: ['propose', 'apply'] });
    writeProjectConfig(
      'schema: spec-driven\nprofile: team-web\nworkflows:\n  - explore\n'
    );

    const result = resolveProjectWorkflowSelection(
      loadWorkflowCatalog(),
      projectDir,
      'full',
      undefined,
      true
    );

    expect(result.mode).toBe('override');
    expect(result.ids).toContain('explore');
    expect(result.ids).not.toContain('propose');
    expect(result.lockWarning).toEqual({
      kind: 'shadowed-by-override',
      profile: 'team-web',
    });
  });

  it('a lock naming a missing profile falls back to the user-wide profile with a warning', () => {
    writeProjectConfig('schema: spec-driven\nprofile: no-such-profile\n');
    const catalog = loadWorkflowCatalog();

    const result = resolveProjectWorkflowSelection(catalog, projectDir, 'core', undefined, true);
    const fallback = resolveDesiredWorkflowSelection(catalog, 'core', undefined, true);

    expect(result.mode).toBe('profile');
    expect(result.lockedProfile).toBeUndefined();
    expect(result.lockWarning).toMatchObject({
      kind: 'unresolvable',
      profile: 'no-such-profile',
    });
    expect([...result.ids].sort()).toEqual([...fallback.ids].sort());
    // Resolution never writes machine-global config.
    expect(fs.existsSync(path.join(tempDir, 'home', 'config.json'))).toBe(false);
  });

  it('a custom lock is treated as unresolvable and falls back with a warning', () => {
    writeProjectConfig('schema: spec-driven\nprofile: custom\n');

    const result = resolveProjectWorkflowSelection(
      loadWorkflowCatalog(),
      projectDir,
      'full',
      undefined,
      false
    );

    expect(result.mode).toBe('profile');
    expect(result.lockWarning).toEqual({ kind: 'custom-lock' });
  });

  it('without a lock or override, resolution is unchanged', () => {
    writeProjectConfig('schema: spec-driven\n');
    const catalog = loadWorkflowCatalog();

    const result = resolveProjectWorkflowSelection(catalog, projectDir, 'core', undefined, true);
    const expected = resolveDesiredWorkflowSelection(catalog, 'core', undefined, true);

    expect(result.mode).toBe('profile');
    expect(result.lockWarning).toBeUndefined();
    expect([...result.ids].sort()).toEqual([...expected.ids].sort());
  });

  it('a locked named profile resolves its definition verbatim plus dependency closure', () => {
    // `verify-enhanced-command` pulls quality experts via its skill-dependency
    // closure; a named lock must include them even though the definition
    // does not list them (same rule as a workflows override).
    saveNamedProfile('leanteam', { version: 1, workflows: ['verify-enhanced-command'] });
    writeProjectConfig('schema: spec-driven\nprofile: leanteam\n');

    const result = resolveProjectWorkflowSelection(
      loadWorkflowCatalog(),
      projectDir,
      'core',
      undefined,
      true
    );

    expect(result.mode).toBe('locked-profile');
    expect(result.ids).toContain('verify-enhanced-command');
    expect(result.ids).toContain('review');
  });

  it('resolving a lock never writes the machine-global config', () => {
    const globalConfigPath = path.join(tempDir, 'home', 'rasen', 'config.json');
    saveNamedProfile('team-web', { version: 1, workflows: ['propose', 'apply'] });
    const catalog = loadWorkflowCatalog();

    // Every lock outcome — a resolvable named lock, a resolvable built-in
    // lock, an unresolvable (missing) lock, and a custom lock — must be
    // read-only with respect to the global config file.
    for (const lock of ['team-web', 'core', 'no-such-profile', 'custom']) {
      writeProjectConfig(`schema: spec-driven\nprofile: ${lock}\n`);
      resolveProjectWorkflowSelection(catalog, projectDir, 'full', undefined, true);
      expect(fs.existsSync(globalConfigPath)).toBe(false);
    }
  });
});

describe('resolveUserWideProfileBase / saved-name user-wide profile', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-userwide-profile-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = path.join(tempDir, 'home');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reserved literals resolve byte-identically to getProfileWorkflows (regression pin)', () => {
    for (const profile of ['full', 'core', 'custom'] as const) {
      for (const explicit of [true, false]) {
        const custom = profile === 'custom' ? ['explore', 'apply'] : undefined;
        const base = resolveUserWideProfileBase(profile, custom, explicit);
        expect(base.ok).toBe(true);
        if (base.ok) {
          expect([...base.workflows].sort()).toEqual(
            [...getProfileWorkflows(profile, custom, { expertSelectionExplicit: explicit })].sort()
          );
        }
      }
    }
  });

  it('a saved name resolves to its stored workflow list verbatim', () => {
    saveNamedProfile('my-set', { version: 1, workflows: ['propose', 'apply', 'archive'] });
    const base = resolveUserWideProfileBase('my-set', undefined, true);
    expect(base.ok).toBe(true);
    if (base.ok) expect(base.workflows).toEqual(['propose', 'apply', 'archive']);
  });

  it('an unresolvable name returns a warning descriptor', () => {
    const base = resolveUserWideProfileBase('no-such-profile', undefined, true);
    expect(base.ok).toBe(false);
    if (!base.ok) {
      expect(base.warning.kind).toBe('unresolvable');
      expect(base.warning.profile).toBe('no-such-profile');
      expect(typeof base.warning.detail).toBe('string');
    }
  });

  it('resolveDesiredWorkflowSelection follows a saved user-wide profile (plus closure)', () => {
    // `verify-enhanced-command` pulls quality experts via its skill closure —
    // a saved user-wide name must include them exactly like a project lock.
    saveNamedProfile('leanteam', { version: 1, workflows: ['verify-enhanced-command'] });
    const { ids, profileWarning } = resolveDesiredWorkflowSelection(
      loadWorkflowCatalog(),
      'leanteam',
      undefined,
      true
    );
    expect(profileWarning).toBeUndefined();
    expect(ids).toContain('verify-enhanced-command');
    expect(ids).toContain('review');
    // A lean saved set does not pull in the whole catalog.
    expect(ids).not.toContain('audit');
  });

  it('an unresolvable saved user-wide profile degrades to full with a warning', () => {
    const catalog = loadWorkflowCatalog();
    const result = resolveDesiredWorkflowSelection(catalog, 'no-such-profile', undefined, true);
    const fullFallback = resolveDesiredWorkflowSelection(catalog, 'full', undefined, true);

    expect(result.profileWarning).toMatchObject({
      kind: 'unresolvable',
      profile: 'no-such-profile',
    });
    expect([...result.ids].sort()).toEqual([...fullFallback.ids].sort());
  });
});
