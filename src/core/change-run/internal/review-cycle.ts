import { z } from 'zod';

import {
  ChangeRunContractError,
  decodeEvidenceRef,
  type ActorRef,
  type EvidenceRef,
  type JsonValue,
} from '../contracts.js';
import { verifyActorRef } from './actors.js';

export type ReviewCyclePhase = 'review' | 'triage' | 'fix' | 're-review';
export type ReviewCycleOutcome = 'clean' | 'exhausted';
export type ReviewFindingSeverity = 'blocker' | 'major' | 'minor' | 'trivial';
export type ReviewFindingStatus =
  | 'open'
  | 'resolved'
  | 'accepted_known'
  | 'invalid';

export interface ReviewCycleFinding {
  readonly id: string;
  readonly severity: ReviewFindingSeverity;
  readonly location?: string;
  readonly claim: string;
  readonly evidence: readonly EvidenceRef[];
  readonly status: ReviewFindingStatus;
}

export interface ReviewResult {
  readonly contract: 'review-cycle/review-result/1';
  readonly outcome: 'clean' | 'findings';
  readonly findings: readonly ReviewCycleFinding[];
}

export interface TriageDecision {
  readonly findingId: string;
  readonly disposition:
    | 'fix_inline'
    | 'route_author'
    | 'route_fixer'
    | 'reject';
  readonly rationale: string;
}

export interface TriageResult {
  readonly contract: 'review-cycle/triage-result/1';
  readonly decisions: readonly TriageDecision[];
}

export interface FixResult {
  readonly contract: 'review-cycle/fix-result/1';
  readonly findingIds: readonly string[];
  readonly beforeTree: string;
  readonly afterTree: string;
  readonly delta: EvidenceRef;
  readonly tests: readonly EvidenceRef[];
}

export interface FindingVerification {
  readonly findingId: string;
  readonly verdict:
    | 'resolved'
    | 'still_open'
    | 'regressed'
    | 'inconclusive';
  readonly evidence: readonly EvidenceRef[];
}

export interface VerificationResult {
  readonly contract: 'review-cycle/verification-result/1';
  readonly verifications: readonly FindingVerification[];
}

export type ReviewCycleDomainResult =
  | ReviewResult
  | TriageResult
  | FixResult
  | VerificationResult;

export interface ReviewCycleEvent {
  readonly round: number;
  readonly phase: ReviewCyclePhase;
  readonly actor: ActorRef;
  readonly result: JsonValue;
  readonly evidence: readonly EvidenceRef[];
}

export interface ReviewCycleState {
  readonly round: number;
  readonly phase: ReviewCyclePhase;
  readonly outcome?: ReviewCycleOutcome;
  readonly findings: readonly ReviewCycleFinding[];
  readonly openFindingIds: readonly string[];
  readonly fixerActor?: ActorRef;
  readonly verifierActor?: ActorRef;
  readonly lastActor?: ActorRef;
  readonly eventCount: number;
}

export type ReviewCycleDomainErrorCode =
  | 'malformed_review_cycle_result'
  | 'invalid_review_cycle_transition'
  | 'review_cycle_actor_separation'
  | 'review_cycle_ship_guard';

export class ReviewCycleDomainError extends Error {
  constructor(
    readonly code: ReviewCycleDomainErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'ReviewCycleDomainError';
  }
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

const FindingSchema = z.strictObject({
  id: z.string().regex(SAFE_ID),
  severity: z.enum(['blocker', 'major', 'minor', 'trivial']),
  location: z.string().min(1).max(4096).optional(),
  claim: z.string().min(1).max(16_384),
  evidence: z.array(z.unknown()).min(1).max(64),
  status: z.enum(['open', 'resolved', 'accepted_known', 'invalid']),
});

const ReviewResultSchema = z.strictObject({
  contract: z.literal('review-cycle/review-result/1'),
  outcome: z.enum(['clean', 'findings']),
  findings: z.array(FindingSchema).max(1024),
});

const TriageResultSchema = z.strictObject({
  contract: z.literal('review-cycle/triage-result/1'),
  decisions: z
    .array(
      z.strictObject({
        findingId: z.string().regex(SAFE_ID),
        disposition: z.enum([
          'fix_inline',
          'route_author',
          'route_fixer',
          'reject',
        ]),
        rationale: z.string().min(1).max(16_384),
      })
    )
    .min(1)
    .max(1024),
});

const FixResultSchema = z.strictObject({
  contract: z.literal('review-cycle/fix-result/1'),
  findingIds: z.array(z.string().regex(SAFE_ID)).min(1).max(1024),
  beforeTree: z.string().regex(DIGEST),
  afterTree: z.string().regex(DIGEST),
  delta: z.unknown(),
  tests: z.array(z.unknown()).max(64),
});

const VerificationResultSchema = z.strictObject({
  contract: z.literal('review-cycle/verification-result/1'),
  verifications: z
    .array(
      z.strictObject({
        findingId: z.string().regex(SAFE_ID),
        verdict: z.enum([
          'resolved',
          'still_open',
          'regressed',
          'inconclusive',
        ]),
        evidence: z.array(z.unknown()).min(1).max(64),
      })
    )
    .min(1)
    .max(1024),
});

function schemaIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? '/' : `/${issue.path.join('/')}`;
    return `${path}: ${issue.message}`;
  });
}

function malformed(message: string, issues: readonly string[] = []): never {
  throw new ReviewCycleDomainError(
    'malformed_review_cycle_result',
    message,
    issues
  );
}

function parseEvidence(value: unknown, label: string): EvidenceRef {
  try {
    return decodeEvidenceRef(value);
  } catch (error) {
    if (error instanceof ChangeRunContractError) {
      malformed(`${label} is not a valid EvidenceRef.`, error.issues);
    }
    throw error;
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      malformed(`${label} must not contain duplicate identity ${value}.`);
    }
    seen.add(value);
  }
}

function parseReviewResult(value: JsonValue): ReviewResult {
  const parsed = ReviewResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed('Review result does not match review-cycle/review-result/1.', schemaIssues(parsed.error));
  }
  assertUnique(
    parsed.data.findings.map((finding) => finding.id),
    'Review findings'
  );
  const findings = parsed.data.findings.map((finding) => ({
    ...finding,
    evidence: finding.evidence.map((entry, index) =>
      parseEvidence(entry, `Finding ${finding.id} evidence ${index}`)
    ),
  }));
  const open = findings.filter((finding) => finding.status === 'open');
  if (parsed.data.outcome === 'clean' && open.length > 0) {
    malformed('A clean review result cannot contain open findings.');
  }
  if (parsed.data.outcome === 'findings' && open.length === 0) {
    malformed('A findings review result must contain at least one open finding.');
  }
  return Object.freeze({
    contract: parsed.data.contract,
    outcome: parsed.data.outcome,
    findings: Object.freeze(findings),
  });
}

function parseTriageResult(value: JsonValue): TriageResult {
  const parsed = TriageResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed('Triage result does not match review-cycle/triage-result/1.', schemaIssues(parsed.error));
  }
  assertUnique(
    parsed.data.decisions.map((decision) => decision.findingId),
    'Triage decisions'
  );
  return Object.freeze({
    contract: parsed.data.contract,
    decisions: Object.freeze(parsed.data.decisions.map((decision) => Object.freeze(decision))),
  });
}

function parseFixResult(value: JsonValue): FixResult {
  const parsed = FixResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed('Fix result does not match review-cycle/fix-result/1.', schemaIssues(parsed.error));
  }
  assertUnique(parsed.data.findingIds, 'Fix findingIds');
  if (parsed.data.beforeTree === parsed.data.afterTree) {
    malformed('A successful fix must bind a material tree change.');
  }
  return Object.freeze({
    contract: parsed.data.contract,
    findingIds: Object.freeze([...parsed.data.findingIds]),
    beforeTree: parsed.data.beforeTree,
    afterTree: parsed.data.afterTree,
    delta: parseEvidence(parsed.data.delta, 'Fix delta'),
    tests: Object.freeze(
      parsed.data.tests.map((entry, index) =>
        parseEvidence(entry, `Fix test evidence ${index}`)
      )
    ),
  });
}

function parseVerificationResult(value: JsonValue): VerificationResult {
  const parsed = VerificationResultSchema.safeParse(value);
  if (!parsed.success) {
    malformed(
      'Verification result does not match review-cycle/verification-result/1.',
      schemaIssues(parsed.error)
    );
  }
  assertUnique(
    parsed.data.verifications.map((verification) => verification.findingId),
    'Finding verifications'
  );
  return Object.freeze({
    contract: parsed.data.contract,
    verifications: Object.freeze(
      parsed.data.verifications.map((verification) =>
        Object.freeze({
          ...verification,
          evidence: Object.freeze(
            verification.evidence.map((entry, index) =>
              parseEvidence(
                entry,
                `Verification ${verification.findingId} evidence ${index}`
              )
            )
          ),
        })
      )
    ),
  });
}

export function decodeReviewCycleResult(
  phase: ReviewCyclePhase,
  value: JsonValue
): ReviewCycleDomainResult {
  switch (phase) {
    case 'review':
      return parseReviewResult(value);
    case 'triage':
      return parseTriageResult(value);
    case 'fix':
      return parseFixResult(value);
    case 're-review':
      return parseVerificationResult(value);
  }
}

function isHighSeverity(finding: ReviewCycleFinding): boolean {
  return finding.severity === 'blocker' || finding.severity === 'major';
}

function sortedFindings(
  findings: ReadonlyMap<string, ReviewCycleFinding>
): readonly ReviewCycleFinding[] {
  return Object.freeze(
    [...findings.values()].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    )
  );
}

function stateFrom(
  round: number,
  phase: ReviewCyclePhase,
  findings: ReadonlyMap<string, ReviewCycleFinding>,
  eventCount: number,
  extras: Readonly<{
    outcome?: ReviewCycleOutcome;
    fixerActor?: ActorRef;
    verifierActor?: ActorRef;
    lastActor?: ActorRef;
  }> = {}
): ReviewCycleState {
  const ordered = sortedFindings(findings);
  const openFindingIds = ordered
    .filter((finding) => finding.status === 'open')
    .map((finding) => finding.id);
  return Object.freeze({
    round,
    phase,
    ...(extras.outcome === undefined ? {} : { outcome: extras.outcome }),
    findings: ordered,
    openFindingIds: Object.freeze(openFindingIds),
    ...(extras.fixerActor === undefined
      ? {}
      : { fixerActor: extras.fixerActor }),
    ...(extras.verifierActor === undefined
      ? {}
      : { verifierActor: extras.verifierActor }),
    ...(extras.lastActor === undefined ? {} : { lastActor: extras.lastActor }),
    eventCount,
  });
}

function invalidTransition(message: string): never {
  throw new ReviewCycleDomainError(
    'invalid_review_cycle_transition',
    message
  );
}

function openHighFindings(
  findings: ReadonlyMap<string, ReviewCycleFinding>
): readonly ReviewCycleFinding[] {
  return [...findings.values()].filter(
    (finding) => finding.status === 'open' && isHighSeverity(finding)
  );
}

function assertEventEnvelope(
  state: ReviewCycleState,
  event: ReviewCycleEvent
): void {
  if (!Number.isSafeInteger(event.round) || event.round < 1) {
    invalidTransition('ReviewCycle event round must be a positive safe integer.');
  }
  if (state.outcome !== undefined) {
    invalidTransition('A terminal ReviewCycle cannot accept another event.');
  }
  if (event.round !== state.round || event.phase !== state.phase) {
    invalidTransition(
      `Expected round ${state.round} phase ${state.phase}, received round ${event.round} phase ${event.phase}.`
    );
  }
  try {
    verifyActorRef(event.actor);
  } catch (error) {
    malformed(
      error instanceof Error ? error.message : 'ReviewCycle actor is invalid.'
    );
  }
  for (const [index, evidence] of event.evidence.entries()) {
    parseEvidence(evidence, `Event evidence ${index}`);
  }
}

function findingsMap(
  state: ReviewCycleState
): Map<string, ReviewCycleFinding> {
  return new Map(state.findings.map((finding) => [finding.id, finding]));
}

export function applyReviewCycleEvent(
  state: ReviewCycleState,
  event: ReviewCycleEvent,
  maxRounds: number
): ReviewCycleState {
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1) {
    throw new ReviewCycleDomainError(
      'invalid_review_cycle_transition',
      'ReviewCycle maxRounds must be a positive safe integer.'
    );
  }
  assertEventEnvelope(state, event);
  const findings = findingsMap(state);
  const result = decodeReviewCycleResult(event.phase, event.result);
  const eventCount = state.eventCount + 1;

  switch (event.phase) {
    case 'review': {
      const review = result as ReviewResult;
      for (const finding of review.findings) {
        findings.set(finding.id, finding);
      }
      if (review.outcome === 'clean') {
        if (openHighFindings(findings).length > 0) {
          throw new ReviewCycleDomainError(
            'review_cycle_ship_guard',
            'ReviewCycle cannot become clean while Blocker/Major findings remain open.'
          );
        }
        return stateFrom(state.round, 'review', findings, eventCount, {
          outcome: 'clean',
          lastActor: event.actor,
        });
      }
      return stateFrom(state.round, 'triage', findings, eventCount, {
        lastActor: event.actor,
      });
    }
    case 'triage': {
      const triage = result as TriageResult;
      const open = [...findings.values()].filter(
        (finding) => finding.status === 'open'
      );
      const decisions = new Map(
        triage.decisions.map((decision) => [decision.findingId, decision])
      );
      for (const finding of open) {
        const decision = decisions.get(finding.id);
        if (decision === undefined) {
          malformed(`Triage omitted open finding ${finding.id}.`);
        }
        if (decision.disposition === 'reject') {
          findings.set(finding.id, { ...finding, status: 'invalid' });
        }
      }
      for (const decision of triage.decisions) {
        if (!findings.has(decision.findingId)) {
          malformed(`Triage references unknown finding ${decision.findingId}.`);
        }
      }
      if (openHighFindings(findings).length === 0) {
        return stateFrom(state.round, 'triage', findings, eventCount, {
          outcome: 'clean',
          lastActor: event.actor,
        });
      }
      return stateFrom(state.round, 'fix', findings, eventCount, {
        lastActor: event.actor,
      });
    }
    case 'fix': {
      const fix = result as FixResult;
      const openHigh = openHighFindings(findings).map((finding) => finding.id);
      for (const findingId of openHigh) {
        if (!fix.findingIds.includes(findingId)) {
          malformed(`Fix omitted open Blocker/Major finding ${findingId}.`);
        }
      }
      for (const findingId of fix.findingIds) {
        const finding = findings.get(findingId);
        if (finding === undefined || finding.status !== 'open') {
          malformed(`Fix references non-open finding ${findingId}.`);
        }
      }
      return stateFrom(state.round, 're-review', findings, eventCount, {
        fixerActor: event.actor,
        lastActor: event.actor,
      });
    }
    case 're-review': {
      const verification = result as VerificationResult;
      if (
        state.fixerActor !== undefined &&
        state.fixerActor.identityDigest === event.actor.identityDigest
      ) {
        throw new ReviewCycleDomainError(
          'review_cycle_actor_separation',
          'The fixer cannot verify their own ReviewCycle fix.'
        );
      }
      const openHigh = openHighFindings(findings).map((finding) => finding.id);
      const verified = new Map(
        verification.verifications.map((item) => [item.findingId, item])
      );
      for (const findingId of openHigh) {
        if (!verified.has(findingId)) {
          malformed(`Re-review omitted open Blocker/Major finding ${findingId}.`);
        }
      }
      for (const item of verification.verifications) {
        const finding = findings.get(item.findingId);
        if (finding === undefined || finding.status !== 'open') {
          malformed(`Re-review references non-open finding ${item.findingId}.`);
        }
        findings.set(item.findingId, {
          ...finding,
          status: item.verdict === 'resolved' ? 'resolved' : 'open',
          evidence: Object.freeze([...finding.evidence, ...item.evidence]),
        });
      }
      if (openHighFindings(findings).length === 0) {
        return stateFrom(state.round, 're-review', findings, eventCount, {
          outcome: 'clean',
          fixerActor: state.fixerActor,
          verifierActor: event.actor,
          lastActor: event.actor,
        });
      }
      if (state.round >= maxRounds) {
        return stateFrom(state.round, 're-review', findings, eventCount, {
          outcome: 'exhausted',
          fixerActor: state.fixerActor,
          verifierActor: event.actor,
          lastActor: event.actor,
        });
      }
      return stateFrom(state.round + 1, 'review', findings, eventCount, {
        verifierActor: event.actor,
        lastActor: event.actor,
      });
    }
  }
}

export function initialReviewCycleState(): ReviewCycleState {
  return stateFrom(1, 'review', new Map(), 0);
}

export function reduceReviewCycleEvents(
  events: readonly ReviewCycleEvent[],
  maxRounds: number
): ReviewCycleState {
  return events.reduce(
    (state, event) => applyReviewCycleEvent(state, event, maxRounds),
    initialReviewCycleState()
  );
}

export function assertReviewCycleMayShip(state: ReviewCycleState): void {
  if (
    state.outcome !== 'clean' ||
    state.findings.some(
      (finding) => finding.status === 'open' && isHighSeverity(finding)
    )
  ) {
    throw new ReviewCycleDomainError(
      'review_cycle_ship_guard',
      'ReviewCycle may ship only after every Blocker/Major finding is closed.'
    );
  }
}
