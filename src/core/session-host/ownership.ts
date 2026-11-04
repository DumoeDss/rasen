import {
  ClaudeSessionBusyError,
  claimClaudeSessionWriter,
  isClaudeSessionWriterClaimed,
  reapClaudeSessionStaleOwner,
  type ClaudeSessionWriterClaim,
} from '../claude/session-state.js';

export interface SessionHostWriterClaim {
  ownerToken: string;
  release(): Promise<void>;
}

export interface SessionHostOwnership {
  claim(sessionId: string, cwd: string): Promise<SessionHostWriterClaim>;
  isClaimed(sessionId: string): Promise<boolean>;
  reapStaleOwner(
    sessionId: string,
    expected: { ownerToken: string }
  ): Promise<'absent' | 'reaped' | 'live-or-uncertain'>;
}

export class SessionHostOwnershipError extends Error {
  constructor(
    readonly code: 'session-busy' | 'session-failed',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SessionHostOwnershipError';
  }
}

export interface SessionHostOwnershipOptions {
  stateDir: string;
}

function mapClaimError(error: unknown): SessionHostOwnershipError {
  if (error instanceof ClaudeSessionBusyError) {
    return new SessionHostOwnershipError(
      'session-busy',
      'Hosted Session has a live or uncertain cross-process writer owner.',
      { cause: error }
    );
  }
  return new SessionHostOwnershipError(
    'session-failed',
    'Hosted Session writer ownership could not be established safely.',
    { cause: error }
  );
}

/**
 * Reuses only the existing hard-link writer claim. Process authority belongs
 * exclusively to ProcessScope and is never represented by this adapter.
 */
export function createSessionHostOwnership(
  options: SessionHostOwnershipOptions
): SessionHostOwnership {
  const stateOptions = {
    stateDir: options.stateDir,
    supervisedAdmission: true,
  };
  const neverSignalPid = async () => {
    throw new SessionHostOwnershipError(
      'session-failed',
      'Opaque ProcessScope authority must close before stale writer release.'
    );
  };
  return {
    async claim(sessionId, cwd) {
      let claim: ClaudeSessionWriterClaim;
      try {
        claim = await claimClaudeSessionWriter(sessionId, cwd, stateOptions);
      } catch (error) {
        throw mapClaimError(error);
      }
      return {
        ownerToken: claim.ownerToken,
        release: claim.release,
      };
    },
    isClaimed(sessionId) {
      return isClaudeSessionWriterClaimed(sessionId, stateOptions);
    },
    reapStaleOwner(sessionId, expected) {
      return reapClaudeSessionStaleOwner(
        sessionId,
        expected,
        neverSignalPid,
        stateOptions
      );
    },
  };
}

export const noSessionHostOwnership: SessionHostOwnership = {
  async claim() {
    return {
      ownerToken: 'no-owner-token',
      async release() {},
    };
  },
  async isClaimed() {
    return false;
  },
  async reapStaleOwner() {
    return 'absent';
  },
};
