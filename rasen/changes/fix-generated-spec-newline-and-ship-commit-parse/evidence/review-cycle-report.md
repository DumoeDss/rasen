# Review Cycle: fix-generated-spec-newline-and-ship-commit-parse

Rounds: 2/2 &nbsp;&nbsp; Tier: B &nbsp;&nbsp; Status: **CLEAN**

Max rounds was set to 2 by the operator, with a third round permitted only if round 2 could not be completed. Round 2 completed and returned no Blocker and no Major finding, so no third round was run.

## Execution facts

| | |
|---|---|
| Repository | `/Users/pashifika/Work/pashifika.github/rasen` |
| Branch | `fix/generated-spec-newline-and-ship-commit-parse` |
| Diff base | `upstream/dev/0.1.8` (`77c860dd`) |
| Commits under review at round 1 | `0dceb2f3` (code + tests), `dea4c046` (planning artifacts) |
| Host runtime | `omp`, LEAD occupancy 0.28 against threshold 0.50 (`shouldHandoff: false`) |
| Tier rationale | Native leaf-worker dispatch is available, but `rasen agent wait` parking is gated to Claude-native routes and a completed worker cannot be warm-continued by handle across this host. Every worker ran `ONE_SHOT`; round 2 re-engaged one round-1 reviewer by message and replaced the other with a fresh worker seeded from its predecessor's verdict. |
| Author / verifier | The LEAD authored the code under review, so every fix was routed to a dispatched worker and every resolution was confirmed by a worker that authored none of it. |

## Round table

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
|-------|----------------------|--------|----------|---------------------------|----------|
| 1 | 0 / 1 / 2 / 2 | 2 code, 3 artifact | `ReaderFixer` (code), `ArtifactFixer` (artifacts) | `CycleReviewer` (warm continuation, occupancy 0.18) and `DeltaAdversary` (fresh, seeded from `AdversarialReviewer`) | 5/5 |
| 2 | 0 / 0 / 0 / 3 | 3 prose, LEAD inline | LEAD | `CycleReviewer` | 3/3 |

## Round 1

Two reviewers ran in parallel over the full diff. `CycleReviewer` invoked the `rasen-review` engine and wrote `review-report.md`; `AdversarialReviewer` attacked the two compatibility claims the proposal made.

| # | Severity | Finding | Triage | Fixed by | Confirmed by |
|---|---|---|---|---|---|
| F1 | Minor | `readRecordedShipCommit` matched only the FIRST `**Commit:**` line and validated afterwards, so a later readable line was never reached. The replaced expression required the whole line to be a hash, which made `String.prototype.match` skip an unreadable labelled line and return the first READABLE one — the fix silently narrowed that. Both halves of the triggering composition exist in this repository's corpus. | code | `ReaderFixer` | `CycleReviewer`, `DeltaAdversary` |
| F2 | Minor | The proposal justified the widening by citing qualified SHA values in the adjacent `**Store commit:**` field, but the implementation deliberately rejects a qualified value. A corpus scan of all 67 `ship-log.md` files found four present fields the reader still returns null for, including the real code-span log `rasen/changes/archive/2026-07-07-remove-gstack-parallel-lifecycle/ship-log.md:6`. | artifact | `ArtifactFixer` | `CycleReviewer`, `DeltaAdversary` |
| F3 | Trivial | `RecordedShipCommit.field` was never read by any caller, colliding with the project rule against unconsumed surface. | code | `ReaderFixer` | `CycleReviewer` |
| F4 | Trivial | The replaced expression's `\s*` matched `\n`, so a hash on the line AFTER the label used to resolve and no longer does. The narrowing is intentional but was recorded nowhere. | artifact | `ArtifactFixer` | `CycleReviewer` |
| F5 | **Major** | The proposal claimed the only observable difference was a canonical spec losing one trailing blank line. False for the ship-commit half: a non-null `shipLog.recordedCommit` is load-bearing in Store v2's `resolveCodeCommitCandidate` (`src/core/store/finalization/module.ts:1331-1335`, `src/core/store/finalization/reachability.ts:34-41`), so a code-span ship log can now cause `landed_commit_unreachable` or `landed_commit_unresolved` where the execution `HEAD` was previously selected and the change landed. | artifact | `ArtifactFixer` | `CycleReviewer`, `DeltaAdversary` |

`AdversarialReviewer` CONFIRMED the newline half of the not-BREAKING claim with independent evidence: a stored plan is returned after identity and path validation with no serializer re-invocation (`src/core/archive-engine.ts:3592-3643`), apply expects `sha256(action.rebuilt)` (`:9954`) and writes the stored string (`:10014`), `sourceSha256` digests the delta source (`src/core/specs-apply.ts:250-256`) and apply compares `action.source` (`src/core/archive-engine.ts:9741-9744`), `emptied` is decided before normalization (`src/core/specs-apply.ts:706`), validation trims section content (`src/core/parsers/markdown-parser.ts:167-182`), and no fixture pins a canonical body with a trailing blank line.

F1's semantics were decided by the LEAD before dispatch: the first READABLE `**Commit:**` value is authoritative, because that preserves the effective behavior of the expression being replaced.

## Round 2

The fix delta was re-reviewed by two non-authors. `CycleReviewer` was warm-continued after an H.2 occupancy probe (0.18 against threshold 0.50). `AdversarialReviewer`'s probe reported nonzero `contextTokens` with `limit: 0` and no `shouldHandoff` verdict — UNMEASURED, not below threshold — so it was not warm-continued; `DeltaAdversary` was dispatched fresh and seeded with its predecessor's verdict.

All five round-1 findings were confirmed RESOLVED. `CycleReviewer` re-measured every one of the 67 real ship logs against the original upstream expression: **no value lost, three gained**, with round-1 and round-2 readers agreeing on every real file. It also judged the `matchAll` implementation better than the fix it had proposed, because it early-returns off a lazy iterator instead of materializing every match.

Three new Trivial findings, all prose, no code change:

| # | Severity | Finding | Fixed by | Confirmed by |
|---|---|---|---|---|
| T1 | Trivial | The proposal's Impact bullet stated the Store v2 consequence unconditionally, but an explicit `--commit` outranks the recorded ship commit (`reachability.ts:34-36`, fed from `module.ts:1332`, forwarded from `src/core/archive.ts:1668`). | LEAD | `CycleReviewer` |
| T2 | Trivial | `specs/sha-cross-stamping/spec.md:9` asserted a plan and its applying transaction "can never record different ship commits", which the finalization fallback `plan.shipLog.recordedCommit ?? readRecordedShipCommit(content)` (`src/core/archive-engine.ts:9147-9148`) breaks across builds: a plan saved before this change carries `null` for a code-span log while the applying transaction now writes the hash. | LEAD | `CycleReviewer` |
| T3 | Trivial | Two delta scenarios had WHEN clauses too broad to coexist with first-readable-wins: `**Commit:** not-a-hash` followed by `**Commit:** abcdef1` satisfied "an unreadable commit field" while the reader returns `abcdef1`, making the normative block self-contradictory. | LEAD | `CycleReviewer` |

`DeltaAdversary` additionally demonstrated the narrowing direction empirically, executing the real reader, `resolveCodeCommitCandidate` and `proveLandedReachability` against a read-only Git adapter with `**Commit:**\n0000000`: the original reader selected the ship-log candidate and produced `landed_commit_unresolved`, while the current reader selects the execution `HEAD` and passes. Both the proposal and the design now record that direction.

T1–T3 were applied by the LEAD as trivial inline prose corrections using the wording the reviewers prescribed, then confirmed by `CycleReviewer` as a non-author: all three CONFIRMED, none overshot, no new inaccuracy. It independently verified that all four `persistArchivePlan` call sites are plan creation (`src/core/archive.ts:1478`, `:1529`, `:1726`, `src/core/store/finalization/module.ts:784`), which is what makes the new `SHALL NOT rewrite the saved plan` clause true.

## Accepted-known at clean time

- **Trivial** — the cross-rule clauses added to `specs/sha-cross-stamping/spec.md:9` are pinned by no scenario and no test. The behavior is real and correct (the fallback at `src/core/archive-engine.ts:9147-9148`; the saved plan is never rewritten), and `tasks.md` item 3.4 records the executable check that a plan saved by an `upstream/dev/0.1.8` build applies cleanly under the fixed build. Adding a scenario would introduce normative text after the final review round, so it is recorded here instead. Raised by `CycleReviewer` as explicitly non-blocking.
- **Trivial** — the qualified `**Commit:**` value (for example `` `8d6ae87` (pushed `3793c5f..8d6ae87`) ``) remains unreadable by design. Four corpus logs are affected. The proposal records it under `## Out of Scope` together with the deferred present-but-unreadable-field blocker that will decide it.
- **Trivial** — a separator other than space or tab between the label and the hash (for example U+00A0), and a hash on the line after the label, are no longer read. Intentional and now documented in the design and the delta spec; no corpus log is shaped that way.

`CycleReviewer`'s second optional observation — the singular "the later line's hash" in the scenario at `specs/sha-cross-stamping/spec.md:32-36` — was applied rather than accepted, using its own prescribed wording ("the first such later line's hash"). It is a precision edit with no normative change.

## Test evidence of the final clean round

| | |
|---|---|
| Required scope | `test/core/archive.test.ts`, `test/core/archive-engine.test.ts`, `test/core/specs-apply.test.ts` |
| Rationale | The change touches exactly two production behaviors: the canonical-spec serializer and the shared ship-commit reader. These three files own the terminal-newline matrix, the ship-commit presentation matrix driven through a real plan-and-apply, and the CRLF plus prefix-byte finalization guard. The broader archive, finalization and Store scope was already run green against the round-1 code at 138 files and 2299 tests; round 2 changed no production source beyond the reader, whose consumers are covered here. |
| Command | `env -u ZSH pnpm exec vitest run test/core/archive.test.ts test/core/archive-engine.test.ts test/core/specs-apply.test.ts` |
| Result | 3 files passed, 183 passed, 12 skipped, 0 failed |
| Type check | `env -u ZSH pnpm exec tsc --noEmit` → exit 0 |
| Lint | `env -u ZSH pnpm exec eslint src/core/archive-engine.ts src/core/archive.ts test/core/archive.test.ts` → exit 0 |
| Artifact validation | `RASEN_LANG=en rasen validate fix-generated-spec-newline-and-ship-commit-parse --strict` → valid |
| Scenario preservation | All four scenarios present in the canonical `rasen/specs/sha-cross-stamping/spec.md` requirement are present in the delta's MODIFIED replacement (set difference empty) |
| Reviewed content tree | `5227c61bd4c1e31c86c7522cf8e56ce014cd859e` (`git rev-parse HEAD^{tree}` at `dea4c046`, the state round 2 reviewed; the round-2 fix delta was uncommitted at review time) |
| Tested content tree | `8091c2338d0e3f41d9b291bf9a6b8e99f2a0287d` (`5047ca66`, the commit that carries the exact source the commands above ran against; no production source changed after the run, only artifacts) |
| Final content tree | `6a937f5b7647b667073853869a569e6fa0521067` (`085a85c0`, this report included) |

## Termination

No Blocker and no Major finding is open. Every resolution was confirmed by a worker that did not author the fix. Round 2 completed, so the operator's conditional third round was not used.
