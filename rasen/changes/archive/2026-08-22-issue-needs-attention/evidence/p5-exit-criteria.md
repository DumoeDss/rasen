# Phase 5 exit criteria — the evidence set (task 5.1 / design D6)

One directory the portfolio close summary can read roadmap §8 from. Each
criterion names its receipt; the replanning-history pins are g-002's SHIPPED
artifacts, cited where they live — not recreated.

## 1. Replanning preserves history

- Shipped pins (g-002 `issue-revision-history-preservation`, repo ship
  `c0ace35e`, archived `2026-08-22-issue-revision-history-preservation`):
  - `test/core/issue-status/issue-revision-continuity.test.ts` — "adding a
    node leaves its siblings' observations fact-for-fact identical";
    "keeps a superseded node's terminal observation on its line while every
    axis excludes it"; "moves dependency facts with an edge change, never the
    observation"; the publish-writes-nothing byte receipt.
  - `test/core/issue-status/issue-retarget-lineage.test.ts` — a publishable
    retarget must carry a new instance; the old lineage's facts stay in the
    predecessor revision (immutable, digest-verified, composable via
    `confirm --revision`).
  - The acceptance exclusions carried durably on `IssueAcceptedRecordV1`
    (g-002's carry work; the acceptance suites pin both compatibility edges).
- Living dogfood cross-evidence (this change, `issue-4-receipt-4-show.txt`):
  Issue #4's own revision delta `0002 over 0001` reads on the show surface —
  the superseded intent proposal's nodes are the delta's story, and the
  binding revision's nodes derive from their own instances, never inherited.

## 2. Failure is never masked by the aggregation

- Integration receipt: `test/commands/store-attention-cli.test.ts` — "the
  failed Issue leads unmasked, in parity across forms, writing nothing": two
  running siblings beside a failed node (a portfolio record's escalated
  child), another Issue parked waiting-human; the failure item leads the
  answer carrying `active/failed`, the scan summary names the same axes, and
  no count or grouping presents the Issue as merely busy.
- Unit pin: `test/core/issue-status/issue-attention.test.ts` — "a failed node
  among running siblings is ONE failure item carrying active/failed beside
  the node".
- Captured verb output (temp-store fixture twin, task 4.4):
  `issue-4-receipt-6-temp-store-failure.txt` — the human and JSON forms,
  fail-first order, per-item phase/health.

## 3. The "Needs Attention" aggregation entry

- The capability: `rasen/specs/issue-needs-attention/spec.md` (this change's
  delta) — the closed five-kind vocabulary, the honesty of absence, the
  never-masked grouping, the store read verb with `--issue` narrowing and
  the write-nothing discipline.
- The dogfood receipts (Issue #4 = this portfolio, on the persistent store
  `issue-registry`):
  - `issue-4-receipt-1-authoring.txt` — authoring scan: Issue #4
    `planning/healthy`, honestly empty.
  - `issue-4-receipt-2-confirm.txt` — confirm over revision 0002: the
    finale "already running (resume-oriented)" located by execution-root;
    both shipped children "already complete" on seeded archive evidence.
  - `issue-4-receipt-3-inflight.txt` / `.json` — children-terminal +
    finale-in-flight: `active/healthy`, zero items (scanned, visible,
    honestly unlisted — no failure, no trouble-blocked node, no parked
    stage, not review-phase, no problems standing).
  - `issue-4-receipt-5-staged-close.txt` — after the acceptance conditions
    landed: still `active/healthy`; publishing conditions is not the close,
    and `acceptance-awaiting` correctly does not fire while the phase is
    active.
- The staged close: `issue-4-close-staged.md` — conditions against the real
  criteria, the accept step documented, execution deferred to a genuinely
  terminal state at the closer's hands.
