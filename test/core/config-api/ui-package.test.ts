import { describe, it, expect } from 'vitest';

import { resolveUiPackageDir, UI_PACKAGE_NAME } from '../../../src/core/config-api/ui-package.js';

describe('resolveUiPackageDir', () => {
  it('names the UI package in a single constant', () => {
    expect(UI_PACKAGE_NAME).toBe('@atelierai/rasen-ui');
  });

  it('returns null when the UI package is not installed anywhere the probes look (this repo has no such install)', () => {
    expect(resolveUiPackageDir()).toBeNull();
  });
});
