import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  classifyEphemera,
  applyEphemeraDeletion,
  cleanEphemera,
  hashDirectoryTree,
} from '../../src/core/ephemera-cleaner.js';

/**
 * The ephemera cleaner is the portfolio's ONLY destructive operation. These
 * tests assert the actual on-disk file-list state after the delete pass — not
 * just return values — because the discipline (whitelist-only, preserve +
 * report unknowns, never recurse) is what makes it safe.
 */
describe('ephemera-cleaner', () => {
  let ephemeraDir: string;

  beforeEach(() => {
    ephemeraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ephemera-'));
  });

  afterEach(() => {
    fs.rmSync(ephemeraDir, { recursive: true, force: true });
  });

  /** Writes a file with content under the ephemera directory. */
  function writeFile(relativePath: string, content = 'content'): string {
    const abs = path.join(ephemeraDir, relativePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  }

  /** Lists the sorted set of top-level entries remaining on disk. */
  function remainingTopLevel(): string[] {
    return fs
      .readdirSync(ephemeraDir, { withFileTypes: true })
      .map((e) => e.name)
      .sort();
  }

  // -------------------------------------------------------------------
  // Task 1.1 + 1.2: classification + delete pass
  // -------------------------------------------------------------------

  describe('classifyEphemera + applyEphemeraDeletion', () => {
    it('deletes all whitelisted run-state filenames', async () => {
      writeFile('auto-run.json');
      writeFile('portfolio-run.json');
      writeFile('goal-run.json');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.aborted).toBe(false);
      expect(classification.discarded.sort()).toEqual([
        'auto-run.json',
        'goal-run.json',
        'portfolio-run.json',
      ]);

      const deleted = await applyEphemeraDeletion(ephemeraDir, classification);
      expect(deleted.sort()).toEqual([
        'auto-run.json',
        'goal-run.json',
        'portfolio-run.json',
      ]);

      // Assert actual on-disk state — nothing remains.
      expect(remainingTopLevel()).toEqual([]);
    });

    it('deletes whitelisted control-state filenames', async () => {
      writeFile('.signal');
      writeFile('.lock');
      writeFile('.heartbeat');
      writeFile('expert-selection-explicit.json');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.discarded.sort()).toEqual([
        '.heartbeat',
        '.lock',
        '.signal',
        'expert-selection-explicit.json',
      ]);

      await applyEphemeraDeletion(ephemeraDir, classification);
      expect(remainingTopLevel()).toEqual([]);
    });

    it('deletes pattern-matched regenerable raw material', async () => {
      writeFile('app.log');
      writeFile('raw-sampling.json');
      writeFile('benchmark-timing.json');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.discarded.sort()).toEqual([
        'app.log',
        'benchmark-timing.json',
        'raw-sampling.json',
      ]);
      expect(classification.preserved).toEqual([]);

      await applyEphemeraDeletion(ephemeraDir, classification);
      expect(remainingTopLevel()).toEqual([]);
    });

    it('preserves unknown filenames with exact paths reported', async () => {
      writeFile('auto-run.json');
      writeFile('custom-experiment.json');
      writeFile('analysis-notes.md');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.discarded).toEqual(['auto-run.json']);
      expect(classification.preserved.sort()).toEqual([
        'analysis-notes.md',
        'custom-experiment.json',
      ]);

      await applyEphemeraDeletion(ephemeraDir, classification);
      // Unknown files survive on disk.
      expect(remainingTopLevel().sort()).toEqual([
        'analysis-notes.md',
        'custom-experiment.json',
      ]);
    });

    it('preserves nested directories and never recurses into them', async () => {
      writeFile('auto-run.json');
      writeFile('research/data.csv');
      writeFile('research/sub/more.txt');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.discarded).toEqual(['auto-run.json']);
      expect(classification.preserved).toEqual(['research']);

      await applyEphemeraDeletion(ephemeraDir, classification);
      // The directory and its contents are untouched.
      expect(remainingTopLevel()).toEqual(['research']);
      expect(fs.existsSync(path.join(ephemeraDir, 'research', 'data.csv'))).toBe(true);
      expect(fs.existsSync(path.join(ephemeraDir, 'research', 'sub', 'more.txt'))).toBe(true);
    });

    it('does not apply pattern-matching inside nested directories', async () => {
      // A .log file inside a subdirectory is NOT deleted — patterns apply to
      // the top level only, and the cleaner never recurses.
      writeFile('trace.log');
      writeFile('logs/deep-trace.log');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.discarded).toEqual(['trace.log']);
      expect(classification.preserved).toEqual(['logs']);

      await applyEphemeraDeletion(ephemeraDir, classification);
      expect(remainingTopLevel()).toEqual(['logs']);
      expect(fs.existsSync(path.join(ephemeraDir, 'logs', 'deep-trace.log'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // Task 1.3: source-manifest detection
  // -------------------------------------------------------------------

  describe('source-manifest discovery', () => {
    it.each([
      'package.json',
      'Cargo.toml',
      'pyproject.toml',
      'build.rs',
      'rust-toolchain.toml',
    ])('aborts the clean when %s is at the top level', async (manifest) => {
      writeFile(manifest);
      writeFile('auto-run.json');
      writeFile('trace.log');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.aborted).toBe(true);
      expect(classification.abortReason).toBe(manifest);
      expect(classification.discarded).toEqual([]);

      // Nothing is deleted.
      await applyEphemeraDeletion(ephemeraDir, classification);
      expect(remainingTopLevel().sort()).toEqual([
        'auto-run.json',
        manifest,
        'trace.log',
      ].sort());
    });

    it('aborts on the FIRST manifest discovered and reports its path', async () => {
      writeFile('Cargo.toml');
      writeFile('package.json');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.aborted).toBe(true);
      // The abort reason is one of the manifests — exact which one depends on
      // readdir order, but it must be a known manifest.
      expect(SOURCE_MANIFESTS.has(classification.abortReason!)).toBe(true);
    });
  });

  const SOURCE_MANIFESTS = new Set([
    'package.json',
    'Cargo.toml',
    'pyproject.toml',
    'build.rs',
    'rust-toolchain.toml',
  ]);

  // -------------------------------------------------------------------
  // Task 1.1 edge cases: empty / nonexistent
  // -------------------------------------------------------------------

  describe('empty and nonexistent ephemera directory', () => {
    it('returns an empty classification for an empty directory', async () => {
      const classification = await classifyEphemera(ephemeraDir);
      expect(classification).toEqual({ discarded: [], preserved: [], aborted: false });
    });

    it('returns an empty classification for a nonexistent directory', async () => {
      const classification = await classifyEphemera(
        path.join(ephemeraDir, 'does-not-exist')
      );
      expect(classification).toEqual({ discarded: [], preserved: [], aborted: false });
    });

    it('is a no-op delete on an empty classification', async () => {
      const deleted = await applyEphemeraDeletion(ephemeraDir, {
        discarded: [],
        preserved: [],
        aborted: false,
      });
      expect(deleted).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Task 1.5: dry-run leaves the tree byte-identical
  // -------------------------------------------------------------------

  describe('dry-run byte-identical verification', () => {
    it('leaves the ephemera directory unchanged after a dry-run clean', async () => {
      writeFile('auto-run.json', '{"state":"running"}');
      writeFile('portfolio-run.json', '{"step":3}');
      writeFile('custom.json', '{"important":true}');
      writeFile('app.log', 'log line\n');
      writeFile('research/data.csv', 'a,b,c\n');

      const hashBefore = await hashDirectoryTree(ephemeraDir);

      const { classification, deleted } = await cleanEphemera(ephemeraDir, {
        dryRun: true,
      });

      // The classification correctly identifies what WOULD be deleted.
      expect(classification.discarded.sort()).toEqual([
        'app.log',
        'auto-run.json',
        'portfolio-run.json',
      ]);
      expect(classification.preserved.sort()).toEqual(['custom.json', 'research']);
      // But nothing was actually deleted.
      expect(deleted).toEqual([]);

      const hashAfter = await hashDirectoryTree(ephemeraDir);
      expect(hashAfter).toBe(hashBefore);
    });

    it('actually deletes files when dryRun is false', async () => {
      writeFile('auto-run.json');
      writeFile('custom.json');

      const hashBefore = await hashDirectoryTree(ephemeraDir);
      const { deleted } = await cleanEphemera(ephemeraDir, { dryRun: false });
      expect(deleted).toEqual(['auto-run.json']);

      const hashAfter = await hashDirectoryTree(ephemeraDir);
      expect(hashAfter).not.toBe(hashBefore);
      // The unknown file survives.
      expect(remainingTopLevel()).toEqual(['custom.json']);
    });
  });
});
