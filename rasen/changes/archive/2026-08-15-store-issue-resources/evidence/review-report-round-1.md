# Review report — round 1 (`store-issue-resources`, S3)

Reviewer: independent (not the author). Subject: exactly `git diff 501b8943..e9e3e236`
(76 files, ~13k insertions). Commits after `e9e3e236` (LEAD bookkeeping, the
`e6cd8860` merge) were excluded per the review brief.

Method: read all change docs, all 6 spec deltas, all 10 evidence files, and the two
ephemera run records as inputs; read every file of `src/core/store/issues/**` and
`src/core/store/query/**` in full plus the layout/validation additions, the management-API
bridge, router, wire types, CLI surface, and the UI view's scope-gating; re-ran the
mutation proofs that matter (9 mutations total, 2 of them new ones the author never ran);
took 14 targeted solo test runs at `VITEST_MAX_WORKERS=1`. Every mutation was labelled in
place, never left live across a wait, and reverted from an out-of-repo snapshot with
sha256 verified byte-exact (never `git checkout --`). Environment sanity before running:
96 leftover `rasen-*` dirs in the temp root (vs the 3983 pathology in task 8.3's record) —
acceptable.

Legend: **CONFIRMED** = I re-ran or re-derived it this session. **PLAUSIBLE** = reasoned
from code, not executed.

---

## Findings

### BLOCKER-1 — publishPlan accepts a change node whose only evidence is a machine-local
### workspace-index entry; the spec delta says exactly this SHALL be refused

- Code: `src/core/store/query/references.ts:159-175` — when `committed.length === 0` and
  exactly one machine workspace-index entry matches the `changeInstanceId`,
  `resolveChangeReference` returns `{ status: 'resolved', evidence: null, ... }`.
  `src/core/store/issues/module.ts:451-452` then does
  `const found = resolved.evidence; if (found === null) continue;` — the node is
  **accepted** and the revision is published. (CONFIRMED by inspection; the composition is
  three unconditional lines. No runtime repro constructed — building a real index entry
  requires child 2's `workspace plan` flow.)
- Spec: `specs/store-issue-resources/spec.md:91-115` — "A plan node that names a Change
  SHALL be accepted only when that Change is present and committed in the Store", with the
  scenario "A plan naming an uncommitted Change is refused ... THEN publication is
  refused, naming that Change and the reason, AND no revision is created". `proposal.md`
  repeats it: "A plan is never published against evidence that does not exist."
- Concrete failure scenario: an operator runs child 2's `workspace plan` for change X on
  line L (machine index entry carrying X's `changeInstanceId`; branch never merged into
  any target-line ref), then `rasen store issue plan` naming X's instance id. Committed
  search finds nothing; the index entry alone resolves it; a revision referencing a Change
  that is absent from every Store ref is published. The write is durable Store content;
  the evidence for it is a non-portable machine locator that `references.ts`'s own header
  table calls "authority for nothing".
- The contradiction is even internal to the module: the `issue_reference_unresolved`
  refusal's fix text (`module.ts:446`) tells the user to "declare the node as an intent
  until the Change exists" — i.e., the code's own messaging says change nodes require
  committed evidence — yet the local-index path quietly accepts.
- Test coverage: **zero on this path.** No test anywhere in the S3 diff seeds a workspace
  index entry and drives `publishPlan` through it (grep: `store-aggregate-query.test.ts`
  contains no `localLocator` / index seeding; `resolveChangeReference` has no direct test
  file). The refusal tests cover absent (`issue_reference_unresolved`), wrong-identity,
  and undeclared-scope only. So the spec scenario "uncommitted is refused" has neither an
  implementing branch for this evidence source nor a test.
- Why Blocker: this is the change's charter deliverable ("Verify plan references against
  committed Store evidence"), and at archive time the delta becomes the recorded truth of
  `rasen/specs/store-issue-resources` — a false SHALL. Resolution is the author's call and
  is cheap in either direction: (a) make `publishPlan` refuse a resolution whose
  `evidence` is null (naming "exists only as a local planning worktree; not committed" as
  the reason), keeping the local entry read-side only; or (b) if local-worktree
  draftability of change nodes is the intended product, rewrite the requirement and
  scenarios to say so — but then the `unresolved` fix text and the "never published
  against evidence that does not exist" proposal line must change too. The two artifacts
  cannot both stand.

### MAJOR-1 — spec scenario "two plans differing only in node ordering normalize to the
### same canonical plan" is not implemented and not tested

- Spec: `specs/store-issue-resources/spec.md:117-127` — "Plan nodes SHALL be normalized to
  one canonical form, so two spellings of one plan are one plan", scenario: "WHEN two
  plans differ only in node ordering or in equivalent spellings of the same values THEN
  they normalize to the same canonical plan."
- Code: `normalizePlanNodes` (`plans.ts:434-460`) preserves input array order;
  `executionPlanDigestBody` (`plans.ts:280-310`) and `serializeExecutionPlanRevision`
  both preserve node array order (`canonicalJson` sorts object *keys* only — array
  element order is part of the digest preimage, deliberately per RFC 8785).
- Concrete failure scenario: publish nodes `[a, b]`, then publish `[b, a]` (same node
  set, same fields). Result: two revisions with different bytes and different
  `contentSha256` — observably two plans in every sense the product exposes. The spec's
  neighbouring scenario "Field order does not change the digest" (property insertion
  order) IS true and anchored; the node-ordering claim is false.
- Test coverage: no test asserts node-order canonicalization (grep across
  `test/core/store` for normaliz/spelling/ordering: no plan-related hits). CONFIRMED.
- Fix is again either-direction: sort nodes canonically (by `nodeId`) at normalization,
  or drop "node ordering" from the scenario and keep only value-spelling equivalence.
  Note a canonical sort would change digests of any already-published fixture — do it
  before ship or never.

### MAJOR-2 — the wire-type mirror-absence guard is blind to one of this change's own 13
### Store-aggregate wire types, mutation-proven this session

- The change's "Store aggregate" section in `src/core/management-api/wire-types.ts`
  exports **13** types. The guard's hardcoded list
  (`test/core/management-api/store-aggregate-wire-mirror.test.ts:32-45`) names **12** —
  `StoreExecutionPlanNodeInput` is missing. Both evidence records
  (`wire-type-mirror-absence-mutation-proof.md`, task 5.2's entry) state "12 new
  Store-aggregate wire types"; the count was wrong at the source, and nothing can notice.
- Mutation run (this session): renamed the UI mirror's `StoreExecutionPlanNodeInput`
  (`packages/ui/src/api/types.ts:2465`) to a different name — i.e., made its mirror
  absent under the expected name — and ran the guard: **13/13 GREEN.** CONFIRMED
  blindness: the guard passes while the exact condition it exists to catch is true.
  Control run: renaming the listed `StoreExecutionPlanPublishRequest` produced exactly
  1/13 RED naming the type (the recorded proof re-confirmed). Both reverted byte-exact
  (sha256 `18d36de4...` re-verified).
- Consequence path is real, not hypothetical: `ci.yml` never type-checks `packages/ui`
  (task 8.2's own finding), so deleting that mirror type entirely would be fully green on
  the portfolio's PR.
- This is the portfolio's own named defect class — a frozen list that silently stops
  covering what the subject grows — found a fourth time, this time *inside the guard
  built in response to the previous three*. Fix: add the missing name (one line), and
  consider deriving the name set from the core file's "Store aggregate" section markers
  with the hardcoded list kept as a floor (`parsed ⊇ hardcoded`), so the next type added
  to the section is covered without anyone remembering to extend the list.

### MINOR-1 — same-ordinal revision divergence across refs is silently resolved by ref
### order; Issue records get divergence detection, revisions do not (PLAUSIBLE)

`readRevision` (`src/core/store/query/issues-read.ts:224-228`) returns the revision blob
from the **first** ref (target-line sort order) that has it. Two clones publishing the
same next ordinal on two different refs (the add/add scenario `module.ts`'s
`allocateOrdinal` comment names) each produce an internally-valid revision, so
`verifyDigest` passes on both, and `resolveExecutionPlan` presents the sort-first copy as
THE plan with no divergence signal — while `issue.yaml` in the same situation gets
`divergenceOf` + "picks no winner" + record withheld. The asymmetry is inherited from the
reference line and only bites between publication and the eventual add/add merge
conflict, so Minor — but the "picks no winner" philosophy the record side advertises does
not hold for revisions, and a reader of the spec ("no gap and no duplicate") would expect
the read side to at least name the competing copy.

### MINOR-2 — untrusted HTTP publish bodies can 500 instead of 400 (PLAUSIBLE)

`handleStorePublishPlan` (`src/core/management-api/stores.ts:395-438`) checks only
`issueId`/`nodes[]`/per-node scope, then passes raw nodes into
`normalizePlanNodes` (`plans.ts:434-460`), which branches on `input.kind === 'change'`
and otherwise **assumes intent**: a node with `kind: "task"` (or missing `kind`, or a
non-string `summary`) reaches `assertPortableIssueText(undefined, ...)` →
`TypeError: Cannot read properties of undefined (reading 'trim')` → `mapThrown` → 500
`store_query_failed`. Same for `kind: "change"` with a missing `changeInstanceId`
(depends on `parseChangeInstanceId`'s non-string handling). Nothing is written (the
failure precedes any write), so this is robustness/diagnostics only: an invalid body
should be a 400 refusal naming the field, not a 500. Note `normalizePlanNodes` skips the
zod `NodeSchema` entirely (it casts to `z.output<typeof NodeSchema>`); routing raw HTTP
nodes through `NodeSchema.safeParse` first would close the whole class.

### MINOR-3 — the "both forms agree" scenario overclaims against the human CLI rendering

`specs/store-aggregate-query/spec.md:111-121` promises "every Issue, project, target
line, Change, **digest**, and reported problem present in one is present in the other".
The human renderings omit digests entirely: `store issue show` prints state/title/
revisions/latest (`src/commands/store-issue.ts:111-130`) but never `contentSha256` or
divergence copy hashes, and `renderIssueDetail` prints only the incomplete *count*, not
the per-ref reasons `--json` carries. The JSON side is fine. Either trim the scenario's
enumeration (digests are a machine-form fact) or add the digest to the human detail
rendering. No test enforces the literal scenario (the CLI suites passed as-is), so today
it is spec text drifting above the surface it describes.

### TRIVIAL-1 — evidence-accuracy nits (substance intact in both cases)

- `evidence/wire-type-mirror-absence-mutation-proof.md` headline says "RED: 12/13 tests
  failed" while its own next clause and task 5.2's record correctly say exactly ONE test
  failed (my re-run: 1 failed / 12 passed).
- Task 6.2 records scope Mutation A as "RED, 4/5"; a clean re-run of Mutation A alone
  (marker check inverted, `scope.ts:126`) is **3/5 RED** — the two no-marker cases refuse,
  the marker case sees no error, and both `requireIssueScopeStore` cases stay green
  (CONFIRMED this session). The recorded 4th failure was mutation B's knock-on in a
  combined run, which the record's own parenthetical admits. The guard discriminates; the
  headline number for A alone is wrong.

### TRIVIAL-2 — `types.ts` doc comment vs validation on `reason`

`src/core/store/issues/types.ts:89` says `reason` is "Required for `dropped`, null
otherwise", but `records.ts:116-118` accepts a non-null reason in any state and
`setState` preserves/trims one for non-dropped transitions. Behavior is fine (and the
"requires a reason for dropped" side is tested); the comment overstates.

### TRIVIAL-3 — `store issue list --state <bogus>` silently filters to nothing

`src/commands/store-issue.ts:176` casts `options.state as IssueState` unchecked; an
undefined state value yields "No Issues found." rather than a refusal naming the defined
states. The mutation surface refuses correctly (`isPermittedIssueTransition`); this is
only the read filter.

Nothing further at any severity. Explicitly: I found **no Blocker-grade defect in shipped
code behavior** — every re-run guard discriminated, every restore was byte-exact, and the
NUL/control-byte fixes hold. BLOCKER-1 is a spec-delta/implementation contradiction, and
its resolution may legitimately be a spec rewrite rather than a code change.

---

## Recorded claims re-verified (do-not-take-on-report items)

| Claim | Re-run this session | Result |
|---|---|---|
| Anchor 1 `executionPlanDigest` (drop `nodes` from preimage) | yes | CONFIRMED — 2/3 RED (digest pin + revision YAML via the shared `verifyDigest` path), exactly as recorded |
| Anchor 2 `serializeExecutionPlanRevision` (swap `issueId`/`revisionId`) | yes | CONFIRMED — exactly 1/3 RED; digest pin stayed green (independence proven) |
| Anchor 3 `serializeIssueRecord` (swap `title`/`state`) | yes | CONFIRMED — exactly 1/3 RED |
| Anchor 4 `issueLockFileName` (domain tag `issue-lock/v1`→`v2`) | yes | CONFIRMED — exactly 1/16 RED (the pinned-literal test; the symmetric self-comparison beside it stayed green, as recorded) |
| Anchor 5a `digestOf` (sha256→md5) | yes, `-t` filtered | CONFIRMED — divergence test RED |
| Anchor 5b `CommittedChangeEvidence.digest` (fixed placeholder input) | yes, `-t` filtered | CONFIRMED — collapse/un-collapse test RED |
| Task 7.4 reader walk-back is live | yes — **new mutation**: short-circuited `verifyDigest` in `validateExecutionPlanRevision` (`plans.ts:371`) | CONFIRMED — the tasks 3.5/7.4 "unverifiable" test goes RED when the verifier stops checking; GREEN again after byte-exact restore. The one case the recorded proofs did not cover, now covered |
| Wire-mirror guard mutation proof | yes | CONFIRMED for listed types (1/13 RED) — but see MAJOR-2: blind to the unlisted 13th |
| Scope substitute guards (task 6.2) | Mutation A re-run | CONFIRMED discriminating (3/5 RED; see TRIVIAL-1 on the recorded count) |
| Two raw-control-byte defects fixed | yes | CONFIRMED — `file` reports UTF-8 text for both files; `rg -P '[\x00-\x08\x0e-\x1f\x7f]'` over `issues/**` + `query/**` empty |
| Pre-mutation baseline integrity | yes | All six snapshot hashes taken this session (`plans` 8cc0563d, `records` e44c70d7, `locks` c6145606, `refs` f7311bca, `scope` c2a7fdff, `issues-read` 4a43eafd) match the evidence's recorded pre-mutation hashes exactly — no recorded mutation was left live |

## Dispositions judged (each a claim by someone else; my verdict)

- **Deferred `store-issue-scope-intent.test.ts` + substitute coverage** — SOUND. The
  substitute suite is real coverage (5/5 green solo; refusal guard mutation-proved by my
  own re-run), and the deferral reasoning (routes through `StorePlanning`, fixture pulls
  `finalization/**`) matches the proposal's hand-forward record.
- **`issues/scope.ts` zero prior coverage** — CONFIRMED for this tree: the only test file
  in `test/` referencing `resolveIssueScope`/`assertIssueWriteLocation`/
  `requireIssueScopeStore` is the new substitute suite. (The claim about the reference
  tree's history I did not independently re-derive.)
- **`f4a48a36` exclusion / intended 0.1.7-tip divergence (task 8.4)** — CONFIRMED and the
  evidence is accurate: 8 files diverge exactly as tabulated; `records.ts` and
  `query/module.ts` hunks are escape-notation-only (the unicode-escape spelling on the tip vs the hex/short spelling here, naming the identical code points) — cosmetic; `references.ts` is the one behavioral hunk (`committed.length > 1`
  unconditional on the tip vs `&& distinctScopes.size > 1` here). One nuance worth
  keeping visible: under the squash-base condition, two byte-different committed copies
  of one instance in the SAME scope resolve silently to the non-archived/sort-first copy
  instead of reporting ambiguous. For the mutation path this is benign (the verified
  facts — storeUid/project/line — are identical across such copies by construction), so I
  endorse the recorded accepted-gap disposition.
- **Lock-order takers (task 7.5)** — CONFIRMED: `changeLockKey`/`integrationLockKey` have
  zero call sites in `src/` beyond their declarations; unenforced-by-design stands.
- **UI components not nav-wired** — CONFIRMED: `StoreIssuesView`/`StoreAggregateBoard`
  are referenced only by their own files and suites; no `app.tsx`/`Layout.tsx`/
  `SWITCHABLE_SECTIONS` wiring. design.md Decision 7 records it honestly. Accepted.
- **Resolver strictness asymmetry (open question)** — well-recorded; correctly left open.
  Note it is the same *shape* as BLOCKER-1 (two surfaces disagreeing about what counts as
  a resolvable/committed thing), which strengthens the case for deciding both
  deliberately.
- **`commander-presentation` startup gates** — CONFIRMED live: `node bin/rasen.js --help`,
  `store issue --help`, `store changes --help`, `store projects --help` all exit 0 with
  localized copy.

## Runs taken (all solo, `VITEST_MAX_WORKERS=1`, this worktree)

GREEN: `store-issue-digest-anchors` 3/3; `store-issue-locks` 16/16;
`store-aggregate-wire-mirror` 13/13; `store-issue-scope` 5/5; `store-issue-layout` 45/45;
`planning-validation-v2` + `planning-layout-v2` + `planning-foundation-consumer` 158/158;
`store-query-read-only-guard` 10/10; the two `packages/ui` component suites via
`pnpm -C packages/ui` **11/11 (non-zero count confirmed)**; `store-aggregate-query`
`-t "unverifiable"` and the two anchor-5 `-t` slices green after restores. Locale key-set
parity re-derived: `src/locales` 1606/1606/1606 and `packages/ui` i18n 542/542/542,
zero asymmetric keys. `node bin/rasen.js validate store-issue-resources --type change
--strict` passes. tasks.md: 39 tasks, all markers `[ ]`/`[x]` (no `[~]`).

NOT re-run (relied on the gate-triage records + the above targeted slices):
`management-api/stores.test.ts` (~200s), `store-issue-cli` / `store-aggregate-cli`
(77s/62s), `store-query-lock-free` (52s), the full `store-aggregate-query` file (315s).
The sole-candidate scope test's existence and its explicit one-project/one-line
precondition assertion were verified by reading (`stores.test.ts:286-293`).

Standing item I concur with, not a new finding: task **8.3 is open** — the re-derived
gate has not produced a green run; verify/ship should treat this change as unmeasured at
the suite level until it does. Also noting for tree hygiene: an untracked
`test-engine-ownership-tmp/` directory exists in the worktree, residue of
`test/core/change-run/engine-ownership-wiring.test.ts` from a run predating this review —
not S3's, not mine.
