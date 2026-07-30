import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
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
  publishAtomic,
  type PublishPlumbing,
} from './publish-atomic.js';

/**
 * Real-filesystem `PublishPlumbing` (task 9.6 production adapter): stage the
 * bytes to a sibling `.staging` file, fsync them, then atomically rename into
 * place with O_EXCL semantics. A crash at any named boundary leaves NO
 * corrupt target — only staging residue at `<target>.staging`, which the
 * store's `^record-v(\d+)\.json$` head filter ignores on retry. Same-directory
 * `renameSync` is atomic on POSIX (where it would otherwise overwrite); on
 * Windows it fails when the target EXISTS. The `exists` precondition lets us
 * throw a typed EEXIST before the rename on both platforms, so the rename is
 * only ever called against an absent target — and `publishAtomic`'s
 * post-throw `exists` recheck makes the race window idempotent rather than lossy.
 *
 * State-free; one frozen instance is shared by every store over this process.
 */
const FILESYSTEM_PLUMBING: PublishPlumbing = Object.freeze({
  exists: (p: string) => existsSync(p),
  readFinal: (p: string) => readFileSync(p),
  writeStaging: (p: string, bytes: Uint8Array) => writeFileSync(p, bytes),
  fsync: (p: string) => {
    // Best-effort durability of the staged bytes. The fd is opened read-only;
    // fsyncSync flushes any pending writes for that inode. On filesystems that
    // cannot fsync a regular file the call is swallowed — staging bytes still
    // reach the fs cache and the rename itself remains atomic.
    let fd: number | undefined;
    try {
      fd = openSync(p, 'r');
      fsyncSync(fd);
    } catch {
      /* fsync unavailable — proceed; atomicity of rename still holds */
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* best-effort */ }
      }
    }
  },
  publish: (stagingPath: string, targetPath: string) => {
    if (existsSync(targetPath)) {
      throw Object.assign(new Error(`EEXIST: publish target already exists: ${targetPath}`), {
        code: 'EEXIST',
      });
    }
    renameSync(stagingPath, targetPath);
  },
  removeStaging: (p: string) => {
    try { unlinkSync(p); } catch { /* absent or already cleaned by rename */ }
  },
});

/**
 * Filesystem RunStore (task 9.2 "in registered machine-home"). Each Record
 * revision is published immutably via the staging → fsync → atomic-rename
 * contract (`publishAtomic`, task 9.6): the final `<root>/<runId>/record-v<version>.json`
 * only ever appears whole, with O_EXCL semantics on the final target. The
 * highest present version is the head. create publishes v0; commit validates
 * the predecessor digest and publishes the next version. Reads never fall back
 * to an earlier revision. A crash mid-publish leaves only `<target>.staging`
 * residue, which the head filter ignores and a retry overwrites cleanly.
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
    // Crash-durable immutable publication: stage → fsync → atomic rename with
    // O_EXCL on the final target. A crash at any boundary leaves NO corrupt
    // target; the staging sibling (`<target>.staging`) is invisible to the
    // head filter and overwritten on retry.
    const staging = `${target}.staging`;
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
      const staging = `${planFile}.staging`;
      const bytes = Buffer.from(JSON.stringify(plan, null, 0), 'utf8');
      publishAtomic(FILESYSTEM_PLUMBING, staging, planFile, bytes);
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
