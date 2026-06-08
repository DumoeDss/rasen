import { describe, it, expect } from 'vitest';

import {
  CORE_WORKFLOWS,
  ALL_WORKFLOWS,
  getProfileWorkflows,
} from '../../src/core/profiles.js';

describe('profiles', () => {
  describe('CORE_WORKFLOWS', () => {
    it('should contain the five core workflows', () => {
      expect(CORE_WORKFLOWS).toEqual(['propose', 'explore', 'apply', 'archive', 'auto-command']);
    });

    it('should be a subset of ALL_WORKFLOWS', () => {
      for (const workflow of CORE_WORKFLOWS) {
        expect(ALL_WORKFLOWS).toContain(workflow);
      }
    });
  });

  describe('ALL_WORKFLOWS', () => {
    it('should contain all 17 workflows (11 base + 5 OPSX fusion + 1 review-cycle)', () => {
      expect(ALL_WORKFLOWS).toHaveLength(17);
    });

    it('should contain expected workflow IDs', () => {
      const expected = [
        'propose', 'explore', 'new', 'continue', 'apply',
        'ff', 'sync', 'archive', 'bulk-archive', 'verify', 'onboard',
        // OPSX fusion workflow commands
        'office-hours-command', 'verify-enhanced-command', 'ship-command',
        'retro-command', 'auto-command',
        // Iterative review loop (opt-in)
        'review-cycle',
      ];
      expect([...ALL_WORKFLOWS]).toEqual(expected);
    });

    it('should NOT include review-cycle in CORE_WORKFLOWS (opt-in only)', () => {
      expect(ALL_WORKFLOWS).toContain('review-cycle');
      expect([...CORE_WORKFLOWS]).not.toContain('review-cycle');
    });
  });

  describe('getProfileWorkflows', () => {
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
