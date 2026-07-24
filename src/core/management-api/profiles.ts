/**
 * Named workflow-profile registry over the management HTTP API
 * (profile-http-api design D1):
 *   GET  /api/v1/profiles → { profiles: WireProfileEntry[] }
 *   POST /api/v1/profiles  { op: 'create'|'update'|'delete', ... }
 *
 * Unlike the workflow-library and pipeline bridges, a profile write touches
 * only a YAML file under the global config dir — no artifact installation, no
 * subprocess. This module calls `named-profiles.ts` directly, the same code
 * path the CLI's `rasen profile` commands use, so validation, reserved-name
 * rules, dependency-closure normalization, and atomic writes are all inherited.
 * `NamedProfileError.code` maps to an HTTP status.
 */
import {
  NamedProfileError,
  deleteNamedProfile,
  listAvailableProfiles,
  namedProfileExists,
  parseProfileDefinition,
  saveNamedProfile,
  PROFILE_DEFINITION_VERSION,
  PROFILE_DEFINITION_VERSION_V1,
  type AvailableProfile,
} from '../named-profiles.js';
import { isRetentionMode, type RetentionMode } from '../retention.js';
import type {
  ProfileListResponse,
  ProfileMutationRequest,
  ProfileMutationResponse,
  WireProfileEntry,
} from './wire-types.js';

export type ProfileApiResult<T> =
  | { ok: true; status: number; response: T }
  | { ok: false; status: number; code: string; message: string };

function toWireEntry(profile: AvailableProfile): WireProfileEntry {
  return {
    name: profile.name,
    builtIn: profile.builtIn,
    ...(profile.definition ? { workflows: profile.definition.workflows } : {}),
    ...(profile.error ? { error: profile.error } : {}),
  };
}

/** `GET /api/v1/profiles` — the built-in `full`/`core` plus every saved profile; a broken file surfaces its error. Never fails. */
export function handleProfilesRead(): ProfileListResponse {
  return { profiles: listAvailableProfiles().map(toWireEntry) };
}

/** Maps a `NamedProfileError.code` onto its HTTP status (design D1). */
function statusForCode(code: NamedProfileError['code']): number {
  switch (code) {
    case 'not_found':
      return 404;
    case 'already_exists':
      return 409;
    // invalid_name, reserved_name, invalid_file, unsupported_format
    default:
      return 400;
  }
}

/**
 * `POST /api/v1/profiles` — create, update, or delete a saved profile
 * (design D1). Create/update validate through `parseProfileDefinition`
 * (unknown ids → 400) and return the NORMALIZED (closure-expanded) definition,
 * so the editor re-renders exactly what was stored (design D5).
 */
export function handleProfileMutation(request: unknown): ProfileApiResult<ProfileMutationResponse> {
  if (typeof request !== 'object' || request === null) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'Request body must be an object.' };
  }
  const body = request as Partial<ProfileMutationRequest>;
  if (body.op !== 'create' && body.op !== 'update' && body.op !== 'delete') {
    return {
      ok: false,
      status: 400,
      code: 'invalid_input',
      message: 'op must be "create", "update", or "delete".',
    };
  }
  if (typeof body.name !== 'string' || body.name.length === 0) {
    return { ok: false, status: 400, code: 'invalid_input', message: 'name must be a non-empty string.' };
  }

  try {
    if (body.op === 'delete') {
      // Reserved names (`full`/`core`/`custom`) are rejected by the library's
      // own name assertion → 400; a saved name absent on disk → 404.
      deleteNamedProfile(body.name);
      return { ok: true, status: 200, response: { deleted: body.name } };
    }

    const workflows = (body as { workflows?: unknown }).workflows;
    if (!Array.isArray(workflows) || workflows.some((id) => typeof id !== 'string')) {
      return { ok: false, status: 400, code: 'invalid_input', message: 'workflows must be an array of strings.' };
    }

    if (body.op === 'update' && !namedProfileExists(body.name)) {
      // `namedProfileExists` throws `reserved_name` for a built-in name (caught
      // below → 400); a well-formed saved name simply missing → 404.
      throw new NamedProfileError(`Profile "${body.name}" was not found.`, 'not_found', {
        key: 'profileNotFound',
        values: { name: body.name },
      });
    }

    // `parseProfileDefinition` validates membership (unknown id → invalid_file →
    // 400) and returns the normalized, dependency-closed definition. An explicit
    // `retention` in the body writes a version-2 definition directly. When it is
    // omitted on an update we PRESERVE the profile's stored retention rather than
    // treating the input as version 1 — a v1 migration would reset a `codify`/
    // `report` profile to `off` (retro-command no longer appears in any workflow
    // list), silently discarding the policy and propagating that downgrade to
    // every profile-locked project on its next update. Only a genuinely
    // retention-less create falls back to version-1 migration.
    const retention = (body as { retention?: unknown }).retention;
    let effectiveRetention: RetentionMode | undefined = isRetentionMode(retention)
      ? retention
      : undefined;
    if (effectiveRetention === undefined && body.op === 'update') {
      effectiveRetention = listAvailableProfiles().find((entry) => entry.name === body.name)
        ?.definition?.retention;
    }
    const definition = parseProfileDefinition(
      effectiveRetention !== undefined
        ? { version: PROFILE_DEFINITION_VERSION, workflows, retention: effectiveRetention }
        : { version: PROFILE_DEFINITION_VERSION_V1, workflows },
      'profile definition'
    );
    // Create refuses an existing name (overwrite:false → already_exists → 409);
    // update requires the file to already exist (checked above) and overwrites.
    saveNamedProfile(body.name, definition, { overwrite: body.op === 'update' });
    return {
      ok: true,
      status: 200,
      response: { profile: { name: body.name, builtIn: false, workflows: definition.workflows } },
    };
  } catch (error) {
    if (error instanceof NamedProfileError) {
      return { ok: false, status: statusForCode(error.code), code: error.code, message: error.message };
    }
    return {
      ok: false,
      status: 500,
      code: 'internal_error',
      message: `Failed to write the profile: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
