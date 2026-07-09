import { describe, it, expect } from 'vitest';
import { transformToHyphenCommands } from '../../src/utils/command-references.js';

describe('transformToHyphenCommands', () => {
  describe('basic transformations', () => {
    it('should transform single command reference', () => {
      expect(transformToHyphenCommands('/rasen:new')).toBe('/rasen-new');
    });

    it('should transform multiple command references', () => {
      const input = '/rasen:new and /rasen:apply';
      const expected = '/rasen-new and /rasen-apply';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });

    it('should transform command reference in context', () => {
      const input = 'Use /rasen:apply to implement tasks';
      const expected = 'Use /rasen-apply to implement tasks';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });

    it('should handle backtick-quoted commands', () => {
      const input = 'Run `/rasen:continue` to proceed';
      const expected = 'Run `/rasen-continue` to proceed';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('edge cases', () => {
    it('should return unchanged text with no command references', () => {
      const input = 'This is plain text without commands';
      expect(transformToHyphenCommands(input)).toBe(input);
    });

    it('should return empty string unchanged', () => {
      expect(transformToHyphenCommands('')).toBe('');
    });

    it('should not transform similar but non-matching patterns', () => {
      const input = '/ops:new rasen: /other:command';
      expect(transformToHyphenCommands(input)).toBe(input);
    });

    it('should handle multiple occurrences on same line', () => {
      const input = '/rasen:new /rasen:continue /rasen:apply';
      const expected = '/rasen-new /rasen-continue /rasen-apply';
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('multiline content', () => {
    it('should transform references across multiple lines', () => {
      const input = `Use /rasen:new to start
Then /rasen:continue to proceed
Finally /rasen:apply to implement`;
      const expected = `Use /rasen-new to start
Then /rasen-continue to proceed
Finally /rasen-apply to implement`;
      expect(transformToHyphenCommands(input)).toBe(expected);
    });
  });

  describe('all known commands', () => {
    const commands = [
      'new',
      'continue',
      'apply',
      'ff',
      'sync',
      'archive',
      'bulk-archive',
      'verify',
      'explore',
      'onboard',
    ];

    for (const cmd of commands) {
      it(`should transform /rasen:${cmd}`, () => {
        expect(transformToHyphenCommands(`/rasen:${cmd}`)).toBe(`/rasen-${cmd}`);
      });
    }
  });
});
