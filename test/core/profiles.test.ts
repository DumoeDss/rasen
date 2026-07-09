import { describe, it, expect } from 'vitest';

import {
  CORE_WORKFLOWS,
  ALL_WORKFLOWS,
  getProfileWorkflows,
} from '../../src/core/profiles.js';

describe('profiles', () => {
  describe('CORE_WORKFLOWS', () => {
    it('should contain the default core workflows', () => {
      expect(CORE_WORKFLOWS).toEqual(['propose', 'explore', 'apply', 'sync', 'archive', 'auto-command']);
    });

    it('should be a subset of ALL_WORKFLOWS', () => {
      for (const workflow of CORE_WORKFLOWS) {
        expect(ALL_WORKFLOWS).toContain(workflow);
      }
    });
  });

  describe('ALL_WORKFLOWS', () => {
    it('should contain all 22 workflows (11 base + 5 Rasen fusion + review-cycle + handoff + 4 goal-loop)', () => {
      expect(ALL_WORKFLOWS).toHaveLength(22);
    });

    it('should contain expected workflow IDs', () => {
      const expected = [
        'propose', 'explore', 'new', 'continue', 'apply',
        'ff', 'sync', 'archive', 'bulk-archive', 'verify', 'onboard',
        // Rasen fusion workflow commands
        'office-hours-command', 'verify-enhanced-command', 'ship-command',
        'retro-command', 'auto-command',
        // Iterative review loop (opt-in)
        'review-cycle',
        // Context handoff (opt-in)
        'handoff',
        // Goal-loop workflow family (opt-in)
        'goal-plan', 'goal-iterate', 'goal-report', 'goal-command',
      ];
      expect([...ALL_WORKFLOWS]).toEqual(expected);
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

  describe('getProfileWorkflows', () => {
    it('should return all workflows for full profile (default)', () => {
      const result = getProfileWorkflows('full');
      expect(result).toEqual(ALL_WORKFLOWS);
    });

    it('should return all workflows for full profile even if customWorkflows provided', () => {
      const result = getProfileWorkflows('full', ['new', 'apply']);
      expect(result).toEqual(ALL_WORKFLOWS);
    });

    it('should return core workflows for core profile', () => {
      const result = getProfileWorkflows('core');
      expect(result).toEqual(CORE_WORKFLOWS);
    });

    it('should return core workflows for core profile even if customWorkflows provided', () => {
      const result = getProfileWorkflows('core', ['new', 'apply']);
      expect(result).toEqual(CORE_WORKFLOWS);
    });

    it('should return custom workflows for custom profile', () => {
      const customWorkflows = ['explore', 'new', 'apply', 'ff'];
      const result = getProfileWorkflows('custom', customWorkflows);
      expect(result).toEqual(customWorkflows);
    });

    it('should return empty array for custom profile with no customWorkflows', () => {
      const result = getProfileWorkflows('custom');
      expect(result).toEqual([]);
    });

    it('should return empty array for custom profile with empty customWorkflows', () => {
      const result = getProfileWorkflows('custom', []);
      expect(result).toEqual([]);
    });
  });
});
