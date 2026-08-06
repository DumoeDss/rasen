import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Whitespace errors, named the way git names them.
 *
 * These mirror git's default `core.whitespace` set (`blank-at-eol`,
 * `space-before-tab`, `blank-at-eof`) — the same rules the `git diff --check`
 * step in CI enforces over a pull request's whole diff.
 */
export type WhitespaceViolationKind =
  | 'trailing-whitespace'
  | 'space-before-tab'
  | 'blank-at-eof';

export interface WhitespaceViolation {
  /** Path relative to the scanned root, with forward slashes. */
  file: string;
  /** 1-based line number, matching how git and editors report positions. */
  line: number;
  kind: WhitespaceViolationKind;
}

const BINARY_SNIFF_BYTES = 8000;

/** A NUL byte in the leading bytes is git's own heuristic for "binary". */
export function looksBinary(content: Buffer): boolean {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

/**
 * Report every whitespace error in one file's bytes.
 *
 * Returns all of them rather than the first: fixing these one CI cycle at a
 * time is the exact failure mode this guard exists to remove.
 */
export function scanContentForWhitespaceViolations(
  content: Buffer,
  file: string
): WhitespaceViolation[] {
  if (looksBinary(content)) return [];

  const violations: WhitespaceViolation[] = [];
  const text = content.toString('utf8');
  if (text.length === 0) return violations;

  const hasFinalNewline = text.endsWith('\n');
  // A trailing newline terminates the last line rather than starting an empty
  // one, so drop the artifact of splitting on it.
  const lines = text.split('\n');
  if (hasFinalNewline) lines.pop();

  lines.forEach((rawLine, index) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (/[ \t]$/u.test(line)) {
      violations.push({ file, line: index + 1, kind: 'trailing-whitespace' });
    }
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? '';
    if (indent.includes(' \t')) {
      violations.push({ file, line: index + 1, kind: 'space-before-tab' });
    }
  });

  // blank-at-eof: any blank line at the end of the file. A file that simply
  // ends with a single terminating newline is not blank-at-eof.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.trim() !== '') break;
    violations.push({ file, line: index + 1, kind: 'blank-at-eof' });
  }

  return violations.sort((left, right) => left.line - right.line);
}

async function collectFiles(root: string, relative: string): Promise<string[]> {
  const absolute = path.join(root, relative);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Symlinks are not followed: the scan must describe the directory's own
    // bytes, not wherever a link happens to point.
    if (entry.isSymbolicLink()) continue;
    const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, next)));
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

/**
 * Scan a directory tree, reporting every whitespace error in every text file.
 * Binary files are skipped. Results are ordered by path, then by line.
 */
export async function scanDirectoryForWhitespaceViolations(
  root: string
): Promise<WhitespaceViolation[]> {
  let files: string[];
  try {
    files = await collectFiles(root, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const violations: WhitespaceViolation[] = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(root, file));
    violations.push(...scanContentForWhitespaceViolations(content, file));
  }
  return violations;
}

/**
 * Render violations the way a developer can act on them: `file:line kind`,
 * every offender listed, plus the two legitimate fixes for the Markdown hard
 * break that produces most of them.
 */
export function formatWhitespaceViolations(
  violations: readonly WhitespaceViolation[]
): string {
  const lines = violations.map(
    violation => `  ${violation.file}:${violation.line}: ${violation.kind}`
  );
  return [
    `Whitespace errors in ${violations.length === 1 ? '1 line' : `${violations.length} lines`}:`,
    ...lines,
    '',
    'These usually arrive with a file authored outside the repository — an',
    'evidence report or handoff document written into the artifact store and',
    'then copied in. Fix the source file, not just the copy.',
    '',
    'A line ending in two spaces is a Markdown hard break. Either drop the',
    'trailing spaces (the following line joins the paragraph), or replace them',
    'with a trailing backslash (identical rendering, no whitespace).',
    '',
    'CI rejects these in its lint job (git diff --check), so an archive made',
    'with them will not merge. To archive anyway: --no-whitespace-check',
  ].join('\n');
}
