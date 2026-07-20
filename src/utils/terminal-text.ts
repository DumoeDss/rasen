import type { Stream } from 'node:stream';

import cliWidth from 'cli-width';
import stringWidth from 'string-width';
import legacyStringWidth from 'string-width-legacy';

const DEFAULT_TERMINAL_COLUMNS = 80;
const RIGHT_MARGIN_COLUMNS = 1;
const MAX_DESCRIPTION_LINES = 2;
const OVERFLOW_MARKER = '...';
const MAX_FORMATTED_CODE_UNITS = 4096;
const MAX_SEGMENTATION_CODE_UNITS = MAX_FORMATTED_CODE_UNITS * 2;
const MIN_CONTENT_CODE_UNITS = 256;
const CODE_UNITS_PER_COLUMN = 16;

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

interface DisplaySegment {
  text: string;
  width: number;
  whitespace: boolean;
}

interface LineSlice {
  segments: DisplaySegment[];
  nextIndex: number;
  overflow: boolean;
  unrenderable: boolean;
}

function normalizeTerminalColumns(columns: number): number {
  const normalized = Math.floor(columns);
  return Number.isFinite(normalized) && normalized > 0
    ? normalized
    : DEFAULT_TERMINAL_COLUMNS;
}

function measureDisplayWidth(text: string): number {
  // The current Inquirer renderer uses string-width 4. Use the larger
  // measurement so its second wrapping pass cannot split modern graphemes.
  return Math.max(stringWidth(text), legacyStringWidth(text));
}

class LazyDisplaySegments {
  private readonly buffer: DisplaySegment[] = [];
  private readonly iterator: Iterator<Intl.SegmentData>;
  private readonly sourceTruncated: boolean;
  private readonly segmentedTextLength: number;
  private baseIndex = 0;
  private exhausted = false;
  private hiddenRemainder = false;

  constructor(text: string) {
    const segmentedText = text.slice(0, MAX_SEGMENTATION_CODE_UNITS);
    this.iterator = graphemeSegmenter.segment(segmentedText)[Symbol.iterator]();
    this.sourceTruncated = segmentedText.length < text.length;
    this.segmentedTextLength = segmentedText.length;
  }

  get(index: number): DisplaySegment | undefined {
    if (index < this.baseIndex) {
      throw new RangeError('Cannot read a discarded display segment');
    }

    while (index >= this.baseIndex + this.buffer.length) {
      if (!this.loadNext()) return undefined;
    }

    return this.buffer[index - this.baseIndex];
  }

  hasRemaining(index: number): boolean {
    return this.get(index) !== undefined || this.hiddenRemainder;
  }

  hasHiddenRemainder(): boolean {
    return this.hiddenRemainder;
  }

  sliceTrimmed(start: number, end: number): DisplaySegment[] {
    const selected: DisplaySegment[] = [];
    for (let index = start; index < end; index++) {
      const segment = this.get(index);
      if (!segment) break;
      selected.push(segment);
    }
    while (selected.at(-1)?.whitespace) selected.pop();
    return selected;
  }

  discardBefore(index: number): void {
    const count = Math.min(Math.max(0, index - this.baseIndex), this.buffer.length);
    if (count === 0) return;
    this.buffer.splice(0, count);
    this.baseIndex += count;
  }

  private loadNext(): boolean {
    if (this.exhausted) return false;

    const result = this.iterator.next();
    if (result.done) {
      this.exhausted = true;
      this.hiddenRemainder = this.sourceTruncated;
      return false;
    }

    const { segment, index } = result.value;
    if (this.sourceTruncated && index + segment.length >= this.segmentedTextLength) {
      // The last segment of a sliced prefix may continue beyond the slice. Do not
      // emit part of a grapheme merely to reach the formatter's work boundary.
      this.exhausted = true;
      this.hiddenRemainder = true;
      return false;
    }

    this.buffer.push({
      text: segment,
      width: measureDisplayWidth(segment),
      whitespace: /^\s+$/u.test(segment),
    });
    return true;
  }
}

function contentCodeUnitLimit(usableColumns: number): number {
  const structuralCodeUnits = OVERFLOW_MARKER.length + MAX_DESCRIPTION_LINES - 1;
  const maximumContent = MAX_FORMATTED_CODE_UNITS - structuralCodeUnits;
  return Math.min(
    maximumContent,
    Math.max(MIN_CONTENT_CODE_UNITS, usableColumns * CODE_UNITS_PER_COLUMN)
  );
}

function skipWhitespace(segments: LazyDisplaySegments, index: number): number {
  let next = index;
  while (segments.get(next)?.whitespace) next++;
  return next;
}

function tokenFitsLine(
  segments: LazyDisplaySegments,
  start: number,
  maxWidth: number,
  maxCodeUnits: number
): boolean {
  let width = 0;
  let codeUnits = 0;

  for (let index = start; ; index++) {
    const segment = segments.get(index);
    if (!segment) return !segments.hasHiddenRemainder();
    if (segment.whitespace) return true;

    codeUnits += segment.text.length;
    if (codeUnits > maxCodeUnits || width + segment.width > maxWidth) return false;
    width += segment.width;
  }
}

function takeDisplayLine(
  segments: LazyDisplaySegments,
  startIndex: number,
  maxWidth: number,
  maxCodeUnits: number
): LineSlice {
  const start = skipWhitespace(segments, startIndex);
  let index = start;
  let width = 0;
  let codeUnits = 0;
  let lastWhitespace = -1;

  for (;;) {
    const segment = segments.get(index);
    if (!segment) {
      return {
        segments: segments.sliceTrimmed(start, index),
        nextIndex: index,
        overflow: segments.hasHiddenRemainder(),
        unrenderable: false,
      };
    }

    if (width + segment.width > maxWidth) {
      if (segment.whitespace) {
        return {
          segments: segments.sliceTrimmed(start, index),
          nextIndex: skipWhitespace(segments, index + 1),
          overflow: false,
          unrenderable: false,
        };
      }
      if (lastWhitespace >= start) {
        const nextToken = skipWhitespace(segments, lastWhitespace + 1);
        if (tokenFitsLine(segments, nextToken, maxWidth, maxCodeUnits)) {
          return {
            segments: segments.sliceTrimmed(start, lastWhitespace),
            nextIndex: nextToken,
            overflow: false,
            unrenderable: false,
          };
        }
      }
      if (index === start) {
        return {
          segments: [],
          nextIndex: index + 1,
          overflow: false,
          unrenderable: true,
        };
      }
      return {
        segments: segments.sliceTrimmed(start, index),
        nextIndex: index,
        overflow: false,
        unrenderable: false,
      };
    }

    if (codeUnits + segment.text.length > maxCodeUnits) {
      return {
        segments: segments.sliceTrimmed(start, index),
        nextIndex: index,
        overflow: true,
        unrenderable: false,
      };
    }

    width += segment.width;
    codeUnits += segment.text.length;
    if (segment.whitespace) lastWhitespace = index;
    index++;
  }
}

function displayText(segments: readonly DisplaySegment[]): string {
  return segments.map((segment) => segment.text).join('');
}

function truncateToWidth(
  segments: readonly DisplaySegment[],
  maxWidth: number
): DisplaySegment[] {
  const kept: DisplaySegment[] = [];
  let width = 0;

  for (const segment of segments) {
    if (width + segment.width > maxWidth) break;
    kept.push(segment);
    width += segment.width;
  }
  while (kept.at(-1)?.whitespace) kept.pop();
  return kept;
}

export function resolveTerminalColumns(output: Stream = process.stdout): number {
  return normalizeTerminalColumns(cliWidth({ output, defaultWidth: DEFAULT_TERMINAL_COLUMNS }));
}

export function formatPickerDescription(description: string, terminalColumns: number): string {
  const text = description.trim();
  if (text.length === 0) return '';

  const usableColumns = Math.max(
    1,
    normalizeTerminalColumns(terminalColumns) - RIGHT_MARGIN_COLUMNS
  );
  const segments = new LazyDisplaySegments(text);
  const lines: DisplaySegment[][] = [];
  let remainingCodeUnits = contentCodeUnitLimit(usableColumns);
  let index = 0;
  let overflow = false;

  for (let line = 0; line < MAX_DESCRIPTION_LINES && segments.hasRemaining(index); line++) {
    const slice = takeDisplayLine(segments, index, usableColumns, remainingCodeUnits);
    if (slice.unrenderable || (lines.length === 0 && slice.overflow && slice.segments.length === 0)) {
      return '.'.repeat(Math.min(OVERFLOW_MARKER.length, usableColumns));
    }

    if (slice.segments.length > 0) {
      lines.push(slice.segments);
      remainingCodeUnits -= displayText(slice.segments).length;
    }
    index = slice.nextIndex;
    segments.discardBefore(index);

    if (slice.overflow) {
      overflow = true;
      break;
    }
  }

  overflow ||= segments.hasRemaining(index);
  if (!overflow) return lines.map(displayText).join('\n');

  while (lines.length < MAX_DESCRIPTION_LINES) lines.push([]);
  const marker = '.'.repeat(Math.min(OVERFLOW_MARKER.length, usableColumns));
  const secondLineWidth = Math.max(0, usableColumns - measureDisplayWidth(marker));
  lines[MAX_DESCRIPTION_LINES - 1] = truncateToWidth(
    lines[MAX_DESCRIPTION_LINES - 1],
    secondLineWidth
  );

  return lines
    .map((line, lineIndex) =>
      displayText(line) + (lineIndex === MAX_DESCRIPTION_LINES - 1 ? marker : '')
    )
    .join('\n');
}
