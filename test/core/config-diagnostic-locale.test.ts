import { describe, expect, it } from 'vitest';

import {
  formatConfigDiagnostic,
  createConfigDiagnosticReporter,
} from '../../src/core/config-diagnostic-locale.js';
import type { ConfigDiagnostic } from '../../src/core/config-diagnostics.js';
import { SUPPORTED_CLI_LOCALES } from '../../src/utils/locale.js';

describe('config-diagnostic-locale (relocated from commands/config-messages.ts)', () => {
  it('formatConfigDiagnostic resolves and interpolates in every supported locale', () => {
    for (const locale of SUPPORTED_CLI_LOCALES) {
      const message = formatConfigDiagnostic(
        {
          key: 'deliveryRetired',
          values: { legacy: 'both' },
          fallback: 'unused fallback',
          output: 'error',
        },
        locale
      );

      expect(message, `locale: ${locale}`).not.toBe('unused fallback');
      expect(message, `locale: ${locale}`).toContain('both');
      expect(message, `locale: ${locale}`).not.toContain('{legacy}');
    }
  });

  it('formatConfigDiagnostic falls back to the fallback text when the catalog has no entry for the key', () => {
    const diagnostic = {
      key: 'not-a-real-catalog-key',
      values: {},
      fallback: 'fallback text used verbatim',
      output: 'warn',
    } as unknown as ConfigDiagnostic;

    for (const locale of SUPPORTED_CLI_LOCALES) {
      expect(formatConfigDiagnostic(diagnostic, locale), `locale: ${locale}`).toBe(
        'fallback text used verbatim'
      );
    }
  });

  it('createConfigDiagnosticReporter writes to console.error for output: "error"', () => {
    const messages: string[] = [];
    const original = console.error;
    console.error = (msg: string) => messages.push(msg);
    try {
      const reporter = createConfigDiagnosticReporter('en');
      reporter({
        key: 'invalidGlobalJson',
        values: { path: '/tmp/config.json' },
        fallback: 'unused fallback',
        output: 'error',
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('/tmp/config.json');
    } finally {
      console.error = original;
    }
  });

  it('createConfigDiagnosticReporter writes to console.warn for output: "warn"', () => {
    const messages: string[] = [];
    const original = console.warn;
    console.warn = (msg: string) => messages.push(msg);
    try {
      const reporter = createConfigDiagnosticReporter('en');
      reporter({
        key: 'expertSelectionMigration',
        fallback: 'unused fallback',
        output: 'warn',
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]).not.toBe('unused fallback');
    } finally {
      console.warn = original;
    }
  });
});
