# Review Report — issue-autodecompose-graph (VERIFY, independent reviewer)

Date: 2026-08-21. Reviewer: reviewer-adecompose-graph (dispatched mode, report-only).
Tree under review: worktree `feat/issue-phase4` @ `8dbb0149` + uncommitted delta
(full-diff sha256 `8b96ea3a9a91d22f9ba59b021bb18db174621854072a93203ebc5eb86b2bdaed`, 1227 diff lines).
CLI: `node bin/rasen.js` from the worktree.

## Verdict

**PASS with findings — 1 Major, 1 Minor.** All five gates hold; the Major is a
delta-prose defect (spec sync would plant a contradiction), fixable by rewording
the delta before archive; the behavior it misdescribes is itself consistent and
defensible.

## Gate 1 — Unit-test gate (real exit codes, output redirected, never piped)

| Batch | Suites | Result |
| --- | --- | --- |
| 1 | 4 new suites (node-suggestions, decomposition, decomposition-cli, decomposition-guidance) | **27/27 passed, exit 0** — counts exactly 10+9+6+2 as claimed |
| 2 | builtin-v2-package-audit, builtins, builtin-migration-oracle, engine-product-surface, pipeline-binding | **44/44 passed, exit 0** — audit 5, EPS 10, binding 8 as claimed (+builtins 20, oracle 1) |
| 3 | store-issue-node-lifecycle, plan-canonicalization, target-project, digest-anchors, uncommitted-reference, migration-compiler | **37/37 passed, exit 0** — both digest-pin suites green (lifecycle 10, canonicalization 11) |
| 4 | whole `test/core/issue-status/` (9 files incl. the degradation trio) + whole `test/core/issue-publication/` (3 files) + skill-templates-parity | **97/97 passed, exit 0** — parity 10 as claimed |
| 5 (reviewer-initiated) | store-issue-cli, store-issue-status-cli, store-issue-plan-portfolio-cli, completion, auto | 68/78 — 10 failed under parallel load, all `Test timed out` + `EPERM` temp-dir cleanup (known Windows machine-state signature; zero assertion failures) |
| 6 (solo re-runs) | the 3 store-issue CLI files from batch 5, after temp cleanup | **9/9, 5/5, 6/6 passed, exit 0 each** — ambient/parallel-load confirmed, not delta-caused |

Total reviewer-run: **273 tests passed, 0 assertion failures** across 6 batches.

Tree fingerprint: full `git diff` sha256 `8b96ea3a…`; new-file hashes —
`decomposition.ts 09da6c2b…`, `store-issue-node-suggestions c89c4a6e…`,
`issue-plan-decomposition 184bf09b…`, `decomposition-cli 64349034…`,
`decomposition-guidance d7071984…`. Mutation-test backups restored byte-exact
(`execution-plan-internal.ts c5e1dc22…`, `plans.ts 385f6a57…`).

## Gate 2 — The containment proof (the core fence)

- `git diff -- src/core/pipeline-registry/` is **byte-identical** to
  `evidence/registry-diff-sanctioned.patch` (cmp: exact). The only registry file
  touched is `execution-plan-internal.ts`; the diff is exactly the
  `hasDecomposeStage` helper + the one ordering branch.
- `git diff -- pipelines/` is **0 bytes** — every shipped `pipeline.yaml`
  byte-identical.
- **Kernel ordering, both directions, in source** (`execution-plan-internal.ts`
  requiresV2 branch): decompose check at :992 returns
  `unsupported_pipeline_semantics` BEFORE the `profile === null` short-circuit at
  :995 (`execution_profile_unavailable`); a decompose-free v1 with null profile
  falls through to the profile reason. The flat path's `hasUnsupportedSemantics`
  (:769) already reports `unsupported_pipeline_semantics` for non-standard stage
  kinds, so a flat decompose-bearing v1 was and stays consistent.
- **Both directions pinned in the suite**: the new engine-product-surface test
  constructs a decompose-bearing v1 with review loop + explicit null profile →
  asserts `unsupported_pipeline_semantics` with legacy listed; then the same
  null profile on a decompose-free v1 → asserts `execution_profile_unavailable`
  (pre-existing test, unmodified). The mutation proof below shows the pin bites.
- **Live receipt re-run**: `pipeline show auto-decompose --json` re-executed by
  this reviewer is FULL-JSON-equal to `evidence/pipeline-show-auto-decompose.json`
  — verdict `unsupported_pipeline_semantics`, supported false, `availableEngines
  ['legacy','reconciler']`, `compatibilityBoundary: issue-dispatch-0.3.0` unchanged.

## Gate 3 — Live Issue #3 on the persistent store (read-only)

- `store issue show issue-autodecompose-uplift --store issue-registry` re-read by
  this reviewer: state open, **phase planning**, health healthy, progress 0/0;
  revisions **0001, 0002, latest 0002** (`supersedes "0001"` in the file);
  two intent nodes targeting project `rasen` (`e2ee72ed-…`), node 1 with
  `suggestedPipeline small-feature` + rationale, node 2 with suggestion +
  uncertainty, review-flow `blockedBy` graph — byte-equal to the dogfood receipt.
- `--json` strict read: `problems: []` — both revisions' `contentSha256`
  digests verify under the new code (0001 `f9f93ead…`, 0002 `abf832d7…`),
  proving published-revision digest stability end-to-end.
- Decomposition document bytes: before-receipt, after-receipt, and the file as
  hashed by this reviewer NOW are all `9b29c574ff7ef4e6…` — byte-identical
  across publication and since.
- No acceptance/started state: acceptance shows "(none published) / (not
  accepted)", both nodes `not-started`.
- Store git: `rasen/issues/issue-autodecompose-uplift/` is **UNTRACKED**;
  store HEAD `2446e14` predates it — nothing committed store-side, LEAD
  coordinates the close-time commit as planned.

## Gate 4 — Claim sweep

- **Third-source strictness**: intent-only (change-kind refused naming the node +
  `--from-portfolio`), suggestion-complete (`suggestedPipeline` required +
  at least one of rationale/uncertainty, refusal names node+field), unreadable
  is never absent, knowledge-only target refused under the same planning-member
  rule, document byte-identical, adds-never-rewrites — all implemented in
  `decomposition.ts`/`orchestration.ts` and each pinned by a test.
- **Manual vs machine distinction pinned**: `--from-file` keeps the three fields
  optional (node-suggestions suite: "nodes without a suggestion pass without a
  test"); `--from-decomposition` enforces completeness. The CLI composes the
  registry membership test for ALL three sources (`store-issue.ts:980`), same
  expression as `store issue start --pipeline` (`:1130`, byte-same shape at base).
- **Prior-test containment = exactly the sanctioned set**: the only modified
  test files are `pipeline-binding.test.ts` (reason string only; `preparedProfile`
  null + zero create/wake still asserted), `engine-product-surface.test.ts`
  (reason string + one ADDITIVE ordering test), `skill-templates-parity.test.ts`
  (the two sanctioned hash pins — function `c404544c…`, generated `26af0d76…` —
  plus one ADDITIVE content test for the new playbook branch). Nothing weakened;
  no other prior test touched.
- **Delta-vs-spec containment**: all 5 MODIFIED requirement headers exist
  byte-identical in current specs; no REMOVED sections anywhere; every existing
  scenario title inside MODIFIED requirements is byte-stable — only NEW scenarios
  added; the 3 ADDED requirement titles do not exist in current specs.
  `rasen validate issue-autodecompose-graph` → valid, exit 0.
- **Three-way CLI sync**: commander `--from-decomposition <path>`
  (`store-issue.ts`), completions `from-decomposition` takesValue
  (`command-registry.ts:676`), and all three locales (en/ja/zh-cn) carry the flag
  description. The exactly-one-source rule covers three sources; the
  beside-another-source refusal happens before the document is read.
- **Playbook**: `auto.ts` + `_orchestration.ts` Step G branch is additive prose;
  it states the Issue-dispatch vs change-level distinction explicitly and the
  stop-short semantics; parity suite pins the generated skill content.
- **Architecture-index**: 3 detail files updated per the maintenance rule
  (decomposition source row + module notes + registry verdict note) — properly
  scoped, nothing hoisted into SKILL.md.
- **Full-suite triage**: the implementer's enumeration is now durable at
  `evidence/local-full-suite-triage.md` (4 shards with real exit codes; shard 1
  — the delta's home family, 99 files / 1690 tests incl. issue-execution and
  issue-acceptance — EXIT 0 with zero failures; 18 failed files classified:
  6 solo-clean, 5 machine-state cluster, 7 ambient-timeout). This reviewer
  independently reproduced the adjacent store-issue CLI family's parallel-load
  failures (10 timeout/EPERM, zero assertion failures; all three files green
  solo after temp cleanup — batch 6) and spot-checked the two decision-weight
  files from the record:
  - `test/core/profile-sync-drift.test.ts` (cluster representative): solo
    re-run by this reviewer reproduces the record EXACTLY (6 failed | 9 passed,
    exit 1, same six tests, `hasProjectConfigDrift` returning drift on
    no-drift fixtures). Mechanism confirmed as non-sealed user-level state —
    the failing paths read the real machine's configured tools
    (`getConfiguredToolsForProfileSync` / `resolveCurrentProfileState`), and the
    same failures predate this delta per the 2026-08-17 CI-green-baseline
    adjudication; this delta adds no workflow/skill/catalog entry the drift
    comparison could see (it edits one template's prose only). Cluster
    membership confirmed.
  - `test/commands/store-issue-status-cli.test.ts` (the only change-adjacent
    file the implementer saw red solo — 4/5, one 30s timeout + EPERM): green
    solo in this reviewer's environment BOTH times (5/5, exit 0 — batch 6 and
    the dedicated spot-check). Non-deterministic, timeout-only signature, never
    assertion-shaped, on a file squarely in this change's blast radius — the
    clean solo runs against the delta are the decisive data point. Ambient
    membership confirmed.
  CI remains the authoritative gate per the established baseline-comparison
  discipline.

## Gate 5 — Fixture-coincidence mutation spot-checks

1. **Remove the guarded branch** (deleted the 3-line `hasDecomposeStage` return
   in the requiresV2 path): `engine-product-surface` → **1 failed | 9 passed,
   exit 1** — the ordering pin fails ("…BEFORE the null-profile short-circuit").
   The pin has discrimination power.
2. **Break the suggestion validation seam** (`if (false && !pipelineKnown(…))` in
   `assertPlanNodeSuggestions`): `store-issue-node-suggestions` → **1 failed |
   9 passed, exit 1** — "an unknown suggested pipeline is refused at
   publication" fails. The publication guard is load-bearing.

Both mutations reverted; restored files verified byte-identical by sha256.

## Findings

### Major-1 — Delta prose claims the published intent node carries an authored lifecycle; the schema forbids it

- **Where**: `specs/issue-plan-publication/spec.md` (ADDED requirement "A
  decomposition publishes as a reviewable intent-node revision"), requirement
  body: "one intent node per proposed piece of work, each naming … carrying its
  dependency edges as node dependencies, **an authored lifecycle where
  `optional` work is proposed (absent reads `required`)**, a suggested pipeline,
  and at least one of …". Same overclaim in `proposal.md` "What Changes"
  ("dependency edges, lifecycle, a suggested pipeline").
- **Failure scenario**: archive-time sync writes this requirement verbatim into
  `rasen/specs/issue-plan-publication/spec.md`, which then directly contradicts
  `rasen/specs/store-issue-resources/spec.md:205` — "an intent node SHALL carry
  no lifecycle at all" — and describes a system state the implementation cannot
  produce (`plans.ts` IntentNodeSchema has no lifecycle field). A future author
  or tester reading the synced spec expects the Issue read surface to reveal
  required/optional on a decomposition revision; it never can.
- **The behavior is fine; the text is not**: the drop is deliberate and is
  documented honestly in `decomposition.ts` (comment), both playbook templates
  ("the document is the durable record of that proposal"), and the
  architecture-index. Only the delta/proposal prose overclaims. Fix = reword
  the delta sentence (the document records the lifecycle proposal; the published
  intent node carries none) before archive.
- Evidence note: the decomposition suite's own test title "dropping no authored
  guidance" asserts the opposite of its body (the body asserts lifecycle IS
  dropped) — same wording-slip family.

### Minor-1 — The required/optional proposal has no durable home in the Store

- **Where**: `src/core/issue-publication/decomposition.ts` (lifecycle accepted
  on the document node, forwarded nowhere); document path is caller-supplied
  ("no new placement surface").
- **Failure scenario**: a decomposition proposing `lifecycle: optional` stores
  that fact ONLY in the caller's document. For the dogfood pattern the document
  lives in a change's `evidence/`, which archives away at close — after which
  the proposal is unrecoverable from the Store; `store issue show` cannot
  display required/optional for decomposition nodes, and g-003's confirm flow
  must re-derive it. Roadmap Phase 4 names required/optional as one of the
  reviewable axes; this child delivers it as document vocabulary only.
- Accepted as a design trade-off in this child (the schema forbids intent-node
  lifecycle; widening it is out of scope) — flag for g-003's planner handoff:
  either record lifecycle-equivalent facts somewhere durable or state the gap
  in its proposal.

## Not findings (checked, clean)

- Registry diff byte-equals the sanctioned patch; zero pipeline YAML churn.
- Both kernel orderings pinned in-suite and mutation-proven.
- Digest stability: pre-fields revisions re-verify (suite + live strict read of
  Issue #3's two revisions).
- CLI three-way sync complete; conflict refusal precedes document read.
- Issue #3 store-side: untracked, review-ready, nothing started/accepted;
  document bytes unchanged.
- No prior test weakened beyond the sanctioned set; no scenario renames;
  validate green.

## Round-1 re-review (Major-1 fix, 2026-08-22)

Scope: the delta only, per `evidence/fix-round-1.md` (three files, all in the
untracked set — tracked working-tree diff sha256 re-fingerprinted and IDENTICAL
to round 0: `8b96ea3a…`; zero code/template/registry bytes moved).

1. **Reworded requirement** (`specs/issue-plan-publication/spec.md`, ADDED "A
   decomposition publishes as a reviewable intent-node revision"): the node's
   field list no longer carries a lifecycle; the new sentence states the
   truthful shape — document is the SOLE durable record of the
   required/optional proposal, the compiled intent node deliberately carries
   none because the plan schema forbids it ("exactly as `store-issue-resources`
   holds" — now AGREEING with that spec's :205 instead of contradicting it),
   review-time surfacing is through the byte-identical document, and
   confirm-flow consumption is that flow's decision (Minor-1 handoff pinned in
   the spec itself). SHALL retained on the requirement's first line (parser
   quirk respected). Cross-checks: no contradiction with
   `store-issue-resources` :205; `opsx-auto-command` :7-9 "required or optional
   lifecycle" audited-and-left is agreed — that sentence's subject is the
   DOCUMENT the LEAD authors (whose nodes genuinely carry the lifecycle);
   `issue-status-projection` lifecycle mentions are pre-existing change-node
   read-surface wording, byte-carried, untouched.
2. **Five scenario titles byte-stable** (compared against this reviewer's
   round-0 full-text read): yes — and the delta-wide header/scenario comparison
   re-run post-fix is row-for-row identical to round 0 (only additive
   scenarios, no renames, ADDED requirement titles unchanged).
3. **Test title**: now "compiles intent nodes with suggestions and rationale,
   dropping the authored lifecycle" — matches its body (asserts `'lifecycle' in
   nodes[2] === false`). Title-only; body byte-identical to round 0. The
   disclosure of a word-level test edit in a code-atomic round was correct.
4. **Gates re-run by this reviewer**: `rasen validate issue-autodecompose-graph`
   → valid, exit 0; solo `vitest run issue-plan-decomposition.test.ts` →
   **9/9 passed, exit 0** (fixer's claim confirmed). Post-fix file sha256
   `90ad9f96…`.

**Round-1 verdict: CLEAN.** Major-1 resolved; Minor-1 stands as the g-003
handoff (now also stated in the spec's own prose). No new findings.
