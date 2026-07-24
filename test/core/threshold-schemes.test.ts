import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  MAX_THRESHOLD_SCHEME_FILE_BYTES,
  deleteThresholdScheme,
  getThresholdSchemePath,
  getThresholdSchemesDir,
  listThresholdSchemes,
  parseThresholdScheme,
  readThresholdScheme,
  saveThresholdScheme,
  validateThresholdSchemeName,
} from '../../src/core/threshold-schemes.js';

describe('threshold schemes', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-threshold-schemes-'));
    previousHome = process.env.RASEN_HOME;
    process.env.RASEN_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  const focused = {
    handoff: 0.5,
    handoffRoles: { reviewer: 0.6 },
    reuse: { remainingTokens: 50_000 },
    reuseRoles: { planner: 0.3 },
  } as const;

  it('parses a complete strict scheme with dual-form thresholds', () => {
    expect(parseThresholdScheme(focused)).toEqual(focused);
    expect(() => parseThresholdScheme({ handoff: 0.5 })).toThrow(/reuse/i);
    expect(() => parseThresholdScheme({ ...focused, extra: true })).toThrow(/extra/i);
    expect(() =>
      parseThresholdScheme({ ...focused, reuseRoles: { reviewer: 0.3 } })
    ).toThrow(/reviewer/i);
  });

  it.each(['../focused', 'default', 'UPPER', '', 'a'.repeat(65)])(
    'rejects invalid or reserved name %s before path resolution',
    (name) => {
      expect(validateThresholdSchemeName(name)).not.toBeNull();
      const escapedName =
        name.length > 0 ? name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') : '""';
      expect(() => getThresholdSchemePath(name)).toThrow(new RegExp(escapedName));
    }
  );

  it('uses platform path joins and round-trips save/read/delete', () => {
    const saved = saveThresholdScheme('focused', focused);
    expect(getThresholdSchemesDir()).toBe(path.join(home, 'schemes'));
    expect(saved).toBe(path.join(home, 'schemes', 'focused.yaml'));
    expect(readThresholdScheme('focused')).toEqual(focused);
    deleteThresholdScheme('focused');
    expect(() => readThresholdScheme('focused')).toThrow(/not found/i);
  });

  it('treats a missing directory as an empty library without creating it', () => {
    expect(listThresholdSchemes()).toEqual([]);
    expect(fs.existsSync(getThresholdSchemesDir())).toBe(false);
  });

  it('sorts valid and malformed files while isolating per-file errors', () => {
    saveThresholdScheme('zeta', focused);
    saveThresholdScheme('alpha', { ...focused, handoff: 0.4 });
    fs.writeFileSync(path.join(getThresholdSchemesDir(), 'broken.yaml'), 'handoff: [\n');
    fs.writeFileSync(
      path.join(getThresholdSchemesDir(), 'Invalid.yaml'),
      'handoff: 0.5\nreuse: 0.25\n'
    );

    const entries = listThresholdSchemes();
    expect(entries.map((entry) => entry.name)).toEqual([
      'alpha',
      'broken',
      'Invalid',
      'zeta',
    ]);
    expect(entries.find((entry) => entry.name === 'alpha')).toMatchObject({ valid: true });
    expect(entries.find((entry) => entry.name === 'broken')).toMatchObject({ valid: false });
    expect(entries.find((entry) => entry.name === 'Invalid')).toMatchObject({
      valid: false,
      error: expect.stringMatching(/name/i),
    });
  });

  it('rejects malformed and oversized YAML', () => {
    fs.mkdirSync(getThresholdSchemesDir(), { recursive: true });
    fs.writeFileSync(path.join(getThresholdSchemesDir(), 'malformed.yaml'), 'handoff: [\n');
    fs.writeFileSync(
      path.join(getThresholdSchemesDir(), 'oversized.yaml'),
      'x'.repeat(MAX_THRESHOLD_SCHEME_FILE_BYTES + 1)
    );
    expect(() => readThresholdScheme('malformed')).toThrow(/invalid/i);
    expect(() => readThresholdScheme('oversized')).toThrow(/too large/i);
  });

  it('validates before replacement so a failed save preserves the prior file', () => {
    saveThresholdScheme('focused', focused);
    expect(() =>
      saveThresholdScheme('focused', { ...focused, reuse: 2 } as never)
    ).toThrow();
    expect(readThresholdScheme('focused')).toEqual(focused);
  });

  it('refuses to replace a non-file destination', () => {
    const destination = path.join(getThresholdSchemesDir(), 'focused.yaml');
    fs.mkdirSync(destination, { recursive: true });

    expect(() => saveThresholdScheme('focused', focused)).toThrow(/not a file/i);
    expect(fs.statSync(destination).isDirectory()).toBe(true);
  });
});
