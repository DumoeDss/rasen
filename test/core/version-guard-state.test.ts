import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readLastWarnedVersionPair,
  writeLastWarnedVersionPair,
  VERSION_GUARD_MARKER_FILE_NAME,
} from '../../src/core/version-guard-state.js';

describe('version-guard-state (delivery-reliability-version-guard)', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = path.join(os.tmpdir(), `rasen-version-guard-${randomUUID()}`);
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('returns null when no marker file exists', () => {
    expect(readLastWarnedVersionPair(homeDir)).toBeNull();
  });

  it('round-trips a written pair', () => {
    writeLastWarnedVersionPair(homeDir, { stampVersion: '0.1.2', cliVersion: '0.1.5' });
    expect(readLastWarnedVersionPair(homeDir)).toEqual({
      stampVersion: '0.1.2',
      cliVersion: '0.1.5',
    });
  });

  it('overwrites a previous pair on a second write', () => {
    writeLastWarnedVersionPair(homeDir, { stampVersion: '0.1.2', cliVersion: '0.1.5' });
    writeLastWarnedVersionPair(homeDir, { stampVersion: '0.1.5', cliVersion: '0.1.6' });
    expect(readLastWarnedVersionPair(homeDir)).toEqual({
      stampVersion: '0.1.5',
      cliVersion: '0.1.6',
    });
  });

  it('treats a corrupt marker file as no marker rather than throwing', () => {
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(homeDir, VERSION_GUARD_MARKER_FILE_NAME), '{ not valid json', 'utf-8');
    expect(() => readLastWarnedVersionPair(homeDir)).not.toThrow();
    expect(readLastWarnedVersionPair(homeDir)).toBeNull();
  });

  it('treats a well-formed JSON file missing the expected fields as no marker', () => {
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, VERSION_GUARD_MARKER_FILE_NAME),
      JSON.stringify({ somethingElse: true }),
      'utf-8'
    );
    expect(readLastWarnedVersionPair(homeDir)).toBeNull();
  });

  it('does not throw when the home directory cannot be created (best-effort write)', () => {
    // A file (not a directory) at the parent path makes mkdirSync fail.
    const blockerFile = path.join(os.tmpdir(), `rasen-version-guard-blocker-${randomUUID()}`);
    fs.writeFileSync(blockerFile, 'not a directory', 'utf-8');
    const impossibleHome = path.join(blockerFile, 'nested', 'home');
    expect(() =>
      writeLastWarnedVersionPair(impossibleHome, { stampVersion: '0.1.2', cliVersion: '0.1.5' })
    ).not.toThrow();
    fs.rmSync(blockerFile, { force: true });
  });
});
