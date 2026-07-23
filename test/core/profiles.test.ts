import { describe, it, expect } from 'vitest';

import {
  ALL_EXPERTS,
  CORE_WORKFLOWS,
  ALL_WORKFLOWS,
  QUALITY_FLOOR_EXPERTS,
  getProfileWorkflows,
} from '../../src/core/profiles.js';
import { getExpertSkillDefinitions } from '../../src/core/workflow-registry/index.js';

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
});
