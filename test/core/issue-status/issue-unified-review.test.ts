/**
 * `issue-unified-review-gate` tasks 1.3/2.1/2.2/2.3 — the review derivation's
 * unit pins: the seven-value determination matrix (mapped from the REAL gate,
 * exactly as the projection composes it), the no-second-basis mutation pin,
 * the thread-mapping pins (attention kinds in, acceptance-awaiting/problem
 * out, the honest optional overlap), and purity/stability.
 *
 * The derivation is pure over its `(issueId, revisionId, status)` input, so
 * the rows build synthetic statuses directly (the delivery suite's
 * discipline); the acceptance blocks are assembled by calling the REAL
 * `evaluateIssueAcceptanceGate` over the same node facts, so every
 * determination row maps a genuine gate evaluation, never a forged union
 * member.
 */
import { describe, expect, it } from 'vitest';

import { evaluateIssueAcceptanceGate } from '../../../src/core/issue-acceptance/gate.js';
import type {
  IssueAcceptanceFacts,
  IssueAcceptanceStatusBlock,
} from '../../../src/core/issue-acceptance/types.js';
import type {
  AcceptanceConditionsRevisionV1,
  IssueAcceptedRecordV1,
} from '../../../src/core/store/issues/types.js';
import type {
  ExecutionPlanRevisionId,
  Sha256Digest,
} from '../../../src/core/store/planning-validation.js';
import {
  deriveIssueReview,
  type IssueNodeDelivery,
  type IssueNodeStatus,
  type IssueReview,
  type IssueStatus,
} from '../../../src/core/issue-status/index.js';

const NOW = '2026-08-22T00:00:00.000Z';
const LINE = 'main';
const PROJECT = 'app-a';
const ISSUE = 'iss-review-unit';
const REVISION = '0001' as ExecutionPlanRevisionId;
const DIGEST = 'a'.repeat(64) as Sha256Digest;

// -----------------------------------------------------------------------------
// Hand-built statuses: the derivation units
// -----------------------------------------------------------------------------

function changeRow(
  nodeId: string,
  delivery: IssueNodeDelivery | null,
  observation: IssueNodeStatus['observation'] = 'finalized',
  lifecycle: IssueNodeStatus['lifecycle'] = 'required',
  blockedBy: readonly IssueNodeStatus['blockedBy'] = [],
  diagnostic: string | null = null
): IssueNodeStatus {
  return {
    nodeId,
    kind: 'change',
    projectId: PROJECT,
    targetLineId: LINE,
    lifecycle,
    reason: null,
    suggestedPipeline: null,
    rationale: null,
    uncertainty: null,
    alias: nodeId,
    observation,
    blockedBy: [...blockedBy],
    diagnostic,
    runStatePath: null,
    locatedBy: null,
    attribution: { pipeline: null, sessions: [], evidenceLocator: null },
    delivery,
  };
}

/** The verified conditions revision the eligible gate names. */
const CONDITIONS: AcceptanceConditionsRevisionV1 = {
  version: 1,
  issueId: ISSUE,
  revisionId: REVISION,
  supersedes: null,
  createdAt: NOW,
  contentSha256: DIGEST,
  conditions: [{ id: 'cond-1', requirement: 'The unit condition' }],
};

/** The verified record the accepted determination carries. */
const RECORD: IssueAcceptedRecordV1 = {
  version: 1,
  issueId: ISSUE,
  acceptedAt: '2026-08-20T18:03:54.626Z',
  conditionsRevisionId: REVISION,
  conditionsSha256: DIGEST,
  gate: { completed: 2, total: 2, health: 'healthy', problemsStanding: 0 },
  note: null,
  contentSha256: DIGEST,
};

/** Facts with readable conditions and no record — the pre-acceptance shape. */
function openFacts(): IssueAcceptanceFacts {
  return {
    conditions: { revision: CONDITIONS, revisionId: REVISION, diagnostic: null, path: null },
    acceptedRecord: { present: false, record: null, diagnostic: null, path: null },
  };
}

/** Facts with no conditions revision at all. */
function noConditionsFacts(): IssueAcceptanceFacts {
  return {
    conditions: { revision: null, revisionId: null, diagnostic: null, path: null },
    acceptedRecord: { present: false, record: null, diagnostic: null, path: null },
  };
}

/** Facts carrying the verified record — the already-accepted shape. */
function acceptedFacts(record: IssueAcceptedRecordV1 = RECORD): IssueAcceptanceFacts {
  return {
    conditions: { revision: CONDITIONS, revisionId: REVISION, diagnostic: null, path: null },
    acceptedRecord: { present: true, record, diagnostic: null, path: null },
  };
}

/**
 * Facts whose record is present but does not verify — the gate still rules
 * never-rewritable, the status block carries no verified record.
 */
function unverifiableRecordFacts(): IssueAcceptanceFacts {
  return {
    conditions: { revision: CONDITIONS, revisionId: REVISION, diagnostic: null, path: null },
    acceptedRecord: {
      present: true,
      record: null,
      diagnostic: 'the acceptance record does not verify',
      path: null,
    },
  };
}

interface StatusOptions {
  readonly issueState?: 'open' | 'resolved' | 'dropped';
  readonly health?: IssueStatus['health'];
  readonly phase?: IssueStatus['phase'];
  readonly problems?: readonly IssueStatus['problems'][number][];
  readonly progress?: IssueStatus['progress'];
  readonly revisionId?: string | null;
}

/**
 * Assembles a status whose acceptance block carries the REAL gate evaluated
 * over the same node facts — the projection's own composition, so the
 * determination rows below map genuine gate evaluations.
 */
function statusOver(
  nodes: readonly IssueNodeStatus[],
  facts: IssueAcceptanceFacts | null,
  options: StatusOptions = {}
): IssueStatus {
  const problems = [...(options.problems ?? [])];
  const health = options.health ?? 'healthy';
  const required = nodes.filter(
    node => node.kind === 'change' && node.lifecycle === 'required'
  );
  const terminal = (observation: string): boolean =>
    observation === 'finalized' || observation === 'run-terminal';
  const progress =
    options.progress ??
    (nodes.length === 0 ? null : { completed: required.filter(n => terminal(n.observation)).length, total: required.length });
  let acceptance: IssueAcceptanceStatusBlock | null = null;
  if (facts !== null) {
    acceptance = {
      conditions: facts.conditions,
      gate: evaluateIssueAcceptanceGate(
        {
          issueState: options.issueState ?? 'open',
          nodes,
          problems,
          health,
          complete: problems.length === 0,
        },
        facts
      ),
      record: facts.acceptedRecord.record,
    };
  }
  return {
    phase: options.phase ?? 'active',
    health,
    progress,
    nodes: [...nodes],
    delta: null,
    projects: [],
    problems,
    runStateVisibility: { kind: 'none' },
    complete: problems.length === 0,
    acceptance,
  };
}

function reviewOver(
  nodes: readonly IssueNodeStatus[],
  facts: IssueAcceptanceFacts | null,
  options: StatusOptions = {}
): IssueReview {
  return deriveIssueReview(ISSUE, options.revisionId ?? REVISION, statusOver(nodes, facts, options));
}

// The honest delivery shapes the thread rows read (the projection's own
// state spellings, as the delivery suite's fixtures build them).
const LEDGER: IssueNodeDelivery = {
  state: 'record',
  basis: 'legacy',
  archivedAt: NOW,
  codeCommit: 'f'.repeat(40),
  planningBranch: 'feat/review-unit',
  outcome: null,
  evidence: [{ path: 'evidence/ship-log.md', sha256: 'b'.repeat(64) }],
  missing: ['verification-report'],
  entryName: '2026-08-22-ledger',
  foundAtRef: 'refs/heads/main',
  blobPath: 'rasen/projects/p/changes/archive/main/2026-08-22-ledger/archive.json',
};
const NO_RECORD: IssueNodeDelivery = {
  state: 'no-record',
  foundAtRef: 'refs/heads/main',
  blobPath: 'rasen/projects/p/changes/archive/main/2026-08-22-hole/archive.json',
};
const NOT_ARCHIVED: IssueNodeDelivery = { state: 'not-archived' };

// -----------------------------------------------------------------------------
// Task 1.3 — the determination matrix
// -----------------------------------------------------------------------------

describe('deriveIssueReview determination matrix (task 1.3)', () => {
  it('a holding gate reads review-ready, naming the conditions revision', () => {
    const review = reviewOver([changeRow('n-done', LEDGER)], openFacts());
    // Not vacuous: the gate really evaluated eligible over these facts.
    expect(review.determination).toEqual({ kind: 'review-ready', conditionsRevisionId: REVISION });
  });

  it('a verified record reads accepted, carrying its date and revision', () => {
    const review = reviewOver([changeRow('n-done', LEDGER)], acceptedFacts());
    expect(review.determination).toEqual({
      kind: 'accepted',
      acceptedAt: RECORD.acceptedAt,
      conditionsRevisionId: RECORD.conditionsRevisionId,
    });
  });

  it('a present-but-unverifiable record still maps accepted, with the absence named', () => {
    const review = reviewOver([changeRow('n-done', LEDGER)], unverifiableRecordFacts());
    // The gate rules never-rewritable on `present`; the record facts the
    // determination would carry are honestly null, never filled.
    expect(review.determination).toEqual({
      kind: 'accepted',
      acceptedAt: null,
      conditionsRevisionId: null,
    });
  });

  it('fact blockers map not-ready carrying only the count — no second basis', () => {
    const review = reviewOver(
      [
        changeRow('n-runner', NOT_ARCHIVED, 'in-flight'),
        changeRow('n-ghost', { state: 'unattributed' }, 'unknown'),
      ],
      openFacts(),
      {
        problems: [
          {
            kind: 'unresolved-reference',
            node: 'n-ghost',
            ref: null,
            reason: 'no committed evidence anywhere searched',
          },
        ],
      }
    );
    // The gate named three blockers together (un-terminal ×2, problem ×1).
    expect(review.determination).toEqual({ kind: 'not-ready', blockerCount: 3 });
    // The blockers stay in `status.acceptance.gate` — the review view copies
    // none of them: no blocker kind string appears anywhere in the payload.
    expect(JSON.stringify(review)).not.toContain('un-terminal-node');
    expect(JSON.stringify(review)).not.toContain('status-problem');
  });

  it("missing conditions map conditions-missing with the gate's own message", () => {
    const nodes = [changeRow('n-done', LEDGER)];
    const review = reviewOver(nodes, noConditionsFacts());
    expect(review.determination.kind).toBe('conditions-missing');
    if (review.determination.kind !== 'conditions-missing') throw new Error('unreachable');
    expect(review.determination.message).toContain('no readable acceptance conditions');
    // The message is the gate's own, character for character.
    const status = statusOver(nodes, noConditionsFacts());
    const gate = status.acceptance?.gate;
    expect(gate !== undefined && !gate.eligible ? gate.message : null).toBe(
      review.determination.message
    );
  });

  it('no readable plan maps no-plan — and the view is present, never null', () => {
    const review = reviewOver([], openFacts(), { revisionId: null });
    expect(review).not.toBeNull();
    expect(review.determination).toEqual({ kind: 'no-plan' });
    // The no-plan Issue still derives a full view: its verification names the
    // no-readable-revision truth on both facts.
    expect(review.verification.progress).toBeNull();
    expect(review.verification.delivery).toBeNull();
  });

  it('a dropped Issue maps dropped — abandonment, not unreadiness', () => {
    const review = reviewOver(
      [changeRow('n-never', NOT_ARCHIVED, 'not-started')],
      openFacts(),
      { issueState: 'dropped' }
    );
    expect(review.determination).toEqual({ kind: 'dropped' });
  });

  it('a read without acceptance facts names the omission, never a guess', () => {
    const status = statusOver([changeRow('n-done', LEDGER)], null);
    const review = deriveIssueReview(ISSUE, REVISION, status);
    expect(review.determination.kind).toBe('acceptance-unknown');
    if (review.determination.kind !== 'acceptance-unknown') throw new Error('unreachable');
    expect(review.determination.reason).toContain('no acceptance facts');
    // No eligibility, blocker, or conditions fact is presented.
    expect(JSON.stringify(review)).not.toContain('conditionsRevisionId');
    expect(JSON.stringify(review)).not.toContain('blockerCount');
  });
});

// -----------------------------------------------------------------------------
// Task 2.1 — the no-second-basis pin, mutation-proven
// -----------------------------------------------------------------------------

describe('threads never flip the determination (task 2.1)', () => {
  /** A holding gate with every NODE thread kind standing. */
  function allThreadsStanding(): readonly IssueNodeStatus[] {
    return [
      changeRow('n-record', LEDGER, 'finalized'),
      changeRow('n-hole', NO_RECORD, 'finalized'),
      changeRow('n-live', NOT_ARCHIVED, 'run-terminal'),
      changeRow('n-extra', NOT_ARCHIVED, 'in-flight', 'optional'),
    ];
  }

  it('review-ready stands while every thread kind stands', () => {
    const review = reviewOver(allThreadsStanding(), openFacts());
    expect(review.determination).toEqual({ kind: 'review-ready', conditionsRevisionId: REVISION });
    const kinds = review.threads.map(thread => thread.kind);
    expect(kinds).toEqual([
      'optional-open',
      'archive-pending',
      'record-absent',
      'evidence-missing',
    ]);
  });

  it('mutating every thread fact leaves the determination identical', () => {
    const before = reviewOver(allThreadsStanding(), openFacts());
    // Every thread-affecting fact replaced: all four deliveries become clean
    // records (no missing names, no holes, nothing unarchived) and the
    // optional node is terminal. The required nodes stay terminal and no
    // problem stands, so the gate's evaluation is unchanged — and so must the
    // determination be.
    const mutated = reviewOver(
      [
        changeRow('n-record', { ...LEDGER, missing: [] }),
        changeRow('n-hole', { ...LEDGER, missing: [], entryName: '2026-08-22-filled' }),
        changeRow('n-live', { ...LEDGER, missing: [], entryName: '2026-08-22-filled-too' }),
        changeRow('n-extra', { ...LEDGER, missing: [], entryName: '2026-08-22-extra' }, 'finalized', 'optional'),
      ],
      openFacts()
    );
    expect(mutated.determination).toEqual(before.determination);
    expect(mutated.threads).toEqual([]);
  });

  it("the pin is live: the gate's own input flips the determination", () => {
    // One required node slides from terminal to in-flight — a gate INPUT, not
    // a thread fact — and the determination follows the gate, proving the
    // pins above describe a live mapping rather than a constant.
    const flipped = reviewOver(
      [...allThreadsStanding().slice(0, 3), changeRow('n-flip', NOT_ARCHIVED, 'in-flight')],
      openFacts()
    );
    expect(flipped.determination).toEqual({ kind: 'not-ready', blockerCount: 1 });
  });
});

// -----------------------------------------------------------------------------
// Task 2.2 — the thread-mapping pins
// -----------------------------------------------------------------------------

describe('attention items map into threads, the excluded kinds stay out (task 2.2)', () => {
  function troubleStatus(): IssueStatus {
    return statusOver(
      [
        // A failed optional node: attention failure AND its own optional-open
        // thread — the honest overlap (one names trouble, one names progress).
        changeRow('n-boom', NOT_ARCHIVED, 'failed', 'optional', [], 'the run recorded a failure'),
        // A human-parked optional node: attention waiting-human + optional-open.
        changeRow('n-park', NOT_ARCHIVED, 'waiting-human', 'optional'),
        // A not-started node directly behind the failure: blocked-behind.
        changeRow('n-stuck', NOT_ARCHIVED, 'not-started', 'optional', [
          { nodeId: 'n-boom', projectId: PROJECT, observation: 'failed' },
        ]),
      ],
      null,
      {
        // Review phase: attention fires acceptance-awaiting — the item that
        // must NOT become a thread (it IS the review-ready conclusion).
        phase: 'review',
        problems: [
          {
            kind: 'unresolved-reference',
            node: 'n-ghost',
            ref: null,
            reason: 'no committed evidence anywhere searched',
          },
        ],
      }
    );
  }

  it('failure, blocked-behind, and waiting-human threads lead in fail-first order', () => {
    const review = deriveIssueReview(ISSUE, REVISION, troubleStatus());
    expect(review.threads.map(thread => thread.kind)).toEqual([
      'failure',
      'blocked-behind',
      'waiting-human',
      'optional-open',
      'optional-open',
      'optional-open',
    ]);
    // The failure thread carries the attention item's diagnostic; the
    // blocked-behind thread carries its named blocker with the shared state
    // vocabulary the attention derivation rendered.
    const failure = review.threads[0];
    expect(failure).toEqual({
      kind: 'failure',
      nodeId: 'n-boom',
      alias: 'n-boom',
      diagnostic: 'the run recorded a failure',
    });
    const blocked = review.threads[1];
    expect(blocked).toEqual({
      kind: 'blocked-behind',
      nodeId: 'n-stuck',
      alias: 'n-stuck',
      blockers: [{ nodeId: 'n-boom', projectId: PROJECT, state: 'failed' }],
    });
    const parked = review.threads[2];
    expect(parked).toEqual({ kind: 'waiting-human', nodeId: 'n-park', alias: 'n-park' });
  });

  it('acceptance-awaiting and problem items never become threads', () => {
    const review = deriveIssueReview(ISSUE, REVISION, troubleStatus());
    // Six threads total — three attention, three optional-open. The
    // acceptance-awaiting item the review phase fired and the problem item
    // the standing problem fired contributed NONE.
    expect(review.threads).toHaveLength(6);
    expect(JSON.stringify(review.threads)).not.toContain('acceptance-awaiting');
    expect(JSON.stringify(review.threads)).not.toContain('unresolved-reference');
  });

  it('a failed optional node surfaces BOTH its threads naming one node', () => {
    const review = deriveIssueReview(ISSUE, REVISION, troubleStatus());
    const naming = review.threads.filter(thread => thread.nodeId === 'n-boom');
    expect(naming.map(thread => thread.kind)).toEqual(['failure', 'optional-open']);
  });
});

// -----------------------------------------------------------------------------
// Task 2.3 — purity and stability
// -----------------------------------------------------------------------------

describe('purity and ordering stability (task 2.3)', () => {
  it('derives the identical review twice over the same status', () => {
    const status = statusOver(
      [
        changeRow('n-record', LEDGER),
        changeRow('n-live', NOT_ARCHIVED, 'run-terminal'),
        changeRow('n-extra', NOT_ARCHIVED, 'in-flight', 'optional'),
      ],
      openFacts()
    );
    expect(deriveIssueReview(ISSUE, REVISION, status)).toEqual(
      deriveIssueReview(ISSUE, REVISION, status)
    );
  });

  it('threads of several kinds order stably, attention first', () => {
    const status = troubleStableStatus();
    const first = deriveIssueReview(ISSUE, REVISION, status);
    const second = deriveIssueReview(ISSUE, REVISION, status);
    expect(second.threads).toEqual(first.threads);
    // Attention threads precede the node-scanned kinds; within the node-scanned
    // group the kind order is the listed one and nodes order by code point.
    expect(first.threads.map(thread => [thread.kind, thread.nodeId])).toEqual([
      ['failure', 'n-boom'],
      ['blocked-behind', 'n-stuck'],
      ['waiting-human', 'n-park'],
      ['optional-open', 'n-boom'],
      ['optional-open', 'n-park'],
      ['optional-open', 'n-stuck'],
      ['archive-pending', 'n-live'],
      ['record-absent', 'n-hole'],
      ['evidence-missing', 'n-record'],
    ]);
  });

  it('summarizes verification by reference, copying no entries', () => {
    const status = statusOver(
      [changeRow('n-record', LEDGER), changeRow('n-live', NOT_ARCHIVED, 'run-terminal')],
      openFacts()
    );
    const review = deriveIssueReview(ISSUE, REVISION, status);
    expect(review.verification.progress).toEqual({ completed: 2, total: 2 });
    expect(review.verification.delivery).toEqual({
      record: 1,
      'no-record': 0,
      'not-archived': 1,
      unreadable: 0,
      unattributed: 0,
    });
    // The identity facts ride as the plain strings the signature took.
    expect(review.issueId).toBe(ISSUE);
    expect(review.revisionId).toBe(REVISION);
  });
});

/** The ordering fixture: attention trouble plus every node-scanned kind. */
function troubleStableStatus(): IssueStatus {
  return statusOver(
    [
      changeRow('n-record', LEDGER, 'finalized'),
      changeRow('n-hole', NO_RECORD, 'finalized'),
      changeRow('n-live', NOT_ARCHIVED, 'run-terminal'),
      changeRow('n-boom', NOT_ARCHIVED, 'failed', 'optional'),
      changeRow('n-park', NOT_ARCHIVED, 'waiting-human', 'optional'),
      changeRow('n-stuck', NOT_ARCHIVED, 'not-started', 'optional', [
        { nodeId: 'n-boom', projectId: PROJECT, observation: 'failed' },
      ]),
    ],
    openFacts()
  );
}
