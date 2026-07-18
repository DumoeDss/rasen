import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  writeGlobalConfigKeyMinimalDiff,
  GlobalConfigWriteError,
} from '../../../src/core/config-api/global-write.js';
import { getGlobalConfigPath } from '../../../src/core/global-config.js';

describe('writeGlobalConfigKeyMinimalDiff', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-global-write-'));
    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates the config file with only the target key when none exists yet (MIN4 regression)', () => {
    writeGlobalConfigKeyMinimalDiff('repoMode', 'solo');
    const raw = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
    expect(raw).toEqual({ repoMode: 'solo' });
    // Keys with built-in defaults that were never explicitly set (proactive,
    // profile, delivery, featureFlags) must stay absent from the file.
    expect(raw).not.toHaveProperty('proactive');
    expect(raw).not.toHaveProperty('profile');
    expect(raw).not.toHaveProperty('delivery');
    expect(raw).not.toHaveProperty('featureFlags');
  });

  it('touches only the target key on an existing file, leaving unrelated content untouched', () => {
    fs.mkdirSync(path.dirname(getGlobalConfigPath()), { recursive: true });
    fs.writeFileSync(getGlobalConfigPath(), JSON.stringify({ proactive: false }));

    writeGlobalConfigKeyMinimalDiff('repoMode', 'solo');

    const raw = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
    expect(raw).toEqual({ proactive: false, repoMode: 'solo' });
  });

  it('unsets a key (value undefined) removing it from the file', () => {
    writeGlobalConfigKeyMinimalDiff('repoMode', 'solo');
    writeGlobalConfigKeyMinimalDiff('repoMode', undefined);

    const raw = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
    expect(raw).not.toHaveProperty('repoMode');
  });

  it('rejects an out-of-range value without writing the file', () => {
    expect(() => writeGlobalConfigKeyMinimalDiff('handoff.threshold', 5)).toThrow(GlobalConfigWriteError);
    expect(fs.existsSync(getGlobalConfigPath())).toBe(false);
  });

  it('writes nested keys correctly', () => {
    writeGlobalConfigKeyMinimalDiff('handoff.threshold', 0.3);
    const raw = JSON.parse(fs.readFileSync(getGlobalConfigPath(), 'utf-8'));
    expect(raw).toEqual({ handoff: { threshold: 0.3 } });
  });

  // B1 regression: a corrupt (unparseable) global config file must never be
  // silently replaced with just the target key — that would destroy every
  // other hand-edited value with a 200 OK and no warning.
  it('B1: throws (never writes) when the on-disk file is not valid JSON, leaving the corrupt file byte-identical', () => {
    fs.mkdirSync(path.dirname(getGlobalConfigPath()), { recursive: true });
    const corrupt = '{ "proactive": false, "repoMode": "solo", }'; // trailing comma
    fs.writeFileSync(getGlobalConfigPath(), corrupt);

    expect(() => writeGlobalConfigKeyMinimalDiff('handoff.threshold', 0.3)).toThrow(GlobalConfigWriteError);

    expect(fs.readFileSync(getGlobalConfigPath(), 'utf-8')).toBe(corrupt);
  });

  it('B1: throws (never writes) when the on-disk file parses but is not a JSON object', () => {
    fs.mkdirSync(path.dirname(getGlobalConfigPath()), { recursive: true });
    fs.writeFileSync(getGlobalConfigPath(), '[1, 2, 3]');

    expect(() => writeGlobalConfigKeyMinimalDiff('handoff.threshold', 0.3)).toThrow(GlobalConfigWriteError);
    expect(fs.readFileSync(getGlobalConfigPath(), 'utf-8')).toBe('[1, 2, 3]');
  });
});
