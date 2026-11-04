export type StoreDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface StoreDiagnostic {
  severity: StoreDiagnosticSeverity;
  code: string;
  message: string;
  target?: string;
  fix?: string;
  /** Optional machine-readable recovery facts. Never a filesystem locator. */
  recovery?: unknown;
}

export class StoreError extends Error {
  readonly diagnostic: StoreDiagnostic;

  constructor(
    message: string,
    code: string,
    options: { target?: string; fix?: string; recovery?: unknown } = {}
  ) {
    super(message);
    this.name = 'StoreError';
    this.diagnostic = {
      severity: 'error',
      code,
      message,
      ...options,
    };
  }
}

export function makeStoreDiagnostic(
  severity: StoreDiagnosticSeverity,
  code: string,
  message: string,
  options: { target?: string; fix?: string; recovery?: unknown } = {}
): StoreDiagnostic {
  return {
    severity,
    code,
    message,
    ...options,
  };
}
