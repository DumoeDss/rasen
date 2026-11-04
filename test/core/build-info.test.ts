import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import {
  formatCliVersion,
  localBuildInfoPath,
  readLocalBuildInfo,
} from '../../src/core/shared/build-info.js';

describe('local build provenance', () => {
  let testDir: string;
  let stampPath: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-build-info-${randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    stampPath = path.join(testDir, 'build-info.json');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  async function writeStamp(value: unknown): Promise<void> {
    await fs.writeFile(
      stampPath,
      typeof value === 'string' ? value : JSON.stringify(value),
      'utf-8'
    );
  }

  describe('readLocalBuildInfo', () => {
    it('reads channel and commit', async () => {
      await writeStamp({ channel: 'dev.local', commit: 'c915bf8e' });

      expect(readLocalBuildInfo(stampPath)).toEqual({ channel: 'dev.local', commit: 'c915bf8e' });
    });

    it('accepts a stamp with no commit — a build from outside a Git checkout', async () => {
      await writeStamp({ channel: 'dev.local', commit: '' });

      expect(readLocalBuildInfo(stampPath)).toEqual({ channel: 'dev.local' });
    });

    // Degrading to null is the safety property: a bad stamp must never make
    // the CLI print a version it cannot substantiate, and must never throw
    // out of `--version`.
    it.each([
      ['a missing file', null],
      ['a malformed file', 'not json'],
      ['a non-object payload', JSON.stringify(42)],
      ['a stamp without a channel', { commit: 'c915bf8e' }],
      ['a stamp with a blank channel', { channel: '   ', commit: 'c915bf8e' }],
      ['a stamp with a non-string channel', { channel: 7 }],
    ])('returns null for %s', async (_label, value) => {
      if (value !== null) await writeStamp(value);

      expect(readLocalBuildInfo(stampPath)).toBeNull();
    });

    it('resolves the default path inside the package dist directory', () => {
      expect(localBuildInfoPath().endsWith(path.join('dist', 'build-info.json'))).toBe(true);
    });
  });

  describe('formatCliVersion', () => {
    it('prints the bare version when there is no stamp — the published-install contract', () => {
      expect(formatCliVersion('0.1.7', null)).toBe('0.1.7');
    });

    it('appends the channel and the commit the local build came from', () => {
      expect(formatCliVersion('0.1.7', { channel: 'dev.local', commit: 'c915bf8e' })).toBe(
        '0.1.7 (dev.local c915bf8e)'
      );
    });

    it('omits a commit that is unavailable', () => {
      expect(formatCliVersion('0.1.7', { channel: 'dev.local' })).toBe('0.1.7 (dev.local)');
    });

    // Scripts parse `rasen --version`; the canonical version must stay the
    // first whitespace-delimited token even on a local build.
    it('keeps the bare version as the first token', () => {
      const line = formatCliVersion('0.1.7', { channel: 'dev.local', commit: 'c915bf8e' });

      expect(line.split(' ')[0]).toBe('0.1.7');
    });
  });
});
