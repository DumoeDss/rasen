import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import editorial from '../../src/theme/manifests/editorial.json';
import crt from '../../src/theme/manifests/crt.json';
import { validateThemeManifest } from '../../src/theme/manifest.js';

const shared = (name: string): unknown =>
  JSON.parse(fs.readFileSync(new URL(`../../../../test/fixtures/themes/${name}`, import.meta.url), 'utf8'));

describe('self-contained UI theme decoder', () => {
  it('accepts the shared fixture and bundled manifests', () => {
    for (const value of [shared('accepted.json'), editorial, crt]) {
      expect(validateThemeManifest(value).ok).toBe(true);
    }
  });

  it('rejects the same executable/resource and effect fixtures as the root decoder', () => {
    expect(validateThemeManifest(shared('rejected-raw-css.json')).ok).toBe(false);
    expect(validateThemeManifest(shared('rejected-effect.json')).ok).toBe(false);
  });

  it('rejects every prototype-named token as unknown without throwing', () => {
    const result = validateThemeManifest(shared('rejected-prototype-tokens.json'));
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
