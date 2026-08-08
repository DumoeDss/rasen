/**
 * The Archive v2 accounting writer, beside the v1 one.
 *
 * Which writer runs is decided from the plan's recorded finalization block —
 * present means a Store v2 project scope, absent means a standalone project or
 * a legacy flat Store. Nothing here inspects an existing `archive.json` to
 * decide: two schemas share one filename and only the plan's scope says which
 * of them belongs at a destination.
 *
 * The record reaches this module as a DRAFT: everything except the two facts
 * only the published tree can supply, `evidence` and `missing`. The active
 * change's evidence is not the published evidence — the transaction appends an
 * `## Archive` section to the staged ship log and captures quality inputs —
 * so hashing anything earlier would record a digest the entry does not have.
 *
 * Identity is re-verified here, at the last moment before bytes are written,
 * from the preimages the plan froze. A record whose `changeInstanceId` no
 * longer derives from its planning scope and seed, or whose `workspacePairId`
 * no longer derives from its ordered Change/worktree triple, produces no file.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  ArchiveAccountingError,
  hashArchiveEvidence,
  resolveMissingEvidenceNames,
  type EvidenceEntry,
} from './archive-accounting.js';
import { canonicalJson } from './canonical-json.js';
import {
  parseArchiveV2,
  serializeArchiveV2,
  validateArchiveV2,
  type ArchiveV2VerifiedIdentityInput,
  type ArchiveV2Wire,
} from './store/finalization-v2.js';
import {
  verifyChangeInstanceId,
  verifyWorkspacePairId,
} from './store/planning-identity.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * An Archive v2 record without the two published-tree facts. This is what a
 * finalization plan freezes and what `--dry-run` prints.
 */
export type ArchiveV2RecordDraft = DistributiveOmit<ArchiveV2Wire, 'evidence' | 'missing'>;

/**
 * The derivation preimages the writer re-verifies. They are portable strings,
 * so they survive the plan's canonical serialization; the branded verified
 * types are re-established here by verification, never by a cast.
 */
export interface ArchiveV2IdentityPreimages {
  readonly planningScopeId: string;
  readonly instanceSeed: string;
  readonly planningWorktreeInstanceId: string;
  readonly executionWorktreeInstanceId: string;
}

/** A validated record together with the exact bytes that will be written. */
export interface PreparedArchiveV2Accounting {
  readonly record: ArchiveV2Wire;
  readonly content: string;
}

export const ARCHIVE_V2_RECORD_FILENAME = 'archive.json';

function recordError(operation: string, target: string, message: string, cause?: unknown): Error {
  return new ArchiveAccountingError(operation, target, cause ?? new Error(message));
}

/**
 * Validates the identity/outcome half of a draft before anything is written.
 * `evidence` and `missing` are supplied as empty because the published tree has
 * not been produced yet; every other field is validated exactly as it will be.
 */
export function validateArchiveV2Draft(draft: ArchiveV2RecordDraft): ArchiveV2Wire {
  return validateArchiveV2({ ...(draft as object), evidence: [], missing: [] });
}

/** Maps a published evidence inventory onto the record contract's entry shape. */
export function archiveV2EvidenceEntries(
  entries: readonly EvidenceEntry[]
): Array<{ path: string; sha256: string }> {
  return entries
    .map(entry => ({ path: entry.path, sha256: entry.sha256.toLowerCase() }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Re-derives both identities and returns the record in the shape
 * `serializeArchiveV2` requires. This is the only place a verified identity is
 * produced for a durable write.
 */
function verifiedRecord(
  record: ArchiveV2Wire,
  identity: ArchiveV2IdentityPreimages,
  target: string
): ArchiveV2Wire & ArchiveV2VerifiedIdentityInput {
  if (record.planning.worktreeInstanceId !== identity.planningWorktreeInstanceId) {
    throw recordError(
      'archive-v2-identity',
      target,
      `Record planning worktree '${record.planning.worktreeInstanceId}' disagrees with the frozen preimage '${identity.planningWorktreeInstanceId}'.`
    );
  }
  if (
    record.codeMerge !== null &&
    record.codeMerge.worktreeInstanceId !== identity.executionWorktreeInstanceId
  ) {
    throw recordError(
      'archive-v2-identity',
      target,
      `Record code-merge worktree '${record.codeMerge.worktreeInstanceId}' disagrees with the frozen preimage '${identity.executionWorktreeInstanceId}'.`
    );
  }
  let changeInstanceId;
  let workspacePairId;
  try {
    changeInstanceId = verifyChangeInstanceId(record.changeInstanceId, {
      planningScopeId: identity.planningScopeId,
      instanceSeed: identity.instanceSeed,
    });
    workspacePairId = verifyWorkspacePairId(record.workspacePairId, {
      changeInstanceId,
      planningWorktreeInstanceId: identity.planningWorktreeInstanceId,
      executionWorktreeInstanceId: identity.executionWorktreeInstanceId,
    });
  } catch (error) {
    throw recordError(
      'archive-v2-identity',
      target,
      error instanceof Error ? error.message : String(error),
      error
    );
  }
  return { ...record, changeInstanceId, workspacePairId } as ArchiveV2Wire &
    ArchiveV2VerifiedIdentityInput;
}

/**
 * Completes the draft from the published tree, validates it, re-verifies both
 * identities, and serializes it through the self-verifying serializer. An
 * inconsistent draft fails here and produces no file.
 */
export async function resolveArchiveV2Accounting(input: {
  readonly archivedDir: string;
  readonly draft: ArchiveV2RecordDraft;
  readonly identity: ArchiveV2IdentityPreimages;
}): Promise<PreparedArchiveV2Accounting> {
  const evidence = archiveV2EvidenceEntries(await hashArchiveEvidence(input.archivedDir));
  const ledgerPath = path.join(input.archivedDir, ARCHIVE_V2_RECORD_FILENAME);
  let record: ArchiveV2Wire;
  try {
    record = validateArchiveV2({
      ...(input.draft as object),
      evidence,
      missing: resolveMissingEvidenceNames(evidence),
    });
  } catch (error) {
    throw recordError(
      'archive-v2-validate',
      ledgerPath,
      error instanceof Error ? error.message : String(error),
      error
    );
  }
  let content: string;
  try {
    content = serializeArchiveV2(verifiedRecord(record, input.identity, ledgerPath));
  } catch (error) {
    if (error instanceof ArchiveAccountingError) throw error;
    throw recordError(
      'archive-v2-serialize',
      ledgerPath,
      error instanceof Error ? error.message : String(error),
      error
    );
  }
  return { record, content };
}

/** Re-parses the written record and re-hashes the evidence it claims. */
export async function verifyArchiveV2Accounting(
  archivedDir: string,
  expected: PreparedArchiveV2Accounting
): Promise<void> {
  const ledgerPath = path.join(archivedDir, ARCHIVE_V2_RECORD_FILENAME);
  let content: string;
  try {
    content = await fs.readFile(ledgerPath, 'utf8');
  } catch (error) {
    throw new ArchiveAccountingError('archive-v2-read', ledgerPath, error);
  }
  let parsed: ArchiveV2Wire;
  try {
    parsed = parseArchiveV2(content);
  } catch (error) {
    throw new ArchiveAccountingError('archive-v2-parse', ledgerPath, error);
  }
  if (canonicalJson(parsed) !== canonicalJson(expected.record)) {
    throw recordError(
      'archive-v2-verify',
      ledgerPath,
      'Parsed Archive v2 record differs from the planned record.'
    );
  }
  const actualEvidence = archiveV2EvidenceEntries(await hashArchiveEvidence(archivedDir));
  if (JSON.stringify(actualEvidence) !== JSON.stringify(expected.record.evidence)) {
    throw recordError(
      'archive-v2-evidence-verify',
      ledgerPath,
      'Finalized evidence hashes do not match the Archive v2 record.'
    );
  }
}

/**
 * Atomic write, mirroring the v1 writer's temp-file / fsync / rename / verify
 * sequence exactly so a crash never leaves a half-written record.
 */
export async function writeArchiveV2Json(
  archivedDir: string,
  prepared: PreparedArchiveV2Accounting
): Promise<void> {
  const ledgerPath = path.join(archivedDir, ARCHIVE_V2_RECORD_FILENAME);
  const tempPath = path.join(
    archivedDir,
    `.archive.json.tmp-${process.pid}-${randomUUID()}`
  );
  let handle: import('node:fs/promises').FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, 'wx', 0o600);
    await handle.writeFile(prepared.content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, ledgerPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw new ArchiveAccountingError('archive-v2-write', ledgerPath, error);
  }
  await verifyArchiveV2Accounting(archivedDir, prepared);
}
