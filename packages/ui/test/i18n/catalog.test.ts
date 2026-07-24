/**
 * Catalog tests (ui-i18n design D6/D7/D9; spec req 4 & 5): the English-fallback
 * discipline, `en`/`zh-cn` key-for-key parity, and that every literal `t('…')`
 * key referenced in `src` exists in the `en` catalog (a typo'd key fails here
 * rather than rendering a raw key in the UI).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getLocaleCatalog, translate } from '../../src/i18n/catalog.js';
import en from '../../src/i18n/locales/en.json' with { type: 'json' };
import zhCn from '../../src/i18n/locales/zh-cn.json' with { type: 'json' };

const EN = en as Record<string, string>;
const ZH = zhCn as Record<string, string>;

describe('translate — fallback discipline (design D6; spec req 4)', () => {
  it('renders the active-locale entry when present', () => {
    expect(translate('en', 'nav.board')).toBe('Board');
  });

  it('interpolates {placeholder} values (design D3)', () => {
    expect(translate('en', 'task.progress.tasks', { done: 4, total: 6 })).toBe('4/6 tasks');
    expect(translate('en', 'task.progress.changes', { done: 2, total: 3 })).toBe('2/3 changes');
  });

  it('falls back to the en entry when the active locale is missing the key — never blank, never the raw key', () => {
    const key = 'nav.board';
    const catalog = getLocaleCatalog('zh-cn');
    const saved = catalog[key];
    delete catalog[key];
    try {
      const result = translate('zh-cn', key);
      expect(result).toBe(EN[key]);
      expect(result).not.toBe('');
      expect(result).not.toBe(key);
    } finally {
      catalog[key] = saved;
    }
  });

  it('renders the key itself only when missing from BOTH catalogs (implementation-bug signal)', () => {
    expect(translate('en', 'totally.made.up.key')).toBe('totally.made.up.key');
  });
});

describe('catalog completeness — en and zh-cn key-for-key parity (design D7; spec req 5)', () => {
  it('every key in en is present in zh-cn and vice versa', () => {
    const enKeys = new Set(Object.keys(EN));
    const zhKeys = new Set(Object.keys(ZH));
    const missingFromZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const extraInZh = [...zhKeys].filter((k) => !enKeys.has(k));
    expect(missingFromZh).toEqual([]);
    expect(extraInZh).toEqual([]);
  });
});

describe('used-key existence — every literal t()/tNow() key in src exists in en (design D9; spec req 1)', () => {
  // Scans src/**/*.ts?(x) for literal `t('…')` / `t("…")` / `tNow('…')` first
  // arguments and asserts each captured key exists in the `en` catalog. Keys
  // passed dynamically (e.g. `t(pageError.message)`, `t(COLUMN_LABEL_KEYS[col.id])`)
  // are intentionally not captured here — they are not literal strings.
  const KEY_CALL = /\b(?:t|tNow)\(\s*['"]([A-Za-z][A-Za-z0-9_.-]*)['"]/g;

  async function collectSourceFiles(dir: string, out: string[] = []): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await collectSourceFiles(full, out);
      } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
        out.push(full);
      }
    }
    return out;
  }

  it('all literal catalog keys referenced in src exist in en.json', async () => {
    const files = await collectSourceFiles(join(process.cwd(), 'src'));
    expect(files.length).toBeGreaterThan(0);
    const referenced = new Map<string, string[]>(); // key -> [file, ...]
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      for (const match of src.matchAll(KEY_CALL)) {
        const key = match[1]!;
        if (!referenced.has(key)) referenced.set(key, []);
        referenced.get(key)!.push(file);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    const missing: Array<{ key: string; where: string[] }> = [];
    for (const [key, where] of referenced) {
      if (!(key in EN)) missing.push({ key, where });
    }
    expect(missing, `keys referenced in src but absent from en.json: ${JSON.stringify(missing)}`).toEqual([]);
  });
});
