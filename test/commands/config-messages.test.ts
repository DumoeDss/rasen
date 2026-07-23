import { describe, expect, it } from 'vitest';

import { formatConfigDiagnostic } from '../../src/commands/config-messages.js';
import { SUPPORTED_CLI_LOCALES } from '../../src/utils/locale.js';

describe('formatConfigDiagnostic: skillVersionMismatch (delivery-reliability-version-guard)', () => {
  it('resolves and interpolates both values in every supported locale', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const message = formatConfigDiagnostic(
        {
          key: 'skillVersionMismatch',
          values: { stampVersion: '0.1.2', cliVersion: '0.1.5' },
          fallback: 'unused fallback',
          output: 'warn',
        },
        locale
      );

      expect(message, `locale: ${locale}`).not.toBe('unused fallback');
      expect(message, `locale: ${locale}`).toContain('0.1.2');
      expect(message, `locale: ${locale}`).toContain('0.1.5');
      expect(message, `locale: ${locale}`).not.toContain('{stampVersion}');
      expect(message, `locale: ${locale}`).not.toContain('{cliVersion}');
    }
  });
});
