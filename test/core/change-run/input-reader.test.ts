import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  InputReaderError,
  readBoundedJson,
} from '../../../src/core/change-run/internal/input-reader.js';

describe('bounded no-follow input reader (12.5/12.6)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rasen-input-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads valid JSON within the bound', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(file, '{"status":"succeeded"}');
    expect(readBoundedJson(file)).toEqual({ status: 'succeeded' });
  });

  it('rejects oversized input', () => {
    const file = join(dir, 'big.json');
    writeFileSync(file, 'x'.repeat(200));
    expect(() => readBoundedJson(file, 100)).toThrowError(InputReaderError);
  });

  it('rejects malformed JSON', () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{not json');
    expect(() => readBoundedJson(file)).toThrowError(InputReaderError);
  });

  it('rejects a symlink (no-follow)', () => {
    const target = join(dir, 'real.json');
    writeFileSync(target, '{"ok":true}');
    const link = join(dir, 'link.json');
    try { symlinkSync(target, link); } catch { return; } // skip if symlinks unsupported
    expect(() => readBoundedJson(link)).toThrowError(InputReaderError);
  });

  it('rejects a missing file', () => {
    expect(() => readBoundedJson(join(dir, 'nope.json'))).toThrowError(InputReaderError);
  });
});
