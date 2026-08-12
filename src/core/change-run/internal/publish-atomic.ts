import { randomBytes } from 'node:crypto';

export type PublishFaultPoint =
  | 'before-stage'
  | 'after-stage-before-fsync'
  | 'after-fsync-before-publish'
  | 'after-publish-before-return';

export class PublishFault extends Error {
  constructor(readonly point: PublishFaultPoint) {
    super(`Injected publish fault at ${point}.`);
    this.name = 'PublishFault';
  }
}

export type PublishErrorCode =
  | 'publish_target_exists'
  | 'publish_target_unverifiable'
  | 'publish_staging_corrupt';

export class PublishError extends Error {
  constructor(
    readonly code: PublishErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

/**
 * Pluggable atomic-publish filesystem surface (tasks 9.5/9.6). The runtime
 * adapter stages to a per-attempt sibling file, fsyncs it, and publishes by
 * exclusive-create hard link; tests supply an in-memory substitute and inject
 * named faults to exercise each crash boundary.
 */
export interface PublishPlumbing {
  readonly exists: (path: string) => boolean;
  readonly readFinal: (path: string) => Uint8Array;
  /** Writes the staging file. Implementations truncate, so see `stagingPathFor`. */
  readonly writeStaging: (stagingPath: string, bytes: Uint8Array) => void;
  readonly fsync: (stagingPath: string) => void;
  /**
   * Creates the final name from the staged bytes with exclusive-create
   * semantics: it MUST fail when the target already exists and MUST NOT
   * replace it, and it must do so in one step. A rename does not qualify on
   * any platform — Node's rename replaces an existing target on POSIX and on
   * Windows alike — and neither does a rename behind an `exists` precheck,
   * which only narrows the window in which a concurrent publisher can clobber
   * an already-published immutable file. `link(2)` qualifies.
   */
  readonly publish: (stagingPath: string, targetPath: string) => void;
  readonly removeStaging: (stagingPath: string) => void;
}

let stagingAttempt = 0;

/**
 * Build the staging sibling for `targetPath`. The result is unique per process
 * and per attempt, and callers MUST use it rather than deriving a staging name
 * from the target alone.
 *
 * A staging path shared by two publishers is not merely wasteful, it silently
 * loses updates: `writeStaging` truncates, so the interleaving
 * `write(A) -> write(B) -> publish(A)` makes publisher A create the final name
 * from *B's* bytes and return `published: true`. The byte-equality check below
 * cannot catch this, because A never observes a present target — it is the
 * winner. The same interleaving can also publish a half-written file, breaking
 * the "no corrupt target" guarantee. Uniqueness is what makes a publisher's
 * staged bytes exclusively its own.
 */
export function stagingPathFor(targetPath: string): string {
  stagingAttempt += 1;
  const nonce = randomBytes(16).toString('hex');
  return `${targetPath}.${process.pid}.${stagingAttempt}.${nonce}.staging`;
}

export interface PublishResult {
  readonly published: boolean;
  readonly alreadyPresent: boolean;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertIdempotentTarget(
  plumbing: PublishPlumbing,
  targetPath: string,
  bytes: Uint8Array
): void {
  let existing: Uint8Array;
  try {
    existing = plumbing.readFinal(targetPath);
  } catch (error) {
    // The target was present a moment ago but cannot be read now (concurrent
    // removal, permission change, unreadable state). Idempotency is a claim
    // about content, so without the content we fail closed rather than let a
    // raw filesystem error escape as an unclassified failure.
    throw new PublishError(
      'publish_target_unverifiable',
      `Immutable publish target exists but could not be read for comparison: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!bytesEqual(existing, bytes)) {
    throw new PublishError(
      'publish_target_exists',
      'Immutable publish target already exists with different bytes.'
    );
  }
}

/**
 * Publish `bytes` to `targetPath` immutably: if the final target already
 * exists, the publish is idempotent ONLY when its bytes match; otherwise
 * stage, fsync, and create the final name exclusively. A named fault injector
 * crashes at each boundary so recovery is provable: a present final means
 * success regardless of staging residue; an absent final with staging residue
 * is retried cleanly under a fresh staging name.
 */
export function publishAtomic(
  plumbing: PublishPlumbing,
  stagingPath: string,
  targetPath: string,
  bytes: Uint8Array,
  fault?: PublishFaultPoint
): PublishResult {
  if (plumbing.exists(targetPath)) {
    assertIdempotentTarget(plumbing, targetPath, bytes);
    return Object.freeze({ published: false, alreadyPresent: true });
  }
  if (fault === 'before-stage') throw new PublishFault('before-stage');
  plumbing.writeStaging(stagingPath, bytes);
  if (fault === 'after-stage-before-fsync') throw new PublishFault('after-stage-before-fsync');
  plumbing.fsync(stagingPath);
  if (fault === 'after-fsync-before-publish') throw new PublishFault('after-fsync-before-publish');
  try {
    plumbing.publish(stagingPath, targetPath);
  } catch (error) {
    // A concurrent same-target publish raced us; if the final is now present,
    // treat this as idempotent success; otherwise surface a typed conflict.
    if (plumbing.exists(targetPath)) {
      plumbing.removeStaging(stagingPath);
      assertIdempotentTarget(plumbing, targetPath, bytes);
      return Object.freeze({ published: false, alreadyPresent: true });
    }
    throw error;
  }
  if (fault === 'after-publish-before-return') throw new PublishFault('after-publish-before-return');
  return Object.freeze({ published: true, alreadyPresent: false });
}
