import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import { resolveUiPackageDir, UI_PACKAGE_NAME } from '../../../src/core/config-api/ui-package.js';

describe('resolveUiPackageDir', () => {
  it('names the UI package in a single constant', () => {
    expect(UI_PACKAGE_NAME).toBe('@atelierai/rasen-ui');
  });

  it('returns an existing dist directory when the optional UI package is installed, and otherwise null', () => {
    const resolved = resolveUiPackageDir();
    if (resolved === null) return;

    expect(path.isAbsolute(resolved)).toBe(true);
    expect(path.basename(resolved)).toBe('dist');
    expect(fs.statSync(resolved).isDirectory()).toBe(true);
  });
});
