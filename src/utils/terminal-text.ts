import type { Stream } from 'node:stream';

import cliWidth from 'cli-width';
import stringWidth from 'string-width';
import legacyStringWidth from 'string-width-legacy';

const DEFAULT_TERMINAL_COLUMNS = 80;
const RIGHT_MARGIN_COLUMNS = 1;
const MAX_DESCRIPTION_LINES = 2;
const OVERFLOW_MARKER = '...';

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

interface DisplaySegment {
  text: string;
  width: number;
  whitespace: boolean;
}

interface LineSlice {
  text: string;
  nextIndex: number;
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

function displaySegments(text: string): DisplaySegment[] {
  return [...graphemeSegmenter.segment(text)].map(({ segment }) => ({
    text: segment,
    width: measureDisplayWidth(segment),
    whitespace: /^\s+$/u.test(segment),
  }));
}

function skipWhitespace(segments: readonly DisplaySegment[], index: number): number {
  let next = index;
  while (next < segments.length && segments[next].whitespace) next++;
  return next;
}

function joinTrimmed(segments: readonly DisplaySegment[], start: number, end: number): string {
  let trimmedEnd = end;
  while (trimmedEnd > start && segments[trimmedEnd - 1].whitespace) trimmedEnd--;
  return segments.slice(start, trimmedEnd).map((segment) => segment.text).join('');
}

function tokenWidth(segments: readonly DisplaySegment[], start: number): number {
  let width = 0;
  for (let index = start; index < segments.length && !segments[index].whitespace; index++) {
    width += segments[index].width;
  }
  return width;
}

function takeDisplayLine(
  segments: readonly DisplaySegment[],
  startIndex: number,
  maxWidth: number
): LineSlice {
  const start = skipWhitespace(segments, startIndex);
  let index = start;
  let width = 0;
  let lastWhitespace = -1;

  while (index < segments.length) {
    const segment = segments[index];
    if (width + segment.width > maxWidth) {
      if (segment.whitespace) {
        return {
          text: joinTrimmed(segments, start, index),
          nextIndex: skipWhitespace(segments, index + 1),
        };
      }
      if (lastWhitespace >= start) {
        const nextToken = skipWhitespace(segments, lastWhitespace + 1);
        if (tokenWidth(segments, nextToken) <= maxWidth) {
          return {
            text: joinTrimmed(segments, start, lastWhitespace),
            nextIndex: nextToken,
          };
        }
      }
      if (index === start) {
        return { text: '', nextIndex: index + 1 };
      }
      return { text: joinTrimmed(segments, start, index), nextIndex: index };
    }

    width += segment.width;
    if (segment.whitespace) lastWhitespace = index;
    index++;
  }

  return { text: joinTrimmed(segments, start, index), nextIndex: index };
}

function truncateToWidth(text: string, maxWidth: number): string {
  const kept: string[] = [];
  let width = 0;

  for (const segment of displaySegments(text)) {
    if (width + segment.width > maxWidth) break;
    kept.push(segment.text);
    width += segment.width;
  }

  return kept.join('').trimEnd();
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
  const segments = displaySegments(text);
  const lines: string[] = [];
  let index = 0;

  for (let line = 0; line < MAX_DESCRIPTION_LINES && index < segments.length; line++) {
    const slice = takeDisplayLine(segments, index, usableColumns);
    if (slice.text.length === 0 && slice.nextIndex > index) {
      return '.'.repeat(Math.min(OVERFLOW_MARKER.length, usableColumns));
    }
    lines.push(slice.text);
    index = slice.nextIndex;
  }

  const overflow = segments.slice(index).some((segment) => !segment.whitespace);
  if (!overflow) return lines.join('\n');

  while (lines.length < MAX_DESCRIPTION_LINES) lines.push('');
  const marker = '.'.repeat(Math.min(OVERFLOW_MARKER.length, usableColumns));
  const secondLineWidth = Math.max(0, usableColumns - measureDisplayWidth(marker));
  lines[MAX_DESCRIPTION_LINES - 1] =
    truncateToWidth(lines[MAX_DESCRIPTION_LINES - 1], secondLineWidth) + marker;

  return lines.join('\n');
}
