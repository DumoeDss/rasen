/**
 * The per-project membership record inside a Store (design D1/D3).
 *
 * `<store>/.rasen-store/projects/<projectId>.yaml` is the single authority for
 * "does this project belong to this Store". One file per project is the whole
 * point: two people adding two different projects to one Store write two
 * different files, so the merge that used to conflict in a shared map now has
 * nothing to reconcile.
 *
 * The identity INSIDE the record is the authority for which project it
 * describes, and the filename must agree with it. A disagreement is reported
 * (`store_project_record_key_mismatch`) and never resolved by preferring one
 * side: trusting the filename would let a rename reassign membership, and
 * trusting the contents would let a copied file claim a second project's.
 *
 * Schemas here follow `foundation.ts`: Zod `.strict()`, so an unknown key is a
 * parse ERROR rather than a tolerated field, and every schema has a serializer
 * beside it so the two can never drift.
 */
import * as nodeFs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import { FileSystemUtils } from '../../utils/file-system.js';
import { isNodeErrorCode, pathIsFile, writeFileAtomically } from '../file-state.js';
import { isKebabId } from '../id.js';
import { formatZodIssues } from '../zod-issues.js';
import { StoreError, type StoreDiagnostic } from './errors.js';
import { getStoreMetadataDir } from './foundation.js';
import {
  projectIdentityUnrecordable,
  storeProjectRecordKeyMismatch,
} from './identity-diagnostics.js';
import { assertCredentialFreeRemote } from './remote.js';
import { isWindowsReservedDeviceName } from './planning-validation.js';

export { WINDOWS_RESERVED_DEVICE_NAMES } from './planning-validation.js';

const fs = nodeFs.promises;

/** Directory holding one membership record per member project. */
export const STORE_PROJECT_RECORDS_DIR_NAME = 'projects';

/** Record files are YAML, named by the member project's permanent identity. */
export const STORE_PROJECT_RECORD_EXTENSION = '.yaml';

/**
 * Any RFC 4122 textual form. `projectId` is typed as a plain string in
 * `project-config.ts`, so hand-written values exist in the wild; this is one of
 * the two grammars a record filename may be built from, not a claim about what
 * `ensureProjectIdInConfig` mints.
 */
const PROJECT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Trim + lowercase, so a hand-edited uppercase UUID does not read as a second
 * project — the same rule child A applies to Store identities. Both accepted
 * grammars are lowercase in their normalized form, which is what keeps the
 * identity → filename mapping injective on case-insensitive filesystems too.
 */
export function normalizeProjectIdentity(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether two project-identity strings refer to the same project, using the
 * normalized (trim + lowercase) form so a hand-edited uppercase UUID never
 * reads as a second project. Two `undefined` values are equal; a defined value
 * and `undefined` are not — so a missing config identity is never silently
 * treated as matching a registered one (M3).
 */
export function sameProjectIdentity(
  left: string | undefined,
  right: string | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return normalizeProjectIdentity(left) === normalizeProjectIdentity(right);
}

/**
 * Why this identity cannot name a record file, or null when it can. Returned
 * rather than thrown so the provider can report a whole Store's worth of
 * problems instead of stopping at the first.
 */
export function projectIdentityRecordProblem(projectId: string): string | null {
  const normalized = normalizeProjectIdentity(projectId);

  if (normalized.length === 0) {
    return 'it is empty';
  }
  if (!PROJECT_UUID_PATTERN.test(normalized) && !isKebabId(normalized)) {
    return 'it is neither a UUID nor a kebab-case id';
  }
  if (isWindowsReservedDeviceName(normalized)) {
    return `'${normalized}' is a name Windows reserves for a device`;
  }
  // Defence in depth: neither accepted grammar can produce a separator, a
  // `..`, or a trailing dot/space, so reaching here means a grammar was
  // widened without revisiting the filename rule.
  if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('..')) {
    return 'it contains a path separator or a parent-directory segment';
  }

  return null;
}

export function isRecordableProjectIdentity(projectId: string): boolean {
  return projectIdentityRecordProblem(projectId) === null;
}

/**
 * The validated, normalized filename stem for an identity. Throws rather than
 * sanitizing: two distinct identities sanitized onto one filename would
 * silently overwrite one project's membership with another's, which is the
 * exact failure class per-project records exist to remove.
 */
export function assertRecordableProjectIdentity(projectId: string): string {
  const diagnostic = projectIdentityDiagnostic(projectId);
  if (diagnostic !== null) {
    throw new StoreError(diagnostic.message, diagnostic.code, {
      ...(diagnostic.target !== undefined ? { target: diagnostic.target } : {}),
      ...(diagnostic.fix !== undefined ? { fix: diagnostic.fix } : {}),
    });
  }
  return normalizeProjectIdentity(projectId);
}

/**
 * The unrecordable-identity finding, or null when the identity is fine. ONE
 * message for the throwing and the reporting path alike — `assert…` above
 * wraps exactly this, so a read-only surface and a refused write can never
 * describe the same problem differently.
 */
export function projectIdentityDiagnostic(projectId: string): StoreDiagnostic | null {
  const problem = projectIdentityRecordProblem(projectId);
  if (problem === null) return null;
  return projectIdentityUnrecordable({ projectId, reason: problem });
}

// -----------------------------------------------------------------------------
// Record shape
// -----------------------------------------------------------------------------

/** What a project owns inside the Store, recorded by `store adopt`. */
export interface StoreProjectRecordAdoption {
  /** Spec directory names the project owns in the Store. */
  specs: string[];
  /** Active change directory names the project owns in the Store. */
  changes: string[];
  /** ISO-8601 timestamp of the adoption. */
  adoptedAt: string;
}

/**
 * Membership roles. Separately readable by construction: "this project plans
 * in the Store" and "this project shares knowledge with the Store" never
 * collapse into one ambiguous flag.
 *
 * A future `execution` field fits the same container and could only ever
 * express CANDIDACY — membership is roster and eligibility, never the decision
 * of where a change is implemented.
 */
export interface StoreProjectRoles {
  planning: boolean;
  knowledge: boolean;
}

export interface StoreProjectRecord {
  version: 1;
  /** The authority for which project this record describes. */
  projectId: string;
  /** Display name, for reading only. Never keys anything. */
  id?: string;
  /** Credential-free clone source, so another machine can find the project. */
  remote?: string;
  /** Store-root-relative portable bundle locator. Grants no ownership. */
  knowledgeBundle?: string;
  roles: StoreProjectRoles;
  adoption?: StoreProjectRecordAdoption;
}

const RolesSchema = z
  .object({
    planning: z.boolean(),
    knowledge: z.boolean(),
  })
  .strict();

const AdoptionSchema = z
  .object({
    specs: z.array(z.string()),
    changes: z.array(z.string()),
    adoptedAt: z.string().min(1),
  })
  .strict();

const StoreProjectRecordSchema = z
  .object({
    version: z.literal(1),
    projectId: z.string().min(1),
    id: z.string().min(1).optional(),
    remote: z.string().min(1).optional(),
    knowledgeBundle: z.string().min(1).optional(),
    roles: RolesSchema,
    adoption: AdoptionSchema.optional(),
  })
  .strict();

function invalidRecordError(filePath: string, message: string): StoreError {
  return new StoreError(
    `Invalid store project membership record: ${message}`,
    'invalid_store_project_record',
    {
      target: 'store.membership',
      fix: `Repair or remove ${filePath}.`,
    }
  );
}

export function parseStoreProjectRecord(content: string, filePath: string): StoreProjectRecord {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw invalidRecordError(filePath, error instanceof Error ? error.message : String(error));
  }

  const result = StoreProjectRecordSchema.safeParse(raw);
  if (!result.success) {
    throw invalidRecordError(filePath, formatZodIssues(result.error));
  }

  const problem = projectIdentityRecordProblem(result.data.projectId);
  if (problem !== null) {
    throw invalidRecordError(
      filePath,
      `projectId '${result.data.projectId}' ${problem}`
    );
  }

  return {
    version: 1,
    projectId: normalizeProjectIdentity(result.data.projectId),
    ...(result.data.id !== undefined ? { id: result.data.id } : {}),
    ...(result.data.remote !== undefined ? { remote: result.data.remote } : {}),
    ...(result.data.knowledgeBundle !== undefined
      ? { knowledgeBundle: result.data.knowledgeBundle }
      : {}),
    roles: { planning: result.data.roles.planning, knowledge: result.data.roles.knowledge },
    ...(result.data.adoption !== undefined
      ? {
          adoption: {
            specs: [...result.data.adoption.specs],
            changes: [...result.data.adoption.changes],
            adoptedAt: result.data.adoption.adoptedAt,
          },
        }
      : {}),
  };
}

/** Field order is fixed here so a rewrite of an unchanged record is a no-op diff. */
export function serializeStoreProjectRecord(record: StoreProjectRecord): string {
  const result = StoreProjectRecordSchema.safeParse(record);
  if (!result.success) {
    throw invalidRecordError(
      `${record.projectId}${STORE_PROJECT_RECORD_EXTENSION}`,
      formatZodIssues(result.error)
    );
  }
  assertRecordableProjectIdentity(record.projectId);

  return stringifyYaml({
    version: 1,
    projectId: normalizeProjectIdentity(record.projectId),
    ...(record.id !== undefined ? { id: record.id } : {}),
    ...(record.remote !== undefined ? { remote: record.remote } : {}),
    ...(record.knowledgeBundle !== undefined
      ? { knowledgeBundle: record.knowledgeBundle }
      : {}),
    roles: { planning: record.roles.planning, knowledge: record.roles.knowledge },
    ...(record.adoption !== undefined
      ? {
          adoption: {
            specs: record.adoption.specs,
            changes: record.adoption.changes,
            adoptedAt: record.adoption.adoptedAt,
          },
        }
      : {}),
  });
}

// -----------------------------------------------------------------------------
// Paths
// -----------------------------------------------------------------------------

/** `<store>/.rasen-store/projects` — composed, never string-concatenated. */
export function getStoreProjectRecordsDir(storeRoot: string): string {
  return path.join(getStoreMetadataDir(storeRoot), STORE_PROJECT_RECORDS_DIR_NAME);
}

/** `<store>/.rasen-store/projects/<projectId>.yaml`, identity validated first. */
export function getStoreProjectRecordPath(storeRoot: string, projectId: string): string {
  return path.join(
    getStoreProjectRecordsDir(storeRoot),
    `${assertRecordableProjectIdentity(projectId)}${STORE_PROJECT_RECORD_EXTENSION}`
  );
}

// -----------------------------------------------------------------------------
// Reading (zero writes on every path)
// -----------------------------------------------------------------------------

export interface StoreProjectRecordRead {
  record: StoreProjectRecord | null;
  filePath: string;
  diagnostics: StoreDiagnostic[];
}

function keyMismatchDiagnostic(
  filePath: string,
  fileIdentity: string,
  record: StoreProjectRecord
): StoreDiagnostic {
  return storeProjectRecordKeyMismatch({
    filePath,
    fileIdentity,
    recordedIdentity: record.projectId,
  });
}

async function readRecordFile(filePath: string): Promise<StoreProjectRecord | null> {
  // M4: only ENOENT is the ordinary "no record yet" state. Any other stat/read
  // failure (EACCES, EIO, EBUSY, Windows delete-pending, network drive blip)
  // means a real member is unreadable — report it, never silently treat it as
  // absent. The caller wraps StoreError in a diagnostic.
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return parseStoreProjectRecord(await fs.readFile(filePath, 'utf-8'), filePath);
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return null;
    if (error instanceof StoreError) throw error;
    throw new StoreError(
      `Cannot read project record ${filePath} (${(error as NodeJS.ErrnoException).code ?? error}).`,
      'store_project_record_unreadable',
      {
        target: 'store.membership',
        fix: `Check permissions on ${filePath} and retry.`,
      }
    );
  }
}

/**
 * Reads one project's record. A record whose filename and identity disagree is
 * reported and NOT returned — neither side is treated as authoritative, so the
 * honest answer to "is this project a member?" is "this Store's data is
 * broken", not a guess.
 */
export async function readStoreProjectRecord(
  storeRoot: string,
  projectId: string
): Promise<StoreProjectRecordRead> {
  const stem = assertRecordableProjectIdentity(projectId);
  const filePath = path.join(
    getStoreProjectRecordsDir(storeRoot),
    `${stem}${STORE_PROJECT_RECORD_EXTENSION}`
  );

  let record: StoreProjectRecord | null;
  try {
    record = await readRecordFile(filePath);
  } catch (error) {
    if (error instanceof StoreError) {
      return { record: null, filePath, diagnostics: [error.diagnostic] };
    }
    throw error;
  }

  if (!record) return { record: null, filePath, diagnostics: [] };

  if (record.projectId !== stem) {
    return {
      record: null,
      filePath,
      diagnostics: [keyMismatchDiagnostic(filePath, stem, record)],
    };
  }

  return { record, filePath, diagnostics: [] };
}

export interface StoreProjectRecordListing {
  records: StoreProjectRecord[];
  diagnostics: StoreDiagnostic[];
}

/**
 * Every membership record in the Store. One unreadable or mis-named file
 * produces a diagnostic and is skipped — a single broken record must not blind
 * the whole roster, because the roster is what tells the user which record is
 * broken.
 */
export async function listStoreProjectRecords(
  storeRoot: string
): Promise<StoreProjectRecordListing> {
  const dir = getStoreProjectRecordsDir(storeRoot);
  let entries: nodeFs.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      // No records directory is the ordinary state of a Store nobody has added
      // a project to; it is not an error and never created on read.
      return { records: [], diagnostics: [] };
    }
    // M4: a directory that exists but cannot be enumerated (EACCES, EIO,
    // EBUSY, network drive blip) is NOT empty — report it, never silently hide
    // a real roster behind an absent-looking result.
    throw new StoreError(
      `Cannot enumerate project records in ${dir} (${(error as NodeJS.ErrnoException).code ?? error}).`,
      'store_project_records_unreadable',
      {
        target: 'store.membership',
        fix: `Check permissions on ${dir} and retry.`,
      }
    );
  }

  const records: StoreProjectRecord[] = [];
  const diagnostics: StoreDiagnostic[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(STORE_PROJECT_RECORD_EXTENSION)) continue;

    const filePath = path.join(dir, entry.name);
    const fileIdentity = normalizeProjectIdentity(
      entry.name.slice(0, entry.name.length - STORE_PROJECT_RECORD_EXTENSION.length)
    );

    let record: StoreProjectRecord | null;
    try {
      record = await readRecordFile(filePath);
    } catch (error) {
      if (error instanceof StoreError) {
        diagnostics.push(error.diagnostic);
        continue;
      }
      throw error;
    }
    if (!record) continue;

    if (record.projectId !== fileIdentity) {
      diagnostics.push(keyMismatchDiagnostic(filePath, fileIdentity, record));
      continue;
    }

    records.push(record);
  }

  records.sort((left, right) => left.projectId.localeCompare(right.projectId));
  return { records, diagnostics };
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

/**
 * Writes one record atomically (temp file in the same directory, then rename),
 * after validating the identity and rejecting a credential-bearing remote. The
 * value is validated BEFORE the directory is created, so a refused write
 * leaves no trace at all.
 */
export async function writeStoreProjectRecord(
  storeRoot: string,
  record: StoreProjectRecord
): Promise<string> {
  assertCredentialFreeRemote(record.remote, 'store.metadata');
  const filePath = getStoreProjectRecordPath(storeRoot, record.projectId);
  const content = serializeStoreProjectRecord(record);

  await FileSystemUtils.createDirectory(getStoreProjectRecordsDir(storeRoot));
  await writeFileAtomically(filePath, content);
  return filePath;
}

/** Removes a project's record. No-op when absent. Returns true when removed. */
export async function deleteStoreProjectRecord(
  storeRoot: string,
  projectId: string
): Promise<boolean> {
  const filePath = getStoreProjectRecordPath(storeRoot, projectId);
  if (!(await pathIsFile(filePath))) return false;
  await fs.rm(filePath, { force: true });
  return true;
}

/**
 * Roles only ever widen. Every command in this change ADDS a role; none
 * removes one, so re-running `add-project` after `adopt` must not clear the
 * planning membership the adoption established.
 */
export function mergeStoreProjectRoles(
  existing: StoreProjectRoles | undefined,
  requested: StoreProjectRoles
): StoreProjectRoles {
  return {
    planning: (existing?.planning ?? false) || requested.planning,
    knowledge: (existing?.knowledge ?? false) || requested.knowledge,
  };
}
