/**
 * Hand-maintained mirror of the CLI's wire types (design.md D5 of
 * `unified-config-ui-pkg`). Source of truth: `src/core/config-api/wire-types.ts`
 * and `src/core/config-api/router.ts` in the main `rasen` package — there is
 * no build-time import path between `packages/ui` and the root package (D1:
 * no workspace), so this file is kept in sync by hand and pinned by the
 * `satisfies <ResponseType>` fixtures in `test/fixtures/*.ts` (no `as`/`as
 * unknown as` cast anywhere there — a real `tsc` drift tripwire), exercised
 * from `test/api/fixtures.test.ts` and every other test that imports them.
 *
 * If you change this file, check the CLI source above first — the wire
 * contract is v1-frozen by the `unified-config-api` spec, so a mismatch here
 * is a bug in this mirror, not a sanctioned protocol change.
 */

export type ConfigScope = 'global' | 'project';
export type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum' | 'array';
export type ConfigSource = 'default' | 'global' | 'project' | 'env-override';

/** A registered project, or the server's launch project. */
export interface ProjectRef {
  projectId: string;
  name: string;
  root: string;
}

export interface WireConstraints {
  type: ConfigValueType;
  enumValues?: readonly string[];
  range?: { gt: number; lte: number };
}

/** `ConfigKeyDefinition` minus the unserializable `validate` function, plus derived `constraints`. */
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
  /** Present only when a raw on-disk scope value fails registry validation. */
  warnings?: string[];
}

/** Uniform non-2xx error envelope. */
export interface ApiErrorBody {
  error: { code: string; message: string; fix?: string };
}

// ---- Response envelopes (router.ts handlers) ----

export interface HealthResponse {
  ok: true;
  version: string;
  project: ProjectRef | null;
}

export interface ListProjectsResponse {
  projects: ProjectRef[];
}

export interface ListConfigResponse {
  project: ProjectRef | null;
  entries: WireConfigEntry[];
}

export interface GetConfigKeyResponse {
  entry: WireConfigEntry;
}

/** PUT and DELETE both respond with the re-resolved entry. */
export type WriteConfigKeyResponse = GetConfigKeyResponse;
