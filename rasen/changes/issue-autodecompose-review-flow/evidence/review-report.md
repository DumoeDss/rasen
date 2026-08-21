# Review report — issue-autodecompose-review-flow (VERIFY, independent reviewer)

Reviewed the COMBINED delta of both workers (predecessor code tasks 1.1–5.1 + successor
dogfood tail/gates) as one change: 23 tracked files modified + 5 new source/test files
(`src/core/issue-execution/confirm.ts`, 4 new test files) + this change directory, all
uncommitted on `15b60a63` (branch `feat/issue-phase4`). Every gate below was re-run by the
reviewer with real exit codes; nothing was taken from the implementers' receipts unverified.

## Verdict

**PASS.** 0 Blocker / 0 Major / 1 Minor / 1 Info. The five handoff decisions are implemented
as designed, the confirm verb is a genuine read-compose-report (writes nothing — proven at
unit level AND on the live persistent store), the dogfood receipts reproduce byte-identically,
and both mutation spot-checks confirm the new tests are load-bearing, not coincidentally green.

## Gate 1 — Unit tests (real exit codes, no pipes on the verdict line)

| set | reviewer run | claim | match |
| --- | --- | --- | --- |
| plans schema/digest (5 files) | exit 0, **45/45** | 45 | yes |
| publication (3 files) | exit 0, **30/30** | 30 | yes |
| binding + confirm (3 files) | exit 0, **53/53** | 53 | yes |
| projection (10 files) | exit 1 in batch, 60/61; the 1 = 30s timeout in PRIOR `issue-status-project-lanes.test.ts`, solo rerun exit 0 **4/4** | 61 | yes after adjudication |
| CLI + parity (5 files) | exit 1 in batch, 36/37; the 1 = 30s timeout in `store-issue-status-cli > degrades to a labelled visibility-none…` — see base-commit proof below | green w/ 1 ambient | yes after adjudication |
| store family (82 files, 4 shards ≤21) | shard0 exit 0 **374p/1s**; shard1 exit 0 **370p**; shard2 exit 1 **396p + 1 timeout**; shard3 exit 0 **364p/1s**; the shard-2 timeout (`workspace-cleanup.test.ts > removes an unbound pair…`, PRIOR untouched file) solo rerun exit 0 **26/26** | 1505p/2s/0f | yes after adjudication (1504 in-shard + 1 solo = 1505) |

**Base-commit adjudication (stronger than the evidence's solo reruns).** The visibility-none
CLI timeout reproduced SOLO on my leg. I built a detached worktree at `15b60a63`
(base, zero delta; junctioned node_modules, fresh `node build.js` exit 0) and ran the same
single test there: it PASSED at 32.3s once, then FAILED at 33.4s and 33.5s on two further
base runs — the test's own comment documents it sitting near 27s of the 30s budget. The
timeout is box-state (tonight's machine slowness), NOT this change: structurally the delta
adds zero I/O to this test's commands (its fixture's plan is a first revision, so
`resolvePredecessorPlan` early-returns on `supersedes === null`; only `show` resolves a
predecessor at all). Worktree removed after; the delta worktree was never touched.

**Triage spot-checks of the successor's 45-failure classification (2 of 15 files):**
- `test/core/shared/tool-detection.test.ts` (claimed machine-state cluster, 5): reproduced
  solo exit 1, **exactly 5 failures**, every one the documented `hermes`-leak shape
  (`expected ['hermes'] to deeply equal []` etc.) on a surface this change never touches.
  Classification HELD.
- `test/core/change-run/engine-product-surface.test.ts` + `engine-ownership-wiring.test.ts`
  (claimed under-load casualties, solo green): together solo exit 0, **16/16** — exactly the
  implementers' receipt. Classification HELD.

## Gate 2 — Live Issue #3 (persistent store, read-only)

- Lineage **0001→0002→0003** on disk; latest 0003; `contentSha256 788e3794…` matches the
  claim; the whole `rasen/issues/issue-autodecompose-uplift/` tree is untracked (uncommitted
  by design); store HEAD is exactly the seed commit `8c65d14` — no other commit, no fifth
  mutation.
- Revision 0003 content matches the authored `evidence/issue-3-revision-0003-nodes.yaml`:
  graph node promoted intent→change bound to seeded instance `ci_96db06e1…`; review-flow
  stays intent with authored `lifecycle: required` canonically OMITTED from the stored bytes
  (the LEAD's recorded semantic-honesty decision is real); edge review-flow→graph dropped;
  0002's `uncertainty` replaced by a `rationale` naming the D2 answer.
- Delta 0003-over-0002 = **exactly** `~ edges issue-autodecompose-review-flow
  (-issue-autodecompose-graph)`; added/removed/retargeted/lifecycle/suggestion all empty;
  node lines show the kind flip; progress 0/1 (intent counts in no pair). Human AND JSON
  forms agree; my live `show --json` equals the recorded receipt field-for-field.
- **Confirm re-run from BOTH roots**: store-root human, store-root `--json`, and worktree
  human receipts are **byte-identical** (`diff` empty) to the three recorded receipts. One
  contract: graph node, `mode: fresh`, `pipeline: small-feature`,
  `pipelineSource: "suggestion"`, binding `project-checkout`; review-flow reported as
  pending Change creation with `lifecycle: required`.
- **Writes nothing, proven live**: after my two confirm runs the store tree is unchanged
  (`git status` still only `?? rasen/issues/issue-autodecompose-uplift/`; HEAD still
  `8c65d14`; the 4 issue files hash-stable).
- **Honest divergence is TRUE**: the seeded archive record is legacy v1 — no `schemaVersion`,
  zero `outcome` occurrences — and no run-state file exists for the alias, so both roots read
  the change node fresh (`not-started`) rather than finalized. Surfaced in
  `dogfood-staged-starts.md` §4–5, not papered over; the staged start is documented, not
  executed.
- **Byte-stability in the wild**: `issues-read.ts:261` parses every revision read with
  `verifyDigest: true`, and my live `show` derived the delta over predecessor 0002 (published
  by the pre-change g-002 build) — so 0002's pre-change digest re-derived byte-for-byte under
  the post-change build. Old revisions byte-stable: proven live, plus the unit digest-pin
  (`39ecc5de…` over a g-002-shaped fixture) in the 45-file set.

## Gate 3 — Claim sweep

- **D1 intent lifecycle**: `required|optional` only (`IntentNodeSchema` plain-string +
  semantic refusal in `validateNode` naming node and the two values; `cancelled`/`superseded`
  refused with the omit-from-next-revision direction); absent≡required with canonical
  omission in stored form, digest body, and serializer; the intent serializer branch adds only
  the conditional spread (change-node serialization untouched). Pinned by unit tests + live
  0002 proof above.
- **D2 suggestion chain**: `binding.ts` fresh chain `--pipeline` > run-state >
  `suggestedPipeline`, `pipelineSource` names the source; already-running chain values
  byte-unchanged (recorded leads, disagreement refusal untouched — the
  `issue_start_pipeline_conflict` refusal still fires, test-pinned); flag-over-suggestion
  does not refuse.
- **D3 unknown-field refusal**: `planNodeUnknownFields` per-kind known sets; both consumers
  (`parsePlanNode` throwing, `findPlanNodeSchemaProblems` reporting — the latter feeds the
  management-api surface) refuse naming node + kind + every unknown field in code-point
  order; the reporting consumer at `src/core/management-api/stores.ts:517` inherits the
  refusal with no change needed.
- **D4 keying fence**: `git diff 15b60a63 -- src/core/pipeline-registry/ pipelines/
  packages/ui package.json` = **0 bytes**; `src/core/store/workspace/` (the containment
  site) also 0-line diffstat. Rationale + portfolio-ledger follow-up recorded.
- **D5 merge/split**: `deriveRevisionDelta` pure function, node-by-node over stable nodeIds;
  delta computed after every axis and driving none (test-pinned by reading the same revision
  with/without the predecessor and comparing axes exactly); persisted nowhere; first revision
  → null; predecessor-id mismatch → no delta (defensive). The nodeId-continuity convention is
  stated in the playbook text and pinned in the parity test.
- **Confirm = read-compose-report**: `composeIssueConfirm` is a pure composition; reference
  verification reuses the plan read's readiness resolutions; per-node contracts resolved by
  the SAME `resolveIssueLaunchBinding` with the same `workComplete` predicate the frontier
  uses; CLI tree-fingerprint test hashes store root AND global data dir across both forms.
  Live proof above.
- **Spec audit** (scripted): all six MODIFIED requirement headers byte-match their
  `rasen/specs/<cap>/spec.md` titles; every requirement block's first line carries SHALL
  (six MODIFIED + the ADDED confirm requirement); scenario transitions are additions only —
  11→13, 5→6, 13→16, 3→4, 6→8, 3→4 — zero renames, zero deletions. `rasen validate
  issue-autodecompose-review-flow` exit 0 (re-run by reviewer).
- **Prior-test containment** (full-diff hunt): exactly 5 prior test files touched, all within
  the sanctioned sets — `issue-plan-decomposition.test.ts` (the deliberately changed D1
  behavior: assertions flipped to carry-lifecycle, document-byte-identical scenario retained);
  `issue-status-projection.test.ts` (one `lifecycle` null→`'required'` assertion, type-driven);
  `issue-execution-binding.test.ts` (two fixture rows null→`'required'`, mechanical);
  `store-issue-status-cli.test.ts` (helper return-type only + new test);
  `skill-templates-parity.test.ts` (two mandated hash re-pins + new content-level test).
  No other prior test edited, deleted, or renamed anywhere in the delta.
- **Template discipline**: hash re-pins verified; dist rebuilt (new continuation text present
  in `dist/core/templates/workflows/{_orchestration,auto}.js`); parity test also pins content
  strings, so a hash-only drift cannot hide the loss. Locales mirrored ×3 (en/ja/zh-cn all
  carry the `confirm` command entry). Architecture-index updated per the maintenance rule.

## Gate 4 — Fixture-coincidence mutation spot-checks

- **Mutation A (kill the suggestion chain)**: removed the `else if
  (changeNode.suggestedPipeline !== undefined)` branch from `binding.ts` →
  `composeIssueConfirm > reports the launchable contract set…` (the confirm receipt
  composition) FAILED and `resolveIssueLaunchBinding > supplies the pipeline from the plan's
  suggestion…` FAILED (2 failed / 45 passed). Restored; sha256 back to
  `11fe0aac…` (pre-mutation snapshot); post-restore sanity 18/18 green.
- **Mutation B (remove the extra-keys refusal)**: made `planNodeUnknownFields` return `[]` →
  all FOUR `authored-input extra-keys refusal` tests FAILED (throwing path, reporting path,
  stable-order naming, cross-kind fields) in `store-issue-intent-lifecycle.test.ts`.
  Restored; sha256 back to `c98a0aa0…`; sanity green.

Both new-behavior test families are load-bearing: no fixture coincidence.

## Findings

### Minor-1 — `confirm --revision <id>` that does not read back is misdescribed by the requires-plan refusal

`src/commands/store-issue.ts`, confirm action (~line 1287–1300): when `--revision` names a
revision that does not read back, `composeIssueConfirm` sees `plan.revision === null` and
refuses with `issue_confirm_requires_plan` — message "Issue … has no readable published
Execution Plan revision; the planning phase and its publish action precede confirmation" and
Fix "Publish an Execution Plan revision first…". Failure scenario (reproduced live,
`confirm … --revision 9999` over Issue #3, exit 1): an operator who typo'd a revision id on an
Issue that HAS readable revisions is told the Issue has no plan and is advised to publish a
NEW revision — the opposite of the safe action. Behavior is correct (refuses, exit 1, no
write) and the ADDED spec requirement's letter ("SHALL refuse … whose revision cannot be
read") is met; only the message/fix conflate the two causes. Suggest distinguishing the
named-revision case (message naming the requested id, fix suggesting `store issue show` for
the readable ordinals).

### Info-1 — stale comment on `isRequired` after D1

`src/core/issue-status/projection.ts` (~line 625, the `isRequired` doc): still says "intent
nodes carry no lifecycle at all and never do" — factually outdated now that intent nodes carry
`required|optional` (the `kind === 'change'` conjunct is what excludes them from progress).
Comment only; zero behavior. Worth a one-line touch-up whenever this file is next edited.

### Notes (not defects of this change)

- `store-issue-status-cli.test.ts > degrades to a labelled visibility-none answer…` still
  carries the default 30s budget while its own comment documents ~27s solo wall-clock and its
  sibling was raised to 60s. It bit both this leg and the implementers' leg on a slow box and
  cost base-commit adjudication to clear. Raising its budget (like the sibling) would remove
  a recurring ambient tax. Pre-existing — proven at base `15b60a63`.
- `evidence/local-gates.md`'s failure table uses shorthand paths (`shared/tool-detection`,
  `commands/pipeline` → `test/commands/pipeline.test.ts`, `change-run/engine-*` →
  `test/core/change-run/…`). Cosmetic; the files are identifiable.

## Honest-divergence check

The dogfood's stated divergence (worktree-side confirm expected a resume-oriented contract;
both roots composed fresh because the seeded archive is legacy v1 with no outcome and no
run-state file exists) is TRUE against the live store — verified by inspecting the seeded
`archive.json` (no `schemaVersion`, zero `outcome`), the receipts, and my own re-runs. It is
documented as such in `dogfood-staged-starts.md` §4–5 with the staged start deliberately not
executed.

## Round-1 re-review (fix delta only)

**CLEAN — no new findings.** Both round-1 findings are fixed as claimed; nothing else moved
(`binding.ts` and `plans.ts` sha256-identical to the round-1 reviewed state; delta growth
confined to the claimed files + evidence).

- **Minor-1 fix verified.** `issue_confirm_revision_unreadable` splits the two truths: a
  NAMED revision miss over an Issue WITH published revisions names the requested id and the
  readable range (single: "its one published revision is NNNN"; several: "run FIRST–LAST
  (latest NNNN)"); the zero-revision arm keeps `issue_confirm_requires_plan` **verbatim**
  (byte-compared against the round-1 text). The CLI fix-hint maps per code — show-command
  advice for the new code, publish advice exclusive to requires-plan. **Reproduced live by
  the reviewer** over Issue #3 (`--revision 9999`): exit 1, message
  "Revision '9999' … its published revisions run 0001–0003 (latest 0003)", fix = the show
  command — **byte-identical** to `evidence/fix-round-1-confirm-revision-9999.txt`, and the
  store tree is still untouched afterwards (only the untracked issue dir; HEAD = seed
  `8c65d14`). Pins: 2 core (named-miss → new code + never planning-phase wording;
  named-miss over zero revisions → requires-plan) and 1 CLI (exit 1, code in the receipt,
  message fragments, exact fix string) — all load-bearing against the old behavior by
  construction.
- **Info-1 fix verified.** The `progressOver`/`isRequired` doc now states the D1 truth
  (intent nodes carry `required|optional`; the change-kind conjunct excludes them;
  `cancelled|superseded` stay Change-node-only). Comment only.
- **Spec audit re-run**: the ADDED confirm requirement goes 3→4 scenarios — a pure addition
  ("Confirm refuses a named revision that does not read back with the readable range"),
  within the requirement's existing "SHALL refuse, naming the defect" letter; no requirement
  text changed; all six MODIFIED headers still byte-match, first-line SHALL intact, zero
  renames/deletions anywhere. `rasen validate` exit 0 (re-run).
- **Fixer's solo numbers confirmed on the reviewer's leg**: confirm-core 9/9 + binding 40/40
  + projection 25/25 together (74/74, exit 0) and confirm-cli 5/5 (exit 0).
- **Fences still 0 bytes** (`pipeline-registry/`, `pipelines/`, `packages/ui`,
  `package.json` — diff 0, no untracked entries).

The round-1 base-proven marginal-budget Note (visibility-none CLI test's 30s default)
stands as operator hygiene, not a defect of this change.
