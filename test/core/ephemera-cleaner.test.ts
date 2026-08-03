import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  applyEphemeraDeletion,
  classifyEphemera,
  cleanEphemera,
  EphemeraPlanError,
  hashDirectoryTree,
  type EphemeraFileSystem,
} from '../../src/core/ephemera-cleaner.js';

const VALID_STATE: Record<string, string> = {
  'auto-run.json': JSON.stringify({ pipeline: 'small-feature', completed: [] }),
  'portfolio-run.json': JSON.stringify({ parent: 'portfolio', children: [] }),
  'goal-run.json': JSON.stringify([
    { round: 1, measurePassed: false, gitTreeFingerprint: 'abc123' },
  ]),
};

const INVALID_STATE: Record<string, string> = {
  'auto-run.json': JSON.stringify({ pipeline: 42 }),
  'portfolio-run.json': JSON.stringify({ parent: 42, children: [] }),
  'goal-run.json': JSON.stringify([{ round: 0 }]),
};

function versioned(filename: string, version: number): string {
  const parsed = JSON.parse(VALID_STATE[filename]) as unknown;
  if (Array.isArray(parsed)) {
    return JSON.stringify({ version, rounds: parsed });
  }
  return JSON.stringify({ ...(parsed as Record<string, unknown>), version });
}

function errno(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function realFileSystem(overrides: Partial<EphemeraFileSystem> = {}): EphemeraFileSystem {
  return {
    readdir: (dir, options) => fsPromises.readdir(dir, options),
    lstat: target => fsPromises.lstat(target),
    readFile: target => fsPromises.readFile(target),
    unlink: target => fsPromises.unlink(target),
    ...overrides,
  };
}

describe('ephemera-cleaner', () => {
  let ephemeraDir: string;

  beforeEach(() => {
    ephemeraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ephemera-'));
  });

  afterEach(() => {
    fs.rmSync(ephemeraDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content = 'content'): string {
    const absolute = path.join(ephemeraDir, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
    return absolute;
  }

  function bytes(relativePath: string): Buffer {
    return fs.readFileSync(path.join(ephemeraDir, relativePath));
  }

  function remainingTopLevel(): string[] {
    return fs.readdirSync(ephemeraDir).sort();
  }

  describe('known state validation', () => {
    it('deletes supported schema-valid state and accounts exact filenames', async () => {
      for (const [filename, content] of Object.entries(VALID_STATE)) {
        writeFile(filename, content);
      }

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.aborted).toBe(false);
      expect(classification.complete).toBe(true);
      expect(classification.discarded).toEqual([
        'auto-run.json',
        'goal-run.json',
        'portfolio-run.json',
      ]);

      await expect(applyEphemeraDeletion(ephemeraDir, classification)).resolves.toEqual([
        'auto-run.json',
        'goal-run.json',
        'portfolio-run.json',
      ]);
      expect(remainingTopLevel()).toEqual([]);
    });

    it.each(Object.keys(VALID_STATE))(
      'preserves malformed %s byte-for-byte',
      async filename => {
        const original = Buffer.from('{"broken":');
        writeFile(filename, original.toString());

        const classification = await classifyEphemera(ephemeraDir);
        expect(classification.discarded).toEqual([]);
        expect(classification.preserved).toContain(filename);
        expect(
          classification.preservedEntries?.find(entry => entry.path === filename)?.reason
        ).toBe('invalid-state');
        expect(bytes(filename)).toEqual(original);
      }
    );

    it.each(Object.entries(INVALID_STATE))(
      'preserves schema-invalid %s byte-for-byte',
      async (filename, content) => {
        const original = Buffer.from(content);
        writeFile(filename, content);

        const classification = await classifyEphemera(ephemeraDir);
        expect(classification.discarded).toEqual([]);
        expect(classification.preserved).toContain(filename);
        expect(bytes(filename)).toEqual(original);
      }
    );

    it.each(Object.keys(VALID_STATE))(
      'preserves unsupported explicit versions in %s byte-for-byte',
      async filename => {
        const original = Buffer.from(versioned(filename, 2));
        writeFile(filename, original.toString());

        const classification = await classifyEphemera(ephemeraDir);
        expect(classification.discarded).toEqual([]);
        expect(classification.preserved).toContain(filename);
        expect(
          classification.preservedEntries?.find(entry => entry.path === filename)?.detail
        ).toContain('unsupported version 2');
        expect(bytes(filename)).toEqual(original);
      }
    );

    it('accepts an explicit supported version marker before canonical parsing', async () => {
      writeFile('auto-run.json', versioned('auto-run.json', 1));
      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.discarded).toEqual(['auto-run.json']);
    });
  });

  describe('recursive deterministic preflight', () => {
    it('deletes only top-level raw/control material and preserves unknown entries', async () => {
      writeFile('.signal');
      writeFile('trace.log');
      writeFile('raw-sampling.json');
      writeFile('benchmark-timing.json');
      writeFile('custom-experiment.json', 'important');
      writeFile('nested/deep.log', 'nested');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.discarded).toEqual([
        '.signal',
        'benchmark-timing.json',
        'raw-sampling.json',
        'trace.log',
      ]);
      expect(classification.preserved).toEqual([
        'custom-experiment.json',
        'nested',
        'nested/deep.log',
      ]);

      await applyEphemeraDeletion(ephemeraDir, classification);
      expect(bytes('custom-experiment.json').toString()).toBe('important');
      expect(bytes('nested/deep.log').toString()).toBe('nested');
    });

    it('finds every nested source signal and aborts all candidate deletion', async () => {
      writeFile('auto-run.json', VALID_STATE['auto-run.json']);
      writeFile('research/probe/src/main.ts', 'export const answer = 42;');
      writeFile('research/python/pyproject.toml', '[project]\nname = "probe"\n');
      writeFile('research/rust/Cargo.toml', '[package]\nname = "probe"\n');

      const classification = await classifyEphemera(ephemeraDir);
      expect(classification.aborted).toBe(true);
      expect(classification.sourceSignals).toEqual([
        'research/probe/src',
        'research/probe/src/main.ts',
        'research/python/pyproject.toml',
        'research/rust/Cargo.toml',
      ]);
      expect(classification.discarded).toEqual([]);
      expect(classification.candidates?.map(candidate => candidate.relativePath)).toEqual([
        'auto-run.json',
      ]);
      expect(classification.preserved).toContain('auto-run.json');
      expect(classification.preservedEntries).toContainEqual({
        path: 'auto-run.json',
        reason: 'cleaning-aborted',
        detail: 'research/probe/src',
      });
      await expect(
        applyEphemeraDeletion(ephemeraDir, classification)
      ).rejects.toBeInstanceOf(EphemeraPlanError);
      expect(bytes('auto-run.json').toString()).toBe(VALID_STATE['auto-run.json']);
    });

    it('supports explicit win32 case-insensitive and POSIX case-sensitive manifest identities', async () => {
      const original = Buffer.from(VALID_STATE['auto-run.json']);
      writeFile('auto-run.json', original.toString());
      writeFile('nested/PACKAGE.JSON', '{"name":"probe"}');

      const windows = await classifyEphemera(ephemeraDir, realFileSystem(), 'win32');
      expect(windows.aborted).toBe(true);
      expect(windows.sourceSignals).toEqual(['nested/PACKAGE.JSON']);
      expect(windows.discarded).toEqual([]);
      expect(windows.preserved).toContain('auto-run.json');

      const posix = await classifyEphemera(ephemeraDir, realFileSystem(), 'posix');
      expect(posix.aborted).toBe(false);
      expect(posix.sourceSignals).toEqual([]);
      expect(posix.discarded).toEqual(['auto-run.json']);
      expect(bytes('auto-run.json')).toEqual(original);
    });

    it.skipIf(process.platform !== 'win32')(
      'uses the production Windows default for differently cased manifests',
      async () => {
        const original = Buffer.from(VALID_STATE['auto-run.json']);
        writeFile('auto-run.json', original.toString());
        writeFile('nested/PACKAGE.JSON', '{"name":"probe"}');

        const result = await cleanEphemera(ephemeraDir);
        expect(result.deleted).toEqual([]);
        expect(result.classification.aborted).toBe(true);
        expect(result.classification.sourceSignals).toEqual(['nested/PACKAGE.JSON']);
        expect(result.classification.discarded).toEqual([]);
        expect(result.classification.preserved).toContain('auto-run.json');
        expect(bytes('auto-run.json')).toEqual(original);
      }
    );

    it('projects every candidate as explicitly preserved when cleaning aborts', async () => {
      const original = Buffer.from(VALID_STATE['auto-run.json']);
      writeFile('auto-run.json', original.toString());
      writeFile('probe/src/main.ts', 'export {};');

      const result = await cleanEphemera(ephemeraDir);
      expect(result.deleted).toEqual([]);
      expect(result.classification.discarded).toEqual([]);
      expect(result.classification.preserved).toContain('auto-run.json');
      expect(result.classification.preservedEntries).toContainEqual({
        path: 'auto-run.json',
        reason: 'cleaning-aborted',
        detail: 'probe/src',
      });
      expect(bytes('auto-run.json')).toEqual(original);
    });

    it('does not follow symlinks and reports the link itself', async () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ephemera-outside-'));
      try {
        fs.writeFileSync(path.join(outside, 'main.ts'), 'outside');
        const link = path.join(ephemeraDir, 'linked');
        if (process.platform === 'win32') {
          fs.symlinkSync(outside, link, 'junction');
        } else {
          fs.symlinkSync(outside, link, 'dir');
        }

        const classification = await classifyEphemera(ephemeraDir);
        expect(classification.sourceSignals).toEqual([]);
        expect(classification.preserved).toEqual(['linked']);
        expect(classification.preservedEntries?.[0]?.reason).toBe('symlink');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('uses ENOENT as absence for the root and nothing else', async () => {
      const missing = path.join(ephemeraDir, 'missing');
      expect(await classifyEphemera(missing)).toMatchObject({
        discarded: [],
        preserved: [],
        aborted: false,
        complete: true,
      });
    });
  });

  describe('fail-closed inspection', () => {
    it.each(['EACCES', 'EPERM', 'EIO'])(
      'blocks the complete plan on injected %s read failure before deletion',
      async code => {
        const candidate = writeFile('auto-run.json', VALID_STATE['auto-run.json']);
        const injected = realFileSystem({
          readFile: target =>
            target === candidate
              ? Promise.reject(errno(code))
              : fsPromises.readFile(target),
        });

        const classification = await classifyEphemera(ephemeraDir, injected);
        expect(classification.aborted).toBe(true);
        expect(classification.complete).toBe(false);
        expect(classification.blockers).toEqual([
          expect.objectContaining({ operation: 'readFile', path: candidate, code }),
        ]);
        expect(classification.discarded).toEqual([]);
        await expect(
          applyEphemeraDeletion(ephemeraDir, classification, injected)
        ).rejects.toBeInstanceOf(EphemeraPlanError);
        expect(fs.existsSync(candidate)).toBe(true);
      }
    );

    it.each(['EACCES', 'EPERM', 'EIO'])(
      'blocks the complete plan on injected %s lstat failure before deletion',
      async code => {
        const candidate = writeFile('trace.log', 'keep-until-complete');
        const injected = realFileSystem({
          lstat: target =>
            target === candidate ? Promise.reject(errno(code)) : fsPromises.lstat(target),
        });

        const classification = await classifyEphemera(ephemeraDir, injected);
        expect(classification.aborted).toBe(true);
        expect(classification.blockers).toEqual([
          expect.objectContaining({ operation: 'lstat', path: candidate, code }),
        ]);
        expect(classification.discarded).toEqual([]);
        expect(bytes('trace.log').toString()).toBe('keep-until-complete');
      }
    );
  });

  describe('guarded apply', () => {
    it('refuses a candidate whose bytes changed after classification', async () => {
      writeFile('auto-run.json', VALID_STATE['auto-run.json']);
      const classification = await classifyEphemera(ephemeraDir);
      writeFile('auto-run.json', JSON.stringify({ pipeline: 'other', completed: [] }));

      await expect(applyEphemeraDeletion(ephemeraDir, classification)).rejects.toThrow(
        'candidate changed after classification'
      );
      expect(fs.existsSync(path.join(ephemeraDir, 'auto-run.json'))).toBe(true);
    });

    it('refuses a replacement file even when the replacement has the same bytes', async () => {
      const target = writeFile('trace.log', 'same-bytes');
      const classification = await classifyEphemera(ephemeraDir);
      fs.unlinkSync(target);
      fs.writeFileSync(target, 'same-bytes');

      await expect(applyEphemeraDeletion(ephemeraDir, classification)).rejects.toThrow(
        'candidate changed after classification'
      );
      expect(bytes('trace.log').toString()).toBe('same-bytes');
    });

    it('treats a candidate that vanished after planning as already absent', async () => {
      const target = writeFile('trace.log', 'gone');
      const classification = await classifyEphemera(ephemeraDir);
      fs.unlinkSync(target);
      await expect(applyEphemeraDeletion(ephemeraDir, classification)).resolves.toEqual([]);
    });
  });

  describe('dry-run/tree hash', () => {
    it('keeps the complete tree byte-identical in dry-run', async () => {
      writeFile('auto-run.json', VALID_STATE['auto-run.json']);
      writeFile('portfolio-run.json', VALID_STATE['portfolio-run.json']);
      writeFile('custom.json', '{"important":true}');
      writeFile('app.log', 'log line\n');
      writeFile('research/data.csv', 'a,b,c\n');

      const before = await hashDirectoryTree(ephemeraDir);
      const { classification, deleted } = await cleanEphemera(ephemeraDir, {
        dryRun: true,
      });
      expect(classification.discarded).toEqual([
        'app.log',
        'auto-run.json',
        'portfolio-run.json',
      ]);
      expect(deleted).toEqual([]);
      expect(await hashDirectoryTree(ephemeraDir)).toBe(before);
    });

    it('deletes supported state in apply and leaves preserved bytes unchanged', async () => {
      writeFile('auto-run.json', VALID_STATE['auto-run.json']);
      const preserved = Buffer.from('precious');
      writeFile('custom.bin', preserved.toString());

      const result = await cleanEphemera(ephemeraDir);
      expect(result.deleted).toEqual(['auto-run.json']);
      expect(bytes('custom.bin')).toEqual(preserved);
    });
  });
});
