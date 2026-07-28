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

export type PublishErrorCode = 'publish_target_exists' | 'publish_staging_corrupt';

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
 * adapter uses a staging directory + `wx` (O_EXCL) publication + fsync/close;
 * tests supply an in-memory substitute and inject named faults to exercise
 * each crash boundary.
 */
export interface PublishPlumbing {
  readonly exists: (path: string) => boolean;
  readonly readFinal: (path: string) => Uint8Array;
  readonly writeStaging: (stagingPath: string, bytes: Uint8Array) => void;
  readonly fsync: (stagingPath: string) => void;
  /** Atomic same-directory rename with O_EXCL semantics; throws if target exists. */
  readonly publish: (stagingPath: string, targetPath: string) => void;
  readonly removeStaging: (stagingPath: string) => void;
}

export interface PublishResult {
  readonly published: boolean;
  readonly alreadyPresent: boolean;
}

/**
 * Publish `bytes` to `targetPath` immutably: if the final target already
 * exists, the publish is idempotent (already present); otherwise stage,
 * fsync, and atomically rename into place with `wx` semantics. A named fault
 * injector crashes at each boundary so recovery is provable: a present final
 * means success regardless of staging residue; an absent final with staging
 * residue is retried cleanly.
 */
export function publishAtomic(
  plumbing: PublishPlumbing,
  stagingPath: string,
  targetPath: string,
  bytes: Uint8Array,
  fault?: PublishFaultPoint
): PublishResult {
  if (plumbing.exists(targetPath)) {
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
      return Object.freeze({ published: false, alreadyPresent: true });
    }
    throw error;
  }
  if (fault === 'after-publish-before-return') throw new PublishFault('after-publish-before-return');
  return Object.freeze({ published: true, alreadyPresent: false });
}
