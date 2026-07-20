import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  formatPickerDescription,
  resolveTerminalColumns,
} from '../../src/utils/terminal-text.js';

describe('formatPickerDescription', () => {
  it('limits an overflowing description to two visual lines', () => {
    expect(formatPickerDescription('alpha beta gamma delta', 11)).toBe(
      'alpha beta\ngamma...'
    );
  });

  it('leaves descriptions unchanged when they fit within two lines', () => {
    expect(formatPickerDescription('short description', 40)).toBe('short description');
    expect(formatPickerDescription('alpha beta gamma', 11)).toBe('alpha beta\ngamma');
  });

  it('measures fullwidth Japanese text in terminal columns', () => {
    expect(formatPickerDescription('日本語日本語', 7)).toBe('日本語\n日本語');
    expect(formatPickerDescription('日本語日本語日本語', 7)).toBe('日本語\n日...');
  });

  it('does not split emoji or combining grapheme clusters', () => {
    expect(formatPickerDescription('ab👨‍👩‍👧‍👦cd👨‍👩‍👧‍👦ef', 5)).toBe(
      'ab👨‍👩‍👧‍👦\nc...'
    );
    expect(formatPickerDescription('ééééééé', 4)).toBe('ééé\n...');
    expect(formatPickerDescription('a᪰a᪰a᪰a᪰a᪰', 6)).toBe('a᪰a᪰\na᪰...');
  });

  it('hard-wraps long tokens without wasting the preceding line', () => {
    expect(formatPickerDescription('abcdefghijk', 6)).toBe('abcde\nfg...');
    expect(formatPickerDescription('a bcdefg', 6)).toBe('a bcd\nefg');
  });

  it('uses narrow ambiguous-width characters and trims whitespace before the marker', () => {
    expect(formatPickerDescription('·······', 6)).toBe('·····\n··');
    expect(formatPickerDescription('alpha beta     gamma delta', 11)).toBe(
      'alpha beta\ngamma...'
    );
  });

  it('keeps the overflow marker within very narrow terminal widths', () => {
    expect(formatPickerDescription('abcdef', 2)).toBe('a\n.');
    expect(formatPickerDescription('abcdef', 3)).toBe('ab\n..');
    expect(formatPickerDescription('abcdefg', 4)).toBe('abc\n...');
    expect(formatPickerDescription('日本語', 2)).toBe('.');
  });
});

describe('resolveTerminalColumns', () => {
  it('reads the active output stream width', () => {
    const output = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    Object.assign(output, { getWindowSize: () => [42, 24] });

    expect(resolveTerminalColumns(output)).toBe(42);
  });

  it('falls back to 80 when a non-TTY output has no width', () => {
    const output = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    const originalCliWidth = process.env.CLI_WIDTH;
    delete process.env.CLI_WIDTH;

    try {
      expect(resolveTerminalColumns(output)).toBe(80);
    } finally {
      if (originalCliWidth === undefined) delete process.env.CLI_WIDTH;
      else process.env.CLI_WIDTH = originalCliWidth;
    }
  });

  it('falls back to 80 for an invalid width', () => {
    const output = new Writable({ write: (_chunk, _encoding, callback) => callback() });
    Object.assign(output, { getWindowSize: () => [0.5, 24] });

    expect(resolveTerminalColumns(output)).toBe(80);
  });
});
