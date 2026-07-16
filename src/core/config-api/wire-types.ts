/**
 * Wire (HTTP JSON) shapes for the config API — see design.md D2/D3 of the
 * `unified-config-api` change. Kept separate from the in-process types
 * (`effective-config.ts`, `config-keys.ts`) because the wire shape drops the
 * unserializable `definition.validate` function in favor of derived
 * `constraints`, and adds `warnings` for read-time invalidity signaling.
 */
import type { ConfigScope, ConfigValueType } from '../config-keys.js';
import type { ConfigSource } from '../effective-config.js';

/** `{ projectId, name, root }` — a registered project, or the server's launch project. */
export interface ProjectRef {
  projectId: string;
  name: string;
  root: string;
}

export interface WireConstraints {
  type: ConfigValueType;
  enumValues?: readonly string[];
  /** For `type: 'number'`, or the fraction branch of `type: 'threshold'`. */
  range?: { gt: number; lte: number };
  /**
   * Present only for `type: 'threshold'` (dual-form): describes the
   * alternate absolute form, a strict object `{ remainingTokens: N }` where
   * `N` is an integer greater than `remainingTokensGt`. The fraction form's
   * range is `range` above — a `'threshold'` entry always carries both.
   */
  remainingTokensGt?: number;
}

/** `ConfigKeyDefinition` minus the `validate` function, plus derived `constraints` for form rendering. */
export interface WireConfigKeyDefinition {
  key: string;
  scopes: ConfigScope[];
  type: ConfigValueType;
  enumValues?: readonly string[];
  defaultValue: unknown;
  description: string;
  group: string;
  wildcard?: boolean;
  constraints: WireConstraints;
}

export interface WireConfigEntry {
  definition: WireConfigKeyDefinition;
  value: unknown;
  source: ConfigSource;
  scopeValues: { global?: unknown; project?: unknown };
  /** Present only when a raw on-disk scope value fails registry validation; the API never rewrites the file to fix it. */
  warnings?: string[];
}

/** Uniform non-2xx error envelope, mirroring the CLI's `StoreError` code/fix vocabulary. */
export interface ApiErrorBody {
  error: { code: string; message: string; fix?: string };
}
