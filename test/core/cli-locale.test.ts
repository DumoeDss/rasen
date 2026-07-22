import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getCliLocale } from '../../src/core/cli-locale.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';

describe('getCliLocale', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-cli-locale-'));
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = tempDir;
    delete process.env.RASEN_LANG;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses the exact zh-cn language persisted in the global JSON config', () => {
    saveGlobalConfig({ language: 'zh-cn' });
    process.env.LANG = 'en_US.UTF-8';

    expect(getCliLocale()).toBe('zh-cn');
  });

  it('preserves an exact English RASEN_LANG override', () => {
    saveGlobalConfig({ language: 'ja' });
    process.env.RASEN_LANG = 'en';

    expect(getCliLocale()).toBe('en');
  });

  it('normalizes a valid RASEN_LANG alias over the persisted language', () => {
    saveGlobalConfig({ language: 'ja' });
    process.env.RASEN_LANG = 'zh_CN.UTF-8';

    expect(getCliLocale()).toBe('zh-cn');
  });

  it('ignores an invalid RASEN_LANG override and keeps the persisted language', () => {
    saveGlobalConfig({ language: 'ja' });
    process.env.RASEN_LANG = 'zh-Hant';

    expect(getCliLocale()).toBe('ja');
  });
});
