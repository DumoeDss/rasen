import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  quoteYamlValue,
  needsYamlQuoting,
  yamlScalar,
} from '../../../src/core/shared/yaml.js';

describe('shared/yaml', () => {
  describe('needsYamlQuoting', () => {
    it('flags a colon-space sequence (the SKILL.md frontmatter defect)', () => {
      expect(needsYamlQuoting('Experimental: parses an internal transcript format.')).toBe(true);
    });

    it('flags a trailing colon and a space-hash sequence', () => {
      expect(needsYamlQuoting('trailing:')).toBe(true);
      expect(needsYamlQuoting('inline value # not a comment')).toBe(true);
    });

    it('flags leading indicator characters and token starters', () => {
      for (const value of ['@handle', '`code`', '- item', '? maybe', ': colon', '#hash', '[list]', '{map}', '*anchor', '!tag', '"quote', "'quote"]) {
        expect(needsYamlQuoting(value), value).toBe(true);
      }
    });

    it('flags leading/trailing whitespace, empty, and control characters', () => {
      expect(needsYamlQuoting('')).toBe(true);
      expect(needsYamlQuoting(' leading')).toBe(true);
      expect(needsYamlQuoting('trailing ')).toBe(true);
      expect(needsYamlQuoting('line\nbreak')).toBe(true);
      expect(needsYamlQuoting('tab\tchar')).toBe(true);
    });

    it('flags boolean/null/number-looking tokens so they keep string type', () => {
      for (const value of ['true', 'False', 'yes', 'NO', 'on', 'off', 'null', '~', '42', '-3.14', '1.0', '1e9']) {
        expect(needsYamlQuoting(value), value).toBe(true);
      }
    });

    it('leaves ordinary prose unquoted (em-dash, parens, commas, mid-word colons)', () => {
      for (const value of [
        'Initialize Rasen in your project',
        'Requires rasen CLI.',
        'rasen-audit',
        'MIT',
        'Diagnose a session — local, pull-model (Claude) or raw totals',
        'ratio:value',
        'a, b, and c',
      ]) {
        expect(needsYamlQuoting(value), value).toBe(false);
      }
    });
  });

  describe('yamlScalar', () => {
    it('returns safe values unchanged (no unnecessary churn)', () => {
      expect(yamlScalar('rasen-audit')).toBe('rasen-audit');
      expect(yamlScalar('Requires rasen CLI.')).toBe('Requires rasen CLI.');
    });

    it('quotes unsafe values via quoteYamlValue', () => {
      const value = 'Experimental: parses an internal transcript format.';
      expect(yamlScalar(value)).toBe(quoteYamlValue(value));
    });

    it('produces a mapping that round-trips through a strict YAML parser', () => {
      const description = 'Diagnose token spend — local. Experimental: parses an internal transcript format.';
      const frontmatter = `description: ${yamlScalar(description)}`;
      const parsed = parseYaml(frontmatter) as { description: string };
      expect(parsed.description).toBe(description);
    });

    it('parses the same when the value is a plain safe scalar', () => {
      const description = 'Initialize Rasen in your project';
      const parsed = parseYaml(`description: ${yamlScalar(description)}`) as { description: string };
      expect(parsed.description).toBe(description);
    });
  });
});
