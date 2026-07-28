import {
  SafePathError,
  assertSafeRunPath,
  type SafePathPlumbing,
} from './safe-path.js';

export type CoordinationErrorCode =
  | 'coordination_path_replaced'
  | 'lease_busy'
  | 'lease_token_mismatch'
  | 'lease_stale_refused';

export class CoordinationError extends Error {
  constructor(
    readonly code: CoordinationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CoordinationError';
  }
}

export interface CoordinationIdentity {
  readonly inode?: bigint;
  readonly size?: number;
}

/**
 * Physically anchored coordination path stability (tasks 9.9/9.10). The path
 * must be safe (containment + no traversal) and its pre/post physical identity
 * must match — a parent or file replaced between the pre and post checks is
 * rejected. No replacement-capable fallback.
 */
export function assertCoordinationPathStable(
  anchor: string,
  target: string,
  plumbing: SafePathPlumbing,
  pre: CoordinationIdentity,
  post: CoordinationIdentity
): void {
  assertSafeRunPath(anchor, target, plumbing);
  if (
    pre.inode !== post.inode ||
    pre.size !== post.size
  ) {
    throw new CoordinationError(
      'coordination_path_replaced',
      'Coordination path identity changed between pre and post checks.'
    );
  }
}

export interface LockLeaseState {
  readonly token: string;
  readonly ownerAlive: boolean;
}

export interface LockLeasePlumbing {
  readonly read: () => LockLeaseState | null;
  readonly write: (state: LockLeaseState) => void;
  readonly remove: () => void;
}

/**
 * Token-bound IPC lease ownership (tasks 9.11/9.12). Acquire writes the token
 * only when the lease is free; a held lease is reported busy and is NEVER
 * speculatively stolen — removal (quarantine) happens only when the holder is
 * PROVEN dead (ownerAlive false). Release is compare-token: a mismatched token
 * cannot release another owner's lease. No mtime/PID/process-table truth.
 */
export function acquireLease(
  plumbing: LockLeasePlumbing,
  token: string
): 'acquired' | 'busy' {
  const current = plumbing.read();
  if (current === null) {
    plumbing.write({ token, ownerAlive: true });
    return 'acquired';
  }
  if (current.token === token) {
    return 'acquired';
  }
  if (!current.ownerAlive) {
    // Proven-dead quarantine: only here may a stale lease be reclaimed.
    plumbing.remove();
    plumbing.write({ token, ownerAlive: true });
    return 'acquired';
  }
  return 'busy';
}

export function releaseLease(
  plumbing: LockLeasePlumbing,
  token: string
): 'released' | 'token-mismatch' {
  const current = plumbing.read();
  if (current === null) return 'released';
  if (current.token !== token) {
    return 'token-mismatch';
  }
  plumbing.remove();
  return 'released';
}

export type HardlinkClaimClassification =
  | 'claimed'
  | 'companion-conflict'
  | 'unsupported';

/**
 * Atomic same-volume hard-link-to-absent claim (tasks 9.13/9.14). A valid claim
 * is nlink === 2 with a strict same-inode token companion (the claim file and
 * its companion are the two links). nlink === 1 means no claim was made; nlink
 * > 2 or a token/inode mismatch is a conflict; an environment without hardlink
 * support (Windows) is unsupported and falls back to lease behavior.
 */
export function classifyHardlinkClaim(input: {
  readonly nlink: number;
  readonly companionTokenMatch: boolean;
  readonly sameInode: boolean;
  readonly hardlinkSupported: boolean;
}): HardlinkClaimClassification {
  if (!input.hardlinkSupported) return 'unsupported';
  if (input.nlink === 2 && input.companionTokenMatch && input.sameInode) {
    return 'claimed';
  }
  return 'companion-conflict';
}

export { SafePathError };
