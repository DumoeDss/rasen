import { Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  formatPickerDescription,
  resolveTerminalColumns,
  resolveTerminalRows,
} from '../../src/utils/terminal-text.js';

const NEAR_LIMIT_DESCRIPTION_CODE_UNITS = 1024 * 1024 - 1;

interface SegmentWork {
  output: string;
  segmentedInputCodeUnits: number;
  segmentReads: number;
}

function formatWithSegmentWork(description: string, terminalColumns: number): SegmentWork {
  const originalSegment = Intl.Segmenter.prototype.segment;
  let segmentedInputCodeUnits = 0;
  let segmentReads = 0;
  const segmentSpy = vi.spyOn(Intl.Segmenter.prototype, 'segment').mockImplementation(function (
    this: Intl.Segmenter,
    input: string
  ): Intl.Segments {
    const segments = originalSegment.call(this, input);
    segmentedInputCodeUnits = Math.max(segmentedInputCodeUnits, input.length);

    return {
      containing: (codeUnitIndex?: number) => segments.containing(codeUnitIndex),
      [Symbol.iterator]() {
        const iterator = segments[Symbol.iterator]();
        return {
          next() {
            segmentReads++;
            return iterator.next();
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      },
    } as unknown as Intl.Segments;
  });

  try {
    return {
      output: formatPickerDescription(description, terminalColumns),
      segmentedInputCodeUnits,
      segmentReads,
    };
  } finally {
    segmentSpy.mockRestore();
  }
}

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

  it('segments only a bounded prefix of a near-limit ASCII description', () => {
    const description = 'alpha '
      .repeat(Math.ceil(NEAR_LIMIT_DESCRIPTION_CODE_UNITS / 6))
      .slice(0, NEAR_LIMIT_DESCRIPTION_CODE_UNITS);
    const work = formatWithSegmentWork(description, 20);

    expect(work.output).toBe('alpha alpha alpha\nalpha alpha alph...');
    expect(work.segmentedInputCodeUnits).toBeLessThan(16 * 1024);
    expect(work.segmentReads).toBeLessThan(100);
  });

  it('bounds lookahead for a near-limit long token', () => {
    const description =
      'prefix ' + 'x'.repeat(NEAR_LIMIT_DESCRIPTION_CODE_UNITS - 'prefix '.length);
    const work = formatWithSegmentWork(description, 20);

    expect(work.output).toBe('prefix xxxxxxxxxxxx\nxxxxxxxxxxxxxxxx...');
    expect(work.segmentedInputCodeUnits).toBeLessThan(16 * 1024);
    expect(work.segmentReads).toBeLessThan(100);
  });

  it('bounds zero-width work and output without splitting a grapheme', () => {
    const separateGraphemes = formatWithSegmentWork(
      '\0'.repeat(NEAR_LIMIT_DESCRIPTION_CODE_UNITS),
      80
    );
    const singleGrapheme = formatWithSegmentWork(
      '\u0301'.repeat(NEAR_LIMIT_DESCRIPTION_CODE_UNITS),
      80
    );

    expect(separateGraphemes.output.split('\n')).toHaveLength(2);
    expect(separateGraphemes.output.endsWith('...')).toBe(true);
    expect(separateGraphemes.output.length).toBeLessThanOrEqual(4096);
    expect(separateGraphemes.segmentReads).toBeLessThan(4096);
    expect(singleGrapheme.output).toBe('...');
    expect(singleGrapheme.segmentedInputCodeUnits).toBeLessThan(16 * 1024);
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

describe('resolveTerminalRows', () => {
  it('prefers a positive integer rows property', () => {
    expect(resolveTerminalRows({ rows: 24, getWindowSize: () => [80, 12] })).toBe(24);
  });

  it('falls back to the height from getWindowSize', () => {
    expect(resolveTerminalRows({ getWindowSize: () => [80, 12] })).toBe(12);
  });

  it('returns undefined when terminal height is unavailable', () => {
    expect(resolveTerminalRows({})).toBeUndefined();
  });

  it.each([NaN, Infinity, 0, -1, 12.5])(
    'returns undefined for invalid rows %s',
    (rows) => {
      expect(resolveTerminalRows({ rows })).toBeUndefined();
    }
  );

  it('falls back to getWindowSize when reading rows throws', () => {
    const output = {
      get rows(): number {
        throw new Error('rows unavailable');
      },
      getWindowSize: (): [number, number] => [80, 24],
    };

    expect(resolveTerminalRows(output)).toBe(24);
  });

  it('returns undefined when both terminal row sources throw', () => {
    const output = {
      get rows(): number {
        throw new Error('rows unavailable');
      },
      getWindowSize: (): [number, number] => {
        throw new Error('window size unavailable');
      },
    };

    expect(resolveTerminalRows(output)).toBeUndefined();
  });

  it('returns undefined when getWindowSize throws', () => {
    expect(resolveTerminalRows({
      getWindowSize: () => {
        throw new Error('window size unavailable');
      },
    })).toBeUndefined();
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
