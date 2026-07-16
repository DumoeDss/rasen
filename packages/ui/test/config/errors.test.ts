import { describe, expect, it } from 'vitest';
import { errorSurface } from '../../src/config/errors.js';

describe('errorSurface', () => {
  it('maps field-level codes', () => {
    for (const code of ['invalid_value', 'invalid_scope', 'not_settable', 'not_supported']) {
      expect(errorSurface(code)).toBe('field');
    }
  });

  it('maps page-level codes', () => {
    expect(errorSurface('project_required')).toBe('page');
    expect(errorSurface('project_not_found')).toBe('page');
  });

  it('maps full-screen codes', () => {
    expect(errorSurface('unauthorized')).toBe('full-screen');
  });

  it('falls back unknown codes to field-level', () => {
    expect(errorSurface('some_future_code')).toBe('field');
  });
});
