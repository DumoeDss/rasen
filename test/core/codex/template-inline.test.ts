import { describe, expect, it } from 'vitest';
import { inlineCommandTemplate } from '../../../src/core/codex/template-inline.js';

describe('inlineCommandTemplate', () => {
  it('strips a leading YAML frontmatter block', () => {
    const source = `---\ndescription: test\nargument-hint: args\n---\n\nBody text with $ARGUMENTS here.`;
    const result = inlineCommandTemplate(source, 'hello');
    expect(result).not.toContain('---');
    expect(result).not.toContain('description:');
    expect(result).toContain('Body text with hello here.');
  });

  it('passes through a source with no frontmatter unchanged (aside from substitution)', () => {
    const source = 'Plain body, no frontmatter, no placeholder.';
    const result = inlineCommandTemplate(source, '');
    expect(result).toBe(source);
  });

  it('substitutes every $ARGUMENTS occurrence', () => {
    const source = '$ARGUMENTS first, then $ARGUMENTS again.';
    const result = inlineCommandTemplate(source, 'X');
    expect(result).toBe('X first, then X again.');
  });

  it('appends a trailing ARGUMENTS line when the body has no placeholder and args are non-empty', () => {
    const source = 'Body with no placeholder.';
    const result = inlineCommandTemplate(source, 'foo bar');
    expect(result).toBe('Body with no placeholder.\n\nARGUMENTS: foo bar');
  });

  it('does not append anything when args are empty and there is no placeholder', () => {
    const source = 'Body with no placeholder.';
    const result = inlineCommandTemplate(source, '');
    expect(result).toBe('Body with no placeholder.');
  });

  it('strips frontmatter and substitutes together', () => {
    const source = `---\ndescription: d\n---\nHello $ARGUMENTS.`;
    const result = inlineCommandTemplate(source, 'world');
    expect(result).toBe('Hello world.');
  });
});
