# Review report — issue-delivery-evidence-rollup (VERIFY, independent reviewer)

Date: 2026-08-23. Reviewer re-ran the unit gate with real exit codes, re-read two of the
four closed Issues live against `issue-registry` (read-only), swept every claim in the
proposal/design/tasks/delta, and ran three mutation spot-checks (all reverted,
sha256-verified byte-identical afterwards).

## Verdict

**APPROVED — 0 Blocker, 0 Major, 0 Minor, 7 Info.**

The implementation matches the spec delta and the design's argued decisions; the three
mutation checks prove the new pins are non-vacuous; the live read-only receipts reproduce
exactly, and the persistent store stayed byte-clean across all review reads.

## Gate 1 — Unit tests (real exit codes, no pipes)

| Batch | Result | Exit |
| --- | --- | --- |
| `test/core/issue-status/issue-delivery-evidence.test.ts` (new) | 5/5 | 0 |
| `test/core/store/store-archive-delivery.test.ts` (new, 8-shape) | 2/2 | 0 |
| `test/commands/store-issue-delivery-cli.test.ts` (new) | 2/2 | 0 |
| issue-status family (16 files) | 103/103 | 0 |
| store sample (outcome-basis, aggregate-query, read-only-guard, lock-free, node-lifecycle) | 57/57 | 0 |
| CLI quintet (issue-cli, aggregate-cli, attention-cli, lifecycle-cli + status-cli re-run) | 28+6 green | 0 |
| CLI trio (acceptance-cli, confirm-cli, target-project-cli) | 14/14 | 0 |
| issue-execution family (extra: hand-built status fixtures) | 67/67 | 0 |
| `tsc -p tsconfig.json --noEmit` | clean | 0 |

Flake adjudication (full enumeration of this review's own red runs — both incidents
load-induced, matching the known Windows machine-state cluster, not logic):

1. The three new suites run together in ONE vitest invocation: exit 1, 3 tests failed
   across 2 files — visible entries were the 30s timeout on `store-archive-delivery >
   pins the delivery facts per shape` and an EPERM `fs.rmSync` cleanup in
   `store-issue-delivery-cli` (the run's collect phase alone took 90.9s; the machine was
   loaded). Each of the three suites then passed in isolation with exit 0 (rows above).
2. CLI quintet batch: `store-issue-status-cli > degrades to a labelled visibility-none
   answer from an unrelated directory` timed out at 30s with an EPERM cleanup follow-on
   (neighboring attention tests in the same log took 49s/24s). Isolated re-run: 6/6,
   exit 0.

Practical note for local verification: the new store/CLI suites are heavy fixtures;
running several in one invocation on this machine can blow the default 30s per-test
budget. Run them individually (as CI sharding does).

## Gate 2 — Live verification (issue-registry, READ-ONLY)

Store `git status` clean before and after every read (checked three times: pre-read,
after 3 reads, after the 4th).

`store issue show issue-multi-change-execution` (human) — `delivery evidence:` section:

- `issue-node-lifecycle 2026-08-20-issue-node-lifecycle@rasen — finalized — record (legacy)`
  with `code commit: 31d0b6440a453a128af29b900329c5389e52cf30`,
  `planning branch: feat/issue-phase2`, `archived: 2026-08-20T05:56:26.013Z`,
  `outcome: (none recorded on this legacy record basis)`, `evidence: 7 file(s)`,
  `ship-log: evidence/ship-log.md (sha256 80b354dee0f5)`,
  `missing: verification-report` — every pinned constant reproduced.
- `issue-persistent-baseline … — run-terminal — not-archived` with the
  "will exist when the Change archives" absence line.
- `counts: 2 record, 0 no-record, 1 not-archived, 0 unreadable, 0 unattributed`.

`store issue show issue-cross-project-execution` (human):

- `document-multi-project-issues document-multi-project-issues@rasen-site — run-terminal —
  not-archived` — the cross-project node located through the workspace-index reads the
  named absence, no facts fabricated.
- Three `record (legacy)` rows (phase-3 branches `feat/issue-phase3`, commits
  `8a1a2d31…`/`3dbf7ffc…`/`1049453b…`, 16/20/18 evidence files, ship-logs with digests,
  `missing: verification-report`); `counts: 3/0/1/0/0`.

`--json` parity (multi-change-execution): `delivery.revisionId` `0001`, same counts, the
full 7-entry inventory with full sha256s (ship-log `80b354dee0f5…` matches the human
form's truncation), the rollup entry's `delivery` deep-equal to
`status.nodes[].delivery` for the same node, `{"state":"not-archived"}` on the
persistent-baseline status node. Rollup and show compose the same `status` object — one
projection read, one rollup derivation in the same handler (`store-issue.ts`, the
`deriveIssueDeliveryEvidence(detail.plan?.revisionId ?? null, status)` call).

`store issue list`: four compact lines, zero delivery facts.

## Gate 3 — Claim sweep

- **Zero-new-reads — HOLDS.** The delivery extraction lives entirely inside
  `readArchiveEntry` (`src/core/store/query/module.ts:452-584`), which already fetched
  and parsed the record text for the outcome basis; the diff adds field extraction and
  threading only. The CLI change hoists `resolveStoreWideningContext` to a const — the
  same single call as before, now also feeding `projectAliases`; no second read.
- **v1 defensive verbatim — HOLDS.** `ledgerString`/`ledgerStrings`/`ledgerEvidence`
  (`module.ts:101-130`): absent/wrong-typed field → `null`; both-invalid members simply
  do not contribute. v2 mapped per design (`codeMerge.commit`, full `planning.sourceRef`,
  `outcome`, inventory, `missing`, each verbatim).
- **No-axis drift pin — NON-VACUOUS (mutation-verified).** The drift test seeds one
  archived (record) and one run-terminal (not-archived) node, asserts the real states
  first, then re-runs the projection with deliveries stripped AND with forged record
  facts injected, holding phase/health/progress/lanes(projects)/problems/complete/gate/
  observations identical, and finally asserts the rewrite landed (states actually
  changed). Reviewer mutation M3 (below) confirms the fence fails when an axis reads
  delivery.
- **The signature decision — ACCEPTED.** D1's literal `(status)` could not produce D4's
  `IssueDeliveryEvidence.revisionId` (IssueStatus carries no revision id). The
  implemented `(revisionId, status)` follows the shipped attention precedent
  (`deriveIssueAttention(issueId, status)`, `src/core/issue-status/attention.ts:83`) and
  its spec wording ("from the status projection's own facts alone" with an identity
  label input). Mislabeling is structurally excluded: `detail.plan.revision` is null
  exactly when the addressed revision is unreadable, and the derivation returns null on
  `progress === null`, so the label only ever names the revision actually projected. No
  delta note needed.
- **The conscious skip — ARGUMENT HOLDS.** Root tsconfig excludes `test/`
  (`tsconfig.json:20`); the only readers of `IssueNodeStatus.delivery` are
  `deriveIssueDeliveryEvidence` and the show renderer via rollup entries (grep over
  `src/`); no hand-built fixture reaches either (the derivation is called only in the
  three new/extended suites, on projection-built or delivery-including literals); the
  affected families pass (issue-status 103/103, issue-execution 67/67). One count nit:
  files with hand-built status literals lacking `delivery:` number eight, not five (see
  Info 5).
- **List compactness fence — HOLDS** (pinned in the CLI suite; live list carries no
  delivery facts; pre-change `list --json` already embedded the full `status` per issue,
  so the per-node field rides the pre-existing payload — see Info 3).
- **Fences byte-empty / prior touches** — `git diff 5f159f10 -- src/core/pipeline-registry
  packages/ui` is empty; the full delta touches exactly the proposal's impact set plus
  the architecture-index rows (task 7.1) and the three new test files.
- **First-line SHALL** — all four ADDED requirements open with normative SHALL text.
- **Flake note** — none exists in the change material on disk (the only "full failure
  list adjudicated" phrase is quoted sibling-change acceptance prose inside
  dogfood-3's receipt). This review's own flakes are fully enumerated in Gate 1.

## Gate 4 — Mutation spot-checks (each reverted, sha256-verified)

| Mutation | Expected failure | Observed |
| --- | --- | --- |
| M1: `ledgerString` repairs (`String(value ?? '')`) instead of nulling | 8-shape test fails | `store-archive-delivery > pins the delivery facts per shape` FAIL, exit 1 |
| M2: counts accumulator `+= 0` | counts pin fails | `issue-delivery-evidence` 2 tests FAIL (counts pin + drift suite's counts), exit 1 |
| M3: `withLifecycle` lifecycle fallback reads `delivery?.state` | drift fence fails | `holds phase, health, progress, lanes, problems, and the gate identical` FAIL, exit 1 |

After restore, `sha256sum -c` over `module.ts` / `delivery.ts` / `projection.ts` passed
and `git status -- src test` shows exactly the child's original change set.

## Findings

All Info — none block ship.

1. **Info — design D2's `no-record` field list diverges from the implementation.**
   design.md D2 says `no-record` carries `entryName, foundAtRef`; the implementation
   (`projection.ts` `deliveryFor`) carries `foundAtRef, blobPath` and no `entryName`.
   The spec delta names no fields for the state and its scenario ("naming that the entry
   has no archive record to read") is satisfied — the renderer names the record's absence
   and its expected blob path. Design-doc drift only; no action required.
2. **Info — v1 list fields silently drop ill-typed members.** `ledgerStrings`/
   `ledgerEvidence` filter to well-shaped members rather than nulling the whole list
   (`module.ts:110-130`). This is pinned deliberately by the byte test
   (`missing: [42, 'verification-report', null]` → `['verification-report']`) and is
   defensible (a partially corrupt legacy list still carries true facts for its
   well-shaped members; the legacy basis already says unvalidated), but a junk member
   disappears with no signal. Recorded so the choice is visible, not accidental.
3. **Info — `list --json` embeds per-node delivery via the pre-existing status payload.**
   The listing's own lines carry no delivery facts (pinned + live-verified), but
   `list --json` has emitted `{...summary, status}` per issue since before this change,
   so `status.nodes[].delivery` rides along. Unavoidable without a second status shape;
   the CLI test's comment documents it honestly. Consistent with the requirement's
   "listing's lines" scope.
4. **Info — `no-record` fallback locator fields are best-effort.** `deliveryFor`'s
   `no-record` branch takes `claimants[0]?.foundAtRef ?? null` and
   `outcomeBasisPath ?? null`. Deterministic for the pinned shapes; a multi-claimant
   degraded row would label with the first claimant. Cosmetic; no consumer depends on
   more.
5. **Info — the conscious-skip count is eight files, not five.** Hand-built
   IssueNodeStatus literals lacking `delivery:` exist in eight suites
   (issue-execution-binding/confirm/ready-set-equivalence, issue-attention,
   issue-ready-set, issue-revision-continuity, issue-status-blocker-basis-degradation,
   issue-status-legacy-archive-ruling). The skip's argument (not typechecked; no reader
   can see the undefined) holds for all of them — verified by grep and by the green
   families — so only the claim's count was off.
6. **Info — no flake note in the change material.** The verify-stage claim of
   full-failure-list adjudication lives in the receipts' quoted acceptance prose, not in
   this change's own evidence. This review's two flake incidents are enumerated in
   Gate 1.
7. **Info — suite weight.** The three new suites in one vitest invocation can exceed the
   30s per-test budget on a loaded machine (Gate 1, incident 1). Individually they are
   comfortably green; nothing to fix in the change.
