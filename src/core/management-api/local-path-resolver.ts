import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  LocalPathSelectionKind,
  ResolveLocalPathResponse,
} from './wire-types.js';

const MAX_PATH_LENGTH = 4096;
export const PATH_CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;
const VALID_KINDS = new Set<LocalPathSelectionKind>([
  'directory',
  'file',
  'file-or-directory',
]);

export type ResolveLocalPathResult =
  | { ok: true; response: ResolveLocalPathResponse }
  | { ok: false; status: number; code: string; message: string };

export interface LocalPathResolverOptions {
  realpath?: (candidate: string) => Promise<string>;
  stat?: (canonicalPath: string) => Promise<fs.Stats>;
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export async function resolveLocalPath(
  candidate: unknown,
  requestedKind: unknown,
  options: LocalPathResolverOptions = {}
): Promise<ResolveLocalPathResult> {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return { ok: false, status: 400, code: 'invalid_path', message: 'path must be a non-empty string.' };
  }
  if (
    typeof requestedKind !== 'string' ||
    !VALID_KINDS.has(requestedKind as LocalPathSelectionKind)
  ) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_kind',
      message: "kind must be 'directory', 'file', or 'file-or-directory'.",
    };
  }
  if (!path.isAbsolute(candidate)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_path',
      message: 'path must be an absolute filesystem path.',
    };
  }
  if (candidate.length > MAX_PATH_LENGTH) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_path',
      message: `path must be at most ${MAX_PATH_LENGTH} characters.`,
    };
  }
  if (PATH_CONTROL_CHAR_PATTERN.test(candidate)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_path',
      message: 'path must not contain control characters.',
    };
  }

  const realpath = options.realpath ?? fs.promises.realpath;
  const statPath = options.stat ?? fs.promises.stat;
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(candidate);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        ok: false,
        status: 403,
        code: 'path_forbidden',
        message: `Permission denied resolving ${candidate}.`,
      };
    }
    return {
      ok: false,
      status: 404,
      code: 'path_not_found',
      message: `${candidate} does not exist.`,
    };
  }

  let stat: fs.Stats;
  try {
    // Check the object named by the canonical result, not the submitted
    // spelling that may have been replaced after realpath completed.
    stat = await statPath(canonicalPath);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        ok: false,
        status: 403,
        code: 'path_forbidden',
        message: `Permission denied reading ${canonicalPath}.`,
      };
    }
    return {
      ok: false,
      status: 404,
      code: 'path_not_found',
      message: `${canonicalPath} no longer exists.`,
    };
  }

  const actualKind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : null;
  if (actualKind === null) {
    return {
      ok: false,
      status: 400,
      code: 'unsupported_path_kind',
      message: `${candidate} is not a regular file or directory.`,
    };
  }
  const kind = requestedKind as LocalPathSelectionKind;
  if (kind !== 'file-or-directory' && kind !== actualKind) {
    return {
      ok: false,
      status: 400,
      code: kind === 'directory' ? 'not_a_directory' : 'not_a_file',
      message: `${candidate} is not a ${kind}.`,
    };
  }

  return {
    ok: true,
    response: {
      path: canonicalPath,
      kind: actualKind,
      separator: path.sep,
    },
  };
}
