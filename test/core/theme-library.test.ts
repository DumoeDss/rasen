import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  installTheme,
  listImportedThemes,
  MAX_THEME_BYTES,
  resolveThemesDir,
  ThemeLibraryError,
  validateThemeManifest,
} from '../../src/core/theme-library/index.js';

const temporary: string[] = [];
const fixture = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'themes', name), 'utf8');

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function dataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-themes-'));
  temporary.push(dir);
  return dir;
}

describe('theme manifest v1 contract', () => {
  it('accepts the shared fixture and both checked-in built-ins', () => {
    const values = [
      JSON.parse(fixture('accepted.json')),
      JSON.parse(fs.readFileSync('packages/ui/src/theme/manifests/editorial.json', 'utf8')),
      JSON.parse(fs.readFileSync('packages/ui/src/theme/manifests/crt.json', 'utf8')),
    ];
    for (const value of values) expect(validateThemeManifest(value).ok).toBe(true);
  });

  it('rejects CSS/resource values, unknown fields, effects, versions, and unsafe ids with field paths', () => {
    for (const name of ['rejected-raw-css.json', 'rejected-effect.json', 'rejected-prototype-tokens.json']) {
      const result = validateThemeManifest(JSON.parse(fixture(name)));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.details.every((detail) => detail.path.length > 0)).toBe(true);
    }
    expect(validateThemeManifest({
      schemaVersion: 2, id: '../Bad', name: 'Bad', mode: 'light',
      tokens: { light: {} }, effects: [],
    }).ok).toBe(false);
  });

  it('rejects every prototype-named token as unknown without throwing', () => {
    const result = validateThemeManifest(JSON.parse(fixture('rejected-prototype-tokens.json')));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'tokens.light.constructor', code: 'unknown_token' }),
        expect.objectContaining({ path: 'tokens.light.__proto__', code: 'unknown_token' }),
        expect.objectContaining({ path: 'tokens.light.toString', code: 'unknown_token' }),
      ]));
    }
  });
});

describe('machine theme library', () => {
  it('uses native direct-child paths and publishes normalized JSON atomically', () => {
    const root = dataDir();
    expect(resolveThemesDir({ dataDir: root })).toBe(path.join(root, 'themes'));
    const installed = installTheme(fixture('accepted.json'), { dataDir: root });
    const finalPath = path.join(root, 'themes', `${installed.id}.json`);
    expect(fs.existsSync(finalPath)).toBe(true);
    expect(fs.readdirSync(path.dirname(finalPath)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(listImportedThemes({ dataDir: root }).themes.map((theme) => theme.id)).toEqual(['forest-paper']);
  });

  it('protects built-ins, case-insensitive collisions, invalid data, and the size cap', () => {
    const root = dataDir();
    installTheme(fixture('accepted.json'), { dataDir: root });
    expect(() => installTheme(fixture('accepted.json'), { dataDir: root })).toThrowError(ThemeLibraryError);
    fs.renameSync(path.join(root, 'themes', 'forest-paper.json'), path.join(root, 'themes', 'FOREST-PAPER.json'));
    expect(() => installTheme(fixture('accepted.json'), { dataDir: root })).toThrowError(/already installed/);
    expect(() => installTheme(JSON.stringify({
      schemaVersion: 1,
      id: 'CRT',
      name: 'Reserved',
      mode: 'dark',
      tokens: { dark: {} },
      effects: [],
    }), { dataDir: root })).toThrowError(/already installed or reserved/);
    expect(() => installTheme(fixture('rejected-raw-css.json'), { dataDir: root })).toThrowError(/validation/);
    expect(() => installTheme(Buffer.alloc(MAX_THEME_BYTES + 1), { dataDir: root })).toThrowError(/exceeds/);
  });

  it('freshly skips corrupt files and symlinks instead of breaking the catalog', () => {
    const root = dataDir();
    const themes = resolveThemesDir({ dataDir: root });
    fs.mkdirSync(themes, { recursive: true });
    fs.writeFileSync(path.join(themes, 'broken.json'), '{');
    try {
      fs.symlinkSync(path.join(themes, 'broken.json'), path.join(themes, 'linked.json'));
    } catch {
      // Some Windows environments disallow unprivileged symlink creation.
    }
    const catalog = listImportedThemes({ dataDir: root });
    expect(catalog.themes).toEqual([]);
    expect(catalog.skipped.some((entry) => entry.file === 'broken.json')).toBe(true);
    if (fs.existsSync(path.join(themes, 'linked.json'))) {
      expect(catalog.skipped.some((entry) => entry.file === 'linked.json' && entry.code === 'unsafe_entry')).toBe(true);
    }
  });

  it('classifies a prototype-token manifest as invalid instead of throwing during listing', () => {
    const root = dataDir();
    const themes = resolveThemesDir({ dataDir: root });
    fs.mkdirSync(themes, { recursive: true });
    fs.writeFileSync(path.join(themes, 'prototype-keys.json'), fixture('rejected-prototype-tokens.json'));

    expect(listImportedThemes({ dataDir: root })).toEqual({
      themes: [],
      skipped: [expect.objectContaining({
        file: 'prototype-keys.json',
        code: 'invalid_theme',
        details: expect.arrayContaining([
          expect.objectContaining({ code: 'unknown_token' }),
        ]),
      })],
    });
  });

  it('rejects a themes-directory symlink or Windows junction before listing or writing', () => {
    const root = dataDir();
    const outside = dataDir();
    const themes = resolveThemesDir({ dataDir: root });
    fs.symlinkSync(outside, themes, process.platform === 'win32' ? 'junction' : 'dir');

    expect(listImportedThemes({ dataDir: root })).toEqual({
      themes: [],
      skipped: [{ file: 'themes', code: 'unsafe_directory' }],
    });
    expect(() => installTheme(fixture('accepted.json'), { dataDir: root })).toThrowError(
      /themes directory must be a real directory/
    );
    expect(fs.existsSync(path.join(outside, 'forest-paper.json'))).toBe(false);
  });
});
