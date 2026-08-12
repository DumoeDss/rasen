import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { CanonicalRunRecord } from './record.js';
import { decodeCanonicalRunRecord, digestCanonicalRunRecord } from './record.js';
import type { RunId } from '../contracts.js';
import {
  RunStoreError,
  type RunStore,
  type RunSummary,
} from './run-store.js';
import {
  PublishError,
  publishAtomic,
  stagingPathFor,
  type PublishPlumbing,
} from './publish-atomic.js';

/**
 * Real-filesystem `PublishPlumbing` (task 9.6 production adapter): stage the
 * bytes to a per-attempt sibling from `stagingPathFor`, fsync them, then
 * publish by hard-linking the staged inode to the final name. A crash at any
 * named boundary leaves NO corrupt target — only staging residue, which the
 * store's `^record-v(\d+)\.json$` head filter ignores.
 *
 * Publication is `link(2)`, not `rename(2)`, matching the EvidenceStore policy
 * in `evidence-store-fs.ts`: link creates the final name atomically and fails
 * with EEXIST when it already exists, on both Windows and POSIX.
 *
 * A rename cannot be used even behind an `exists` precheck. Node's rename
 * REPLACES an existing target on BOTH platforms — on Windows libuv passes
 * MOVEFILE_REPLACE_EXISTING, so the older claim that Windows rename fails on a
 * present target was incorrect. That made the precheck the only thing standing
 * between two publishers and mutual replacement, and a precheck is TOCTOU by
 * construction: both observe an absent target, both rename, and each believes
 * it published. A caller could then hold a success receipt for a Record it did
 * not durably write. Link closes the window in the syscall itself, and
 * `publishAtomic`'s post-throw `exists` recheck byte-compares against the
 * winner.
 *
 * Because each attempt stages to its own path, residue is per-attempt rather
 * than per-version and is never reused by a retry. It stays inert: unreadable
 * as a head, unlinked on the race path, and ignored by every read path.
 *
 * State-free; one frozen instance is shared by every store over this process.
 * Exported so tests can assert the real publication verb directly: the
 * link-vs-rename distinction is invisible through the store API, because every
 * in-process call path checks for the target before publishing.
 */
export const FILESYSTEM_PLUMBING: PublishPlumbing = Object.freeze({
  exists: (p: string) => existsSync(p),
  readFinal: (p: string) => readFileSync(p),
  writeStaging: (p: string, bytes: Uint8Array) => writeFileSync(p, bytes),
  fsync: (p: string) => {
    // Best-effort durability of the staged bytes. The fd is opened read-only;
    // fsyncSync flushes any pending writes for that inode. On filesystems that
    // cannot fsync a regular file the call is swallowed — staging bytes still
    // reach the fs cache, and exclusivity of the publication is a property of
    // the link, not of the flush.
    let fd: number | undefined;
    try {
      fd = openSync(p, 'r');
      fsyncSync(fd);
    } catch {
      /* fsync unavailable — proceed; exclusivity of the link still holds */
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* best-effort */ }
      }
    }
  },
  publish: (stagingPath: string, targetPath: string) => {
    // Exclusive create: throws EEXIST if the final name is already taken.
    linkSync(stagingPath, targetPath);
    // The target now names the staged inode. Dropping the staging name is
    // cleanup of an already-durable publication, so a failure here must not
    // turn a successful publish into a reported failure.
    try { unlinkSync(stagingPath); } catch { /* inert residue */ }
  },
  removeStaging: (p: string) => {
    try { unlinkSync(p); } catch { /* absent or already dropped after the link */ }
  },
});

/**
 * Filesystem RunStore (task 9.2 "in registered machine-home"). Each Record
 * revision is published immutably via the staging → fsync → exclusive-create
 * contract (`publishAtomic`, task 9.6): the final `<root>/<runId>/record-v<version>.json`
 * only ever appears whole, and never replaces an existing file. The highest
 * present version is the head. create publishes v0; commit validates the
 * predecessor digest and publishes the next version. Reads never fall back to
 * an earlier revision.
 *
 * The predecessor check and the publication are NOT one atomic step, so two
 * processes can both build the same next version. That race resolves at the
 * publication boundary rather than being prevented: exactly one publisher
 * creates the final name, and any other publisher of that version is refused
 * with a typed `PublishError` unless its bytes are identical. A crash
 * mid-publish leaves only per-attempt staging residue, which the head filter
 * ignores.
 */
export function createFilesystemRunStore(rootDir: string): RunStore {
  const dirFor = (runId: RunId): string => path.join(rootDir, runId.replace(/[^a-z0-9]/gi, '_'));

  const ensureDir = (dir: string): void => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  };

  const headVersion = (dir: string): number => {
    if (!existsSync(dir)) return -1;
    const versions = readdirSync(dir)
      .map((file) => /^record-v(\d+)\.json$/.exec(file))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number.parseInt(match[1]!, 10));
    return versions.length === 0 ? -1 : Math.max(...versions);
  };

  const readVersion = (dir: string, version: number): CanonicalRunRecord => {
    const file = path.join(dir, `record-v${version}.json`);
    return decodeCanonicalRunRecord(JSON.parse(readFileSync(file, 'utf8')));
  };

  const publish = (dir: string, record: CanonicalRunRecord): void => {
    ensureDir(dir);
    const target = path.join(dir, `record-v${record.recordVersion}.json`);
    // Crash-durable immutable publication: stage → fsync → exclusive-create
    // link onto the final target. A crash at any boundary leaves NO corrupt
    // target; the staging sibling is invisible to the head filter. The staging
    // path MUST be per-attempt (see `stagingPathFor`): a name derived from the
    // target alone is shared by every concurrent publisher of this version, and
    // one publisher would then link the other's bytes into place while both
    // reported success.
    const staging = stagingPathFor(target);
    const bytes = Buffer.from(JSON.stringify(record, null, 0), 'utf8');
    publishAtomic(FILESYSTEM_PLUMBING, staging, target, bytes);
  };

  return Object.freeze({
    create(runId: RunId, initial: CanonicalRunRecord): void {
      const dir = dirFor(runId);
      if (headVersion(dir) !== -1) {
        throw new RunStoreError(
          'run_already_exists',
          'A Run with this RunId already exists in the store.'
        );
      }
      publish(dir, initial);
    },
    load(runId: RunId): CanonicalRunRecord {
      const dir = dirFor(runId);
      const version = headVersion(dir);
      if (version === -1) {
        throw new RunStoreError('run_not_found', 'No Run with this RunId.');
      }
      return readVersion(dir, version);
    },
    commit(runId: RunId, next: CanonicalRunRecord): void {
      const dir = dirFor(runId);
      const version = headVersion(dir);
      if (version === -1) {
        throw new RunStoreError('run_not_found', 'Cannot commit to an absent Run.');
      }
      const head = readVersion(dir, version);
      if (next.recordVersion !== head.recordVersion + 1) {
        throw new RunStoreError(
          'run_record_version_gap',
          'Committed Record version must be exactly head + 1.'
        );
      }
      if (next.previousRecordDigest !== digestCanonicalRunRecord(head)) {
        throw new RunStoreError(
          'run_record_predecessor_mismatch',
          'Committed Record predecessor digest must equal the head digest.'
        );
      }
      publish(dir, next);
    },
    has(runId: RunId): boolean {
      return headVersion(dirFor(runId)) !== -1;
    },
    writePlan(runId: RunId, plan: unknown): void {
      const dir = dirFor(runId);
      ensureDir(dir);
      const planFile = path.join(dir, 'plan.json');
      const bytes = Buffer.from(JSON.stringify(plan, null, 0), 'utf8');
      try {
        publishAtomic(FILESYSTEM_PLUMBING, stagingPathFor(planFile), planFile, bytes);
      } catch (error) {
        // `plan.json` is a read-path projection aid, not Record authority. An
        // already-present plan (including residue with different bytes) must
        // not abort `start()`, which reaches here only after v0 is durable and
        // reservations are finalized — there is nothing left to roll back.
        // `loadPlan` is correspondingly tolerant of an unreadable plan, and a
        // mismatched plan cannot cause a wrong resume: the pipeline command
        // cross-checks the plan's digests against the Record before using it.
        //
        // This DELIBERATELY makes the write best-effort rather than preserving
        // prior behaviour: once the target is byte-compared, a bare
        // `publishAtomic` here would propagate `publish_target_exists`. Only
        // the Record path is required to fail closed on a conflicting target.
        // Raw I/O failures still propagate — only `PublishError` is absorbed.
        if (error instanceof PublishError) return;
        throw error;
      }
    },
    loadPlan(runId: RunId): unknown | null {
      const dir = dirFor(runId);
      const planFile = path.join(dir, 'plan.json');
      if (!existsSync(planFile)) return null;
      try {
        return JSON.parse(readFileSync(planFile, 'utf8'));
      } catch {
        return null;
      }
    },
    list(): readonly RunSummary[] {
      if (!existsSync(rootDir)) return [];
      const summaries: RunSummary[] = [];
      for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(rootDir, entry.name);
        const version = headVersion(dir);
        if (version === -1) continue;
        try {
          const record = readVersion(dir, version);
          summaries.push(
            Object.freeze({
              runId: record.runId,
              recordVersion: record.recordVersion,
              status: record.status,
              terminal: record.terminal,
            })
          );
        } catch {
          // An unreadable revision is isolated; it does not abort the listing.
        }
      }
      return summaries;
    },
  });
}
