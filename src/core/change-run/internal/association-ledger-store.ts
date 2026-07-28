/**
 * Persisted AssociationLedger store (tasks 1.1–1.5).
 *
 * Wraps the pure kernel {@link AssociationLedger} (format
 * `change-association-ledger/1`) with a disk persistence layer that mirrors the
 * RunStore's staging → fsync → atomic-rename contract. The ledger lives at
 * `<homeDir>/association/ledger-v1.json`; one ledger per planning space is the
 * natural grain (the kernel already carries `planningSpaceId` + `projectId`).
 *
 * Concurrency: the store takes the association lease
 * `H("instance-association/1", PlanningSpaceId, changeId)` (design §3 lines
 * 847–865) on every commit via an O_EXCL lock file. Inside the lease: reread
 * the latest file, verify the caller's predecessor digest matches (optimistic
 * concurrency), serialize, publish, release. A contender that loses the
 * publish re-reads and retries.
 *
 * Crash safety: the staging file (`ledger-v1.json.staging`) is the only crash
 * residue; the final `ledger-v1.json` appears whole or not at all. On restart,
 * the staging file is ignored and retried cleanly.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import {
  archiveAssociation,
  bindActiveAssociation,
  createAssociationLedger,
  findAssociationByAlias,
  findAssociationByInstanceId,
  type AssociationLedger,
  type AssociationLedgerRevision,
  type ChangeAssociation,
} from './association-registry.js';
import { ChangeRunRuntimeError } from '../facade.js';
import type { ChangeInstanceId, Digest, PlanningSpaceId } from '../contracts.js';
import { domainDigest, type PhysicalIdentity } from './identity.js';
import type { PublishFaultPoint } from './publish-atomic.js';

// ---------------------------------------------------------------------------
// On-disk layout
// ---------------------------------------------------------------------------

export const LEDGER_FILENAME = 'ledger-v1.json';
export const LEDGER_STAGING_SUFFIX = '.staging';
export const LEDGER_LOCK_SUFFIX = '.lock';
export const ASSOCIATION_DIRNAME = 'association';

/**
 * Stale lock recovery threshold (M1). A lock older than this is considered
 * stale (the holder crashed during commit) and will be stolen.
 */
const LEDGER_LOCK_TTL_MS = 60_000;

/**
 * Bounded retry configuration for cross-changeId contention (M3). The ledger
 * is one shared file; two concurrent `pipeline start` for DIFFERENT changeIds
 * race the same lock. Instead of hard-failing, we retry with a short backoff
 * so the live holder is waited out. Combined with M1's stale-steal, a dead
 * holder is recovered and a live one is waited out.
 */
const LEDGER_LOCK_RETRY_COUNT = 50;
const LEDGER_LOCK_RETRY_DELAY_MS = 75;

/**
 * Check whether a PID is still alive. Cross-platform: uses `process.kill(pid, 0)`
 * which sends signal 0 (no-op) on POSIX and checks process existence on Windows.
 * Returns `false` if the process is gone (ESRCH) or the PID is invalid.
 */
function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EINVAL = bad signal (shouldn't happen for 0)
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

interface LockFileContent {
  readonly pid: number;
  readonly timestamp: number;
  readonly token: string;
}

// ---------------------------------------------------------------------------
// Plumbable filesystem surface (mirrors PublishPlumbing + lease + ensureDir)
// ---------------------------------------------------------------------------

/**
 * Pluggable filesystem surface for the association ledger store. The
 * production adapter uses the same staging → fsync → rename pattern as
 * `FILESYSTEM_PLUMBING` in `run-store-fs.ts`, but with atomic OVERWRITE
 * semantics (the ledger is a single latest-file, not per-revision files).
 *
 * `publish` here performs an atomic overwrite-rename: on POSIX `renameSync`
 * silently replaces the target; on Windows we unlink-then-rename inside the
 * lease (the pure-Node same-user race boundary is documented at design §3
 * lines 743–749).
 *
 * Tests supply an in-memory substitute and inject named faults to exercise
 * each crash boundary (tasks 2.1–2.3).
 */
export interface AssociationLedgerPlumbing {
  readonly exists: (target: string) => boolean;
  readonly readFinal: (target: string) => Uint8Array;
  readonly writeStaging: (stagingPath: string, bytes: Uint8Array) => void;
  readonly fsync: (stagingPath: string) => void;
  /** Atomic overwrite rename. Replaces the target atomically. */
  readonly publish: (stagingPath: string, targetPath: string) => void;
  readonly removeStaging: (stagingPath: string) => void;
  readonly ensureDir: (dir: string) => void;
  readonly acquireLock: (lockPath: string, token: string) => boolean;
  readonly releaseLock: (lockPath: string, token: string) => void;
}

/**
 * Real-filesystem `AssociationLedgerPlumbing` (task 1.1 production adapter).
 * One frozen instance is shared by every store in this process.
 */
export const FILESYSTEM_LEDGER_PLUMBING: AssociationLedgerPlumbing = Object.freeze({
  exists: (p: string) => existsSync(p),
  readFinal: (p: string) => readFileSync(p),
  writeStaging: (p: string, bytes: Uint8Array) => writeFileSync(p, bytes),
  fsync: (p: string) => {
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
    // POSIX rename silently overwrites; Windows fails if target exists.
    // Under the lease this is race-free within the same-user boundary.
    try {
      renameSync(stagingPath, targetPath);
    } catch {
      try { unlinkSync(targetPath); } catch { /* may not exist */ }
      renameSync(stagingPath, targetPath);
    }
  },
  removeStaging: (p: string) => {
    try { unlinkSync(p); } catch { /* absent or already renamed */ }
  },
  ensureDir: (dir: string) => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  },
  acquireLock: (lockPath: string, token: string): boolean => {
    const content = JSON.stringify({
      pid: process.pid,
      timestamp: Date.now(),
      token,
    });
    try {
      const fd = openSync(lockPath, 'wx'); // O_EXCL create
      writeSync(fd, content);
      closeSync(fd);
      return true;
    } catch {
      // EEXIST — a lock file is present. Check whether it's stale (M1).
      try {
        const raw = readFileSync(lockPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LockFileContent>;
        if (
          typeof parsed.pid === 'number' &&
          typeof parsed.timestamp === 'number'
        ) {
          const age = Date.now() - parsed.timestamp;
          const holderAlive = isPidAlive(parsed.pid);
          // Steal the lock if the holder is dead OR the lock is older than TTL.
          if (!holderAlive || age > LEDGER_LOCK_TTL_MS) {
            try { unlinkSync(lockPath); } catch { /* raced — another process stole it */ }
            try {
              const fd = openSync(lockPath, 'wx');
              writeSync(fd, content);
              closeSync(fd);
              return true;
            } catch {
              return false; // raced — another process acquired first
            }
          }
        } else {
          // Unrecognized format (old version or corrupt) — treat as stale.
          try { unlinkSync(lockPath); } catch { /* raced */ }
          try {
            const fd = openSync(lockPath, 'wx');
            writeSync(fd, content);
            closeSync(fd);
            return true;
          } catch {
            return false;
          }
        }
      } catch {
        return false; // cannot read lock — let the caller retry
      }
      return false; // holder is alive and recent
    }
  },
  releaseLock: (lockPath: string, token: string): void => {
    try {
      const raw = readFileSync(lockPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LockFileContent>;
      if (parsed.token === token) {
        unlinkSync(lockPath);
      }
    } catch {
      /* absent — already released */
    }
  },
});

// ---------------------------------------------------------------------------
// In-memory test plumbing with fault injection (tasks 2.1–2.3)
// ---------------------------------------------------------------------------

interface InMemoryFile {
  bytes: Uint8Array;
}

/**
 * In-memory `AssociationLedgerPlumbing` for kernel tests. Stores files in a
 * Map; supports named fault injection at each publish boundary
 * (`before-stage`, `after-stage-before-fsync`,
 * `after-fsync-before-publish`, `after-publish-before-return`). The lease is
 * backed by an in-memory Set of active tokens.
 */
export function createInMemoryLedgerPlumbing(options?: {
  readonly fault?: PublishFaultPoint;
}): AssociationLedgerPlumbing & {
  readonly files: ReadonlyMap<string, InMemoryFile>;
  readonly inspect: (target: string) => InMemoryFile | undefined;
} {
  const files = new Map<string, InMemoryFile>();
  const locks = new Map<string, string>(); // lockPath → token
  let fault: PublishFaultPoint | undefined = options?.fault;
  const stagingFiles = new Map<string, Uint8Array>();

  // Normalize Windows backslashes to POSIX forward slashes so in-memory path
  // keys match across platforms (the store's path.join output varies by OS).
  const norm = (p: string): string => p.split('\\').join('/');

  const plumbing: AssociationLedgerPlumbing = {
    exists: (p: string) => files.has(norm(p)),
    readFinal: (p: string) => {
      const file = files.get(norm(p));
      if (!file) throw new Error(`ENOENT: ${p}`);
      return file.bytes;
    },
    writeStaging: (p: string, bytes: Uint8Array) => {
      stagingFiles.set(norm(p), bytes);
    },
    fsync: (_p: string) => {
      /* no-op in memory */
    },
    publish: (stagingPath: string, targetPath: string) => {
      const bytes = stagingFiles.get(norm(stagingPath));
      if (bytes === undefined) {
        throw new Error(`ENOENT: staging ${stagingPath}`);
      }
      files.set(norm(targetPath), { bytes });
      stagingFiles.delete(norm(stagingPath));
    },
    removeStaging: (p: string) => {
      stagingFiles.delete(norm(p));
    },
    ensureDir: (_dir: string) => {
      /* no-op in memory */
    },
    acquireLock: (lockPath: string, token: string): boolean => {
      const key = norm(lockPath);
      if (locks.has(key)) return false;
      locks.set(key, token);
      return true;
    },
    releaseLock: (lockPath: string, token: string): void => {
      const key = norm(lockPath);
      const current = locks.get(key);
      if (current === token) {
        locks.delete(key);
      }
    },
  };

  return Object.freeze({
    ...plumbing,
    get files() {
      return files;
    },
    inspect: (target: string) => files.get(norm(target)),
    /** Direct write for test corruption injection (normalizes path keys). */
    writeFile: (target: string, bytes: Uint8Array) => {
      files.set(norm(target), { bytes });
    },
    // expose fault setter for multi-step tests
    set fault(value: PublishFaultPoint | undefined) {
      fault = value;
    },
  } as AssociationLedgerPlumbing & {
    readonly files: ReadonlyMap<string, InMemoryFile>;
    readonly inspect: (target: string) => InMemoryFile | undefined;
    readonly writeFile: (target: string, bytes: Uint8Array) => void;
    fault: PublishFaultPoint | undefined;
  });
}

// ---------------------------------------------------------------------------
// Lease token derivation
// ---------------------------------------------------------------------------

function leaseToken(
  planningSpaceId: PlanningSpaceId,
  changeId: string
): string {
  return domainDigest('instance-association/1', planningSpaceId, changeId);
}

// ---------------------------------------------------------------------------
// Serialization & validation
// ---------------------------------------------------------------------------

interface SerializedLedger {
  readonly format: string;
  readonly planningSpaceId: string;
  readonly projectId: string;
  readonly revisions: readonly AssociationLedgerRevision[];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Recompute a revision's digest from its contents and verify it matches the
 * stored digest. This detects any silent tampering with the file (truncation,
 * field rewrite, association injection). The normalization mirrors the
 * kernel's `appendRevision` sort.
 */
function verifyRevisionDigest(
  planningSpaceId: PlanningSpaceId,
  projectId: string,
  revision: AssociationLedgerRevision
): boolean {
  const normalized = [...revision.associations]
    .map((association) => ({
      ...association,
      archiveAliases: [...association.archiveAliases].sort(compareStrings),
    }))
    .sort((left, right) =>
      compareStrings(left.instanceId, right.instanceId)
    );
  const expected = domainDigest('change-association-revision/1', {
    planningSpaceId,
    projectId,
    revision: revision.revision,
    previousDigest: revision.previousDigest,
    associations: normalized,
  });
  return expected === revision.digest;
}

function validateLedger(
  parsed: unknown,
  planningSpaceId: PlanningSpaceId,
  projectId: string
): AssociationLedger {
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    throw new ChangeRunRuntimeError(
      'run_store_corrupt',
      'Association ledger file is not a JSON object.'
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== 'change-association-ledger/1') {
    throw new ChangeRunRuntimeError(
      'run_store_corrupt',
      `Association ledger format tag is unrecognized: ${String(obj.format)}.`
    );
  }
  if (obj.planningSpaceId !== planningSpaceId) {
    throw new ChangeRunRuntimeError(
      'run_store_corrupt',
      'Association ledger planningSpaceId does not match the resolved home.'
    );
  }
  if (obj.projectId !== projectId) {
    throw new ChangeRunRuntimeError(
      'run_store_corrupt',
      'Association ledger projectId does not match the resolved home.'
    );
  }
  if (!Array.isArray(obj.revisions)) {
    throw new ChangeRunRuntimeError(
      'run_store_corrupt',
      'Association ledger revisions field is not an array.'
    );
  }

  const revisions: AssociationLedgerRevision[] = [];
  for (let i = 0; i < obj.revisions.length; i++) {
    const raw = obj.revisions[i] as Record<string, unknown>;
    if (
      raw === null ||
      typeof raw !== 'object' ||
      typeof raw.revision !== 'number' ||
      (raw.previousDigest !== null && typeof raw.previousDigest !== 'string') ||
      typeof raw.digest !== 'string' ||
      !Array.isArray(raw.associations)
    ) {
      throw new ChangeRunRuntimeError(
        'run_store_corrupt',
        `Association ledger revision ${i} is malformed.`
      );
    }
    const revision: AssociationLedgerRevision = {
      revision: raw.revision,
      previousDigest: raw.previousDigest as Digest | null,
      digest: raw.digest as Digest,
      associations: raw.associations as readonly ChangeAssociation[],
    };
    // Chain integrity: revision ordinal must match its index.
    if (revision.revision !== i) {
      throw new ChangeRunRuntimeError(
        'run_store_corrupt',
        `Association ledger revision ${i} has ordinal ${revision.revision} (chain broken).`
      );
    }
    // Chain integrity: previousDigest must link to the prior revision.
    const expectedPrevious = i === 0 ? null : revisions[i - 1]!.digest;
    if (revision.previousDigest !== expectedPrevious) {
      throw new ChangeRunRuntimeError(
        'run_store_corrupt',
        `Association ledger revision ${i} previousDigest does not link to revision ${i - 1}.`
      );
    }
    // Digest integrity: recompute and compare.
    if (!verifyRevisionDigest(planningSpaceId, projectId, revision)) {
      throw new ChangeRunRuntimeError(
        'run_store_corrupt',
        `Association ledger revision ${i} digest does not match a recomputation (tampering suspected).`
      );
    }
    revisions.push(revision);
  }

  return Object.freeze({
    format: 'change-association-ledger/1',
    planningSpaceId,
    projectId,
    revisions: Object.freeze(revisions),
  }) as AssociationLedger;
}

function serializeLedger(ledger: AssociationLedger): Uint8Array {
  return Buffer.from(JSON.stringify(ledger, null, 0), 'utf8');
}

// ---------------------------------------------------------------------------
// Store factory
// ---------------------------------------------------------------------------

export interface AssociationLedgerStore {
  /** Load the latest committed ledger from disk (or seed an empty one). */
  load(): AssociationLedger;
  /**
   * Commit the next ledger state atomically. Takes the association lease,
   * rereads the current file, verifies the caller's predecessor digest
   * matches the on-disk latest (optimistic concurrency), serializes, and
   * publishes via staging → fsync → overwrite-rename.
   */
  commit(next: AssociationLedger, changeId: string): AssociationLedger;
  /** Resolve the active association for a changeId (convenience). */
  resolveActiveAssociation(changeId: string): ChangeAssociation | undefined;
  /** Resolve any association (active or archived) by alias. */
  resolveAssociationByAlias(alias: string): ChangeAssociation | undefined;
  /**
   * Resolve an association by its immutable ChangeInstanceId. This is the
   * instance-scoped lookup used by mutation guards that must not be fooled
   * by a same-name recreate (B1).
   */
  resolveAssociationByInstanceId(instanceId: ChangeInstanceId): ChangeAssociation | undefined;
  /**
   * Bind (or reuse) the active association for a change directory. This is
   * the high-level launch entry point: load → bind → commit-if-bound. Returns
   * the association and its disposition.
   */
  bindActive(
    changeId: string,
    alias: string,
    physicalIdentity: PhysicalIdentity
  ): Readonly<{
    association: ChangeAssociation;
    disposition: 'bound' | 'reused';
  }>;
  /**
   * Archive an association. Loads, archives, commits. Returns the updated
   * ledger. No-op (returns the loaded ledger) if the association is not
   * found or already archived.
   */
  archive(request: {
    readonly changeId: string;
    readonly instanceId: ChangeInstanceId;
    readonly activeAlias: string;
    readonly archiveAlias: string;
    readonly physicalIdentity: PhysicalIdentity;
  }): AssociationLedger;
}

export interface CreateAssociationLedgerStoreOptions {
  readonly homeDir: string;
  readonly planningSpaceId: PlanningSpaceId;
  readonly projectId: string;
  readonly plumbing?: AssociationLedgerPlumbing;
}

/**
 * Create a persisted AssociationLedger store (tasks 1.1–1.4). The ledger lives
 * at `<homeDir>/association/ledger-v1.json`; one store per planning space.
 */
export function createAssociationLedgerStore(
  options: CreateAssociationLedgerStoreOptions
): AssociationLedgerStore {
  const plumbing = options.plumbing ?? FILESYSTEM_LEDGER_PLUMBING;
  const associationDir = path.join(options.homeDir, ASSOCIATION_DIRNAME);
  const ledgerPath = path.join(associationDir, LEDGER_FILENAME);
  const stagingPath = `${ledgerPath}${LEDGER_STAGING_SUFFIX}`;
  const lockPath = `${ledgerPath}${LEDGER_LOCK_SUFFIX}`;

  const emptyLedger = createAssociationLedger(
    options.planningSpaceId,
    options.projectId
  );

  const readLedgerFile = (): AssociationLedger => {
    if (!plumbing.exists(ledgerPath)) {
      return emptyLedger;
    }
    const bytes = plumbing.readFinal(ledgerPath);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return validateLedger(parsed, options.planningSpaceId, options.projectId);
  };

  const writeLedgerAtomic = (next: AssociationLedger): void => {
    plumbing.ensureDir(associationDir);
    const bytes = serializeLedger(next);
    plumbing.writeStaging(stagingPath, bytes);
    plumbing.fsync(stagingPath);
    plumbing.publish(stagingPath, ledgerPath);
    plumbing.removeStaging(stagingPath);
  };

  return Object.freeze({
    load(): AssociationLedger {
      return readLedgerFile();
    },

    commit(next: AssociationLedger, changeId: string): AssociationLedger {
      // Ensure the association directory exists before acquiring the lock —
      // the lock file lives inside it and O_EXCL create fails (ENOENT) if the
      // parent is absent, which would be mistaken for a held lease.
      plumbing.ensureDir(associationDir);
      const token = leaseToken(options.planningSpaceId, changeId);

      // Bounded retry for cross-changeId contention (M3). The ledger is one
      // shared file; two concurrent `pipeline start` for DIFFERENT changeIds
      // race the same lock. Instead of hard-failing on the first EEXIST, we
      // retry with a short backoff so the live holder is waited out. Combined
      // with M1's stale-steal (in acquireLock), a dead holder is recovered
      // and a live one is waited out.
      let acquired = false;
      for (let attempt = 0; attempt < LEDGER_LOCK_RETRY_COUNT; attempt++) {
        if (plumbing.acquireLock(lockPath, token)) {
          acquired = true;
          break;
        }
        // Brief busy-wait. In Node's single-threaded model, this yields via
        // Atomics.wait so the event loop can process I/O between attempts.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LEDGER_LOCK_RETRY_DELAY_MS);
      }
      if (!acquired) {
        throw new ChangeRunRuntimeError(
          'lock_unavailable',
          'Another process holds the association lease for this Change and it did not release within the retry window.'
        );
      }
      try {
        // Reread the latest file inside the lease.
        const current = readLedgerFile();

        // Optimistic concurrency: the new ledger's latest revision must build
        // on the current file's latest revision. If the new ledger has N
        // revisions and the current has M, then N must be M or M+1, and the
        // new revision's previousDigest must match the current's latest
        // digest.
        const nextLatest = next.revisions.at(-1);
        const currentLatest = current.revisions.at(-1);
        const currentLatestDigest = currentLatest?.digest ?? null;
        const expectedPrevious = nextLatest?.previousDigest ?? null;

        if (next.revisions.length < current.revisions.length) {
          throw new ChangeRunRuntimeError(
            'run_store_corrupt',
            'Cannot commit a ledger that is behind the on-disk latest.'
          );
        }
        if (next.revisions.length === current.revisions.length) {
          // Idempotent retry — the caller's ledger matches the current state.
          // Verify the digests match; if so, return current (already on disk).
          if (
            currentLatestDigest !== null &&
            nextLatest?.digest !== currentLatestDigest
          ) {
            throw new ChangeRunRuntimeError(
              'run_store_corrupt',
              'Ledger digest mismatch on idempotent retry.'
            );
          }
          return current;
        }
        // Normal case: next has exactly one more revision than current.
        if (next.revisions.length !== current.revisions.length + 1) {
          throw new ChangeRunRuntimeError(
            'run_store_corrupt',
            'Ledger commit spans multiple new revisions; re-read and retry.'
          );
        }
        if (expectedPrevious !== currentLatestDigest) {
          throw new ChangeRunRuntimeError(
            'run_store_corrupt',
            'Concurrent modification: the ledger was changed by another process.'
          );
        }

        writeLedgerAtomic(next);
        return next;
      } finally {
        plumbing.releaseLock(lockPath, token);
      }
    },

    resolveActiveAssociation(changeId: string): ChangeAssociation | undefined {
      const ledger = readLedgerFile();
      const latest = ledger.revisions.at(-1)?.associations ?? [];
      return latest.find(
        (association) =>
          association.changeId === changeId &&
          association.state === 'active'
      );
    },

    resolveAssociationByAlias(alias: string): ChangeAssociation | undefined {
      const ledger = readLedgerFile();
      return findAssociationByAlias(ledger, alias);
    },

    resolveAssociationByInstanceId(instanceId: ChangeInstanceId): ChangeAssociation | undefined {
      const ledger = readLedgerFile();
      return findAssociationByInstanceId(ledger, instanceId);
    },

    bindActive(
      changeId: string,
      alias: string,
      physicalIdentity: PhysicalIdentity
    ): Readonly<{
      association: ChangeAssociation;
      disposition: 'bound' | 'reused';
    }> {
      const ledger = readLedgerFile();
      const result = bindActiveAssociation(ledger, {
        changeId,
        alias,
        physicalIdentity,
      });
      if (result.disposition === 'bound') {
        this.commit(result.ledger, changeId);
      }
      return { association: result.association, disposition: result.disposition };
    },

    archive(request: {
      readonly changeId: string;
      readonly instanceId: ChangeInstanceId;
      readonly activeAlias: string;
      readonly archiveAlias: string;
      readonly physicalIdentity: PhysicalIdentity;
    }): AssociationLedger {
      const ledger = readLedgerFile();
      const next = archiveAssociation(ledger, request);
      return this.commit(next, request.changeId);
    },
  });
}
