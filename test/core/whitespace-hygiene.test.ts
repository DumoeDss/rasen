import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  formatWhitespaceViolations,
  looksBinary,
  scanContentForWhitespaceViolations,
  scanDirectoryForWhitespaceViolations,
} from '../../src/core/whitespace-hygiene.js';

const created: string[] = [];

function tempDir(): string {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ws-'))
  );
  created.push(dir);
  return dir;
}

function scan(content: string) {
  return scanContentForWhitespaceViolations(Buffer.from(content, 'utf8'), 'f.md');
}

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});

describe('whitespace hygiene scanner', () => {
  it('reports the markdown hard break that CI rejects', () => {
    // Two trailing spaces: a real Markdown hard break, and the exact shape that
    // rode into the repository inside an imported verification report.
    expect(scan('title  \nbody\n')).toEqual([
      { file: 'f.md', line: 1, kind: 'trailing-whitespace' },
    ]);
  });

  it('reports every offending line rather than stopping at the first', () => {
    const violations = scan('a \nb\nc\t\nd  \n');
    expect(violations.map(violation => violation.line)).toEqual([1, 3, 4]);
  });

  it('flags a space before a tab in the indent', () => {
    const violations = scan(' \tindented\n');
    expect(violations.map(violation => violation.kind)).toContain('space-before-tab');
  });

  it('flags blank lines at end of file but not a plain final newline', () => {
    expect(scan('body\n')).toEqual([]);
    expect(scan('body\n\n\n').map(violation => violation.kind)).toEqual([
      'blank-at-eof',
      'blank-at-eof',
    ]);
  });

  it('accepts the backslash hard break that preserves rendering', () => {
    expect(scan('title\\\nbody\n')).toEqual([]);
  });

  it('treats content with a NUL byte as binary and skips it', () => {
    const binary = Buffer.from([0x50, 0x4b, 0x00, 0x20, 0x20, 0x0a]);
    expect(looksBinary(binary)).toBe(true);
    expect(scanContentForWhitespaceViolations(binary, 'a.bin')).toEqual([]);
  });

  it('walks a directory, skips binaries, and orders results by path then line', async () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'evidence', 'report.md'), 'x  \ny\nz \n');
    fs.writeFileSync(path.join(root, 'clean.md'), 'fine\n');
    fs.writeFileSync(path.join(root, 'blob.bin'), Buffer.from([0x00, 0x20, 0x0a]));

    const violations = await scanDirectoryForWhitespaceViolations(root);
    expect(violations).toEqual([
      { file: 'evidence/report.md', line: 1, kind: 'trailing-whitespace' },
      { file: 'evidence/report.md', line: 3, kind: 'trailing-whitespace' },
    ]);
  });

  it('returns nothing for a directory that does not exist', async () => {
    expect(await scanDirectoryForWhitespaceViolations(path.join(tempDir(), 'nope'))).toEqual([]);
  });

  it('names both legitimate hard-break fixes in the failure text', () => {
    const message = formatWhitespaceViolations([
      { file: 'evidence/report.md', line: 38, kind: 'trailing-whitespace' },
    ]);
    expect(message).toContain('evidence/report.md:38');
    expect(message).toContain('backslash');
    expect(message).toContain('--no-whitespace-check');
  });
});
