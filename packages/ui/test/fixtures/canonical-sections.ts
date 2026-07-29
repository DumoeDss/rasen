/**
 * The canonical additive `ChangeRunView` sections the UI parity suites assert
 * against — ONE data module, shared by both sides of the parity relation.
 *
 * WHY THIS FILE EXISTS (ECP-5 Candidate 3, design D5). Before it, each UI
 * parity test carried its own hand-copied constants and a reviewer probe
 * duplicated them verbatim on the node side. That made the parity suite blind
 * by construction: every plane read the same copied literal, so the suite could
 * only ever prove the planes agree with EACH OTHER, never that they agree with
 * the kernel. Now:
 *
 *   - `test/core/change-run/ui-constants-provenance.test.ts` (root package,
 *     node environment) imports THIS module and deep-equals every constant
 *     against the output of the REAL projector — `projectRunView(record,
 *     'active', plan)` — for the fixture documented on each constant. The
 *     kernel's answer is the anchor.
 *   - The `packages/ui` parity tests import THIS module and drive the DOM from
 *     it, so a UI that recomputes a projected value instead of reading it
 *     disagrees with the same anchored object.
 *
 * Drift therefore fails a test instead of surviving until a reviewer notices.
 *
 * PROVENANCE. Every value below is the verbatim JSON wire form (undefined-valued
 * keys dropped, exactly as HTTP drops them) of the projector's section for the
 * documented Record. Do not edit a value here to make a test pass — regenerate
 * it from the kernel, or the provenance test will reject it.
 */
import type {
  ChoiceViewSection,
  ParallelViewSection,
  ReviewCycleViewSection,
} from '../../src/api/types.js';

// --- ECP-4: parallel/1 ------------------------------------------------------
//
// Fixture (`parallelPlan()`): FanOut `root:experts`, concurrencyCap 2, budget 3,
// members review/required/always, cso/optional/security-relevant,
// benchmark/optional/performance-sensitive; Join `root:experts-join`.

/**
 * Fan-out condition committed
 * `{ activeMembers: [review, cso], inactiveMembers: [benchmark] }` and
 * `root:experts/review` committed succeeded → join proceeding.
 */
export const CANONICAL_PARALLEL: ParallelViewSection = {
  kind: 'parallel',
  version: 1,
  fanOutPath: 'root:experts',
  joinPath: 'root:experts-join',
  members: [
    { path: 'root:experts/review', status: 'succeeded', required: true, condition: 'always' },
    { path: 'root:experts/cso', status: 'ready', required: false, condition: 'security-relevant' },
    {
      path: 'root:experts/benchmark',
      status: 'suppressed',
      required: false,
      condition: 'performance-sensitive',
    },
  ],
  joinState: 'proceeding',
  concurrencyCap: 2,
  budget: { used: 1, max: 3 },
  activeCount: 1,
  succeededCount: 1,
  failedCount: 0,
  keyBlockers: [],
};

/**
 * The same plan with `root:experts/review` committed FAILED and
 * `root:experts/cso` committed succeeded → join failed, with a named key
 * blocker.
 */
export const CANONICAL_PARALLEL_FAILED: ParallelViewSection = {
  kind: 'parallel',
  version: 1,
  fanOutPath: 'root:experts',
  joinPath: 'root:experts-join',
  members: [
    { path: 'root:experts/review', status: 'failed', required: true, condition: 'always' },
    {
      path: 'root:experts/cso',
      status: 'succeeded',
      required: false,
      condition: 'security-relevant',
    },
    {
      path: 'root:experts/benchmark',
      status: 'suppressed',
      required: false,
      condition: 'performance-sensitive',
    },
  ],
  joinState: 'failed',
  concurrencyCap: 2,
  budget: { used: 2, max: 3 },
  activeCount: 0,
  succeededCount: 1,
  failedCount: 1,
  keyBlockers: ["required member 'root:experts/review' failed"],
};

// --- ECP-4: choice/1 --------------------------------------------------------
//
// Fixture (`choicePlan()`): Choice `root:pick`, outcomes simple|complex,
// branches `root:simple-path` / `root:complex-path`.

/** `root:pick` committed `{ outcome: 'simple' }` → exactly that branch active. */
export const CANONICAL_CHOICE: ChoiceViewSection = {
  kind: 'choice',
  version: 1,
  choicePath: 'root:pick',
  outcome: 'simple',
  branches: [
    { outcome: 'simple', path: 'root:simple-path', active: true },
    { outcome: 'complex', path: 'root:complex-path', active: false },
  ],
};

/** Fresh Record → `outcome` ABSENT on the wire, no branch active. */
export const CANONICAL_CHOICE_UNDECIDED: ChoiceViewSection = {
  kind: 'choice',
  version: 1,
  choicePath: 'root:pick',
  branches: [
    { outcome: 'simple', path: 'root:simple-path', active: false },
    { outcome: 'complex', path: 'root:complex-path', active: false },
  ],
};

// --- ECP-1: review-cycle/1 --------------------------------------------------
//
// Fixture (`reviewCyclePlan(maxIterations)`): one BoundedLoop `root/review-cycle`
// with the canonical 4-phase review-cycle body (review, triage, fix, re-review).

/** The fixture's fixer actor, as the kernel derives it (identity digest included). */
export const CANONICAL_FIXER_ACTOR = {
  format: 'change-run-actor/1',
  kind: 'agent',
  identityDigest: 'sha256:83023d618813fe4777d7a9e90233a56f839235df6273672268b644ac47beef13',
  role: 'fixer',
  provider: 'fixture',
  runtime: 'vitest',
  principalIdentityDigest: `sha256:${'f'.repeat(64)}`,
  sessionIdentityDigest: `sha256:${'a'.repeat(64)}`,
  adapter: {
    id: 'adapter-fixer',
    version: '1',
    artifactDigest: `sha256:${'c'.repeat(64)}`,
  },
} as const;

/** The fixture's independent verifier actor (never the same identity as the fixer). */
export const CANONICAL_VERIFIER_ACTOR = {
  format: 'change-run-actor/1',
  kind: 'agent',
  identityDigest: 'sha256:cbc63478f610a3db699b9d37ce5a05d9f69f68b568b64278104d0482d377179b',
  role: 'verifier',
  provider: 'fixture',
  runtime: 'vitest',
  principalIdentityDigest: `sha256:${'7'.repeat(64)}`,
  sessionIdentityDigest: `sha256:${'a'.repeat(64)}`,
  adapter: {
    id: 'adapter-verifier',
    version: '1',
    artifactDigest: `sha256:${'c'.repeat(64)}`,
  },
} as const;

/**
 * Mid-round with open findings (maxRounds 3). Round 1 review committed two
 * findings (F-1 major, F-2 minor), triage routed them, the fix committed
 * against F-1 only, and the re-review Action is ADMITTED BUT NOT COMMITTED —
 * so the projector reports phase `re-review` with `waitReason: 'action-active'`
 * and no outcome. F-2 stays open because a minor finding never blocks the loop.
 *
 * Note what a client CANNOT derive from this object: the round is still 1 even
 * though four phase events have happened, `phase` is the NEXT expected phase
 * rather than the last committed one, and `verifier` is absent while `fixer` is
 * set. Each is a kernel decision, not a tally.
 */
export const CANONICAL_REVIEW_CYCLE: ReviewCycleViewSection = {
  kind: 'review-cycle',
  version: 1,
  loopPath: 'root/review-cycle',
  round: 1,
  phase: 're-review',
  findings: [
    {
      id: 'F-1',
      severity: 'major',
      status: 'open',
      claim: 'The bounded-loop cap is not enforced on resume.',
      location: 'src/core/change-run/internal/reconciler.ts:212',
    },
    {
      id: 'F-2',
      severity: 'minor',
      status: 'open',
      claim: 'The wait reason is not surfaced in the CLI renderer.',
    },
  ],
  actors: {
    fixer: CANONICAL_FIXER_ACTOR,
    lastActor: CANONICAL_FIXER_ACTOR,
  },
  waitReason: 'action-active',
  maxRounds: 3,
};

/**
 * Cap reached with an open Major (maxRounds 1). The same round-1 sequence, but
 * the re-review committed `still_open` for F-1 by an INDEPENDENT verifier, so
 * `state.round >= maxRounds` makes the loop terminal: `outcome: 'exhausted'`
 * with the Major still `open`. The ship guard is the kernel's — this is the
 * shape a UI must render without ever concluding "clean" for itself.
 */
export const CANONICAL_REVIEW_CYCLE_ESCALATED: ReviewCycleViewSection = {
  kind: 'review-cycle',
  version: 1,
  loopPath: 'root/review-cycle',
  round: 1,
  phase: 're-review',
  outcome: 'exhausted',
  findings: [
    {
      id: 'F-1',
      severity: 'major',
      status: 'open',
      claim: 'The bounded-loop cap is not enforced on resume.',
      location: 'src/core/change-run/internal/reconciler.ts:212',
    },
  ],
  actors: {
    fixer: CANONICAL_FIXER_ACTOR,
    verifier: CANONICAL_VERIFIER_ACTOR,
    lastActor: CANONICAL_VERIFIER_ACTOR,
  },
  maxRounds: 1,
};
